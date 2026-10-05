// ===== PyRun interpreter: tree-walking evaluator =====

class PyThrow extends Error {
  constructor(exc, tb) { super('PyThrow'); this.exc = exc; this.tb = tb; }
}
// the innermost expression node that failed in frame f (CPython shows it with ^^^ markers)
function markLoc(err, f, node) {
  const tb = err.tb;
  if (!tb) return;
  for (let k = tb.length - 1; k >= 0; k--) {
    if (tb[k].fr === f) { if (!tb[k].loc) tb[k].loc = node; return; }
  }
}
class StepLimit extends Error { constructor() { super('StepLimit'); } }

let VM = null;

function pyErr(name, msg) {
  return pyErrArgs(name, msg === undefined ? [] : [msg]);
}
function pyErrArgs(name, args) {
  const cls = EXC[name] || EXC.Exception;
  const inst = new PyInstance(cls);
  inst.excArgs = args;
  return new PyThrow(inst, VM ? VM.snapshot() : []);
}
function isInstanceOfName(exc, name) { return exc instanceof PyInstance && exc.cls.mro.some((c) => c.name === name && c.builtin); }

class Frame {
  constructor(kind, scope, parent, name) {
    this.kind = kind; this.scope = scope; this.parent = parent; this.name = name;
    this.locals = new Map(); this.line = 0; this.fn = null; this.src = null;
  }
}

const BRK = { sig: 'break' }, CNT = { sig: 'continue' };
class Ret { constructor(v) { this.v = v; } }
const EMPTY_KW = new Map();
const BIN_DUNDER = { '+': '__add__', '-': '__sub__', '*': '__mul__', '/': '__truediv__', '//': '__floordiv__', '%': '__mod__', '**': '__pow__', '<<': '__lshift__', '>>': '__rshift__', '&': '__and__', '|': '__or__', '^': '__xor__', '@': '__matmul__' };
const RBIN_DUNDER = { '+': '__radd__', '-': '__rsub__', '*': '__rmul__', '/': '__rtruediv__', '//': '__rfloordiv__', '%': '__rmod__', '**': '__rpow__', '<<': '__rlshift__', '>>': '__rrshift__', '&': '__rand__', '|': '__ror__', '^': '__rxor__', '@': '__rmatmul__' };

function isZero(v) { return v === 0 || v === 0n || v === false; }

function numBinop(op, a0, b0) {
  const isF = a0 instanceof PyFloat || b0 instanceof PyFloat;
  if (!isF) {
    const bothBool = typeof a0 === 'boolean' && typeof b0 === 'boolean';
    const a = asInt(a0), b = asInt(b0);
    switch (op) {
      case '+': return iadd(a, b);
      case '-': return isub(a, b);
      case '*': return imul(a, b);
      case '/':
        if (isZero(b)) throw pyErr('ZeroDivisionError', 'division by zero');
        return F(typeof a === 'number' && typeof b === 'number' ? a / b : Number(big(a)) / Number(big(b)));
      case '//':
        if (isZero(b)) throw pyErr('ZeroDivisionError', 'integer division or modulo by zero');
        return ifloordiv(a, b);
      case '%':
        if (isZero(b)) throw pyErr('ZeroDivisionError', 'integer modulo by zero');
        return imod(a, b);
      case '**':
        if (icmp(b, 0) < 0) {
          if (isZero(a)) throw pyErr('ZeroDivisionError', '0.0 cannot be raised to a negative power');
          return F(Math.pow(Number(a), Number(b)));
        }
        return ipow(a, b);
      case '<<':
        if (icmp(b, 0) < 0) throw pyErr('ValueError', 'negative shift count');
        if (icmp(b, 100000) > 0) throw pyErr('OverflowError', 'result too large for this runner');
        return normInt(big(a) << big(b));
      case '>>':
        if (icmp(b, 0) < 0) throw pyErr('ValueError', 'negative shift count');
        return normInt(big(a) >> big(b));
      case '&': { const r = normInt(big(a) & big(b)); return bothBool ? r !== 0 : r; }
      case '|': { const r = normInt(big(a) | big(b)); return bothBool ? r !== 0 : r; }
      case '^': { const r = normInt(big(a) ^ big(b)); return bothBool ? r !== 0 : r; }
    }
  } else {
    const x = fval(a0), y = fval(b0);
    switch (op) {
      case '+': return F(x + y);
      case '-': return F(x - y);
      case '*': return F(x * y);
      case '/':
        if (y === 0) throw pyErr('ZeroDivisionError', 'float division by zero');
        return F(x / y);
      case '//':
        if (y === 0) throw pyErr('ZeroDivisionError', 'float floor division by zero');
        return F(Math.floor(x / y));
      case '%': {
        if (y === 0) throw pyErr('ZeroDivisionError', 'float modulo by zero');
        let r = x % y;
        if (r !== 0 && ((r < 0) !== (y < 0))) r += y;
        return F(r);
      }
      case '**':
        if (x === 0 && y < 0) throw pyErr('ZeroDivisionError', '0.0 cannot be raised to a negative power');
        if (x < 0 && !Number.isInteger(y)) throw pyErr('ValueError', 'math domain error');
        return F(Math.pow(x, y));
    }
  }
  throw pyErr('TypeError', `unsupported operand type(s) for ${op}: '${shortTypeName(a0)}' and '${shortTypeName(b0)}'`);
}

function sliceIndices(sl, len) {
  const toI = (v) => {
    if (isIntV(v)) return Number(asInt(v));
    if (v instanceof PyInstance && VM.findMethod(v, '__index__')) return Number(VM.callValue(VM.findMethod(v, '__index__'), [v], null));
    throw pyErr('TypeError', 'slice indices must be integers or None or have an __index__ method');
  };
  let step = sl.step === NONE ? 1 : toI(sl.step);
  if (step === 0) throw pyErr('ValueError', 'slice step cannot be zero');
  const adj = (i, lo, hi) => {
    if (i < 0) { i += len; if (i < 0) i = lo; }
    else if (i > hi) i = hi;
    return i;
  };
  let start, stop;
  if (step > 0) {
    start = sl.start === NONE ? 0 : adj(toI(sl.start), 0, len);
    stop = sl.stop === NONE ? len : adj(toI(sl.stop), 0, len);
  } else {
    start = sl.start === NONE ? len - 1 : adj(toI(sl.start), -1, len - 1);
    stop = sl.stop === NONE ? -1 : adj(toI(sl.stop), -1, len - 1);
  }
  return [start, stop, step];
}
function sliceArr(arr, sl) {
  const [start, stop, step] = sliceIndices(sl, arr.length);
  if (step === 1) return start < stop ? arr.slice(start, stop) : [];
  const out = [];
  if (step > 0) for (let i = start; i < stop; i += step) out.push(arr[i]);
  else for (let i = start; i > stop; i += step) out.push(arr[i]);
  return out;
}
function strChars(s) {
  // fast path for strings without surrogate pairs
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c >= 0xd800 && c <= 0xdfff) return Array.from(s); }
  return s.split('');
}
function strLen(s) {
  let n = s.length;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c >= 0xd800 && c <= 0xdbff) n--; }
  return n;
}
function pushAll(dst, src) { for (let i = 0; i < src.length; i++) dst.push(src[i]); }

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 3) return 99;
  const d = [];
  for (let i = 0; i <= m; i++) { d.push([i]); }
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const sub = a[i - 1] === b[j - 1] ? 0 : (a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0.5 : 1);
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + sub);
    }
  }
  return d[m][n];
}
function suggestName(name, candidates) {
  let best = null, bestD = 99;
  const maxD = Math.max(1, Math.floor((name.length + 2) / 4));
  for (const c of candidates) {
    if (c === name || c.startsWith('__')) continue;
    const dd = levenshtein(name, c);
    if (dd <= maxD && dd < bestD) { best = c; bestD = dd; }
  }
  return best;
}

class Interp {
  constructor(opts) {
    opts = opts || {};
    this.globals = new Map();
    this.globals.set('__name__', '__main__');
    this.module = new Frame('module', null, null, '<module>');
    this.module.locals = this.globals;
    this.out = [];
    this.outLen = 0;
    this.maxOut = opts.maxOut || 200000;
    this.truncated = false;
    this.steps = 0;
    this.limit = opts.stepLimit || 5000000;
    this.depth = 0;
    this.maxDepth = opts.maxDepth || 1000;
    this.callStack = [this.module];
    this.handling = [];
    this.modules = new Map();
    this.filename = opts.filename || 'main.py';
    this.sources = new Map();
    this.onLine = null;
  }

