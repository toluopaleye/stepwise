"""Batch CPython executor used by build.py.

Reads a JSON list of jobs on stdin and writes JSON results to stdout.
  {kind: "run", src}                      -> {stdout, error}
  {kind: "tests", src, tests: [code]}     -> {stdout, error, results: [{repr, stdout, error}]}
  {kind: "trace", src, captions, show, max} -> {frames, stdout, error}
  {kind: "value", src, name}              -> {value: json, repr, error}
"""
import ast
import builtins
import contextlib
import io
import json
import signal
import sys
import types


class Timeout(Exception):
    pass


def _alarm(signum, frame):
    raise Timeout("timed out")


signal.signal(signal.SIGALRM, _alarm)


def err_text(e):
    return f"{type(e).__name__}: {e}" if str(e) else type(e).__name__


LAST_TB = [None]


def format_tb(e, src, filename="main.py"):
    """CPython's own traceback text, with the user's file as main.py and runner frames removed."""
    import linecache
    import traceback
    linecache.cache[filename] = (len(src), None, src.splitlines(True), filename)
    if isinstance(e, SyntaxError) and e.text is None and e.lineno:
        # compiler errors (e.g. 'return' outside function) read the line from the file; we have it here
        lines = src.splitlines()
        if 0 < e.lineno <= len(lines):
            e.text = lines[e.lineno - 1] + "\n"
    te = traceback.TracebackException.from_exception(e)
    te.stack = traceback.StackSummary.from_list([f for f in te.stack if f.filename == filename])
    text = "".join(te.format())
    if not te.stack:
        text = "".join(te.format_exception_only())
    return text.rstrip("\n")


def harness_depth():
    d = 0
    f = sys._getframe(1)
    while f is not None:
        d += 1
        f = f.f_back
    return d


_real_getlimit = sys.getrecursionlimit
_real_setlimit = sys.setrecursionlimit
HARNESS_EXTRA = [0]


def _user_getlimit():
    return _real_getlimit() - HARNESS_EXTRA[0]


def _user_setlimit(n):
    _real_setlimit(n + HARNESS_EXTRA[0])


def run_src(src, ns, filename="main.py"):
    out = io.StringIO()
    error = None
    LAST_TB[0] = None
    # give the program the same recursion room it would have when run as a file, and let
    # sys.getrecursionlimit() / setrecursionlimit() see the limit a program run as a file would see
    HARNESS_EXTRA[0] = harness_depth()
    _real_setlimit(1000 + HARNESS_EXTRA[0])
    sys.getrecursionlimit = _user_getlimit
    sys.setrecursionlimit = _user_setlimit
    signal.alarm(5)
    try:
        with contextlib.redirect_stdout(out):
            exec(compile(src, filename, "exec"), ns)
    except Timeout:
        error = "Timeout: took too long"
    except BaseException as e:  # noqa
        error = err_text(e)
        try:
            LAST_TB[0] = format_tb(e, src, filename)
        except Exception:  # noqa
            LAST_TB[0] = None
    finally:
        signal.alarm(0)
    return out.getvalue(), error


def eval_test(code, ns):
    tree = ast.parse(code, mode="exec")
    out = io.StringIO()
    value = None
    error = None
    signal.alarm(5)
    try:
        with contextlib.redirect_stdout(out):
            if tree.body and isinstance(tree.body[-1], ast.Expr):
                last = tree.body.pop()
                exec(compile(tree, "test", "exec"), ns)
                value = eval(compile(ast.Expression(last.value), "test", "eval"), ns)
            else:
                exec(compile(tree, "test", "exec"), ns)
    except Timeout:
        error = "Timeout: took too long"
    except BaseException as e:  # noqa
        error = err_text(e)
    finally:
        signal.alarm(0)
    return value, out.getvalue(), error


MAX_SEQ = 80


def enc(v, seen, depth=0):
    """Encode a Python value as compact JSON for the animation renderer."""
    if v is None or isinstance(v, bool):
        return v
    if isinstance(v, int):
        return v if abs(v) < 2**53 else {"$i": str(v)}
    if isinstance(v, float):
        return {"$f": repr(v)}
    if isinstance(v, str):
        return v if len(v) <= 300 else v[:300] + "…"
    if depth > 6:
        return {"$x": "…"}
    if isinstance(v, (list, tuple, set, frozenset)) or type(v).__name__ == "deque":
        items = list(v)
        tag = "$l" if isinstance(v, list) else "$t" if isinstance(v, tuple) else "$q" if type(v).__name__ == "deque" else "$s"
        body = [enc(x, seen, depth + 1) for x in items[:MAX_SEQ]]
        res = {tag: body}
        if len(items) > MAX_SEQ:
            res["more"] = len(items) - MAX_SEQ
        return res
    if isinstance(v, dict):
        kind = type(v).__name__
        res = {"$d": [[enc(k, seen, depth + 1), enc(x, seen, depth + 1)] for k, x in list(v.items())[:MAX_SEQ]]}
        if kind in ("Counter", "defaultdict"):
            res["k"] = kind
        return res
    if isinstance(v, types.FunctionType):
        return {"$fn": v.__name__}
    if isinstance(v, type):
        return {"$cls": v.__name__}
    if isinstance(v, types.ModuleType):
        return {"$mod": v.__name__}
    if hasattr(v, "__dict__") and type(v).__module__ == "__main__":
        oid = id(v)
        if oid in seen:
            return {"$r": seen[oid]}
        seen[oid] = len(seen) + 1
        fields = {k: enc(x, seen, depth + 1) for k, x in vars(v).items()}
        return {"$o": seen[oid], "c": type(v).__name__, "f": fields}
    return {"$x": repr(v)[:200]}


