"""Look up LeetCode problems in tools/leetcode.json (number, title, URL slug, difficulty, Premium, topic tags).

The data comes from the doocs/leetcode project's solution/result.json. A task's level on the site must equal the
problem's LeetCode difficulty, and Premium problems can't be used (free users can't open them).

Usage:
  python3 tools/lc.py 1 146 460                       show these problems
  python3 tools/lc.py --tag "Hash Table" --hard       free problems with that tag (also --easy, --medium)
  python3 tools/lc.py --search "anagram"              free problems whose title contains the words
  Add --unused to leave out problems the course already uses.
"""
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
DATA = json.loads((HERE / "leetcode.json").read_text())


def show(n, p):
    tags = ", ".join(p["tags"])
    print(f"{n:>5}  {p['difficulty']:<6}  {'PREMIUM ' if p['paid'] else ''}{p['title']}  |  {p['slug']}  |  {tags}")


def main(args):
    if not args:
        print(__doc__)
        return
    nums = [a for a in args if a.isdigit()]
    for n in nums:
        p = DATA.get(n)
        if p:
            show(int(n), p)
        else:
            print(f"{n}: not a LeetCode problem number")
    if nums:
        return
    tag = args[args.index("--tag") + 1].lower() if "--tag" in args else None
    words = args[args.index("--search") + 1].lower().split() if "--search" in args else []
    levels = [lv for lv in ("Easy", "Medium", "Hard") if "--" + lv.lower() in args]
    used = set()
    if "--unused" in args:
        sys.path.insert(0, str(HERE))
        import lcused
        used = {n for n, _, _ in lcused.used()}
    for n, p in DATA.items():
        if p["paid"] or int(n) in used:
            continue
        if tag and tag not in [t.lower() for t in p["tags"]]:
            continue
        if levels and p["difficulty"] not in levels:
            continue
        if words and not all(w in p["title"].lower() for w in words):
            continue
        show(int(n), p)


if __name__ == "__main__":
    main(sys.argv[1:])
