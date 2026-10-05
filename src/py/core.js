// ===== PyRun core: tokenizer, parser, scope analysis =====

class SyntaxErr {
  constructor(kind, msg, line, col, endCol) { this.kind = kind; this.msg = msg; this.line = line; this.col = col; this.endCol = endCol; }
}

const KEYWORDS = new Set(['False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield']);
const OPERATORS = ['**=', '//=', '>>=', '<<=', '...', '->', ':=', '**', '//', '>>', '<<', '<=', '>=', '==', '!=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '@=', '+', '-', '*', '/', '%', '@', '&', '|', '^', '~', '<', '>', '(', ')', '[', ']', '{', '}', ',', ':', '.', ';', '='];
const AUG_OPS = new Set(['+=', '-=', '*=', '/=', '//=', '%=', '**=', '>>=', '<<=', '&=', '|=', '^=', '@=']);

const isIdStart = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || (c > '\u007f' && /\p{L}/u.test(c));
const isIdChar = (c) => isIdStart(c) || (c >= '0' && c <= '9') || (c > '\u007f' && /[\p{L}\p{N}]/u.test(c));
const isDigit = (c) => c >= '0' && c <= '9';

function unescapePy(s) {
  if (s.indexOf('\\') < 0) return s;
  return s.replace(/\\(\n|\\|'|"|a|b|f|n|r|t|v|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|[0-7]{1,3}|.)/g, (m, e) => {
    switch (e[0]) {
      case '\n': return '';
      case '\\': return '\\';
      case "'": return "'";
      case '"': return '"';
      case 'a': return '\x07';
      case 'b': return '\b';
      case 'f': return '\f';
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      case 'v': return '\v';
      case 'x': return String.fromCharCode(parseInt(e.slice(1), 16));
      case 'u': case 'U': return String.fromCodePoint(parseInt(e.slice(1), 16));
      default:
        if (/^[0-7]+$/.test(e)) return String.fromCharCode(parseInt(e, 8));
        return m;
    }
  });
}

function tokenize(src, lineOffset, colOffset) {
  src = src.replace(/\r\n?/g, '\n');
  if (!src.endsWith('\n')) src += '\n';
  const n = src.length, toks = [], indents = [0], brackets = [];
  let pos = 0, line = 1 + (lineOffset || 0), bol = true, deferred = null;
  const err = (msg, ln, kind, col, endCol) => { throw new SyntaxErr(kind || 'SyntaxError', msg, ln || line, col, endCol); };
  const colOf = (p) => { const ls = p > 0 ? src.lastIndexOf('\n', p - 1) + 1 : 0; return p - ls + (ls === 0 ? (colOffset || 0) : 0); };

  function readString(prefix, p) {
    const raw = prefix.indexOf('r') >= 0, isF = prefix.indexOf('f') >= 0;
    const startCol = colOf(p - prefix.length);
    if (prefix.indexOf('b') >= 0) err('bytes literals are not supported in this runner');
    const q = src[p];
    const triple = src.startsWith(q + q + q, p);
    const closer = triple ? q + q + q : q;
    let i = p + closer.length;
    const startLine = line;
    let body = '';
    const what = isF ? 'f-string' : 'string';
    const unterminated = (msg) => {
      const e = new SyntaxErr('SyntaxError', msg, startLine, startCol);
      if (isF) throw { deferredF: e };
      throw e;
    };
    // f-strings follow PEP 701 (Python 3.12+): inside a replacement field, quotes start nested strings (even the
    // f-string's own quote) and newlines are allowed; only a literal part can end the f-string.
    const fstack = isF ? ['lit'] : null;
    for (;;) {
      if (i >= n) {
        if (triple) unterminated(`unterminated triple-quoted ${what} literal (detected at line ${line})`);
        unterminated(`unterminated ${what} literal (detected at line ${startLine})`);
      }
      const ch = src[i];
      const top = fstack ? fstack[fstack.length - 1] : 'lit';
      if (typeof top === 'object') {
        if (ch === "'" || ch === '"') {
          const tq = src.startsWith(ch + ch + ch, i), cl = tq ? ch + ch + ch : ch;
          const nl = line, nc = colOf(i);
          let k = i + cl.length;
          for (;;) {
            if (k >= n || (src[k] === '\n' && !tq)) {
              // CPython: an unterminated string that starts with the f-string's own quote means a missing '}'
              if (cl === closer) throw { deferredF: new SyntaxErr('SyntaxError', "f-string: expecting '}'", nl, nc, nc + 1) };
              throw { deferredF: new SyntaxErr('SyntaxError', `unterminated ${tq ? 'triple-quoted ' : ''}string literal (detected at line ${tq ? line : nl})`, nl, nc) };
            }
            if (src[k] === '\\') { if (src[k + 1] === '\n') line++; k += 2; continue; }
            if (src.startsWith(cl, k)) { k += cl.length; break; }
            if (src[k] === '\n') line++;
            k++;
          }
          body += src.slice(i, k);
          i = k;
          continue;
        }
        if (ch === '\n') line++;
        else if (ch === '(' || ch === '[' || ch === '{') top.d++;
        else if (ch === ')' || ch === ']') {
          if (top.d === 0) throw { deferredF: new SyntaxErr('SyntaxError', `f-string: unmatched '${ch}'`, line, colOf(i), colOf(i) + 1) };
          top.d--;
        }
        else if (ch === '}') { if (top.d > 0) top.d--; else fstack.pop(); }
        else if (ch === ':' && top.d === 0) fstack[fstack.length - 1] = 'spec';
        body += ch;
        i++;
        continue;
      }
      if (fstack && ch === '{') {
        if (top === 'lit' && src[i + 1] === '{') { body += '{{'; i += 2; continue; }
        fstack.push({ d: 0 });
        body += ch;
        i++;
        continue;
      }
      if (fstack && ch === '}' && top === 'spec') { fstack.pop(); body += ch; i++; continue; }
      if (ch === '\\') {
        const nx = src[i + 1];
        if (nx === '\n') line++;
        body += ch + (nx === undefined ? '' : nx);
        i += 2;
        continue;
      }
      if (ch === '\n') {
        if (!triple) unterminated(`unterminated ${what} literal (detected at line ${startLine})`);
        line++;
        body += ch;
        i++;
        continue;
      }
      if (src.startsWith(closer, i)) { i += closer.length; break; }
      body += ch;
      i++;
    }
    const tok = { type: 'STRING', line: startLine };
    if (isF) {
      try { tok.fparts = parseFString(body, raw, startLine, triple ? undefined : startCol + prefix.length + 1); } catch (e) {
        if (!(e instanceof SyntaxErr)) throw e;
        // CPython: a tokenizer error inside an f-string stops tokenizing but never overrides an earlier parser
        // error, so it behaves like an error token; parser errors in the f-string surface when it is parsed.
        if (e.ftok) throw { deferredF: e };
        tok.ferr = e; tok.fparts = [];
      }
    }
    else tok.value = raw ? body : unescapePy(body);
    return { tok, end: i };
  }

  while (pos < n) {
    if (bol) {
      let col = 0, p = pos;
      for (; p < n; p++) {
        const c = src[p];
        if (c === ' ') col++;
        else if (c === '\t') col = (Math.floor(col / 8) + 1) * 8;
        else if (c === '\f') col = 0;
        else break;
      }
      if (p >= n) { pos = p; break; }
      const c = src[p];
      if (c === '\n') { pos = p + 1; line++; continue; }
      if (c === '#') { while (p < n && src[p] !== '\n') p++; pos = p; continue; }
      if (brackets.length === 0) {
        const top = indents[indents.length - 1];
        if (col > top) { indents.push(col); toks.push({ type: 'INDENT', line }); }
        else if (col < top) {
          let k = indents.length - 1;
          while (col < indents[k]) k--;
          if (col !== indents[k]) {
            // like CPython: the tokenizer stops here with an error token. The parser raises it only if it gets this
            // far; an earlier parser error wins, and nothing after this point is tokenized.
            const le = src.indexOf('\n', p);
            deferred = new SyntaxErr('IndentationError', 'unindent does not match any outer indentation level', line, colOf(le < 0 ? n : le));
            break;
          }
          while (indents.length - 1 > k) { indents.pop(); toks.push({ type: 'DEDENT', line }); }
        }
      }
      pos = p;
      bol = false;
    }
    const c = src[pos];
    if (c === '\n') {
      if (brackets.length === 0) { toks.push({ type: 'NEWLINE', line, col: colOf(pos), endLine: line, endCol: colOf(pos) + 1 }); bol = true; }
      pos++; line++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\f') { pos++; continue; }
    if (c === '#') { while (pos < n && src[pos] !== '\n') pos++; continue; }
    if (c === '\\') {
      if (src[pos + 1] === '\n') { pos += 2; line++; continue; }
      err('unexpected character after line continuation character');
    }
    if (isIdStart(c)) {
      let p = pos + 1;
      while (p < n && isIdChar(src[p])) p++;
      const word = src.slice(pos, p);
      const q = src[p];
      if ((q === '"' || q === "'") && /^(r|u|f|b|rb|br|fr|rf)$/i.test(word)) {
        let res;
        try { res = readString(word.toLowerCase(), p); } catch (x) { if (x && x.deferredF) { deferred = x.deferredF; break; } throw x; }
        res.tok.col = colOf(pos); res.tok.endLine = line; res.tok.endCol = colOf(res.end);
        toks.push(res.tok);
        pos = res.end;
        continue;
      }
      toks.push({ type: KEYWORDS.has(word) ? 'KW' : 'NAME', value: word, line, col: colOf(pos), endLine: line, endCol: colOf(p) });
      pos = p;
      continue;
    }
    if (isDigit(c) || (c === '.' && isDigit(src[pos + 1] || ''))) {
      let p = pos, isFloat = false, value;
      if (c === '0' && /[xXoObB]/.test(src[pos + 1] || '')) {
        p = pos + 2;
        while (p < n && /[0-9a-fA-F_]/.test(src[p])) p++;
        const text = src.slice(pos, p).replace(/_/g, '');
        try { value = BigInt(text); } catch (e) { err('invalid ' + (/[xX]/.test(text[1]) ? 'hexadecimal' : /[oO]/.test(text[1]) ? 'octal' : 'binary') + ' literal'); }
        value = normInt(value);
      } else {
        while (p < n && (isDigit(src[p]) || src[p] === '_')) p++;
        if (src[p] === '.' && src[p + 1] !== '.' && !isIdStart(src[p + 1] || ' ')) {
          isFloat = true;
          p++;
          while (p < n && (isDigit(src[p]) || src[p] === '_')) p++;
        }
        if ((src[p] === 'e' || src[p] === 'E') && (isDigit(src[p + 1] || '') || ((src[p + 1] === '+' || src[p + 1] === '-') && isDigit(src[p + 2] || '')))) {
          isFloat = true;
          p += 2;
          while (p < n && (isDigit(src[p]) || src[p] === '_')) p++;
        }
        if (src[p] === 'j' || src[p] === 'J') err('complex numbers are not supported in this runner');
        const text = src.slice(pos, p).replace(/_/g, '');
        if (isFloat) value = parseFloat(text);
        else {
          if (text.length > 1 && text[0] === '0' && /[1-9]/.test(text)) err('leading zeros in decimal integer literals are not permitted; use an 0o prefix for octal integers', line, undefined, colOf(pos));
          value = text.length > 15 ? normInt(BigInt(text)) : Number(text);
        }
      }
      if (p < n && isIdStart(src[p])) err('invalid decimal literal', line, undefined, colOf(p - 1));
      toks.push({ type: 'NUMBER', value, isFloat, line, col: colOf(pos), endLine: line, endCol: colOf(p) });
      pos = p;
      continue;
    }
    if (c === '"' || c === "'") {
      const startPos = pos;
      const res = readString('', pos);
      res.tok.col = colOf(startPos); res.tok.endLine = line; res.tok.endCol = colOf(res.end);
      toks.push(res.tok);
      pos = res.end;
      continue;
    }
    let op = null;
    for (const o of OPERATORS) { if (src.startsWith(o, pos)) { op = o; break; } }
    if (!op) {
      // CPython tokenizes these as operator tokens that no grammar rule accepts, so the PARSER reports them
      // (in source order with other parser errors), unlike real tokenizer errors such as invalid characters.
      if (c === '!' || c === '$' || c === '?' || c === '`') {
        toks.push({ type: 'OP', value: c, bad: true, line, col: colOf(pos), endLine: line, endCol: colOf(pos) + 1 });
        pos++;
        continue;
      }
      err(`invalid character '${c}' (U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')})`);
    }
    if (op === '(' || op === '[' || op === '{') brackets.push({ op, line, col: colOf(pos) });
    else if (op === ')' || op === ']' || op === '}') {
      const open = brackets.pop();
      if (!open) err(`unmatched '${op}'`, line, undefined, colOf(pos));
      const want = { '(': ')', '[': ']', '{': '}' }[open.op];
      if (want !== op) err(`closing parenthesis '${op}' does not match opening parenthesis '${open.op}'` + (open.line !== line ? ` on line ${open.line}` : ''), line, undefined, colOf(pos));
    }
    toks.push({ type: 'OP', value: op, line, col: colOf(pos), endLine: line, endCol: colOf(pos) + op.length });
    pos += op.length;
  }
  if (deferred) {
    toks.push({ type: 'ERRORTOKEN', err: deferred, line: deferred.line });
    toks.push({ type: 'EOF', line: deferred.line, eofish: true });
    return toks;
  }
  let unclosed = null;
  if (brackets.length) { const b = brackets[brackets.length - 1]; unclosed = new SyntaxErr('SyntaxError', `'${b.op}' was never closed`, b.line, b.col); }
  const last = toks[toks.length - 1];
  if (last && last.type !== 'NEWLINE' && last.type !== 'DEDENT') toks.push({ type: 'NEWLINE', line, eofish: true });
  while (indents.length > 1) { indents.pop(); toks.push({ type: 'DEDENT', line, eofish: true }); }
  toks.push({ type: 'EOF', line, eofish: true });
  if (unclosed) toks.unclosed = unclosed;
  return toks;
}

// baseCol: source column of body[0] (single-line f-strings), so errors get CPython's caret.
// Errors marked ftok are raised by CPython's tokenizer (they win over any parser error); the rest are parser
// errors, which the tokenizer stores on the token so they surface in source order.
function parseFString(body, raw, ln, baseCol) {
  const parts = [];
  let lit = '', i = 0;
  const fail = (m, at, ftok) => {
    const col = baseCol !== undefined && at !== undefined ? baseCol + at : undefined;
    const e = new SyntaxErr('SyntaxError', 'f-string: ' + m, ln, col, col !== undefined ? col + 1 : undefined);
    if (ftok) e.ftok = true;
    throw e;
  };
  const flush = () => { if (lit) { parts.push({ s: raw ? lit : unescapePy(lit) }); lit = ''; } };
  while (i < body.length) {
    const ch = body[i];
    if (ch === '{') {
      if (body[i + 1] === '{') { lit += '{'; i += 2; continue; }
      flush();
      let j = i + 1, depth = 0, quote = null, exprEnd = -1, conv = null, specStart = -1, closeAt = -1;
      for (; j < body.length; j++) {
        const c = body[j];
        if (quote) { if (c === quote) quote = null; continue; }
        if (c === "'" || c === '"') { quote = c; continue; }
        if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']') depth--;
        else if (c === '}') { if (depth > 0) depth--; else { exprEnd = j; closeAt = j; break; } }
        else if (depth === 0 && c === '!' && body[j + 1] !== '=') {
          exprEnd = j;
          if (!body.slice(i + 1, j).trim()) fail("valid expression required before '!'", j);
          conv = /^\w*/.exec(body.slice(j + 1))[0];
          if (!conv) fail('missing conversion character', j + 1);
          if (!/^[rsa]$/.test(conv)) fail(`invalid conversion character '${conv}': expected 's', 'r', or 'a'`, j + 1);
          j += 1 + conv.length;
          if (body[j] === ':') specStart = j + 1;
          else if (body[j] === '}') closeAt = j;
          else fail("expecting '}'", j);
          break;
        } else if (depth === 0 && c === ':') { exprEnd = j; specStart = j + 1; break; }
      }
      if (exprEnd < 0) fail("expecting '}'", body.length);
      let exprSrc = body.slice(i + 1, exprEnd);
      let spec = null;
      if (specStart >= 0) {
        let d = 0, k = specStart;
        for (; k < body.length; k++) {
          if (body[k] === '{') d++;
          else if (body[k] === '}') { if (d === 0) break; d--; }
        }
        if (k >= body.length) fail("expecting '}'", body.length);
        spec = parseFString(body.slice(specStart, k), raw, ln, baseCol !== undefined ? baseCol + specStart : undefined);
        closeAt = k;
      }
      let eq = false;
      const trimmed = exprSrc.replace(/\s+$/, '');
      if (trimmed.endsWith('=') && !/[=!<>]=$/.test(trimmed) && trimmed.length > 1) {
        eq = true;
        parts.push({ s: exprSrc });
        exprSrc = trimmed.slice(0, -1);
      }
      if (!exprSrc.trim()) fail(`valid expression required before '${body[exprEnd]}'`, exprEnd);
      const expr = parseExpressionSource(exprSrc, ln, baseCol !== undefined ? baseCol + i + 1 : undefined);
      parts.push({ expr, conv: conv || (eq && !spec ? 'r' : null), spec });
      i = closeAt + 1;
      continue;
    }
    if (ch === '}') {
      if (body[i + 1] === '}') { lit += '}'; i += 2; continue; }
      fail("single '}' is not allowed", i, true);
    }
    lit += ch;
    i++;
  }
  flush();
  return parts;
}

// Parse the expression part of an f-string replacement field. col0 = source column of src[0] when the f-string
// is on one line: then nodes get real source positions (runtime error carets point inside the f-string).
function parseExpressionSource(src, ln, col0) {
  const flat = src.replace(/\n/g, ' ');
  const parse = (text) => {
    const p = new Parser(tokenize('(' + text + '\n)', (ln || 1) - 1, col0 !== undefined ? col0 - 1 : undefined));
    p.noPos = col0 === undefined;
    return p.parseTestList();
  };
  try {
    return parse(flat);
  } catch (e) {
    if (!(e instanceof SyntaxErr)) throw e;
    if (e.line !== ln || col0 === undefined) { e.col = undefined; e.endCol = undefined; }
    e.line = ln;
    if (e.msg === 'invalid syntax') {
      // like CPython: the longest prefix that is a whole expression, then "expecting ..." at the next token
      e.msg = "f-string: expecting '=', or '!', or ':', or '}'";
      e.col = undefined; e.endCol = undefined;
      if (col0 !== undefined) {
        let toks = [];
        try { toks = tokenize(flat, (ln || 1) - 1, col0).filter((t) => t.col !== undefined && t.type !== 'NEWLINE'); } catch (e2) { toks = []; }
        for (let k = toks.length - 1; k >= 1; k--) {
          try { parse(flat.slice(0, toks[k].col - col0)); } catch (e3) { continue; }
          e.col = toks[k].col; e.endCol = toks[k].endCol;
          break;
        }
      }
    }
    throw e;
  }
}

class Parser {
  constructor(toks) { this.toks = toks; this.i = 0; }
  get tok() { const t = this.toks[this.i]; if (t.type === 'ERRORTOKEN') throw t.err; if (t.eofish && this.toks.unclosed) throw this.toks.unclosed; return t; }
  peekTok(k = 1) { return this.toks[Math.min(this.i + k, this.toks.length - 1)]; }
  advance() { return this.toks[this.i++]; }
  isOp(v) { const t = this.toks[this.i]; return t.type === 'OP' && t.value === v; }
  isKw(v) { const t = this.toks[this.i]; return t.type === 'KW' && t.value === v; }
  eatOp(v) { return this.isOp(v) ? this.advance() : null; }
  eatKw(v) { return this.isKw(v) ? this.advance() : null; }
  error(msg, tok, kind, col, endCol) {
    const cur = this.toks[this.i];
    if (cur && cur.type === 'ERRORTOKEN') throw cur.err;  // the parser reached the tokenizer's error token
    const t = tok || this.tok;
    const c = col !== undefined ? col : (this.noPos ? undefined : t.col);
    const ec = endCol !== undefined ? endCol : (col !== undefined ? undefined : t.endCol);
    throw new SyntaxErr(kind || 'SyntaxError', msg || 'invalid syntax', t.line, c, ec);
  }
  // record a node's source span: from token st to the last token consumed
  pos(node, st) {
    if (this.noPos || !st || st.col === undefined || !node || typeof node !== 'object') return node;
    const et = this.toks[this.i - 1];
    if (!et || et.endCol === undefined) return node;
    node.col = st.col; node.endLine = et.endLine; node.endCol = et.endCol;
    return node;
  }
  expectedColon(forced) {
    const t = this.toks[this.i];
    if (!forced && t.type !== 'NEWLINE') this.error('invalid syntax');
    this.error("expected ':'", t, undefined, t.col, t.type === 'NEWLINE' || t.endCol === undefined ? (t.col !== undefined ? t.col + 1 : undefined) : t.endCol);
  }
  expectOp(v, msg) { if (!this.isOp(v)) { if (!msg && v === ':') this.expectedColon(); this.error(msg || 'invalid syntax'); } return this.advance(); }
  expectName() { const t = this.tok; if (t.type !== 'NAME') this.error('invalid syntax'); this.advance(); return t.value; }
  atStmtEnd() { const t = this.tok; return t.type === 'NEWLINE' || t.type === 'EOF' || (t.type === 'OP' && t.value === ';'); }

  parseFile() {
    const body = [];
    while (this.tok.type !== 'EOF') {
      if (this.tok.type === 'NEWLINE') { this.advance(); continue; }
      if (this.tok.type === 'INDENT') this.error('unexpected indent', null, 'IndentationError', null);
      if (this.tok.type === 'DEDENT') { this.advance(); continue; }
      for (const s of this.parseStatement()) body.push(s);
    }
    return body;
  }

  parseStatement() {
    const t = this.tok;
    if (t.type === 'KW') {
      switch (t.value) {
        case 'if': return [this.parseIf()];
        case 'while': return [this.parseWhile()];
        case 'for': return [this.parseFor()];
        case 'try': return [this.parseTry()];
        case 'def': return [this.parseDef([])];
        case 'class': return [this.parseClass([])];
        case 'with': this.error("'with' blocks aren't supported in this runner");
        case 'async': this.error("async code isn't supported in this runner");
        case 'elif': case 'else': case 'except': case 'finally': this.error('invalid syntax');
      }
    }
    if (this.isOp('@')) return [this.parseDecorated()];
    return this.parseSimpleLine();
  }

  parseSimpleLine() {
    const stmts = [this.parseSmall()];
    while (this.eatOp(';')) {
      if (this.tok.type === 'NEWLINE' || this.tok.type === 'EOF') break;
      stmts.push(this.parseSmall());
    }
    if (this.tok.type !== 'NEWLINE' && this.tok.type !== 'EOF') {
      const prev = this.toks[this.i - 1];
      const t = this.tok;
      if (prev && prev.type === 'NAME' && prev.value === 'print' && stmts.length === 1 && stmts[0].type === 'Expr' && stmts[0].value.type === 'Name') {
        let k = this.i;
        while (this.toks[k + 1] && this.toks[k + 1].type !== 'NEWLINE' && this.toks[k + 1].type !== 'EOF') k++;
        this.error("Missing parentheses in call to 'print'. Did you mean print(...)?", prev, undefined, prev.col, this.toks[k].endCol);
      }
      if (t.type === 'OP' && t.value === '=') this.error('invalid syntax');
      if (t.type === 'NAME' || t.type === 'NUMBER' || t.type === 'STRING') this.error('invalid syntax');
      this.error('invalid syntax');
    }
    if (this.tok.type === 'NEWLINE') this.advance();
    return stmts;
  }

  maybeEq(test) {
    const eqTok = this.tok;
    this.advance();
    let endCol = eqTok.endCol;
    try { const v = this.parseTest(); if (v && v.endCol !== undefined && v.endLine === eqTok.line) endCol = v.endCol; } catch (e) { /* keep the '=' span */ }
    this.error("invalid syntax. Maybe you meant '==' or ':=' instead of '='?", eqTok, undefined, test.col !== undefined ? test.col : eqTok.col, endCol);
  }

  parseBlock(kind, headerLine) {
    if (!this.isOp(':')) this.expectedColon(/^(function definition|'try' statement|'finally' statement|'else' statement)$/.test(kind));
    this.advance();
    if (this.tok.type === 'NEWLINE') {
      this.advance();
      if (this.tok.type !== 'INDENT') this.error(`expected an indented block after ${kind} on line ${headerLine}`, null, 'IndentationError');
      this.advance();
      const body = [];
      while (this.tok.type !== 'DEDENT' && this.tok.type !== 'EOF') {
        if (this.tok.type === 'NEWLINE') { this.advance(); continue; }
        if (this.tok.type === 'INDENT') this.error('unexpected indent', null, 'IndentationError', null);
        for (const s of this.parseStatement()) body.push(s);
      }
      if (this.tok.type === 'DEDENT') this.advance();
      return body;
    }
    if (this.tok.type === 'EOF') this.error(`expected an indented block after ${kind} on line ${headerLine}`, null, 'IndentationError');
    return this.parseSimpleLine();
  }

  parseIf() {
    const line = this.tok.line;
    const kw = this.advance().value;
    const test = this.parseNamedTest();
    if (this.isOp('=')) this.maybeEq(test);
    const body = this.parseBlock(`'${kw}' statement`, line);
    let orelse = [];
    if (this.isKw('elif')) orelse = [this.parseIf()];
    else if (this.isKw('else')) { const l2 = this.advance().line; orelse = this.parseBlock("'else' statement", l2); }
    return { type: 'If', test, body, orelse, line };
  }

  parseWhile() {
    const line = this.advance().line;
    const test = this.parseNamedTest();
    if (this.isOp('=')) this.maybeEq(test);
    const body = this.parseBlock("'while' statement", line);
    let orelse = [];
    if (this.isKw('else')) { const l2 = this.advance().line; orelse = this.parseBlock("'else' statement", l2); }
    return { type: 'While', test, body, orelse, line };
  }

  parseFor() {
    const line = this.advance().line;
    const tgt = this.parseExprList();
    if (!this.eatKw('in')) this.error("invalid syntax. Did you forget 'in'?");
    const iter = this.parseTestListStar();
    const body = this.parseBlock("'for' statement", line);
    let orelse = [];
    if (this.isKw('else')) { const l2 = this.advance().line; orelse = this.parseBlock("'else' statement", l2); }
    return { type: 'For', target: this.toTarget(tgt, 'for'), iter, body, orelse, line };
  }

  parseTry() {
    const line = this.advance().line;
    const body = this.parseBlock("'try' statement", line);
    const handlers = [];
    let orelse = [], finalbody = [];
    while (this.isKw('except')) {
      const hl = this.advance().line;
      let typ = null, name = null;
      if (!this.isOp(':')) {
        typ = this.parseTest();
        if (this.eatKw('as')) name = this.expectName();
      }
      const hbody = this.parseBlock("'except' statement", hl);
      handlers.push({ typ, name, body: hbody, line: hl });
    }
    if (handlers.length && this.isKw('else')) { const l2 = this.advance().line; orelse = this.parseBlock("'else' statement", l2); }
    if (this.isKw('finally')) { const l3 = this.advance().line; finalbody = this.parseBlock("'finally' statement", l3); }
    if (!handlers.length && !finalbody.length) this.error("expected 'except' or 'finally' block");
    return { type: 'Try', body, handlers, orelse, finalbody, line };
  }

  parseDef(decorators) {
    const line = this.advance().line;
    const name = this.expectName();
    if (!this.isOp('(')) this.error("expected '('");
    this.advance();
    const params = this.parseParams(')', true);
    this.expectOp(')');
    if (this.eatOp('->')) this.parseTest();
    const body = this.parseBlock(`function definition`, line);
    return { type: 'FunctionDef', name, params, body, decorators, line };
  }

  parseParams(closer, allowAnn) {
    const params = [];
    let seenDefault = false, kwOnly = false;
    const names = new Set();
    const addName = (nm) => { if (names.has(nm)) this.error(`duplicate argument '${nm}' in function definition`); names.add(nm); };
    while (!this.isOp(closer)) {
      if (this.eatOp('*')) {
        if (this.isOp(',') || this.isOp(closer)) kwOnly = true;
        else {
          const nm = this.expectName(); addName(nm);
          if (allowAnn && this.eatOp(':')) this.parseTest();
          params.push({ name: nm, kind: 'vararg' });
          kwOnly = true;
        }
      } else if (this.eatOp('**')) {
        const nm = this.expectName(); addName(nm);
        if (allowAnn && this.eatOp(':')) this.parseTest();
        params.push({ name: nm, kind: 'kwarg' });
      } else if (this.eatOp('/')) {
        // positional-only marker: ignored
      } else {
        const nameTok = this.tok;
        const nm = this.expectName(); addName(nm);
        if (allowAnn && this.eatOp(':')) this.parseTest();
        let def = null;
        if (this.eatOp('=')) { def = this.parseTest(); if (!kwOnly) seenDefault = true; }
        else if (seenDefault && !kwOnly) this.error('parameter without a default follows parameter with a default', nameTok);
        params.push({ name: nm, kind: kwOnly ? 'kwonly' : 'pos', def });
      }
      if (!this.eatOp(',')) break;
    }
    return params;
  }

  parseClass(decorators) {
    const line = this.advance().line;
    const name = this.expectName();
    let bases = [];
    if (this.eatOp('(')) {
      const a = this.parseArgs();
      bases = a.args;
      this.expectOp(')');
    }
    const body = this.parseBlock('class definition', line);
    return { type: 'ClassDef', name, bases, body, decorators, line };
  }

  parseDecorated() {
    const decorators = [];
    while (this.eatOp('@')) {
      decorators.push(this.parseNamedTest());
      if (this.tok.type !== 'NEWLINE') this.error();
      this.advance();
    }
    if (this.isKw('def')) return this.parseDef(decorators);
    if (this.isKw('class')) return this.parseClass(decorators);
    this.error();
  }

  parseDotted() {
    let name = this.expectName();
    while (this.eatOp('.')) name += '.' + this.expectName();
    return name;
  }

  parseImport() {
    const line = this.advance().line;
    if (this.atStmtEnd()) this.error("Expected one or more names after 'import'");
    const names = [];
    do {
      const mod = this.parseDotted();
      let as = null;
      if (this.eatKw('as')) as = this.expectName();
      names.push({ name: mod, asname: as });
    } while (this.eatOp(','));
    return { type: 'Import', names, line };
  }

  parseFromImport() {
    const line = this.advance().line;
    while (this.eatOp('.') || this.eatOp('...')) { /* relative import dots */ }
    const mod = this.parseDotted();
    if (!this.eatKw('import')) this.error('invalid syntax');
    const names = [];
    if (this.eatOp('*')) names.push({ name: '*' });
    else {
      const paren = this.eatOp('(');
      do {
        if (paren && this.isOp(')')) break;
        const nm = this.expectName();
        let as = null;
        if (this.eatKw('as')) as = this.expectName();
        names.push({ name: nm, asname: as });
      } while (this.eatOp(','));
      if (paren) this.expectOp(')');
    }
    return { type: 'ImportFrom', module: mod, names, line };
  }

  parseSmall() {
    const st = this.tok;
    const node = this.parseSmall0();
    return this.pos(node, st);
  }

  parseSmall0() {
    const t = this.tok, line = t.line;
    if (t.type === 'KW') {
      switch (t.value) {
        case 'pass': this.advance(); return { type: 'Pass', line };
        case 'break': this.advance(); return { type: 'Break', line };
        case 'continue': this.advance(); return { type: 'Continue', line };
        case 'return': {
          this.advance();
          let value = null;
          if (!this.atStmtEnd()) value = this.parseTestListStar();
          return { type: 'Return', value, line };
        }
        case 'raise': {
          this.advance();
          let exc = null, cause = null;
          if (!this.atStmtEnd()) { exc = this.parseTest(); if (this.eatKw('from')) cause = this.parseTest(); }
          return { type: 'Raise', exc, cause, line };
        }
        case 'global': case 'nonlocal': {
          this.advance();
          const names = [this.expectName()];
          while (this.eatOp(',')) names.push(this.expectName());
          return { type: t.value === 'global' ? 'Global' : 'Nonlocal', names, line };
        }
        case 'del': {
          this.advance();
          const tg = this.parseExprList();
          const list = tg.type === 'Tuple' ? tg.elts : [tg];
          return { type: 'Delete', targets: list.map((x) => this.toTarget(x, 'del')), line };
        }
        case 'assert': {
          this.advance();
          const test = this.parseTest();
          let msg = null;
          if (this.eatOp(',')) msg = this.parseTest();
          return { type: 'Assert', test, msg, line };
        }
        case 'import': return this.parseImport();
        case 'from': return this.parseFromImport();
        case 'yield': this.error("'yield' isn't supported in this runner (generators aren't available here)");
      }
    }
    const first = this.parseTestListStar();
    if (this.tok.type === 'OP') {
      const op = this.tok.value;
      if (AUG_OPS.has(op)) {
        this.advance();
        const target = this.toTarget(first, 'aug');
        const value = this.parseTestList();
        return { type: 'AugAssign', target, op: op.slice(0, -1), value, line };
      }
      if (op === ':') {
        this.advance();
        this.parseTest();
        let value = null;
        if (this.eatOp('=')) value = this.parseTestListStar();
        return { type: 'AnnAssign', target: this.toTarget(first, 'assign'), value, line };
      }
      if (op === '=') {
        const parts = [first];
        while (this.eatOp('=')) {
          if (this.isOp('=')) this.error('invalid syntax');
          if (this.atStmtEnd()) this.error('invalid syntax');
          parts.push(this.parseTestListStar());
        }
        const value = parts.pop();
        return { type: 'Assign', targets: parts.map((x) => this.toTarget(x, parts.length === 1 ? 'assign1' : 'assign')), value, line };
      }
    }
    return { type: 'Expr', value: first, line };
  }

  toTarget(e, ctx) {
    const bad = (what) => {
      if (ctx === 'aug') this.error(`'${what}' is an illegal expression for augmented assignment`, { line: e.line }, undefined, e.col, e.endCol);
      if (ctx === 'del') this.error(`cannot delete ${what}`, { line: e.line }, undefined, e.col, e.endCol);
      const exprLevel = !['Compare', 'BoolOp', 'Lambda', 'IfExp', 'NamedExpr', 'Tuple', 'List', 'GeneratorExp', 'Const'].includes(e.type) && !(e.type === 'UnaryOp' && e.op === 'not');
      if (ctx === 'assign1' && exprLevel) this.error(`cannot assign to ${what} here. Maybe you meant '==' instead of '='?`, { line: e.line }, undefined, e.col, e.endCol);
      this.error(`cannot assign to ${what}`, { line: e.line }, undefined, e.col, e.endCol);
    };
    switch (e.type) {
      case 'Name':
        return e;
      case 'Attribute': case 'Subscript':
        return e;
      case 'Tuple': case 'List':
        if (ctx === 'aug') bad(e.type === 'Tuple' ? 'tuple' : 'list');
        return { type: e.type, elts: e.elts.map((x) => this.toTarget(x, ctx === 'assign1' ? 'assign' : ctx)), line: e.line, col: e.col, endLine: e.endLine, endCol: e.endCol };
      case 'Starred':
        return { type: 'Starred', value: this.toTarget(e.value, ctx), line: e.line };
      case 'Call': bad('function call');
      case 'Num': case 'Str': case 'FStr': bad('literal');
      case 'Const': if (e.value === true || e.value === false || e.value === NONE) this.error(`cannot assign to ${e.value === true ? 'True' : e.value === false ? 'False' : 'None'}`, { line: e.line }, undefined, e.col, e.endCol); bad('literal');
      case 'Compare': bad('comparison');
      case 'BoolOp': case 'BinOp': case 'UnaryOp': bad('expression');
      case 'Lambda': bad('lambda');
      case 'IfExp': bad('conditional expression');
      case 'ListComp': bad('list comprehension');
      case 'Dict': bad('dict literal');
      case 'Set': bad('set display');
      default: bad('expression');
    }
  }

  parseTestList() {
    const st = this.tok;
    const first = this.parseTest();
    if (!this.isOp(',')) return first;
    const elts = [first];
    while (this.eatOp(',')) { if (this.atExprEnd()) break; elts.push(this.parseTest()); }
    return this.pos({ type: 'Tuple', elts, line: first.line }, st);
  }

  parseTestListStar() {
    const st = this.tok;
    const first = this.parseTestOrStar();
    if (!this.isOp(',')) return first;
    const elts = [first];
    while (this.eatOp(',')) { if (this.atExprEnd()) break; elts.push(this.parseTestOrStar()); }
    return this.pos({ type: 'Tuple', elts, line: first.line }, st);
  }

  atExprEnd() {
    const t = this.tok;
    if (t.type === 'NEWLINE' || t.type === 'EOF') return true;
    if (t.type === 'OP' && (t.value === ')' || t.value === ']' || t.value === '}' || t.value === '=' || t.value === ':' || t.value === ';' || AUG_OPS.has(t.value))) return true;
    if (t.type === 'KW' && t.value === 'in') return true;
    return false;
  }

  parseTestOrStar() {
    if (this.isOp('*')) { const st = this.tok; const line = this.advance().line; return this.pos({ type: 'Starred', value: this.parseOrExpr(), line }, st); }
    return this.parseNamedTest();
  }

  parseNamedTest() {
    if (this.tok.type === 'NAME' && this.peekTok().type === 'OP' && this.peekTok().value === ':=') {
      const line = this.tok.line;
      const nt = this.advance();
      const name = nt.value;
      const target = this.pos({ type: 'Name', id: name, line }, nt);
      this.advance();
      const value = this.parseTest();
      return this.pos({ type: 'NamedExpr', target, value, line }, nt);
    }
    return this.parseTest();
  }

  parseTest() {
    if (this.isKw('lambda')) return this.parseLambda();
    const st = this.tok;
    const body = this.parseOrTest();
    if (this.isKw('if')) {
      this.advance();
      const test = this.parseOrTest();
      if (!this.eatKw('else')) {
        // CPython underlines the whole `value if test` part
        const et = this.toks[this.i - 1];
        if (!this.noPos && et && st.line === et.line && st.col !== undefined && et.endCol !== undefined) this.error("expected 'else' after 'if' expression", st, undefined, st.col, et.endCol);
        this.error("expected 'else' after 'if' expression");
      }
      const orelse = this.parseTest();
      return this.pos({ type: 'IfExp', test, body, orelse, line: body.line }, st);
    }
    return body;
  }

  parseLambda() {
    const st = this.tok;
    const line = this.advance().line;
    const params = this.parseParams(':', false);
    this.expectOp(':');
    const body = this.parseTest();
    return this.pos({ type: 'Lambda', params, body, line }, st);
  }

  parseOrTest() {
    const st = this.tok;
    const left = this.parseAndTest();
    if (!this.isKw('or')) return left;
    const values = [left];
    while (this.eatKw('or')) values.push(this.parseAndTest());
    return this.pos({ type: 'BoolOp', op: 'or', values, line: left.line }, st);
  }

  parseAndTest() {
    const st = this.tok;
    const left = this.parseNotTest();
    if (!this.isKw('and')) return left;
    const values = [left];
    while (this.eatKw('and')) values.push(this.parseNotTest());
    return this.pos({ type: 'BoolOp', op: 'and', values, line: left.line }, st);
  }

  parseNotTest() {
    if (this.isKw('not')) { const st = this.tok; const line = this.advance().line; return this.pos({ type: 'UnaryOp', op: 'not', operand: this.parseNotTest(), line }, st); }
    return this.parseComparison();
  }

  parseComparison() {
    const st = this.tok;
    const left = this.parseOrExpr();
    const ops = [], comparators = [];
    for (;;) {
      const t = this.tok;
      let op = null;
      if (t.type === 'OP' && (t.value === '<' || t.value === '>' || t.value === '==' || t.value === '>=' || t.value === '<=' || t.value === '!=')) { op = t.value; this.advance(); }
      else if (t.type === 'KW' && t.value === 'in') { op = 'in'; this.advance(); }
      else if (t.type === 'KW' && t.value === 'not' && this.peekTok().type === 'KW' && this.peekTok().value === 'in') { op = 'not in'; this.advance(); this.advance(); }
      else if (t.type === 'KW' && t.value === 'is') { this.advance(); op = this.eatKw('not') ? 'is not' : 'is'; }
      else break;
      ops.push(op);
      comparators.push(this.parseOrExpr());
    }
    if (!ops.length) return left;
    return this.pos({ type: 'Compare', left, ops, comparators, line: left.line }, st);
  }

  parseBin(next, ops) {
    const st = this.tok;
    let left = next.call(this);
    for (;;) {
      const t = this.tok;
      if (t.type === 'OP' && ops.indexOf(t.value) >= 0) {
        this.advance();
        const right = next.call(this);
        left = this.pos({ type: 'BinOp', op: t.value, left, right, line: left.line }, st);
      } else return left;
    }
  }
  parseOrExpr() { return this.parseBin(this.parseXorExpr, ['|']); }
  parseXorExpr() { return this.parseBin(this.parseAndExpr, ['^']); }
  parseAndExpr() { return this.parseBin(this.parseShiftExpr, ['&']); }
  parseShiftExpr() { return this.parseBin(this.parseArith, ['<<', '>>']); }
  parseArith() { return this.parseBin(this.parseTerm, ['+', '-']); }
  parseTerm() { return this.parseBin(this.parseFactor, ['*', '/', '//', '%', '@']); }

  parseFactor() {
    if (this.isOp('+') || this.isOp('-') || this.isOp('~')) {
      const t = this.advance();
      const operand = this.parseFactor();
      if (t.value === '-' && operand.type === 'Num' && !operand.neg) {
        return this.pos({ type: 'Num', value: operand.isFloat ? -operand.value : intNeg(operand.value), isFloat: operand.isFloat, line: t.line, neg: true }, t);
      }
      return this.pos({ type: 'UnaryOp', op: t.value, operand, line: t.line }, t);
    }
    return this.parsePower();
  }

  parsePower() {
    const st = this.tok;
    const base = this.parsePrimary();
    if (this.isOp('**')) {
      this.advance();
      const exp = this.parseFactor();
      return this.pos({ type: 'BinOp', op: '**', left: base, right: exp, line: base.line }, st);
    }
    return base;
  }

  parsePrimary() {
    const st = this.tok;
    let e = this.parseAtom();
    for (;;) {
      if (this.isOp('(')) {
        const line = this.advance().line;
        const a = this.parseArgs();
        if (!this.isOp(')')) {
          if (this.tok.type === 'STRING' || this.tok.type === 'NAME' || this.tok.type === 'NUMBER') {
            const lastArg = a.args[a.args.length - 1];
            this.error('invalid syntax. Perhaps you forgot a comma?', undefined, undefined, lastArg && lastArg.col !== undefined ? lastArg.col : undefined, lastArg && lastArg.col !== undefined ? this.tok.endCol : undefined);
          }
          this.error('invalid syntax');
        }
        this.advance();
        e = this.pos({ type: 'Call', func: e, args: a.args, keywords: a.keywords, line: e.line, callLine: line }, st);
      } else if (this.isOp('[')) {
        this.advance();
        const sl = this.parseSubscriptList();
        this.expectOp(']');
        e = this.pos({ type: 'Subscript', value: e, slice: sl, line: e.line }, st);
      } else if (this.isOp('.')) {
        this.advance();
        const nt = this.tok;
        if (nt.type !== 'NAME' && nt.type !== 'KW') this.error('invalid syntax');
        this.advance();
        e = this.pos({ type: 'Attribute', value: e, attr: nt.value, line: e.line }, st);
      } else return e;
    }
  }

  parseArgs() {
    const args = [], keywords = [];
    while (!this.isOp(')')) {
      if (this.isOp('*')) { const line = this.advance().line; args.push({ type: 'Starred', value: this.parseTest(), line }); }
      else if (this.isOp('**')) { this.advance(); keywords.push({ arg: null, value: this.parseTest() }); }
      else if (this.tok.type === 'NAME' && this.peekTok().type === 'OP' && this.peekTok().value === '=') {
        const nameTok = this.advance();
        const nm = nameTok.value;
        this.advance();
        const value = this.parseTest();
        // like CPython, a repeated keyword is caught when the code is read, underlining `name=value`
        if (keywords.some((k) => k.arg === nm)) {
          let ec = nameTok.endCol;
          if (value && value.endLine === nameTok.line && value.endCol !== undefined) ec = value.endCol;
          else {
            // the value runs onto later lines: underline to the end of this line, as CPython does
            for (let k = this.i - 1; k >= 0; k--) {
              const tk = this.toks[k];
              if (tk.line === nameTok.line && tk.endCol !== undefined && tk.type !== 'NEWLINE') { ec = Math.max(ec, tk.endCol); break; }
            }
          }
          this.error(`keyword argument repeated: ${nm}`, nameTok, undefined, nameTok.col, ec);
        }
        keywords.push({ arg: nm, value });
      } else {
        const est = this.tok;
        const e = this.parseNamedTest();
        // `print(17 => 18)` or `f(x + 1 = 5)`: only a plain name can be a keyword argument
        if (this.isOp('=')) this.error('expression cannot contain assignment, perhaps you meant "=="?', this.tok, undefined, e.col !== undefined ? e.col : est.col, this.tok.endCol);
        if (this.isKw('for')) {
          const gens = this.parseCompFor();
          args.push(this.pos({ type: 'GeneratorExp', elt: e, generators: gens, line: e.line }, est));
        } else {
          if (keywords.some((k) => k.arg !== null)) this.error('positional argument follows keyword argument');
          args.push(e);
        }
      }
      if (!this.eatOp(',')) break;
    }
    return { args, keywords };
  }

  parseSubscriptList() {
    const st = this.tok;
    const first = this.parseSubscript();
    if (!this.isOp(',')) return first;
    const elts = [first];
    while (this.eatOp(',')) { if (this.isOp(']')) break; elts.push(this.parseSubscript()); }
    return this.pos({ type: 'Tuple', elts, line: first.line }, st);
  }

  parseSubscript() {
    const st = this.tok;
    const line = this.tok.line;
    let lower = null, upper = null, step = null;
    if (!this.isOp(':')) {
      lower = this.parseNamedTest();
      if (!this.isOp(':')) return lower;
    }
    this.advance();
    if (!this.isOp(']') && !this.isOp(':') && !this.isOp(',')) upper = this.parseTest();
    if (this.eatOp(':')) { if (!this.isOp(']') && !this.isOp(',')) step = this.parseTest(); }
    return this.pos({ type: 'Slice', lower, upper, step, line }, st);
  }

  parseCompFor() {
    const gens = [];
    while (this.isKw('for')) {
      this.advance();
      const tgt = this.toTarget(this.parseExprList(), 'for');
      if (!this.eatKw('in')) this.error('invalid syntax');
      const iter = this.parseOrTest();
      const ifs = [];
      while (this.isKw('if')) { this.advance(); ifs.push(this.parseOrTest()); }
      gens.push({ target: tgt, iter, ifs });
    }
    return gens;
  }

  parseExprList() {
    const st = this.tok;
    const line = this.tok.line;
    const one = () => {
      if (this.isOp('*')) { const s2 = this.tok; const l = this.advance().line; return this.pos({ type: 'Starred', value: this.parseOrExpr(), line: l }, s2); }
      return this.parseOrExpr();
    };
    const first = one();
    if (!this.isOp(',')) return first;
    const elts = [first];
    while (this.eatOp(',')) {
      if (this.isKw('in') || this.isOp('=') || this.tok.type === 'NEWLINE') break;
      elts.push(one());
    }
    return this.pos({ type: 'Tuple', elts, line }, st);
  }

  parseAtom() {
    const st = this.tok;
    const paren = this.isOp('(');
    const e = this.parseAtom0();
    if (paren && e.type !== 'Tuple' && e.type !== 'GeneratorExp') return e;
    return this.pos(e, st);
  }

  parseAtom0() {
    const t = this.tok, line = t.line;
    switch (t.type) {
      case 'NAME': this.advance(); return { type: 'Name', id: t.value, line };
      case 'NUMBER': this.advance(); return { type: 'Num', value: t.value, isFloat: t.isFloat, line };
      case 'STRING': {
        const toks = [];
        while (this.tok.type === 'STRING') { const x = this.advance(); if (x.ferr) throw x.ferr; toks.push(x); }
        if (toks.every((x) => !x.fparts)) return { type: 'Str', value: toks.map((x) => x.value).join(''), line };
        const parts = [];
        for (const x of toks) { if (x.fparts) parts.push(...x.fparts); else parts.push({ s: x.value }); }
        return { type: 'FStr', parts, line };
      }
      case 'KW':
        if (t.value === 'None') { this.advance(); return { type: 'Const', value: NONE, line }; }
        if (t.value === 'True') { this.advance(); return { type: 'Const', value: true, line }; }
        if (t.value === 'False') { this.advance(); return { type: 'Const', value: false, line }; }
        if (t.value === 'lambda') return this.parseLambda();
        if (t.value === 'yield') this.error("'yield' isn't supported in this runner (generators aren't available here)");
        if (t.value === 'await') this.error("'await' isn't supported in this runner");
        this.error('invalid syntax');
        break;
      case 'OP':
        if (t.value === '(') {
          this.advance();
          if (this.eatOp(')')) return { type: 'Tuple', elts: [], line };
          const first = this.parseTestOrStar();
          if (this.isKw('for')) {
            const gens = this.parseCompFor();
            this.expectOp(')');
            return { type: 'GeneratorExp', elt: first, generators: gens, line };
          }
          if (this.eatOp(')')) {
            if (first.type === 'Starred') this.error('cannot use starred expression here');
            return first;
          }
          const elts = [first];
          while (this.eatOp(',')) { if (this.isOp(')')) break; elts.push(this.parseTestOrStar()); }
          if (!this.isOp(')')) {
            if (this.tok.type === 'STRING' || this.tok.type === 'NAME' || this.tok.type === 'NUMBER') { const le = elts[elts.length - 1]; this.error('invalid syntax. Perhaps you forgot a comma?', undefined, undefined, le.col, le.col !== undefined ? this.tok.endCol : undefined); }
            this.error('invalid syntax');
          }
          this.advance();
          return { type: 'Tuple', elts, line };
        }
        if (t.value === '[') {
          this.advance();
          if (this.eatOp(']')) return { type: 'List', elts: [], line };
          const first = this.parseTestOrStar();
          if (this.isKw('for')) {
            const gens = this.parseCompFor();
            this.expectOp(']');
            return { type: 'ListComp', elt: first, generators: gens, line };
          }
          const elts = [first];
          while (this.eatOp(',')) { if (this.isOp(']')) break; elts.push(this.parseTestOrStar()); }
          if (!this.isOp(']')) {
            if (this.tok.type === 'STRING' || this.tok.type === 'NAME' || this.tok.type === 'NUMBER') { const le = elts[elts.length - 1]; this.error('invalid syntax. Perhaps you forgot a comma?', undefined, undefined, le.col, le.col !== undefined ? this.tok.endCol : undefined); }
            this.error('invalid syntax');
          }
          this.advance();
          return { type: 'List', elts, line };
        }
        if (t.value === '{') {
          this.advance();
          if (this.eatOp('}')) return { type: 'Dict', keys: [], values: [], line };
          if (this.isOp('**')) {
            const keys = [], values = [];
            do {
              if (this.isOp('}')) break;
              if (this.eatOp('**')) { keys.push(null); values.push(this.parseOrExpr()); }
              else { keys.push(this.parseTest()); this.expectOp(':'); values.push(this.parseTest()); }
            } while (this.eatOp(','));
            this.expectOp('}');
            return { type: 'Dict', keys, values, line };
          }
          const first = this.parseTestOrStar();
          if (this.eatOp(':')) {
            const v = this.parseTest();
            if (this.isKw('for')) {
              const gens = this.parseCompFor();
              this.expectOp('}');
              return { type: 'DictComp', key: first, value: v, generators: gens, line };
            }
            const keys = [first], values = [v];
            while (this.eatOp(',')) {
              if (this.isOp('}')) break;
              if (this.eatOp('**')) { keys.push(null); values.push(this.parseOrExpr()); continue; }
              keys.push(this.parseTest());
              this.expectOp(':');
              values.push(this.parseTest());
            }
            this.expectOp('}');
            return { type: 'Dict', keys, values, line };
          }
          if (this.isKw('for')) {
            const gens = this.parseCompFor();
            this.expectOp('}');
            return { type: 'SetComp', elt: first, generators: gens, line };
          }
          const elts = [first];
          while (this.eatOp(',')) { if (this.isOp('}')) break; elts.push(this.parseTestOrStar()); }
          this.expectOp('}');
          return { type: 'Set', elts, line };
        }
        if (t.value === '...') { this.advance(); return { type: 'Const', value: ELLIPSIS, line }; }
        break;
      case 'INDENT':
        this.error('unexpected indent', null, 'IndentationError', null);
    }
    this.error('invalid syntax');
  }
}

function parseProgram(src) {
  const toks = tokenize(src);
  const p = new Parser(toks);
  let body;
  try { body = p.parseFile(); } catch (e) {
    // like CPython: an unclosed bracket wins over a parser error found on a later line
    if (e instanceof SyntaxErr && toks.unclosed && e !== toks.unclosed && e.line > toks.unclosed.line) throw toks.unclosed;
    throw e;
  }
  checkContext(body, false, false);
  return body;
}

// 'return' outside function, 'break' outside loop, etc.
function checkContext(stmts, inFunc, inLoop) {
  for (const s of stmts) {
    switch (s.type) {
      case 'Return': if (!inFunc) throw new SyntaxErr('SyntaxError', "'return' outside function", s.line, s.col, s.endCol); break;
      case 'Break': if (!inLoop) throw new SyntaxErr('SyntaxError', "'break' outside loop", s.line, s.col, s.endCol); break;
      case 'Continue': if (!inLoop) throw new SyntaxErr('SyntaxError', "'continue' not properly in loop", s.line, s.col, s.endCol); break;
      case 'If': checkContext(s.body, inFunc, inLoop); checkContext(s.orelse, inFunc, inLoop); break;
      case 'While': case 'For': checkContext(s.body, inFunc, true); checkContext(s.orelse, inFunc, inLoop); break;
      case 'Try':
        checkContext(s.body, inFunc, inLoop);
        for (const h of s.handlers) checkContext(h.body, inFunc, inLoop);
        checkContext(s.orelse, inFunc, inLoop);
        checkContext(s.finalbody, inFunc, inLoop);
        break;
      case 'FunctionDef': checkContext(s.body, true, false); break;
      case 'ClassDef': checkContext(s.body, false, false); break;
    }
  }
}

function collectScope(body, params) {
  const locals = new Set(params.map((p) => p.name));
  const globals = new Set(), nonlocals = new Set();
  const addTarget = (t) => {
    switch (t.type) {
      case 'Name': locals.add(t.id); break;
      case 'Tuple': case 'List': t.elts.forEach(addTarget); break;
      case 'Starred': addTarget(t.value); break;
    }
  };
  const visitList = (stmts) => { for (const s of stmts) visit(s); };
  function visit(s) {
    switch (s.type) {
      case 'Assign': s.targets.forEach(addTarget); break;
      case 'AugAssign': addTarget(s.target); break;
      case 'AnnAssign': addTarget(s.target); break;
      case 'For': addTarget(s.target); visitList(s.body); visitList(s.orelse); break;
      case 'While': case 'If': visitList(s.body); visitList(s.orelse); break;
      case 'Try':
        visitList(s.body);
        for (const h of s.handlers) { if (h.name) locals.add(h.name); visitList(h.body); }
        visitList(s.orelse);
        visitList(s.finalbody);
        break;
      case 'FunctionDef': case 'ClassDef': locals.add(s.name); break;
      case 'Import': for (const nm of s.names) locals.add(nm.asname || nm.name.split('.')[0]); break;
      case 'ImportFrom': for (const nm of s.names) if (nm.name !== '*') locals.add(nm.asname || nm.name); break;
      case 'Global': for (const nm of s.names) globals.add(nm); break;
      case 'Nonlocal': for (const nm of s.names) nonlocals.add(nm); break;
      case 'Delete': for (const t of s.targets) if (t.type === 'Name') locals.add(t.id); break;
      case 'Expr': findWalrus(s.value); break;
    }
  }
  function findWalrus(e) {
    if (!e || typeof e !== 'object') return;
    if (e.type === 'NamedExpr') locals.add(e.target.id);
  }
  visitList(body);
  for (const g of globals) locals.delete(g);
  for (const nl of nonlocals) locals.delete(nl);
  return { locals, globals, nonlocals };
}

function compScope(gens) {
  const locals = new Set();
  const add = (t) => {
    if (t.type === 'Name') locals.add(t.id);
    else if (t.type === 'Tuple' || t.type === 'List') t.elts.forEach(add);
    else if (t.type === 'Starred') add(t.value);
  };
  for (const g of gens) add(g.target);
  return { locals, globals: new Set(), nonlocals: new Set() };
}