  // ---------- output ----------
  write(s) {
    if (this.truncated) return;
    if (this.outLen + s.length > this.maxOut) {
      this.out.push(s.slice(0, Math.max(0, this.maxOut - this.outLen)));
      this.out.push('\n... (output cut off: too much printing)\n');
      this.truncated = true;
      this.outLen = this.maxOut;
      return;
    }
    this.out.push(s);
    this.outLen += s.length;
  }
  takeOut() { const s = this.out.join(''); this.out = []; this.outLen = 0; this.truncated = false; return s; }

  tick(n) { this.steps += n; if (this.steps > this.limit) throw new StepLimit(); }
  snapshot() { return this.callStack.map((f) => ({ name: f.name, line: f.line, src: f.src, fr: f, stmt: f.stmt })); }
  currentLine() { const f = this.callStack[this.callStack.length - 1]; return f ? f.line : 0; }

  // ---------- names ----------
  loadName(f, name) {
    if (f.kind === 'function') {
      const sc = f.scope;
      if (sc.locals.has(name)) {
        const v = f.locals.get(name);
        if (v !== undefined) return v;
        throw pyErr('UnboundLocalError', `cannot access local variable '${name}' where it is not associated with a value`);
      }
      if (!sc.globals.has(name)) {
        let p = f.parent;
        while (p && p.kind !== 'module') {
          if (p.kind === 'function' && (p.scope.locals.has(name) || p.locals.has(name))) {
            const v = p.locals.get(name);
            if (v !== undefined) return v;
            throw pyErr('NameError', `cannot access free variable '${name}' where it is not associated with a value in enclosing scope`);
          }
          p = p.parent;
        }
      }
    } else if (f.kind === 'class') {
      const v = f.locals.get(name);
      if (v !== undefined) return v;
      let p = f.parent;
      while (p && p.kind !== 'module') {
        if (p.kind === 'function' && p.locals.has(name)) return p.locals.get(name);
        p = p.parent;
      }
    }
    const g = this.globals.get(name);
    if (g !== undefined) return g;
    const b = BUILTINS.get(name);
    if (b !== undefined) return b;
    const t = pyErr('NameError', `name '${name}' is not defined`);
    t.exc.suggestion = this.nameSuggestion(f, name);
    throw t;
  }

  nameSuggestion(f, name) {
    let sug = null;
    const selfObj = f.kind === 'function' ? f.locals.get('self') : undefined;
    if (selfObj instanceof PyInstance && (selfObj.dict.has(name) || this.lookupClass(selfObj.cls, name) !== undefined)) sug = 'self.' + name;
    else {
      const d = [];
      if (f.kind !== 'module') for (const k of f.locals.keys()) d.push(k);
      for (const k of this.globals.keys()) d.push(k);
      for (const k of PY_BUILTIN_NAMES) d.push(k);
      sug = calcSuggestion(d, name);
    }
    let out = sug ? `. Did you mean: '${sug}'?` : '';
    if (PY_STDLIB_MODULES.has(name)) out += sug ? ` Or did you forget to import '${name}'?` : `. Did you forget to import '${name}'?`;
    return out;
  }

  attrSuggestion(obj, name) {
    let d = [];
    if (obj instanceof PyInstance) {
      for (const k of obj.dict.keys()) d.push(k);
      for (const c of obj.cls.mro) if (c.dict) for (const k of c.dict.keys()) d.push(k);
      d = d.concat(PY_INSTANCE_DUNDERS);
    } else if (obj instanceof PyClass) {
      for (const c of obj.mro) if (c.dict) for (const k of c.dict.keys()) d.push(k);
    } else if (obj instanceof PyModule) {
      for (const k of obj.dict.keys()) d.push(k);
    } else {
      let key = null;
      if (typeof obj === 'string') key = 'str';
      else if (typeof obj === 'boolean') key = 'bool';
      else if (typeof obj === 'number' || typeof obj === 'bigint') key = 'int';
      else if (obj instanceof PyFloat) key = 'float';
      else if (obj instanceof PyList) key = 'list';
      else if (obj instanceof PyTuple) key = 'tuple';
      else if (obj instanceof PyDict) key = obj.kind || 'dict';
      else if (obj instanceof PySet) key = obj.frozen ? 'frozenset' : 'set';
      else if (obj instanceof PyRange) key = 'range';
      else if (obj instanceof PyDeque) key = 'deque';
      else if (obj === NONE) key = 'NoneType';
      d = (key && PY_TYPE_DIRS[key]) || [];
    }
    d = [...new Set(d.filter((x) => typeof x === 'string'))].sort();
    let hide = name[0] !== '_';
    if (hide) {
      const top = this.callStack[this.callStack.length - 1];
      if (top && top.kind === 'function' && top.locals.get('self') === obj) hide = false;
    }
    if (hide) d = d.filter((x) => x[0] !== '_');
    return calcSuggestion(d, name);
  }

  attrErr(obj, name, msg) {
    const t = pyErr('AttributeError', msg);
    const sug = this.attrSuggestion(obj, name);
    if (sug) t.exc.suggestion = `. Did you mean: '${sug}'?`;
    return t;
  }

  storeName(f, name, v) {
    if (f.kind === 'module') { this.globals.set(name, v); return; }
    if (f.kind === 'class') { f.locals.set(name, v); return; }
    const sc = f.scope;
    if (sc.globals.has(name)) { this.globals.set(name, v); return; }
    if (sc.nonlocals.has(name)) {
      let p = f.parent;
      while (p && p.kind !== 'module') {
        if (p.kind === 'function' && (p.scope.locals.has(name) || p.locals.has(name))) { p.locals.set(name, v); return; }
        p = p.parent;
      }
      throw pyErr('SyntaxError', `no binding for nonlocal '${name}' found`);
    }
    f.locals.set(name, v);
  }

  deleteName(f, name) {
    let map = f.locals;
    if (f.kind === 'function' && f.scope.globals.has(name)) map = this.globals;
    if (!map.has(name)) throw pyErr('NameError', `name '${name}' is not defined`);
    map.delete(name);
  }

  // ---------- statements ----------
  execBlock(stmts, f) {
    for (let i = 0; i < stmts.length; i++) {
      const sig = this.exec(stmts[i], f);
      if (sig !== undefined) return sig;
    }
    return undefined;
  }

  exec(s, f) {
    f.line = s.line;
    f.stmt = s;
    if (++this.steps > this.limit) throw new StepLimit();
    if (this.onLine !== null) this.onLine(s, f);
    switch (s.type) {
      case 'Expr': this.eval(s.value, f); return undefined;
      case 'Assign': return this.xAssign(s, f);
      case 'Return': return new Ret(s.value !== null ? this.eval(s.value, f) : NONE);
      case 'If':
        if (truthy(this.eval(s.test, f))) return this.execBlock(s.body, f);
        return s.orelse.length ? this.execBlock(s.orelse, f) : undefined;
      case 'For': return this.xFor(s, f);
      case 'While': return this.xWhile(s, f);
      case 'AugAssign': this.augAssign(s, f); return undefined;
      case 'Pass': return undefined;
      case 'Break': return BRK;
      case 'Continue': return CNT;
      case 'AnnAssign': if (s.value) this.assign(s.target, this.eval(s.value, f), f); return undefined;
      case 'FunctionDef': return this.xFunctionDef(s, f);
      case 'ClassDef': this.execClass(s, f); return undefined;
      case 'Global': case 'Nonlocal': return undefined;
      case 'Delete': return this.xDelete(s, f);
      case 'Import': return this.xImport(s, f);
      case 'ImportFrom': return this.xImportFrom(s, f);
      case 'Try': return this.execTry(s, f);
      case 'Raise': return this.xRaise(s, f);
      case 'Assert': return this.xAssert(s, f);
    }
    throw pyErr('SystemError', 'unknown statement ' + s.type);
  }

  xAssign(s, f) {
    const v = this.eval(s.value, f);
    const ts = s.targets;
    for (let i = 0; i < ts.length; i++) this.assign(ts[i], v, f);
    return undefined;
  }

  xWhile(s, f) {
    for (;;) {
      f.line = s.line;
      if (!truthy(this.eval(s.test, f))) break;
      const sig = this.execBlock(s.body, f);
      if (sig === BRK) return undefined;
      if (sig === CNT) { this.tick(1); continue; }
      if (sig !== undefined) return sig;
      this.tick(1);
    }
    if (s.orelse.length) return this.execBlock(s.orelse, f);
    return undefined;
  }

