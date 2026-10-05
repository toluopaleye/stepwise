"""Differential test: run snippets in CPython and in PyRun (node), compare stdout and errors."""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

RUNNER = r'''
import sys, traceback
src = sys.stdin.read()
try:
    exec(compile(src, "main.py", "exec"), {"__name__": "__main__"})
except SystemExit:
    pass
except BaseException as e:
    sys.stdout.flush()
    print("\n@@ERROR@@" + type(e).__name__ + ": " + str(e), end="")
'''


def run_cpython(src: str, timeout=10):
    p = subprocess.run([sys.executable, "-c", RUNNER], input=src, capture_output=True, text=True, timeout=timeout)
    out = p.stdout
    err = None
    if "\n@@ERROR@@" in out:
        out, err = out.split("\n@@ERROR@@", 1)
    elif out.startswith("@@ERROR@@"):
        err = out[len("@@ERROR@@"):]
        out = ""
    if p.returncode != 0 and err is None:
        lines = [ln for ln in p.stderr.strip().splitlines() if ln.strip()]
        err = lines[-1] if lines else "crash"
    return out, err


def run_pyrun(jobs):
    p = subprocess.run(["node", str(ROOT / "tools" / "pyrun_cli.js")], input=json.dumps(jobs), capture_output=True, text=True, timeout=600)
    if p.returncode != 0:
        print(p.stderr)
        raise SystemExit("node failed")
    return {r["id"]: r for r in json.loads(p.stdout)}


def compare(snippets, show_ok=False):
    jobs = [{"id": i, "src": s} for i, s in enumerate(snippets)]
    js = run_pyrun(jobs)
    fails = 0
    for i, s in enumerate(snippets):
        out, err = run_cpython(s)
        r = js[i]
        if "crash" in r:
            fails += 1
            print(f"--- #{i} CRASH\n{s}\n{r['crash']}\n")
            continue
        jerr = None
        if r["error"]:
            jerr = r["error"]["type"] + ": " + r["error"]["message"]
        same_out = r["stdout"] == out
        same_err = (err is None and jerr is None) or (err is not None and jerr is not None and err.split(":")[0] == jerr.split(":")[0])
        exact_err = err == jerr
        if not same_out or not same_err:
            fails += 1
            print(f"--- #{i} MISMATCH\n{s}\n  cpython out: {out!r}\n  pyrun   out: {r['stdout']!r}\n  cpython err: {err}\n  pyrun   err: {jerr}\n")
        elif not exact_err:
            print(f"~~~ #{i} message differs: cpython={err!r} pyrun={jerr!r}")
        elif show_ok:
            print(f"ok #{i}")
    print(f"{len(snippets) - fails}/{len(snippets)} snippets match")
    return fails


