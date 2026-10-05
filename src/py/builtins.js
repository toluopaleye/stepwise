// ===== PyRun builtins: functions, types, methods, modules, exceptions =====

function kwGet(kw, name, def) { return kw && kw.has(name) ? kw.get(name) : def; }
function checkKw(fname, kw, allowed) {
  if (!kw || !kw.size) return;
  for (const k of kw.keys()) if (allowed.indexOf(k) < 0) throw pyErr('TypeError', `${fname}() got an unexpected keyword argument '${k}'`);
}
function nargs(fname, args, min, max) {
  if (args.length >= min && args.length <= max) return;
  if (min === max) {
    if (min === 0) throw pyErr('TypeError', `${fname}() takes no arguments (${args.length} given)`);
    if (min === 1) throw pyErr('TypeError', `${fname}() takes exactly one argument (${args.length} given)`);
    throw pyErr('TypeError', `${fname}() takes exactly ${min} arguments (${args.length} given)`);
  }
  if (args.length < min) throw pyErr('TypeError', `${fname}() takes at least ${min} argument${min > 1 ? 's' : ''} (${args.length} given)`);
  throw pyErr('TypeError', `${fname}() takes at most ${max} argument${max > 1 ? 's' : ''} (${args.length} given)`);
}
function toIndexInt(v, what) {
  if (isIntV(v)) return Number(asInt(v));
  if (v instanceof PyInstance && VM.findMethod(v, '__index__')) return Number(VM.callValue(VM.findMethod(v, '__index__'), [v], null));
  throw pyErr('TypeError', `'${shortTypeName(v)}' object cannot be interpreted as an integer`);
}
function bi(name, fn) { return new PyBuiltin(name, fn); }

// ---------- exceptions ----------
const EXC = {};
function mkExc(name, base) {
  const cls = new PyClass(name, base ? [base] : [], new Map());
  cls.builtin = true;
  cls.isException = true;
  EXC[name] = cls;
  return cls;
}
(function () {
  const B = mkExc('BaseException', null);
  B.dict.set('__init__', new PyBuiltin('__init__', function (args) { args[0].excArgs = args.slice(1); return NONE; }));
  B.dict.set('with_traceback', new PyBuiltin('with_traceback', function (args) { return args[0]; }));
  const E = mkExc('Exception', B);
  mkExc('SystemExit', B); mkExc('KeyboardInterrupt', B); mkExc('GeneratorExit', B);
  const Ar = mkExc('ArithmeticError', E);
  mkExc('ZeroDivisionError', Ar); mkExc('OverflowError', Ar); mkExc('FloatingPointError', Ar);
  const Lk = mkExc('LookupError', E);
  mkExc('IndexError', Lk); mkExc('KeyError', Lk);
  const V = mkExc('ValueError', E);
  mkExc('UnicodeError', V);
  mkExc('TypeError', E);
  const N = mkExc('NameError', E);
  mkExc('UnboundLocalError', N);
  mkExc('AttributeError', E);
  const R = mkExc('RuntimeError', E);
  mkExc('RecursionError', R); mkExc('NotImplementedError', R);
  mkExc('StopIteration', E);
  mkExc('AssertionError', E);
  const Im = mkExc('ImportError', E);
  mkExc('ModuleNotFoundError', Im);
  const S = mkExc('SyntaxError', E);
  const I = mkExc('IndentationError', S);
  mkExc('TabError', I);
  mkExc('MemoryError', E);
  mkExc('EOFError', E);
  const O = mkExc('OSError', E);
  mkExc('FileNotFoundError', O); mkExc('TimeoutError', O);
  mkExc('SystemError', E);
})();

// ---------- built-in types ----------
function typeOfValue(v) {
  if (v === NONE) return T_NONE;
  switch (typeof v) {
    case 'boolean': return T_BOOL;
    case 'number': case 'bigint': return T_INT;
    case 'string': return T_STR;
  }
  if (v instanceof PyFloat) return T_FLOAT;
  if (v instanceof PyList) return T_LIST;
  if (v instanceof PyTuple) return T_TUPLE;
  if (v instanceof PyDict) return v.kind === 'defaultdict' ? T_DEFAULTDICT : v.kind === 'Counter' ? T_COUNTER : T_DICT;
  if (v instanceof PySet) return v.frozen ? T_FROZENSET : T_SET;
  if (v instanceof PyRange) return T_RANGE;
  if (v instanceof PyInstance) return v.cls;
  if (v instanceof PyDeque) return T_DEQUE;
  if (v instanceof PyFunction) return T_FUNCTION;
  if (v instanceof PyClass || v instanceof PyType) return T_TYPE;
  if (v instanceof PyBuiltin) return T_BUILTIN;
  if (v instanceof PyBound) return T_METHOD;
  if (v instanceof PyModule) return T_MODULE;
  return new PyType(typeName(v), (x) => typeName(x) === typeName(v), null);
}

function intFromStr(s, base) {
  const orig = s;
  let t = s.trim().replace(/_/g, '');
  let neg = false;
  if (t[0] === '+' || t[0] === '-') { neg = t[0] === '-'; t = t.slice(1); }
  if (base === 0) {
    if (/^0[xX]/.test(t)) base = 16; else if (/^0[oO]/.test(t)) base = 8; else if (/^0[bB]/.test(t)) base = 2; else base = 10;
  }
  if (base === 16) t = t.replace(/^0[xX]/, '');
  if (base === 8) t = t.replace(/^0[oO]/, '');
  if (base === 2) t = t.replace(/^0[bB]/, '');
  const digits = '0123456789abcdefghijklmnopqrstuvwxyz'.slice(0, base);
  if (!t.length || [...t.toLowerCase()].some((c) => digits.indexOf(c) < 0) || /_{2,}|^_|_$/.test(s.trim())) {
    throw pyErr('ValueError', `invalid literal for int() with base ${base}: ${repr(orig)}`);
  }
  let r = 0n;
  const B = BigInt(base);
  for (const c of t.toLowerCase()) r = r * B + BigInt(digits.indexOf(c));
  return normInt(neg ? -r : r);
}
function floatFromStr(s) {
  const t = s.trim().replace(/_/g, '').toLowerCase();
  if (/^[+-]?(inf|infinity)$/.test(t)) return F(t[0] === '-' ? -Infinity : Infinity);
  if (/^[+-]?nan$/.test(t)) return F(NaN);
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/.test(t)) throw pyErr('ValueError', `could not convert string to float: ${repr(s)}`);
  return F(parseFloat(t));
}

const T_OBJECT = new PyType('object', () => true, function (args) {
  if (args.length) throw pyErr('TypeError', 'object() takes no arguments');
  return new PyInstance(OBJECT_CLS);
});
const OBJECT_CLS = new PyClass('object', [], new Map());
OBJECT_CLS.builtin = true;
const OBJECT_INIT = new PyBuiltin('__init__', function () { return NONE; });

const T_INT = new PyType('int', (v) => isIntV(v), function (args, kw) {
  checkKw('int', kw, ['base']);
  if (!args.length) return 0;
  const x = args[0];
  const baseArg = args.length > 1 ? args[1] : kwGet(kw, 'base', null);
  if (baseArg !== null) {
    if (typeof x !== 'string') throw pyErr('TypeError', "int() can't convert non-string with explicit base");
    return intFromStr(x, Number(asInt(baseArg)));
  }
  if (typeof x === 'boolean') return x ? 1 : 0;
  if (isIntV(x)) return x;
  if (x instanceof PyFloat) {
    if (Number.isNaN(x.v)) throw pyErr('ValueError', 'cannot convert float NaN to integer');
    if (!Number.isFinite(x.v)) throw pyErr('OverflowError', 'cannot convert float infinity to integer');
    const t = Math.trunc(x.v);
    return Math.abs(t) <= MAXS ? (t === 0 ? 0 : t) : normInt(BigInt(t));
  }
  if (typeof x === 'string') return intFromStr(x, 10);
  if (x instanceof PyInstance) {
    const m = VM.findMethod(x, '__int__') || VM.findMethod(x, '__index__');
    if (m) return VM.callValue(m, [x], null);
  }
  throw pyErr('TypeError', `int() argument must be a string, a bytes-like object or a real number, not '${shortTypeName(x)}'`);
});
const T_BOOL = new PyType('bool', (v) => typeof v === 'boolean', function (args) { return args.length ? truthy(args[0]) : false; });
const T_FLOAT = new PyType('float', (v) => v instanceof PyFloat, function (args) {
  if (!args.length) return F(0);
  const x = args[0];
  if (x instanceof PyFloat) return x;
  if (isIntV(x)) return F(fval(x));
  if (typeof x === 'string') return floatFromStr(x);
  if (x instanceof PyInstance) { const m = VM.findMethod(x, '__float__'); if (m) return VM.callValue(m, [x], null); }
  throw pyErr('TypeError', `float() argument must be a string or a real number, not '${shortTypeName(x)}'`);
});
const T_STR = new PyType('str', (v) => typeof v === 'string', function (args) { return args.length ? pyStr(args[0]) : ''; });
const T_LIST = new PyType('list', (v) => v instanceof PyList, function (args) {
  nargs('list', args, 0, 1);
  return new PyList(args.length ? this.toArray(args[0]) : []);
});
const T_TUPLE = new PyType('tuple', (v) => v instanceof PyTuple, function (args) {
  nargs('tuple', args, 0, 1);
  if (args.length && args[0] instanceof PyTuple) return args[0];
  return new PyTuple(args.length ? this.toArray(args[0]) : []);
});
function dictFromArgs(vm, d, args, kw) {
  if (args.length) {
    const src = args[0];
    if (src instanceof PyDict) { for (const e of src.m.values()) dictSet(d, e[0], e[1]); }
    else {
      const items = vm.toArray(src);
      items.forEach((it, idx) => {
        const pair = vm.toArray(it);
        if (pair.length !== 2) throw pyErr('ValueError', `dictionary update sequence element #${idx} has length ${pair.length}; 2 is required`);
        dictSet(d, pair[0], pair[1]);
      });
    }
  }
  if (kw) for (const [k, v] of kw) dictSet(d, k, v);
  return d;
}
const T_DICT = new PyType('dict', (v) => v instanceof PyDict, function (args, kw) {
  nargs('dict', args, 0, 1);
  return dictFromArgs(this, new PyDict(), args, kw);
});
const T_SET = new PyType('set', (v) => v instanceof PySet && !v.frozen, function (args) {
  nargs('set', args, 0, 1);
  const s = new PySet();
  if (args.length) setUpdateFrom(this, s, args[0]);
  return s;
});
const T_FROZENSET = new PyType('frozenset', (v) => v instanceof PySet && v.frozen, function (args) {
  if (args.length && args[0] instanceof PySet && args[0].frozen) return args[0];
  const s = new PySet(true);
  if (args.length) setUpdateFrom(this, s, args[0]);
  return s;
});
const T_RANGE = new PyType('range', (v) => v instanceof PyRange, function (args) {
  if (args.length < 1 || args.length > 3) throw pyErr('TypeError', args.length < 1 ? 'range expected at least 1 argument, got 0' : `range expected at most 3 arguments, got ${args.length}`);
  const n = args.map((a) => toIndexInt(a));
  let start = 0, stop, step = 1;
  if (n.length === 1) stop = n[0];
  else { start = n[0]; stop = n[1]; if (n.length === 3) step = n[2]; }
  if (step === 0) throw pyErr('ValueError', 'range() arg 3 must not be zero');
  return new PyRange(start, stop, step);
});
const T_NONE = new PyType('NoneType', (v) => v === NONE, function () { return NONE; });
const T_TYPE = new PyType('type', (v) => v instanceof PyClass || v instanceof PyType, function (args) {
  if (args.length === 1) return typeOfValue(args[0]);
  throw pyErr('TypeError', 'type() with 3 arguments is not supported in this runner');
});
const T_FUNCTION = new PyType('function', (v) => v instanceof PyFunction, null);
const T_BUILTIN = new PyType('builtin_function_or_method', (v) => v instanceof PyBuiltin, null);
const T_METHOD = new PyType('method', (v) => v instanceof PyBound, null);
const T_MODULE = new PyType('module', (v) => v instanceof PyModule, null);
const T_DEQUE = new PyType('collections.deque', (v) => v instanceof PyDeque, function (args, kw) {
  const d = new PyDeque(args.length ? this.toArray(args[0]) : []);
  const ml = args.length > 1 ? args[1] : kwGet(kw, 'maxlen', NONE);
  if (ml !== NONE) { d.maxlen = Number(asInt(ml)); while (d.a.length > d.maxlen) d.a.shift(); }
  return d;
});
T_DEQUE.reprName = 'collections.deque';
const T_DEFAULTDICT = new PyType('collections.defaultdict', (v) => v instanceof PyDict && v.kind === 'defaultdict', function (args, kw) {
  const d = new PyDict();
  d.kind = 'defaultdict';
  d.factory = args.length ? args[0] : NONE;
  if (d.factory !== NONE && !isCallable(d.factory)) throw pyErr('TypeError', 'first argument must be callable or None');
  return dictFromArgs(this, d, args.slice(1), kw);
});
const T_COUNTER = new PyType('collections.Counter', (v) => v instanceof PyDict && v.kind === 'Counter', function (args, kw) {
  const d = new PyDict();
  d.kind = 'Counter';
  if (args.length) counterUpdate(this, d, args[0], 1);
  if (kw) for (const [k, v] of kw) dictSet(d, k, v);
  return d;
});
function counterUpdate(vm, d, src, sign) {
  if (src instanceof PyDict) {
    for (const e of src.m.values()) { const cur = dictGet(d, e[0]) || 0; dictSet(d, e[0], sign > 0 ? iadd(cur, e[1]) : isub(cur, e[1])); }
    return;
  }
  for (const x of vm.toArray(src)) { const cur = dictGet(d, x) || 0; dictSet(d, x, sign > 0 ? iadd(cur, 1) : isub(cur, 1)); }
}
function isCallable(v) {
  return v instanceof PyFunction || v instanceof PyBuiltin || v instanceof PyBound || v instanceof PyClass || v instanceof PyType ||
    (v instanceof PyInstance && !!VM.findMethod(v, '__call__'));
}