  xFor(s, f) {
    const iterable = this.eval(s.iter, f);
    let it;
    try { it = this.iterOf(iterable); } catch (err) { if (err instanceof PyThrow && s.iter.col !== undefined) markLoc(err, f, s.iter); throw err; }
    for (;;) {
      const v = it.next();
      if (v === STOP) break;
      f.line = s.line;
      f.stmt = s;
      this.tick(1);
      this.assign(s.target, v, f);
      const sig = this.execBlock(s.body, f);
      if (sig === BRK) return undefined;
      if (sig === CNT) continue;
      if (sig !== undefined) return sig;
    }
    if (s.orelse.length) return this.execBlock(s.orelse, f);
    return undefined;
  }

  xFunctionDef(s, f) {
    let v = this.makeFunction(s, f);
    for (let i = s.decorators.length - 1; i >= 0; i--) v = this.callValue(this.eval(s.decorators[i], f), [v], null);
    this.storeName(f, s.name, v);
    return undefined;
  }

  xDelete(s, f) {
    for (const t of s.targets) this.deleteTarget(t, f);
    return undefined;
  }

  xImport(s, f) {
    for (const nm of s.names) {
      const top = nm.name.split('.')[0];
      const mod = this.importModule(nm.name);
      this.storeName(f, nm.asname || top, nm.asname ? mod : this.importModule(top));
    }
    return undefined;
  }

  xImportFrom(s, f) {
    const mod = this.importModule(s.module);
    for (const nm of s.names) {
      if (nm.name === '*') { for (const [k, v] of mod.dict) if (!k.startsWith('_')) this.storeName(f, k, v); continue; }
      if (!mod.dict.has(nm.name)) throw pyErr('ImportError', `cannot import name '${nm.name}' from '${s.module}'`);
      this.storeName(f, nm.asname || nm.name, mod.dict.get(nm.name));
    }
    return undefined;
  }

  xRaise(s, f) {
    if (!s.exc) {
      const cur = this.handling[this.handling.length - 1];
      if (!cur) throw pyErr('RuntimeError', 'No active exception to reraise');
      throw new PyThrow(cur, this.snapshot());
    }
    let v = this.eval(s.exc, f);
    if (v instanceof PyClass && v.isException) v = this.instantiate(v, [], null);
    if (!(v instanceof PyInstance && v.cls.isException)) throw pyErr('TypeError', 'exceptions must derive from BaseException');
    throw new PyThrow(v, this.snapshot());
  }

  xAssert(s, f) {
    if (!truthy(this.eval(s.test, f))) throw pyErrArgs('AssertionError', s.msg ? [this.eval(s.msg, f)] : []);
    return undefined;
  }

  execTry(s, f) {
    let sig;
    try {
      let threw = false;
      try {
        sig = this.execBlock(s.body, f);
      } catch (err) {
        if (!(err instanceof PyThrow)) throw err;
        threw = true;
        const exc = err.exc;
        let handled = false;
        for (const h of s.handlers) {
          if (h.typ === null || this.excMatches(exc, this.eval(h.typ, f))) {
            handled = true;
            if (h.name) this.storeName(f, h.name, exc);
            this.handling.push(exc);
            try { sig = this.execBlock(h.body, f); }
            finally {
              this.handling.pop();
              if (h.name) { try { if (f.kind === 'module') this.globals.delete(h.name); else f.locals.delete(h.name); } catch (e) { /* ignore */ } }
            }
            break;
          }
        }
        if (!handled) throw err;
      }
      if (!threw && sig === undefined && s.orelse.length) sig = this.execBlock(s.orelse, f);
      return sig;
    } finally {
      if (s.finalbody.length) {
        const fsig = this.execBlock(s.finalbody, f);
        if (fsig !== undefined) return fsig; // eslint-disable-line no-unsafe-finally
      }
    }
  }

  excMatches(exc, typ) {
    if (typ instanceof PyTuple) return typ.a.some((t) => this.excMatches(exc, t));
    if (!(typ instanceof PyClass) || !typ.isException) throw pyErr('TypeError', 'catching classes that do not inherit from BaseException is not allowed');
    return exc.cls.mro.indexOf(typ) >= 0;
  }

  assign(t, v, f) {
    switch (t.type) {
      case 'Name': this.storeName(f, t.id, v); return;
      case 'Attribute': this.setAttr(this.eval(t.value, f), t.attr, v); return;
      case 'Subscript': {
        const obj = this.eval(t.value, f);
        const key = this.evalSlice(t.slice, f);
        try { this.setItem(obj, key, v); } catch (err) { if (err instanceof PyThrow && t.col !== undefined) markLoc(err, f, t); throw err; }
        return;
      }
      case 'Tuple': case 'List': this.unpack(t.elts, v, f); return;
      case 'Starred': throw pyErr('SyntaxError', 'starred assignment target must be in a list or tuple');
    }
    throw pyErr('SyntaxError', 'cannot assign');
  }

  unpack(elts, v, f) {
    let items;
    if (v instanceof PyTuple || v instanceof PyList) items = v.a;
    else {
      try { items = this.toArray(v); }
      catch (e) {
        if (e instanceof PyThrow && isInstanceOfName(e.exc, 'TypeError') && /not iterable/.test(pyStr(e.exc))) throw pyErr('TypeError', `cannot unpack non-iterable ${shortTypeName(v)} object`);
        throw e;
      }
    }
    const starIdx = elts.findIndex((e) => e.type === 'Starred');
    if (starIdx < 0) {
      if (items.length !== elts.length) {
        if (items.length > elts.length) throw pyErr('ValueError', `too many values to unpack (expected ${elts.length})`);
        throw pyErr('ValueError', `not enough values to unpack (expected ${elts.length}, got ${items.length})`);
      }
      const copy = items.slice();
      for (let i = 0; i < elts.length; i++) this.assign(elts[i], copy[i], f);
      return;
    }
    const before = starIdx, after = elts.length - starIdx - 1;
    if (items.length < before + after) throw pyErr('ValueError', `not enough values to unpack (expected at least ${before + after}, got ${items.length})`);
    const copy = items.slice();
    for (let i = 0; i < before; i++) this.assign(elts[i], copy[i], f);
    this.assign(elts[starIdx].value, new PyList(copy.slice(before, copy.length - after)), f);
    for (let i = 0; i < after; i++) this.assign(elts[starIdx + 1 + i], copy[copy.length - after + i], f);
  }

  augAssign(s, f) {
    try { this.augAssign0(s, f); } catch (err) {
      if (err instanceof PyThrow && isInstanceOfName(err.exc, 'TypeError') && err.exc.excArgs && typeof err.exc.excArgs[0] === 'string') {
        const m = err.exc.excArgs[0];
        const pre = `unsupported operand type(s) for ${s.op}:`;
        if (m.startsWith(pre)) err.exc.excArgs[0] = `unsupported operand type(s) for ${s.op}=:` + m.slice(pre.length);
      }
      throw err;
    }
  }

  augAssign0(s, f) {
    const t = s.target;
    if (t.type === 'Name') {
      const cur = this.loadName(f, t.id);
      this.storeName(f, t.id, this.inplace(s.op, cur, this.eval(s.value, f)));
      return;
    }
    if (t.type === 'Attribute') {
      const obj = this.eval(t.value, f);
      const cur = this.getAttr(obj, t.attr);
      this.setAttr(obj, t.attr, this.inplace(s.op, cur, this.eval(s.value, f)));
      return;
    }
    if (t.type === 'Subscript') {
      const obj = this.eval(t.value, f);
      const key = this.evalSlice(t.slice, f);
      const cur = this.getItem(obj, key);
      this.setItem(obj, key, this.inplace(s.op, cur, this.eval(s.value, f)));
    }
  }

  inplace(op, a, b) {
    if (op === '+' && a instanceof PyList) { const items = this.toArray(b); pushAll(a.a, items); return a; }
    if (op === '*' && a instanceof PyList && isIntV(b)) { const r = this.binop('*', a, b); a.a = r.a; return a; }
    if (a instanceof PySet && b instanceof PySet && (op === '|' || op === '&' || op === '-' || op === '^')) {
      if (a.frozen) return this.setOp(op, a, b);
      this.tick(a.m.size + b.m.size);
      if (op === '|') setUpdateFrom(this, a, b);
      else if (op === '-') setDifferenceUpdate(this, a, b);
      else if (op === '^') setSymDiffUpdate(this, a, b);
      else { const r = setIntersection(this, a, b); a.m = r.m; a.tbl = r.tbl; a.order = null; }
      return a;
    }
    if (op === '|' && a instanceof PyDict && b instanceof PyDict) { for (const e of b.m.values()) dictSet(a, e[0], e[1]); return a; }
    if (a instanceof PyDeque && op === '+') { pushAll(a.a, this.toArray(b)); return a; }
    if (a instanceof PyInstance) {
      const m = this.findMethod(a, '__i' + BIN_DUNDER[op].slice(2));
      if (m) { const r = this.callValue(m, [a, b], null); if (r !== NOT_IMPL) return r; }
    }
    return this.binop(op, a, b);
  }