SNIPPETS = [
# ---- printing & numbers
r'''print("Hello, world!")
print(1, 2, 3)
print("a", "b", sep="-")
print("no newline", end="")
print("!")
print()
print(None, True, False)''',
r'''print(7 + 3, 7 - 3, 7 * 3, 7 / 3, 7 // 3, 7 % 3, 7 ** 3)
print(-7 // 2, -7 % 2, 7 // -2, 7 % -2, -7 / 2)
print(2 ** 100, 2 ** -1, 10 ** 20, -2 ** 2, (-2) ** 2)
print(1e16, 1e-5, 0.1 + 0.2, 1/3, 2.0, 3.0 * 2, 10 / 2, 1e22, 123456789.123456789)
print(0.5 + 0.25, 100.0, 1.5e300 * 1e10, -0.0, 7.0 // 2, 7.5 % 2, -7.5 % 2)
print(int(3.9), int(-3.9), int("42"), int(" 17 "), float("3.5"), float(7), int(True), str(3.0))
print(round(2.5), round(3.5), round(-2.5), round(2.675, 2), round(0.125, 2), round(1234.5678, 1), round(1234.5678, -2), round(7))
print(abs(-5), abs(-2.5), max(3, 9, 1), min([4, 2, 8]), sum([1, 2, 3]), sum([0.1] * 10), pow(2, 10), pow(2, 10, 1000), divmod(17, 5), divmod(-17, 5))
print(10 == 10.0, 1 == True, 0.1 + 0.2 == 0.3, 3 < 5 < 7, 5 > 3 > 4, 2 != 2.0)
x = 5
x += 3; print(x)
x -= 1; print(x)
x *= 2; print(x)
x //= 3; print(x)
x **= 2; print(x)
x %= 7; print(x)
x /= 2; print(x)''',
r'''import math
print(math.sqrt(16), math.floor(3.7), math.ceil(3.2), math.pi, math.factorial(20), math.factorial(25), math.gcd(12, 18))
print(math.log2(1024), math.log(math.e), math.log10(1000), math.inf > 10**100, math.isqrt(17), math.hypot(3, 4))
print(2**64, 2**64 - 1, -(2**70), 12345678901234567890 * 98765432109876543210, (2**80) // 3, (2**80) % 7, 9007199254740993, 9007199254740992 + 1)
big = 1
for i in range(1, 30):
    big *= i
print(big, big % 1000007, len(str(big)))''',
# ---- strings
r'''s = "Python"
print(s[0], s[-1], s[1:4], s[:2], s[2:], s[::-1], s[::2], s[-3:], s[1:-1], s[10:], s[-100:2])
print(len(s), s.upper(), s.lower(), s.find("th"), s.find("z"), s.count("o"), s.replace("Py", "Ja"))
print("  hi  ".strip() + "|", "xxhixx".strip("x"), "a,b,,c".split(","), "a b  c".split(), " x ".lstrip(), " x ".rstrip() + "|")
print("-".join(["a", "b", "c"]), "".join(reversed("abc")), "hello world".title(), "hello".capitalize(), "Hello".swapcase())
print("abc".isalpha(), "123".isdigit(), "a1".isalnum(), " ".isspace(), "ABC".isupper(), "abc".islower(), "".isdigit())
print("hello".startswith("he"), "hello".endswith("lo"), "hello".index("l"), "a-b-c".split("-", 1), "hello"[1:100])
print("ab" * 3, "a" + "b", "x" in "xyz", "q" not in "xyz", "abc" < "abd", "Z" < "a", ord("A"), chr(97))
print(repr("it's"), repr('say "hi"'), repr("both ' and \""), repr("tab\there"), repr("new\nline"), repr("back\\slash"))
print("Line1\nLine2\tTabbed")
print('single', "double", """triple
quoted""")
print("%s is %d years" % ("Sam", 12), "%.2f" % 3.14159, "%5s|%-5s|" % ("ab", "cd"), "100%%")''',
r'''name = "Ada"
age = 36
pi = 3.14159265
print(f"{name} is {age}")
print(f"{pi:.2f} {pi:.0f} {age:5d}|{age:<5d}|{age:^7}|{name:>6}|{name:*^9}|")
print(f"{1234567:,} {0.256:.1%} {255:x} {255:#x} {5:03d} {-3.5:+.1f} {3:b} {1e10:.2e} {0.000123:g} {123456789:g} {2.5:g}")
print(f"{name!r} {age=} {pi=:.3f} {'nested'} {[1, 2][0]} {{literal}}")
w = 8
print(f"{name:>{w}}|", "{} and {}".format(1, "a"), "{1}{0}".format("a", "b"), "{x:>3}".format(x=7), "{:.3f}".format(2/3))
print(format(3.14159, ".3f"), format(42, "08b"), format("hi", "^6") + "|", str(12), str(1.0), str(None))''',
# ---- lists
r'''nums = [5, 3, 8, 1]
nums.append(7)
nums.insert(0, 10)
print(nums, len(nums), nums[0], nums[-1], nums[1:3])
nums.remove(8)
last = nums.pop()
first = nums.pop(0)
print(nums, last, first, nums.index(3), nums.count(3), 3 in nums, 99 in nums)
nums.sort()
print(nums)
nums.sort(reverse=True)
print(nums)
nums.reverse()
print(nums, sorted([3, 1, 2]), sorted([3, 1, 2], reverse=True), sorted(["b", "A", "c"]), sorted(["b", "A", "c"], key=str.lower))
words = ["kiwi", "fig", "banana", "apple"]
print(sorted(words, key=len), sorted(words, key=lambda w: (len(w), w)), max(words, key=len), min(words))
a = [1, 2, 3]
b = a
b.append(4)
c = a[:]
c.append(5)
print(a, b, c, a is b, a == b, a is c)
a[1:3] = [20, 30, 40]
print(a)
del a[0]
print(a)
del a[1:3]
print(a, [0] * 5, [1, 2] + [3], list("abc"), list(range(5)), list(range(10, 0, -3)))
grid = [[0] * 3 for _ in range(2)]
grid[0][1] = 5
print(grid, [[1, 2], [3, 4]][1][0])
m = [[1, 2, 3], [4, 5, 6]]
print([row[1] for row in m], [x * 2 for x in range(5) if x % 2 == 0], [(i, j) for i in range(2) for j in range(2)])
print([x for x in [3, -1, 4, -1, 5] if x > 0], list(map(str, [1, 2])), list(filter(None, [0, 1, 2, ""])), list(zip([1, 2, 3], "ab")))
print(list(enumerate(["a", "b"])), list(enumerate("xy", start=1)), sum(x * x for x in range(4)), any([0, 0, 1]), all([1, 1, 0]))''',
# ---- dicts, sets, tuples
r'''ages = {"Ann": 31, "Bob": 25}
ages["Cy"] = 40
ages["Ann"] = 32
print(ages, len(ages), ages["Bob"], ages.get("Zed"), ages.get("Zed", 0), "Ann" in ages, 31 in ages)
print(list(ages.keys()), list(ages.values()), list(ages.items()))
for name, age in ages.items():
    print(name, age)
print(ages.pop("Bob"), ages, ages.setdefault("Dee", 1), ages)
ages.update({"Eve": 5})
print(ages, {k: v * 2 for k, v in ages.items() if v > 3}, dict(a=1, b=2), dict([("x", 1)]), dict.fromkeys("ab", 0))
counts = {}
for ch in "banana":
    counts[ch] = counts.get(ch, 0) + 1
print(counts, sorted(counts.items(), key=lambda kv: kv[1], reverse=True))
print(ages.keys(), ages.values(), ages.items())
s = {3, 1, 2}
s.add(5)
s.add(1)
print(s, len(s), 2 in s, {1, 2} | {2, 3}, {1, 2} & {2, 3}, {1, 2} - {2, 3}, {1, 2} ^ {2, 3}, set(), set("aab") == {"a", "b"})
print({10, 5, 100}, {8, 16, 24, 1}, {-1, -2, 5}, set(range(20, 0, -3)), {100, 200, 300, 7, 9}, sorted({"b", "a"}))
s.discard(99)
s.remove(3)
print(s, {1, 2} <= {1, 2, 3}, {1, 2}.issubset([1, 2]), {x % 3 for x in range(10)})
t = (1, 2, 3)
a, b, c = t
print(t, t[1], a + b + c, len(t), (1,), (), tuple([4, 5]), t + (4,), t * 2, t.count(2), t.index(3))
first, *rest = [1, 2, 3, 4]
*init, last = "abc"
print(first, rest, init, last)
x, y = 1, 2
x, y = y, x
print(x, y)
pairs = [(1, "b"), (1, "a"), (0, "z")]
print(sorted(pairs), max(pairs), (1, 2) < (1, 3), [1, 2] < [1, 2, 0])''',
# ---- control flow
r'''for i in range(3):
    if i == 1:
        continue
    print("i", i)
for i in range(10):
    if i == 3:
        break
else:
    print("never")
for i in range(2):
    pass
else:
    print("loop finished")
n = 10
steps = 0
while n != 1:
    n = n // 2 if n % 2 == 0 else 3 * n + 1
    steps += 1
print("steps", steps)
k = 0
while k < 3:
    k += 1
else:
    print("while else", k)
score = 72
if score >= 90:
    grade = "A"
elif score >= 70:
    grade = "C"
else:
    grade = "F"
print(grade, "yes" if score > 50 else "no", not score, score and "truthy", 0 or "default", None or 0)
for i in range(1, 4):
    for j in range(1, 4):
        if j > i:
            break
        print(i * j, end=" ")
    print()''',
# ---- functions
r'''def greet(name, greeting="Hello"):
    return f"{greeting}, {name}!"
print(greet("Sam"), greet("Ann", "Hi"), greet(greeting="Yo", name="Bo"))
def total(*nums, start=0):
    return sum(nums) + start
print(total(1, 2, 3), total(start=10), total(1, start=1))
def info(**kw):
    return sorted(kw.items())
print(info(b=2, a=1))
def fact(n):
    return 1 if n <= 1 else n * fact(n - 1)
print(fact(10), fact(30))
def fib(n):
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)
print([fib(i) for i in range(12)])
def make_counter():
    count = 0
    def inc():
        nonlocal count
        count += 1
        return count
    return inc
c = make_counter()
c(); c()
print(c())
total_calls = 0
def track():
    global total_calls
    total_calls += 1
track(); track()
print(total_calls)
square = lambda x: x * x
print(square(7), (lambda a, b=2: a + b)(1), list(map(lambda x: x + 1, [1, 2])))
def apply(f, v):
    return f(v)
print(apply(len, "abc"), apply(str.upper, "abc"))
def no_return():
    x = 1
print(no_return())
def multi():
    return 1, 2
a, b = multi()
print(a, b, multi())
def outer():
    x = "outer"
    def inner():
        return x + "!"
    return inner()
print(outer())''',
# ---- classes
r'''class Dog:
    species = "canine"
    def __init__(self, name, age):
        self.name = name
        self.age = age
    def bark(self):
        return f"{self.name} says woof"
    def birthday(self):
        self.age += 1
    def __str__(self):
        return f"Dog({self.name}, {self.age})"
d = Dog("Rex", 3)
d.birthday()
print(d.bark(), d.age, d, str(d), d.species, Dog.species, isinstance(d, Dog), type(d).__name__)
class Point:
    def __init__(self, x, y):
        self.x, self.y = x, y
    def __repr__(self):
        return f"Point({self.x}, {self.y})"
    def __eq__(self, other):
        return self.x == other.x and self.y == other.y
    def __lt__(self, other):
        return (self.x, self.y) < (other.x, other.y)
    def __add__(self, other):
        return Point(self.x + other.x, self.y + other.y)
pts = [Point(2, 1), Point(1, 5), Point(1, 2)]
print(sorted(pts), Point(1, 2) == Point(1, 2), Point(1, 1) + Point(2, 3), [pts[0]], min(pts))
class Animal:
    def __init__(self, name):
        self.name = name
    def speak(self):
        return "..."
    def intro(self):
        return f"I am {self.name} and I say {self.speak()}"
class Cat(Animal):
    def __init__(self, name, indoor):
        super().__init__(name)
        self.indoor = indoor
    def speak(self):
        return "meow"
c = Cat("Tom", True)
print(c.intro(), isinstance(c, Animal), issubclass(Cat, Animal), c.indoor)
class Stack:
    def __init__(self):
        self.items = []
    def push(self, x):
        self.items.append(x)
    def pop(self):
        return self.items.pop()
    def __len__(self):
        return len(self.items)
    def is_empty(self):
        return len(self) == 0
s = Stack()
s.push(1); s.push(2)
print(s.pop(), len(s), s.is_empty(), bool(Stack()))
class Temp:
    count = 0
    def __init__(self, c):
        self._c = c
        Temp.count += 1
    @property
    def f(self):
        return self._c * 9 / 5 + 32
    @staticmethod
    def info():
        return "temps"
    @classmethod
    def made(cls):
        return cls.count
t = Temp(100)
Temp(0)
print(t.f, Temp.info(), Temp.made(), t.made())''',
# ---- exceptions
r'''def safe_div(a, b):
    try:
        result = a / b
    except ZeroDivisionError:
        return "cannot divide by zero"
    else:
        return result
    finally:
        print("done", a, b)
print(safe_div(6, 3))
print(safe_div(1, 0))
try:
    int("abc")
except ValueError as e:
    print("ValueError:", e)
try:
    [1, 2][5]
except (KeyError, IndexError) as e:
    print(type(e).__name__, e)
try:
    {}["missing"]
except KeyError as e:
    print("KeyError", e, repr(e))
class InsufficientFunds(Exception):
    pass
def withdraw(balance, amount):
    if amount > balance:
        raise InsufficientFunds(f"need {amount - balance} more")
    return balance - amount
try:
    withdraw(10, 25)
except InsufficientFunds as e:
    print("caught:", e)
try:
    raise ValueError("bad value")
except Exception as e:
    print(type(e).__name__, e.args)
def check(x):
    assert x > 0, "x must be positive"
    return x
try:
    check(-1)
except AssertionError as e:
    print("assert:", e)
try:
    try:
        1 / 0
    except ZeroDivisionError:
        raise
except ZeroDivisionError as e:
    print("reraised", e)''',
r'''def f(nums):
    return nums[0]
print("before")
f([])''',
r'''total = 0
for i in range(3):
    total += i
print(total)
print(totl)''',
r'''def f():
    x += 1
f()''',
r'''print("a" + 5)''',
r'''x = [1, 2, 3]
x.push(4)''',
r'''def g(a, b):
    return a + b
g(1)''',
r'''d = {"a": 1}
print(d["b"])''',
r'''n = int("twelve")''',
r'''def r(n):
    return r(n + 1)
r(0)''',
r'''for i in range(3)
    print(i)''',
r'''if True:
print("x")''',
r'''x = (1, 2''',
r'''print("hi)''',
r'''  print("indented")''',
r'''if x = 5:
    pass''',
r'''class A:
    def __init__(self, x):
        self.x = x
A()''',
r'''t = (1, 2)
t[0] = 5''',
r'''print(len(5))''',
r'''a, b = [1, 2, 3]''',
r'''None.upper()''',
# ---- modules
r'''from collections import deque, Counter, defaultdict
q = deque([1, 2, 3])
q.append(4)
q.appendleft(0)
print(q, q.popleft(), q.pop(), q, len(q), q[0], q[-1], list(q))
c = Counter("abracadabra")
print(c, c["a"], c["z"], c.most_common(2))
c2 = Counter(["x", "y", "x"])
print(c2, sorted(c2.elements()))
g = defaultdict(list)
g["a"].append(1)
g["a"].append(2)
g["b"].append(3)
print(g, dict(g), g["c"], len(g))
dd = defaultdict(int)
for w in "the cat the hat".split():
    dd[w] += 1
print(dd, dict(dd))''',
r'''import heapq
h = []
for x in [5, 1, 8, 3, 9, 2, 7]:
    heapq.heappush(h, x)
print(h)
print([heapq.heappop(h) for _ in range(3)], h)
nums = [9, 4, 7, 1, 8, 2, 6]
heapq.heapify(nums)
print(nums, heapq.nsmallest(3, [5, 1, 4, 2]), heapq.nlargest(2, [5, 1, 4, 2]))
pq = []
heapq.heappush(pq, (2, "b"))
heapq.heappush(pq, (1, "z"))
heapq.heappush(pq, (1, "a"))
print(heapq.heappop(pq), heapq.heappop(pq), pq)''',
r'''from functools import lru_cache
@lru_cache(maxsize=None)
def fib(n):
    return n if n < 2 else fib(n - 1) + fib(n - 2)
print(fib(80), fib(100))
memo = {}
def climb(n):
    if n <= 2:
        return n
    if n in memo:
        return memo[n]
    memo[n] = climb(n - 1) + climb(n - 2)
    return memo[n]
print(climb(45), len(memo))
import bisect
a = [1, 3, 3, 5, 8]
print(bisect.bisect_left(a, 3), bisect.bisect_right(a, 3), bisect.bisect_left(a, 4))
bisect.insort(a, 4)
print(a)
from itertools import permutations, combinations, product
print(list(permutations([1, 2, 3])), list(combinations("abc", 2)), list(product([0, 1], repeat=2)))''',
# ---- algorithms
r'''def binary_search(nums, target):
    lo, hi = 0, len(nums) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if nums[mid] == target:
            return mid
        if nums[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1
data = [2, 5, 8, 12, 16, 23, 38, 56, 72, 91]
print(binary_search(data, 23), binary_search(data, 7), binary_search([], 1))
def bubble(a):
    a = a[:]
    n = len(a)
    for i in range(n):
        for j in range(n - 1 - i):
            if a[j] > a[j + 1]:
                a[j], a[j + 1] = a[j + 1], a[j]
    return a
def merge_sort(a):
    if len(a) <= 1:
        return a
    mid = len(a) // 2
    left, right = merge_sort(a[:mid]), merge_sort(a[mid:])
    out = []
    i = j = 0
    while i < len(left) and j < len(right):
        if left[i] <= right[j]:
            out.append(left[i]); i += 1
        else:
            out.append(right[j]); j += 1
    out.extend(left[i:])
    out.extend(right[j:])
    return out
def quick_sort(a):
    if len(a) <= 1:
        return a
    pivot = a[len(a) // 2]
    return quick_sort([x for x in a if x < pivot]) + [x for x in a if x == pivot] + quick_sort([x for x in a if x > pivot])
arr = [38, 27, 43, 3, 9, 82, 10]
print(bubble(arr), merge_sort(arr), quick_sort(arr), arr)
def two_sum_sorted(nums, target):
    l, r = 0, len(nums) - 1
    while l < r:
        s = nums[l] + nums[r]
        if s == target:
            return (l, r)
        if s < target:
            l += 1
        else:
            r -= 1
    return None
print(two_sum_sorted([1, 3, 4, 6, 9], 10))
def max_window(nums, k):
    window = sum(nums[:k])
    best = window
    for i in range(k, len(nums)):
        window += nums[i] - nums[i - k]
        best = max(best, window)
    return best
print(max_window([2, 1, 5, 1, 3, 2], 3))''',
r'''from collections import deque
graph = {"A": ["B", "C"], "B": ["D"], "C": ["D", "E"], "D": ["F"], "E": ["F"], "F": []}
def bfs(start):
    seen = {start}
    order = []
    q = deque([start])
    while q:
        node = q.popleft()
        order.append(node)
        for nb in graph[node]:
            if nb not in seen:
                seen.add(nb)
                q.append(nb)
    return order
def dfs(node, seen=None):
    if seen is None:
        seen = []
    seen.append(node)
    for nb in graph[node]:
        if nb not in seen:
            dfs(nb, seen)
    return seen
print(bfs("A"), dfs("A"))
import heapq
wg = {"A": [("B", 4), ("C", 1)], "B": [("D", 1)], "C": [("B", 2), ("D", 5)], "D": []}
def dijkstra(src):
    dist = {node: float("inf") for node in wg}
    dist[src] = 0
    pq = [(0, src)]
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist[u]:
            continue
        for v, w in wg[u]:
            if d + w < dist[v]:
                dist[v] = d + w
                heapq.heappush(pq, (dist[v], v))
    return dist
print(dijkstra("A"))
indeg = {n: 0 for n in graph}
for n in graph:
    for m in graph[n]:
        indeg[m] += 1
q = deque([n for n in graph if indeg[n] == 0])
topo = []
while q:
    n = q.popleft()
    topo.append(n)
    for m in graph[n]:
        indeg[m] -= 1
        if indeg[m] == 0:
            q.append(m)
print(topo)
visited = set()
for x in [4, 1, 9, 1, 0, 33]:
    visited.add(x)
print(visited, len(visited))''',
r'''class Node:
    def __init__(self, val, next=None):
        self.val = val
        self.next = next
head = Node(1, Node(2, Node(3)))
def to_list(h):
    out = []
    while h:
        out.append(h.val)
        h = h.next
    return out
def reverse(h):
    prev = None
    cur = h
    while cur:
        nxt = cur.next
        cur.next = prev
        prev = cur
        cur = nxt
    return prev
print(to_list(head), to_list(reverse(head)))
class TreeNode:
    def __init__(self, val):
        self.val = val
        self.left = None
        self.right = None
def insert(root, val):
    if root is None:
        return TreeNode(val)
    if val < root.val:
        root.left = insert(root.left, val)
    else:
        root.right = insert(root.right, val)
    return root
def inorder(root):
    return inorder(root.left) + [root.val] + inorder(root.right) if root else []
def height(root):
    return 0 if root is None else 1 + max(height(root.left), height(root.right))
root = None
for v in [8, 3, 10, 1, 6, 14, 4, 7, 13]:
    root = insert(root, v)
print(inorder(root), height(root))
def subsets(nums):
    res = []
    def bt(i, path):
        if i == len(nums):
            res.append(path[:])
            return
        path.append(nums[i])
        bt(i + 1, path)
        path.pop()
        bt(i + 1, path)
    bt(0, [])
    return res
print(subsets([1, 2, 3]))
def lcs(a, b):
    dp = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            if a[i - 1] == b[j - 1]:
                dp[i][j] = dp[i - 1][j - 1] + 1
            else:
                dp[i][j] = max(dp[i - 1][j], dp[i][j - 1])
    return dp[-1][-1]
print(lcs("ABCBDAB", "BDCABA"))
def coin_change(coins, amount):
    dp = [0] + [float("inf")] * amount
    for a in range(1, amount + 1):
        for c in coins:
            if c <= a:
                dp[a] = min(dp[a], dp[a - c] + 1)
    return dp[amount] if dp[amount] != float("inf") else -1
print(coin_change([1, 5, 10, 25], 63), coin_change([2], 3))
intervals = [(1, 3), (2, 4), (3, 5), (0, 7), (5, 8)]
intervals.sort(key=lambda x: x[1])
chosen = []
end = float("-inf")
for s, e in intervals:
    if s >= end:
        chosen.append((s, e))
        end = e
print(chosen)''',
r'''print(type(5), type("a"), type(None), type([]), type(3.5), type(True), type({}), type((1,)), type({1}))
class A: pass
print(A, type(A()).__name__, isinstance(True, int), isinstance(5, (str, int)), callable(len), callable(5))
print(print, len, [].append is not None)
x = None
print(x is None, x is not None, x == None)
print(list(range(0)), range(5), range(1, 10, 2), len(range(3, 30, 4)), 7 in range(1, 10, 2), range(10)[-1], range(10)[2:5])
print(str(1 / 3), 2 / 3, 100 / 7, 22 / 7 * 1000000, 1 / 1024, 5e-324, 1.7976931348623157e308)
print(hash(5), hash(True), int("ff", 16), bin(10), hex(255), oct(8), int("0b101", 0))
print("done")''',
    # deques with maxlen: repr, extend, extendleft, copy, appendleft; rotate both ways
    '''from collections import deque
d = deque([1, 2, 3], maxlen=3)
d.extend([4, 5])
print(d)
d.extendleft([9, 8])
print(d)
c = d.copy()
c.append(0)
print(c, d)
e = deque(maxlen=2)
for x in [1, 2, 3]:
    e.appendleft(x)
print(e, len(e))
f = deque("abc")
f.rotate()
print(f)
f.rotate(-4)
print(f, f[1], f[-1], repr(deque()), bool(deque()))''',
]

if __name__ == "__main__":
    import bundle_py  # noqa
    (ROOT / "dist").mkdir(exist_ok=True)
    (ROOT / "dist" / "pyrun.js").write_text(bundle_py.bundle())
    fails = compare(SNIPPETS, show_ok="-v" in sys.argv)
    sys.exit(1 if fails else 0)
