"""End-to-end UI test: open the built page in headless Chromium and work through lessons.

For every lesson: open each example (run + edit), play each animation to the end, then for
every task submit a wrong answer (expect "not right" feedback), retry, submit the right answer
(expect a pass). Fails on any page error or console error.

Usage: python3 tools/uitest.py [lesson-id,...] [--dist DIR] [--shots DIR] [--mobile] [--quick]
"""
import json
import pathlib
import sys
import tempfile

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
SKELETON_HEAD = ('<!doctype html><html><head><meta charset="utf-8">'
                 '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
                 '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);'
                 'padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui;background:#fafaf7}'
                 'img{max-width:100%}[hidden]{display:none!important}</style></head><body>')


DIST = ROOT / "dist"


def page_file():
    """Wrap the built page like the artifact host does, and serve the build folder over HTTP
    (lessons are separate files fetched by the page)."""
    import functools
    import http.server
    import threading
    html_text_ = (DIST / "index.html").read_text()
    # Fonts can't load offline; drop the stylesheet links so the test doesn't wait on them.
    html_text_ = "\n".join(l for l in html_text_.split("\n") if "fonts.g" not in l)
    (DIST / "_uitest.html").write_text(SKELETON_HEAD + html_text_ + "</body></html>")

    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass

    handler = functools.partial(Quiet, directory=str(DIST))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{srv.server_address[1]}/_uitest.html"


def html_text(h):
    import html as _h
    import re as _re
    return _h.unescape(_re.sub(r"<[^>]+>", "", h))


class Fail(Exception):
    pass


def main():
    global DIST
    args = sys.argv[1:]
    if "--dist" in args:
        k = args.index("--dist")
        DIST = pathlib.Path(args[k + 1]).resolve()
        del args[k:k + 2]
    shots = None
    if "--shots" in args:
        shots = pathlib.Path(args[args.index("--shots") + 1])
        shots.mkdir(parents=True, exist_ok=True)
    mobile = "--mobile" in args
    quick = "--quick" in args
    only = [a for a in args if not a.startswith("--") and (shots is None or a != str(shots))]
    only = set(",".join(only).split(",")) - {""}
    course = json.loads((DIST / "course.json").read_text())
    f = page_file()
    problems = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context(viewport={"width": 400, "height": 860} if mobile else {"width": 1440, "height": 900},
                                  device_scale_factor=1)
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
        page.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" else None)
        lessons = [lid for u in course["units"] for lid in u["lessons"] if not only or lid in only]
        for lid in lessons:
            L = course["lessons"][lid]
            page.goto("about:blank")
            page.goto(f + "#" + lid)
            page.wait_for_selector(".lesson-pane .prose")
            page.wait_for_selector("h1.title")
            page.wait_for_function("document.querySelector('#load-msg') === null")
            shown = page.locator("h1.title").first.inner_text()
            if shown.strip() != html_text(L["title"]).strip():
                problems.append(f"{lid}: opened the page at #{lid} but it shows '{shown}'")
            if page.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1"):
                problems.append(f"{lid}: page scrolls sideways on the learn view")
            try:
                check_learn(page, L, shots, quick)
                for i, T in enumerate(L["tasks"]):
                    check_task(page, L, i, T, shots, quick)
            except Fail as e:
                problems.append(f"{lid}: {e}")
            except Exception as e:  # noqa
                problems.append(f"{lid}: crashed: {e!r}")
            if errors:
                problems.extend(f"{lid}: {e}" for e in errors)
                errors.clear()
            print(f"{lid}: done", flush=True)
        browser.close()
    if problems:
        print("\n".join("PROBLEM " + p for p in problems))
        raise SystemExit(f"{len(problems)} problems")
    print("UI test passed")


def shot(page, shots, name):
    if shots:
        page.screenshot(path=str(shots / f"{name}.png"), full_page=False)


def click(page, sel):
    page.locator(sel).first.click()


