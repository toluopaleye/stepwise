// ===== PyRun values: object model, numbers, repr, equality, hashing, formatting =====

class PyNoneType {}
const NONE = new PyNoneType();
class PyEllipsisType {}
const ELLIPSIS = new PyEllipsisType();
class PyNotImplementedType {}
const NOT_IMPL = new PyNotImplementedType();
const STOP = Symbol('stop');

let OBJ_ID = 1;
function objId(o) { if (!o.__id) Object.defineProperty(o, '__id', { value: OBJ_ID++, enumerable: false }); return o.__id; }
function addr(o) { return (0x7f3a10000000 + objId(o) * 0x30).toString(16); }

class PyFloat { constructor(v) { this.v = v; } }
class PyList { constructor(a) { this.a = a || []; } }
class PyTuple { constructor(a) { this.a = a || []; } }
class PyDict {
  constructor() { this.m = new Map(); this.kind = null; this.factory = null; }
}
class PySet {
  constructor(frozen) { this.m = new Map(); this.frozen = !!frozen; this.order = null; this.tbl = null; }
}
class PyRange {
  constructor(start, stop, step) { this.start = start; this.stop = stop; this.step = step; }
  get length() {
    const { start, stop, step } = this;
    if (step > 0) return stop > start ? Math.floor((stop - start - 1) / step) + 1 : 0;
    return start > stop ? Math.floor((start - stop - 1) / -step) + 1 : 0;
  }
  at(i) { return this.start + i * this.step; }
}
class PySlice { constructor(start, stop, step) { this.start = start; this.stop = stop; this.step = step; } }
class PyFunction {
  constructor(name, node, closure, defaults, qualname, isLambda) {
    this.name = name; this.node = node; this.closure = closure; this.defaults = defaults;
    this.qualname = qualname || name; this.isLambda = !!isLambda; this.ownerClass = null; this.attrs = null;
  }
}
class PyBuiltin {
  constructor(name, fn, self, owner) { this.name = name; this.fn = fn; this.self = self === undefined ? null : self; this.owner = owner || null; }
}
class PyBound { constructor(self, fn) { this.self = self; this.fn = fn; } }
class PyClass {
  constructor(name, bases, dict) {
    this.name = name; this.bases = bases; this.dict = dict; this.isException = bases.some((b) => b.isException);
    this.builtin = false;
    this.mro = c3mro(this);
  }
}
class PyInstance { constructor(cls) { this.cls = cls; this.dict = new Map(); this.excArgs = null; } }
class PyModule { constructor(name, dict) { this.name = name; this.dict = dict; } }
class PyIter { constructor(next, name) { this.next = next; this.name = name || 'iterator'; } }
class PyDeque { constructor(a) { this.a = a || []; } }
class PySuper { constructor(cls, obj) { this.cls = cls; this.obj = obj; } }
class PyDictView { constructor(d, kind) { this.d = d; this.kind = kind; } }
class PyStaticMethod { constructor(fn) { this.fn = fn; } }
class PyClassMethod { constructor(fn) { this.fn = fn; } }
class PyProperty { constructor(fget) { this.fget = fget; this.fset = null; } }
class PyType {
  // built-in type object (int, str, list, ...)
  constructor(name, test, call) { this.name = name; this.test = test; this.call = call; this.methods = null; }
}

function c3mro(cls) {
  const seqs = cls.bases.map((b) => b.mro.slice()).concat([cls.bases.slice()]);
  const res = [cls];
  for (;;) {
    const ne = seqs.filter((s) => s.length);
    if (!ne.length) return res;
    let cand = null;
    for (const s of ne) {
      const c = s[0];
      if (!ne.some((t) => t.indexOf(c) > 0)) { cand = c; break; }
    }
    if (!cand) throw pyErr('TypeError', 'Cannot create a consistent method resolution order (MRO)');
    res.push(cand);
    for (const s of ne) if (s[0] === cand) s.shift();
  }
}

// ---------- integers ----------
const MAXS = 9007199254740991;
function normInt(b) { return (b <= 9007199254740991n && b >= -9007199254740991n) ? Number(b) : b; }
function big(v) { return typeof v === 'bigint' ? v : BigInt(v === true ? 1 : v === false ? 0 : v); }
function intNeg(v) { return typeof v === 'bigint' ? normInt(-v) : (v === 0 ? 0 : -v); }
function isIntV(v) { return typeof v === 'number' || typeof v === 'bigint' || typeof v === 'boolean'; }
function isNumV(v) { return isIntV(v) || v instanceof PyFloat; }
function asInt(v) { return v === true ? 1 : v === false ? 0 : v; }
function fval(v) { return v instanceof PyFloat ? v.v : typeof v === 'bigint' ? Number(v) : v === true ? 1 : v === false ? 0 : v; }
function F(x) { return new PyFloat(x); }
function iadd(a, b) { if (typeof a === 'number' && typeof b === 'number') { const r = a + b; if (r <= MAXS && r >= -MAXS) return r; } return normInt(big(a) + big(b)); }
function isub(a, b) { if (typeof a === 'number' && typeof b === 'number') { const r = a - b; if (r <= MAXS && r >= -MAXS) return r; } return normInt(big(a) - big(b)); }
function imul(a, b) { if (typeof a === 'number' && typeof b === 'number') { const r = a * b; if (r <= MAXS && r >= -MAXS) return r === 0 ? 0 : r; } return normInt(big(a) * big(b)); }
function ifloordiv(a, b) {
  if (typeof a === 'number' && typeof b === 'number') {
    let q = Math.floor(a / b);
    const r = a - q * b;
    if (b > 0) { if (r < 0) q -= 1; else if (r >= b) q += 1; } else { if (r > 0) q -= 1; else if (r <= b) q += 1; }
    return q === 0 ? 0 : q;
  }
  const A = big(a), B = big(b);
  let q = A / B;
  if (A % B !== 0n && ((A < 0n) !== (B < 0n))) q -= 1n;
  return normInt(q);
}
function imod(a, b) {
  if (typeof a === 'number' && typeof b === 'number') {
    let r = a % b;
    if (r !== 0 && ((r < 0) !== (b < 0))) r += b;
    return r === 0 ? 0 : r;
  }
  const A = big(a), B = big(b);
  let r = A % B;
  if (r !== 0n && ((r < 0n) !== (B < 0n))) r += B;
  return normInt(r);
}
function ipow(a, b) {
  const A = big(a), B = big(b);
  if (B > 100000n && (A > 1n || A < -1n)) throw pyErr('OverflowError', 'result too large for this runner');
  const bits = Number(B) * Math.log2(Math.abs(Number(A)) || 1);
  if (bits > 200000) throw pyErr('OverflowError', 'result too large for this runner');
  return normInt(A ** B);
}
function icmp(a, b) { // -1, 0, 1 for ints
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0;
  const A = big(a), B = big(b);
  return A < B ? -1 : A > B ? 1 : 0;
}

