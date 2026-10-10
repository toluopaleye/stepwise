"""Run the code in learn sections and compare it with the output shown under it.

The build runs examples, animations and tasks, but a learn step's code and its ```output block are written by
hand. This runs every ```python block that is followed by an ```output block in CPython and reports any
difference (spaces at the end of a line don't count: they can't be seen). The blocks of one lesson share their variables, like cells in a notebook. Blocks that read input()
are skipped, and a block may end in an error when its output shows that error.

Usage: python3 tools/learncheck.py [lesson files or dirs...]   (default: every lesson in content/)
"""
import contextlib
import io
import pathlib
import re
import signal
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


class Timeout(Exception):
    pass


def on_alarm(*_):
    raise Timeout()


signal.signal(signal.SIGALRM, on_alarm)


def learn_text(text):
    m = re.search(r"^=== learn\n(.*?)(?=^=== )", text, re.S | re.M)
    return m.group(1) if m else ""


def blocks(learn):
    """Every ```python block in order, as (code, expected output or None, line). A block's expected output is the
    ```output block right after it, if there is one."""
    out = []
    pat = re.compile(r"```(\w*)\n(.*?)```", re.S)
    found = [(m.group(1), m.group(2), m.start(), m.end()) for m in pat.finditer(learn)]
    for i, (lang, body, start, end) in enumerate(found):
        if lang != "python":
            continue
        want = None
        if i + 1 < len(found) and found[i + 1][0] == "output" and not learn[end:found[i + 1][2]].strip():
            want = found[i + 1][1]
        out.append((body, want, learn[:start].count("\n") + 1))
    return out


def run(code, ns):
    buf = io.StringIO()
    signal.alarm(5)
    try:
        with contextlib.redirect_stdout(buf):
            exec(compile(code, "<learn>", "exec"), ns)
        err = None
    except Timeout:
        err = "timed out"
    except BaseException as e:  # noqa
        err = f"{type(e).__name__}: {e}"
    finally:
        signal.alarm(0)
    return buf.getvalue(), err


def main(args):
    paths = []
    for a in args or [str(ROOT / "content")]:
        p = pathlib.Path(a)
        paths += sorted(p.rglob("*.lesson")) if p.is_dir() else [p]
    bad = checked = 0
    for p in paths:
        ns = {"__name__": "__main__"}  # blocks in one lesson build on each other, like cells in a notebook
        for code, want, line in blocks(learn_text(p.read_text())):
            if "input(" in code:
                continue
            got, err = run(code, ns)
            if want is None:
                continue
            if err:
                if err.split(":")[0] in want:
                    continue  # the step shows this error on purpose
                print(f"{p.name}: learn line {line}: raised {err}")
                bad += 1
                continue
            checked += 1
            if [x.rstrip() for x in got.rstrip("\n").split("\n")] != [x.rstrip() for x in want.rstrip("\n").split("\n")]:
                bad += 1
                print(f"{p.name}: learn line {line}: output differs")
                print("  shown: " + repr(want.rstrip(chr(10)))[:300])
                print("  real:  " + repr(got.rstrip(chr(10)))[:300])
    print(f"{checked} learn blocks checked, {bad} problems")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