const TYPE_STATICS = {
  dict: {
    fromkeys: bi('fromkeys', function (args) {
      nargs('fromkeys', args, 1, 2);
      const d = new PyDict();
      const v = args.length > 1 ? args[1] : NONE;
      for (const k of this.toArray(args[0])) dictSet(d, k, v);
      return d;
    }),
  },
};

// ---------- sorting helpers ----------
function pySortArray(vm, arr, keyFn, reverse) {
  const n = arr.length;
  vm.tick(n > 1 ? Math.ceil(n * Math.log2(n)) : 1);
  let keys = arr;
  if (keyFn !== NONE && keyFn !== null && keyFn !== undefined) keys = arr.map((x) => vm.callValue(keyFn, [x], null));
  const idx = arr.map((_, i) => i);
  const cmp = (i, j) => {
    const a = keys[i], b = keys[j];
    if (pyLt(a, b)) return -1;
    if (pyLt(b, a)) return 1;
    return 0;
  };
  if (reverse) idx.sort((i, j) => cmp(j, i));
  else idx.sort(cmp);
  return idx.map((i) => arr[i]);
}

function minMax(vm, name, args, kw, wantMax) {
  checkKw(name, kw, ['key', 'default']);
  const keyFn = kwGet(kw, 'key', NONE);
  let items;
  if (args.length === 0) throw pyErr('TypeError', `${name} expected at least 1 argument, got 0`);
  if (args.length === 1) items = vm.toArray(args[0]);
  else {
    if (kw && kw.has('default')) throw pyErr('TypeError', `Cannot specify a default for ${name}() with multiple positional arguments`);
    items = args;
  }
  if (!items.length) {
    if (kw && kw.has('default')) return kw.get('default');
    throw pyErr('ValueError', `${name}() iterable argument is empty`);
  }
  let best = items[0];
  let bestKey = keyFn !== NONE ? vm.callValue(keyFn, [best], null) : best;
  for (let i = 1; i < items.length; i++) {
    const k = keyFn !== NONE ? vm.callValue(keyFn, [items[i]], null) : items[i];
    if (wantMax ? pyLt(bestKey, k) : pyLt(k, bestKey)) { best = items[i]; bestKey = k; }
  }
  return best;
}

function pyHashValue(v) {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (isIntV(v)) return normInt(pyHashInt(v));
  if (v instanceof PyFloat && Number.isInteger(v.v)) return normInt(pyHashInt(BigInt(v.v)));
  if (v instanceof PyTuple && setEmuKey(v)) return normInt(tupleHashBig(v));
  const key = hashKey(v);
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < key.length; i++) { h ^= BigInt(key.charCodeAt(i)); h = (h * 0x100000001b3n) & 0xffffffffffffffffn; }
  return normInt(BigInt.asIntN(61, h));
}

function makeIter(arr, name) { let i = 0; return new PyIter(() => (i < arr.length ? arr[i++] : STOP), name); }

// ---------- builtin functions ----------
const BUILTIN_SUPER = bi('super', function (args) {
  if (args.length === 2) return new PySuper(args[0], args[1]);
  throw pyErr('RuntimeError', 'super(): no arguments');
});

const BUILTINS = new Map();
function defBuiltin(name, fn) { BUILTINS.set(name, bi(name, fn)); }