  deleteTarget(t, f) {
    switch (t.type) {
      case 'Name': this.deleteName(f, t.id); return;
      case 'Subscript': this.delItem(this.eval(t.value, f), this.evalSlice(t.slice, f)); return;
      case 'Attribute': {
        const obj = this.eval(t.value, f);
        if (obj instanceof PyInstance && obj.dict.has(t.attr)) { obj.dict.delete(t.attr); return; }
        throw pyErr('AttributeError', `'${shortTypeName(obj)}' object has no attribute '${t.attr}'`);
      }
      case 'Tuple': case 'List': for (const e of t.elts) this.deleteTarget(e, f); return;
    }
  }

  // ---------- functions & classes ----------
  makeFunction(node, f) {
    const defaults = new Map();
    for (const p of node.params) if (p.def) defaults.set(p.name, this.eval(p.def, f));
    let qual = node.name;
    if (f.kind === 'class') qual = f.qual + '.' + node.name;
    else if (f.kind === 'function' && f.fn) qual = f.fn.qualname + '.<locals>.' + node.name;
    const fn = new PyFunction(node.name, node, f.kind === 'module' ? null : f, defaults, qual, false);
    return fn;
  }

  makeLambda(node, f) {
    const defaults = new Map();
    for (const p of node.params) if (p.def) defaults.set(p.name, this.eval(p.def, f));
    return new PyFunction('<lambda>', node, f.kind === 'module' ? null : f, defaults, '<lambda>', true);
  }

  execClass(s, f) {
    const bases = [];
    for (const b of s.bases) {
      const bv = this.eval(b, f);
      if (bv === T_OBJECT) continue;
      if (bv instanceof PyType) throw pyErr('TypeError', `inheriting from built-in type '${bv.name}' isn't supported in this runner`);
      if (!(bv instanceof PyClass)) throw pyErr('TypeError', 'bases must be types');
      bases.push(bv);
    }
    const cf = new Frame('class', null, f, s.name);
    cf.qual = f.kind === 'class' ? f.qual + '.' + s.name : s.name;
    cf.src = f.src;
    cf.locals.set('__qualname__', cf.qual);
    this.execBlock(s.body, cf);
    const cls = new PyClass(s.name, bases, cf.locals);
    for (const v of cf.locals.values()) {
      if (v instanceof PyFunction) v.ownerClass = cls;
      else if (v instanceof PyStaticMethod || v instanceof PyClassMethod) { if (v.fn instanceof PyFunction) v.fn.ownerClass = cls; }
      else if (v instanceof PyProperty && v.fget instanceof PyFunction) v.fget.ownerClass = cls;
    }
    let out = cls;
    for (let i = s.decorators.length - 1; i >= 0; i--) out = this.callValue(this.eval(s.decorators[i], f), [out], null);
    this.storeName(f, s.name, out);
  }

  lookupClass(cls, name) {
    const mro = cls.mro;
    for (let i = 0; i < mro.length; i++) {
      const v = mro[i].dict.get(name);
      if (v !== undefined) return v;
    }
    return undefined;
  }
  findMethod(inst, name) {
    const v = this.lookupClass(inst.cls, name);
    return v === undefined ? null : v;
  }

  instantiate(cls, args, kw) {
    const inst = new PyInstance(cls);
    if (cls.isException) inst.excArgs = args.slice();
    const init = this.lookupClass(cls, '__init__');
    if (init !== undefined) {
      const r = this.callValue(init, [inst].concat(args), kw);
      if (r !== NONE) throw pyErr('TypeError', `__init__() should return None, not '${shortTypeName(r)}'`);
    } else if (args.length || (kw && kw.size)) {
      throw pyErr('TypeError', `${cls.name}() takes no arguments`);
    }
    return inst;
  }

  callValue(fn, args, kw) {
    if (fn instanceof PyFunction) return this.callFunction(fn, args, kw);
    return this.callOther(fn, args, kw);
  }

  callOther(fn, args, kw) {
    if (fn instanceof PyBuiltin) return fn.fn.call(this, args, kw || EMPTY_KW, fn.self);
    if (fn instanceof PyBound) {
      const all = [fn.self];
      pushAll(all, args);
      return this.callValue(fn.fn, all, kw);
    }
    if (fn instanceof PyClass) return this.instantiate(fn, args, kw);
    if (fn instanceof PyType) return fn.call.call(this, args, kw || EMPTY_KW);
    if (fn instanceof PyInstance) {
      const m = this.findMethod(fn, '__call__');
      if (m) return this.callValue(m, [fn].concat(args), kw);
    }
    if (fn instanceof PyStaticMethod) return this.callValue(fn.fn, args, kw);
    throw pyErr('TypeError', `'${shortTypeName(fn)}' object is not callable`);
  }

  bindArgs(fn, fr, args, kw) {
    const params = fn.node.params;
    const L = fr.locals;
    let npos = 0, vararg = null, kwarg = null, hasKwOnly = false;
    for (const p of params) {
      if (p.kind === 'pos') npos++;
      else if (p.kind === 'vararg') vararg = p;
      else if (p.kind === 'kwarg') kwarg = p;
      else hasKwOnly = true;
    }
    const fname = fn.isLambda ? '<lambda>' : fn.qualname;
    if (args.length > npos && !vararg) {
      let required = 0;
      for (const p of params) if (p.kind === 'pos' && !fn.defaults.has(p.name)) required++;
      const takes = required === npos ? `${npos} positional argument${npos === 1 ? '' : 's'}` : `from ${required} to ${npos} positional arguments`;
      throw pyErr('TypeError', `${fname}() takes ${takes} but ${args.length} ${args.length === 1 ? 'was' : 'were'} given`);
    }
    let ai = 0;
    for (const p of params) {
      if (p.kind !== 'pos') continue;
      if (ai < args.length) L.set(p.name, args[ai++]);
      else break;
    }
    if (vararg) L.set(vararg.name, new PyTuple(args.slice(npos)));
    let extra = null;
    if (kwarg) extra = new PyDict();
    if (kw && kw.size) {
      for (const [k, v] of kw) {
        const p = params.find((pp) => (pp.kind === 'pos' || pp.kind === 'kwonly') && pp.name === k);
        if (p) {
          if (L.has(k)) throw pyErr('TypeError', `${fname}() got multiple values for argument '${k}'`);
          L.set(k, v);
        } else if (extra) dictSet(extra, k, v);
        else throw pyErr('TypeError', `${fname}() got an unexpected keyword argument '${k}'`);
      }
    }
    const missing = [], missingKw = [];
    for (const p of params) {
      if ((p.kind === 'pos' || p.kind === 'kwonly') && !L.has(p.name)) {
        if (fn.defaults.has(p.name)) L.set(p.name, fn.defaults.get(p.name));
        else (p.kind === 'pos' ? missing : missingKw).push(p.name);
      }
    }
    const fmt = (names) => {
      const q = names.map((x) => `'${x}'`);
      if (q.length === 1) return q[0];
      if (q.length === 2) return q[0] + ' and ' + q[1];
      return q.slice(0, -1).join(', ') + ', and ' + q[q.length - 1];
    };
    if (missing.length) throw pyErr('TypeError', `${fname}() missing ${missing.length} required positional argument${missing.length > 1 ? 's' : ''}: ${fmt(missing)}`);
    if (missingKw.length) throw pyErr('TypeError', `${fname}() missing ${missingKw.length} required keyword-only argument${missingKw.length > 1 ? 's' : ''}: ${fmt(missingKw)}`);
    if (kwarg) L.set(kwarg.name, extra);
    void hasKwOnly;
  }

  callFunction(fn, args, kw) {
    // like CPython: the module frame plus at most (limit - 1) nested calls
    if (this.depth >= this.maxDepth - 1) throw pyErr('RecursionError', 'maximum recursion depth exceeded');
    const fr = this.enterFunction(fn, args, kw);
    try {
      if (fn.isLambda) return this.eval(fn.node.body, fr);
      const sig = this.execBlock(fn.node.body, fr);
      return sig instanceof Ret ? sig.v : NONE;
    } catch (e) {
      // the browser's own stack ran out first: report it as Python would, with the frames so far
      if (e instanceof RangeError) throw pyErr('RecursionError', 'maximum recursion depth exceeded');
      throw e;
    } finally {
      this.depth--;
      this.callStack.pop();
    }
  }

