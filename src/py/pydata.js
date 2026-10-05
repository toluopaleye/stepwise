// ===== Data copied from CPython 3.13 (names used for error suggestions) =====
const PY_BUILTIN_NAMES = ["__name__", "__doc__", "__package__", "__loader__", "__spec__", "__build_class__", "__import__", "abs", "all", "any", "ascii", "bin", "breakpoint", "callable", "chr", "compile", "delattr", "dir", "divmod", "eval", "exec", "format", "getattr", "globals", "hasattr", "hash", "hex", "id", "input", "isinstance", "issubclass", "iter", "aiter", "len", "locals", "max", "min", "next", "anext", "oct", "ord", "pow", "print", "repr", "round", "setattr", "sorted", "sum", "vars", "None", "Ellipsis", "NotImplemented", "False", "True", "bool", "memoryview", "bytearray", "bytes", "classmethod", "complex", "dict", "enumerate", "filter", "float", "frozenset", "property", "int", "list", "map", "object", "range", "reversed", "set", "slice", "staticmethod", "str", "super", "tuple", "type", "zip", "__debug__", "BaseException", "BaseExceptionGroup", "Exception", "GeneratorExit", "KeyboardInterrupt", "SystemExit", "ArithmeticError", "AssertionError", "AttributeError", "BufferError", "EOFError", "ImportError", "LookupError", "MemoryError", "NameError", "OSError", "ReferenceError", "RuntimeError", "StopAsyncIteration", "StopIteration", "SyntaxError", "SystemError", "TypeError", "ValueError", "Warning", "FloatingPointError", "OverflowError", "ZeroDivisionError", "BytesWarning", "DeprecationWarning", "EncodingWarning", "FutureWarning", "ImportWarning", "PendingDeprecationWarning", "ResourceWarning", "RuntimeWarning", "SyntaxWarning", "UnicodeWarning", "UserWarning", "BlockingIOError", "ChildProcessError", "ConnectionError", "FileExistsError", "FileNotFoundError", "InterruptedError", "IsADirectoryError", "NotADirectoryError", "PermissionError", "ProcessLookupError", "TimeoutError", "IndentationError", "_IncompleteInputError", "IndexError", "KeyError", "ModuleNotFoundError", "NotImplementedError", "PythonFinalizationError", "RecursionError", "UnboundLocalError", "UnicodeError", "BrokenPipeError", "ConnectionAbortedError", "ConnectionRefusedError", "ConnectionResetError", "TabError", "UnicodeDecodeError", "UnicodeEncodeError", "UnicodeTranslateError", "ExceptionGroup", "EnvironmentError", "IOError", "open", "quit", "exit", "copyright", "credits", "license", "help"];
const PY_STDLIB_MODULES = new Set(["__future__", "_abc", "_aix_support", "_android_support", "_apple_support", "_ast", "_asyncio", "_bisect", "_blake2", "_bz2", "_codecs", "_codecs_cn", "_codecs_hk", "_codecs_iso2022", "_codecs_jp", "_codecs_kr", "_codecs_tw", "_collections", "_collections_abc", "_colorize", "_compat_pickle", "_compression", "_contextvars", "_csv", "_ctypes", "_curses", "_curses_panel", "_datetime", "_dbm", "_decimal", "_elementtree", "_frozen_importlib", "_frozen_importlib_external", "_functools", "_gdbm", "_hashlib", "_heapq", "_imp", "_interpchannels", "_interpqueues", "_interpreters", "_io", "_ios_support", "_json", "_locale", "_lsprof", "_lzma", "_markupbase", "_md5", "_multibytecodec", "_multiprocessing", "_opcode", "_opcode_metadata", "_operator", "_osx_support", "_overlapped", "_pickle", "_posixshmem", "_posixsubprocess", "_py_abc", "_pydatetime", "_pydecimal", "_pyio", "_pylong", "_pyrepl", "_queue", "_random", "_scproxy", "_sha1", "_sha2", "_sha3", "_signal", "_sitebuiltins", "_socket", "_sqlite3", "_sre", "_ssl", "_stat", "_statistics", "_string", "_strptime", "_struct", "_suggestions", "_symtable", "_sysconfig", "_thread", "_threading_local", "_tkinter", "_tokenize", "_tracemalloc", "_typing", "_uuid", "_warnings", "_weakref", "_weakrefset", "_winapi", "_wmi", "_zoneinfo", "abc", "antigravity", "argparse", "array", "ast", "asyncio", "atexit", "base64", "bdb", "binascii", "bisect", "builtins", "bz2", "cProfile", "calendar", "cmath", "cmd", "code", "codecs", "codeop", "collections", "colorsys", "compileall", "concurrent", "configparser", "contextlib", "contextvars", "copy", "copyreg", "csv", "ctypes", "curses", "dataclasses", "datetime", "dbm", "decimal", "difflib", "dis", "doctest", "email", "encodings", "ensurepip", "enum", "errno", "faulthandler", "fcntl", "filecmp", "fileinput", "fnmatch", "fractions", "ftplib", "functools", "gc", "genericpath", "getopt", "getpass", "gettext", "glob", "graphlib", "grp", "gzip", "hashlib", "heapq", "hmac", "html", "http", "idlelib", "imaplib", "importlib", "inspect", "io", "ipaddress", "itertools", "json", "keyword", "linecache", "locale", "logging", "lzma", "mailbox", "marshal", "math", "mimetypes", "mmap", "modulefinder", "msvcrt", "multiprocessing", "netrc", "nt", "ntpath", "nturl2path", "numbers", "opcode", "operator", "optparse", "os", "pathlib", "pdb", "pickle", "pickletools", "pkgutil", "platform", "plistlib", "poplib", "posix", "posixpath", "pprint", "profile", "pstats", "pty", "pwd", "py_compile", "pyclbr", "pydoc", "pydoc_data", "pyexpat", "queue", "quopri", "random", "re", "readline", "reprlib", "resource", "rlcompleter", "runpy", "sched", "secrets", "select", "selectors", "shelve", "shlex", "shutil", "signal", "site", "smtplib", "socket", "socketserver", "sqlite3", "sre_compile", "sre_constants", "sre_parse", "ssl", "stat", "statistics", "string", "stringprep", "struct", "subprocess", "symtable", "sys", "sysconfig", "syslog", "tabnanny", "tarfile", "tempfile", "termios", "textwrap", "this", "threading", "time", "timeit", "tkinter", "token", "tokenize", "tomllib", "trace", "traceback", "tracemalloc", "tty", "turtle", "turtledemo", "types", "typing", "unicodedata", "unittest", "urllib", "uuid", "venv", "warnings", "wave", "weakref", "webbrowser", "winreg", "winsound", "wsgiref", "xml", "xmlrpc", "zipapp", "zipfile", "zipimport", "zlib", "zoneinfo"]);
const PY_TYPE_DIRS = {"str": ["capitalize", "casefold", "center", "count", "encode", "endswith", "expandtabs", "find", "format", "format_map", "index", "isalnum", "isalpha", "isascii", "isdecimal", "isdigit", "isidentifier", "islower", "isnumeric", "isprintable", "isspace", "istitle", "isupper", "join", "ljust", "lower", "lstrip", "maketrans", "partition", "removeprefix", "removesuffix", "replace", "rfind", "rindex", "rjust", "rpartition", "rsplit", "rstrip", "split", "splitlines", "startswith", "strip", "swapcase", "title", "translate", "upper", "zfill"], "list": ["append", "clear", "copy", "count", "extend", "index", "insert", "pop", "remove", "reverse", "sort"], "dict": ["clear", "copy", "fromkeys", "get", "items", "keys", "pop", "popitem", "setdefault", "update", "values"], "set": ["add", "clear", "copy", "difference", "difference_update", "discard", "intersection", "intersection_update", "isdisjoint", "issubset", "issuperset", "pop", "remove", "symmetric_difference", "symmetric_difference_update", "union", "update"], "frozenset": ["copy", "difference", "intersection", "isdisjoint", "issubset", "issuperset", "symmetric_difference", "union"], "tuple": ["count", "index"], "int": ["as_integer_ratio", "bit_count", "bit_length", "conjugate", "denominator", "from_bytes", "imag", "is_integer", "numerator", "real", "to_bytes"], "float": ["as_integer_ratio", "conjugate", "fromhex", "hex", "imag", "is_integer", "real"], "bool": ["as_integer_ratio", "bit_count", "bit_length", "conjugate", "denominator", "from_bytes", "imag", "is_integer", "numerator", "real", "to_bytes"], "NoneType": [], "range": ["count", "index", "start", "step", "stop"], "deque": ["append", "appendleft", "clear", "copy", "count", "extend", "extendleft", "index", "insert", "maxlen", "pop", "popleft", "remove", "reverse", "rotate"], "Counter": ["clear", "copy", "elements", "fromkeys", "get", "items", "keys", "most_common", "pop", "popitem", "setdefault", "subtract", "total", "update", "values"], "defaultdict": ["clear", "copy", "default_factory", "fromkeys", "get", "items", "keys", "pop", "popitem", "setdefault", "update", "values"]};
const PY_INSTANCE_DUNDERS = ["__class__", "__delattr__", "__dict__", "__dir__", "__doc__", "__eq__", "__firstlineno__", "__format__", "__ge__", "__getattribute__", "__getstate__", "__gt__", "__hash__", "__init__", "__init_subclass__", "__le__", "__lt__", "__module__", "__ne__", "__new__", "__reduce__", "__reduce_ex__", "__repr__", "__setattr__", "__sizeof__", "__static_attributes__", "__str__", "__subclasshook__", "__weakref__"];