defBuiltin('print', function (args, kw) {
  checkKw('print', kw, ['sep', 'end', 'file', 'flush']);
  let sep = kwGet(kw, 'sep', NONE), end = kwGet(kw, 'end', NONE);
  if (sep === NONE) sep = ' ';
  else if (typeof sep !== 'string') throw pyErr('TypeError', `sep must be None or a string, not ${shortTypeName(sep)}`);
  if (end === NONE) end = '\n';
  else if (typeof end !== 'string') throw pyErr('TypeError', `end must be None or a string, not ${shortTypeName(end)}`);
  const parts = [];
  for (let i = 0; i < args.length; i++) parts.push(pyStr(args[i]));
  this.write(parts.join(sep) + end);
  return NONE;
});
defBuiltin('len', function (args) {
  nargs('len', args, 1, 1);
  const v = args[0];
  if (typeof v === 'string') return strLen(v);
  if (v instanceof PyList || v instanceof PyTuple || v instanceof PyDeque) return v.a.length;
  if (v instanceof PyDict || v instanceof PySet) return v.m.size;
  if (v instanceof PyRange) return v.length;
  if (v instanceof PyDictView) return v.d.m.size;
  if (v instanceof PyInstance) {
    const m = this.findMethod(v, '__len__');
    if (m) {
      const r = this.callValue(m, [v], null);
      if (!isIntV(r)) throw pyErr('TypeError', `'${shortTypeName(r)}' object cannot be interpreted as an integer`);
      if (icmp(asInt(r), 0) < 0) throw pyErr('ValueError', '__len__() should return >= 0');
      return asInt(r);
    }
  }
  throw pyErr('TypeError', `object of type '${shortTypeName(v)}' has no len()`);
});
defBuiltin('sum', function (args, kw) {
  checkKw('sum', kw, ['start']);
  nargs('sum', args, 1, 2);
  let total = args.length > 1 ? args[1] : kwGet(kw, 'start', 0);
  if (typeof total === 'string') throw pyErr('TypeError', "sum() can't sum strings [use ''.join(seq) instead]");
  const items = this.toArray(args[0]);
  let i = 0;
  // exact integer phase
  while (i < items.length && isIntV(total) && isIntV(items[i])) { total = iadd(asInt(total), asInt(items[i])); i++; }
  // float phase with Neumaier compensation (CPython 3.12+)
  if (i < items.length && isNumV(total) && items[i] instanceof PyFloat) {
    let fr = fval(total), c = 0;
    while (i < items.length && (items[i] instanceof PyFloat || isIntV(items[i]))) {
      const x = fval(items[i]);
      const t = fr + x;
      if (Math.abs(fr) >= Math.abs(x)) c += (fr - t) + x; else c += (x - t) + fr;
      fr = t;
      i++;
    }
    if (c && Number.isFinite(c)) fr += c;
    total = F(fr);
  }
  for (; i < items.length; i++) total = this.binop('+', total, items[i]);
  return total;
});
defBuiltin('min', function (args, kw) { return minMax(this, 'min', args, kw, false); });
defBuiltin('max', function (args, kw) { return minMax(this, 'max', args, kw, true); });
defBuiltin('sorted', function (args, kw) {
  checkKw('sorted', kw, ['key', 'reverse']);
  nargs('sorted', args, 1, 1);
  return new PyList(pySortArray(this, this.toArray(args[0]), kwGet(kw, 'key', NONE), truthy(kwGet(kw, 'reverse', false))));
});
defBuiltin('reversed', function (args) {
  nargs('reversed', args, 1, 1);
  const v = args[0];
  if (v instanceof PyList || v instanceof PyTuple || v instanceof PyDeque) {
    let i = v.a.length - 1;
    return new PyIter(() => (i >= 0 && i < v.a.length ? v.a[i--] : STOP), v instanceof PyList ? 'list_reverseiterator' : 'reversed');
  }
  if (typeof v === 'string') return makeIter(strChars(v).reverse(), 'reversed');
  if (v instanceof PyRange) { const arr = []; for (let i = v.length - 1; i >= 0; i--) arr.push(v.at(i)); return makeIter(arr, 'range_iterator'); }
  if (v instanceof PyDict) return makeIter([...v.m.values()].map((e) => e[0]).reverse(), 'dict_reversekeyiterator');
  if (v instanceof PyInstance) {
    const m = this.findMethod(v, '__reversed__');
    if (m) return this.callValue(m, [v], null);
    const ln = this.findMethod(v, '__len__'), gi = this.findMethod(v, '__getitem__');
    if (ln && gi) { let i = Number(asInt(this.callValue(ln, [v], null))) - 1; return new PyIter(() => (i >= 0 ? this.callValue(gi, [v, i--], null) : STOP), 'reversed'); }
  }
  throw pyErr('TypeError', `'${shortTypeName(v)}' object is not reversible`);
});
defBuiltin('enumerate', function (args, kw) {
  checkKw('enumerate', kw, ['start']);
  nargs('enumerate', args, 1, 2);
  // like CPython, check start (it must be a whole number) before the iterable
  let i = args.length > 1 ? args[1] : kwGet(kw, 'start', 0);
  if (typeof i === 'boolean') i = i ? 1 : 0;
  else if (!isIntV(i)) i = toIndexInt(i);
  const it = this.iterOf(args[0]);
  return new PyIter(() => { const v = it.next(); if (v === STOP) return STOP; const t = new PyTuple([i, v]); i = iadd(i, 1); return t; }, 'enumerate');
});
defBuiltin('zip', function (args, kw) {
  checkKw('zip', kw, ['strict']);
  const its = args.map((a) => this.iterOf(a));
  const strict = truthy(kwGet(kw, 'strict', false));
  return new PyIter(() => {
    if (!its.length) return STOP;
    const row = [];
    for (let k = 0; k < its.length; k++) {
      const v = its[k].next();
      if (v === STOP) {
        if (strict && (k > 0 || its.slice(1).some((t) => t.next() !== STOP))) throw pyErr('ValueError', `zip() argument ${k + 1} is shorter than argument 1`);
        return STOP;
      }
      row.push(v);
    }
    return new PyTuple(row);
  }, 'zip');
});
defBuiltin('map', function (args) {
  if (args.length < 2) throw pyErr('TypeError', 'map() must have at least two arguments.');
  const fn = args[0];
  const its = args.slice(1).map((a) => this.iterOf(a));
  return new PyIter(() => {
    const vals = [];
    for (const it of its) { const v = it.next(); if (v === STOP) return STOP; vals.push(v); }
    return this.callValue(fn, vals, null);
  }, 'map');
});
defBuiltin('filter', function (args) {
  nargs('filter', args, 2, 2);
  const fn = args[0];
  const it = this.iterOf(args[1]);
  return new PyIter(() => {
    for (;;) {
      const v = it.next();
      if (v === STOP) return STOP;
      const keep = fn === NONE ? truthy(v) : truthy(this.callValue(fn, [v], null));
      if (keep) return v;
    }
  }, 'filter');
});
defBuiltin('abs', function (args) {
  nargs('abs', args, 1, 1);
  const v = args[0];
  if (isIntV(v)) { const n = asInt(v); return icmp(n, 0) < 0 ? intNeg(n) : n; }
  if (v instanceof PyFloat) return F(Math.abs(v.v));
  if (v instanceof PyInstance) { const m = this.findMethod(v, '__abs__'); if (m) return this.callValue(m, [v], null); }
  throw pyErr('TypeError', `bad operand type for abs(): '${shortTypeName(v)}'`);
});
defBuiltin('round', function (args, kw) {
  checkKw('round', kw, ['ndigits']);
  nargs('round', args, 1, 2);
  const v = args[0];
  let nd = args.length > 1 ? args[1] : kwGet(kw, 'ndigits', NONE);
  nd = nd === NONE ? null : Number(asInt(nd));
  if (isIntV(v)) {
    const n = asInt(v);
    if (nd === null || nd >= 0) return n;
    const p = 10n ** BigInt(-nd);
    const b = big(n);
    let q = b / p;
    let r = b % p;
    if (r < 0n) { r += p; q -= 1n; }
    const twice = r * 2n;
    if (twice > p || (twice === p && q % 2n !== 0n)) q += 1n;
    return normInt(q * p);
  }
  if (v instanceof PyFloat) return pyRound(v.v, nd);
  if (v instanceof PyInstance) { const m = this.findMethod(v, '__round__'); if (m) return this.callValue(m, nd === null ? [v] : [v, nd], null); }
  throw pyErr('TypeError', `type ${shortTypeName(v)} doesn't define __round__ method`);
});
defBuiltin('pow', function (args) {
  nargs('pow', args, 2, 3);
  if (args.length === 3) {
    let b = big(asInt(args[0])), e = big(asInt(args[1]));
    const m = big(asInt(args[2]));
    if (m === 0n) throw pyErr('ValueError', 'pow() 3rd argument cannot be 0');
    let r = 1n;
    b %= m;
    while (e > 0n) { if (e & 1n) r = (r * b) % m; e >>= 1n; b = (b * b) % m; }
    if (r < 0n) r += m;
    return normInt(r);
  }
  return this.binop('**', args[0], args[1]);
});
defBuiltin('divmod', function (args) {
  nargs('divmod', args, 2, 2);
  return new PyTuple([this.binop('//', args[0], args[1]), this.binop('%', args[0], args[1])]);
});
function isInst(v, cls) {
  if (cls instanceof PyTuple) return cls.a.some((c) => isInst(v, c));
  if (cls instanceof PyType) return cls.test(v);
  if (cls instanceof PyClass) {
    if (cls === OBJECT_CLS) return true;
    return v instanceof PyInstance && v.cls.mro.indexOf(cls) >= 0;
  }
  throw pyErr('TypeError', 'isinstance() arg 2 must be a type, a tuple of types, or a union');
}
defBuiltin('isinstance', function (args) { nargs('isinstance', args, 2, 2); return isInst(args[0], args[1]); });
defBuiltin('issubclass', function (args) {
  nargs('issubclass', args, 2, 2);
  const [a, b] = args;
  const check = (c) => {
    if (c instanceof PyTuple) return c.a.some(check);
    if (a instanceof PyClass && c instanceof PyClass) return a.mro.indexOf(c) >= 0;
    if (a instanceof PyType && c instanceof PyType) return a === c || c === T_OBJECT || (a === T_BOOL && c === T_INT);
    if (c === T_OBJECT) return true;
    return false;
  };
  return check(b);
});
defBuiltin('id', function (args) { nargs('id', args, 1, 1); const v = args[0]; return typeof v === 'object' && v !== null ? 140000000000000 + objId(v) * 48 : pyHashValue(v); });
defBuiltin('hash', function (args) { nargs('hash', args, 1, 1); return pyHashValue(args[0]); });
defBuiltin('repr', function (args) { nargs('repr', args, 1, 1); return repr(args[0]); });
defBuiltin('ascii', function (args) { nargs('ascii', args, 1, 1); return repr(args[0]).replace(/[^\x00-\x7f]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')); });
defBuiltin('chr', function (args) {
  nargs('chr', args, 1, 1);
  const n = toIndexInt(args[0]);
  if (n < 0 || n > 0x10ffff) throw pyErr('ValueError', 'chr() arg not in range(0x110000)');
  return String.fromCodePoint(n);
});
defBuiltin('ord', function (args) {
  nargs('ord', args, 1, 1);
  const s = args[0];
  if (typeof s !== 'string') throw pyErr('TypeError', `ord() expected string of length 1, but ${shortTypeName(s)} found`);
  const n = strLen(s);
  if (n !== 1) throw pyErr('TypeError', `ord() expected a character, but string of length ${n} found`);
  return s.codePointAt(0);
});
defBuiltin('any', function (args) { nargs('any', args, 1, 1); const it = this.iterOf(args[0]); for (;;) { const v = it.next(); if (v === STOP) return false; this.tick(1); if (truthy(v)) return true; } });
defBuiltin('all', function (args) { nargs('all', args, 1, 1); const it = this.iterOf(args[0]); for (;;) { const v = it.next(); if (v === STOP) return true; this.tick(1); if (!truthy(v)) return false; } });
defBuiltin('iter', function (args) {
  nargs('iter', args, 1, 1);
  const v = args[0];
  if (v instanceof PyIter) return v;
  const it = this.iterOf(v);
  const nm = v instanceof PyList ? 'list_iterator' : v instanceof PyTuple ? 'tuple_iterator' : typeof v === 'string' ? 'str_ascii_iterator' : v instanceof PyDict ? 'dict_keyiterator' : v instanceof PySet ? 'set_iterator' : v instanceof PyRange ? 'range_iterator' : 'iterator';
  return new PyIter(() => it.next(), nm);
});
defBuiltin('next', function (args) {
  nargs('next', args, 1, 2);
  const it = args[0];
  let v;
  if (it instanceof PyIter) v = it.next();
  else if (it instanceof PyInstance && this.findMethod(it, '__next__')) {
    try { v = this.callValue(this.findMethod(it, '__next__'), [it], null); }
    catch (e) { if (args.length > 1 && e instanceof PyThrow && isInstanceOfName(e.exc, 'StopIteration')) return args[1]; throw e; }
  } else throw pyErr('TypeError', `'${shortTypeName(it)}' object is not an iterator`);
  if (v === STOP) { if (args.length > 1) return args[1]; throw pyErr('StopIteration'); }
  return v;
});
defBuiltin('input', function () {
  throw pyErr('RuntimeError', 'input() isn\'t available here. Put the value straight into your code instead, for example: name = "Sam"');
});
defBuiltin('open', function () { throw pyErr('OSError', "files aren't available in this runner"); });
defBuiltin('exit', function () { throw pyErr('SystemExit'); });
defBuiltin('quit', function () { throw pyErr('SystemExit'); });
defBuiltin('callable', function (args) { nargs('callable', args, 1, 1); return isCallable(args[0]); });
defBuiltin('getattr', function (args) {
  nargs('getattr', args, 2, 3);
  try { return this.getAttr(args[0], args[1]); }
  catch (e) { if (args.length > 2 && e instanceof PyThrow && isInstanceOfName(e.exc, 'AttributeError')) return args[2]; throw e; }
});
defBuiltin('setattr', function (args) { nargs('setattr', args, 3, 3); this.setAttr(args[0], args[1], args[2]); return NONE; });
defBuiltin('hasattr', function (args) {
  nargs('hasattr', args, 2, 2);
  try { this.getAttr(args[0], args[1]); return true; }
  catch (e) { if (e instanceof PyThrow && isInstanceOfName(e.exc, 'AttributeError')) return false; throw e; }
});
defBuiltin('delattr', function (args) {
  nargs('delattr', args, 2, 2);
  const o = args[0];
  if (o instanceof PyInstance && o.dict.delete(args[1])) return NONE;
  throw pyErr('AttributeError', `'${shortTypeName(o)}' object has no attribute '${args[1]}'`);
});
defBuiltin('format', function (args) { nargs('format', args, 1, 2); return formatSpec(args[0], args.length > 1 ? args[1] : ''); });
defBuiltin('bin', function (args) { const n = big(asInt(args[0])); return (n < 0n ? '-0b' + (-n).toString(2) : '0b' + n.toString(2)); });
defBuiltin('hex', function (args) { const n = big(asInt(args[0])); return (n < 0n ? '-0x' + (-n).toString(16) : '0x' + n.toString(16)); });
defBuiltin('oct', function (args) { const n = big(asInt(args[0])); return (n < 0n ? '-0o' + (-n).toString(8) : '0o' + n.toString(8)); });
defBuiltin('dir', function (args) {
  const v = args[0];
  const names = new Set();
  if (v instanceof PyInstance) { for (const k of v.dict.keys()) names.add(k); for (const c of v.cls.mro) for (const k of c.dict.keys()) names.add(k); }
  else if (v instanceof PyModule) for (const k of v.dict.keys()) names.add(k);
  else { const t = methodsFor(v); if (t) for (const k of t.keys()) names.add(k); }
  return new PyList([...names].sort());
});
defBuiltin('vars', function (args) {
  const v = args[0];
  if (v instanceof PyInstance) { const d = new PyDict(); for (const [k, x] of v.dict) dictSet(d, k, x); return d; }
  throw pyErr('TypeError', 'vars() argument must have __dict__ attribute');
});
defBuiltin('globals', function () { const d = new PyDict(); for (const [k, x] of this.globals) dictSet(d, k, x); return d; });
defBuiltin('staticmethod', function (args) { return new PyStaticMethod(args[0]); });
defBuiltin('classmethod', function (args) { return new PyClassMethod(args[0]); });
defBuiltin('property', function (args) { const p = new PyProperty(args[0]); if (args.length > 1) p.fset = args[1]; return p; });
BUILTINS.set('super', BUILTIN_SUPER);
for (const [k, t] of [['int', T_INT], ['float', T_FLOAT], ['str', T_STR], ['bool', T_BOOL], ['list', T_LIST], ['tuple', T_TUPLE], ['dict', T_DICT], ['set', T_SET], ['frozenset', T_FROZENSET], ['range', T_RANGE], ['object', T_OBJECT], ['type', T_TYPE]]) BUILTINS.set(k, t);
BUILTINS.set('None', NONE);
BUILTINS.set('True', true);
BUILTINS.set('False', false);
BUILTINS.set('NotImplemented', NOT_IMPL);
BUILTINS.set('Ellipsis', ELLIPSIS);
BUILTINS.set('__name__', '__main__');
for (const name of Object.keys(EXC)) BUILTINS.set(name, EXC[name]);

// ---------- string methods ----------
const PY_WS = ' \t\n\r\x0b\x0c\x1c\x1d\x1e\x1f\x85\xa0                　';
function isWs(c) { return PY_WS.indexOf(c) >= 0; }
function strStrip(s, chars, left, right) {
  const set = chars === NONE || chars === undefined ? null : chars;
  if (set !== null && typeof set !== 'string') throw pyErr('TypeError', `strip arg must be None or str`);
  const inSet = (c) => (set === null ? isWs(c) : set.indexOf(c) >= 0);
  let i = 0, j = s.length;
  if (left) while (i < j && inSet(s[i])) i++;
  if (right) while (j > i && inSet(s[j - 1])) j--;
  return s.slice(i, j);
}
function needStr(fname, v, pos) {
  if (typeof v !== 'string') throw pyErr('TypeError', `${fname}() argument${pos ? ' ' + pos : ''} must be str, not ${shortTypeName(v)}`);
  return v;
}
function strIndexArgs(s, args) {
  const len = s.length;
  let start = args.length > 1 && args[1] !== NONE ? Number(asInt(args[1])) : 0;
  let end = args.length > 2 && args[2] !== NONE ? Number(asInt(args[2])) : len;
  if (start < 0) start = Math.max(0, start + len);
  if (end < 0) end = Math.max(0, end + len);
  if (end > len) end = len;
  return [start, end];
}
function strSplit(s, sep, maxsplit) {
  const out = [];
  if (sep === NONE) {
    let i = 0;
    const n = s.length;
    while (i < n) {
      while (i < n && isWs(s[i])) i++;
      if (i >= n) break;
      if (maxsplit >= 0 && out.length === maxsplit) {
        let rest = s.slice(i);
        let k = rest.length;
        while (k > 0 && isWs(rest[k - 1])) k--;
        out.push(rest.slice(0, k));
        return out;
      }
      let j = i;
      while (j < n && !isWs(s[j])) j++;
      out.push(s.slice(i, j));
      i = j;
    }
    return out;
  }
  if (typeof sep !== 'string') throw pyErr('TypeError', `must be str or None, not ${shortTypeName(sep)}`);
  if (sep === '') throw pyErr('ValueError', 'empty separator');
  let pos = 0;
  for (;;) {
    if (maxsplit >= 0 && out.length === maxsplit) { out.push(s.slice(pos)); return out; }
    const k = s.indexOf(sep, pos);
    if (k < 0) { out.push(s.slice(pos)); return out; }
    out.push(s.slice(pos, k));
    pos = k + sep.length;
  }
}
function titleCase(s) {
  let out = '';
  let prevCased = false;
  for (const c of s) {
    const isCased = c.toLowerCase() !== c.toUpperCase();
    if (isCased) { out += prevCased ? c.toLowerCase() : c.toUpperCase(); prevCased = true; }
    else { out += c; prevCased = false; }
  }
  return out;
}
function strFormatMethod(vm, s, args, kw) {
  let auto = 0;
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '{') {
      if (s[i + 1] === '{') { out += '{'; i += 2; continue; }
      let j = i + 1, depth = 0;
      for (; j < s.length; j++) { if (s[j] === '{') depth++; else if (s[j] === '}') { if (depth === 0) break; depth--; } }
      if (j >= s.length) throw pyErr('ValueError', "expected '}' before end of string");
      const field = s.slice(i + 1, j);
      i = j + 1;
      let name = field, conv = null, spec = '';
      const ci = field.indexOf(':');
      if (ci >= 0) { spec = field.slice(ci + 1); name = field.slice(0, ci); }
      const bi2 = name.indexOf('!');
      if (bi2 >= 0) { conv = name.slice(bi2 + 1); name = name.slice(0, bi2); }
      const m = /^([^.[]*)(.*)$/.exec(name);
      let head = m[1], rest = m[2];
      let v;
      if (head === '') { v = args[auto]; if (auto >= args.length) throw pyErr('IndexError', `Replacement index ${auto} out of range for positional args tuple`); auto++; }
      else if (/^\d+$/.test(head)) { const k = parseInt(head, 10); if (k >= args.length) throw pyErr('IndexError', `Replacement index ${k} out of range for positional args tuple`); v = args[k]; }
      else { if (!kw.has(head)) throw pyErrArgs('KeyError', [head]); v = kw.get(head); }
      const re = /\.(\w+)|\[([^\]]+)\]/g;
      let mm;
      while ((mm = re.exec(rest))) {
        if (mm[1]) v = vm.getAttr(v, mm[1]);
        else v = vm.getItem(v, /^\d+$/.test(mm[2]) ? parseInt(mm[2], 10) : mm[2]);
      }
      if (conv === 'r') v = repr(v); else if (conv === 's') v = pyStr(v);
      if (spec.indexOf('{') >= 0) spec = strFormatMethod(vm, spec, args, kw);
      out += formatSpec(v, spec);
      continue;
    }
    if (c === '}') {
      if (s[i + 1] === '}') { out += '}'; i += 2; continue; }
      throw pyErr('ValueError', "Single '}' encountered in format string");
    }
    out += c;
    i++;
  }
  return out;
}
const STR_METHODS = new Map(Object.entries({
  upper(args, kw, s) { nargs('str.upper', args, 0, 0); return s.toUpperCase(); },
  lower(args, kw, s) { nargs('str.lower', args, 0, 0); return s.toLowerCase(); },
  casefold(args, kw, s) { return s.toLowerCase(); },
  capitalize(args, kw, s) { return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s; },
  title(args, kw, s) { return titleCase(s); },
  swapcase(args, kw, s) { let o = ''; for (const c of s) o += c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase(); return o; },
  strip(args, kw, s) { return strStrip(s, args[0], true, true); },
  lstrip(args, kw, s) { return strStrip(s, args[0], true, false); },
  rstrip(args, kw, s) { return strStrip(s, args[0], false, true); },
  split(args, kw, s) {
    checkKw('split', kw, ['sep', 'maxsplit']);
    const sep = args.length > 0 ? args[0] : kwGet(kw, 'sep', NONE);
    const ms = args.length > 1 ? Number(asInt(args[1])) : Number(asInt(kwGet(kw, 'maxsplit', -1)));
    const parts = strSplit(s, sep, ms);
    this.tick(parts.length);
    return new PyList(parts);
  },
  rsplit(args, kw, s) {
    const sep = args.length > 0 ? args[0] : kwGet(kw, 'sep', NONE);
    const ms = args.length > 1 ? Number(asInt(args[1])) : Number(asInt(kwGet(kw, 'maxsplit', -1)));
    if (ms < 0) return new PyList(strSplit(s, sep, -1));
    const rev = (x) => Array.from(x).reverse().join('');
    const parts = strSplit(rev(s), sep === NONE ? NONE : rev(sep), ms).map(rev).reverse();
    return new PyList(parts);
  },
  splitlines(args, kw, s) {
    const keep = truthy(args.length ? args[0] : kwGet(kw, 'keepends', false));
    const out = [];
    const re = /\r\n|\n|\r/g;
    let pos = 0, m;
    while ((m = re.exec(s))) { out.push(keep ? s.slice(pos, m.index + m[0].length) : s.slice(pos, m.index)); pos = m.index + m[0].length; }
    if (pos < s.length) out.push(s.slice(pos));
    return new PyList(out);
  },
  join(args, kw, s) {
    nargs('str.join', args, 1, 1);
    let items;
    try { items = this.toArray(args[0]); }
    catch (e) { if (e instanceof PyThrow && isInstanceOfName(e.exc, 'TypeError')) throw pyErr('TypeError', 'can only join an iterable'); throw e; }
    for (let i = 0; i < items.length; i++) if (typeof items[i] !== 'string') throw pyErr('TypeError', `sequence item ${i}: expected str instance, ${shortTypeName(items[i])} found`);
    return items.join(s);
  },
  replace(args, kw, s) {
    nargs('str.replace', args, 2, 3);
    const old = needStr('replace', args[0], 1), nw = needStr('replace', args[1], 2);
    const count = args.length > 2 ? Number(asInt(args[2])) : -1;
    if (old === '') {
      const chars = strChars(s);
      let out = '', used = 0;
      for (let i = 0; i <= chars.length; i++) {
        if (count < 0 || used < count) { out += nw; used++; }
        if (i < chars.length) out += chars[i];
      }
      return out;
    }
    if (count < 0) return s.split(old).join(nw);
    let out = '', pos = 0, used = 0;
    while (used < count) { const k = s.indexOf(old, pos); if (k < 0) break; out += s.slice(pos, k) + nw; pos = k + old.length; used++; }
    return out + s.slice(pos);
  },
  find(args, kw, s) { nargs('str.find', args, 1, 3); const [a, b] = strIndexArgs(s, args); const k = s.slice(0, b).indexOf(needStr('find', args[0]), a); return k; },
  rfind(args, kw, s) { nargs('str.rfind', args, 1, 3); const [a, b] = strIndexArgs(s, args); const sub = s.slice(a, b); const k = sub.lastIndexOf(needStr('rfind', args[0])); return k < 0 ? -1 : k + a; },
  index(args, kw, s) { nargs('str.index', args, 1, 3); const [a, b] = strIndexArgs(s, args); const k = s.slice(0, b).indexOf(needStr('index', args[0]), a); if (k < 0) throw pyErr('ValueError', 'substring not found'); return k; },
  rindex(args, kw, s) { const [a, b] = strIndexArgs(s, args); const sub = s.slice(a, b); const k = sub.lastIndexOf(args[0]); if (k < 0) throw pyErr('ValueError', 'substring not found'); return k + a; },
  count(args, kw, s) {
    nargs('str.count', args, 1, 3);
    const sub = needStr('count', args[0]);
    const [a, b] = strIndexArgs(s, args);
    const t = s.slice(a, b);
    if (sub === '') return strLen(t) + 1;
    let n = 0, pos = 0;
    for (;;) { const k = t.indexOf(sub, pos); if (k < 0) break; n++; pos = k + sub.length; }
    return n;
  },
  startswith(args, kw, s) {
    nargs('str.startswith', args, 1, 3);
    const [a, b] = strIndexArgs(s, args);
    const t = s.slice(a, b);
    const p = args[0];
    if (p instanceof PyTuple) return p.a.some((x) => t.startsWith(x));
    if (typeof p !== 'string') throw pyErr('TypeError', `startswith first arg must be str or a tuple of str, not ${shortTypeName(p)}`);
    return t.startsWith(p);
  },
  endswith(args, kw, s) {
    nargs('str.endswith', args, 1, 3);
    const [a, b] = strIndexArgs(s, args);
    const t = s.slice(a, b);
    const p = args[0];
    if (p instanceof PyTuple) return p.a.some((x) => t.endsWith(x));
    if (typeof p !== 'string') throw pyErr('TypeError', `endswith first arg must be str or a tuple of str, not ${shortTypeName(p)}`);
    return t.endsWith(p);
  },
  isdigit(args, kw, s) { return s.length > 0 && /^\p{Nd}+$/u.test(s); },
  isnumeric(args, kw, s) { return s.length > 0 && /^\p{N}+$/u.test(s); },
  isdecimal(args, kw, s) { return s.length > 0 && /^\p{Nd}+$/u.test(s); },
  isalpha(args, kw, s) { return s.length > 0 && /^\p{L}+$/u.test(s); },
  isalnum(args, kw, s) { return s.length > 0 && /^[\p{L}\p{N}]+$/u.test(s); },
  isspace(args, kw, s) { return s.length > 0 && [...s].every(isWs); },
  isupper(args, kw, s) { const cased = [...s].filter((c) => c.toLowerCase() !== c.toUpperCase()); return cased.length > 0 && cased.every((c) => c === c.toUpperCase()); },
  islower(args, kw, s) { const cased = [...s].filter((c) => c.toLowerCase() !== c.toUpperCase()); return cased.length > 0 && cased.every((c) => c === c.toLowerCase()); },
  istitle(args, kw, s) { return s.length > 0 && titleCase(s) === s && /\p{L}/u.test(s); },
  isidentifier(args, kw, s) { return /^[\p{L}_][\p{L}\p{N}_]*$/u.test(s); },
  center(args, kw, s) { nargs('center', args, 1, 2); const w = Number(asInt(args[0])); const fill = args.length > 1 ? args[1] : ' '; const n = strLen(s); if (w <= n) return s; const pad = w - n; const left = Math.floor(pad / 2) + (pad % 2 && w % 2 ? 1 : 0); return fill.repeat(left) + s + fill.repeat(pad - left); },
  ljust(args, kw, s) { const w = Number(asInt(args[0])); const fill = args.length > 1 ? args[1] : ' '; const n = strLen(s); return n >= w ? s : s + fill.repeat(w - n); },
  rjust(args, kw, s) { const w = Number(asInt(args[0])); const fill = args.length > 1 ? args[1] : ' '; const n = strLen(s); return n >= w ? s : fill.repeat(w - n) + s; },
  zfill(args, kw, s) { const w = Number(asInt(args[0])); const n = strLen(s); if (n >= w) return s; const sign = s[0] === '-' || s[0] === '+' ? s[0] : ''; return sign + '0'.repeat(w - n) + s.slice(sign.length); },
  format(args, kw, s) { return strFormatMethod(this, s, args, kw); },
  partition(args, kw, s) { const sep = needStr('partition', args[0]); const k = s.indexOf(sep); if (k < 0) return new PyTuple([s, '', '']); return new PyTuple([s.slice(0, k), sep, s.slice(k + sep.length)]); },
  rpartition(args, kw, s) { const sep = needStr('rpartition', args[0]); const k = s.lastIndexOf(sep); if (k < 0) return new PyTuple(['', '', s]); return new PyTuple([s.slice(0, k), sep, s.slice(k + sep.length)]); },
  removeprefix(args, kw, s) { const p = args[0]; return s.startsWith(p) ? s.slice(p.length) : s; },
  removesuffix(args, kw, s) { const p = args[0]; return p && s.endsWith(p) ? s.slice(0, s.length - p.length) : s; },
  encode(args, kw, s) { throw pyErr('TypeError', "bytes aren't supported in this runner"); },
}));

// ---------- list methods ----------
const LIST_METHODS = new Map(Object.entries({
  append(args, kw, l) { nargs('list.append', args, 1, 1); l.a.push(args[0]); return NONE; },
  extend(args, kw, l) { nargs('list.extend', args, 1, 1); pushAll(l.a, this.toArray(args[0])); return NONE; },
  insert(args, kw, l) {
    nargs('insert', args, 2, 2);
    let i = toIndexInt(args[0]);
    const n = l.a.length;
    if (i < 0) { i += n; if (i < 0) i = 0; } else if (i > n) i = n;
    l.a.splice(i, 0, args[1]);
    this.tick(n - i);
    return NONE;
  },
  pop(args, kw, l) {
    nargs('pop', args, 0, 1);
    if (!l.a.length) throw pyErr('IndexError', 'pop from empty list');
    let i = args.length ? toIndexInt(args[0]) : l.a.length - 1;
    if (i < 0) i += l.a.length;
    if (i < 0 || i >= l.a.length) throw pyErr('IndexError', 'pop index out of range');
    if (i === l.a.length - 1) return l.a.pop();
    this.tick(l.a.length - i);
    return l.a.splice(i, 1)[0];
  },
  remove(args, kw, l) {
    nargs('list.remove', args, 1, 1);
    for (let i = 0; i < l.a.length; i++) {
      if (pyEq(l.a[i], args[0])) { l.a.splice(i, 1); this.tick(l.a.length + 1); return NONE; }
    }
    this.tick(l.a.length);
    throw pyErr('ValueError', 'list.remove(x): x not in list');
  },
  index(args, kw, l) {
    nargs('index', args, 1, 3);
    const n = l.a.length;
    let start = args.length > 1 ? toIndexInt(args[1]) : 0, end = args.length > 2 ? toIndexInt(args[2]) : n;
    if (start < 0) start = Math.max(0, start + n);
    if (end < 0) end = Math.max(0, end + n);
    for (let i = start; i < Math.min(end, n); i++) if (pyEq(l.a[i], args[0])) { this.tick(i - start + 1); return i; }
    this.tick(n);
    throw pyErr('ValueError', `${repr(args[0])} is not in list`);
  },
  count(args, kw, l) { nargs('list.count', args, 1, 1); this.tick(l.a.length); let c = 0; for (const x of l.a) if (pyEq(x, args[0])) c++; return c; },
  sort(args, kw, l) {
    if (args.length) throw pyErr('TypeError', 'sort() takes no positional arguments');
    checkKw('sort', kw, ['key', 'reverse']);
    l.a = pySortArray(this, l.a, kwGet(kw, 'key', NONE), truthy(kwGet(kw, 'reverse', false)));
    return NONE;
  },
  reverse(args, kw, l) { l.a.reverse(); this.tick(l.a.length); return NONE; },
  copy(args, kw, l) { this.tick(l.a.length); return new PyList(l.a.slice()); },
  clear(args, kw, l) { l.a = []; return NONE; },
}));

const TUPLE_METHODS = new Map(Object.entries({
  count(args, kw, t) { let c = 0; for (const x of t.a) if (pyEq(x, args[0])) c++; return c; },
  index(args, kw, t) { for (let i = 0; i < t.a.length; i++) if (pyEq(t.a[i], args[0])) return i; throw pyErr('ValueError', 'tuple.index(x): x not in tuple'); },
}));

// ---------- dict methods ----------
const DICT_METHODS = new Map(Object.entries({
  get(args, kw, d) { nargs('get', args, 1, 2); const v = dictGet(d, args[0]); return v === undefined ? (args.length > 1 ? args[1] : NONE) : v; },
  keys(args, kw, d) { return new PyDictView(d, 'keys'); },
  values(args, kw, d) { return new PyDictView(d, 'values'); },
  items(args, kw, d) { return new PyDictView(d, 'items'); },
  pop(args, kw, d) {
    nargs('pop', args, 1, 2);
    const h = hashKey(args[0]);
    const e = d.m.get(h);
    if (e) { d.m.delete(h); return e[1]; }
    if (args.length > 1) return args[1];
    throw pyErrArgs('KeyError', [args[0]]);
  },
  popitem(args, kw, d) {
    if (!d.m.size) throw pyErrArgs('KeyError', ['popitem(): dictionary is empty']);
    const lastKey = [...d.m.keys()].pop();
    const e = d.m.get(lastKey);
    d.m.delete(lastKey);
    return new PyTuple([e[0], e[1]]);
  },
  setdefault(args, kw, d) {
    nargs('setdefault', args, 1, 2);
    const v = dictGet(d, args[0]);
    if (v !== undefined) return v;
    const dv = args.length > 1 ? args[1] : NONE;
    dictSet(d, args[0], dv);
    return dv;
  },
  update(args, kw, d) {
    nargs('update', args, 0, 1);
    if (d.kind === 'Counter' && args.length) { counterUpdate(this, d, args[0], 1); return NONE; }
    dictFromArgs(this, d, args, kw);
    return NONE;
  },
  copy(args, kw, d) { const n = new PyDict(); n.kind = d.kind; n.factory = d.factory; for (const [h, e] of d.m) n.m.set(h, [e[0], e[1]]); this.tick(d.m.size); return n; },
  clear(args, kw, d) { d.m.clear(); return NONE; },
}));
const COUNTER_METHODS = new Map([...DICT_METHODS, ...Object.entries({
  most_common(args, kw, d) {
    const entries = counterOrder([...d.m.values()]);
    const n = args.length && args[0] !== NONE ? Number(asInt(args[0])) : entries.length;
    return new PyList(entries.slice(0, n).map((e) => new PyTuple([e[0], e[1]])));
  },
  elements(args, kw, d) { const out = []; for (const e of d.m.values()) for (let i = 0; i < Number(e[1]); i++) out.push(e[0]); return makeIter(out, 'itertools.chain'); },
  subtract(args, kw, d) { if (args.length) counterUpdate(this, d, args[0], -1); return NONE; },
  total(args, kw, d) { let t = 0; for (const e of d.m.values()) t = iadd(t, e[1]); return t; },
})]);

// ---------- set methods ----------
const SET_METHODS = new Map(Object.entries({
  add(args, kw, s) { nargs('set.add', args, 1, 1); setAdd(s, args[0]); return NONE; },
  remove(args, kw, s) { nargs('set.remove', args, 1, 1); if (!setDel(s, args[0])) throw pyErrArgs('KeyError', [args[0]]); return NONE; },
  discard(args, kw, s) { nargs('set.discard', args, 1, 1); setDel(s, args[0]); return NONE; },
  pop(args, kw, s) {
    if (!s.m.size) throw pyErrArgs('KeyError', ['pop from an empty set']);
    return setPop(s);
  },
  clear(args, kw, s) { setClear(s); return NONE; },
  copy(args, kw, s) { return s.frozen ? s : setCopy(s); },
  union(args, kw, s) { const r = setCopy(s); for (const o of args) { if (o === s) continue; setUpdateFrom(this, r, o); } this.tick(r.m.size); return r; },
  intersection(args, kw, s) { if (!args.length) return setCopy(s); let r = s; for (const o of args) r = setIntersection(this, r, o); this.tick(s.m.size); return r; },
  difference(args, kw, s) { if (!args.length) return setCopy(s); const r = setDifference(this, s, args[0]); for (const o of args.slice(1)) setDifferenceUpdate(this, r, o); this.tick(s.m.size); return r; },
  symmetric_difference(args, kw, s) { nargs('set.symmetric_difference', args, 1, 1); return setSymDiff(this, s, args[0]); },
  update(args, kw, s) { for (const o of args) setUpdateFrom(this, s, o); return NONE; },
  intersection_update(args, kw, s) { let r = s; for (const o of args) r = setIntersection(this, r, o); if (r !== s) { s.m = r.m; s.tbl = r.tbl; s.order = null; } return NONE; },
  difference_update(args, kw, s) { for (const o of args) setDifferenceUpdate(this, s, o); return NONE; },
  symmetric_difference_update(args, kw, s) { nargs('set.symmetric_difference_update', args, 1, 1); setSymDiffUpdate(this, s, args[0]); return NONE; },
  issubset(args, kw, s) { const o = toSet(this.toArray(args[0])); for (const h of s.m.keys()) if (!o.m.has(h)) return false; return true; },
  issuperset(args, kw, s) { for (const v of this.toArray(args[0])) if (!setHas(s, v)) return false; return true; },
  isdisjoint(args, kw, s) { for (const v of this.toArray(args[0])) if (setHas(s, v)) return false; return true; },
}));

// ---------- deque methods ----------
const DEQUE_METHODS = new Map(Object.entries({
  append(args, kw, d) { d.a.push(args[0]); if (d.maxlen !== undefined && d.a.length > d.maxlen) d.a.shift(); return NONE; },
  appendleft(args, kw, d) { d.a.unshift(args[0]); if (d.maxlen !== undefined && d.a.length > d.maxlen) d.a.pop(); return NONE; },
  pop(args, kw, d) { if (!d.a.length) throw pyErr('IndexError', 'pop from an empty deque'); return d.a.pop(); },
  popleft(args, kw, d) { if (!d.a.length) throw pyErr('IndexError', 'pop from an empty deque'); return d.a.shift(); },
  extend(args, kw, d) { pushAll(d.a, this.toArray(args[0])); return NONE; },
  extendleft(args, kw, d) { for (const v of this.toArray(args[0])) d.a.unshift(v); return NONE; },
  clear(args, kw, d) { d.a = []; return NONE; },
  copy(args, kw, d) { return new PyDeque(d.a.slice()); },
  count(args, kw, d) { let c = 0; for (const x of d.a) if (pyEq(x, args[0])) c++; return c; },
  index(args, kw, d) { for (let i = 0; i < d.a.length; i++) if (pyEq(d.a[i], args[0])) return i; throw pyErr('ValueError', `${repr(args[0])} is not in deque`); },
  remove(args, kw, d) { for (let i = 0; i < d.a.length; i++) if (pyEq(d.a[i], args[0])) { d.a.splice(i, 1); return NONE; } throw pyErr('ValueError', `${repr(args[0])} is not in deque`); },
  reverse(args, kw, d) { d.a.reverse(); return NONE; },
  rotate(args, kw, d) {
    let n = args.length ? Number(asInt(args[0])) : 1;
    const len = d.a.length;
    if (!len) return NONE;
    n = ((n % len) + len) % len;
    if (n) d.a = d.a.slice(len - n).concat(d.a.slice(0, len - n));
    return NONE;
  },
}));

const INT_METHODS = new Map(Object.entries({
  bit_length(args, kw, v) { const n = big(asInt(v)); return (n < 0n ? -n : n).toString(2).replace(/^0$/, '').length; },
  is_integer(args, kw, v) { return true; },
  conjugate(args, kw, v) { return asInt(v); },
}));
const FLOAT_METHODS = new Map(Object.entries({
  is_integer(args, kw, v) { return Number.isInteger(v.v); },
  conjugate(args, kw, v) { return v; },
}));
const RANGE_METHODS = new Map(Object.entries({
  count(args, kw, r) { return this.contains(r, args[0]) ? 1 : 0; },
  index(args, kw, r) { if (!this.contains(r, args[0])) throw pyErr('ValueError', `${repr(args[0])} is not in range`); return (Number(asInt(args[0])) - r.start) / r.step; },
}));
const PROPERTY_METHODS = new Map(Object.entries({
  setter(args, kw, p) { p.fset = args[0]; return p; },
  getter(args, kw, p) { p.fget = args[0]; return p; },
}));

T_STR.methods = STR_METHODS; T_LIST.methods = LIST_METHODS; T_DICT.methods = DICT_METHODS; T_SET.methods = SET_METHODS;
T_TUPLE.methods = TUPLE_METHODS; T_DEQUE.methods = DEQUE_METHODS; T_INT.methods = INT_METHODS; T_FLOAT.methods = FLOAT_METHODS;

function methodsFor(obj) {
  if (typeof obj === 'string') return STR_METHODS;
  if (obj instanceof PyList) return LIST_METHODS;
  if (obj instanceof PyDict) return obj.kind === 'Counter' ? COUNTER_METHODS : DICT_METHODS;
  if (obj instanceof PySet) return SET_METHODS;
  if (obj instanceof PyTuple) return TUPLE_METHODS;
  if (obj instanceof PyDeque) return DEQUE_METHODS;
  if (typeof obj === 'number' || typeof obj === 'bigint' || typeof obj === 'boolean') return INT_METHODS;
  if (obj instanceof PyFloat) return FLOAT_METHODS;
  if (obj instanceof PyRange) return RANGE_METHODS;
  if (obj instanceof PyProperty) return PROPERTY_METHODS;
  return null;
}

// ---------- modules ----------
function modDict(entries) { return new Map(Object.entries(entries)); }
function mathArg(v, name) {
  if (isNumV(v)) return fval(v);
  if (v instanceof PyInstance) { const m = VM.findMethod(v, '__float__'); if (m) return fval(VM.callValue(m, [v], null)); }
  throw pyErr('TypeError', `must be real number, not ${shortTypeName(v)}`);
}
function heapSiftDown(vm, h, start, pos) {
  const newitem = h[pos];
  while (pos > start) {
    const parentpos = (pos - 1) >> 1;
    const parent = h[parentpos];
    if (pyLt(newitem, parent)) { h[pos] = parent; pos = parentpos; vm.tick(1); continue; }
    break;
  }
  h[pos] = newitem;
}
function heapSiftUp(vm, h, pos) {
  const end = h.length, start = pos, newitem = h[pos];
  let child = 2 * pos + 1;
  while (child < end) {
    const right = child + 1;
    if (right < end && !pyLt(h[child], h[right])) child = right;
    h[pos] = h[child];
    pos = child;
    child = 2 * pos + 1;
    vm.tick(1);
  }
  h[pos] = newitem;
  heapSiftDown(vm, h, start, pos);
}
function needList(v, fname) { if (!(v instanceof PyList)) throw pyErr('TypeError', `${fname}() argument 1 must be list, not ${shortTypeName(v)}`); return v.a; }

function lruCacheDecorator(maxsize) {
  return bi('decorating_function', function (args) {
    const fn = args[0];
    const cache = new Map();
    let hits = 0, misses = 0;
    const wrapper = new PyBuiltin(fn.name || 'wrapper', function (a, kw) {
      let key = a.map(hashKey).join('|');
      if (kw && kw.size) for (const [k, v] of kw) key += '|' + k + '=' + hashKey(v);
      if (cache.has(key)) { hits++; return cache.get(key); }
      misses++;
      const r = this.callValue(fn, a, kw);
      cache.set(key, r);
      if (maxsize !== null && cache.size > maxsize) cache.delete(cache.keys().next().value);
      return r;
    });
    wrapper.attrs = new Map([
      ['cache_info', bi('cache_info', function () { return `CacheInfo(hits=${hits}, misses=${misses}, maxsize=${maxsize === null ? 'None' : maxsize}, currsize=${cache.size})`; })],
      ['cache_clear', bi('cache_clear', function () { cache.clear(); hits = 0; misses = 0; return NONE; })],
      ['__wrapped__', fn],
    ]);
    return wrapper;
  });
}

let RNG_STATE = 0x2545f491;
// Mersenne Twister MT19937, seeded the same way as CPython's random module
const MT = (() => {
  const N = 624, M = 397;
  const mt = new Uint32Array(N);
  let idx = N + 1;
  const initGenrand = (sd) => {
    mt[0] = sd >>> 0;
    for (let i = 1; i < N; i++) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = (Math.imul(1812433253, prev) + i) >>> 0;
    }
    idx = N;
  };
  const initByArray = (key) => {
    initGenrand(19650218);
    let i = 1, j = 0;
    for (let k = Math.max(N, key.length); k; k--) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(prev, 1664525)) + key[j] + j) >>> 0;
      i++; j++;
      if (i >= N) { mt[0] = mt[N - 1]; i = 1; }
      if (j >= key.length) j = 0;
    }
    for (let k = N - 1; k; k--) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(prev, 1566083941)) - i) >>> 0;
      i++;
      if (i >= N) { mt[0] = mt[N - 1]; i = 1; }
    }
    mt[0] = 0x80000000;
  };
  const next32 = () => {
    if (idx >= N) {
      if (idx === N + 1) initGenrand(5489);
      let kk = 0, y;
      for (; kk < N - M; kk++) { y = (mt[kk] & 0x80000000) | (mt[kk + 1] & 0x7fffffff); mt[kk] = mt[kk + M] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0); }
      for (; kk < N - 1; kk++) { y = (mt[kk] & 0x80000000) | (mt[kk + 1] & 0x7fffffff); mt[kk] = mt[kk + (M - N)] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0); }
      y = (mt[N - 1] & 0x80000000) | (mt[0] & 0x7fffffff);
      mt[N - 1] = mt[M - 1] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      idx = 0;
    }
    let y = mt[idx++];
    y ^= (y >>> 11);
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= (y >>> 18);
    return y >>> 0;
  };
  const api = {
    seedInt(n) {
      const key = [];
      if (n === 0n) key.push(0);
      while (n > 0n) { key.push(Number(n & 0xffffffffn)); n >>= 32n; }
      initByArray(key);
      idx = N;
    },
    random() { const a = next32() >>> 5, b = next32() >>> 6; return (a * 67108864.0 + b) * (1.0 / 9007199254740992.0); },
    getrandbits(k) {
      if (k < 0) throw pyErr('ValueError', 'number of bits must be non-negative');
      if (k === 0) return 0n;
      if (k <= 32) return BigInt(next32() >>> (32 - k));
      let r = 0n, shift = 0n;
      for (let kk = k; kk > 0; kk -= 32) {
        let w = next32();
        if (kk < 32) w >>>= (32 - kk);
        r |= BigInt(w) << shift;
        shift += 32n;
      }
      return r;
    },
  };
  api.seedInt(BigInt(Date.now()));
  return api;
})();
function bitLen(n) { n = big(n); if (n < 0n) n = -n; return n === 0n ? 0 : n.toString(2).length; }
function rng() { RNG_STATE ^= RNG_STATE << 13; RNG_STATE ^= RNG_STATE >>> 17; RNG_STATE ^= RNG_STATE << 5; return ((RNG_STATE >>> 0) / 4294967296); }