  enterFunction(fn, args, kw) {
    const node = fn.node;
    if (!node.scope) node.scope = fn.isLambda ? { locals: new Set(node.params.map((p) => p.name)), globals: new Set(), nonlocals: new Set() } : collectScope(node.body, node.params);
    const fr = new Frame('function', node.scope, fn.closure, fn.isLambda ? '<lambda>' : fn.name);
    fr.fn = fn;
    fr.src = node.src || null;
    fr.line = node.line;
    if (fn.simple === undefined) fn.simple = node.params.every((p) => p.kind === 'pos' && !p.def);
    if (fn.simple && (!kw || !kw.size) && args.length === node.params.length) {
      const ps = node.params;
      for (let i = 0; i < ps.length; i++) fr.locals.set(ps[i].name, args[i]);
    } else this.bindArgs(fn, fr, args, kw);
    this.depth++;
    this.callStack.push(fr);
    this.tick(1);
    return fr;
  }

  importModule(name) {
    if (this.modules.has(name)) return this.modules.get(name);
    const factory = MODULES[name];
    if (!factory) {
      if (KNOWN_UNSUPPORTED.has(name)) throw pyErr('ModuleNotFoundError', `No module named '${name}' (it isn't available in this runner)`);
      throw pyErr('ModuleNotFoundError', `No module named '${name}'`);
    }
    const mod = new PyModule(name, factory(this));
    this.modules.set(name, mod);
    return mod;
  }

  // ---------- attributes ----------
  getAttr(obj, name) {
    if (obj instanceof PyInstance) {
      const own = obj.dict.get(name);
      if (own !== undefined) return own;
      const v = this.lookupClass(obj.cls, name);
      if (v !== undefined) {
        if (v instanceof PyFunction || v instanceof PyBuiltin) return new PyBound(obj, v);
        if (v instanceof PyStaticMethod) return v.fn;
        if (v instanceof PyClassMethod) return new PyBound(obj.cls, v.fn);
        if (v instanceof PyProperty) return this.callValue(v.fget, [obj], null);
        return v;
      }
      if (name === '__class__') return obj.cls;
      if (name === '__dict__') { const d = new PyDict(); for (const [k, x] of obj.dict) dictSet(d, k, x); return d; }
      if (obj.cls.isException && name === 'args') return new PyTuple(obj.excArgs || []);
      const ga = this.lookupClass(obj.cls, '__getattr__');
      if (ga) return this.callValue(ga, [obj, name], null);
      throw this.attrErr(obj, name, `'${obj.cls.name}' object has no attribute '${name}'`);
    }
    if (obj instanceof PyClass) {
      const v = this.lookupClass(obj, name);
      if (v !== undefined) {
        if (v instanceof PyClassMethod) return new PyBound(obj, v.fn);
        if (v instanceof PyStaticMethod) return v.fn;
        return v;
      }
      if (name === '__name__') return obj.name;
      if (name === '__qualname__') return obj.name;
      if (name === '__mro__') return new PyTuple(obj.mro.slice());
      if (name === '__bases__') return new PyTuple(obj.bases.slice());
      if (name === '__init__') return OBJECT_INIT;
      throw this.attrErr(obj, name, `type object '${obj.name}' has no attribute '${name}'`);
    }
    if (obj instanceof PySuper) {
      const target = obj.obj;
      const mro = (target instanceof PyClass) ? target.mro : target.cls.mro;
      let i = mro.indexOf(obj.cls);
      for (i = i + 1; i < mro.length; i++) {
        const v = mro[i].dict.get(name);
        if (v !== undefined) {
          if (v instanceof PyFunction || v instanceof PyBuiltin) return new PyBound(target, v);
          if (v instanceof PyClassMethod) return new PyBound(target instanceof PyClass ? target : target.cls, v.fn);
          if (v instanceof PyStaticMethod) return v.fn;
          if (v instanceof PyProperty) return this.callValue(v.fget, [target], null);
          return v;
        }
      }
      if (name === '__init__') return new PyBuiltin('__init__', function () { return NONE; });
      if (name === '__str__' || name === '__repr__') return new PyBuiltin(name, function () { return `<__main__.${target.cls.name} object at 0x${addr(target)}>`; });
      throw pyErr('AttributeError', `'super' object has no attribute '${name}'`);
    }
    if (obj instanceof PyModule) {
      const v = obj.dict.get(name);
      if (v !== undefined) return v;
      if (name === '__name__') return obj.name;
      throw this.attrErr(obj, name, `module '${obj.name}' has no attribute '${name}'`);
    }
    if (obj instanceof PyType) {
      if (name === '__name__') return obj.name;
      const st = TYPE_STATICS[obj.name] && TYPE_STATICS[obj.name][name];
      if (st) return st;
      const tbl = obj.methods;
      if (tbl && tbl.has(name)) {
        const impl = tbl.get(name);
        return new PyBuiltin(name, function (args, kw) {
          if (!args.length) throw pyErr('TypeError', `unbound method ${obj.name}.${name}() needs an argument`);
          return impl.call(this, args.slice(1), kw, args[0]);
        });
      }
      throw this.attrErr(obj, name, `type object '${obj.name}' has no attribute '${name}'`);
    }
    if (obj instanceof PyFunction) {
      if (name === '__name__') return obj.name;
      if (name === '__qualname__') return obj.qualname;
      if (name === '__doc__') return NONE;
      if (obj.attrs && obj.attrs.has(name)) return obj.attrs.get(name);
      throw pyErr('AttributeError', `'function' object has no attribute '${name}'`);
    }
    if (obj instanceof PyBuiltin) {
      if (name === '__name__') return obj.name;
      if (obj.attrs && obj.attrs.has(name)) return obj.attrs.get(name);
    }
    if (obj instanceof PyBound) {
      if (name === '__name__') return obj.fn.name;
      if (name === '__self__') return obj.self;
    }
    const tbl = methodsFor(obj);
    if (tbl) {
      const impl = tbl.get(name);
      if (impl) return new PyBuiltin(name, impl, obj);
    }
    if (isIntV(obj) || obj instanceof PyFloat) {
      if (name === 'real') return obj instanceof PyFloat ? obj : asInt(obj);
      if (name === 'imag') return obj instanceof PyFloat ? F(0) : 0;
      if (name === 'numerator' && isIntV(obj)) return asInt(obj);
      if (name === 'denominator' && isIntV(obj)) return 1;
    }
    if (obj instanceof PyDict && obj.kind === 'defaultdict' && name === 'default_factory') return obj.factory;
    if (obj instanceof PyRange) {
      if (name === 'start') return obj.start;
      if (name === 'stop') return obj.stop;
      if (name === 'step') return obj.step;
    }
    throw this.attrErr(obj, name, `'${shortTypeName(obj)}' object has no attribute '${name}'`);
  }

  setAttr(obj, name, v) {
    if (obj instanceof PyInstance) {
      const p = this.lookupClass(obj.cls, name);
      if (p instanceof PyProperty) {
        if (!p.fset) throw pyErr('AttributeError', `property '${name}' of '${obj.cls.name}' object has no setter`);
        this.callValue(p.fset, [obj, v], null);
        return;
      }
      obj.dict.set(name, v);
      return;
    }
    if (obj instanceof PyClass) { obj.dict.set(name, v); return; }
    if (obj instanceof PyFunction) { if (!obj.attrs) obj.attrs = new Map(); obj.attrs.set(name, v); return; }
    if (obj instanceof PyModule) { obj.dict.set(name, v); return; }
    const tbl = methodsFor(obj);
    if (tbl && tbl.has(name)) throw pyErr('AttributeError', `'${shortTypeName(obj)}' object attribute '${name}' is read-only`);
    throw pyErr('AttributeError', `'${shortTypeName(obj)}' object has no attribute '${name}'` + (obj instanceof PyDict || obj instanceof PyList ? ' and no __dict__ for setting new attributes' : ''));
  }

  // ---------- items ----------
  seqIndex(key, len, kind) {
    if (!isIntV(key)) {
      if (key instanceof PyInstance && this.findMethod(key, '__index__')) key = this.callValue(this.findMethod(key, '__index__'), [key], null);
      else throw pyErr('TypeError', `${kind} indices must be integers or slices, not ${shortTypeName(key)}`);
    }
    let i = Number(asInt(key));
    if (i < 0) i += len;
    if (i < 0 || i >= len) throw pyErr('IndexError', `${kind} index out of range`);
    return i;
  }