def check_learn(page, L, shots, quick):
    lid = L["id"]
    page.locator('[data-act="step"][data-step="0"]').first.click()
    shot(page, shots, f"{lid}-learn")
    for i, ex in enumerate(L["examples"]):
        click(page, f'[data-act="tab"][data-tab="ex{i}"]')
        click(page, '[data-act="exrun"]')
        out = page.locator(".results .console").first.inner_text()
        if (ex.get("output") or "").strip() and out.strip() != ex["output"].strip():
            raise Fail(f"example {i + 1}: live run printed {out!r}, expected {ex['output']!r}")
        if i == 0:
            shot(page, shots, f"{lid}-example{i + 1}")
        click(page, '[data-act="exedit"]')
        page.wait_for_selector("#ex-editor")
        click(page, '[data-act="exreset"]')
    for i, an in enumerate(L["anims"]):
        click(page, f'[data-act="tab"][data-tab="an{i}"]')
        page.wait_for_selector("#anim-player .caption")
        n = len(an["frames"])
        steps = n - 1 if not quick else min(n - 1, 3)
        for k in range(steps):
            click(page, '[data-act="anim-next"]')
            if shots and k == min(4, steps - 1):
                shot(page, shots, f"{lid}-anim{i + 1}")
        pos = page.locator("#anim-player .pos").inner_text()
        if not quick and pos != f"step {n} of {n}":
            raise Fail(f"animation {i + 1}: ended at '{pos}'")
        if page.locator("#anim-player .emptyv:has-text('could not draw')").count():
            raise Fail(f"animation {i + 1}: a view could not be drawn")


def verdict(page):
    page.wait_for_selector(".verdict-row .pill", timeout=8000)
    pill = page.locator(".verdict-row .pill").first
    cls = pill.get_attribute("class") or ""
    return ("ok" in cls.split()), pill.inner_text().strip()


def go_task(page, i):
    page.locator(f'[data-act="step"][data-step="{i + 1}"]').first.click()
    page.wait_for_selector(".label.task")


def set_editor(page, code):
    page.evaluate("""(code) => { const ta = document.getElementById('task-editor'); ta.value = code; ta.dispatchEvent(new Event('input', {bubbles: true})); }""", code)


def check_task(page, L, i, T, shots, quick):
    lid = L["id"]
    go_task(page, i)
    ty = T["type"]
    if T.get("patterns") and L.get("patterns"):
        if not page.locator('[data-act="show-pat"]').count():
            raise Fail(f"task {i + 1}: no 'Show the pattern' button")
        click(page, '[data-act="show-pat"]')
        n = page.locator(".hintbox .patrow .pat").count()
        if n != len(T["patterns"]):
            raise Fail(f"task {i + 1}: showed {n} patterns, expected {len(T['patterns'])}")
    # ---- wrong answer first (feedback must say not right) ----
    wrong_done = False
    if ty == "mcq":
        wi = next(k for k, o in enumerate(T["options"]) if not o["ok"])
        click(page, f'[data-act="pick"][data-i="{wi}"]')
        wrong_done = True
    elif ty == "multi":
        wi = next((k for k, o in enumerate(T["options"]) if not o["ok"]), None)
        if wi is not None:
            click(page, f'[data-act="pick"][data-i="{wi}"]')
            wrong_done = True
    elif ty == "predict":
        page.fill("#predict-in", "something else entirely")
        wrong_done = True
    elif ty == "fill":
        for k in range(len(T["answers"])):
            page.locator(f'input.blank[data-blank="{k}"]').fill("zz_wrong_zz")
        wrong_done = True
    elif ty == "code":
        set_editor(page, T.get("starter") or "pass")
        wrong_done = bool((T.get("starter") or "").strip()) or T["mode"] == "tests"
    elif ty == "cells":
        for k in range(len(T["answer"])):
            page.fill(f"#cell-{k}", "zz")
        wrong_done = True
    if wrong_done:
        click(page, '[data-act="submit"]')
        ok, text = verdict(page)
        if ok:
            raise Fail(f"task {i + 1} ({ty}): a wrong answer was marked right ({text})")
        if not page.locator(".why .prose").first.inner_text().strip():
            raise Fail(f"task {i + 1}: no feedback text for a wrong answer")
        if i == 0 or ty == "code":
            shot(page, shots, f"{lid}-t{i + 1}-wrong")
        click(page, '[data-act="retry"]')
    # ---- right answer ----
    if ty == "mcq":
        ci = next(k for k, o in enumerate(T["options"]) if o["ok"])
        click(page, f'[data-act="pick"][data-i="{ci}"]')
    elif ty == "multi":
        for k, o in enumerate(T["options"]):
            picked = page.locator(f'[data-act="pick"][data-i="{k}"]').get_attribute("aria-pressed") == "true"
            if o["ok"] != picked:
                click(page, f'[data-act="pick"][data-i="{k}"]')
    elif ty == "predict":
        page.fill("#predict-in", T["expected"])
    elif ty == "fill":
        for k, a in enumerate(T["answers"]):
            page.locator(f'input.blank[data-blank="{k}"]').fill(a)
    elif ty == "parsons":
        for k, ln in enumerate(T["lines"]):
            click(page, f'[data-act="pz-add"][data-idx="{k}"]')
            # fix indentation of line k
            cur = page.locator(".pz-line .code").nth(k).get_attribute("style") or ""
            have = int(cur.split("padding-left:")[1].split("ch")[0]) // 4 if "padding-left:" in cur else 0
            while have < ln["indent"]:
                click(page, f'[data-act="pz"][data-op="in"][data-k="{k}"]')
                have += 1
            while have > ln["indent"]:
                click(page, f'[data-act="pz"][data-op="out"][data-k="{k}"]')
                have -= 1
    elif ty == "code":
        set_editor(page, T["solution"])
    elif ty == "cells":
        for k, a in enumerate(T["answer"]):
            page.fill(f"#cell-{k}", a)
    elif ty == "order":
        order = list(T["shuffled"])
        for k in range(len(order)):
            pos = order.index(k)
            while pos > k:
                click(page, f'[data-act="ord"][data-op="up"][data-k="{pos}"]')
                order[pos - 1], order[pos] = order[pos], order[pos - 1]
                pos -= 1
    click(page, '[data-act="submit"]')
    ok, text = verdict(page)
    if not ok:
        detail = page.locator(".why").first.inner_text()[:600] if page.locator(".why").count() else ""
        raise Fail(f"task {i + 1} ({ty}): the right answer was not accepted: {text}\n{detail}")
    if ty == "code" and T.get("followup"):
        check_followup(page, T, i, shots, lid)
    if T.get("patterns") and L.get("patterns") and not page.locator(".why.good .patrow.solved .pat").count():
        raise Fail(f"task {i + 1}: the solved panel doesn't show the patterns")
    if i in (0, 9) or ty in ("code", "parsons", "cells", "order"):
        shot(page, shots, f"{lid}-t{i + 1}-right")
    if page.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1"):
        raise Fail(f"task {i + 1}: page scrolls sideways")


