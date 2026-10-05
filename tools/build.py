"""Build the Stepwise course site.

1. Parse content/<unit>/*.lesson files.
2. Run every code sample in CPython (outputs, expected answers, animation frames).
3. Re-run the same code in the in-browser runner (PyRun via node) and require identical results.
4. Bundle dist/index.html (app + runner + course data).

Usage: python3 tools/build.py [--only u1|lesson-id|file-stem,...] [--check] [--skip-diff] [--out DIR] [--allow-short] [--content DIR]
"""
import html
import json
import pathlib
import random
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"
DIST = ROOT / "dist"
sys.path.insert(0, str(ROOT / "tools"))
import bundle_py  # noqa: E402

TEXT_FIELDS = {"title", "prompt", "right", "wrong", "hint", "intro", "explain", "summary", "check", "answer", "expect",
               "labels", "start", "speed", "view", "show", "id", "indent", "name"}
CODE_FIELDS = {"code", "starter", "solution", "lines", "distractors", "compute", "after", "setup", "slow"}
LIST_FIELDS = {"tests", "items", "options", "cases"}
KEYED = {"wrong", "fail", "error", "require", "forbid"}
DIFFS = {"easy", "medium", "hard"}
TASK_TYPES = {"mcq", "multi", "predict", "fill", "parsons", "code", "cells", "order"}

SECTION_RE = re.compile(r"^=== (\w+)(?::\s*(.*?))?\s*$")
FIELD_RE = re.compile(r"^([a-z_]+)(?:\[(.*?)\])?:(?:[ \t](.*))?$")
OPTION_RE = re.compile(r"^([-*])\s+(.*?)\s+::\s+(.*)$")
NOTE_RE = re.compile(r"^(\d+)(?:-(\d+))?:\s+(.*)$")


class BuildError(Exception):
    pass


ALLOW_SHORT = False
SHORT = []


# ---------------------------------------------------------------- markdown
def inline_md(text: str) -> str:
    parts = re.split(r"(`[^`]+`)", text)
    out = []
    for p in parts:
        if p.startswith("`") and p.endswith("`") and len(p) >= 2:
            out.append('<code class="ic">' + html.escape(p[1:-1], quote=False) + "</code>")
        else:
            t = html.escape(p, quote=False)
            t = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", t)
            t = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<em>\1</em>", t)
            t = re.sub(r"\[([^\]]+)\]\((https?://[^)\s]+)\)", r'<a href="\2" target="_blank" rel="noopener">\1</a>', t)
            out.append(t)
    return "".join(out)


def md(text: str) -> str:
    if text is None:
        return ""
    lines = text.strip("\n").split("\n")
    out = []
    i = 0
    while i < len(lines):
        line = lines[i]
        s = line.strip()
        if not s:
            i += 1
            continue
        if s.startswith("```"):
            lang = s[3:].strip() or "python"
            j = i + 1
            buf = []
            while j < len(lines) and lines[j].strip() != "```":
                buf.append(lines[j])
                j += 1
            code = "\n".join(buf)
            out.append(f'<pre class="snippet" data-lang="{html.escape(lang)}">' + html.escape(code, quote=False) + "</pre>")
            i = j + 1
            continue
        if s.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append(lines[i].strip())
                i += 1
            cells = [[c.strip() for c in r.strip("|").split("|")] for r in rows]
            body = [r for r in cells if not all(re.fullmatch(r":?-{2,}:?", c) for c in r)]
            h = "<table class=\"mdtable\"><thead><tr>" + "".join(f"<th scope=\"col\">{inline_md(c)}</th>" for c in body[0]) + "</tr></thead><tbody>"
            for r in body[1:]:
                h += "<tr>" + "".join(f"<td>{inline_md(c)}</td>" for c in r) + "</tr>"
            out.append(h + "</tbody></table>")
            continue
        if s.startswith("> "):
            buf = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                buf.append(lines[i].strip()[1:].strip())
                i += 1
            out.append('<div class="callout">' + md("\n".join(buf)) + "</div>")
            continue
        if re.match(r"^[-*] ", s):
            items = []
            while i < len(lines) and re.match(r"^\s*[-*] ", lines[i]):
                items.append(re.sub(r"^\s*[-*] ", "", lines[i]))
                i += 1
                while i < len(lines) and lines[i].startswith("  ") and lines[i].strip() and not re.match(r"^\s*[-*] ", lines[i]):
                    items[-1] += " " + lines[i].strip()
                    i += 1
            out.append("<ul>" + "".join(f"<li>{inline_md(x)}</li>" for x in items) + "</ul>")
            continue
        if re.match(r"^\d+\. ", s):
            items = []
            while i < len(lines) and re.match(r"^\s*\d+\. ", lines[i]):
                items.append(re.sub(r"^\s*\d+\. ", "", lines[i]))
                i += 1
                while i < len(lines) and lines[i].startswith("   ") and lines[i].strip() and not re.match(r"^\s*\d+\. ", lines[i]):
                    items[-1] += " " + lines[i].strip()
                    i += 1
            out.append("<ol>" + "".join(f"<li>{inline_md(x)}</li>" for x in items) + "</ol>")
            continue
        buf = []
        while i < len(lines) and lines[i].strip() and not lines[i].strip().startswith(("```", "|", "> ")) and not re.match(r"^\s*[-*] ", lines[i]) and not re.match(r"^\s*\d+\. ", lines[i]):
            buf.append(lines[i].strip())
            i += 1
        out.append("<p>" + inline_md(" ".join(buf)) + "</p>")
    return "".join(out)


# ---------------------------------------------------------------- parsing
def split_sections(text, path):
    sections = []
    cur = None
    in_fence = False
    for ln, line in enumerate(text.split("\n"), 1):
        if line.strip().startswith("```"):
            in_fence = not in_fence
        m = SECTION_RE.match(line) if not in_fence else None
        if m:
            cur = {"kind": m.group(1), "arg": (m.group(2) or "").strip(), "lines": [], "line": ln}
            sections.append(cur)
        elif cur is not None:
            cur["lines"].append(line)
        elif line.strip():
            raise BuildError(f"{path}:{ln}: text before first section")
    return sections