// ---------- type names ----------
function typeName(v) {
  if (v === NONE) return 'NoneType';
  switch (typeof v) {
    case 'boolean': return 'bool';
    case 'number': case 'bigint': return 'int';
    case 'string': return 'str';
  }
  if (v instanceof PyFloat) return 'float';
  if (v instanceof PyList) return 'list';
  if (v instanceof PyTuple) return 'tuple';
  if (v instanceof PyDict) return v.kind || 'dict';
  if (v instanceof PySet) return v.frozen ? 'frozenset' : 'set';
  if (v instanceof PyRange) return 'range';
  if (v instanceof PyFunction) return 'function';
  if (v instanceof PyBuiltin) return v.self !== null ? 'builtin_function_or_method' : 'builtin_function_or_method';
  if (v instanceof PyBound) return 'method';
  if (v instanceof PyInstance) return v.cls.name;
  if (v instanceof PyClass || v instanceof PyType) return 'type';
  if (v instanceof PyModule) return 'module';
  if (v instanceof PyIter) return v.name;
  if (v instanceof PyDeque) return 'collections.deque';
  if (v instanceof PyDictView) return 'dict_' + v.kind;
  if (v instanceof PySlice) return 'slice';
  if (v instanceof PySuper) return 'super';
  if (v === ELLIPSIS) return 'ellipsis';
  if (v === NOT_IMPL) return 'NotImplementedType';
  return 'object';
}
function shortTypeName(v) { const n = typeName(v); return n === 'collections.deque' ? 'deque' : n; }

// ---------- repr / str ----------
function reprStr(s) {
  const q = (s.indexOf("'") >= 0 && s.indexOf('"') < 0) ? '"' : "'";
  let out = q;
  for (const ch of s) {
    if (ch === q || ch === '\\') out += '\\' + ch;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else {
      const cp = ch.codePointAt(0);
      if (cp < 0x20 || cp === 0x7f) out += '\\x' + cp.toString(16).padStart(2, '0');
      else out += ch;
    }
  }
  return out + q;
}

function floatRepr(x) {
  if (Number.isNaN(x)) return 'nan';
  if (x === Infinity) return 'inf';
  if (x === -Infinity) return '-inf';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  let s = String(x);
  let sign = '';
  if (s[0] === '-') { sign = '-'; s = s.slice(1); }
  let mant = s, exp = 0;
  const ei = s.indexOf('e');
  if (ei >= 0) { mant = s.slice(0, ei); exp = parseInt(s.slice(ei + 1), 10); }
  const dot = mant.indexOf('.');
  const ip = dot >= 0 ? mant.slice(0, dot) : mant;
  const fp = dot >= 0 ? mant.slice(dot + 1) : '';
  let digits = ip + fp;
  let pointPos = ip.length + exp;
  const lz = digits.match(/^0*/)[0].length;
  digits = digits.slice(lz);
  pointPos -= lz;
  digits = digits.replace(/0+$/, '');
  if (!digits) return sign + '0.0';
  const e10 = pointPos - 1;
  if (e10 < -4 || e10 >= 16) {
    const m = digits[0] + (digits.length > 1 ? '.' + digits.slice(1) : '');
    return sign + m + 'e' + (e10 < 0 ? '-' : '+') + String(Math.abs(e10)).padStart(2, '0');
  }
  let res;
  if (pointPos <= 0) res = '0.' + '0'.repeat(-pointPos) + digits;
  else if (pointPos >= digits.length) res = digits + '0'.repeat(pointPos - digits.length) + '.0';
  else res = digits.slice(0, pointPos) + '.' + digits.slice(pointPos);
  return sign + res;
}