// Python/suggestions.c: levenshtein distance with MOVE_COST 2 and CASE_COST 1, early exit above maxCost
function sugLevenshtein(a, b, maxCost) {
  if (a === b) return 0;
  let as = 0, bs = 0, ae = a.length, be = b.length;
  while (as < ae && bs < be && a[as] === b[bs]) { as++; bs++; }
  while (ae > as && be > bs && a[ae - 1] === b[be - 1]) { ae--; be--; }
  a = a.slice(as, ae); b = b.slice(bs, be);
  if (!a.length || !b.length) return (a.length + b.length) * 2;
  if (a.length > 40 || b.length > 40) return maxCost + 1;
  if (b.length < a.length) { const t = a; a = b; b = t; }
  if ((b.length - a.length) * 2 > maxCost) return maxCost + 1;
  const buf = new Array(a.length);
  let tmp = 2;
  for (let i = 0; i < a.length; i++) { buf[i] = tmp; tmp += 2; }
  let result = 0;
  for (let bi = 0; bi < b.length; bi++) {
    const code = b[bi];
    let distance = result = bi * 2;
    let minimum = Infinity;
    for (let i = 0; i < a.length; i++) {
      const sc = code === a[i] ? 0 : (code.toLowerCase() === a[i].toLowerCase() ? 1 : 2);
      const substitute = distance + sc;
      distance = buf[i];
      const insDel = Math.min(result, distance) + 2;
      result = Math.min(insDel, substitute);
      buf[i] = result;
      if (result < minimum) minimum = result;
    }
    if (minimum > maxCost) return maxCost + 1;
  }
  return result;
}
function calcSuggestion(dir, name) {
  if (dir.length >= 750) return null;
  let best = null, bestD = Infinity;
  for (const item of dir) {
    if (item === name) continue;
    let maxD = Math.floor((name.length + item.length + 3) * 2 / 6);
    maxD = Math.min(maxD, bestD - 1);
    const dd = sugLevenshtein(name, item, maxD);
    if (dd > maxD) continue;
    if (best === null || dd < bestD) { best = item; bestD = dd; }
  }
  return best;
}