def parse_fields(lines, ctx, allow_notes=False, bare_fence_code=False):
    """Parse key: value fields, fences, options, list items and numbered notes."""
    fields = {}
    keyed = {k: {} for k in KEYED}
    options = []
    notes = []
    lists = {"tests": [], "items": [], "cases": []}
    cur = None  # (kind, key, arg)
    i = 0
    n = len(lines)

    def add_text(key, arg, text):
        if key in KEYED and arg is not None:
            keyed[key][arg] = (keyed[key].get(arg, "") + ("\n" if keyed[key].get(arg) else "") + text)
        elif key == "hint":
            fields.setdefault("hint", [])
            fields["hint"][-1] = fields["hint"][-1] + "\n" + text
        else:
            fields[key] = (fields.get(key, "") + ("\n" if fields.get(key) else "") + text)

    while i < n:
        line = lines[i]
        s = line.strip()
        if s.startswith("```"):
            lang = s[3:].strip() or "python"
            j = i + 1
            buf = []
            while j < n and lines[j].strip() != "```":
                buf.append(lines[j])
                j += 1
            if j >= n:
                raise BuildError(f"{ctx}: unclosed code fence")
            code = "\n".join(buf)
            if cur and cur[0] == "field" and cur[1] in CODE_FIELDS:
                if fields.get(cur[1]):
                    raise BuildError(f"{ctx}: two code blocks for '{cur[1]}'")
                fields[cur[1]] = code
            elif bare_fence_code and "code" not in fields:
                fields["code"] = code
                cur = ("field", "code", None)
            elif cur and cur[0] == "field" and cur[1] in TEXT_FIELDS | KEYED:
                add_text(cur[1], cur[2], "```" + lang + "\n" + code + "\n```")
            elif "code" not in fields:
                fields["code"] = code
            else:
                raise BuildError(f"{ctx}: unexpected code block")
            i = j + 1
            continue
        m = FIELD_RE.match(line)
        if m and (m.group(1) in TEXT_FIELDS or m.group(1) in CODE_FIELDS or m.group(1) in LIST_FIELDS or m.group(1) in KEYED):
            key, arg, val = m.group(1), m.group(2), (m.group(3) or "")
            if key in KEYED and arg is not None:
                keyed[key][arg] = val
            elif key == "hint":
                fields.setdefault("hint", []).append(val)
            elif key in LIST_FIELDS:
                if key in ("tests",) and val.strip():
                    fields["tests_mode"] = val.strip()
            else:
                if key in fields and key not in CODE_FIELDS:
                    raise BuildError(f"{ctx}: duplicate field '{key}'")
                fields[key] = val
            cur = ("field", key, arg)
            i += 1
            continue
        mo = OPTION_RE.match(line)
        if mo and (cur is None or cur[0] == "option" or cur[1] in ("options", "prompt", "code", "title", "check")):
            options.append({"ok": mo.group(1) == "*", "text": mo.group(2), "fb": mo.group(3)})
            cur = ("option", None, None)
            i += 1
            continue
        if cur and cur[0] == "option" and line.startswith("  ") and s:
            options[-1]["fb"] += " " + s
            i += 1
            continue
        if cur and cur[0] == "field" and cur[1] in ("tests", "items", "cases") and line.startswith("- "):
            lists[cur[1]].append(line[2:].rstrip())
            i += 1
            continue
        if allow_notes:
            mn = NOTE_RE.match(line)
            if mn:
                a = int(mn.group(1))
                b = int(mn.group(2) or a)
                notes.append({"from": a, "to": b, "text": mn.group(3)})
                cur = ("note", None, None)
                i += 1
                continue
            if cur and cur[0] == "note" and line.startswith("  ") and s:
                notes[-1]["text"] += " " + s
                i += 1
                continue
        if cur and cur[0] == "field" and (cur[1] in TEXT_FIELDS or cur[1] in KEYED):
            add_text(cur[1], cur[2], line)
            i += 1
            continue
        if not s:
            i += 1
            continue
        raise BuildError(f"{ctx}: can't place line: {line!r}")
    return fields, keyed, options, notes, lists


def parse_lesson(path):
    text = path.read_text()
    sections = split_sections(text, path)
    lesson = {"examples": [], "anims": [], "tasks": [], "learn": [], "keypoints": [], "path": str(path)}
    for sec in sections:
        ctx = f"{path.name}:{sec['line']} ({sec['kind']} {sec['arg']})"
        kind = sec["kind"]
        if kind == "lesson":
            for line in sec["lines"]:
                m = re.match(r"^(\w+):\s*(.*)$", line)
                if m:
                    lesson[m.group(1)] = m.group(2).strip()
        elif kind == "learn":
            body = "\n".join(sec["lines"]).strip("\n")
            steps = re.split(r"^### ", body, flags=re.M)
            out = []
            if steps[0].strip():
                out.append({"h": None, "md": steps[0]})
            for st in steps[1:]:
                head, _, rest = st.partition("\n")
                out.append({"h": head.strip(), "md": rest})
            lesson["learn"] = out
        elif kind == "keypoints":
            lesson["keypoints"] = [re.sub(r"^[-*]\s+", "", l).strip() for l in sec["lines"] if l.strip()]
        elif kind == "example":
            fields, keyed, options, notes, lists = parse_fields(sec["lines"], ctx, allow_notes=True, bare_fence_code=True)
            if "code" not in fields:
                raise BuildError(f"{ctx}: example needs code")
            lesson["examples"].append({"title": sec["arg"], "intro": fields.get("intro", ""), "code": fields["code"],
                                       "notes": notes, "ctx": ctx})
        elif kind == "animation":
            fields, keyed, options, notes, lists = parse_fields(sec["lines"], ctx, allow_notes=True, bare_fence_code=True)
            views = []
            for v in (fields.get("view") or "vars").split("\n"):
                v = v.strip()
                if v:
                    views.append(parse_view(v, ctx))
            lesson["anims"].append({"title": sec["arg"], "intro": fields.get("intro", ""), "code": fields.get("code", ""),
                                    "views": views, "captions": {str(nt["from"]): nt["text"] for nt in notes},
                                    "show": (fields.get("show") or "").split(), "ctx": ctx})
        elif kind == "task":
            parts = sec["arg"].split()
            if len(parts) != 2 or parts[0] not in TASK_TYPES or parts[1] not in DIFFS:
                raise BuildError(f"{ctx}: task header must be 'task: <type> <easy|medium|hard>'")
            fields, keyed, options, notes, lists = parse_fields(sec["lines"], ctx)
            lesson["tasks"].append({"type": parts[0], "diff": parts[1], "fields": fields, "keyed": keyed,
                                    "options": options, "lists": lists, "ctx": ctx})
        else:
            raise BuildError(f"{ctx}: unknown section '{kind}'")
    for k in ("id", "title", "summary"):
        if not lesson.get(k):
            raise BuildError(f"{path.name}: lesson needs '{k}'")
    return lesson