  getItem(obj, key) {
    if (obj instanceof PyList || obj instanceof PyTuple) {
      if (key instanceof PySlice) {
        const out = sliceArr(obj.a, key);
        this.tick(out.length);
        return obj instanceof PyList ? new PyList(out) : new PyTuple(out);
      }
      return obj.a[this.seqIndex(key, obj.a.length, obj instanceof PyList ? 'list' : 'tuple')];
    }
    if (typeof obj === 'string') {
      if (key instanceof PySlice) {
        const chars = strChars(obj);
        const out = sliceArr(chars, key);
        this.tick(out.length >> 2);
        return out.join('');
      }
      if (!isIntV(key)) throw pyErr('TypeError', `string indices must be integers, not '${shortTypeName(key)}'`);
      const chars = strChars(obj);
      let i = Number(asInt(key));
      if (i < 0) i += chars.length;
      if (i < 0 || i >= chars.length) throw pyErr('IndexError', 'string index out of range');
      return chars[i];
    }
    if (obj instanceof PyDict) {
      const v = dictGet(obj, key);
      if (v !== undefined) return v;
      if (obj.kind === 'defaultdict' && obj.factory !== null && obj.factory !== NONE) {
        const nv = this.callValue(obj.factory, [], null);
        dictSet(obj, key, nv);
        return nv;
      }
      if (obj.kind === 'Counter') return 0;
      throw pyErrArgs('KeyError', [key]);
    }
    if (obj instanceof PyRange) {
      if (key instanceof PySlice) {
        const [start, stop, step] = sliceIndices(key, obj.length);
        const st = obj.at(start), sp = obj.at(stop), stp = obj.step * step;
        return new PyRange(st, sp, stp);
      }
      return obj.at(this.seqIndex(key, obj.length, 'range object'));
    }
    if (obj instanceof PyDeque) {
      if (key instanceof PySlice) throw pyErr('TypeError', 'sequence index must be integer, not \'slice\'');
      let i = Number(asInt(key));
      if (!isIntV(key)) throw pyErr('TypeError', `sequence index must be integer, not '${shortTypeName(key)}'`);
      if (i < 0) i += obj.a.length;
      if (i < 0 || i >= obj.a.length) throw pyErr('IndexError', 'deque index out of range');
      return obj.a[i];
    }
    if (obj instanceof PyInstance) {
      const m = this.findMethod(obj, '__getitem__');
      if (m) return this.callValue(m, [obj, key], null);
    }
    if (obj instanceof PyClass || obj instanceof PyType) return obj;
    throw pyErr('TypeError', `'${shortTypeName(obj)}' object is not subscriptable`);
  }

  setItem(obj, key, v) {
    if (obj instanceof PyList) {
      if (key instanceof PySlice) {
        const items = this.toArray(v);
        const [start, stop, step] = sliceIndices(key, obj.a.length);
        if (step === 1) {
          const end = Math.max(stop, start);
          obj.a = obj.a.slice(0, start).concat(items, obj.a.slice(end));
          this.tick(obj.a.length);
          return;
        }
        const idxs = [];
        if (step > 0) for (let i = start; i < stop; i += step) idxs.push(i);
        else for (let i = start; i > stop; i += step) idxs.push(i);
        if (idxs.length !== items.length) throw pyErr('ValueError', `attempt to assign sequence of size ${items.length} to extended slice of size ${idxs.length}`);
        idxs.forEach((ix, k) => { obj.a[ix] = items[k]; });
        return;
      }
      if (!isIntV(key)) throw pyErr('TypeError', `list indices must be integers or slices, not ${shortTypeName(key)}`);
      let i = Number(asInt(key));
      if (i < 0) i += obj.a.length;
      if (i < 0 || i >= obj.a.length) throw pyErr('IndexError', 'list assignment index out of range');
      obj.a[i] = v;
      return;
    }
    if (obj instanceof PyDict) { dictSet(obj, key, v); return; }
    if (obj instanceof PyDeque) {
      let i = Number(asInt(key));
      if (i < 0) i += obj.a.length;
      if (i < 0 || i >= obj.a.length) throw pyErr('IndexError', 'deque index out of range');
      obj.a[i] = v;
      return;
    }
    if (obj instanceof PyInstance) {
      const m = this.findMethod(obj, '__setitem__');
      if (m) { this.callValue(m, [obj, key, v], null); return; }
    }
    throw pyErr('TypeError', `'${shortTypeName(obj)}' object does not support item assignment`);
  }

  delItem(obj, key) {
    if (obj instanceof PyList) {
      if (key instanceof PySlice) {
        const [start, stop, step] = sliceIndices(key, obj.a.length);
        const del = new Set();
        if (step > 0) for (let i = start; i < stop; i += step) del.add(i);
        else for (let i = start; i > stop; i += step) del.add(i);
        obj.a = obj.a.filter((_, i) => !del.has(i));
        this.tick(obj.a.length);
        return;
      }
      const i = this.seqIndex(key, obj.a.length, 'list');
      if (i === obj.a.length - 1) obj.a.pop();
      else { obj.a.splice(i, 1); this.tick(obj.a.length - i); }
      return;
    }
    if (obj instanceof PyDict) {
      if (!obj.m.delete(hashKey(key))) throw pyErrArgs('KeyError', [key]);
      return;
    }
    if (obj instanceof PyDeque) {
      let i = Number(asInt(key));
      if (i < 0) i += obj.a.length;
      if (i < 0 || i >= obj.a.length) throw pyErr('IndexError', 'deque index out of range');
      obj.a.splice(i, 1);
      return;
    }
    if (obj instanceof PyInstance) {
      const m = this.findMethod(obj, '__delitem__');
      if (m) { this.callValue(m, [obj, key], null); return; }
    }
    throw pyErr('TypeError', `'${shortTypeName(obj)}' object doesn't support item deletion`);
  }

  // ---------- iteration ----------
  iterOf(obj) {
    if (obj instanceof PyList || obj instanceof PyTuple || obj instanceof PyDeque) {
      let i = 0;
      return { next: () => (i < obj.a.length ? obj.a[i++] : STOP) };
    }
    if (typeof obj === 'string') {
      const chars = strChars(obj);
      let i = 0;
      return { next: () => (i < chars.length ? chars[i++] : STOP) };
    }
    if (obj instanceof PyRange) {
      const n = obj.length;
      let i = 0;
      return { next: () => (i < n ? obj.at(i++) : STOP) };
    }
    if (obj instanceof PyDict) {
      const entries = [...obj.m.values()];
      const size = obj.m.size;
      let i = 0;
      return { next: () => {
        if (obj.m.size !== size) throw pyErr('RuntimeError', 'dictionary changed size during iteration');
        return i < entries.length ? entries[i++][0] : STOP;
      } };
    }
    if (obj instanceof PySet) {
      const items = setOrder(obj).slice();
      const size = obj.m.size;
      let i = 0;
      return { next: () => {
        if (obj.m.size !== size) throw pyErr('RuntimeError', 'Set changed size during iteration');
        return i < items.length ? items[i++] : STOP;
      } };
    }
    if (obj instanceof PyDictView) {
      const items = dictViewItems(obj);
      const size = obj.d.m.size;
      let i = 0;
      return { next: () => {
        if (obj.d.m.size !== size) throw pyErr('RuntimeError', 'dictionary changed size during iteration');
        return i < items.length ? items[i++] : STOP;
      } };
    }
    if (obj instanceof PyIter) return obj;
    if (obj instanceof PyInstance) {
      const it = this.findMethod(obj, '__iter__');
      if (it) {
        const r = this.callValue(it, [obj], null);
        if (r instanceof PyInstance) {
          const nx = this.findMethod(r, '__next__');
          if (!nx) throw pyErr('TypeError', `iter() returned non-iterator of type '${shortTypeName(r)}'`);
          return { next: () => {
            try { return this.callValue(nx, [r], null); }
            catch (e) { if (e instanceof PyThrow && isInstanceOfName(e.exc, 'StopIteration')) return STOP; throw e; }
          } };
        }
        return this.iterOf(r);
      }
      const gi = this.findMethod(obj, '__getitem__');
      if (gi) {
        let i = 0;
        return { next: () => {
          try { return this.callValue(gi, [obj, i++], null); }
          catch (e) { if (e instanceof PyThrow && (isInstanceOfName(e.exc, 'IndexError') || isInstanceOfName(e.exc, 'StopIteration'))) return STOP; throw e; }
        } };
      }
    }
    throw pyErr('TypeError', `'${shortTypeName(obj)}' object is not iterable`);
  }

  toArray(obj) {
    if (obj instanceof PyList || obj instanceof PyTuple || obj instanceof PyDeque) { this.tick(obj.a.length); return obj.a.slice(); }
    if (typeof obj === 'string') { const c = strChars(obj); this.tick(c.length >> 2); return c; }
    const it = this.iterOf(obj);
    const out = [];
    for (;;) { const v = it.next(); if (v === STOP) break; out.push(v); }
    this.tick(out.length);
    return out;
  }