function repr(v, seen) {
  if (v === NONE) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'string') return reprStr(v);
  if (v instanceof PyFloat) return floatRepr(v.v);
  seen = seen || new Set();
  if (v instanceof PyList) {
    if (seen.has(v)) return '[...]';
    seen.add(v);
    const r = '[' + v.a.map((x) => repr(x, seen)).join(', ') + ']';
    seen.delete(v);
    return r;
  }
  if (v instanceof PyTuple) {
    if (v.a.length === 1) return '(' + repr(v.a[0], seen) + ',)';
    return '(' + v.a.map((x) => repr(x, seen)).join(', ') + ')';
  }
  if (v instanceof PyDict) {
    if (seen.has(v)) return '{...}';
    seen.add(v);
    let entries = [...v.m.values()];
    if (v.kind === 'Counter') entries = counterOrder(entries);
    const body = entries.map(([k, x]) => repr(k, seen) + ': ' + repr(x, seen)).join(', ');
    seen.delete(v);
    if (v.kind === 'defaultdict') return 'defaultdict(' + repr(v.factory === null ? NONE : v.factory) + ', {' + body + '})';
    if (v.kind === 'Counter') return entries.length ? 'Counter({' + body + '})' : 'Counter()';
    return '{' + body + '}';
  }
  if (v instanceof PySet) {
    const items = setOrder(v);
    if (!items.length) return v.frozen ? 'frozenset()' : 'set()';
    const body = '{' + items.map((x) => repr(x, seen)).join(', ') + '}';
    return v.frozen ? 'frozenset(' + body + ')' : body;
  }
  if (v instanceof PyRange) return v.step === 1 ? `range(${v.start}, ${v.stop})` : `range(${v.start}, ${v.stop}, ${v.step})`;
  if (v instanceof PyDeque) return 'deque([' + v.a.map((x) => repr(x, seen)).join(', ') + '])';
  if (v instanceof PyFunction) return v.isLambda ? `<function <lambda> at 0x${addr(v)}>` : `<function ${v.qualname} at 0x${addr(v)}>`;
  if (v instanceof PyBuiltin) {
    if (v.self !== null && v.self !== undefined) return `<built-in method ${v.name} of ${typeName(v.self)} object at 0x${addr(v.self)}>`;
    return `<built-in function ${v.name}>`;
  }
  if (v instanceof PyBound) {
    const fnName = v.fn instanceof PyFunction ? v.fn.qualname : v.fn.name;
    return `<bound method ${fnName} of ${repr(v.self, seen)}>`;
  }
  if (v instanceof PyClass) return v.builtin ? `<class '${v.name}'>` : `<class '__main__.${v.name}'>`;
  if (v instanceof PyType) return `<class '${v.name}'>`;
  if (v instanceof PyModule) return `<module '${v.name}' (built-in)>`;
  if (v instanceof PyInstance) {
    const m = VM && VM.findMethod(v, '__repr__');
    if (m) return asStrResult(VM.callValue(m, [v], null), '__repr__');
    if (v.cls.isException) return v.cls.name + '(' + (v.excArgs || []).map((x) => repr(x, seen)).join(', ') + ')';
    return `<__main__.${v.cls.name} object at 0x${addr(v)}>`;
  }
  if (v instanceof PyIter) return `<${v.name} object at 0x${addr(v)}>`;
  if (v instanceof PyDictView) {
    const items = dictViewItems(v);
    return `dict_${v.kind}([` + items.map((x) => repr(x, seen)).join(', ') + '])';
  }
  if (v instanceof PySlice) return `slice(${repr(v.start)}, ${repr(v.stop)}, ${repr(v.step)})`;
  if (v instanceof PyStaticMethod) return `<staticmethod object at 0x${addr(v)}>`;
  if (v instanceof PyClassMethod) return `<classmethod object at 0x${addr(v)}>`;
  if (v instanceof PyProperty) return `<property object at 0x${addr(v)}>`;
  if (v instanceof PySuper) return `<super: <class '${v.cls.name}'>, <${typeName(v.obj)} object>>`;
  if (v === ELLIPSIS) return 'Ellipsis';
  if (v === NOT_IMPL) return 'NotImplemented';
  return '<object>';
}
function asStrResult(r, which) {
  if (typeof r !== 'string') throw pyErr('TypeError', `${which} returned non-string (type ${typeName(r)})`);
  return r;
}
function pyStr(v) {
  if (typeof v === 'string') return v;
  if (v instanceof PyInstance) {
    const m = VM && VM.findMethod(v, '__str__');
    if (m) return asStrResult(VM.callValue(m, [v], null), '__str__');
    if (v.cls.isException) {
      const a = v.excArgs || [];
      if (a.length === 0) return '';
      if (a.length === 1) return isKeyErrorCls(v.cls) ? repr(a[0]) : pyStr(a[0]);
      return repr(new PyTuple(a));
    }
  }
  return repr(v);
}
function isKeyErrorCls(cls) { return cls.mro.some((c) => c.builtin && c.name === 'KeyError'); }

function counterOrder(entries) {
  // most_common order: by count desc, stable by insertion
  return entries.map((e, i) => [e, i]).sort((x, y) => {
    const c = -numCmp(x[0][1], y[0][1]);
    return c !== 0 ? c : x[1] - y[1];
  }).map((x) => x[0]);
}
function numCmp(a, b) {
  if (isNumV(a) && isNumV(b)) {
    if (a instanceof PyFloat || b instanceof PyFloat) { const x = fval(a), y = fval(b); return x < y ? -1 : x > y ? 1 : 0; }
    return icmp(asInt(a), asInt(b));
  }
  return 0;
}

// ---------- hashing (dict/set keys) ----------
function hashKey(v) {
  switch (typeof v) {
    case 'string': return 's' + v;
    case 'number': return 'i' + v;
    case 'bigint': return 'i' + v.toString();
    case 'boolean': return v ? 'i1' : 'i0';
  }
  if (v === NONE) return 'N';
  if (v instanceof PyFloat) {
    if (Number.isInteger(v.v) && Math.abs(v.v) <= MAXS) return 'i' + v.v;
    if (Number.isInteger(v.v)) return 'i' + BigInt(v.v).toString();
    return 'f' + v.v;
  }
  if (v instanceof PyTuple) return 't(' + v.a.map(hashKey).join(',') + ')';
  if (v instanceof PySet && v.frozen) return 'z(' + [...v.m.keys()].sort().join(',') + ')';
  if (v instanceof PyInstance) {
    const h = VM && VM.findMethod(v, '__hash__');
    if (h) {
      if (h === NONE) throw pyErr('TypeError', `unhashable type: '${v.cls.name}'`);
      const r = VM.callValue(h, [v], null);
      return 'h' + hashKey(r);
    }
    if (VM && VM.findMethod(v, '__eq__')) throw pyErr('TypeError', `unhashable type: '${v.cls.name}'`);
    return 'o' + objId(v);
  }
  if (v instanceof PyList || v instanceof PyDict || (v instanceof PySet && !v.frozen) || v instanceof PyDeque) {
    throw pyErr('TypeError', `unhashable type: '${shortTypeName(v)}'`);
  }
  return 'o' + objId(v);
}