def parse_view(spec, ctx):
    parts = spec.split()
    v = {"type": parts[0]}
    rest = parts[1:]
    names = []
    for p in rest:
        if "=" in p:
            k, val = p.split("=", 1)
            v[k] = val
        else:
            names.append(p)
    if names:
        v["vars"] = names
    if v["type"] not in {"vars", "array", "bars", "grid", "stack", "queue", "linked", "tree", "heap", "graph", "buckets",
                         "callstack", "chart", "dict", "set", "output", "steps"}:
        raise BuildError(f"{ctx}: unknown view type {v['type']}")
    return v


# ---------------------------------------------------------------- execution
def run_cpython(jobs):
    if not jobs:
        return []
    # A fixed hash seed makes the order of sets of strings (shown in animations) the same on every build.
    env = dict(__import__("os").environ, PYTHONHASHSEED="0")
    p = subprocess.run([sys.executable, str(ROOT / "tools" / "cpy_runner.py")], input=json.dumps(jobs),
                       capture_output=True, text=True, timeout=900, env=env)
    if p.returncode != 0:
        raise BuildError("cpython runner failed: " + p.stderr[-2000:])
    return json.loads(p.stdout)


def run_pyrun(jobs):
    if not jobs:
        return []
    p = subprocess.run(["node", str(ROOT / "tools" / "pyrun_cli.js")], input=json.dumps(jobs), capture_output=True,
                       text=True, timeout=900)
    if p.returncode != 0:
        raise BuildError("pyrun runner failed: " + p.stderr[-2000:])
    res = json.loads(p.stdout)
    return [r for r in res]


def norm_out(s):
    return "\n".join(line.rstrip() for line in s.strip("\n").split("\n"))


def sub_blanks(code, answers, ctx):
    pieces = code.split("??")
    if len(pieces) - 1 != len(answers):
        raise BuildError(f"{ctx}: {len(pieces) - 1} blanks but {len(answers)} answers")
    out = pieces[0]
    for a, p in zip(answers, pieces[1:]):
        out += a + p
    return out


def split_pipe(v):
    return [x.strip() for x in v.split("|")]


def deterministic_shuffle(items, seed):
    rnd = random.Random(seed)
    order = list(range(len(items)))
    for _ in range(20):
        rnd.shuffle(order)
        if order != list(range(len(items))):
            break
    return [items[i] for i in order]


# ---------------------------------------------------------------- task compile
def compile_lesson(lesson, cjobs, pjobs, checks):
    """Turn a parsed lesson into course JSON, registering jobs to run."""
    L = {
        "id": lesson["id"], "title": lesson["title"], "summary": inline_md(lesson["summary"]),
        "learn": [{"h": s["h"], "html": md(s["md"])} for s in lesson["learn"]],
        "keypoints": [inline_md(k) for k in lesson["keypoints"]],
        "examples": [], "anims": [], "tasks": [],
    }
    lid = lesson["id"]
    if not lesson["learn"]:
        raise BuildError(f"{lid}: missing learn section")
    if not (1 <= len(lesson["examples"]) <= 2):
        raise BuildError(f"{lid}: needs 1 or 2 examples (has {len(lesson['examples'])})")
    if not (1 <= len(lesson["anims"]) <= 2):
        raise BuildError(f"{lid}: needs 1 or 2 animations (has {len(lesson['anims'])})")
    counts = {d: sum(1 for t in lesson["tasks"] if t["diff"] == d) for d in ("easy", "medium", "hard")}
    if counts != {"easy": 10, "medium": 10, "hard": 10}:
        msg = f"{lid}: needs 30 tasks, 10 easy + 10 medium + 10 hard (has {counts['easy']} easy, {counts['medium']} medium, {counts['hard']} hard)"
        if not ALLOW_SHORT:
            raise BuildError(msg)
        SHORT.append(msg)
    if not lesson["keypoints"]:
        raise BuildError(f"{lid}: missing keypoints")

    for xi, ex in enumerate(lesson["examples"]):
        e = {"title": ex["title"], "intro": inline_md(ex["intro"]), "code": ex["code"],
             "notes": [{"from": nt["from"], "to": nt["to"], "html": inline_md(nt["text"])} for nt in ex["notes"]]}
        L["examples"].append(e)
        k = len(cjobs)
        cjobs.append({"kind": "run", "src": ex["code"], "filename": f"example_{xi + 1}.py"})
        pjobs.append({"id": len(pjobs), "src": ex["code"]})
        checks.append(("example", ex["ctx"], k, len(pjobs) - 1, e))

    for an in lesson["anims"]:
        a = {"title": an["title"], "intro": inline_md(an["intro"]), "code": an["code"], "views": an["views"]}
        L["anims"].append(a)
        if an["views"][0]["type"] == "chart":
            a["frames"] = chart_frames(an)
            continue
        k = len(cjobs)
        cjobs.append({"kind": "trace", "src": an["code"], "captions": an["captions"], "show": an["show"], "max": 400})
        pjobs.append({"id": len(pjobs), "src": an["code"]})
        checks.append(("anim", an["ctx"], k, len(pjobs) - 1, a))

    for idx, t in enumerate(lesson["tasks"]):
        L["tasks"].append(compile_task(lid, idx, t, cjobs, pjobs, checks))
    diffs = [t["diff"] for t in L["tasks"]]
    order = {"easy": 0, "medium": 1, "hard": 2}
    if any(order[a] > order[b] for a, b in zip(diffs, diffs[1:])):
        raise BuildError(f"{lid}: tasks must go easy -> medium -> hard (got {diffs})")
    return L