function deepCopy(vm, v, memo) {
  if (typeof v !== 'object' || v === null || v === NONE || v instanceof PyFloat || v instanceof PyFunction || v instanceof PyClass || v instanceof PyType || v instanceof PyBuiltin) return v;
  if (memo.has(v)) return memo.get(v);
  if (v instanceof PyList) { const n = new PyList([]); memo.set(v, n); n.a = v.a.map((x) => deepCopy(vm, x, memo)); return n; }
  if (v instanceof PyTuple) return new PyTuple(v.a.map((x) => deepCopy(vm, x, memo)));
  if (v instanceof PyDict) { const n = new PyDict(); n.kind = v.kind; n.factory = v.factory; memo.set(v, n); for (const e of v.m.values()) dictSet(n, deepCopy(vm, e[0], memo), deepCopy(vm, e[1], memo)); return n; }
  if (v instanceof PySet) { const n = new PySet(v.frozen); memo.set(v, n); for (const x of setOrder(v)) setAdd(n, deepCopy(vm, x, memo)); return n; }
  if (v instanceof PyDeque) { const n = new PyDeque([]); memo.set(v, n); n.a = v.a.map((x) => deepCopy(vm, x, memo)); return n; }
  if (v instanceof PyInstance) { const n = new PyInstance(v.cls); memo.set(v, n); n.excArgs = v.excArgs; for (const [k, x] of v.dict) n.dict.set(k, deepCopy(vm, x, memo)); return n; }
  return v;
}