function dictGet(d, k) { const e = d.m.get(hashKey(k)); return e === undefined ? undefined : e[1]; }
function dictSet(d, k, v) {
  const h = hashKey(k);
  const e = d.m.get(h);
  if (e) e[1] = v; else d.m.set(h, [k, v]);
}
function dictHas(d, k) { return d.m.has(hashKey(k)); }
// ---------- sets ----------
// s.m (Map hashKey -> value) answers membership. For sets that only ever held ints/bools, s.tbl
// emulates CPython's setobject.c hash table exactly, so iteration order (and print output) matches
// real Python. s.tbl: null = empty and never used, object = emulated table, false = not emulated.
const SET_DUMMY = { dummy: true };
const SET_LP = 9;
function setEmuKey(v) {
  if ((typeof v === 'number' && Number.isInteger(v)) || typeof v === 'bigint' || typeof v === 'boolean') return true;
  return v instanceof PyTuple && v.a.length <= 16 && v.a.every(setEmuKey);
}
// CPython's tuple hash (xxHash-style lanes over the item hashes, 64-bit)
const XXP1 = 11400714785074694791n, XXP2 = 14029467366897019727n, XXP5 = 2870177450012600261n, U64 = (1n << 64n) - 1n;
function tupleHashBig(t) {
  let acc = XXP5;
  for (const x of t.a) {
    const hx = setHashOf(x);
    const lane = BigInt.asUintN(64, typeof hx === 'bigint' ? hx : BigInt(hx));
    acc = (acc + lane * XXP2) & U64;
    acc = ((acc << 31n) | (acc >> 33n)) & U64;
    acc = (acc * XXP1) & U64;
  }
  acc = (acc + (BigInt(t.a.length) ^ (XXP5 ^ 3527539n))) & U64;
  if (acc === U64) return 1546275796n;
  return BigInt.asIntN(64, acc);
}
function setKeyEq(a, b) {
  if (a instanceof PyTuple || b instanceof PyTuple) {
    if (!(a instanceof PyTuple && b instanceof PyTuple) || a.a.length !== b.a.length) return false;
    for (let i = 0; i < a.a.length; i++) if (!setKeyEq(a.a[i], b.a[i])) return false;
    return true;
  }
  return big(a) === big(b);
}
function pyHashInt(v) {
  const M = (1n << 61n) - 1n;
  let b = big(v);
  const neg = b < 0n;
  if (neg) b = -b;
  let h = b % M;
  if (neg) h = -h;
  if (h === -1n) h = -2n;
  return h;
}
function setHashOf(v) {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' && v >= 0 && v < 281474976710656) return v;
  const h = v instanceof PyTuple ? tupleHashBig(v) : pyHashInt(v);
  return (h >= 0n && h < 281474976710656n) ? Number(h) : h;
}
function tblNew(finger) { return { t: new Array(8).fill(null), mask: 7, fill: 0, used: 0, finger: finger || 0, ver: 0 }; }
function tblProbe(h, mask) {
  if (typeof h === 'number') return { i: h % (mask + 1), p: h, big: false };
  const p = BigInt.asUintN(64, h);
  return { i: Number(p & BigInt(mask)), p, big: true };
}
function tblAdvance(st, mask) {
  if (st.big) { st.p >>= 5n; st.i = Number((BigInt(st.i) * 5n + 1n + st.p) & BigInt(mask)); }
  else { st.p = Math.floor(st.p / 32); st.i = (st.i * 5 + 1 + st.p) % (mask + 1); }
}
function tblSameKey(e, v, h) { return e.h === h && setKeyEq(e.v, v); }
function tblLookup(T, v, h) {
  const mask = T.mask;
  const st = tblProbe(h, mask);
  for (;;) {
    let i = st.i;
    const probes = (i + SET_LP <= mask) ? SET_LP : 0;
    for (let j = 0; j <= probes; j++, i++) {
      const e = T.t[i];
      if (e === null) return -1;
      if (e !== SET_DUMMY && tblSameKey(e, v, h)) return i;
    }
    tblAdvance(st, mask);
  }
}
function tblInsertClean(t, mask, e) {
  const st = tblProbe(e.h, mask);
  for (;;) {
    let i = st.i;
    if (t[i] === null) { t[i] = e; return; }
    if (i + SET_LP <= mask) {
      for (let j = 0; j < SET_LP; j++) { i++; if (t[i] === null) { t[i] = e; return; } }
    }
    tblAdvance(st, mask);
  }
}
function tblResize(T, minused) {
  let ns = 8;
  while (ns <= minused) ns *= 2;
  if (ns === 8 && T.mask === 7 && T.fill === T.used) return;
  const old = T.t;
  T.t = new Array(ns).fill(null);
  T.mask = ns - 1;
  for (const e of old) if (e !== null && e !== SET_DUMMY) tblInsertClean(T.t, T.mask, e);
  T.fill = T.used;
  T.ver++;
}
function tblAdd(T, v, h) {
  const mask = T.mask;
  const st = tblProbe(h, mask);
  let free = -1;
  for (;;) {
    let i = st.i;
    const probes = (i + SET_LP <= mask) ? SET_LP : 0;
    for (let j = 0; j <= probes; j++, i++) {
      const e = T.t[i];
      if (e === null) {
        T.ver++;
        if (free >= 0) { T.t[free] = { v, h }; T.used++; return; }
        T.t[i] = { v, h }; T.fill++; T.used++;
        if (T.fill * 5 < mask * 3) return;
        tblResize(T, T.used > 50000 ? T.used * 2 : T.used * 4);
        return;
      }
      if (e === SET_DUMMY) free = i;  // CPython keeps the last dummy slot it passed
      else if (tblSameKey(e, v, h)) return;
    }
    tblAdvance(st, mask);
  }
}
function tblDiscard(T, v, h) {
  const i = tblLookup(T, v, h);
  if (i < 0) return false;
  T.t[i] = SET_DUMMY;
  T.used--;
  T.ver++;
  return true;
}
function tblMerge(T, O) {
  if (T === O || O.used === 0) return;
  if ((T.fill + O.used) * 5 >= T.mask * 3) tblResize(T, (T.used + O.used) * 2);
  T.ver++;
  if (T.fill === 0 && T.mask === O.mask && O.fill === O.used) {
    T.t = O.t.slice(); T.fill = O.fill; T.used = O.used;
    return;
  }
  if (T.fill === 0) {
    T.fill = O.used; T.used = O.used;
    for (const e of O.t) if (e !== null && e !== SET_DUMMY) tblInsertClean(T.t, T.mask, e);
    return;
  }
  for (const e of O.t) if (e !== null && e !== SET_DUMMY) tblAdd(T, e.v, e.h);
}

