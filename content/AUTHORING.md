# Stepwise lesson authoring guide

Stepwise is a course site that teaches **Python from zero, then Big O, data structures and algorithms**.
Every lesson follows one rhythm: **learn it → see it (examples + animations) → do it (30 tasks: 10 easy,
10 medium, 10 hard) → feedback that explains why the answer was right or wrong.** Lessons whose topic has types
(linked lists → singly, doubly, circular) also have **sub-lessons**, one per type, and every sub-lesson is a full
lesson with its own learn section, examples, animations and 30 tasks. The learner asked for it to be *detailed, granular, easy to follow,
with no steps missing*, and for this rhythm to apply to **every single lesson** (each Big O class, each data
structure, each algorithm), not per chapter.

Read this whole file before writing. Then read `content/u1/01-hello.lesson`: it is the reference lesson that shows
the format and the quality bar.

---------------------------------------------------------------------------------------------------------------

## 1. What every lesson must contain (the build enforces most of this)

| Part | Rule |
| --- | --- |
| `=== lesson` | `id`, `title`, `summary` (1–2 sentences) |
| `=== learn` | 5–10 steps, each starting `### Heading`. One idea per step. |
| `=== keypoints` | 4–7 bullets: the facts a learner needs for the tasks |
| examples | **1 or 2** runnable programs with line-by-line notes |
| animations | **1 or 2** traced programs with a caption on the important lines |
| tasks | **exactly 30: 10 easy, then 10 medium, then 10 hard** (the build enforces the counts and order) |

Task mix per lesson (30 tasks):
- Easy = one idea, one step of reasoning (recognise, read, predict a 2–4 line program, fill one blank).
  Medium = two ideas together, a short trace, a small program. Hard = combine ideas, edge cases, write real code,
  trace something longer, or spot a subtle bug.
- Use **at least 6 different task types** across the 30. Include **at least 7 `code` tasks** (at least 1 easy,
  2 medium and 4 hard), **at least 5 `predict`** tasks (or `mcq` with `check: output`) so learners trace code by
  hand, and at least 2 each of mcq/multi, fill, cells, parsons/order.
- Cover every key point and every learn step with several tasks. No two tasks may test the exact same thing:
  vary the values, the situation (shopping, games, grades, maps...), and the angle (read it, predict it, fix it,
  write it, explain it).
- Every task has a `title`, 2–3 `hint:` lines (nudge → specific → almost the answer), `right:` and `wrong:`.
- Every task's feedback must explain **why** (the mechanism), never just "Correct!" or "Try again".
- A 30-task lesson file is long (60–100 KB). Write it in stages: learn + keypoints + examples + animations first,
  check with `--check --allow-short`, then add the tasks 10 at a time (easy, medium, hard), checking after each
  batch. The final check must pass **without** `--allow-short`.

Sub-lessons: the parent lesson introduces the whole family (what the types share, how they differ, when to use
which, with a comparison table) and its 30 tasks practise the shared ideas and choosing between types. Each
sub-lesson goes deep into one type: its own diagram-like animation, its own operations, its own Big O, its own
30 tasks. A sub-lesson may assume its parent lesson. Sub-lesson files are named after the parent:
`content/u3/02-1-linked-singly.lesson`, `02-2-linked-doubly.lesson`, and so on.

## 2. Writing style (this matters most)

- The learner is a beginner. Write **plain English, short sentences, active voice**. Second person ("you").
- **Define every term the first time** it appears, in bold: "A **string** is a piece of text."
- **Never use something before it is taught.** Check the syllabus (section 9): a lesson may only use ideas from
  earlier lessons plus its own. E.g. no functions in Unit 1 before `py-functions`, no list comprehensions before
  `py-comprehensions`, no classes before `py-classes`. In Units 2–4 everything from Unit 1 is fair game.
- **No missing steps.** When something happens in several steps (a loop running, a swap, a pointer moving), show
  every step: in a table, an animation, or a worked trace. If you catch yourself writing "and so on" or
  "obviously", add the missing step instead.
