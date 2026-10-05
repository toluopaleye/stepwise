// ===== PyRun public API =====

function tagSource(node, name) {
  if (Array.isArray(node)) { for (const x of node) tagSource(x, name); return; }
  if (!node || typeof node !== 'object' || Object.getPrototypeOf(node) !== Object.prototype) return;
  if (node.type === 'FunctionDef' || node.type === 'Lambda') node.src = name;
  for (const k in node) {
    if (k === 'scope' || k === 'cached') continue;
    const v = node[k];
    if (v && typeof v === 'object') tagSource(v, name);
  }
}

function withVM(vm, fn) {
  const prev = VM;
  VM = vm;
  try { return fn(); } finally { VM = prev; }
}

// The ^^^ / ~~^~~ marker line that CPython 3.13 prints under the failing part of a line.
function caretLine(text, loc, stmt, line) {
  if (!loc || loc.col === undefined || loc.line !== line || loc.endLine !== line) return null;
  const start = loc.col, end = Math.min(loc.endCol, text.length);
  if (end <= start) return null;
  if (stmt && stmt.value === loc && loc.type === 'Call' && (
    (stmt.type === 'Return' && loc.func.type === 'Name') ||
    (stmt.type === 'Assign' && stmt.targets.length === 1 && stmt.targets[0].type === 'Name'))) return null;
  let prim = null;
  if (loc.type === 'BinOp' && loc.left.endLine === line && loc.left.endCol !== undefined) {
    let k = loc.left.endCol;
    while (k < text.length && (/\s/.test(text[k]) || text[k] === ')')) k++;
    let b = k + 1;
    if (b < text.length && (loc.right.line > line || b < loc.right.col) && !/\s/.test(text[b]) && text[b] !== '\\' && text[b] !== '#') b++;
    prim = [k, b];
  } else if (loc.type === 'Subscript' && loc.value.endLine === line && loc.value.endCol !== undefined) {
    let k = loc.value.endCol;
    while (k < end && text[k] !== '[') k++;
    prim = [k, end];
  } else if (loc.type === 'Call' && loc.func.endLine === line && loc.func.endCol !== undefined) {
    let k = loc.func.endCol;
    while (k < end && text[k] !== '(') k++;
    prim = [k, end];
  }
  if (!prim && !text.slice(0, start).trim() && !text.slice(end).trim()) return null;
  const indent = text.length - text.trimStart().length;
  let marks = '';
  for (let k = start; k < end; k++) marks += !prim || (k >= prim[0] && k < prim[1]) ? '^' : '~';
  return '    ' + ' '.repeat(Math.max(0, start - indent)) + marks;
}