function setAdd(s, v) {
  const k = hashKey(v);
  if (s.m.has(k)) return;
  s.m.set(k, v);
  s.order = null;
  if (s.tbl === false) return;
  if (!setEmuKey(v)) { s.tbl = false; return; }
  if (!s.tbl) s.tbl = tblNew();
  tblAdd(s.tbl, v, setHashOf(v));
}
function setHas(s, v) { return s.m.has(hashKey(v)); }
function setDel(s, v) {
  const k = hashKey(v);
  const cur = s.m.get(k);
  if (cur === undefined && !s.m.has(k)) return false;
  s.m.delete(k);
  s.order = null;
  if (s.tbl) tblDiscard(s.tbl, cur, setHashOf(cur));
  return true;
}
function setClear(s) {
  s.m.clear();
  s.order = null;
  s.tbl = s.tbl ? tblNew(s.tbl.finger) : null;
}
// set_merge(s, o): the fast path CPython uses when copying/merging one set into another
function setMergeInto(s, o) {
  if (s === o || !o.m.size) return;
  const items = setOrder(o);
  for (const v of items) { const k = hashKey(v); if (!s.m.has(k)) s.m.set(k, v); }
  s.order = null;
  if (s.tbl === false) return;
  if (o.tbl) { if (!s.tbl) s.tbl = tblNew(); tblMerge(s.tbl, o.tbl); }
  else s.tbl = false;
}
// set_update_internal(s, iterable)
function setUpdateFrom(vm, s, other) {
  if (other instanceof PySet) { setMergeInto(s, other); return; }
  if (other instanceof PyDict && !other.kind) {
    const keys = [...other.m.values()].map((e) => e[0]);
    if (s.tbl !== false && keys.every(setEmuKey) && keys.length) {
      if (!s.tbl) s.tbl = tblNew();
      const T = s.tbl;
      if ((T.fill + keys.length) * 5 >= T.mask * 3) tblResize(T, (T.used + keys.length) * 2);
    }
    for (const k of keys) setAdd(s, k);
    return;
  }
  for (const v of vm.toArray(other)) setAdd(s, v);
}
function setCopy(s) { const n = new PySet(s.frozen); setMergeInto(n, s); return n; }
function setIntersection(vm, a, b) {
  if (a === b) return setCopy(a);
  const r = new PySet(a.frozen);
  if (b instanceof PySet) {
    let big1 = a, small = b;
    if (b.m.size > a.m.size) { big1 = b; small = a; }
    for (const v of setOrder(small)) if (setHas(big1, v)) setAdd(r, v);
    return r;
  }
  for (const v of vm.toArray(b)) if (setHas(a, v)) setAdd(r, v);
  return r;
}
function setDifferenceUpdate(vm, s, other) {
  if (s === other) { setClear(s); return; }
  if (other instanceof PySet) {
    let o = other;
    if ((o.m.size >> 3) > s.m.size) o = setIntersection(vm, s, o);
    for (const v of setOrder(o).slice()) setDel(s, v);
  } else {
    for (const v of vm.toArray(other)) setDel(s, v);
  }
  const T = s.tbl;
  if (T && (T.fill - T.used) > Math.floor(T.mask / 4)) tblResize(T, T.used > 50000 ? T.used * 2 : T.used * 4);
}
function setDifference(vm, a, b) {
  let osize = -1;
  if (b instanceof PySet) osize = b.m.size;
  else if (b instanceof PyDict) osize = b.m.size;
  if (osize < 0 || (a.m.size >> 2) > osize) { const r = setCopy(a); setDifferenceUpdate(vm, r, b); return r; }
  const r = new PySet(a.frozen);
  for (const v of setOrder(a)) {
    const inB = b instanceof PySet ? setHas(b, v) : dictHas(b, v);
    if (!inB) setAdd(r, v);
  }
  return r;
}
function setSymDiffUpdate(vm, s, other) {
  if (s === other) { setClear(s); return; }
  let o = other;
  if (other instanceof PyDict) { for (const e of [...other.m.values()]) { if (!setDel(s, e[0])) setAdd(s, e[0]); } return; }
  if (!(o instanceof PySet)) { o = new PySet(); setUpdateFrom(vm, o, other); }
  for (const v of setOrder(o).slice()) { if (!setDel(s, v)) setAdd(s, v); }
}
function setSymDiff(vm, a, b) {
  const r = new PySet(a.frozen);
  setUpdateFrom(vm, r, b);
  setSymDiffUpdate(vm, r, a);
  return r;
}
function setUnion(vm, a, b) {
  const r = setCopy(a);
  if (a !== b) setUpdateFrom(vm, r, b);
  return r;
}
function setPop(s) {
  const T = s.tbl;
  if (T) {
    let i = T.finger & T.mask;
    while (T.t[i] === null || T.t[i] === SET_DUMMY) { i++; if (i > T.mask) i = 0; }
    const v = T.t[i].v;
    T.t[i] = SET_DUMMY; T.used--; T.finger = i + 1; T.ver++;
    s.m.delete(hashKey(v)); s.order = null;
    return v;
  }
  const v = setOrder(s)[0];
  setDel(s, v);
  return v;
}
// {1, 2, 3}: with more than 2 constant items CPython builds a frozenset constant at compile time
// and merges it into a new empty set, which can give a different layout than adding one by one.
function setFromConstDisplay(items) {
  // the compiler builds a frozenset from the items, then (constant merging) rebuilds it from that
  // frozenset's own iteration order, then BUILD_SET + SET_UPDATE merges it into a new set
  const f1 = new PySet(true);
  for (const v of items) setAdd(f1, v);
  const f2 = new PySet(true);
  for (const v of setOrder(f1)) setAdd(f2, v);
  const s = new PySet();
  setMergeInto(s, f2);
  return s;
}
function setOrder(s) {
  if (s.tbl) {
    if (s.order && s.order.ver === s.tbl.ver && s.order.size === s.m.size) return s.order.items;
    const items = [];
    for (const e of s.tbl.t) if (e !== null && e !== SET_DUMMY) items.push(e.v);
    s.order = { size: s.m.size, ver: s.tbl.ver, items };
    return items;
  }
  if (s.order && s.order.size === s.m.size && s.order.ver === -1) return s.order.items;
  const items = [...s.m.values()];
  s.order = { size: s.m.size, ver: -1, items };
  return items;
}