  contains(c, x) {
    if (c instanceof PyList || c instanceof PyTuple || c instanceof PyDeque) {
      const a = c.a;
      for (let i = 0; i < a.length; i++) {
        if (a[i] === x || pyEq(a[i], x)) { this.tick(i + 1); return true; }
      }
      this.tick(a.length);
      return false;
    }
    if (typeof c === 'string') {
      if (typeof x !== 'string') throw pyErr('TypeError', `'in <string>' requires string as left operand, not ${shortTypeName(x)}`);
      this.tick(c.length >> 2);
      return c.indexOf(x) >= 0;
    }
    if (c instanceof PyDict) return dictHas(c, x);
    if (c instanceof PySet) return setHas(c, x);
    if (c instanceof PyRange) {
      if (isIntV(x) || (x instanceof PyFloat && Number.isInteger(x.v))) {
        const v = fval(x);
        const { start, stop, step } = c;
        if (step > 0 ? (v < start || v >= stop) : (v > start || v <= stop)) return false;
        return (v - start) % step === 0;
      }
      return false;
    }
    if (c instanceof PyDictView) {
      if (c.kind === 'keys') return dictHas(c.d, x);
      if (c.kind === 'items') {
        if (!(x instanceof PyTuple) || x.a.length !== 2) return false;
        const v = dictGet(c.d, x.a[0]);
        return v !== undefined && pyEq(v, x.a[1]);
      }
      return dictViewItems(c).some((v) => pyEq(v, x));
    }
    if (c instanceof PyInstance) {
      const m = this.findMethod(c, '__contains__');
      if (m) return truthy(this.callValue(m, [c, x], null));
    }
    if (c instanceof PyIter || c instanceof PyInstance) {
      const it = this.iterOf(c);
      for (;;) { const v = it.next(); if (v === STOP) return false; this.tick(1); if (pyEq(v, x)) return true; }
    }
    throw pyErr('TypeError', `argument of type '${shortTypeName(c)}' is not iterable`);
  }

  // ---------- operators ----------
  seqRepeat(seq, n) {
    let k = Number(asInt(n));
    if (k < 0) k = 0;
    if (typeof seq === 'string') {
      if (seq.length * k > 5e7) throw pyErr('MemoryError', 'string too large for this runner');
      return seq.repeat(k);
    }
    if (seq.a.length * k > 5e6) throw pyErr('MemoryError', 'list too large for this runner');
    const out = [];
    for (let i = 0; i < k; i++) pushAll(out, seq.a);
    this.tick(out.length);
    return seq instanceof PyList ? new PyList(out) : new PyTuple(out);
  }

  setOp(op, a, b) {
    this.tick(a.m.size + b.m.size);
    if (op === '|') return setUnion(this, a, b);
    if (op === '&') return setIntersection(this, a, b);
    if (op === '-') return setDifference(this, a, b);
    return setSymDiff(this, a, b);
  }

  binop(op, a, b) {
    if (isNumV(a) && isNumV(b)) return numBinop(op, a, b);
    switch (op) {
      case '+':
        if (typeof a === 'string' && typeof b === 'string') return a + b;
        if (a instanceof PyList && b instanceof PyList) { this.tick(a.a.length + b.a.length); return new PyList(a.a.concat(b.a)); }
        if (a instanceof PyTuple && b instanceof PyTuple) { this.tick(a.a.length + b.a.length); return new PyTuple(a.a.concat(b.a)); }
        if (a instanceof PyDeque && b instanceof PyDeque) return new PyDeque(a.a.concat(b.a));
        if (!(b instanceof PyInstance)) {
          if (typeof a === 'string') throw pyErr('TypeError', `can only concatenate str (not "${shortTypeName(b)}") to str`);
          if (a instanceof PyList) throw pyErr('TypeError', `can only concatenate list (not "${shortTypeName(b)}") to list`);
          if (a instanceof PyTuple) throw pyErr('TypeError', `can only concatenate tuple (not "${shortTypeName(b)}") to tuple`);
        }
        break;
      case '*': {
        const isSeq = (x) => typeof x === 'string' || x instanceof PyList || x instanceof PyTuple;
        if (isSeq(a) && isIntV(b)) return this.seqRepeat(a, b);
        if (isSeq(b) && isIntV(a)) return this.seqRepeat(b, a);
        if (isSeq(a) && !(b instanceof PyInstance)) throw pyErr('TypeError', `can't multiply sequence by non-int of type '${shortTypeName(b)}'`);
        if (isSeq(b) && !(a instanceof PyInstance)) throw pyErr('TypeError', `can't multiply sequence by non-int of type '${shortTypeName(a)}'`);
        break;
      }
      case '%':
        if (typeof a === 'string') return percentFormat(a, b);
        break;
      case '|': case '&': case '-': case '^':
        if (a instanceof PySet && b instanceof PySet) return this.setOp(op, a, b);
        if (op === '|' && a instanceof PyDict && b instanceof PyDict) {
          const d = new PyDict();
          for (const e of a.m.values()) dictSet(d, e[0], e[1]);
          for (const e of b.m.values()) dictSet(d, e[0], e[1]);
          return d;
        }
        if (a instanceof PyDictView && b instanceof PySet && a.kind === 'keys') return this.binop(op, toSet(dictViewItems(a)), b);
        if (a instanceof PyDict && a.kind === 'Counter' && b instanceof PyDict && b.kind === 'Counter' && (op === '-' || op === '|' || op === '&')) return counterOp(op, a, b);
        break;
    }
    if (op === '+' && a instanceof PyDict && a.kind === 'Counter' && b instanceof PyDict && b.kind === 'Counter') return counterOp('+', a, b);
    const name = BIN_DUNDER[op], rname = RBIN_DUNDER[op];
    if (a instanceof PyInstance) {
      const m = this.findMethod(a, name);
      if (m) { const r = this.callValue(m, [a, b], null); if (r !== NOT_IMPL) return r; }
    }
    if (b instanceof PyInstance) {
      const m = this.findMethod(b, rname);
      if (m) { const r = this.callValue(m, [b, a], null); if (r !== NOT_IMPL) return r; }
    }
    throw pyErr('TypeError', `unsupported operand type(s) for ${op === '**' ? '** or pow()' : op}: '${shortTypeName(a)}' and '${shortTypeName(b)}'`);
  }

  unary(op, v) {
    if (op === 'not') return !truthy(v);
    if (op === '-') {
      if (typeof v === 'number' || typeof v === 'bigint') return intNeg(v);
      if (typeof v === 'boolean') return v ? -1 : 0;
      if (v instanceof PyFloat) return F(-v.v);
    } else if (op === '+') {
      if (isIntV(v)) return asInt(v);
      if (v instanceof PyFloat) return v;
    } else if (op === '~') {
      if (isIntV(v)) return normInt(~big(asInt(v)));
    }
    if (v instanceof PyInstance) {
      const m = this.findMethod(v, op === '-' ? '__neg__' : op === '+' ? '__pos__' : '__invert__');
      if (m) return this.callValue(m, [v], null);
    }
    throw pyErr('TypeError', `bad operand type for unary ${op}: '${shortTypeName(v)}'`);
  }

  compare(op, a, b) {
    switch (op) {
      case '==': return pyEq(a, b);
      case '!=':
        if (a instanceof PyInstance) {
          const m = this.findMethod(a, '__ne__');
          if (m) { const r = this.callValue(m, [a, b], null); if (r !== NOT_IMPL) return truthy(r); }
        }
        return !pyEq(a, b);
      case '<': case '>': case '<=': case '>=': return pyCmp(op, a, b);
      case 'in': return this.contains(b, a);
      case 'not in': return !this.contains(b, a);
      case 'is': return a === b || (typeof a === 'bigint' && a === b);
      case 'is not': return !(a === b);
    }
    throw pyErr('SystemError', 'bad compare op');
  }

  // ---------- expressions ----------
  evalSlice(node, f) {
    if (node.type === 'Slice') {
      return new PySlice(node.lower ? this.eval(node.lower, f) : NONE, node.upper ? this.eval(node.upper, f) : NONE, node.step ? this.eval(node.step, f) : NONE);
    }
    if (node.type === 'Tuple' && node.elts.some((e) => e.type === 'Slice')) {
      return new PyTuple(node.elts.map((e) => this.evalSlice(e, f)));
    }
    return this.eval(node, f);
  }

  evalElts(elts, f) {
    const out = [];
    for (let i = 0; i < elts.length; i++) {
      const e = elts[i];
      if (e.type === 'Starred') pushAll(out, this.toArray(this.eval(e.value, f)));
      else out.push(this.eval(e, f));
    }
    return out;
  }