def fill_caption(tpl, frame):
    if not tpl:
        return None
    out = []
    i = 0
    while i < len(tpl):
        c = tpl[i]
        if c == "{":
            j = tpl.find("}", i)
            if j < 0:
                out.append(tpl[i:])
                break
            expr = tpl[i + 1:j]
            conv = None
            if expr.endswith("!r"):
                expr, conv = expr[:-2], "r"
            try:
                val = eval(expr, frame.f_globals, frame.f_locals)
                out.append(repr(val) if conv == "r" else str(val))
            except Exception:  # noqa
                out.append("{" + tpl[i + 1:j] + "}")
            i = j + 1
        else:
            out.append(c)
            i += 1
    return "".join(out)


SKIP_GLOBALS = set(dir(builtins)) | {"__name__", "__builtins__"}


def snapshot(frame, show):
    frames = []
    f = frame
    while f is not None:
        if f.f_code.co_filename == "<anim>":
            frames.append(f)
        f = f.f_back
    frames.reverse()
    seen = {}
    res = []
    for f in frames:
        name = f.f_code.co_name
        local = f.f_globals if name == "<module>" else f.f_locals
        vs = {}
        for k, v in local.items():
            # ".0" is the hidden iterator Python passes to a generator expression: not a learner's variable
            if k.startswith("__") or not k.isidentifier() or isinstance(v, types.ModuleType):
                continue
            if name == "<module>" and k in SKIP_GLOBALS and k not in show:
                continue
            if show and k not in show and not isinstance(v, (types.FunctionType, type)):
                continue
            if show and isinstance(v, (types.FunctionType, type)) and k not in show:
                continue
            vs[k] = enc(v, seen)
        res.append({"fn": name, "line": f.f_lineno, "vars": vs})
    return res


class TooLong(Exception):
    pass


def trace(src, captions, show, max_frames):
    out = io.StringIO()
    frames = []
    ns = {"__name__": "__main__"}
    code = compile(src, "<anim>", "exec")
    caps = {int(k): v for k, v in (captions or {}).items()}

    def tracer(frame, event, arg):
        if frame.f_code.co_filename != "<anim>":
            return None
        if event in ("line", "return"):
            if event == "return" and frame.f_code.co_name == "<module>":
                return tracer
            rec = {"l": frame.f_lineno, "ev": event, "st": snapshot(frame, show), "out": out.getvalue()}
            cap = fill_caption(caps.get(frame.f_lineno), frame) if event == "line" else None
            if cap:
                rec["cap"] = cap
            if event == "return":
                rec["ret"] = enc(arg, {})
            frames.append(rec)
            if len(frames) > max_frames:
                raise TooLong()
        return tracer

    error = None
    err_line = None
    signal.alarm(5)
    sys.settrace(tracer)
    try:
        with contextlib.redirect_stdout(out):
            exec(code, ns)
    except TooLong:
        error = f"TooLong: more than {max_frames} steps"
    except Timeout:
        error = "Timeout"
    except BaseException as e:  # noqa
        error = err_text(e)
        tb = e.__traceback__
        while tb is not None:
            if tb.tb_frame.f_code.co_filename == "<anim>":
                err_line = tb.tb_lineno
            tb = tb.tb_next
    finally:
        sys.settrace(None)
        signal.alarm(0)
    # final frame: whole program finished (or stopped with an error)
    seen = {}
    final_vars = {k: enc(v, seen) for k, v in ns.items()
                  if not k.startswith("__") and not isinstance(v, types.ModuleType) and (not show or k in show)}
    end = {"l": err_line, "ev": "end", "st": [{"fn": "<module>", "line": None, "vars": final_vars}], "out": out.getvalue()}
    if err_line is not None:
        end["err"] = error
    frames.append(end)
    return {"frames": frames, "stdout": out.getvalue(), "error": error}


def main():
    jobs = json.load(sys.stdin)
    results = []
    for job in jobs:
        kind = job["kind"]
        try:
            if kind == "run":
                stdout, error = run_src(job["src"], {"__name__": "__main__"}, job.get("filename", "main.py"))
                results.append({"stdout": stdout, "error": error, "traceback": LAST_TB[0]})
            elif kind == "tests":
                ns = {"__name__": "__main__"}
                if job.get("pre"):
                    _, perr = run_src(job["pre"], ns, "setup.py")
                    if perr:
                        results.append({"stdout": "", "error": "setup failed: " + perr, "results": []})
                        continue
                stdout, error = run_src(job["src"], ns)
                res = []
                if error is None:
                    for code in job["tests"]:
                        value, tout, terr = eval_test(code, ns)
                        res.append({"repr": None if terr else repr(value), "stdout": tout, "error": terr})
                results.append({"stdout": stdout, "error": error, "results": res})
            elif kind == "trace":
                results.append(trace(job["src"], job.get("captions"), set(job.get("show") or []), job.get("max", 300)))
            elif kind == "value":
                ns = {"__name__": "__main__"}
                stdout, error = run_src(job["src"], ns)
                if error:
                    results.append({"error": error})
                else:
                    v = ns.get(job["name"])
                    results.append({"repr": repr(v), "value": enc(v, {}), "stdout": stdout, "error": None})
            else:
                results.append({"error": "unknown job"})
        except BaseException as e:  # noqa
            results.append({"error": "runner crash: " + err_text(e)})
    json.dump(results, sys.stdout)


if __name__ == "__main__":
    main()