def chart_frames(an):
    v = an["views"][0]
    fns = v.get("fns", "n").split(",")
    labels = v.get("labels", ",".join(fns)).split(",")
    rng = v.get("n", "1..32")
    lo, hi = [int(x) for x in rng.split("..")]
    step = v.get("step", "x2")
    ns = []
    x = lo
    while x <= hi:
        ns.append(x)
        x = x * 2 if step == "x2" else x + int(step)
    import math
    env = {"log2": lambda z: math.log2(z) if z > 0 else 0, "log": math.log, "math": math, "factorial": math.factorial}
    frames = []
    for n in ns:
        vals = []
        for f in fns:
            vals.append(eval(f, {"__builtins__": {}}, dict(env, n=n)))
        cap = an["captions"].get("1", "")
        cap = cap.replace("{n}", str(n))
        for lab, val in zip(labels, vals):
            cap = cap.replace("{" + lab + "}", f"{round(val):,}")
        frames.append({"n": n, "vals": [round(val, 3) for val in vals], "cap": cap or f"n = {n}"})
    v["labels"] = labels
    return frames


def strip_comments(code):
    out = []
    for line in code.split("\n"):
        q = None
        cut = len(line)
        k = 0
        while k < len(line):
            c = line[k]
            if q:
                if c == "\\":
                    k += 2
                    continue
                if c == q:
                    q = None
            elif c in "\"'":
                q = c
            elif c == "#":
                cut = k
                break
            k += 1
        out.append(line[:cut])
    return "\n".join(out)


def rule_problems(T, code):
    """Same check as the app: patterns compared with all whitespace removed, comments ignored."""
    flat = re.sub(r"\s+", "", strip_comments(code))
    probs = []
    for r in T.get("require", []):
        if re.sub(r"\s+", "", r["pat"]) not in flat:
            probs.append("missing required " + r["pat"])
    for r in T.get("forbid", []):
        if re.sub(r"\s+", "", r["pat"]) in flat:
            probs.append("uses forbidden " + r["pat"])
    return probs


def need(t, *keys):
    for k in keys:
        if not t["fields"].get(k):
            raise BuildError(f"{t['ctx']}: missing '{k}'")