  evalFStr(parts, f) {
    let out = '';
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.s !== undefined) { out += p.s; continue; }
      let v = this.eval(p.expr, f);
      if (p.conv === 'r' || p.conv === 'a') v = repr(v);
      else if (p.conv === 's') v = pyStr(v);
      const spec = p.spec ? this.evalFStr(p.spec, f) : '';
      out += formatSpec(v, spec);
    }
    return out;
  }

  eval(e, f) {
    try {
      switch (e.type) {
        case 'Name': return this.loadName(f, e.id);
        case 'Num': return e.isFloat ? (e.cached || (e.cached = F(e.value))) : e.value;
        case 'Str': return e.value;
        case 'Const': return e.value;
        case 'Call': return this.evalCall(e, f);
        case 'BinOp': return this.binop(e.op, this.eval(e.left, f), this.eval(e.right, f));
        case 'Compare': return this.eCompare(e, f);
        case 'Attribute': return this.getAttr(this.eval(e.value, f), e.attr);
        case 'Subscript': return this.eSubscript(e, f);
        case 'BoolOp': return this.eBoolOp(e, f);
        case 'UnaryOp': return this.unary(e.op, this.eval(e.operand, f));
        case 'IfExp': return truthy(this.eval(e.test, f)) ? this.eval(e.body, f) : this.eval(e.orelse, f);
        case 'FStr': return this.evalFStr(e.parts, f);
        case 'List': return new PyList(this.evalElts(e.elts, f));
        case 'Tuple': return new PyTuple(this.evalElts(e.elts, f));
        case 'Set': return this.eSet(e, f);
        case 'Dict': return this.eDict(e, f);
        case 'Lambda': return this.makeLambda(e, f);
        case 'ListComp': return new PyList(this.comprehension(e, f, false));
        case 'SetComp': return this.eSetComp(e, f);
        case 'DictComp': return this.eDictComp(e, f);
        case 'GeneratorExp': return this.eGenExp(e, f);
        case 'NamedExpr': return this.eNamed(e, f);
        case 'Starred': throw pyErr('SyntaxError', "can't use starred expression here");
        case 'Slice': return this.evalSlice(e, f);
      }
    } catch (err) {
      if (err instanceof PyThrow && e.col !== undefined) markLoc(err, f, e);
      throw err;
    }
    throw pyErr('SystemError', 'unknown expression ' + e.type);
  }

  eCompare(e, f) {
    let left = this.eval(e.left, f);
    const ops = e.ops, comps = e.comparators;
    for (let i = 0; i < ops.length; i++) {
      const right = this.eval(comps[i], f);
      if (!this.compare(ops[i], left, right)) return false;
      left = right;
    }
    return true;
  }

  eSubscript(e, f) {
    const obj = this.eval(e.value, f);
    return this.getItem(obj, this.evalSlice(e.slice, f));
  }

  eBoolOp(e, f) {
    let v;
    const vals = e.values;
    if (e.op === 'and') {
      for (let i = 0; i < vals.length; i++) { v = this.eval(vals[i], f); if (!truthy(v)) return v; }
      return v;
    }
    for (let i = 0; i < vals.length; i++) { v = this.eval(vals[i], f); if (truthy(v)) return v; }
    return v;
  }

  eSet(e, f) {
    const items = this.evalElts(e.elts, f);
    if (e.elts.length > 2 && e.elts.every(isConstNode)) return setFromConstDisplay(items);
    const s = new PySet();
    for (const x of items) setAdd(s, x);
    return s;
  }

  eDict(e, f) {
    const d = new PyDict();
    for (let i = 0; i < e.keys.length; i++) {
      if (e.keys[i] === null) {
        const src = this.eval(e.values[i], f);
        if (!(src instanceof PyDict)) throw pyErr('TypeError', `'${shortTypeName(src)}' object is not a mapping`);
        for (const en of src.m.values()) dictSet(d, en[0], en[1]);
      } else {
        const k = this.eval(e.keys[i], f);
        dictSet(d, k, this.eval(e.values[i], f));
      }
    }
    return d;
  }

  eSetComp(e, f) { const s = new PySet(); for (const x of this.comprehension(e, f, false)) setAdd(s, x); return s; }
  eDictComp(e, f) { const d = new PyDict(); for (const [k, v] of this.comprehension(e, f, true)) dictSet(d, k, v); return d; }
  eGenExp(e, f) { const items = this.comprehension(e, f, false); let i = 0; return new PyIter(() => (i < items.length ? items[i++] : STOP), 'generator'); }
  eNamed(e, f) { const v = this.eval(e.value, f); this.storeName(f, e.target.id, v); return v; }

  evalCall(e, f) {
    const fn = this.eval(e.func, f);
    const args = e.simpleArgs ? this.evalSimpleArgs(e.args, f) : this.evalArgs(e, f);
    const kw = e.keywords.length ? this.evalKw(e, f) : null;
    if (fn === BUILTIN_SUPER && args.length === 0) return this.zeroArgSuper(f);
    return this.callValue(fn, args, kw);
  }

  evalSimpleArgs(list, f) {
    const n = list.length;
    if (n === 0) return [];
    if (n === 1) return [this.eval(list[0], f)];
    const args = new Array(n);
    for (let i = 0; i < n; i++) args[i] = this.eval(list[i], f);
    return args;
  }

  evalArgs(e, f) {
    if (e.simpleArgs === undefined) {
      e.simpleArgs = !e.args.some((a) => a.type === 'Starred');
      if (e.simpleArgs) return this.evalSimpleArgs(e.args, f);
    }
    const args = [];
    for (let i = 0; i < e.args.length; i++) {
      const a = e.args[i];
      if (a.type === 'Starred') pushAll(args, this.toArray(this.eval(a.value, f)));
      else args.push(this.eval(a, f));
    }
    return args;
  }

  evalKw(e, f) {
    const kw = new Map();
    for (const k of e.keywords) {
      if (k.arg === null) {
        const d = this.eval(k.value, f);
        if (!(d instanceof PyDict)) throw pyErr('TypeError', `argument after ** must be a mapping, not ${shortTypeName(d)}`);
        for (const en of d.m.values()) kw.set(pyStr(en[0]), en[1]);
      } else {
        if (kw.has(k.arg)) throw pyErr('SyntaxError', `keyword argument repeated: ${k.arg}`);
        kw.set(k.arg, this.eval(k.value, f));
      }
    }
    return kw;
  }

  zeroArgSuper(f) {
    let fr = f;
    while (fr && fr.kind === 'function' && fr.fn && !fr.fn.ownerClass) fr = fr.parent;
    if (!fr || !fr.fn || !fr.fn.ownerClass) throw pyErr('RuntimeError', 'super(): no arguments');
    const first = fr.fn.node.params[0];
    if (!first) throw pyErr('RuntimeError', 'super(): no arguments');
    return new PySuper(fr.fn.ownerClass, fr.locals.get(first.name));
  }

  comprehension(e, f, isDict) {
    if (!e.scope) e.scope = compScope(e.generators);
    const cf = new Frame('function', e.scope, f, '<listcomp>');
    cf.line = f.line;
    const out = [];
    const gens = e.generators;
    const loop = (gi, it) => {
      const g = gens[gi];
      for (;;) {
        const v = it.next();
        if (v === STOP) break;
        this.tick(1);
        this.assign(g.target, v, cf);
        let ok = true;
        for (let k = 0; k < g.ifs.length; k++) if (!truthy(this.eval(g.ifs[k], cf))) { ok = false; break; }
        if (!ok) continue;
        if (gi + 1 < gens.length) loop(gi + 1, this.iterOf(this.eval(gens[gi + 1].iter, cf)));
        else if (isDict) out.push([this.eval(e.key, cf), this.eval(e.value, cf)]);
        else out.push(this.eval(e.elt, cf));
      }
    };
    loop(0, this.iterOf(this.eval(gens[0].iter, f)));
    return out;
  }
}

function isConstNode(n) {
  if (!n) return false;
  if (n.type === 'Num' || n.type === 'Str' || n.type === 'Const') return true;
  if (n.type === 'Tuple') return n.elts.every(isConstNode);
  return false;
}
function toSet(items) { const s = new PySet(); for (const v of items) setAdd(s, v); return s; }
function counterOp(op, a, b) {
  const r = new PyDict(); r.kind = 'Counter';
  const keys = [];
  for (const e of a.m.values()) keys.push(e[0]);
  for (const e of b.m.values()) if (!dictHas(a, e[0])) keys.push(e[0]);
  for (const k of keys) {
    const x = dictGet(a, k) || 0, y = dictGet(b, k) || 0;
    let v;
    if (op === '+') v = iadd(x, y);
    else if (op === '-') v = isub(x, y);
    else if (op === '|') v = icmp(x, y) >= 0 ? x : y;
    else v = icmp(x, y) <= 0 ? x : y;
    if (icmp(v, 0) > 0) dictSet(r, k, v);
  }
  return r;
}
