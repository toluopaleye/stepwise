"""Open a lesson's learn view and report code blocks / tables that overflow sideways.

Usage: python3 tools/learn_overflow.py <lesson-id> <dist dir> [shots dir]

A learn step whose code or table is wider than the learn pane makes the reader scroll sideways; at width 1440
there should be none. (At phone width, code blocks scroll sideways by design.)
"""
import pathlib
import sys

sys.path.insert(0, "/home/claude/stepwise/tools")
import uitest  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

lid = sys.argv[1]
uitest.DIST = pathlib.Path(sys.argv[2]).resolve()
shots = pathlib.Path(sys.argv[3]) if len(sys.argv) > 3 else None
if shots:
    shots.mkdir(parents=True, exist_ok=True)
url = uitest.page_file()
with sync_playwright() as pw:
    b = pw.chromium.launch()
    for width in (1440, 400):
        ctx = b.new_context(viewport={"width": width, "height": 900}, device_scale_factor=1)
        page = ctx.new_page()
        page.goto(url + "#" + lid)
        page.wait_for_selector(".lesson-pane .prose")
        page.wait_for_function("document.querySelector('#load-msg') === null")
        info = page.evaluate("""() => {
            const out = [];
            document.querySelectorAll('.lesson-pane pre, .lesson-pane table').forEach((el, i) => {
                if (el.scrollWidth > el.clientWidth + 1) {
                    out.push({i, tag: el.tagName, sw: el.scrollWidth, cw: el.clientWidth,
                              text: el.innerText.split('\\n').sort((a, b) => b.length - a.length)[0]});
                }
            });
            return out;
        }""")
        print(f"width {width}: {len(info)} overflowing blocks")
        for x in info:
            print(f"  #{x['i']} {x['tag']} {x['sw']} > {x['cw']}: longest line {x['text']!r}")
        if shots:
            els = page.locator('.lesson-pane pre, .lesson-pane table')
            for x in info:
                els.nth(x['i']).scroll_into_view_if_needed()
                els.nth(x['i']).screenshot(path=str(shots / f"{lid}-w{width}-block{x['i']}.png"))
        ctx.close()
    b.close()