- Show, then explain: a tiny code block, its output (use an ```` ```output ```` fence), then what happened and why.
- Use concrete, friendly examples (scores, shopping lists, temperatures, names). Avoid foo/bar.
- Use callouts (`> text`) for common mistakes and important warnings.
- Draw diagrams (trees, folder listings) in a ```` ```text ```` fence: it's shown as plain monospaced text.
- Tables are good for comparing cases (`| Code | Output | Why |`).
- Keep each learn step to roughly 60–180 words plus code. Prefer more small steps over one big one.
- Don't use emoji. Don't write "simply", "just", "easy", "obviously".
- Python output in prose goes in backticks: `print(3 + 4)` shows `7`.
- For Big O / data structures / algorithms: always tie the idea to **counting steps as n grows**, and show
  concrete numbers (n = 10, 100, 1,000) so "grows like n²" means something.

## 3. File format reference

A lesson is a text file `content/<unit>/NN-slug.lesson` (NN = position in the unit, e.g. `07-string-methods.lesson`).
Sections start with `=== name` at the start of a line. Inside sections, `key: value` fields start at column 0.
A field's text continues on following lines until the next field. Code goes in ```` ``` ```` fences.

```
=== lesson
id: py-variables
title: Variables
summary: One or two sentences. Can use `code`.

=== learn
### First step heading
Markdown: paragraphs, **bold**, *italic*, `code`, lists (- item), numbered lists (1. item),
> callouts, | tables |, and fenced code. Use ```output fences for program output.

### Second step heading
...

=== keypoints
- Short fact with `code`.
- Another fact.

=== example: Title shown above the code
intro: One sentence shown next to the title.
```python
code here
```
1: Note about line 1.
2-3: Note about lines 2 to 3.

=== animation: Title
view: vars
intro: One sentence: what to watch.
show: total i
```python
code here
```
2: Caption shown while line 2 is ABOUT to run. Can include {total} or {total!r} (values right then).

=== task: predict easy
title: Short title
prompt: Optional for predict (a default prompt is used).
code:
```python
...
```
hint: First nudge.
hint: More specific.
right: Why the answer is right (the mechanism).
wrong: The correct reasoning, step by step.
wrong[What they typed]: Targeted explanation for this specific wrong answer. Use \n for line breaks.
```

### Parsing pitfalls (the parser is simple, so avoid these)
- A text line that starts with a field name and a colon (e.g. `answer: ...`, `code: ...`, `hint: ...`,
  `title: ...`, `items: ...`, `tests: ...`, `lines: ...`) is read as a new field. Reword such lines.
- In options and anywhere else, ` :: ` (space, two colons, space) separates an option from its feedback.
  Don't use it in normal text.
- A line `=== something` inside a code fence is fine; outside a fence it starts a new section.
- Inside prompts, use ```` ```output ```` fences for expected output, ```` ```python ```` for code.
- Notes in examples/animations are lines `N: text` or `N-M: text`. A continuation line must start with 2 spaces.

## 4. Task types (how each is shown and checked)

### mcq — one correct answer
```
=== task: mcq easy
title: ...
prompt: Question text.
code:                       (optional code shown above the options)
```python
...
```
check: output               (optional: build verifies the correct option equals what the code prints)
- wrong option text :: why it's wrong (shown when picked)
* correct option text :: why it's right
- another wrong option :: why it's wrong
hint: ...
right: ...                  (optional for mcq; if missing, the correct option's feedback is used)
wrong: ...                  (shown with the picked option's feedback)
```
Every option's feedback must teach. After a correct answer, all options show their feedback.
Use 3–5 options. Wrong options should be **plausible mistakes**, not jokes.

### multi — choose all that apply
Same as mcq, with 1+ `*` options. Prompt must say "Choose every ...".

### predict — type the exact output
`code:` (required) + `right`, `wrong`, and 2–4 `wrong[...]` for the most likely mistaken outputs.
The code **must print something and must not raise an error**. The learner's answer is compared line by line
(trailing spaces ignored). Keep outputs short (1–6 lines). Good predict tasks hinge on one specific idea.

### fill — fill in the blanks
```
prompt: What the finished program should do (show the target output in an ```output fence).
code:
```python
total = ??
for n in [1, 2, 3]:
    total ?? n
print(total)
```
answer: 0 | +=
after:                      (optional code appended after the blanks' code)
wrong[1 | +=]: Why starting at 1 is wrong.
```
`??` marks each blank; `answer:` lists the blanks in order separated by ` | `. The app accepts the exact answer
**or anything that produces the same output**, so make sure the output really pins down the answer.
The build runs every `wrong[...]` combination and fails if it gives the right output.

### parsons — arrange lines (and their indentation)
```
lines:
```python
total = 0
for n in nums:
    total += n
print(total)
```
distractors:
```python
total = n
```
```
`lines` is the correct program in order, indented with 4 spaces per level. Distractors are tempting wrong lines
(0–3). Don't use a distractor that is equivalent to a correct line. Learners must also get the indentation right.

### code — write code
```
=== task: code medium
title: ...
prompt: What to write. Name the function/variable, its inputs, what to return. Give 1–2 examples.
starter:
```python
def count_evens(nums):
    # your code here
    return 0
```
solution:
```python
def count_evens(nums):
    count = 0
    for n in nums:
        if n % 2 == 0:
            count += 1
    return count
```
tests:
- count_evens([1, 2, 3, 4])
- count_evens([])
- count_evens([7, 9])
fail[2]: Shown when test 2 is the first failing test: explain what that test checks (e.g. the empty list).
error[TypeError]: Shown when the learner's code raises this error type.
require[for]: Shown (and required) if the code doesn't contain this text (whitespace ignored, comments ignored).
forbid[sum(]: Shown (and forbidden) if the code contains this text. Use to stop shortcuts like sorted().
speed: setup=nums = list(range(n)) | call=count_evens(nums) | target=O(n)
slow:
```python
(a correct but too-slow version; the build checks it FAILS the speed check)
```
hint: ...
right: ...
wrong: ...
```
- **tests mode** (default): each `- expr` line is a Python expression evaluated after the learner's code runs.
  The expected value comes from running `solution` in real Python. Test values must be plain data (int, float,
  str, bool, None, list, tuple, dict, set). Wrap Counter/defaultdict results in `dict(...)`. No `inf`/`nan`.
  Write 4–7 tests including edge cases (empty input, one item, negatives, duplicates, ties).
- Before `py-functions`, tests can just name variables: the learner's code sets `total`, test `- total`.
  Or use **stdout mode**: `tests: stdout` and the learner's output must equal the solution's output exactly.
- **cases** (best for lessons before functions): run the learner's code several times, each time after
  different setup lines, so the code must work for every input, not one hard-coded value:
  ```
  tests:
  - price
  cases:
  - age = 3
  - age = 12
  - age = 65
  fail[2]: (with cases, fail[N] refers to case N) Age 12 should cost 4...
  ```
  The starter must NOT set the input variable (say in the prompt that it's already set and the checks try several
  values); the app warns the learner if their code sets it anyway. Use `\n` inside one case for several setup
  lines: `- nums = [3, 1, 2]\ntarget = 2`. 4–8 cases, including the boundaries (exactly 13, exactly 65...).
- The `starter` must **fail** at least one test (the build checks). It should give a helpful skeleton
  (function header, a comment where code goes), not the answer.
- `speed:` (Units 2–4) counts the steps the learner's code takes for growing n and classifies the growth.
  `setup` builds the input for size `n` (n is set for you), `call` runs the code. Optional `sizes=` (default
  `500,1000,2000,4000,8000`) and `max=` (default 3,000,000 steps; exceeding it counts as too slow).
  Reliable distinctions: **O(n) vs O(n²)** and **O(1)/O(log n) vs O(n)**. Do NOT ask the checker to tell O(n log n)
  from O(n). If you add `speed:`, add a `slow:` version that the build will confirm fails it.
  Built-ins are charged their real cost (`x in list` is n steps, `list.insert(0, x)` shifts n items, `sorted` is
  n log n, slicing copies), so a "clever" one-liner can't sneak past.

### cells — fill in boxes (trace values)
```
prompt: After this code runs, what is in each position of `nums`?
code:
```python
...
```
labels: 0 | 1 | 2 | 3          (optional labels under the boxes)
start: 5 | 2 | 8 | 1           (optional "Before" row)
answer: 2 | 5 | 1 | 8          (or a compute: fence that sets `answer` to a list)
wrong[5 | 2 | 1 | 8]: Explanation for this specific wrong set of boxes.
```
Each box is compared ignoring spaces, case and surrounding quotes. Great for tracing a variable through a loop
(labels = iterations), array states after one pass of a sort, dp tables, distances in a graph.

### order — put steps in order
```
prompt: Put these steps of binary search in the order they happen.
items:
- First step (list them in the CORRECT order; the app shuffles them)
- Second step
- Third step
```

## 5. Feedback rules

- `right:` — explain the mechanism that makes it right, in 1–3 sentences. It should teach something even to a
  learner who guessed right.
- `wrong:` — walk through the correct reasoning step by step. Don't shame. Don't just restate the answer.
- `wrong[...]` (predict, fill, cells) — anticipate the 2–4 most likely mistakes and explain each one exactly.
  For predict, write the mistaken output exactly as a learner would type it, with `\n` between lines.
- Code tasks: add `fail[N]` for tests that catch a specific misunderstanding (empty list, off-by-one, ties),
  and `error[Type]` for errors a learner is likely to hit (IndexError for off-by-one, KeyError, TypeError...).
  The app already explains generic errors, shows the failing test and the expected vs actual value.
- mcq/multi: every option needs feedback that says why it is right or wrong.

## 6. Examples and animations

Examples: 4–15 lines, print something meaningful, one note per important line (notes can cover ranges).
They should show the lesson's idea in a realistic mini-program. Examples may raise an error on purpose only in
`py-errors` (the error is shown as output).

Animations are traced in real Python: every line run becomes a frame (the highlighted line is the one *about to
run*, and the variables shown are their values *before* it runs). Keep animations short: **15–80 frames**
(a frame per executed line; loops multiply this). Put a caption on every important line. Captions can show live
values with `{name}` or `{expr!r}` — e.g. `3: i is {i}, so we compare nums[{i}] = {nums[i]} with the target.`
(Captions are evaluated in Python on that line, before it runs.) Lines without a caption get an automatic
"Next, Python runs line N" caption, so caption most lines.

Views (`view:` lines; you can stack several views, one per line):

| View | Shows | Options |
| --- | --- | --- |
| `vars` | variables table, changed ones highlighted | `vars a b` to only show some |
| `output` | only the output box (always shown anyway) | |
| `array nums` | boxes with indexes (also works on a string: one box per character) | `ptr=i,j` pointers, `range=lo:hi`, `done=0:i-1`, `hit=mid` |
| `bars nums` | bar chart of numbers (sorting) | same options as array |
| `grid board` | 2D list as a table | `row=r col=c`, `rows=..`, `cols=..` labels |
| `stack s` | list drawn as a stack (top = end) | |
| `queue q` | list/deque drawn as a queue | |
| `dict d` / `set s` | dictionary table / set bubbles | `hit=key_var` highlights that key |
| `buckets table` | list of lists as hash buckets | `hit=idx_var` |
| `linked head` | linked list of objects with `.val`/`.next` | `ptr=cur,prev` |
| `tree root` | binary tree of objects with `.val/.left/.right` | `ptr=node`, `visited=order_list`; `kids=children` draws an n-ary tree whose nodes keep a list of children |
| `heap h` | list drawn as a binary heap + array | `ptr=i` |
| `graph g` | dict of adjacency lists (or (nbr, weight) tuples) | `pos=A:60,40;B:160,40` (x,y), `visited=var`, `frontier=var`, `current=var`, `dist=var`, `directed=1`, `vlabel=`/`flabel=` rename the legend (underscores become spaces) |
| `callstack` | the stack of function calls with their variables | `callstack v w` shows only those variables in each call |
| `steps count` | a big step counter | `label=steps_so_far` (underscores become spaces) |
| `chart` | growth curves (no code; frames are values of n) | `fns=1,log2(n),n,n*log2(n),n**2 labels=O(1),O(log_n),... n=1..64 scale=log` (no spaces inside options: write `_` for a space in labels) |

Expressions in `ptr=`, `range=` etc. support names, integers, `len`, `+` and `-` (e.g. `done=len-i:`).
Any view takes `title=Some_title` (underscores become spaces), which helps when two views of the same kind are stacked.
`show:` limits which variables are traced (`show: nums i j`). For `chart`, put the caption on line `1:` and
use `{n}` and `{LABEL}` placeholders (e.g. `1: At n = {n}, O(n²) takes {O(n²)} steps.`).

## 7. Code rules (the build runs everything in CPython 3.13 AND in the in-browser runner; outputs must match)

- Deterministic output only: no time, no `input()` (not available in the browser), no files, no network.
  `random` is fine **after `random.seed(<an int>)`**: the runner reproduces CPython's exact random numbers
  (random, randint, randrange, choice, choices, shuffle, sample, uniform).
- **Never print a set or frozenset that contains strings** (CPython's order changes every run). Print
  `sorted(the_set)` instead. Sets of ints and tuples of ints are fine.
- Not supported by the in-browser runner: `with`, `async`, generators with `yield`, `match`, `bytes`, complex
  numbers, `dataclasses`, `typing` beyond imports, decorators other than `@lru_cache`/`@cache`/`@property`/
  `@staticmethod`/`@classmethod`, `exec`/`eval`. Generator *expressions* like `sum(x for x in xs)` are fine.
- Available modules: `math`, `collections` (deque, Counter, defaultdict), `heapq`, `functools` (lru_cache,
  cache, reduce, cmp_to_key), `itertools`, `bisect`, `random`, `time`, `sys`, `string`, `copy`.
- Recursion depth must stay **under 500** (the browser stack is smaller than CPython's).
- Keep step counts small: examples/tasks run in well under 100,000 steps.
- Floats: print rounded values (`round(x, 2)` or f-strings with `:.2f`) unless float behaviour is the topic.
- Error messages in `wrong` text should match Python 3.13's wording (e.g.
  `TypeError: can only concatenate str (not "int") to str`).

## 8. Build and check your lesson

Several people write lessons at the same time and the site is published from `content/`, so **never leave a
half-written lesson in `content/`**. Work in your own folder and copy the file into `content/` only when it
passes every check. Don't change anything in `tools/` or `src/` (the runner); if a program prints something
different in CPython and in the runner, change your program and mention the difference in your report.

Set up your folder (`<scratch>` = any scratch folder outside the repo, e.g. `/tmp/stepwise-work`):
```
W=<scratch>/<lesson-id>
mkdir -p $W/content/<unit> && cp content/units.json $W/content/
cp content/<unit>/<file>.lesson $W/content/<unit>/     # only when you are expanding an existing lesson
```
Edit `$W/content/<unit>/<file>.lesson`. Check it after every stage (the build reads lessons from `--content`):
```
python3 tools/build.py --content $W/content --only <lesson-id> --check --allow-short    # while writing
python3 tools/build.py --content $W/content --only <lesson-id> --check                  # final: exactly 30 tasks
```
Fix every error it prints. It checks the format, the counts, runs every program in CPython and in the
in-browser runner, checks predict outputs, fill wrong answers, code tests, starters, rules, and speed checks.
Then run the browser test, which opens the page, plays every animation and submits a wrong and a right
answer to every task:
```
python3 tools/build.py --content $W/content --only <lesson-id> --out $W/out && python3 tools/uitest.py <lesson-id> --dist $W/out
```
Add `--shots $W/shots` to the UI test to save screenshots you can look at. When both pass, copy the file to
`content/<unit>/` (same file name) as your very last step.

Before you finish, re-read the lesson as a beginner would:
- Is any step missing? Is every term defined before use? Is anything used that wasn't taught yet?
- Do the tasks escalate from easy to hard? Is each task solvable from the learn section and examples?
- Does every feedback text explain *why*? Do wrong[...] cover the likely mistakes?
- Are titles specific ("Count the evens", not "Task 3")?

---------------------------------------------------------------------------------------------------------------

## 9. Syllabus (scope of every lesson)

Units and lesson ids are fixed in `content/units.json`. File names: `content/u1/02-errors.lesson` etc.
"Uses" = what the lesson may assume. Everything listed for a lesson should be taught in it.

Sub-lessons (children in `content/units.json`) are listed under their parent as "↳ id: scope".

### Unit 1 · Python Foundations (`content/u1/`)
1. `py-hello` Your first program: print() — DONE (reference lesson).
2. `py-errors` Reading error messages — what an error/exception is; a program stops at the first error (output
   before it is kept, lines after never run); reading a traceback bottom-up (error type, message, line number,
   the arrow/line shown); SyntaxError (missing bracket/quote/colon), IndentationError, NameError (typo, missing
   quotes, capital letters), TypeError (`"5" + 5`), ZeroDivisionError; a step-by-step method to fix errors.
   Uses only print, strings, numbers (no variables yet... except you may preview `x = 5` as "a name for a value"
   only if needed; prefer to avoid). Code tasks = fix the broken program (stdout mode). Examples may raise.
3. `py-variables` Variables — `=` stores a value under a name; reading a variable; naming rules (letters,
   digits, underscore, not starting with a digit, case-sensitive, no spaces; snake_case); reassignment (the
   newest value wins); `x = x + 1` read right-to-left; `+=`, `-=`, `*=`; copying a number into another
   variable then changing one; swapping with a temporary variable; using variables in print and calculations.
4. `py-types` Types — int, float, str, bool; `type()`; `/` always gives a float; `int()`, `float()`, `str()`
   conversions (int("42"), int(3.9) cuts off the decimals, str(7)); why `"5" + 5` fails and `"5" * 3` repeats;
   `len()` on strings; numbers that are really text (e.g. "42" vs 42).
   ↳ `py-types-int` int: whole numbers — any size (no overflow), negative numbers, `int()` from text and floats
   (truncation toward zero), underscores in literals `1_000_000`, `//` and `%` keep ints, `/` doesn't, comparing
   ints, `abs()`, `type()`/`isinstance(x, int)`.
   ↳ `py-types-float` float: decimal numbers — decimal point and scientific notation `1e6`, results of `/`,
   precision surprises (`0.1 + 0.2`), `round(x, 2)` and f-string `:.2f` for display, `int()`/`round()` to get back
   to ints, `float("3.5")`, comparing floats safely (`abs(a - b) < 0.001`), `float('inf')` (brief).
   ↳ `py-types-str` str: text — quotes (single, double, triple for several lines), escape sequences `\n` `\t`
   `\'` `\\`, empty string, `len`, `+` and `*`, `str()` of numbers, strings are sequences (preview of indexing),
   comparing strings, `in`.
   ↳ `py-types-bool` bool: True and False — the two values, `type(True)`, `bool()` of numbers and strings
   (truthiness: 0, 0.0, "" are False), `True + True` is 2 (bools are ints underneath, briefly), booleans from
   comparisons (preview), `str(True)`.
5. `py-math` Arithmetic operators — `+ - * / // % **`; `-3 ** 2` and chains of `**` (right to left); precedence
   and brackets; shortcut operators `-= *= /= //= %= **=` (the right side is worked out first); `//` and `%`
   explained with sharing sweets / minutes and seconds / clocks (`% 24`); even/odd with `% 2`; last digit with
   `% 10`; `round()`, `abs()`, `min()`/`max()` of numbers; float surprises (`0.1 + 0.2`) and rounding output;
   `import math`, `math.sqrt`, `math.floor`, `math.ceil`, `math.pi`.
6. `py-strings` Strings: indexing and slicing — characters and positions starting at 0; `s[0]`, `s[-1]`;
   `len(s) - 1` is the last index; IndexError; slicing `s[a:b]` (b not included), `s[:b]`, `s[a:]`, steps
   `s[::2]`, `s[::-1]`; slices never raise; `+` joins, `*` repeats; `in` checks for a substring; strings can't
   be changed in place (TypeError) — make a new one.
7. `py-string-methods` String methods and f-strings — calling a method with a dot; `.upper() .lower() .strip()
   .replace() .split() .join() .find() .count() .startswith() .endswith() .isdigit()`; methods return new
   strings (the original is unchanged); chaining; f-strings `f"{name} is {age}"`, expressions inside braces,
   `{x:.2f}`, `{n:>5}` and `{n:<5}` for alignment.
8. `py-booleans` Comparisons and booleans — `== != < > <= >=` give True/False; `=` vs `==`; comparing strings
   (alphabetical, uppercase before lowercase); `and`, `or`, `not` with truth tables; precedence (not, and, or);
   chained comparisons `0 <= x < 10`; `in` on strings; storing a comparison in a variable.
9. `py-if` if, elif and else — blocks and indentation (4 spaces); `if`; `else`; `elif` chains (first true
   branch wins, order matters); nested ifs; combining conditions; common mistakes (missing colon, `=` in a
   condition, unreachable branches); truthiness of 0 and "" (brief).
10. `py-for` for loops and range() — repeating code; `for i in range(5)`; `range(start, stop)`,
   `range(start, stop, step)`, counting down; the loop variable; the body is the indented block; what runs after
   the loop; accumulator pattern (`total = 0` then `total += i`); counting; looping over the characters of a
   string; building a string in a loop.
11. `py-while` while loops — repeat while a condition is true; the three parts (start value, condition,
   update); infinite loops and how the runner stops them; `break`; `continue`; `while True` + `break`;
   when to use while vs for; digit sums, halving/doubling until a limit, countdowns.
12. `py-lists` Lists — creating `[...]`, indexing and negative indexing, `len`, changing an item `nums[i] = x`,
   `append`, `insert`, `pop()` and `pop(i)`, `remove`, `in`, `index`, `count`, slicing a list, `sort()` and
   `reverse()` (they change the list and return None), **aliasing**: `b = a` names the same list; `a.copy()`
   or `a[:]` makes a new one.
13. `py-list-loops` Looping over lists — `for x in nums`; `for i in range(len(nums))` when you need the
   position; `enumerate`; patterns: total, count matches, find max/min by hand, build a new filtered/changed
   list, find the first match and `break`, "found" flags; don't remove items from a list while looping over it.
14. `py-nested` Nested loops and grids — a loop inside a loop (the inner loop runs fully for each outer step;
   count the total iterations); multiplication table; all pairs; lists of lists; `grid[r][c]`; looping over
   rows and columns; `break` only leaves the inner loop; building a grid with a loop.
15. `py-functions` Functions — why functions; `def name(params):`, the body, calling, arguments; `return`
   sends a value back; print vs return (and getting `None`); several parameters; calling functions from
   functions; a function must be defined before it is called; small useful functions.
16. `py-scope` Return values and scope — `return` stops the function immediately (early return); functions
   without return give `None`; returning booleans; local variables vs global variables; parameters are local;
   reading globals vs assigning (UnboundLocalError) and the `global` keyword (and why to avoid it); default
   parameter values; keyword arguments; a function can change a list you pass in (aliasing again).
17. `py-dicts` Dictionaries — key → value; `{}`; `d[key]`; adding/updating; `in` checks keys; `.get(key,
   default)`; KeyError; `del`; `.keys() .values() .items()`; looping; counting with a dict (word counts);
   dicts keep insertion order; keys must be immutable (str, int, tuple).
18. `py-sets` Sets — unique items; `set()` (and why `{}` is a dict); `add`, `remove` vs `discard`, `in`;
   removing duplicates from a list; union `|`, intersection `&`, difference `-`; sets have no order/indexes;
   print `sorted(s)` when the order matters.
19. `py-tuples` Tuples and unpacking — `(a, b)`, one-item tuple `(x,)`, indexing, tuples can't change;
   unpacking `x, y = point`; swapping `a, b = b, a`; returning several values from a function; tuples as dict
   keys (grid coordinates); `.items()` and `enumerate` give tuples; `zip`.
20. `py-comprehensions` List comprehensions — `[expr for x in items]`; with `if`; the equivalent loop step by
   step; `if/else` inside the expression; nested comprehensions for grids; when a loop is clearer.
   ↳ `py-comp-dict` Dict comprehensions — `{k: v for ...}`, from two lists with zip, inverting a dict, filtering
   a dict's items, counting with a comprehension vs a loop.
   ↳ `py-comp-set` Set comprehensions — `{expr for ...}`, unique results, filtering, comparison with `set([...])`,
   generator expressions inside `sum()`/`max()`/`any()` (no square brackets).
21. `py-builtins` Handy built-ins: sorted, min, max, zip — `sum`, `min`, `max`, `sorted` (new list) vs
   `.sort()` (in place), `reverse=True`, `key=len`, `lambda` for keys, `min/max` with `key`, `any`, `all`,
   `zip`, `enumerate(start=1)`, `reversed`, `abs`, `round`.
22. `py-classes` Classes and objects — a class is a blueprint, an object is one thing made from it;
   `__init__` and `self`; attributes; methods; several objects each with their own data; `__repr__` for nice
   printing; objects that hold other objects (a `Node` with `val` and `next` — preview of Unit 3).
23. `py-recursion` Recursion — a function that calls itself; base case and recursive case; countdown,
   factorial, sum of a list, string reversal; the call stack (callstack view); RecursionError without a base
   case; each call has its own variables; recursion vs loops; fibonacci's tree of calls (preview of Big O).

### Unit 2 · Big O (`content/u2/`) — every lesson: count steps, show tables of n vs steps, a growth chart
1. `bigo-steps` Counting steps — why not seconds (machines differ); a "step" = one basic operation; input
   size n; counting the steps of simple loops by hand (step counter animation); how the count changes when n
   doubles; Big O as "how the step count grows".
2. `bigo-o1` O(1): constant time — work that doesn't depend on n (index access, arithmetic, append, dict
   lookup, `len`); O(1) can still be 100 steps; first/last element; recognising O(1) code.
3. `bigo-on` O(n): linear time — one pass over the input; sum, max, linear search; doubling n doubles steps;
   two loops one after another are still O(n); early exit doesn't change the worst case.
4. `bigo-on2` O(n²): quadratic time — a loop inside a loop over the same input; all pairs; naive duplicate
   check; doubling n → 4× steps; the triangle loop (j from i+1) is n(n−1)/2 → still O(n²); speed-check tasks
   that turn an O(n²) solution into O(n) (e.g. with a set).
   ↳ `bigo-on3` O(n³): cubic time — three nested loops (all triples, naive matrix multiplication), doubling n →
   8× the steps, why n = 1,000 is already a billion steps, recognising O(n^k) in general.
5. `bigo-logn` O(log n): logarithmic time — halving until 1; `while n > 1: n //= 2`; log₂ table (1,024 → 10,
   1,000,000 → 20); doubling n adds one step; guessing game / binary search preview.
6. `bigo-nlogn` O(n log n) — n times log n work; efficient sorting (`sorted`); comparing n, n log n and n²
   for real n; why "sort first" solutions are O(n log n).
7. `bigo-2n` O(2ⁿ): exponential time — doubling for each extra item; all subsets; naive recursive
   fibonacci call counts; why n = 40 is already too slow.
   ↳ `bigo-nfact` O(n!): factorial time — all orderings (permutations), n! for small n, why 10! is 3.6 million
   and 20! is astronomical, brute-force travelling salesman, comparing 2ⁿ and n!.
8. `bigo-simplify` Dropping constants and smaller terms — O(2n) → O(n), O(n² + n) → O(n²), O(500) → O(1);
   sequential parts add, nested parts multiply; two different inputs: O(a + b) vs O(a·b).
9. `bigo-cases` Best, worst and average case — linear search best/worst; why Big O usually means worst case;
   early exit; examples where cases differ and where they don't.
10. `bigo-space` Space complexity — extra memory as n grows; O(1) space (a few variables) vs O(n) (a new
   list/dict); recursion uses stack space; in-place vs copying; trade time for space (memo/set).
11. `bigo-python` Big O of Python's built-ins — list: index/append/pop() O(1), insert(0)/pop(0)/`in`/remove
   O(n), slicing O(k); dict/set: get/set/`in` O(1) average; `sorted` O(n log n); `len` O(1); string building
   in a loop; choosing the right structure; speed-check tasks.

### Unit 3 · Data Structures (`content/u3/`) — every lesson: how it's laid out, the operations, their Big O, implement it
1. `ds-arrays` Arrays — items side by side in memory; index → address arithmetic so access is O(1); the cost
   table of array operations; static vs dynamic vs 2D arrays in one comparison table.
   ↳ `ds-arrays-static` Static arrays — fixed size chosen up front, simulate one with a Python list of fixed
   length, reading/writing by index, shifting items for insert/delete by hand, why "full" is a problem.
   ↳ `ds-arrays-dynamic` Dynamic arrays — size vs capacity, doubling when full and copying, amortised O(1) append,
   implement a small DynamicArray class (append, get, set, grow), count the copies.
   ↳ `ds-arrays-2d` 2D arrays (grids) — rows and columns, `grid[r][c]`, row-major order, building grids
   correctly (the `[[0]*3]*3` trap), neighbours of a cell, walking rows/columns/diagonals, O(rows × cols).
2. `ds-linked` Linked lists — nodes and links vs arrays; the three kinds side by side (singly, doubly,
   circular) with a comparison table of their operations and costs; when a linked list beats an array.
   ↳ `ds-linked-singly` Singly linked lists — `Node(val, next)`, head, walking, insert at head O(1), append O(n)
   (or O(1) with a tail), delete a value, search, reverse a list step by step, find the middle.
   ↳ `ds-linked-doubly` Doubly linked lists — `prev` and `next`, head and tail, O(1) insert/delete when you
   hold the node, walking backwards, keeping both links consistent, the cost of the extra pointer.
   ↳ `ds-linked-circular` Circular linked lists — the last node links back to the first, walking without an
   infinite loop (stop when you're back at the start), round-robin turns, the Josephus game.
3. `ds-stacks` Stacks — LIFO; push/pop/peek with a list (end = top); all O(1); uses: undo, back button,
   matching brackets, the call stack; balanced-brackets task; evaluate/reverse with a stack.
   ↳ `ds-stacks-monotonic` Monotonic stacks — a stack kept in increasing or decreasing order; next greater
   element, daily temperatures, why each item is pushed and popped once (O(n)).
4. `ds-queues` Queues — FIFO; enqueue/dequeue; why `list.pop(0)` is O(n); `collections.deque`; queue
   simulations (printer, ticket line); the kinds of queue compared; preview of BFS.
   ↳ `ds-queues-circular` Circular queues — a fixed-size list with front/back indexes that wrap around with `%`,
   full vs empty, implementing enqueue/dequeue by hand (ring buffer).
   ↳ `ds-queues-deque` Deques — double-ended queues: `append`, `appendleft`, `pop`, `popleft`, all O(1);
   using a deque as a stack or a queue; a sliding-window maximum preview; palindrome check.
5. `ds-hashmaps` Hash maps — a hash function turns a key into a number → bucket index (`hash % size`);
   buckets; collisions and chaining; get/put O(1) on average; load factor and resizing; worst case O(n);
   implement a tiny hash map with a list of buckets (use your own simple string hash so output is stable).
   ↳ `ds-hash-chaining` Separate chaining — each bucket holds a list of (key, value) pairs; put/get/delete
   walking a bucket; long chains and load factor; resizing and rehashing.
   ↳ `ds-hash-open` Open addressing — one item per slot; linear probing to the next free slot; lookups that probe
   until an empty slot; why deletion needs a "deleted" marker; clustering.
6. `ds-hashsets` Hash sets — a hash map with only keys; O(1) `in`; dedupe; seen-before patterns (first
   repeat, two-sum with a set/dict), set operations and their costs.
7. `ds-trees` Trees — root, parent, child, leaf, edge, subtree, depth, height; binary tree `Node(val, left,
   right)`; building trees by hand; counting nodes, summing values and height with recursion.
   ↳ `ds-trees-kinds` Kinds of binary trees — full, complete, perfect, balanced and degenerate (skewed) trees;
   recognising each; node counts and heights (a perfect tree of height h has 2^(h+1) − 1 nodes); why balance
   matters for speed.
   ↳ `ds-trees-nary` N-ary trees — nodes with a list of children (folders, org charts, comments), counting and
   height with recursion over children, depth of a node.
8. `ds-traversals` Tree traversals — what "visiting every node" means; depth-first vs breadth-first; the four
   orders side by side on the same tree; choosing an order for a job.
   ↳ `ds-trav-pre` Preorder (node, left, right) — recursive and with an explicit stack; copying a tree,
   printing a folder structure.
   ↳ `ds-trav-in` Inorder (left, node, right) — sorted order of a BST; recursive and iterative versions.
   ↳ `ds-trav-post` Postorder (left, right, node) — children before parents; deleting a tree, computing sizes
   and heights, evaluating an expression tree.
   ↳ `ds-trav-level` Level order — BFS with a queue, level by level; level sums, the rightmost node of each level,
   printing a tree by levels.
9. `ds-bst` Binary search trees — the BST rule; search by going left/right, O(h); insert; inorder gives
   sorted order; min/max; balanced O(log n) vs degenerate O(n) (inserting sorted data).
10. `ds-heaps` Heaps and priority queues — complete binary tree stored in a list; parent (i−1)//2, children
   2i+1 and 2i+2; the heap rule; priority queues; min-heap vs max-heap compared.
   ↳ `ds-heaps-min` Min-heaps — push = sift up, pop = sift down, O(log n), by hand step by step and with
   `heapq`; heapify; k smallest items; merging sorted lists.
   ↳ `ds-heaps-max` Max-heaps — the reversed rule; building one by hand; with `heapq` by storing negatives;
   k largest items; a running "top scores" board.
11. `ds-graphs` Graphs — vertices and edges; neighbours and degree; paths and cycles; the kinds of graph
   (directed/undirected, weighted/unweighted) and the ways to store one, side by side.
   ↳ `ds-graphs-directed` Directed and undirected graphs — one-way vs two-way edges, in-degree and out-degree,
   adding both directions for undirected edges, follower networks vs friendships.
   ↳ `ds-graphs-weighted` Weighted graphs — edges with costs (distances, prices), storing (neighbour, weight)
   pairs, total weight of a path, the cheapest edge out of a node.
   ↳ `ds-graphs-repr` Adjacency lists vs matrices — building both from an edge list, edge lookups O(1) vs O(deg),
   space O(V + E) vs O(V²), converting between them, which to choose.

### Unit 4 · Algorithms (`content/u4/`) — every lesson: the idea, a full trace, the code, its Big O, variations
1. `algo-linear` Linear search — check each item; return index or −1; best/worst/average; find all matches;
   searching objects/dicts by a field.
2. `algo-binary` Binary search — needs sorted data; lo/hi/mid; discard half each step; O(log n); loop
   condition `lo <= hi` and off-by-one bugs; `bisect`.
   ↳ `algo-binary-bounds` First and last position — finding the first and last copy of a value, insertion points,
   counting copies with two searches, `bisect_left` vs `bisect_right`.
   ↳ `algo-binary-answer` Binary search on the answer — when the answer itself is in a sorted range (smallest
   speed that finishes in time, square root by search, minimum capacity), the yes/no test function.
3. `algo-two-pointers` Two pointers — the idea, the two styles compared, why it turns O(n²) into O(n).
   ↳ `algo-tp-opposite` Pointers from opposite ends — pair with a target sum in a sorted list, reverse in place,
   palindrome check, container with the most water.
   ↳ `algo-tp-fastslow` Fast and slow pointers — same direction at different speeds: remove duplicates from a
   sorted list, move zeros, middle of a linked list, detecting a cycle.
4. `algo-sliding` Sliding window — a window moving over a list; add the new item, remove the old one; O(n)
   instead of recomputing; fixed vs variable windows compared.
   ↳ `algo-sliding-fixed` Fixed-size windows — max sum of k in a row, moving averages, counting windows that
   pass a test.
   ↳ `algo-sliding-variable` Variable-size windows — grow the right edge, shrink the left: longest substring
   without repeats, shortest subarray with sum ≥ target, at most k distinct.
5. `algo-bubble` Bubble sort — compare neighbours, swap, the biggest bubbles to the end each pass; passes;
   early exit when no swaps; O(n²), O(n) best case; stable.
6. `algo-selection` Selection sort — find the smallest in the unsorted part and swap it to the front; always
   O(n²) comparisons, at most n−1 swaps; not stable.
7. `algo-insertion` Insertion sort — grow a sorted prefix; shift bigger items right and insert; O(n²) worst,
   O(n) for nearly sorted data; stable.
8. `algo-merge` Merge sort — split in half, sort each half (recursion), merge two sorted lists with two
   pointers; O(n log n) always; O(n) extra space; stable.
9. `algo-quick` Quicksort — pick a pivot, partition (Lomuto), recurse on both sides; average O(n log n),
   worst O(n²) (already sorted + last-item pivot); in place.
10. `algo-backtracking` Backtracking — choose, explore, un-choose; the decision tree; pruning; callstack view.
   ↳ `algo-bt-subsets` Subsets — include/exclude each item, 2ⁿ subsets, subsets with a target sum.
   ↳ `algo-bt-perms` Permutations — choosing an unused item for each position, n! orderings, avoiding duplicates.
   ↳ `algo-bt-combos` Combinations — choose k of n in order, combination sum, pruning when the sum is too big.
11. `algo-bfs` Breadth-first search — queue + visited; explores in layers; shortest path (fewest edges) in an
   unweighted graph; O(V + E).
   ↳ `algo-bfs-grid` BFS on grids — cells as nodes, 4 neighbours, walls, shortest path in a maze, distances
   from a start cell, multi-source BFS (rotting oranges).
12. `algo-dfs` Depth-first search — goes deep first; visited set; finding a path; connected components; O(V + E).
   ↳ `algo-dfs-iterative` Recursive vs iterative DFS — the same search with recursion and with an explicit
   stack, visiting order differences, when recursion depth becomes a problem.
   ↳ `algo-dfs-grid` DFS on grids — flood fill, counting islands, the area of the largest island.
13. `algo-topo` Topological sort — DAGs and dependencies (courses, recipes); what a valid order is; why a
   cycle makes it impossible; the two methods compared.
   ↳ `algo-topo-kahn` Kahn's algorithm — in-degrees, a queue of nodes with no remaining prerequisites,
   detecting a cycle when nodes are left over.
   ↳ `algo-topo-dfs` DFS-based topological sort — finish order, reversing it, detecting a cycle with three
   colours (unvisited, in progress, done).
14. `algo-dijkstra` Dijkstra's shortest paths — weighted graphs; distances start at infinity; a priority queue
   (`heapq`); relax edges; why no negative weights; O((V + E) log V). (Return distances with -1 or None for
   unreachable, never inf, in tests.)
15. `algo-memo` Dynamic programming: memoization — overlapping subproblems (fibonacci call tree); a memo dict;
   `@lru_cache`; from O(2ⁿ) to O(n); climbing stairs; grid paths.
16. `algo-tabulation` Dynamic programming: tabulation — fill a table bottom-up; base cases first; the order of
   filling; reading the answer from the table; memo vs tabulation compared.
   ↳ `algo-dp-1d` 1D DP tables — fibonacci, climbing stairs, house robber, coin change (min coins).
   ↳ `algo-dp-2d` 2D grid DP — unique paths, minimum path sum, longest common subsequence (grid view).
   ↳ `algo-dp-knapsack` The knapsack problem — 0/1 knapsack table, item by item and capacity by capacity,
   reconstructing which items were chosen.
17. `algo-greedy` Greedy algorithms — take the best-looking choice now; activity selection (sort by end time);
   coin change with 25/10/5/1 works, with [1, 3, 4] for 6 fails; when greedy is safe; compare to DP.