const typingPlaceholder = (name) => new PyType(name, () => true, function () { throw pyErr('TypeError', `Type ${name} cannot be instantiated`); });

const MODULES = {
  math: () => modDict({
    pi: F(Math.PI), e: F(Math.E), tau: F(2 * Math.PI), inf: F(Infinity), nan: F(NaN),
    sqrt: bi('sqrt', function (args) { const x = mathArg(args[0]); if (x < 0) throw pyErr('ValueError', 'math domain error'); return F(Math.sqrt(x)); }),
    isqrt: bi('isqrt', function (args) {
      const n = big(asInt(args[0]));
      if (n < 0n) throw pyErr('ValueError', 'isqrt() argument must be nonnegative');
      if (n < 2n) return normInt(n);
      let x = BigInt(Math.floor(Math.sqrt(Number(n))));
      while (x * x > n) x -= 1n;
      while ((x + 1n) * (x + 1n) <= n) x += 1n;
      return normInt(x);
    }),
    floor: bi('floor', function (args) { const v = args[0]; if (isIntV(v)) return asInt(v); const x = mathArg(v); return Math.abs(x) <= MAXS ? Math.floor(x) : normInt(BigInt(Math.floor(x))); }),
    ceil: bi('ceil', function (args) { const v = args[0]; if (isIntV(v)) return asInt(v); const x = mathArg(v); const c = Math.ceil(x); return c === 0 ? 0 : (Math.abs(c) <= MAXS ? c : normInt(BigInt(c))); }),
    trunc: bi('trunc', function (args) { const v = args[0]; if (isIntV(v)) return asInt(v); return Math.trunc(mathArg(v)) || 0; }),
    fabs: bi('fabs', function (args) { return F(Math.abs(mathArg(args[0]))); }),
    exp: bi('exp', function (args) { return F(Math.exp(mathArg(args[0]))); }),
    log: bi('log', function (args) {
      const x = mathArg(args[0]);
      if (x <= 0) throw pyErr('ValueError', 'math domain error');
      if (args.length > 1) { const b = mathArg(args[1]); if (b <= 0 || b === 1) throw pyErr(b === 1 ? 'ZeroDivisionError' : 'ValueError', b === 1 ? 'float division by zero' : 'math domain error'); return F(Math.log(x) / Math.log(b)); }
      return F(Math.log(x));
    }),
    log2: bi('log2', function (args) { const x = mathArg(args[0]); if (x <= 0) throw pyErr('ValueError', 'math domain error'); return F(Math.log2(x)); }),
    log10: bi('log10', function (args) { const x = mathArg(args[0]); if (x <= 0) throw pyErr('ValueError', 'math domain error'); return F(Math.log10(x)); }),
    pow: bi('pow', function (args) { return F(Math.pow(mathArg(args[0]), mathArg(args[1]))); }),
    factorial: bi('factorial', function (args) {
      const v = args[0];
      if (!isIntV(v)) throw pyErr('TypeError', "'float' object cannot be interpreted as an integer");
      const n = Number(asInt(v));
      if (n < 0) throw pyErr('ValueError', 'factorial() not defined for negative values');
      if (n > 5000) throw pyErr('OverflowError', 'factorial too large for this runner');
      let r = 1n;
      for (let i = 2n; i <= BigInt(n); i++) r *= i;
      this.tick(n);
      return normInt(r);
    }),
    gcd: bi('gcd', function (args) { let r = 0n; for (const a of args) { let x = big(asInt(a)), y = r; if (x < 0n) x = -x; while (x) { [y, x] = [x, y % x]; } r = y; } return normInt(r); }),
    lcm: bi('lcm', function (args) { let r = 1n; for (const a of args) { let x = big(asInt(a)); if (x < 0n) x = -x; if (x === 0n) return 0; let g = r, h = x; while (h) { [g, h] = [h, g % h]; } r = r / g * x; } return normInt(r); }),
    comb: bi('comb', function (args) { const n = big(asInt(args[0])), k = big(asInt(args[1])); if (k < 0n || k > n) return 0; let r = 1n; for (let i = 0n; i < k; i++) r = r * (n - i) / (i + 1n); return normInt(r); }),
    perm: bi('perm', function (args) { const n = big(asInt(args[0])); const k = args.length > 1 ? big(asInt(args[1])) : n; if (k > n) return 0; let r = 1n; for (let i = 0n; i < k; i++) r *= (n - i); return normInt(r); }),
    prod: bi('prod', function (args) { let r = 1; for (const x of this.toArray(args[0])) r = this.binop('*', r, x); return r; }),
    fsum: bi('fsum', function (args) { let s = 0; for (const x of this.toArray(args[0])) s += mathArg(x); return F(s); }),
    hypot: bi('hypot', function (args) { return F(Math.hypot(...args.map((a) => mathArg(a)))); }),
    sin: bi('sin', function (args) { return F(Math.sin(mathArg(args[0]))); }),
    cos: bi('cos', function (args) { return F(Math.cos(mathArg(args[0]))); }),
    tan: bi('tan', function (args) { return F(Math.tan(mathArg(args[0]))); }),
    atan2: bi('atan2', function (args) { return F(Math.atan2(mathArg(args[0]), mathArg(args[1]))); }),
    radians: bi('radians', function (args) { return F(mathArg(args[0]) * Math.PI / 180); }),
    degrees: bi('degrees', function (args) { return F(mathArg(args[0]) * 180 / Math.PI); }),
    isclose: bi('isclose', function (args, kw) { const a = mathArg(args[0]), b = mathArg(args[1]); const rt = fval(kwGet(kw, 'rel_tol', F(1e-9))), at = fval(kwGet(kw, 'abs_tol', F(0))); return a === b || Math.abs(a - b) <= Math.max(rt * Math.max(Math.abs(a), Math.abs(b)), at); }),
    isinf: bi('isinf', function (args) { const x = mathArg(args[0]); return x === Infinity || x === -Infinity; }),
    isnan: bi('isnan', function (args) { return Number.isNaN(mathArg(args[0])); }),
    isfinite: bi('isfinite', function (args) { return Number.isFinite(mathArg(args[0])); }),
    copysign: bi('copysign', function (args) { const a = Math.abs(mathArg(args[0])), b = mathArg(args[1]); return F(b < 0 || Object.is(b, -0) ? -a : a); }),
  }),
  collections: () => modDict({
    deque: T_DEQUE,
    Counter: T_COUNTER,
    defaultdict: T_DEFAULTDICT,
    OrderedDict: T_DICT,
  }),
  heapq: () => modDict({
    heappush: bi('heappush', function (args) { nargs('heappush', args, 2, 2); const h = needList(args[0], 'heappush'); h.push(args[1]); heapSiftDown(this, h, 0, h.length - 1); return NONE; }),
    heappop: bi('heappop', function (args) {
      nargs('heappop', args, 1, 1);
      const h = needList(args[0], 'heappop');
      if (!h.length) throw pyErr('IndexError', 'index out of range');
      const last = h.pop();
      if (h.length) { const ret = h[0]; h[0] = last; heapSiftUp(this, h, 0); return ret; }
      return last;
    }),
    heapify: bi('heapify', function (args) { const h = needList(args[0], 'heapify'); for (let i = (h.length >> 1) - 1; i >= 0; i--) heapSiftUp(this, h, i); return NONE; }),
    heappushpop: bi('heappushpop', function (args) { const h = needList(args[0], 'heappushpop'); let item = args[1]; if (h.length && pyLt(h[0], item)) { const t = h[0]; h[0] = item; item = t; heapSiftUp(this, h, 0); } return item; }),
    heapreplace: bi('heapreplace', function (args) { const h = needList(args[0], 'heapreplace'); if (!h.length) throw pyErr('IndexError', 'index out of range'); const ret = h[0]; h[0] = args[1]; heapSiftUp(this, h, 0); return ret; }),
    nsmallest: bi('nsmallest', function (args, kw) { const n = Number(asInt(args[0])); return new PyList(pySortArray(this, this.toArray(args[1]), kwGet(kw, 'key', NONE), false).slice(0, Math.max(0, n))); }),
    nlargest: bi('nlargest', function (args, kw) { const n = Number(asInt(args[0])); return new PyList(pySortArray(this, this.toArray(args[1]), kwGet(kw, 'key', NONE), true).slice(0, Math.max(0, n))); }),
  }),
  functools: () => modDict({
    lru_cache: bi('lru_cache', function (args, kw) {
      if (args.length && (args[0] instanceof PyFunction || args[0] instanceof PyBuiltin)) return lruCacheDecorator(128).fn.call(this, [args[0]], null);
      let ms = args.length ? args[0] : kwGet(kw, 'maxsize', 128);
      ms = ms === NONE ? null : Number(asInt(ms));
      return lruCacheDecorator(ms);
    }),
    cache: bi('cache', function (args) { return lruCacheDecorator(null).fn.call(this, [args[0]], null); }),
    reduce: bi('reduce', function (args) {
      nargs('reduce', args, 2, 3);
      const items = this.toArray(args[1]);
      let acc, i = 0;
      if (args.length > 2) acc = args[2];
      else { if (!items.length) throw pyErr('TypeError', 'reduce() of empty iterable with no initial value'); acc = items[0]; i = 1; }
      for (; i < items.length; i++) acc = this.callValue(args[0], [acc, items[i]], null);
      return acc;
    }),
    wraps: bi('wraps', function () { return bi('decorator', function (a) { return a[0]; }); }),
    cmp_to_key: bi('cmp_to_key', function (args) {
      const cmp = args[0];
      const KeyCls = new PyClass('K', [], new Map());
      KeyCls.dict.set('__lt__', bi('__lt__', function (a) { return icmp(asInt(this.callValue(cmp, [a[0].dict.get('obj'), a[1].dict.get('obj')], null)), 0) < 0; }));
      return bi('key', function (a) { const k = new PyInstance(KeyCls); k.dict.set('obj', a[0]); return k; });
    }),
  }),
  itertools: () => modDict({
    permutations: bi('permutations', function (args) {
      const pool = this.toArray(args[0]);
      const r = args.length > 1 && args[1] !== NONE ? Number(asInt(args[1])) : pool.length;
      const out = [];
      const used = new Array(pool.length).fill(false), cur = [];
      const rec = () => {
        if (cur.length === r) { out.push(new PyTuple(cur.slice())); return; }
        for (let i = 0; i < pool.length; i++) { if (used[i]) continue; used[i] = true; cur.push(pool[i]); rec(); cur.pop(); used[i] = false; }
      };
      if (r <= pool.length) rec();
      this.tick(out.length);
      return makeIter(out, 'itertools.permutations');
    }),
    combinations: bi('combinations', function (args) {
      const pool = this.toArray(args[0]);
      const r = Number(asInt(args[1]));
      const out = [], cur = [];
      const rec = (start) => {
        if (cur.length === r) { out.push(new PyTuple(cur.slice())); return; }
        for (let i = start; i < pool.length; i++) { cur.push(pool[i]); rec(i + 1); cur.pop(); }
      };
      rec(0);
      this.tick(out.length);
      return makeIter(out, 'itertools.combinations');
    }),
    combinations_with_replacement: bi('combinations_with_replacement', function (args) {
      const pool = this.toArray(args[0]);
      const r = Number(asInt(args[1]));
      const out = [], cur = [];
      const rec = (start) => {
        if (cur.length === r) { out.push(new PyTuple(cur.slice())); return; }
        for (let i = start; i < pool.length; i++) { cur.push(pool[i]); rec(i); cur.pop(); }
      };
      rec(0);
      return makeIter(out, 'itertools.combinations_with_replacement');
    }),
    product: bi('product', function (args, kw) {
      const rep = Number(asInt(kwGet(kw, 'repeat', 1)));
      let pools = args.map((a) => this.toArray(a));
      let all = [];
      for (let k = 0; k < rep; k++) all = all.concat(pools);
      let res = [[]];
      for (const p of all) { const next = []; for (const r of res) for (const x of p) next.push(r.concat([x])); res = next; }
      this.tick(res.length);
      return makeIter(res.map((r) => new PyTuple(r)), 'itertools.product');
    }),
    chain: bi('chain', function (args) { const out = []; for (const a of args) pushAll(out, this.toArray(a)); return makeIter(out, 'itertools.chain'); }),
    accumulate: bi('accumulate', function (args, kw) {
      const items = this.toArray(args[0]);
      const fn = args.length > 1 ? args[1] : kwGet(kw, 'func', NONE);
      const out = [];
      let acc;
      const init = kwGet(kw, 'initial', NONE);
      if (init !== NONE) { acc = init; out.push(acc); }
      for (const x of items) { acc = acc === undefined ? x : (fn === NONE ? this.binop('+', acc, x) : this.callValue(fn, [acc, x], null)); out.push(acc); }
      return makeIter(out, 'itertools.accumulate');
    }),
    count: bi('count', function (args) { let i = args.length ? args[0] : 0; const step = args.length > 1 ? args[1] : 1; return new PyIter(() => { const v = i; i = this.binop('+', i, step); return v; }, 'itertools.count'); }),
    islice: bi('islice', function (args) {
      const it = this.iterOf(args[0]);
      let start = 0, stop, step = 1;
      if (args.length === 2) stop = args[1] === NONE ? Infinity : Number(asInt(args[1]));
      else { start = Number(asInt(args[1])); stop = args[2] === NONE ? Infinity : Number(asInt(args[2])); if (args.length > 3) step = Number(asInt(args[3])); }
      let i = 0;
      return new PyIter(() => {
        for (;;) {
          if (i >= stop) return STOP;
          const v = it.next();
          if (v === STOP) return STOP;
          const cur = i++;
          if (cur >= start && (cur - start) % step === 0) return v;
        }
      }, 'itertools.islice');
    }),
    zip_longest: bi('zip_longest', function (args, kw) {
      const fill = kwGet(kw, 'fillvalue', NONE);
      const arrs = args.map((a) => this.toArray(a));
      const n = Math.max(0, ...arrs.map((a) => a.length));
      const out = [];
      for (let i = 0; i < n; i++) out.push(new PyTuple(arrs.map((a) => (i < a.length ? a[i] : fill))));
      return makeIter(out, 'itertools.zip_longest');
    }),
    repeat: bi('repeat', function (args) { const v = args[0]; let n = args.length > 1 ? Number(asInt(args[1])) : Infinity; return new PyIter(() => (n-- > 0 ? v : STOP), 'itertools.repeat'); }),
  }),
  bisect: () => {
    const bl = function (args, kw) {
      const a = needList(args[0], 'bisect_left'), x = args[1];
      let lo = args.length > 2 ? Number(asInt(args[2])) : 0, hi = args.length > 3 ? Number(asInt(args[3])) : a.length;
      const key = kwGet(kw, 'key', NONE);
      while (lo < hi) { const mid = (lo + hi) >> 1; const v = key !== NONE ? this.callValue(key, [a[mid]], null) : a[mid]; this.tick(1); if (pyLt(v, x)) lo = mid + 1; else hi = mid; }
      return lo;
    };
    const br = function (args, kw) {
      const a = needList(args[0], 'bisect_right'), x = args[1];
      let lo = args.length > 2 ? Number(asInt(args[2])) : 0, hi = args.length > 3 ? Number(asInt(args[3])) : a.length;
      const key = kwGet(kw, 'key', NONE);
      while (lo < hi) { const mid = (lo + hi) >> 1; const v = key !== NONE ? this.callValue(key, [a[mid]], null) : a[mid]; this.tick(1); if (pyLt(x, v)) hi = mid; else lo = mid + 1; }
      return lo;
    };
    return modDict({
      bisect_left: bi('bisect_left', bl),
      bisect_right: bi('bisect_right', br),
      bisect: bi('bisect', br),
      insort_left: bi('insort_left', function (args, kw) { const i = bl.call(this, args, kw); args[0].a.splice(i, 0, args[1]); this.tick(args[0].a.length - i); return NONE; }),
      insort: bi('insort', function (args, kw) { const i = br.call(this, args, kw); args[0].a.splice(i, 0, args[1]); this.tick(args[0].a.length - i); return NONE; }),
      insort_right: bi('insort_right', function (args, kw) { const i = br.call(this, args, kw); args[0].a.splice(i, 0, args[1]); this.tick(args[0].a.length - i); return NONE; }),
    });
  },
  random: () => {
    // CPython-compatible Mersenne Twister (same numbers as real Python for the same integer seed)
    const R = MT;
    const randbelow = (n) => { const k = bitLen(n); let r = R.getrandbits(k); while (r >= n) r = R.getrandbits(k); return r; };
    const randbelowN = (n) => Number(randbelow(BigInt(n)));
    const randrange = (args) => {
      const istart = big(asInt(args[0]));
      if (args.length < 2 || args[1] === NONE) {
        if (istart > 0n) return normInt(randbelow(istart));
        throw pyErr('ValueError', 'empty range for randrange()');
      }
      const istop = big(asInt(args[1]));
      const istep = args.length > 2 ? big(asInt(args[2])) : 1n;
      const width = istop - istart;
      if (istep === 1n) {
        if (width > 0n) return normInt(istart + randbelow(width));
        throw pyErr('ValueError', `empty range in randrange(${istart}, ${istop})`);
      }
      let n;
      if (istep > 0n) n = (width + istep - 1n) / istep;
      else if (istep < 0n) n = (width + istep + 1n) / istep;
      else throw pyErr('ValueError', 'zero step for randrange()');
      if (n <= 0n) throw pyErr('ValueError', 'empty range for randrange()');
      return normInt(istart + istep * randbelow(n));
    };
    return modDict({
      seed: bi('seed', function (args) {
        let a = args.length ? args[0] : NONE;
        if (a === NONE) { R.seedInt(BigInt(Date.now()) * 1000003n + BigInt(Math.floor(Math.random() * 1e9))); return NONE; }
        if (isIntV(a) || typeof a === 'boolean') { let b = big(a); if (b < 0n) b = -b; R.seedInt(b); return NONE; }
        let h = big(pyHashValue(a));
        if (h < 0n) h = BigInt.asUintN(64, h);
        R.seedInt(h);
        return NONE;
      }),
      random: bi('random', function () { return F(R.random()); }),
      getrandbits: bi('getrandbits', function (args) { return normInt(R.getrandbits(Number(asInt(args[0])))); }),
      randrange: bi('randrange', function (args) { return randrange(args); }),
      randint: bi('randint', function (args) { nargs('randint', args, 2, 2); return randrange([args[0], normInt(big(asInt(args[1])) + 1n)]); }),
      choice: bi('choice', function (args) {
        const a = this.toArray(args[0]);
        if (!a.length) throw pyErr('IndexError', 'Cannot choose from an empty sequence');
        return a[randbelowN(a.length)];
      }),
      choices: bi('choices', function (args, kw) {
        const pop = this.toArray(args[0]);
        const k = Number(asInt(kwGet(kw, 'k', 1)));
        let weights = args.length > 1 ? args[1] : kwGet(kw, 'weights', NONE);
        const n = pop.length;
        const out = [];
        if (weights === NONE) {
          for (let i = 0; i < k; i++) out.push(pop[Math.floor(R.random() * n)]);
          return new PyList(out);
        }
        const w = this.toArray(weights).map((x) => mathArg(x));
        const cum = [];
        let acc = 0;
        for (const x of w) { acc += x; cum.push(acc); }
        if (cum.length !== n) throw pyErr('ValueError', 'The number of weights does not match the population');
        const total = cum[cum.length - 1];
        for (let i = 0; i < k; i++) {
          const x = R.random() * total;
          let lo = 0, hi = n - 1;
          while (lo < hi) { const mid = (lo + hi) >> 1; if (x < cum[mid]) hi = mid; else lo = mid + 1; }
          out.push(pop[lo]);
        }
        return new PyList(out);
      }),
      shuffle: bi('shuffle', function (args) {
        const a = args[0].a;
        for (let i = a.length - 1; i > 0; i--) { const j = randbelowN(i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; }
        this.tick(a.length);
        return NONE;
      }),
      sample: bi('sample', function (args, kw) {
        const pop = this.toArray(args[0]);
        const n = pop.length;
        const k = Number(asInt(args.length > 1 ? args[1] : kwGet(kw, 'k', 0)));
        if (!(k >= 0 && k <= n)) throw pyErr('ValueError', 'Sample larger than population or is negative');
        const result = new Array(k).fill(NONE);
        let setsize = 21;
        if (k > 5) setsize += Math.pow(4, Math.ceil(Math.log(k * 3) / Math.log(4)));
        if (n <= setsize) {
          const pool = pop.slice();
          for (let i = 0; i < k; i++) { const j = randbelowN(n - i); result[i] = pool[j]; pool[j] = pool[n - i - 1]; }
        } else {
          const selected = new Set();
          for (let i = 0; i < k; i++) { let j = randbelowN(n); while (selected.has(j)) j = randbelowN(n); selected.add(j); result[i] = pop[j]; }
        }
        this.tick(n);
        return new PyList(result);
      }),
      uniform: bi('uniform', function (args) { const a = mathArg(args[0]), b = mathArg(args[1]); return F(a + (b - a) * R.random()); }),
    });
  },
  time: () => modDict({
    time: bi('time', function () { return F(Date.now() / 1000); }),
    perf_counter: bi('perf_counter', function () { return F((typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000); }),
    sleep: bi('sleep', function () { return NONE; }),
  }),
  sys: () => modDict({
    setrecursionlimit: bi('setrecursionlimit', function (args) { this.maxDepth = Math.min(3000, Math.max(50, Number(asInt(args[0])))); return NONE; }),
    getrecursionlimit: bi('getrecursionlimit', function () { return this.maxDepth; }),
    maxsize: 9223372036854775807n,
    version: '3.13 (Stepwise runner)',
  }),
  string: () => modDict({
    ascii_lowercase: 'abcdefghijklmnopqrstuvwxyz', ascii_uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    ascii_letters: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', digits: '0123456789',
    punctuation: '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~', whitespace: ' \t\n\r\x0b\x0c',
  }),
  typing: () => modDict({
    List: T_LIST, Dict: T_DICT, Set: T_SET, Tuple: T_TUPLE, Optional: typingPlaceholder('Optional'), Any: typingPlaceholder('Any'),
    Union: typingPlaceholder('Union'), Callable: typingPlaceholder('Callable'), Iterable: typingPlaceholder('Iterable'),
  }),
  copy: () => modDict({
    copy: bi('copy', function (args) {
      const v = args[0];
      if (v instanceof PyList) return new PyList(v.a.slice());
      if (v instanceof PyDict) return DICT_METHODS.get('copy').call(this, [], null, v);
      if (v instanceof PySet) return SET_METHODS.get('copy').call(this, [], null, v);
      if (v instanceof PyInstance) { const n = new PyInstance(v.cls); for (const [k, x] of v.dict) n.dict.set(k, x); return n; }
      return v;
    }),
    deepcopy: bi('deepcopy', function (args) { return deepCopy(this, args[0], new Map()); }),
  }),
};
const KNOWN_UNSUPPORTED = new Set(['numpy', 'pandas', 'os', 'requests', 'turtle', 'tkinter', 'matplotlib', 'dataclasses', 'threading', 'asyncio', 're', 'json', 'datetime', 'pathlib', 'csv', 'socket', 'subprocess', 'pygame', 'statistics', 'fractions', 'decimal', 'enum', 'abc', 'operator']);
