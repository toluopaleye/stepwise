# Stepwise

A course site that teaches **Python from zero, then Big O, data structures and algorithms**. Every lesson has
the same rhythm: learn it, see it (runnable examples and step-by-step animations), do it (30 tasks: 10 easy,
10 medium, 10 hard), and get feedback that explains why each answer was right or wrong. Lessons whose topic
has types (linked lists → singly, doubly, circular) also have a sub-lesson per type, each with its own 30 tasks.

Python runs in the browser through **PyRun**, an interpreter written for this project. Its output, error
messages and tracebacks match CPython 3.13. The build checks every program against real CPython.

## Layout

| Path | What it is |
| --- | --- |
| `content/units.json` | The course outline: units, lessons and sub-lessons, in order |
| `content/u1/*.lesson` | Lesson sources (format: `content/AUTHORING.md`) |
| `content/AUTHORING.md` | How to write a lesson: required parts, task types, style, syllabus |
| `src/py/` | PyRun, the in-browser Python interpreter |
| `src/app/` | The Workbench app: page template, styles, animations, app logic |
| `tools/build.py` | Parses lessons, runs everything in CPython and PyRun, writes `dist/` |
| `tools/uitest.py` | Browser test: plays every animation, answers every task wrong then right |
| `tools/tbtest.py`, `tools/difftest.py` | Runner fidelity tests (tracebacks, output) against CPython |

## Build and test

Needs Python 3.13 and Node 18+. The browser test needs Playwright with Chromium.

```
python3 tools/build.py                 # every lesson must have 30 tasks
python3 tools/build.py --allow-short   # while lessons are still being expanded
python3 tools/build.py --only py-math --check
python3 tools/uitest.py py-math --quick
python3 tools/tbtest.py && python3 tools/difftest.py
```

`dist/index.html` plus `dist/lessons/*.json` is the site.