Interp.prototype.describeError = function (e, filename) {
  if (e instanceof SyntaxErr) {
    const srcLines = this.sources.get(filename) || [];
    const lineText = srcLines[e.line - 1];
    let shown = '';
    if (lineText !== undefined) {
      shown = '    ' + lineText.trim() + '\n';
      if (e.col !== undefined && e.col !== null) {
        const indent = lineText.length - lineText.trimStart().length;
        const lineEnd = lineText.replace(/\s+$/, '').length;
        let end = e.endCol !== undefined && e.endCol !== null ? e.endCol : e.col + 1;
        if (end > lineEnd + 1) end = Math.max(e.col + 1, lineEnd);
        shown += '    ' + ' '.repeat(Math.max(0, e.col - indent)) + '^'.repeat(Math.max(1, end - e.col)) + '\n';
      }
    }
    return {
      type: e.kind, message: e.msg, line: e.line, file: filename, syntax: true,
      traceback: `  File "${filename}", line ${e.line}\n` + shown + `${e.kind}: ${e.msg}`,
    };
  }
  if (e instanceof StepLimit) {
    return {
      type: 'TimeoutError', timeout: true, line: this.currentLine(), file: filename,
      message: `stopped after ${this.limit.toLocaleString('en-US')} steps. A loop that never ends is the usual cause.`,
      traceback: `TimeoutError: stopped after ${this.limit.toLocaleString('en-US')} steps (is there a loop that never ends?)`,
    };
  }
  if (e instanceof PyThrow) {
    const exc = e.exc;
    const type = exc.cls.name;
    let msg;
    try { msg = withVM(this, () => pyStr(exc)); } catch (err) { msg = '<error while formatting message>'; }
    if (exc.suggestion) msg += exc.suggestion;
    const tb = e.tb && e.tb.length ? e.tb : [{ name: '<module>', line: this.currentLine(), src: filename }];
    const last = tb[tb.length - 1];
    const lines = ['Traceback (most recent call last):'];
    // CPython collapses runs of the same frame: after 3 repeats it prints "[Previous line repeated N more times]"
    let lastKey = null, count = 0;
    const flushRepeat = () => {
      if (count > 3) { const k = count - 3; lines.push(`  [Previous line repeated ${k} more time${k > 1 ? 's' : ''}]`); }
    };
    for (const fr of tb) {
      const file = fr.src || filename;
      const key = file + '\0' + fr.line + '\0' + fr.name;
      if (key !== lastKey) { flushRepeat(); lastKey = key; count = 0; }
      count++;
      if (count > 3) continue;
      lines.push(`  File "${file}", line ${fr.line}, in ${fr.name}`);
      const srcLines = this.sources.get(file);
      if (srcLines && srcLines[fr.line - 1] !== undefined) {
        const text = srcLines[fr.line - 1];
        lines.push('    ' + text.trim());
        const car = caretLine(text, fr.loc, fr.stmt, fr.line);
        if (car) lines.push(car);
      }
    }
    flushRepeat();
    lines.push(msg ? `${type}: ${msg}` : type);
    let userFrame = null;
    for (let i = tb.length - 1; i >= 0; i--) if ((tb[i].src || filename) === this.userFile) { userFrame = tb[i]; break; }
    return {
      type, message: msg, line: last.line, file: last.src || filename, frames: tb.map((x) => ({ name: x.name, line: x.line, src: x.src })), traceback: lines.join('\n'),
      userLine: userFrame ? userFrame.line : null, userFunc: userFrame ? userFrame.name : null,
      exc,
    };
  }
  if (e instanceof RangeError) {
    return { type: 'RecursionError', message: 'maximum recursion depth exceeded', line: this.currentLine(), file: filename, traceback: 'RecursionError: maximum recursion depth exceeded' };
  }
  return { type: 'InternalError', internal: true, message: String((e && e.stack) || e), line: this.currentLine(), file: filename, traceback: 'Runner error: ' + String((e && e.message) || e) };
};

Interp.prototype.runSource = function (src, filename) {
  filename = filename || this.filename;
  const prev = VM;
  VM = this;
  this.sources.set(filename, src.replace(/\r\n?/g, '\n').split('\n'));
  this.module.src = filename;
  this.module.line = 0;
  let error = null;
  try {
    const body = parseProgram(src);
    tagSource(body, filename);
    this.execBlock(body, this.module);
  } catch (e) {
    error = this.describeError(e, filename);
  } finally {
    VM = prev;
    this.callStack = [this.module];
    this.depth = 0;
    this.handling = [];
  }
  return { ok: !error, stdout: this.takeOut(), error, steps: this.steps };
};

// Runs statements; if the last statement is an expression, returns its value.
Interp.prototype.evalSource = function (src, filename) {
  filename = filename || '<test>';
  const prev = VM;
  VM = this;
  this.sources.set(filename, src.replace(/\r\n?/g, '\n').split('\n'));
  this.module.src = filename;
  let error = null, value = NONE;
  try {
    const body = parseProgram(src);
    tagSource(body, filename);
    const last = body[body.length - 1];
    if (last && last.type === 'Expr') {
      this.execBlock(body.slice(0, -1), this.module);
      this.module.line = last.line;
      value = this.eval(last.value, this.module);
    } else this.execBlock(body, this.module);
  } catch (e) {
    error = this.describeError(e, filename);
  } finally {
    VM = prev;
    this.callStack = [this.module];
    this.depth = 0;
    this.handling = [];
  }
  return { ok: !error, value, stdout: this.takeOut(), error, steps: this.steps };
};

Interp.prototype.repr = function (v) { return withVM(this, () => repr(v)); };
Interp.prototype.str = function (v) { return withVM(this, () => pyStr(v)); };

function testEq(a, b) {
  if (isNumV(a) && isNumV(b) && (a instanceof PyFloat || b instanceof PyFloat)) {
    const x = fval(a), y = fval(b);
    if (x === y) return true;
    if (Number.isNaN(x) && Number.isNaN(y)) return true;
    return Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));
  }
  if ((a instanceof PyList && b instanceof PyList) || (a instanceof PyTuple && b instanceof PyTuple)) {
    if (a.a.length !== b.a.length) return false;
    for (let i = 0; i < a.a.length; i++) if (!testEq(a.a[i], b.a[i])) return false;
    return true;
  }
  if (a instanceof PyDict && b instanceof PyDict) {
    if (a.m.size !== b.m.size) return false;
    for (const [h, e] of a.m) { const o = b.m.get(h); if (!o || !testEq(e[1], o[1])) return false; }
    return true;
  }
  return pyEq(a, b);
}