function dictViewItems(v) {
  const entries = [...v.d.m.values()];
  if (v.kind === 'keys') return entries.map((e) => e[0]);
  if (v.kind === 'values') return entries.map((e) => e[1]);
  return entries.map((e) => new PyTuple([e[0], e[1]]));
}

// ---------- truthiness ----------
function truthy(v) {
  if (v === true) return true;
  if (v === false || v === NONE) return false;
  switch (typeof v) {
    case 'number': return v !== 0;
    case 'bigint': return v !== 0n;
    case 'string': return v.length > 0;
  }
  if (v instanceof PyFloat) return v.v !== 0 && !Number.isNaN(v.v) ? true : Number.isNaN(v.v);
  if (v instanceof PyList || v instanceof PyTuple || v instanceof PyDeque) return v.a.length > 0;
  if (v instanceof PyDict || v instanceof PySet) return v.m.size > 0;
  if (v instanceof PyRange) return v.length > 0;
  if (v instanceof PyDictView) return v.d.m.size > 0;
  if (v instanceof PyInstance && VM) {
    const b = VM.findMethod(v, '__bool__');
    if (b) { const r = VM.callValue(b, [v], null); if (typeof r !== 'boolean') throw pyErr('TypeError', `__bool__ should return bool, returned ${typeName(r)}`); return r; }
    const l = VM.findMethod(v, '__len__');
    if (l) return truthy(VM.callValue(l, [v], null));
  }
  return true;
}

// ---------- equality and ordering ----------
function seqEq(x, y) {
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i] && !pyEq(x[i], y[i])) return false;
  return true;
}
function pyEq(a, b) {
  if (a === b) return !(a instanceof PyFloat && Number.isNaN(a.v));
  const an = isNumV(a), bn = isNumV(b);
  if (an && bn) {
    if (a instanceof PyFloat || b instanceof PyFloat) return fval(a) === fval(b);
    return icmp(asInt(a), asInt(b)) === 0;
  }
  if (typeof a === 'string' || typeof b === 'string') return false;
  if (a instanceof PyInstance || b instanceof PyInstance) {
    if (a instanceof PyInstance) {
      const m = VM.findMethod(a, '__eq__');
      if (m) { const r = VM.callValue(m, [a, b], null); if (r !== NOT_IMPL) return truthy(r); }
    }
    if (b instanceof PyInstance) {
      const m = VM.findMethod(b, '__eq__');
      if (m) { const r = VM.callValue(m, [b, a], null); if (r !== NOT_IMPL) return truthy(r); }
    }
    return false;
  }
  if (a instanceof PyList && b instanceof PyList) return seqEq(a.a, b.a);
  if (a instanceof PyTuple && b instanceof PyTuple) return seqEq(a.a, b.a);
  if (a instanceof PyDeque && b instanceof PyDeque) return seqEq(a.a, b.a);
  if (a instanceof PyDict && b instanceof PyDict) {
    if (a.m.size !== b.m.size) return false;
    for (const [h, e] of a.m) { const o = b.m.get(h); if (!o || !pyEq(e[1], o[1])) return false; }
    return true;
  }
  if (a instanceof PySet && b instanceof PySet) {
    if (a.m.size !== b.m.size) return false;
    for (const h of a.m.keys()) if (!b.m.has(h)) return false;
    return true;
  }
  if (a instanceof PyRange && b instanceof PyRange) {
    const la = a.length, lb = b.length;
    if (la !== lb) return false;
    if (la === 0) return true;
    if (a.start !== b.start) return false;
    return la === 1 || a.step === b.step;
  }
  if (a instanceof PyDictView && b instanceof PyDictView && a.kind === b.kind && a.kind !== 'values') {
    const x = dictViewItems(a), y = dictViewItems(b);
    if (x.length !== y.length) return false;
    const s = new Set(y.map(hashKey));
    return x.every((k) => s.has(hashKey(k)));
  }
  return false;
}

function cmpErr(op, a, b) {
  return pyErr('TypeError', `'${op}' not supported between instances of '${shortTypeName(a)}' and '${shortTypeName(b)}'`);
}
const REFLECT = { '<': '>', '>': '<', '<=': '>=', '>=': '<=' };
const DUNDER = { '<': '__lt__', '>': '__gt__', '<=': '__le__', '>=': '__ge__' };
function pyCmp(op, a, b) {
  // ordering comparisons; returns bool
  if (isNumV(a) && isNumV(b)) {
    let c;
    if (a instanceof PyFloat || b instanceof PyFloat) {
      const x = fval(a), y = fval(b);
      switch (op) { case '<': return x < y; case '>': return x > y; case '<=': return x <= y; case '>=': return x >= y; }
    }
    c = icmp(asInt(a), asInt(b));
    switch (op) { case '<': return c < 0; case '>': return c > 0; case '<=': return c <= 0; case '>=': return c >= 0; }
  }
  if (typeof a === 'string' && typeof b === 'string') {
    switch (op) { case '<': return a < b; case '>': return a > b; case '<=': return a <= b; case '>=': return a >= b; }
  }
  if ((a instanceof PyList && b instanceof PyList) || (a instanceof PyTuple && b instanceof PyTuple) || (a instanceof PyDeque && b instanceof PyDeque)) {
    const x = a.a, y = b.a;
    const n = Math.min(x.length, y.length);
    for (let i = 0; i < n; i++) {
      if (!pyEq(x[i], y[i])) {
        if (op === '<' || op === '<=') return pyCmp('<', x[i], y[i]);
        return pyCmp('>', x[i], y[i]);
      }
    }
    switch (op) { case '<': return x.length < y.length; case '>': return x.length > y.length; case '<=': return x.length <= y.length; case '>=': return x.length >= y.length; }
  }
  if (a instanceof PySet && b instanceof PySet) {
    const sub = (p, q) => { for (const h of p.m.keys()) if (!q.m.has(h)) return false; return true; };
    switch (op) {
      case '<=': return sub(a, b);
      case '<': return a.m.size < b.m.size && sub(a, b);
      case '>=': return sub(b, a);
      case '>': return b.m.size < a.m.size && sub(b, a);
    }
  }
  if (a instanceof PyInstance) {
    const m = VM.findMethod(a, DUNDER[op]);
    if (m) { const r = VM.callValue(m, [a, b], null); if (r !== NOT_IMPL) return truthy(r); }
  }
  if (b instanceof PyInstance) {
    const m = VM.findMethod(b, DUNDER[REFLECT[op]]);
    if (m) { const r = VM.callValue(m, [b, a], null); if (r !== NOT_IMPL) return truthy(r); }
  }
  throw cmpErr(op, a, b);
}
function pyLt(a, b) { return pyCmp('<', a, b); }

