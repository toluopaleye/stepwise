"""Render sample animations for every view type into one page and screenshot it (visual check of anim.js)."""
import json
import pathlib
import subprocess
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import build  # noqa: E402

SAMPLES = [
    ("vars", ["vars"], "price = 4\nqty = 3\ntotal = price * qty\ntotal += 1\nname = 'Ada'\nitems = [1, 2]\nprint(total)"),
    ("array", ["array nums ptr=i range=lo:hi hit=mid"], "nums = [2, 5, 8, 12, 16, 23, 38]\nlo, hi = 0, 6\nmid = 3\ni = 2\nlo = 4\nmid = 5\nprint(nums[mid])"),
    ("bars", ["bars nums ptr=j,i done=len-1:"], "nums = [5, 1, 4, 2, 8]\ni = 0\nj = 1\nnums[0], nums[1] = nums[1], nums[0]\nprint(nums)"),
    ("grid", ["grid dp row=r col=c"], "dp = [[0] * 4 for _ in range(3)]\nfor r in range(3):\n    for c in range(4):\n        dp[r][c] = r * c\nprint(dp)"),
    ("stack+queue", ["stack s", "queue q"], "from collections import deque\ns = []\nq = deque()\nfor x in [1, 2, 3]:\n    s.append(x)\n    q.append(x)\ns.pop()\nq.popleft()\nprint(s, list(q))"),
    ("dict+set", ["dict counts hit=w", "set seen"], "counts = {}\nseen = set()\nfor w in ['a', 'b', 'a', 'c']:\n    counts[w] = counts.get(w, 0) + 1\n    seen.add(len(w) * 3)\nprint(counts)"),
    ("buckets", ["buckets table hit=i"], "table = [[] for _ in range(5)]\nfor key in [12, 7, 22, 3]:\n    i = key % 5\n    table[i].append(key)\nprint(table)"),
    ("linked", ["linked head ptr=cur,prev"], "class Node:\n    def __init__(self, val, next=None):\n        self.val = val\n        self.next = next\nhead = Node(1, Node(2, Node(3)))\nprev = None\ncur = head\nwhile cur:\n    nxt = cur.next\n    cur.next = prev\n    prev = cur\n    cur = nxt\nhead = prev\nprint(head.val)"),
    ("tree", ["tree root ptr=node visited=order"], "class Node:\n    def __init__(self, val, left=None, right=None):\n        self.val = val\n        self.left = left\n        self.right = right\nroot = Node(8, Node(3, Node(1), Node(6)), Node(10, None, Node(14)))\norder = []\ndef visit(node):\n    if node is None:\n        return\n    visit(node.left)\n    order.append(node.val)\n    visit(node.right)\nvisit(root)\nprint(order)"),
    ("heap", ["heap h ptr=i"], "import heapq\nh = []\nfor x in [5, 3, 8, 1, 9, 2]:\n    heapq.heappush(h, x)\ni = 0\nprint(h)"),
    ("graph", ["graph g pos=A:60,50;B:200,50;C:60,170;D:200,170;E:330,110 visited=seen frontier=queue current=node"], "from collections import deque\ng = {'A': ['B', 'C'], 'B': ['A', 'D'], 'C': ['A', 'D'], 'D': ['B', 'C', 'E'], 'E': ['D']}\nseen = {'A'}\nqueue = deque(['A'])\nwhile queue:\n    node = queue.popleft()\n    for nb in g[node]:\n        if nb not in seen:\n            seen.add(nb)\n            queue.append(nb)\nprint(sorted(seen))"),
    ("graph-dist", ["graph g pos=A:60,60;B:220,60;C:140,180 dist=dist current=u directed=1"], "import heapq\ng = {'A': [('B', 4), ('C', 1)], 'B': [], 'C': [('B', 2)]}\ndist = {'A': 0, 'B': float('inf'), 'C': float('inf')}\npq = [(0, 'A')]\nwhile pq:\n    d, u = heapq.heappop(pq)\n    for v, w in g[u]:\n        if d + w < dist[v]:\n            dist[v] = d + w\n            heapq.heappush(pq, (dist[v], v))\nprint(dist)"),
    ("callstack", ["callstack"], "def fact(n):\n    if n <= 1:\n        return 1\n    return n * fact(n - 1)\nprint(fact(4))"),
    ("steps", ["steps steps label=steps_so_far", "vars n i"], "n = 4\nsteps = 0\nfor i in range(n):\n    steps += 1\nprint(steps)"),
]
CHART = {"views": [{"type": "chart", "fns": "1,log2(n),n,n*log2(n),n**2", "labels": "O(1),O(log n),O(n),O(n log n),O(n²)", "n": "1..64", "scale": "log"}],
         "captions": {"1": "At n = {n}, O(n²) takes {O(n²)} steps."}}


def main():
    out_dir = pathlib.Path(sys.argv[1])
    out_dir.mkdir(parents=True, exist_ok=True)
    jobs = [{"kind": "trace", "src": code, "captions": {}, "show": [], "max": 400} for _, _, code in SAMPLES]
    res = build.run_cpython(jobs)
    anims = []
    for (name, views, code), r in zip(SAMPLES, res):
        if r.get("error"):
            print(name, "ERROR", r["error"])
        anims.append({"name": name, "code": code, "views": [build.parse_view(v, name) for v in views], "frames": r["frames"]})
    ch = {"views": [dict(CHART["views"][0])], "captions": CHART["captions"]}
    ch["views"][0]["labels"] = ch["views"][0]["labels"]
    frames = build.chart_frames({"views": ch["views"], "captions": ch["captions"]})
    anims.append({"name": "chart", "code": "", "views": ch["views"], "frames": frames})
    css = (ROOT / "src/app/app.css").read_text()
    anim_js = (ROOT / "src/app/anim.js").read_text()
    html = f"""<!doctype html><html><head><meta charset="utf-8"><style>{css}
body{{overflow:auto!important;height:auto!important}} html{{overflow:auto!important;height:auto!important}}
.samp{{border:1px solid #333;margin:16px;padding:12px;border-radius:10px;background:var(--bg)}}
.samp h2{{font:600 14px var(--mono);color:var(--accent);margin:0 0 8px}}
.row{{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}}
.row > div{{min-width:0;overflow:auto}}
</style></head><body><div id="root"></div>
<script>{anim_js}</script>
<script>
const A = {json.dumps(anims)};
const root = document.getElementById('root');
for (const a of A) {{
  const n = a.frames.length;
  const picks = [0, Math.floor(n / 2), n - 1];
  root.insertAdjacentHTML('beforeend', `<section class="samp"><h2>${{a.name}} · ${{n}} frames</h2><div class="row">${{picks.map(fi => `<div><div style="color:#9AA3B2;font-size:12px">frame ${{fi + 1}} · line ${{a.frames[fi].l}}</div><div class="views">${{window.AnimViews.renderViews(a, fi)}}</div></div>`).join('')}}</div></section>`);
}}
</script></body></html>"""
    page_path = out_dir / "views.html"
    page_path.write_text(html)
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        pg = b.new_page(viewport={"width": 1500, "height": 900})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(page_path.as_uri())
        for i, sec in enumerate(pg.locator("section.samp").all()):
            sec.screenshot(path=str(out_dir / f"view-{i:02d}.png"))
        b.close()
        print("page errors:", errs)
    print("wrote", out_dir)


if __name__ == "__main__":
    main()
