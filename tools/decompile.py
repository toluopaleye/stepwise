"""Recover a .lesson source from a compiled lesson JSON (used once, after the workspace was wiped).

python3 tools/decompile.py lessons/py-math.json > content/u1/05-math.lesson

The result compiles back to the same JSON (check with build.py). Animation captions that change from step to
step are rebuilt as templates: simple {expr} placeholders where they can be inferred, otherwise a list indexed
by the program's state.
"""
import copy
import html
import itertools
import json
import re
import sys
import types
from html.parser import HTMLParser


# ---------------------------------------------------------------- html -> markdown
class Node:
    def __init__(self, tag, attrs):
        self.tag, self.attrs, self.kids = tag, dict(attrs), []


class TreeBuilder(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.root = Node(None, {})
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        n = Node(tag, attrs)
        self.stack[-1].kids.append(n)
        self.stack.append(n)

    def handle_endtag(self, tag):
        while len(self.stack) > 1:
            n = self.stack.pop()
            if n.tag == tag:
                break

    def handle_data(self, data):
        self.stack[-1].kids.append(data)

    def handle_entityref(self, name):
        self.stack[-1].kids.append(f"&{name};")

    def handle_charref(self, name):
        self.stack[-1].kids.append(f"&#{name};")


def parse(h):
    tb = TreeBuilder()
    tb.feed(h)
    tb.close()
    return tb.root


def raw_text(n):
    if isinstance(n, str):
        return html.unescape(n)
    return "".join(raw_text(k) for k in n.kids)


def inline(n):
    out = []
    for k in n.kids:
        if isinstance(k, str):
            out.append(html.unescape(k))
        elif k.tag == "code":
            out.append("`" + raw_text(k) + "`")
        elif k.tag == "strong":
            out.append("**" + inline(k) + "**")
        elif k.tag == "em":
            out.append("*" + inline(k) + "*")
        elif k.tag == "a":
            out.append("[" + inline(k) + "](" + k.attrs.get("href", "") + ")")
        else:
            raise ValueError(f"unexpected inline tag {k.tag}")
    return "".join(out)


def inline_html_to_md(h):
    return inline(parse(h))


def blocks(n):
    """Block-level nodes -> list of markdown blocks (each a list of lines)."""
    res = []
    for k in n.kids:
        if isinstance(k, str):
            if k.strip():
                raise ValueError(f"stray text {k!r}")
            continue
        if k.tag == "p":
            res.append([inline(k)])
        elif k.tag == "pre":
            lang = html.unescape(k.attrs.get("data-lang", "python"))
            res.append(["```" + lang] + raw_text(k).split("\n") + ["```"])
        elif k.tag == "table":
            rows = []
            for sec in k.kids:
                if isinstance(sec, str):
                    continue
                for tr in sec.kids:
                    if isinstance(tr, str):
                        continue
                    rows.append([inline(td) for td in tr.kids if not isinstance(td, str)])
            lines = ["| " + " | ".join(rows[0]) + " |", "| " + " | ".join("---" for _ in rows[0]) + " |"]
            lines += ["| " + " | ".join(r) + " |" for r in rows[1:]]
            res.append(lines)
        elif k.tag == "div" and "callout" in k.attrs.get("class", ""):
            inner = blocks(k)
            lines = []
            for bi, b in enumerate(inner):
                if bi:
                    lines.append(">")
                lines += ["> " + ln if ln else ">" for ln in b]
            res.append(lines)
        elif k.tag in ("ul", "ol"):
            lines = []
            num = 1
            for li in k.kids:
                if isinstance(li, str):
                    continue
                lines.append(("- " if k.tag == "ul" else f"{num}. ") + inline(li))
                num += 1
            res.append(lines)
        else:
            raise ValueError(f"unexpected block tag {k.tag}")
    return res


def md_html_to_lines(h):
    """Markdown source lines for md(h); blocks separated by blank lines."""
    bl = blocks(parse(h))
    lines = []
    for i, b in enumerate(bl):
        if i:
            lines.append("")
        lines += b
    return lines


def field(name, h, arg=None):
    """A text field whose value went through md()."""
    lines = md_html_to_lines(h)
    key = f"{name}[{arg}]" if arg is not None else name
    if not lines:
        return [f"{key}: "]
    if lines[0].startswith("```"):
        return [f"{key}:"] + lines
    return [f"{key}: {lines[0]}"] + lines[1:]


def fence(code, lang="python"):
    return ["```" + lang] + code.split("\n") + ["```"]


# ---------------------------------------------------------------- caption templates
def trace_namespaces(src):
    """Run src and record (line, namespace copy) for every 'line' event, like cpy_runner's tracer."""
    import builtins
    import contextlib
    import io
    events = []
    code = compile(src, "<anim>", "exec")

    def tracer(frame, event, arg):
        if frame.f_code.co_filename != "<anim>":
            return None
        if event == "line":
            ns = {}
            g = frame.f_globals
            loc = frame.f_locals
            for d in (g, loc):
                for k, v in d.items():
                    if k.startswith("__") or isinstance(v, types.ModuleType):
                        continue
                    try:
                        ns[k] = copy.deepcopy(v)
                    except Exception:
                        ns[k] = v
            gc = {}
            for k2, v2 in g.items():
                try:
                    gc[k2] = copy.deepcopy(v2) if not isinstance(v2, types.ModuleType) else v2
                except Exception:
                    gc[k2] = v2
            lc = {}
            for k2, v2 in loc.items():
                try:
                    lc[k2] = copy.deepcopy(v2) if not isinstance(v2, types.ModuleType) else v2
                except Exception:
                    lc[k2] = v2
            if loc is g:
                lc = gc
            events.append((frame.f_lineno, ns, gc, lc))
        return tracer

    out = io.StringIO()
    sys.settrace(tracer)
    try:
        with contextlib.redirect_stdout(out):
            exec(code, {"__name__": "__main__"})
    except BaseException:
        pass
    finally:
        sys.settrace(None)
    return events


def fill_caption(tpl, g, loc):
    out = []
    i = 0
    while i < len(tpl):
        c = tpl[i]
        if c == "{":
            j = tpl.find("}", i)
            if j < 0:
                out.append(tpl[i:])
                break
            expr = tpl[i + 1:j]
            conv = None
            if expr.endswith("!r"):
                expr, conv = expr[:-2], "r"
            try:
                val = eval(expr, g, loc)
                out.append(repr(val) if conv == "r" else str(val))
            except Exception:  # noqa
                out.append("{" + tpl[i + 1:j] + "}")
            i = j + 1
        else:
            out.append(c)
            i += 1
    return "".join(out)


def simple(v):
    return isinstance(v, (int, float, str, bool, type(None))) or (
        isinstance(v, (list, tuple)) and len(v) <= 12 and all(isinstance(x, (int, str, bool, float, type(None))) for x in v))


def candidates(nss, consts):
    """Candidate expressions -> per-visit string values (str and repr forms)."""
    names = sorted(set.intersection(*[set(ns) for ns in nss])) if nss else []
    exprs = []
    for a in names:
        exprs.append(a)
    for a in names:
        if all(isinstance(ns[a], (list, tuple, str, dict, set)) for ns in nss):
            exprs.append(f"len({a})")
    ints = [a for a in names if all(isinstance(ns[a], int) and not isinstance(ns[a], bool) for ns in nss)]
    small = sorted({c for c in consts if isinstance(c, int) and not isinstance(c, bool) and abs(c) < 10000} | {1, 2})
    for a in ints:
        for op in ("+", "-", "*", "//", "%"):
            for c in small:
                if op in ("//", "%") and c == 0:
                    continue
                exprs.append(f"{a} {op} {c}")
            for b in ints:
                if b != a:
                    exprs.append(f"{a} {op} {b}")
        for op in (">=", "<=", ">", "<", "==", "!="):
            for c in small:
                exprs.append(f"{a} {op} {c}")
    for a in names:
        for b in names:
            if a == b:
                continue
            if all(isinstance(ns[b], (list, tuple, str, dict, set, frozenset)) for ns in nss):
                exprs.append(f"{a} in {b}")
                exprs.append(f"{a} not in {b}")
            if all(isinstance(ns[b], dict) for ns in nss):
                exprs.append(f"{b}.get({a}, 0)")
                exprs.append(f"{b}.get({a}, 0) + 1")
                exprs.append(f"{b}[{a}]")
                exprs.append(f"{b}[{a}] + 1")
            if all(isinstance(ns[b], (list, tuple, str)) for ns in nss) and a in ints:
                exprs.append(f"{b}[{a}]")
    for a in names:
        for c in small:
            if a in ints:
                continue
    res = []
    for e in exprs:
        vals_s, vals_r = [], []
        ok = True
        for ns in nss:
            try:
                v = eval(e, {"__builtins__": __builtins__}, dict(ns))
            except Exception:
                ok = False
                break
            vals_s.append(str(v))
            vals_r.append(repr(v))
        if ok:
            res.append((e, vals_s))
            if vals_r != vals_s:
                res.append((e + "!r", vals_r))
    return res


def escape_literal(text):
    return text.replace("{", "{'{'}")


def infer_template(caps, nss, consts):
    """Find a template with {expr} placeholders that yields caps[i] in namespace nss[i]."""
    cands = candidates(nss, consts)
    k = len(caps)

    memo = {}

    def solve(pos, depth):
        key = tuple(pos)
        if key in memo:
            return memo[key]
        memo[key] = None
        res = solve0(pos, depth)
        memo[key] = res
        return res

    def solve0(pos, depth):
        if depth > 12:
            return None
        if all(pos[i] == len(caps[i]) for i in range(k)):
            return ""
        # literal run while all agree
        lit = ""
        p = list(pos)
        while all(p[i] < len(caps[i]) for i in range(k)) and len({caps[i][p[i]] for i in range(k)}) == 1:
            lit += caps[0][p[0]]
            p = [x + 1 for x in p]
        if all(p[i] == len(caps[i]) for i in range(k)):
            return escape_literal(lit)
        # back up to the start of the last word so a placeholder can cover it
        cut = len(lit)
        while cut > 0 and (lit[cut - 1].isalnum() or lit[cut - 1] in "'\"-._[]()"):
            cut -= 1
        for back in sorted({cut, len(lit)}, reverse=True):
            q = [pos[i] + back for i in range(k)]
            for e, vals in cands:
                if all(vals[i] and caps[i].startswith(vals[i], q[i]) for i in range(k)):
                    rest = solve([q[i] + len(vals[i]) for i in range(k)], depth + 1)
                    if rest is not None:
                        return escape_literal(lit[:back]) + "{" + e + "}" + rest
        return None

    return solve([0] * k, 0)


def pylit(s):
    parts = re.split(r"([{}])", s)
    out = []
    for p in parts:
        if p == "{":
            out.append("chr(123)")
        elif p == "}":
            out.append("chr(125)")
        elif p:
            out.append(repr(p))
    return " + ".join(out) if out else "''"


def index_template(caps, glob_locs):
    """Fallback: pick the caption from a list, indexed by the program state at that moment."""
    distinct = []
    for c in caps:
        if c not in distinct:
            distinct.append(c)
    import builtins
    names = sorted(set().union(*[set(loc) | set(g) for g, loc in glob_locs]))
    names = [n for n in names if not n.startswith("__") and n not in dir(builtins)]

    def value(g, loc, n):
        if n in loc:
            return loc[n]
        return g.get(n)

    usable = []
    for n in names:
        vals = [value(g, loc, n) for g, loc in glob_locs]
        if all(simple(v) for v in vals) and not any("{" in repr(v) or "}" in repr(v) for v in vals):
            usable.append(n)
    for size in range(1, 4):
        for combo in itertools.combinations(usable, size):
            keys = [tuple(value(g, loc, n) for n in combo) for g, loc in glob_locs]
            mapping = {}
            ok = True
            for key, cap in zip(keys, caps):
                r = repr(key)
                if r in mapping and mapping[r] != cap:
                    ok = False
                    break
                mapping[r] = cap
            if not ok:
                continue
            uniq = []
            for key in keys:
                if key not in uniq:
                    uniq.append(key)
            key_expr = "(" + "".join(f"locals().get({n!r}), " for n in combo) + ")"
            caps_list = [mapping[repr(kk)] for kk in uniq]
            expr = f"[{', '.join(pylit(c) for c in caps_list)}][{repr(uniq)}.index({key_expr})]"
            if "}" in expr:
                continue
            return "{" + expr + "}"
    return None


def caption_templates(anim):
    frames = anim["frames"]
    events = trace_namespaces(anim["code"])
    # cap frames are 'line' events in order; match them to our events by position among line events
    line_frames = [fr for fr in frames if fr.get("ev") == "line"]
    if len(events) < len(line_frames):
        raise ValueError(f"trace mismatch for {anim['title']}: {len(events)} events vs {len(line_frames)} frames")
    by_line = {}
    for fr, ev in zip(line_frames, events):
        if fr["l"] != ev[0]:
            raise ValueError(f"line mismatch in {anim['title']}: {fr['l']} vs {ev[0]}")
        by_line.setdefault(fr["l"], []).append((fr.get("cap"), ev))
    consts = set()
    for m in re.finditer(r"(?<![\w.])-?\d+(?![\w.])", anim["code"]):
        consts.add(int(m.group(0)))
    templates = {}
    for line, visits in sorted(by_line.items()):
        caps = [c for c, _ in visits]
        if all(c is None for c in caps):
            continue
        if any(c is None for c in caps):
            raise ValueError(f"{anim['title']} line {line}: caption missing on some visits")
        tpl = None
        if len(set(caps)) == 1 and "{" not in caps[0]:
            tpl = caps[0]
        else:
            nss = [ev[1] for _, ev in visits]
            tpl = infer_template(caps, nss, consts)
            if tpl is None and len(set(caps)) == 1:
                tpl = escape_literal(caps[0])
            if tpl is None:
                tpl = index_template(caps, [(ev[2], ev[3]) for _, ev in visits])
        if tpl is None:
            raise ValueError(f"{anim['title']} line {line}: no template found for {caps}")
        # verify against the real frames
        for cap, ev in visits:
            got = fill_caption(tpl, ev[2], ev[3])
            if got != cap:
                raise ValueError(f"{anim['title']} line {line}: template {tpl!r} gives {got!r}, want {cap!r}")
        templates[line] = tpl
    return templates


def infer_show(anim):
    names = set()
    for fr in anim["frames"]:
        for st in fr.get("st", []):
            names |= set(st.get("vars", {}))
    import builtins
    allnames = set()
    for ev in trace_namespaces(anim["code"]):
        for k, v in list(ev[2].items()) + list(ev[3].items()):
            if k.startswith("__") or isinstance(v, types.ModuleType) or k in dir(builtins):
                continue
            allnames.add(k)
    return None if names >= allnames else names


# ---------------------------------------------------------------- lesson
def view_spec(v):
    parts = [v["type"]] + list(v.get("vars", []))
    for k, val in v.items():
        if k in ("type", "vars"):
            continue
        parts.append(f"{k}={val}")
    return " ".join(parts)


DEFAULT_PREDICT_PROMPT = "<p>What does this code print? Type the output exactly, one line per line of output.</p>"


def task_lines(T):
    out = [f"=== task: {T['type']} {T['diff']}", "title: " + inline_html_to_md(T["title"])]
    ty = T["type"]
    if T.get("prompt") and not (ty == "predict" and T["prompt"] == DEFAULT_PREDICT_PROMPT):
        out += field("prompt", T["prompt"])
    if T.get("code") is not None:
        out += ["code:"] + fence(T["code"])
    if ty in ("mcq", "multi"):
        for o in T["options"]:
            out.append(("* " if o["ok"] else "- ") + inline_html_to_md(o["html"]) + " :: " + inline_html_to_md(o["fb"]))
    if ty == "fill":
        out.append("answer: " + " | ".join(T["answers"]))
        if T.get("after"):
            out += ["after:"] + fence(T["after"])
    if ty == "parsons":
        out += ["lines:"] + fence("\n".join("    " * ln["indent"] + ln["text"] for ln in T["lines"]))
        if T.get("distractors"):
            out += ["distractors:"] + fence("\n".join(d["text"] for d in T["distractors"]))
        if T.get("after"):
            out += ["after:"] + fence(T["after"])
    if ty == "code":
        if T.get("starter"):
            out += ["starter:"] + fence(T["starter"])
        out += ["solution:"] + fence(T["solution"])
        if T.get("mode") == "stdout":
            out.append("tests: stdout")
        else:
            out.append("tests:")
            out += ["- " + t["code"] for t in T["tests"]]
            if T.get("cases"):
                out.append("cases:")
                out += ["- " + c["setup"].replace("\n", "\\n") for c in T["cases"]]
        for k, v in T.get("fails", {}).items():
            out += field("fail", v, k)
        for k, v in T.get("errors", {}).items():
            out += field("error", v, k)
        for r in T.get("require", []):
            out += field("require", r["html"], r["pat"])
        for r in T.get("forbid", []):
            out += field("forbid", r["html"], r["pat"])
        if T.get("speed"):
            sp = T["speed"]
            s = f"speed: setup={sp['setup']} | call={sp['call']} | target={sp['target']}"
            if sp["sizes"] != [500, 1000, 2000, 4000, 8000]:
                s += " | sizes=" + ",".join(str(x) for x in sp["sizes"])
            if sp["maxSteps"] != 3000000:
                s += f" | max={sp['maxSteps']}"
            out.append(s)
    if ty == "cells":
        if T.get("labels"):
            out.append("labels: " + " | ".join(T["labels"]))
        if T.get("start"):
            out.append("start: " + " | ".join(T["start"]))
        out.append("answer: " + " | ".join(T["answer"]))
    if ty == "order":
        out.append("items:")
        out += ["- " + inline_html_to_md(x) for x in T["items"]]
    if ty in ("predict", "fill", "cells"):
        for k, v in T.get("wrongs", {}).items():
            out += field("wrong", v, k.replace("\n", "\\n") if ty == "predict" else k)
    for h in T["hints"]:
        out += field("hint", h)
    if T.get("right"):
        out += field("right", T["right"])
    if T.get("wrong"):
        out += field("wrong", T["wrong"])
    return out


def lesson_text(L):
    out = ["=== lesson", f"id: {L['id']}", f"title: {L['title']}", "summary: " + inline_html_to_md(L["summary"]), "", "=== learn"]
    for st in L["learn"]:
        if st["h"] is not None:
            out.append("### " + st["h"])
        out += md_html_to_lines(st["html"])
        out.append("")
    out.append("=== keypoints")
    out += ["- " + inline_html_to_md(k) for k in L["keypoints"]]
    out.append("")
    for ex in L["examples"]:
        out.append("=== example: " + ex["title"])
        intro = inline_html_to_md(ex["intro"])
        if intro:
            out.append("intro: " + intro)
        out += fence(ex["code"])
        for nt in ex["notes"]:
            rng = f"{nt['from']}" if nt["from"] == nt["to"] else f"{nt['from']}-{nt['to']}"
            out.append(f"{rng}: " + inline_html_to_md(nt["html"]))
        out.append("")
    for an in L["anims"]:
        out.append("=== animation: " + an["title"])
        out.append("view: " + view_spec(an["views"][0]))
        out += [view_spec(v) for v in an["views"][1:]]
        intro = inline_html_to_md(an["intro"])
        if intro:
            out.append("intro: " + intro)
        show = an.get("_show")
        if show:
            out.append("show: " + " ".join(show))
        out += fence(an["code"])
        for line, tpl in sorted(an.get("_captions", {}).items()):
            out.append(f"{line}: {tpl}")
        out.append("")
    for T in L["tasks"]:
        out += task_lines(T)
        out.append("")
    return "\n".join(out).rstrip("\n") + "\n"


def main():
    L = json.load(open(sys.argv[1]))
    for an in L["anims"]:
        if an["views"][0]["type"] == "chart":
            raise SystemExit("chart animations not supported")
        an["_captions"] = caption_templates(an)
        sh = infer_show(an)
        an["_show"] = sorted(sh) if sh is not None else None
    sys.stdout.write(lesson_text(L))


if __name__ == "__main__":
    main()
