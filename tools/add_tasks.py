"""Merge new tasks into a lesson, keeping the required order (all easy, then medium, then hard).

python3 tools/add_tasks.py content/u1/05-math.lesson new_tasks.txt

new_tasks.txt holds `=== task: <type> <diff>` sections in the normal lesson format. Within each difficulty the
lesson's existing tasks come first, then the new ones in the order given.
"""
import re
import sys


def split(text):
    parts = re.split(r"(?m)^(?==== )", text)
    head = parts[0]
    secs = parts[1:]
    return head, secs


def main():
    lesson_path, new_path = sys.argv[1], sys.argv[2]
    head, secs = split(open(lesson_path).read())
    _, new = split(open(new_path).read())
    other = [s for s in secs if not s.startswith("=== task:")]
    tasks = [s for s in secs if s.startswith("=== task:")] + [s for s in new if s.startswith("=== task:")]
    order = {"easy": 0, "medium": 1, "hard": 2}

    def diff(s):
        m = re.match(r"=== task: \w+ (\w+)", s)
        return order[m.group(1)]

    tasks = sorted(enumerate(tasks), key=lambda x: (diff(x[1]), x[0]))
    out = head + "".join(s if s.endswith("\n\n") else s.rstrip("\n") + "\n\n" for s in other + [t for _, t in tasks])
    open(lesson_path, "w").write(out.rstrip("\n") + "\n")
    counts = {}
    for _, t in tasks:
        d = re.match(r"=== task: \w+ (\w+)", t).group(1)
        counts[d] = counts.get(d, 0) + 1
    print(lesson_path, counts)


if __name__ == "__main__":
    main()
