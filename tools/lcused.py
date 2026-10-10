"""List the LeetCode problems the course already uses, so a new lesson doesn't repeat one.

Usage: python3 tools/lcused.py            every problem in use: number, title, lesson
       python3 tools/lcused.py --dupes    only problems used by more than one task (should print nothing)
       python3 tools/lcused.py --numbers  the numbers only, comma-separated
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def used(content=ROOT / "content"):
    rows = []
    for p in sorted(pathlib.Path(content).rglob("*.lesson")):
        text = p.read_text()
        m = re.search(r"(?m)^id: (\S+)", text)
        lid = m.group(1) if m else p.stem
        for lm in re.finditer(r"(?m)^leetcode: (\d+)\s*\|\s*([^|]+)\|", text):
            rows.append((int(lm.group(1)), lm.group(2).strip(), lid))
    return rows


if __name__ == "__main__":
    rows = used()
    if "--numbers" in sys.argv:
        print(",".join(str(n) for n in sorted({r[0] for r in rows})))
    elif "--dupes" in sys.argv:
        seen = {}
        for n, title, lid in rows:
            seen.setdefault(n, []).append(lid)
        for n, lids in sorted(seen.items()):
            if len(lids) > 1:
                print(f"{n}: used in {', '.join(lids)}")
    else:
        for n, title, lid in sorted(rows):
            print(f"{n:5d}  {title}  ({lid})")
        print(f"{len(rows)} problems")