def check_followup(page, T, i, shots, lid):
    """Part 2 of a code task: a wrong attempt must be refused, then the right edge cases and complexity accepted."""
    fu = T["followup"]
    if not page.locator(".why.fu").count():
        raise Fail(f"task {i + 1}: the tests pass but the follow-up didn't open")
    if page.locator('[data-act="next"]').count():
        raise Fail(f"task {i + 1}: 'Next task' is offered before the follow-up is done")
    # wrong: a right edge case with a wrong expected value, and a wrong time complexity
    if fu.get("edges"):
        for k in range(fu["count"]):
            page.locator(f'input[data-fu-row="{k}"][data-fu-key="call"]').fill(fu["edges"][k]["example"])
            page.locator(f'input[data-fu-row="{k}"][data-fu-key="exp"]').fill('"zz_wrong_zz"')
    if fu.get("time"):
        wrong = next(o for o in fu["options"] if o != fu["time"])
        page.select_option('select[data-fu-key="time"]', wrong)
        page.select_option('select[data-fu-key="space"]', fu["space"])
    click(page, '[data-act="fu-check"]')
    if not page.locator(".why.fu").count() or page.locator('[data-act="next"]').count():
        raise Fail(f"task {i + 1}: a wrong follow-up was accepted")
    if not page.locator(".fu-msg.badt").count():
        raise Fail(f"task {i + 1}: a wrong follow-up got no explanation")
    shot(page, shots, f"{lid}-t{i + 1}-followup-wrong")
    # right
    if fu.get("edges"):
        for k in range(fu["count"]):
            page.locator(f'input[data-fu-row="{k}"][data-fu-key="exp"]').fill(fu["edges"][k]["expect"])
    if fu.get("time"):
        page.select_option('select[data-fu-key="time"]', fu["time"])
    click(page, '[data-act="fu-check"]')
    if not page.locator('.why.good [data-act="next"]').count():
        detail = page.locator(".why").first.inner_text()[:600] if page.locator(".why").count() else ""
        raise Fail(f"task {i + 1}: the right follow-up was not accepted\n{detail}")


if __name__ == "__main__":
    main()