// ---------- formatting (format-spec mini-language) ----------
function groupDigits(intPart, sep) {
  let out = '';
  let cnt = 0;
  for (let i = intPart.length - 1; i >= 0; i--) {
    out = intPart[i] + out;
    cnt++;
    if (cnt % 3 === 0 && i > 0) out = sep + out;
  }
  return out;
}
function decomposeDouble(x) {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0), lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let M = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let E;
  if (expBits === 0) E = -1074;
  else { M |= 1n << 52n; E = expBits - 1075; }
  return { neg: (hi >>> 31) === 1, M, E };
}
// Exact decimal rounding (round-half-even on the exact binary value), like CPython's float formatting.
function toFixedExact(x, p) {
  if (x === 0) return (Object.is(x, -0) ? '-' : '') + (p > 0 ? '0.' + '0'.repeat(p) : '0');
  const { neg, M, E } = decomposeDouble(x);
  const P = 10n ** BigInt(p);
  let N;
  if (E >= 0) N = (M << BigInt(E)) * P;
  else {
    const num = M * P, den = 1n << BigInt(-E);
    let q = num / den;
    const twice = (num % den) * 2n;
    if (twice > den || (twice === den && (q & 1n) === 1n)) q += 1n;
    N = q;
  }
  let str = N.toString();
  if (p > 0) {
    str = str.padStart(p + 1, '0');
    str = str.slice(0, str.length - p) + '.' + str.slice(str.length - p);
  }
  return (neg ? '-' : '') + str;
}
function toFixedPy(x, p) {
  if (!Number.isFinite(x)) return floatRepr(x);
  return toFixedExact(x, Math.min(p, 120));
}
function roundHalfEvenFixed(x, p) { return toFixedExact(x, p); }
function expFormat(x, p, upper) {
  let s = x.toExponential(p);
  const m = /^(-?[\d.]+)e([+-])(\d+)$/.exec(s);
  if (m) s = m[1] + 'e' + m[2] + m[3].padStart(2, '0');
  return upper ? s.toUpperCase() : s;
}
function gFormat(x, p, alt, upper) {
  if (p === 0) p = 1;
  if (x === 0) return alt ? '0.' + '0'.repeat(p - 1) : '0';
  if (!Number.isFinite(x)) return floatRepr(x);
  const e = Number(x.toExponential(p - 1).split('e')[1]);
  let s;
  if (e >= -4 && e < p) {
    s = toFixedPy(x, Math.max(0, p - 1 - e));
    if (!alt && s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
  } else {
    s = expFormat(x, p - 1, false);
    if (!alt) s = s.replace(/\.?0+e/, 'e');
  }
  return upper ? s.toUpperCase() : s;
}
function formatSpec(v, spec) {
  if (v instanceof PyInstance) {
    const m = VM.findMethod(v, '__format__');
    if (m) return asStrResult(VM.callValue(m, [v, spec], null), '__format__');
    if (spec) throw pyErr('TypeError', `unsupported format string passed to ${v.cls.name}.__format__`);
    return pyStr(v);
  }
  if (!spec) return pyStr(v);
  const m = /^(?:([\s\S])?([<>=^]))?([+\- ])?(z)?(#)?(0)?(\d+)?([,_])?(?:\.(\d+))?([bcdeEfFgGnosxX%])?$/.exec(spec);
  if (!m) throw pyErr('ValueError', `Invalid format specifier '${spec}' for object of type '${typeName(v)}'`);
  let [, fill, align, sign, , alt, zero, width, group, prec, type] = m;
  width = width ? parseInt(width, 10) : 0;
  const precN = prec !== undefined ? parseInt(prec, 10) : null;
  let body, isNum = false, neg = false;
  if (typeof v === 'string') {
    if (type && type !== 's') throw pyErr('ValueError', `Unknown format code '${type}' for object of type 'str'`);
    if (sign) throw pyErr('ValueError', 'Sign not allowed in string format specifier');
    body = precN !== null ? Array.from(v).slice(0, precN).join('') : v;
  } else if (isIntV(v) && !(type && 'eEfFgG%'.indexOf(type) >= 0)) {
    isNum = true;
    let n = asInt(v);
    if (type === 'c') { body = String.fromCodePoint(Number(n)); isNum = false; }
    else {
      if (precN !== null) throw pyErr('ValueError', 'Precision not allowed in integer format specifier');
      neg = icmp(n, 0) < 0;
      const absn = neg ? (typeof n === 'bigint' ? -n : -n) : n;
      const base = type === 'x' || type === 'X' ? 16 : type === 'o' ? 8 : type === 'b' ? 2 : 10;
      if (type && 'dnxXobs'.indexOf(type) < 0) throw pyErr('ValueError', `Unknown format code '${type}' for object of type 'int'`);
      body = big(absn).toString(base);
      if (type === 'X') body = body.toUpperCase();
      if (group) body = base === 10 ? groupDigits(body, group) : body.replace(/\B(?=([0-9a-fA-F]{4})+$)/g, group);
      if (alt && base !== 10) body = (type === 'x' ? '0x' : type === 'X' ? '0X' : type === 'o' ? '0o' : '0b') + body;
    }
  } else if (isNumV(v)) {
    isNum = true;
    const x = fval(v);
    neg = x < 0 || Object.is(x, -0);
    const ax = Math.abs(x);
    const t = type || '';
    const p = precN === null ? 6 : precN;
    if (t === 'f' || t === 'F') body = toFixedPy(ax, p);
    else if (t === 'e' || t === 'E') body = expFormat(ax, p, t === 'E');
    else if (t === '%') body = toFixedPy(ax * 100, p) + '%';
    else if (t === 'g' || t === 'G') body = gFormat(ax, p, !!alt, t === 'G');
    else if (t === 'd' || t === 'n' && false) throw pyErr('ValueError', `Unknown format code 'd' for object of type 'float'`);
    else if (t === '') body = precN === null ? floatRepr(ax) : gFormat(ax, precN, !!alt, false).replace(/^([^.e]+)$/, '$1');
    else throw pyErr('ValueError', `Unknown format code '${t}' for object of type 'float'`);
    if (t === '' && precN !== null && body.indexOf('.') < 0 && body.indexOf('e') < 0 && body !== 'inf' && body !== 'nan') { /* python keeps as is */ }
    if (group) {
      const [ip, ...rest] = body.split('.');
      body = groupDigits(ip, group) + (rest.length ? '.' + rest.join('.') : '');
    }
  } else {
    if (spec) throw pyErr('TypeError', `unsupported format string passed to ${typeName(v)}.__format__`);
    body = pyStr(v);
  }
  let signStr = '';
  if (isNum) {
    if (neg) signStr = '-';
    else if (sign === '+') signStr = '+';
    else if (sign === ' ') signStr = ' ';
  }
  if (zero && !align) { fill = '0'; align = '='; }
  if (!align) align = isNum ? '>' : '<';
  if (fill === undefined) fill = ' ';
  const total = signStr.length + Array.from(body).length;
  if (width <= total) return signStr + body;
  const pad = width - total;
  switch (align) {
    case '<': return signStr + body + fill.repeat(pad);
    case '>': return fill.repeat(pad) + signStr + body;
    case '=': return signStr + fill.repeat(pad) + body;
    case '^': { const l = Math.floor(pad / 2); return fill.repeat(l) + signStr + body + fill.repeat(pad - l); }
  }
  return signStr + body;
}

function pyRound(x, nd) {
  // x: JS number (float), nd: integer or null
  if (nd === null) {
    if (!Number.isFinite(x)) throw pyErr(Number.isNaN(x) ? 'ValueError' : 'OverflowError', Number.isNaN(x) ? 'cannot convert float NaN to integer' : 'cannot convert float infinity to integer');
    const fl = Math.floor(x), diff = x - fl;
    let r;
    if (diff > 0.5) r = fl + 1;
    else if (diff < 0.5) r = fl;
    else r = fl % 2 === 0 ? fl : fl + 1;
    return Math.abs(r) <= MAXS ? (r === 0 ? 0 : r) : normInt(BigInt(r));
  }
  if (!Number.isFinite(x)) return F(x);
  if (nd >= 0) {
    if (nd > 15) return F(x);
    return F(parseFloat(roundHalfEvenFixed(x, nd)));
  }
  const p = Math.pow(10, -nd);
  const q = x / p;
  const fl = Math.floor(q), diff = q - fl;
  let r = diff > 0.5 ? fl + 1 : diff < 0.5 ? fl : (fl % 2 === 0 ? fl : fl + 1);
  return F(r * p);
}

// %-formatting (old style), minimal
function percentFormat(fmt, args) {
  const vals = args instanceof PyTuple ? args.a.slice() : [args];
  let i = 0;
  const out = fmt.replace(/%(\((\w+)\))?([-+ 0#]*)(\d+|\*)?(?:\.(\d+))?([sdifrxXeEgGc%])/g, (m, _k, key, flags, width, prec, type) => {
    if (type === '%') return '%';
    let v;
    if (key) { if (!(args instanceof PyDict)) throw pyErr('TypeError', 'format requires a mapping'); v = dictGet(args, key); }
    else { if (i >= vals.length) throw pyErr('TypeError', 'not enough arguments for format string'); v = vals[i++]; }
    let spec = '';
    if (flags.indexOf('-') >= 0) spec += '<';
    else if (flags.indexOf('0') >= 0 && type !== 's' && type !== 'r') spec += '0';
    if (flags.indexOf('+') >= 0) spec = (spec.startsWith('<') ? '<+' : '+' + spec);
    if (width) spec += width;
    if (prec !== undefined) spec += '.' + prec;
    if (type === 's' || type === 'r') {
      const sv = type === 's' ? pyStr(v) : repr(v);
      let sp = spec.replace(/^0/, '');
      if (!sp.startsWith('<')) sp = '>' + sp.replace(/^\+/, '');
      return formatSpec(sv, sp);
    }
    if (type === 'd' || type === 'i') {
      if (!isNumV(v)) throw pyErr('TypeError', `%${type} format: a real number is required, not ${typeName(v)}`);
      const n = v instanceof PyFloat ? Math.trunc(v.v) : asInt(v);
      return formatSpec(n, spec + 'd');
    }
    if ('feEgG'.indexOf(type) >= 0) {
      if (!isNumV(v)) throw pyErr('TypeError', `must be real number, not ${typeName(v)}`);
      return formatSpec(F(fval(v)), spec + type);
    }
    if (type === 'x' || type === 'X') return formatSpec(asInt(v), spec + type);
    if (type === 'c') return typeof v === 'string' ? v : String.fromCodePoint(Number(v));
    return m;
  });
  if (i < vals.length && !(args instanceof PyDict)) throw pyErr('TypeError', 'not all arguments converted during string formatting');
  return out;
}