def compile_task(lid, idx, t, cjobs, pjobs, checks):
    f = t["fields"]
    need(t, "title")
    if not f.get("hint"):
        raise BuildError(f"{t['ctx']}: needs at least one hint")
    T = {"type": t["type"], "diff": t["diff"], "title": inline_md(f["title"]), "prompt": md(f.get("prompt", "")),
         "hints": [md(h) for h in f["hint"]], "code": f.get("code")}
    ty = t["type"]
    if ty in ("mcq", "multi"):
        need(t, "prompt")
        opts = t["options"]
        if len(opts) < 2:
            raise BuildError(f"{t['ctx']}: needs at least 2 options")
        n_ok = sum(o["ok"] for o in opts)
        if ty == "mcq" and n_ok != 1:
            raise BuildError(f"{t['ctx']}: mcq needs exactly one correct option (*)")
        if ty == "multi" and n_ok < 1:
            raise BuildError(f"{t['ctx']}: multi needs at least one correct option")
        T["options"] = [{"html": inline_md(o["text"]), "ok": o["ok"], "fb": inline_md(o["fb"])} for o in opts]
        if f.get("right"):
            T["right"] = md(f["right"])
        if f.get("wrong"):
            T["wrong"] = md(f["wrong"])
        if (f.get("check") or "").strip() == "output":
            if not f.get("code"):
                raise BuildError(f"{t['ctx']}: check: output needs code")
            correct = [o for o in opts if o["ok"]][0]["text"].strip().strip("`")
            k = len(cjobs)
            cjobs.append({"kind": "run", "src": f["code"]})
            pjobs.append({"id": len(pjobs), "src": f["code"]})
            checks.append(("mcq-output", t["ctx"], k, len(pjobs) - 1, correct))
    elif ty == "predict":
        need(t, "code", "right", "wrong")
        if not f.get("prompt"):
            T["prompt"] = md("What does this code print? Type the output exactly, one line per line of output.")
        T["right"] = md(f["right"])
        T["wrong"] = md(f["wrong"])
        T["wrongs"] = {norm_out(k.replace("\\n", "\n")): md(v) for k, v in t["keyed"]["wrong"].items()}
        k = len(cjobs)
        cjobs.append({"kind": "run", "src": f["code"]})
        pjobs.append({"id": len(pjobs), "src": f["code"]})
        checks.append(("predict", t["ctx"], k, len(pjobs) - 1, T))
    elif ty == "fill":
        need(t, "code", "answer", "right", "wrong", "prompt")
        answers = split_pipe(f["answer"])
        T["answers"] = answers
        T["right"] = md(f["right"])
        T["wrong"] = md(f["wrong"])
        T["wrongs"] = {k.strip(): md(v) for k, v in t["keyed"]["wrong"].items()}
        T["after"] = f.get("after") or ""
        full = sub_blanks(f["code"], answers, t["ctx"]) + ("\n" + T["after"] if T["after"] else "")
        k = len(cjobs)
        cjobs.append({"kind": "run", "src": full})
        pjobs.append({"id": len(pjobs), "src": full})
        checks.append(("fill", t["ctx"], k, len(pjobs) - 1, T))
        for wk in T["wrongs"]:
            wsrc = sub_blanks(f["code"], split_pipe(wk), t["ctx"]) + ("\n" + T["after"] if T["after"] else "")
            k2 = len(cjobs)
            cjobs.append({"kind": "run", "src": wsrc})
            checks.append(("fill-wrong", t["ctx"], k2, None, (T, wk)))
    elif ty == "parsons":
        need(t, "lines", "right", "wrong", "prompt")
        raw = [ln for ln in f["lines"].split("\n") if ln.strip()]
        lines = [{"text": ln.strip(), "indent": (len(ln) - len(ln.lstrip(" "))) // 4} for ln in raw]
        distract = [{"text": ln.strip(), "indent": 0, "d": True} for ln in (f.get("distractors") or "").split("\n") if ln.strip()]
        T["lines"] = lines
        T["shuffled"] = deterministic_shuffle(list(range(len(lines) + len(distract))), f"{lid}-{idx}")
        T["distractors"] = distract
        T["after"] = f.get("after") or ""
        T["right"] = md(f["right"])
        T["wrong"] = md(f["wrong"])
        src = "\n".join("    " * ln["indent"] + ln["text"] for ln in lines) + ("\n" + T["after"] if T["after"] else "")
        k = len(cjobs)
        cjobs.append({"kind": "run", "src": src})
        pjobs.append({"id": len(pjobs), "src": src})
        checks.append(("parsons", t["ctx"], k, len(pjobs) - 1, T))
    elif ty == "code":
        need(t, "solution", "right", "wrong", "prompt")
        T["starter"] = f.get("starter") or ""
        T["solution"] = f["solution"]
        T["right"] = md(f["right"])
        T["wrong"] = md(f["wrong"])
        T["fails"] = {k: md(v) for k, v in t["keyed"]["fail"].items()}
        T["errors"] = {k: md(v) for k, v in t["keyed"]["error"].items()}
        T["require"] = [{"pat": k, "html": md(v)} for k, v in t["keyed"]["require"].items()]
        T["forbid"] = [{"pat": k, "html": md(v)} for k, v in t["keyed"]["forbid"].items()]
        for rule in rule_problems(T, f["solution"]):
            raise BuildError(f"{t['ctx']}: the solution breaks its own rule: {rule}")
        mode = f.get("tests_mode", "")
        if mode == "stdout":
            T["mode"] = "stdout"
            k = len(cjobs)
            cjobs.append({"kind": "run", "src": f["solution"]})
            pjobs.append({"id": len(pjobs), "src": f["solution"]})
            checks.append(("code-stdout", t["ctx"], k, len(pjobs) - 1, T))
            if T["starter"].strip():
                k3 = len(cjobs)
                cjobs.append({"kind": "run", "src": T["starter"]})
                checks.append(("stdout-starter", t["ctx"], k3, None, T))
        else:
            tests = t["lists"]["tests"]
            if not tests:
                raise BuildError(f"{t['ctx']}: code task needs tests")
            T["mode"] = "tests"
            T["tests"] = [{"code": c} for c in tests]
            cases = [c.replace("\\n", "\n") for c in t["lists"]["cases"]]
            if cases:
                # run the learner's code once per case, each time after that case's setup lines
                T["cases"] = [{"setup": c, "expect": [None] * len(tests)} for c in cases]
                T["_starter_ok"] = []
                for ci, c in enumerate(cases):
                    k = len(cjobs)
                    cjobs.append({"kind": "tests", "src": f["solution"], "pre": c, "tests": tests})
                    checks.append(("code-case", t["ctx"], k, None, (T, ci)))
                    k2 = len(cjobs)
                    cjobs.append({"kind": "tests", "src": T["starter"] or "pass", "pre": c, "tests": tests})
                    checks.append(("code-starter-case", t["ctx"], k2, None, (T, ci)))
                checks.append(("code-starter-cases", t["ctx"], 0, None, T))
            else:
                k = len(cjobs)
                cjobs.append({"kind": "tests", "src": f["solution"], "tests": tests})
                checks.append(("code-tests", t["ctx"], k, None, T))
                k2 = len(cjobs)
                cjobs.append({"kind": "tests", "src": T["starter"] or "pass", "tests": tests})
                checks.append(("code-starter", t["ctx"], k2, None, T))
        if f.get("slow") and not f.get("speed"):
            raise BuildError(f"{t['ctx']}: 'slow:' only makes sense with 'speed:'")
        if f.get("slow"):
            T["slow"] = f["slow"]
        if f.get("speed"):
            sp = dict(x.split("=", 1) for x in [p.strip() for p in f["speed"].split("|")])
            T["speed"] = {"setup": sp["setup"].strip(), "call": sp["call"].strip(), "target": sp["target"].strip(),
                          "sizes": [int(x) for x in sp.get("sizes", "500,1000,2000,4000,8000").split(",")],
                          "maxSteps": int(sp.get("max", "3000000"))}
    elif ty == "cells":
        need(t, "right", "wrong", "prompt")
        T["labels"] = split_pipe(f["labels"]) if f.get("labels") else None
        T["start"] = split_pipe(f["start"]) if f.get("start") else None
        T["right"] = md(f["right"])
        T["wrong"] = md(f["wrong"])
        T["wrongs"] = {" | ".join(split_pipe(k)): md(v) for k, v in t["keyed"]["wrong"].items()}
        if f.get("answer"):
            T["answer"] = split_pipe(f["answer"])
        elif f.get("compute"):
            k = len(cjobs)
            cjobs.append({"kind": "value", "src": f["compute"], "name": "answer"})
            checks.append(("cells", t["ctx"], k, None, T))
        else:
            raise BuildError(f"{t['ctx']}: cells needs answer or compute")
    elif ty == "order":
        need(t, "right", "wrong", "prompt")
        items = t["lists"]["items"]
        if len(items) < 2:
            raise BuildError(f"{t['ctx']}: order needs items")
        T["items"] = [inline_md(x) for x in items]
        T["shuffled"] = deterministic_shuffle(list(range(len(items))), f"{lid}-{idx}")
        T["right"] = md(f["right"])
        T["wrong"] = md(f["wrong"])
    return T


def apply_checks(checks, cres, pres, skip_diff):
    errors = []
    for kind, ctx, ck, pk, payload in checks:
        c = cres[ck]
        p = pres[pk] if (pk is not None and not skip_diff) else None
        if kind in ("example", "anim"):
            if c.get("error") and kind == "example" and "Error" in (c.get("error") or "") and "expect-error" not in ctx:
                payload["error"] = c["error"]
            if kind == "example":
                payload["output"] = c["stdout"]
                if c.get("error"):
                    payload["errorText"] = c.get("traceback") or c["error"]
            else:
                if c.get("error") and not c["error"].startswith(("NameError", "ValueError", "IndexError", "KeyError", "TypeError", "ZeroDivisionError", "RecursionError")):
                    errors.append(f"{ctx}: animation failed: {c['error']}")
                payload["frames"] = c.get("frames", [])
                if len(payload["frames"]) > 160:
                    print(f"  warn {ctx}: {len(payload['frames'])} animation frames")
            if p is not None:
                out = c["stdout"] if kind == "example" else c.get("stdout", "")
                if p.get("crash"):
                    errors.append(f"{ctx}: runner crash {p['crash']}")
                elif p["stdout"] != out:
                    errors.append(f"{ctx}: runner output differs\n  cpython: {out!r}\n  runner : {p['stdout']!r}")
                cerr = (c.get("error") or "").split(":")[0] or None
                perr = p["error"]["type"] if p.get("error") else None
                if cerr != perr and not (cerr == "TooLong"):
                    errors.append(f"{ctx}: error differs cpython={c.get('error')} runner={p.get('error')}")
        elif kind == "mcq-output":
            if c.get("error"):
                errors.append(f"{ctx}: code errors: {c['error']}")
            elif norm_out(c["stdout"]) != norm_out(payload):
                errors.append(f"{ctx}: correct option {payload!r} but code prints {c['stdout']!r}")
            if p is not None and p["stdout"] != c["stdout"]:
                errors.append(f"{ctx}: runner output differs {p['stdout']!r} vs {c['stdout']!r}")
        elif kind in ("predict", "fill", "parsons", "code-stdout"):
            if c.get("error"):
                errors.append(f"{ctx}: code raised {c['error']}")
                continue
            payload["expected"] = c["stdout"]
            if kind == "predict":
                exp = norm_out(c["stdout"])
                for wk in payload["wrongs"]:
                    if wk == exp:
                        errors.append(f"{ctx}: wrong[{wk}] equals the correct output")
                if not exp:
                    errors.append(f"{ctx}: predict task prints nothing")
            if p is not None:
                if p.get("crash") or p.get("error"):
                    errors.append(f"{ctx}: runner failed {p.get('crash') or p.get('error')}")
                elif p["stdout"] != c["stdout"]:
                    errors.append(f"{ctx}: runner output differs\n  cpython: {c['stdout']!r}\n  runner : {p['stdout']!r}")
        elif kind == "stdout-starter":
            if not c.get("error") and norm_out(c["stdout"]) == norm_out(payload.get("expected", "\0")) and not rule_problems(payload, payload["starter"]):
                errors.append(f"{ctx}: starter code already prints the expected output")
        elif kind == "fill-wrong":
            T, wk = payload
            if not c.get("error") and norm_out(c["stdout"]) == norm_out(T.get("expected", "\0")):
                errors.append(f"{ctx}: wrong[{wk}] gives the correct output")
        elif kind == "code-tests":
            if c.get("error"):
                errors.append(f"{ctx}: solution raised {c['error']}")
                continue
            for i, r in enumerate(c["results"]):
                if r.get("error"):
                    errors.append(f"{ctx}: test {i + 1} errors with solution: {r['error']}")
                payload["tests"][i]["expect"] = r["repr"]
                if r["repr"] and r["repr"].startswith("<"):
                    errors.append(f"{ctx}: test {i + 1} returns an object ({r['repr']}); return plain data instead")
        elif kind == "code-case":
            T, ci = payload
            if c.get("error"):
                errors.append(f"{ctx}: case {ci + 1}: solution raised {c['error']}")
                continue
            for i, r in enumerate(c["results"]):
                if r.get("error"):
                    errors.append(f"{ctx}: case {ci + 1} test {i + 1} errors with solution: {r['error']}")
                T["cases"][ci]["expect"][i] = r["repr"]
                if r["repr"] and r["repr"].startswith("<"):
                    errors.append(f"{ctx}: case {ci + 1} test {i + 1} returns an object ({r['repr']}); return plain data instead")
        elif kind == "code-starter-case":
            T, ci = payload
            ok = (not c.get("error")) and bool(c["results"]) and all(not r.get("error") and r["repr"] == T["cases"][ci]["expect"][i] for i, r in enumerate(c["results"]))
            T["_starter_ok"].append(ok)
        elif kind == "code-starter-cases":
            if payload.get("_starter_ok") and all(payload["_starter_ok"]):
                errors.append(f"{ctx}: starter code already passes every case")
            payload.pop("_starter_ok", None)
        elif kind == "code-starter":
            if not c.get("error") and c["results"] and all(not r.get("error") and r["repr"] == payload["tests"][i].get("expect") for i, r in enumerate(c["results"])):
                errors.append(f"{ctx}: starter code already passes every test")
        elif kind == "cells":
            if c.get("error"):
                errors.append(f"{ctx}: compute raised {c['error']}")
                continue
            v = c["value"]
            items = v.get("$l") if isinstance(v, dict) else None
            if items is None:
                errors.append(f"{ctx}: compute must set answer to a list")
                continue
            payload["answer"] = [str(x) if not isinstance(x, dict) else json.dumps(x) for x in items]
    return errors


def verify_code_tasks(course, skip_diff):
    """Run each code-task solution through the in-browser runner with the CPython expectations."""
    if skip_diff:
        return []
    jobs = []
    refs = []
    for L in course["lessons"].values():
        for i, T in enumerate(L["tasks"]):
            if T["type"] == "code" and T.get("mode") == "tests" and T.get("cases"):
                for ci, cs in enumerate(T["cases"]):
                    jobs.append({"id": len(jobs), "src": T["solution"], "pre": cs["setup"], "tests": [{"code": t["code"], "expect": e} for t, e in zip(T["tests"], cs["expect"])]})
                    refs.append((L["id"], f"{i + 1} case {ci + 1}"))
                continue
            if T["type"] == "code" and T.get("mode") == "tests":
                jobs.append({"id": len(jobs), "src": T["solution"], "tests": [{"code": t["code"], "expect": t["expect"]} for t in T["tests"]]})
                refs.append((L["id"], i))
                if T.get("slow"):
                    jobs.append({"id": len(jobs), "src": T["slow"], "tests": [{"code": t["code"], "expect": t["expect"]} for t in T["tests"]]})
                    refs.append((L["id"], f"{i} (slow version)"))
    res = run_pyrun(jobs)
    errors = []
    for r, (lid, i) in zip(res, refs):
        name = f"{lid} task {i + 1 if isinstance(i, int) else i}"
        if r.get("crash"):
            errors.append(f"{name}: runner crash {r['crash']}")
            continue
        if not r["load"]["ok"]:
            errors.append(f"{name}: runner can't load solution: {r['load']['error']}")
            continue
        for k, x in enumerate(r["results"]):
            if not x["ok"]:
                errors.append(f"{name} test {k + 1}: runner disagrees (got {x.get('got')} err {x.get('error')})")
    return errors


def verify_speed(course, skip_diff):
    if skip_diff:
        return []
    jobs = []
    for L in course["lessons"].values():
        for i, T in enumerate(L["tasks"]):
            if T.get("speed"):
                jobs.append({"lesson": L["id"], "task": i, "src": T["solution"], "speed": T["speed"], "slow": False})
                if T.get("slow"):
                    jobs.append({"lesson": L["id"], "task": i, "src": T["slow"], "speed": T["speed"], "slow": True})
    if not jobs:
        return []
    script = r'''
const PyRun = require(process.argv[1]);
let input = ''; process.stdin.on('data', d => input += d); process.stdin.on('end', () => {
  const jobs = JSON.parse(input); const out = [];
  for (const j of jobs) { const vm = PyRun.run(j.src).vm; const r = PyRun.speedCheck(vm, j.speed); out.push({growth: r.growth, points: r.points, exceeded: r.exceeded}); }
  process.stdout.write(JSON.stringify(out)); });'''
    p = subprocess.run(["node", "-e", script, str(DIST / "pyrun.js")], input=json.dumps(jobs), capture_output=True, text=True, timeout=600)
    if p.returncode != 0:
        return ["speed check failed: " + p.stderr[-1000:]]
    errors = []
    import itertools  # noqa
    rank = {"O(1)": 0, "O(log n)": 1, "O(n)": 2, "O(n log n)": 3, "O(n²)": 4, "O(n³)": 5, "too slow": 6}
    for j, r in zip(jobs, json.loads(p.stdout)):
        if j["slow"]:
            if rank.get(r["growth"], 9) <= rank[j["speed"]["target"]]:
                errors.append(f"{j['lesson']} task {j['task'] + 1}: the slow version passes the speed check ({r['growth']}, target {j['speed']['target']}) {r['points']}")
        elif rank.get(r["growth"], 9) > rank[j["speed"]["target"]]:
            errors.append(f"{j['lesson']} task {j['task'] + 1}: solution measured {r['growth']} but target is {j['speed']['target']} {r['points']}")
    return errors


def htmlstrip(h):
    return html.unescape(re.sub(r"<[^>]+>", "", h))


def write_atomic(path, text):
    tmp = path.with_name(f".{path.name}.{__import__('os').getpid()}.tmp")
    tmp.write_text(text)
    tmp.replace(path)


FAVICON = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E"
           "%3Crect width='32' height='32' rx='7' fill='%230A0C10'/%3E"
           "%3Cpath d='M8 10l6 6-6 6' fill='none' stroke='%23FFD43B' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/%3E"
           "%3Cpath d='M16 23h8' stroke='%23FFD43B' stroke-width='3' stroke-linecap='round'/%3E%3C/svg%3E")


def write_web(out_dir, page, ldir):
    """The Firebase Hosting build (dist/web): the same page as a full HTML document, plus Google sign-in and
    progress sync (src/app/firebase.js). The claude.ai build (dist/index.html) is a page fragment that the
    artifact host wraps itself."""
    web = out_dir / "web"
    (web / "lessons").mkdir(parents=True, exist_ok=True)
    names = {f.name for f in ldir.glob("*.json")}
    for old in (web / "lessons").glob("*.json"):
        if old.name not in names:
            old.unlink()
    for f in ldir.glob("*.json"):
        write_atomic(web / "lessons" / f.name, f.read_text())
    head, sep, body = page.partition('<div id="app">')
    if not sep:
        raise BuildError("page template has no <div id=\"app\">")
    fb = (ROOT / "src" / "app" / "firebase.js").read_text()
    doc = ("<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
           "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n"
           "<meta name=\"theme-color\" content=\"#0A0C10\">\n"
           f"<link rel=\"icon\" href=\"{FAVICON}\">\n"
           "<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}"
           "[hidden]{display:none!important}</style>\n"
           + head.strip() + "\n</head>\n<body>\n" + sep + body.rstrip() + "\n<script>" + fb + "</script>\n</body>\n</html>\n")
    write_atomic(web / "index.html", doc)


def build(only=None, skip_diff=False, check_only=False, out_dir=None):
    (DIST).mkdir(exist_ok=True)
    bundle = bundle_py.bundle()
    pr = DIST / "pyrun.js"
    if not pr.exists() or pr.read_text() != bundle:
        write_atomic(pr, bundle)
    units = json.loads((CONTENT / "units.json").read_text())
    course = {"units": [], "lessons": {}}
    cjobs, pjobs, checks = [], [], []
    for u in units:
        udir = CONTENT / u["id"]
        files = sorted(udir.glob("*.lesson")) if udir.exists() else []
        outline = u.get("outline", [])
        known = set()
        for entry in outline:
            known.add(entry[0])
            for ch in (entry[2] if len(entry) > 2 else []):
                known.add(ch[0])
        parsed = {}
        for fpath in files:
            try:
                lesson = parse_lesson(fpath)
            except BuildError as e:
                if only and u["id"] not in only and fpath.stem not in only:
                    print(f"  skipping {fpath.name} (not selected, doesn't parse yet: {e})")
                    continue
                raise
            if lesson["id"] not in known:
                raise BuildError(f"{fpath.name}: lesson id '{lesson['id']}' is not in the outline of unit {u['id']} (content/units.json)")
            if lesson["id"] in parsed:
                raise BuildError(f"duplicate lesson id {lesson['id']}")
            parsed[lesson["id"]] = (fpath, lesson)
        unit = {"id": u["id"], "title": u["title"], "blurb": u["blurb"], "lessons": [], "items": []}

        def item_for(lid, title):
            if lid not in parsed:
                return {"title": title, "planned": True}
            fpath, lesson = parsed[lid]
            if only and u["id"] not in only and fpath.stem not in only and lid not in only:
                return {"title": title, "planned": True}
            L = compile_lesson(lesson, cjobs, pjobs, checks)
            L["unit"] = u["id"]
            course["lessons"][L["id"]] = L
            unit["lessons"].append(L["id"])
            return {"id": L["id"], "title": htmlstrip(L["title"]), "n": len(L["tasks"])}

        for entry in outline:
            it = item_for(entry[0], entry[1])
            kids = [item_for(ch[0], ch[1]) for ch in (entry[2] if len(entry) > 2 else [])]
            if kids:
                it["children"] = kids
            unit["items"].append(it)
        course["units"].append(unit)
    print(f"parsed {len(course['lessons'])} lessons; {len(cjobs)} cpython jobs, {len(pjobs)} runner jobs")
    cres = run_cpython(cjobs)
    pres = {r["id"]: r for r in run_pyrun(pjobs)} if not skip_diff else {}
    errors = apply_checks(checks, cres, pres, skip_diff)
    if not errors:
        errors += verify_code_tasks(course, skip_diff)
        errors += verify_speed(course, skip_diff)
    if errors:
        print("\n".join("ERROR " + e for e in errors))
        raise SystemExit(f"{len(errors)} problems")
    for L in course["lessons"].values():
        for T in L["tasks"]:
            T.pop("slow", None)
    if check_only:
        print("check passed (nothing written)")
        return
    out_dir = pathlib.Path(out_dir) if out_dir else DIST
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "course.json").write_text(json.dumps(course, ensure_ascii=False))
    ldir = out_dir / "lessons"
    ldir.mkdir(exist_ok=True)
    for old in ldir.glob("*.json"):
        if old.stem not in course["lessons"]:
            old.unlink()
    for lid, L in course["lessons"].items():
        write_atomic(ldir / f"{lid}.json", json.dumps(L, ensure_ascii=False, separators=(",", ":")))
    index = {"units": course["units"], "lessons": {}}
    tpl = (ROOT / "src" / "app" / "index.html").read_text()
    css = (ROOT / "src" / "app" / "app.css").read_text()
    js = (ROOT / "src" / "app" / "app.js").read_text()
    anim = (ROOT / "src" / "app" / "anim.js").read_text()
    course_js = json.dumps(index, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    out = (tpl.replace("/*__CSS__*/", css)
              .replace("/*__PYRUN__*/", bundle.replace("</script", "<\\/script"))
              .replace("/*__ANIM__*/", anim)
              .replace("/*__APP__*/", js)
              .replace("/*__COURSE__*/", "window.COURSE = " + course_js + ";"))
    write_atomic(out_dir / "index.html", out)
    write_web(out_dir, out, ldir)
    size = (out_dir / "index.html").stat().st_size
    lsize = sum(f.stat().st_size for f in ldir.glob("*.json"))
    print(f"wrote {out_dir / 'index.html'} ({size / 1e6:.2f} MB) + {len(course['lessons'])} lesson files ({lsize / 1e6:.2f} MB)")
    if SHORT:
        print(f"note: {len(SHORT)} lessons don't have 30 tasks yet (allowed with --allow-short)")


if __name__ == "__main__":
    args = sys.argv[1:]
    only = None
    if "--only" in args:
        only = args[args.index("--only") + 1].split(",")
    if "--content" in args:
        # build from another content folder (e.g. a scratch copy holding a lesson that is still being written)
        CONTENT = pathlib.Path(args[args.index("--content") + 1]).resolve()
    try:
        out_dir = args[args.index("--out") + 1] if "--out" in args else None
        ALLOW_SHORT = "--allow-short" in args
        build(only=only, skip_diff="--skip-diff" in args, check_only="--check" in args, out_dir=out_dir)
    except BuildError as e:
        raise SystemExit("BUILD ERROR: " + str(e))
