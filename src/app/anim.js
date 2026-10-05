/* Stepwise animation views: turn a traced frame (variables at one moment) into pictures. */
(function () {
  'use strict';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- value helpers (values are encoded by tools/cpy_runner.py enc()) ----------
  function pyStrRepr(s) {
    const q = s.indexOf("'") >= 0 && s.indexOf('"') < 0 ? '"' : "'";
    return q + s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\t/g, '\\t').split(q).join('\\' + q) + q;
  }
  function vrepr(v, depth) {
    depth = depth || 0;
    if (v === null) return 'None';
    if (v === true) return 'True';
    if (v === false) return 'False';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string') return pyStrRepr(v);
    if (depth > 4) return '…';
    if (v.$i !== undefined) return v.$i;
    if (v.$f !== undefined) return v.$f;
    if (v.$l) return '[' + v.$l.map((x) => vrepr(x, depth + 1)).join(', ') + (v.more ? ', …' : '') + ']';
    if (v.$t) return v.$t.length === 1 ? '(' + vrepr(v.$t[0], depth + 1) + ',)' : '(' + v.$t.map((x) => vrepr(x, depth + 1)).join(', ') + ')';
    if (v.$s) return v.$s.length ? '{' + v.$s.map((x) => vrepr(x, depth + 1)).join(', ') + '}' : 'set()';
    if (v.$q) return 'deque([' + v.$q.map((x) => vrepr(x, depth + 1)).join(', ') + '])';
    if (v.$d) {
      const body = '{' + v.$d.map(([k, x]) => vrepr(k, depth + 1) + ': ' + vrepr(x, depth + 1)).join(', ') + '}';
      if (v.k === 'Counter') return 'Counter(' + body + ')';
      if (v.k === 'defaultdict') return 'defaultdict(' + body + ')';
      return body;
    }
    if (v.$o !== undefined) {
      const f = v.f || {};
      const keys = Object.keys(f);
      const show = keys.slice(0, 3).map((k) => k + '=' + shortRepr(f[k])).join(', ');
      return v.c + '(' + show + (keys.length > 3 ? ', …' : '') + ')';
    }
    if (v.$r !== undefined) return '(same object #' + v.$r + ')';
    if (v.$fn) return 'function ' + v.$fn + '()';
    if (v.$cls) return 'class ' + v.$cls;
    if (v.$mod) return 'module ' + v.$mod;
    if (v.$x !== undefined) return v.$x;
    return '?';
  }
  function shortRepr(v) {
    if (v && typeof v === 'object' && v.$o !== undefined) return v.c + '…';
    if (v && typeof v === 'object' && v.$r !== undefined) return '↺';
    const r = vrepr(v, 3);
    return r.length > 24 ? r.slice(0, 22) + '…' : r;
  }
  function seq(v) {
    if (!v || typeof v !== 'object') return null;
    return v.$l || v.$t || v.$q || v.$s || null;
  }
  function num(v) {
    if (typeof v === 'number') return v;
    if (v && v.$f) return parseFloat(v.$f);
    if (v && v.$i) return Number(v.$i);
    if (typeof v === 'boolean') return v ? 1 : 0;
    return null;
  }
  function label(v) {
    if (typeof v === 'string') return v;
    return vrepr(v);
  }

  // find a variable in the frame: innermost function frame first, then globals
  function lookup(frame, name) {
    const st = frame.st || [];
    for (let i = st.length - 1; i >= 0; i--) {
      const vars = st[i].vars || {};
      if (Object.prototype.hasOwnProperty.call(vars, name)) return { found: true, v: vars[name] };
    }
    return { found: false };
  }
  // tiny expression support for view options: name, int, name.attr, name+1, len-i ...
  function evalExpr(expr, frame, arrLen) {
    if (expr === undefined || expr === null || expr === '') return null;
    const terms = expr.replace(/\s+/g, '').match(/[+-]?[^+-]+/g);
    if (!terms) return null;
    let total = 0;
    for (const t of terms) {
      let sign = 1, body = t;
      if (body[0] === '+') body = body.slice(1);
      else if (body[0] === '-') { sign = -1; body = body.slice(1); }
      let val;
      if (/^\d+$/.test(body)) val = parseInt(body, 10);
      else if (body === 'len') val = arrLen;
      else {
        const r = lookup(frame, body);
        if (!r.found) return null;
        val = num(r.v);
        if (val === null) return null;
      }
      total += sign * val;
    }
    return total;
  }
  function objId(v) {
    if (!v || typeof v !== 'object') return null;
    if (v.$o !== undefined) return v.$o;
    if (v.$r !== undefined) return v.$r;
    return null;
  }
  // collect all encoded objects reachable in the frame so $r refs can be resolved
  function objIndex(frame) {
    const idx = new Map();
    const walk = (v, d) => {
      if (!v || typeof v !== 'object' || d > 40) return;
      if (v.$o !== undefined) {
        if (!idx.has(v.$o)) idx.set(v.$o, v);
        for (const k in v.f) walk(v.f[k], d + 1);
        return;
      }
      const s = seq(v);
      if (s) s.forEach((x) => walk(x, d + 1));
      if (v.$d) v.$d.forEach(([k, x]) => { walk(k, d + 1); walk(x, d + 1); });
    };
    for (const sf of frame.st || []) for (const k in sf.vars) walk(sf.vars[k], 0);
    return idx;
  }
  function deref(v, idx) {
    if (v && typeof v === 'object' && v.$r !== undefined) return idx.get(v.$r) || null;
    return v;
  }

  function ptrsFor(spec, frame, len) {
    const out = {};
    if (!spec.ptr) return out;
    for (const p of spec.ptr.split(',')) {
      const v = evalExpr(p, frame, len);
      if (v === null || v < -1 || v > len) continue;
      (out[v] = out[v] || []).push(p);
    }
    return out;
  }
  function rangeOf(spec, key, frame, len) {
    if (!spec[key]) return null;
    const [a, b] = spec[key].split(':');
    const lo = a === '' ? 0 : evalExpr(a, frame, len);
    const hi = b === '' || b === undefined ? len - 1 : evalExpr(b, frame, len);
    if (lo === null || hi === null) return null;
    return [lo, hi];
  }

  // ---------- views ----------
  function viewVars(spec, frame, prev) {
    const st = frame.st || [];
    const rows = [];
    const prevVal = (scopeIdx, name) => {
      if (!prev || !prev.st) return undefined;
      const ps = prev.st[scopeIdx];
      if (!ps || ps.fn !== st[scopeIdx].fn) return undefined;
      return ps.vars ? ps.vars[name] : undefined;
    };
    const only = spec.vars;
    st.forEach((sf, si) => {
      let names = Object.keys(sf.vars || {});
      if (only) names = only.filter((n) => Object.prototype.hasOwnProperty.call(sf.vars, n));
      names = names.filter((n) => !(sf.vars[n] && (sf.vars[n].$fn || sf.vars[n].$cls || sf.vars[n].$mod)) || (only && only.indexOf(n) >= 0));
      if (!names.length && st.length > 1) return;
      if (st.length > 1 || si > 0) rows.push(`<tr class="scope"><td colspan="2">${sf.fn === '<module>' ? 'global' : 'inside ' + esc(sf.fn) + '()'}</td></tr>`);
      for (const n of names) {
        const v = sf.vars[n];
        const pv = prevVal(si, n);
        const changed = prev && JSON.stringify(pv) !== JSON.stringify(v);
        rows.push(`<tr class="${changed ? 'changed' : ''}"><td>${esc(n)}</td><td class="val">${esc(vrepr(v))}</td></tr>`);
      }
    });
    if (frame.ret !== undefined && frame.ev === 'return') rows.push(`<tr class="changed"><td>returns</td><td class="val">${esc(vrepr(frame.ret))}</td></tr>`);
    if (!rows.length) return '<div class="emptyv">No variables yet</div>';
    return `<table class="vtable"><tbody>${rows.join('')}</tbody></table>`;
  }

  function arrCells(spec, frame, items) {
    const len = items.length;
    const ptrs = ptrsFor(spec, frame, len);
    const range = rangeOf(spec, 'range', frame, len) || rangeOf(spec, 'window', frame, len);
    const done = rangeOf(spec, 'done', frame, len);
    const hitIdx = spec.hit ? spec.hit.split(',').map((h) => evalExpr(h, frame, len)) : [];
    return items.map((x, i) => {
      const cls = [];
      if (range) { if (i >= range[0] && i <= range[1]) cls.push('inrange'); else if (spec.dim !== '0') cls.push('dim'); }
      if (done && i >= done[0] && i <= done[1]) cls.push('done');
      if (hitIdx.indexOf(i) >= 0) cls.push('hit');
      return { i, x, cls, ptr: ptrs[i] || [] };
    }).concat(ptrs[len] ? [{ i: len, x: undefined, cls: ['ghost'], ptr: ptrs[len] }] : []);
  }

  function viewArray(spec, frame) {
    const name = spec.vars ? spec.vars[0] : null;
    const r = name ? lookup(frame, name) : { found: false };
    if (!r.found) return `<div class="emptyv">${esc(name || '?')} doesn't exist yet</div>`;
    const items = typeof r.v === 'string' ? Array.from(r.v) : seq(r.v);
    if (!items) return `<div class="emptyv">${esc(name)} = ${esc(vrepr(r.v))}</div>`;
    if (!items.length) return `<div class="emptyv">${esc(name)} is empty: ${typeof r.v === 'string' ? "''" : '[]'}</div>`;
    const cells = arrCells(spec, frame, items);
    return '<div class="arr">' + cells.map((c) => c.x === undefined
      ? `<div class="acell"><div class="box" style="border-style:dashed;opacity:.4">&nbsp;</div><div class="idx">${c.i}</div><div class="ptr">${esc(c.ptr.join(' '))}</div></div>`
      : `<div class="acell ${c.cls.join(' ')}"><div class="box">${esc(label(c.x))}</div><div class="idx">${c.i}</div><div class="ptr">${esc(c.ptr.join(' '))}</div></div>`).join('') + '</div>';
  }

  function viewBars(spec, frame) {
    const name = spec.vars ? spec.vars[0] : null;
    const r = name ? lookup(frame, name) : { found: false };
    if (!r.found) return `<div class="emptyv">${esc(name || '?')} doesn't exist yet</div>`;
    const items = seq(r.v) || [];
    const nums = items.map(num).filter((x) => x !== null);
    const max = Math.max(1, ...nums.map((x) => Math.abs(x)));
    const cells = arrCells(spec, frame, items);
    return '<div class="bars">' + cells.filter((c) => c.x !== undefined).map((c) => {
      const h = Math.max(4, Math.round((Math.abs(num(c.x) || 0) / max) * 130));
      return `<div class="barcol ${c.cls.join(' ')}"><div class="v">${esc(label(c.x))}</div><div class="b" style="height:${h}px"></div><div class="ptr">${esc(c.ptr.join(' '))}</div></div>`;
    }).join('') + '</div>';
  }

  function viewGrid(spec, frame) {
    const name = spec.vars ? spec.vars[0] : null;
    const r = name ? lookup(frame, name) : { found: false };
    if (!r.found) return `<div class="emptyv">${esc(name || '?')} doesn't exist yet</div>`;
    const rows = seq(r.v) || [];
    const ri = spec.row ? evalExpr(spec.row, frame, rows.length) : null;
    const width = Math.max(0, ...rows.map((x) => (seq(x) || []).length));
    const ci = spec.col ? evalExpr(spec.col, frame, width) : null;
    const colLabels = spec.cols ? spec.cols.split(',') : null;
    const rowLabels = spec.rows ? spec.rows.split(',') : null;
    let h = '<table class="grid2"><thead><tr><th></th>';
    for (let j = 0; j < width; j++) h += `<th scope="col">${esc(colLabels ? colLabels[j] || '' : j)}</th>`;
    h += '</tr></thead><tbody>';
    rows.forEach((row, i) => {
      const cells = seq(row) || [];
      h += `<tr><th scope="row">${esc(rowLabels ? rowLabels[i] || '' : i)}</th>`;
      for (let j = 0; j < width; j++) {
        const hit = i === ri && j === ci;
        const cls = hit ? 'hit' : (i === ri ? 'rowhit' : '');
        h += `<td class="${cls}">${j < cells.length ? esc(label(cells[j])) : ''}</td>`;
      }
      h += '</tr>';
    });
    return h + '</tbody></table>';
  }

  function viewStack(spec, frame) {
    const name = spec.vars ? spec.vars[0] : null;
    const r = name ? lookup(frame, name) : { found: false };
    if (!r.found) return `<div class="emptyv">${esc(name || '?')} doesn't exist yet</div>`;
    const items = seq(r.v) || [];
    if (!items.length) return '<div class="emptyv">empty stack</div>';
    return '<div class="stackv">' + items.map((x, i) => `<div class="it ${i === items.length - 1 ? 'ontop' : ''}">${esc(label(x))}</div>`).join('') + '<div class="lab">top ↓</div></div>';
  }

  function viewQueue(spec, frame) {
    const name = spec.vars ? spec.vars[0] : null;
    const r = name ? lookup(frame, name) : { found: false };
    if (!r.found) return `<div class="emptyv">${esc(name || '?')} doesn't exist yet</div>`;
    const items = seq(r.v) || [];
    if (!items.length) return '<div class="emptyv">empty queue</div>';
    return '<div class="queuev"><span class="end">front →</span>' + items.map((x) => `<div class="it">${esc(label(x))}</div>`).join('') + '<span class="end">← back</span></div>';
  }

  function viewDict(spec, frame) {
    const name = spec.vars ? spec.vars[0] : null;
    const r = name ? lookup(frame, name) : { found: false };
    if (!r.found) return `<div class="emptyv">${esc(name || '?')} doesn't exist yet</div>`;
    const d = r.v && r.v.$d;
    if (!d) return `<div class="emptyv">${esc(vrepr(r.v))}</div>`;
    if (!d.length) return '<div class="emptyv">empty dictionary {}</div>';
    const hit = spec.hit ? lookup(frame, spec.hit) : { found: false };
    return '<table class="vtable"><tbody>' + d.map(([k, x]) => {
      const isHit = hit.found && JSON.stringify(hit.v) === JSON.stringify(k);
      return `<tr class="${isHit ? 'changed' : ''}"><td>${esc(vrepr(k))}</td><td class="val">${esc(vrepr(x))}</td></tr>`;
    }).join('') + '</tbody></table>';
  }

  function viewSet(spec, frame) {
    const name = spec.vars ? spec.vars[0] : null;
    const r = name ? lookup(frame, name) : { found: false };
    if (!r.found) return `<div class="emptyv">${esc(name || '?')} doesn't exist yet</div>`;
    const items = seq(r.v) || [];
    if (!items.length) return '<div class="emptyv">empty set</div>';
    return '<div class="queuev">' + items.map((x) => `<div class="it" style="border-radius:999px">${esc(label(x))}</div>`).join('') + '</div>';
  }

  function viewBuckets(spec, frame) {
    const name = spec.vars ? spec.vars[0] : null;
    const r = name ? lookup(frame, name) : { found: false };
    if (!r.found) return `<div class="emptyv">${esc(name || '?')} doesn't exist yet</div>`;
    const buckets = seq(r.v) || [];
    const hit = spec.hit ? evalExpr(spec.hit, frame, buckets.length) : null;
    return '<table class="vtable"><tbody>' + buckets.map((b, i) => {
      const items = seq(b) || [];
      return `<tr class="${i === hit ? 'changed' : ''}"><td>${i}</td><td class="val">${items.length ? items.map((x) => esc(vrepr(x))).join('  →  ') : '<span style="color:var(--dim)">empty</span>'}</td></tr>`;
    }).join('') + '</tbody></table>';
  }

  function viewCallstack(spec, frame) {
    const st = frame.st || [];
    return '<div class="callstack">' + st.map((sf, i) => {
      const vars = Object.keys(sf.vars || {}).filter((k) => !(sf.vars[k] && (sf.vars[k].$fn || sf.vars[k].$cls)));
      const shown = vars.slice(0, 4).map((k) => esc(k) + '=' + esc(shortRepr(sf.vars[k]))).join(', ');
      const name = sf.fn === '<module>' ? 'main program' : sf.fn + '(' + shown + ')';
      return `<div class="fr ${i === st.length - 1 ? 'ontop' : ''}"><b>${esc(name)}</b>${sf.line ? ' · line ' + sf.line : ''}</div>`;
    }).join('') + '</div>';
  }

  function viewSteps(spec, frame) {
    const name = spec.vars ? spec.vars[0] : 'steps';
    const r = lookup(frame, name);
    const v = r.found ? vrepr(r.v) : '0';
    return `<div style="display:flex;align-items:baseline;gap:12px"><span style="font-family:var(--mono);font-size:34px;font-weight:600;color:var(--accent)">${esc(v)}</span><span style="color:var(--muted);font-size:14px">${esc(spec.label ? spec.label.replace(/_/g, ' ') : name)}</span></div>`;
  }

  // ----- linked list (SVG) -----
  function viewLinked(spec, frame) {
    const name = spec.vars ? spec.vars[0] : 'head';
    const nextF = spec.next || 'next', valF = spec.val || 'val';
    const idx = objIndex(frame);
    const r = lookup(frame, name);
    const nodes = [];
    const seen = new Set();
    let cur = r.found ? deref(r.v, idx) : null;
    while (cur && cur.$o !== undefined && !seen.has(cur.$o) && nodes.length < 14) {
      seen.add(cur.$o);
      nodes.push(cur);
      cur = deref(cur.f ? cur.f[nextF] : null, idx);
    }
    const cycle = cur && cur.$o !== undefined && seen.has(cur.$o);
    // pointers: any variable named in ptr list that refers to a node
    const ptrNames = (spec.ptr ? spec.ptr.split(',') : []).concat([name]);
    const ptrAt = {};
    let noneLabels = [];
    for (const p of ptrNames) {
      const pr = lookup(frame, p);
      if (!pr.found) continue;
      const id = objId(pr.v);
      if (id === null) { if (pr.v === null && p !== name) noneLabels.push(p); continue; }
      (ptrAt[id] = ptrAt[id] || []).push(p);
    }
    // also show any other lists (e.g. reversed part) via 'other' option
    const W = 86, gap = 44, H = 112, top = 34;
    const width = Math.max(260, 20 + nodes.length * (W + gap) + 90);
    let s = `<svg class="dsv" viewBox="0 0 ${width} ${H}" width="${width}" height="${H}" role="img" aria-label="linked list">`;
    s += '<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#9AA3B2"/></marker></defs>';
    nodes.forEach((nd, i) => {
      const x = 20 + i * (W + gap);
      const v = nd.f ? nd.f[valF] : undefined;
      const ptrs = ptrAt[nd.$o] || [];
      const isHit = ptrs.length > 0 && ptrs.some((p) => p !== name);
      s += `<rect x="${x}" y="${top}" width="${W}" height="40" rx="8" fill="${isHit ? 'rgba(255,212,59,0.16)' : '#0E1117'}" stroke="${isHit ? '#FFD43B' : '#343B4A'}"/>`;
      s += `<line x1="${x + W - 26}" y1="${top}" x2="${x + W - 26}" y2="${top + 40}" stroke="#343B4A"/>`;
      s += `<text x="${x + (W - 26) / 2}" y="${top + 25}" text-anchor="middle" font-size="14" fill="#E7E9EE" font-weight="600">${esc(shortRepr(v))}</text>`;
      s += `<circle cx="${x + W - 13}" cy="${top + 20}" r="3" fill="#9AA3B2"/>`;
      if (ptrs.length) s += `<text x="${x + W / 2}" y="${top - 12}" text-anchor="middle" font-size="12" fill="#FFD43B" font-weight="600">${esc(ptrs.join(', '))}</text>`;
      if (i < nodes.length - 1) s += `<line x1="${x + W - 13}" y1="${top + 20}" x2="${x + W + gap - 2}" y2="${top + 20}" stroke="#9AA3B2" stroke-width="1.5" marker-end="url(#arr)"/>`;
    });
    const endX = 20 + nodes.length * (W + gap);
    if (nodes.length) {
      if (cycle) s += `<text x="${endX - gap + 6}" y="${top + 25}" font-size="13" fill="#FF9F97">↺ loops back</text>`;
      else {
        s += `<line x1="${endX - gap - 13}" y1="${top + 20}" x2="${endX - 6}" y2="${top + 20}" stroke="#9AA3B2" stroke-width="1.5" marker-end="url(#arr)"/>`;
        s += `<text x="${endX}" y="${top + 25}" font-size="13" fill="#7A8496">None</text>`;
        if (noneLabels.length) s += `<text x="${endX + 14}" y="${top - 12}" text-anchor="middle" font-size="12" fill="#FFD43B" font-weight="600">${esc(noneLabels.join(', '))}</text>`;
      }
    } else {
      s += `<text x="20" y="${top + 25}" font-size="13" fill="#7A8496">${esc(r.found ? name + ' → None (empty list)' : name + " doesn't exist yet")}</text>`;
    }
    return s + '</svg>';
  }

  // ----- binary tree (SVG) -----
  function treeLayout(root, idx, leftF, rightF) {
    const out = [];
    let x = 0;
    const seen = new Set();
    const walk = (n, d, parent) => {
      n = deref(n, idx);
      if (!n || n.$o === undefined || seen.has(n.$o) || out.length > 40) return null;
      seen.add(n.$o);
      const rec = { n, d, parent, x: 0 };
      walk(n.f[leftF], d + 1, rec);
      rec.x = x++;
      out.push(rec);
      walk(n.f[rightF], d + 1, rec);
      return rec;
    };
    walk(root, 0, null);
    return out;
  }
  function drawTree(recs, opts) {
    if (!recs.length) return `<div class="emptyv">${esc(opts.emptyText || 'empty tree (None)')}</div>`;
    const maxD = Math.max(...recs.map((r) => r.d));
    const cols = recs.length;
    const dx = 50, dy = 64, R = 18;
    const W = Math.max(220, cols * dx + 40), H = (maxD + 1) * dy + 44;
    let s = `<svg class="dsv" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="tree">`;
    const pos = (r) => [20 + r.x * dx + dx / 2, 42 + r.d * dy];
    for (const r of recs) if (r.parent) { const [x1, y1] = pos(r.parent), [x2, y2] = pos(r); s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#4A5262" stroke-width="1.5"/>`; }
    for (const r of recs) {
      const [x, y] = pos(r);
      const hit = opts.hit(r);
      const visited = opts.visited(r);
      s += `<circle cx="${x}" cy="${y}" r="${R}" fill="${hit ? 'rgba(255,212,59,0.22)' : visited ? 'rgba(74,222,128,0.16)' : '#0E1117'}" stroke="${hit ? '#FFD43B' : visited ? '#4ADE80' : '#4A5366'}" stroke-width="1.5"/>`;
      s += `<text x="${x}" y="${y + 5}" text-anchor="middle" font-size="13" font-weight="600" fill="#E7E9EE">${esc(opts.text(r))}</text>`;
      const lab = opts.label(r);
      if (lab) s += `<text x="${x}" y="${y - R - 6}" text-anchor="middle" font-size="11" font-weight="600" fill="#FFD43B">${esc(lab)}</text>`;
    }
    return s + '</svg>';
  }
  function viewTree(spec, frame) {
    const name = spec.vars ? spec.vars[0] : 'root';
    const idx = objIndex(frame);
    const r = lookup(frame, name);
    const leftF = spec.left || 'left', rightF = spec.right || 'right', valF = spec.val || 'val';
    const recs = r.found ? treeLayout(r.v, idx, leftF, rightF) : [];
    const ptrNames = spec.ptr ? spec.ptr.split(',') : [];
    const ptrAt = {};
    for (const p of ptrNames) { const pr = lookup(frame, p); if (pr.found) { const id = objId(pr.v); if (id !== null) (ptrAt[id] = ptrAt[id] || []).push(p); } }
    let visitedVals = null;
    if (spec.visited) { const vr = lookup(frame, spec.visited); if (vr.found) visitedVals = new Set((seq(vr.v) || []).map((x) => JSON.stringify(x))); }
    return drawTree(recs, {
      text: (rec) => shortRepr(rec.n.f[valF]),
      hit: (rec) => !!ptrAt[rec.n.$o],
      visited: (rec) => !!visitedVals && visitedVals.has(JSON.stringify(rec.n.f[valF])),
      label: (rec) => (ptrAt[rec.n.$o] || []).join(','),
      emptyText: r.found ? `${name} is None (empty tree)` : `${name} doesn't exist yet`,
    });
  }
  function viewHeap(spec, frame) {
    const name = spec.vars ? spec.vars[0] : 'heap';
    const r = lookup(frame, name);
    if (!r.found) return `<div class="emptyv">${esc(name)} doesn't exist yet</div>`;
    const items = seq(r.v) || [];
    if (!items.length) return `<div class="emptyv">${esc(name)} is empty</div>`;
    const ptrs = ptrsFor(spec, frame, items.length);
    // build pseudo-tree records by index (in-order positions)
    const recs = [];
    let x = 0;
    const walk = (i, d, parent) => {
      if (i >= items.length) return;
      const rec = { i, d, parent, x: 0 };
      walk(2 * i + 1, d + 1, rec);
      rec.x = x++;
      recs.push(rec);
      walk(2 * i + 2, d + 1, rec);
    };
    walk(0, 0, null);
    const tree = drawTree(recs, {
      text: (rec) => shortRepr(items[rec.i]), hit: (rec) => !!ptrs[rec.i], visited: () => false,
      label: (rec) => (ptrs[rec.i] || []).join(','),
    });
    return tree + '<div style="margin-top:10px">' + viewArray(Object.assign({}, spec, { vars: [name] }), frame) + '</div>';
  }

  // ----- graph (SVG) -----
  function viewGraph(spec, frame) {
    const name = spec.vars ? spec.vars[0] : 'graph';
    const r = lookup(frame, name);
    if (!r.found || !r.v || !r.v.$d) return `<div class="emptyv">${esc(name)} doesn't exist yet</div>`;
    const adj = r.v.$d;
    const pos = {};
    if (spec.pos) for (const part of spec.pos.split(';')) { const [k, xy] = part.split(':'); if (xy) { const [x, y] = xy.split(',').map(Number); pos[k] = [x, y]; } }
    const keyStr = (k) => (typeof k === 'string' ? k : vrepr(k));
    const names = adj.map(([k]) => keyStr(k));
    names.forEach((n, i) => { if (!pos[n]) { const a = (2 * Math.PI * i) / names.length; pos[n] = [160 + 120 * Math.cos(a), 130 + 100 * Math.sin(a)]; } });
    const setOf = (v) => {
      if (!v) return new Set();
      const r2 = lookup(frame, v);
      if (!r2.found) return new Set();
      let items = seq(r2.v);
      if (!items && r2.v && r2.v.$d) items = r2.v.$d.map(([k]) => k);
      if (!items) items = [r2.v];
      return new Set(items.map((x) => keyStr(Array.isArray(x) ? x[0] : (x && x.$t ? x.$t[x.$t.length - 1] : x))));
    };
    const visited = setOf(spec.visited);
    const frontier = setOf(spec.frontier);
    const cur = spec.current ? lookup(frame, spec.current) : { found: false };
    const curName = cur.found ? keyStr(cur.v) : null;
    let dist = null;
    if (spec.dist) { const dr = lookup(frame, spec.dist); if (dr.found && dr.v && dr.v.$d) { dist = {}; dr.v.$d.forEach(([k, x]) => { dist[keyStr(k)] = x; }); } }
    const directed = spec.directed === '1';
    const xs = Object.values(pos).map((p) => p[0]), ys = Object.values(pos).map((p) => p[1]);
    const W = Math.max(...xs) + 60, H = Math.max(...ys) + 60;
    let s = `<svg class="dsv" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="graph">`;
    s += '<defs><marker id="garr" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#7A8496"/></marker></defs>';
    const drawn = new Set();
    for (const [k, nbrs] of adj) {
      const a = keyStr(k);
      for (const nb of seq(nbrs) || []) {
        let b = nb, w = null;
        if (nb && nb.$t) { b = nb.$t[0]; w = nb.$t[1]; }
        b = keyStr(b);
        if (!pos[b]) continue;
        const key = directed ? a + '>' + b : [a, b].sort().join('|');
        if (drawn.has(key)) continue;
        drawn.add(key);
        const [x1, y1] = pos[a], [x2, y2] = pos[b];
        const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1;
        const sx = x1 + (dx / L) * 20, sy = y1 + (dy / L) * 20, ex = x2 - (dx / L) * 22, ey = y2 - (dy / L) * 22;
        s += `<line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="#4A5262" stroke-width="1.5" ${directed ? 'marker-end="url(#garr)"' : ''}/>`;
        if (w !== null) s += `<text x="${(x1 + x2) / 2 + 6}" y="${(y1 + y2) / 2 - 6}" font-size="12" fill="#C9CED8">${esc(vrepr(w))}</text>`;
      }
    }
    for (const n of names) {
      const [x, y] = pos[n];
      const isCur = n === curName, isV = visited.has(n), isF = frontier.has(n);
      const fill = isCur ? 'rgba(255,212,59,0.25)' : isV ? 'rgba(74,222,128,0.16)' : '#0E1117';
      const stroke = isCur ? '#FFD43B' : isF ? '#8AB4FF' : isV ? '#4ADE80' : '#4A5366';
      s += `<circle cx="${x}" cy="${y}" r="20" fill="${fill}" stroke="${stroke}" stroke-width="${isF || isCur ? 2.5 : 1.5}" ${isF && !isCur ? 'stroke-dasharray="4 3"' : ''}/>`;
      s += `<text x="${x}" y="${y + 5}" text-anchor="middle" font-size="14" font-weight="600" fill="#E7E9EE">${esc(n)}</text>`;
      if (dist && dist[n] !== undefined) {
        const dv = dist[n] && dist[n].$f === 'inf' ? '∞' : vrepr(dist[n]);
        s += `<text x="${x}" y="${y + 38}" text-anchor="middle" font-size="12" fill="#FFCB6B">${esc(dv)}</text>`;
      }
    }
    s += '</svg>';
    const leg = [];
    if (spec.current) leg.push('<span><i style="background:rgba(255,212,59,.6)"></i>current</span>');
    if (spec.visited) leg.push('<span><i style="background:rgba(74,222,128,.5)"></i>visited</span>');
    if (spec.frontier) leg.push('<span><i style="border:2px dashed #8AB4FF"></i>waiting</span>');
    if (dist) leg.push('<span><i style="background:#FFCB6B"></i>distance</span>');
    if (leg.length) s += '<div class="legend">' + leg.join('') + '</div>';
    return s;
  }

  // ----- growth chart (SVG) -----
  const SERIES = ['#4ADE80', '#8AB4FF', '#FFD43B', '#FF9E64', '#FF7B72', '#C792EA'];
  function viewChart(spec, frame, allFrames, fi) {
    const labels = spec.labels || [];
    const upto = allFrames.slice(0, fi + 1);
    const log = spec.scale === 'log';
    const maxN = allFrames[allFrames.length - 1].n;
    let maxV = 1;
    allFrames.forEach((f) => f.vals.forEach((v) => { maxV = Math.max(maxV, v); }));
    const fmt = (v) => Math.round(v).toLocaleString('en-US');
    const ticks = log ? [1, 10, 100, 1000, 10000, 100000, 1000000].filter((t) => t <= maxV) : [0, maxV / 2, maxV];
    // Make room for the widest tick label on the left and the widest end-of-line tag on the right.
    const tagWidth = Math.max(0, ...labels.map((lab, si) => (lab.replace(/_/g, ' ') + ' = ' + fmt(Math.max(...allFrames.map((f) => f.vals[si])))).length));
    const W = 520, H = 260, B = 34, T = 14;
    const L = Math.max(56, Math.ceil(14 + 6.7 * Math.max(...ticks.map((t) => fmt(t).length))));
    const Rr = Math.max(120, Math.ceil(16 + 7 * tagWidth));
    const xOf = (n) => L + ((n - allFrames[0].n) / Math.max(1, maxN - allFrames[0].n)) * (W - L - Rr);
    const yOf = (v) => {
      if (log) { const lv = Math.log10(Math.max(1, v)), lm = Math.log10(maxV); return H - B - (lv / Math.max(1, lm)) * (H - B - T); }
      return H - B - (v / maxV) * (H - B - T);
    };
    let s = `<svg class="dsv" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="growth chart">`;
    s += `<line x1="${L}" y1="${H - B}" x2="${W - Rr}" y2="${H - B}" stroke="#4A5262"/><line x1="${L}" y1="${T}" x2="${L}" y2="${H - B}" stroke="#4A5262"/>`;
    for (const t of ticks) {
      const y = yOf(t);
      s += `<line x1="${L}" y1="${y}" x2="${W - Rr}" y2="${y}" stroke="#262B36"/><text x="${L - 6}" y="${y + 4}" text-anchor="end" font-size="11" fill="#7A8496">${fmt(t)}</text>`;
    }
    s += `<text x="${(L + W - Rr) / 2}" y="${H - 6}" text-anchor="middle" font-size="11" fill="#7A8496">n (input size)</text>`;
    const last = upto[upto.length - 1];
    const tags = [];
    labels.forEach((lab, si) => {
      const pts = upto.map((f) => `${xOf(f.n).toFixed(1)},${yOf(f.vals[si]).toFixed(1)}`).join(' ');
      const color = SERIES[si % SERIES.length];
      s += `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.2"/>`;
      s += `<circle cx="${xOf(last.n)}" cy="${yOf(last.vals[si])}" r="3.5" fill="${color}"/>`;
      tags.push({ y: yOf(last.vals[si]) + 4, color, text: `${lab.replace(/_/g, ' ')} = ${fmt(last.vals[si])}` });
    });
    tags.sort((p, q) => q.y - p.y);
    for (let k = 1; k < tags.length; k++) if (tags[k].y > tags[k - 1].y - 13) tags[k].y = tags[k - 1].y - 13;
    for (const t of tags) s += `<text x="${xOf(last.n) + 8}" y="${t.y.toFixed(1)}" font-size="11.5" fill="${t.color}">${esc(t.text)}</text>`;
    return s + '</svg>';
  }

  const VIEWS = {
    vars: ['Variables', viewVars], array: [null, viewArray], bars: [null, viewBars], grid: [null, viewGrid],
    stack: ['Stack', viewStack], queue: ['Queue', viewQueue], linked: ['Linked list', viewLinked], tree: ['Tree', viewTree],
    heap: ['Heap', viewHeap], graph: ['Graph', viewGraph], buckets: ['Buckets', viewBuckets], callstack: ['Call stack', viewCallstack],
    dict: [null, viewDict], set: [null, viewSet], steps: ['Step counter', viewSteps], chart: ['Growth', null],
  };

  function renderViews(anim, fi) {
    const frames = anim.frames || [];
    const frame = frames[fi];
    const prev = fi > 0 ? frames[fi - 1] : null;
    if (!frame) return '';
    return anim.views.filter((v) => v.type !== 'output').map((spec) => {
      const def = VIEWS[spec.type];
      if (!def) return '';
      let title = spec.title ? spec.title.replace(/_/g, ' ') : def[0] || ((spec.vars && spec.vars[0]) || spec.type);
      let body;
      try {
        body = spec.type === 'chart' ? viewChart(spec, frame, frames, fi) : def[1](spec, frame, prev);
      } catch (e) {
        body = '<div class="emptyv">(could not draw this view)</div>';
      }
      return `<section class="view"><h5>${esc(title)}</h5>${body}</section>`;
    }).join('');
  }

  window.AnimViews = { renderViews, vrepr };
})();