Interp.prototype.equalsValue = function (a, b) { return withVM(this, () => testEq(a, b)); };

function classifyGrowth(points) {
  const pts = points.filter((p) => p.steps > 0);
  if (pts.length < 2) return null;
  const steps = pts.map((p) => p.steps);
  const mx = Math.max(...steps), mn = Math.min(...steps);
  if (mx / mn < 1.25) return 'O(1)';
  const a = pts[pts.length - 2], b = pts[pts.length - 1];
  const e = Math.log(b.steps / a.steps) / Math.log(b.n / a.n);
  if (e < 0.3) return 'O(log n)';
  if (e < 1.12) return 'O(n)';
  if (e < 1.55) return 'O(n log n)';
  if (e < 2.5) return 'O(n²)';
  return 'O(n³)';
}
const GROWTH_RANK = { 'O(1)': 0, 'O(log n)': 1, 'O(n)': 2, 'O(n log n)': 3, 'O(n²)': 4, 'O(n³)': 5, 'too slow': 6 };

const PyRun = {
  Interp,
  NONE,
  version: '1.0',
  run(src, opts) {
    const vm = new Interp(opts);
    vm.userFile = (opts && opts.filename) || 'main.py';
    const r = vm.runSource(src, vm.userFile);
    r.vm = vm;
    return r;
  },
  // Load user code, then run each test: {code, expect} where expect is a Python literal (repr from CPython)
  runTests(userSrc, tests, opts) {
    opts = opts || {};
    const vm = new Interp({ stepLimit: opts.loadLimit || 2000000, filename: 'solution.py' });
    vm.userFile = 'solution.py';
    if (opts.pre) {
      const pre = vm.runSource(opts.pre, 'setup.py');
      if (!pre.ok) return { load: { ok: false, stdout: '', error: pre.error }, results: [], passed: false, vm };
      vm.takeOut();
      vm.steps = 0;
    }
    const load = vm.runSource(userSrc, 'solution.py');
    const results = [];
    if (load.ok) {
      for (const t of tests) {
        vm.steps = 0;
        vm.limit = opts.testLimit || 2000000;
        const r = vm.evalSource(t.code, 'test');
        const res = { code: t.code, expectRepr: t.expect, stdout: r.stdout, ok: false, steps: r.steps };
        if (!r.ok) res.error = r.error;
        else {
          res.gotRepr = vm.repr(r.value);
          vm.steps = 0;
          vm.limit = 1e9;
          const ev = vm.evalSource(t.expect, 'expected');
          if (!ev.ok) res.error = { type: 'InternalError', message: 'bad expected value ' + t.expect };
          else res.ok = vm.equalsValue(r.value, ev.value);
        }
        results.push(res);
      }
    }
    return { load, results, passed: load.ok && results.every((r) => r.ok), vm };
  },
  // Measure step counts for growing n. spec: {setup, call, sizes, maxSteps}
  speedCheck(vm, spec) {
    const points = [];
    let exceeded = null;
    for (const n of spec.sizes) {
      vm.globals.set('n', n);
      vm.steps = 0;
      vm.limit = 5e7;
      const s = vm.evalSource(spec.setup, 'speed-setup');
      if (!s.ok) return { error: s.error, points };
      vm.steps = 0;
      vm.limit = spec.maxSteps || 3000000;
      const r = vm.evalSource(spec.call, 'speed');
      if (!r.ok) {
        if (r.error && r.error.timeout) { exceeded = n; break; }
        return { error: r.error, points };
      }
      points.push({ n, steps: r.steps });
    }
    let growth = classifyGrowth(points);
    if (exceeded !== null && (!growth || GROWTH_RANK[growth] < 4)) growth = growth ? growth : 'too slow';
    if (exceeded !== null && points.length < 2) growth = 'too slow';
    return { points, exceeded, growth };
  },
  growthRank(g) { return GROWTH_RANK[g] === undefined ? 9 : GROWTH_RANK[g]; },
  parseCheck(src) {
    try { parseProgram(src); return null; }
    catch (e) { if (e instanceof SyntaxErr) return { type: e.kind, message: e.msg, line: e.line }; throw e; }
  },
};
