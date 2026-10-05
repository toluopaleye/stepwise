/* Stepwise app: learn -> 30 tasks (10 easy, 10 medium, 10 hard) -> feedback, in the Workbench layout. */
(function () {
  'use strict';
  const C = window.COURSE;
  const PR = window.PyRun;
  const AV = window.AnimViews;
  const root = document.getElementById('app');

  // ---------------------------------------------------------------- utils
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ICONS = {
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    clock: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 2h6"/>',
    play: '<path d="M7 4v16l13-8z"/>',
    bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
    flame: '<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.2 1-3.7 2.2-4.8.3 1.6 1.2 2.6 2.3 2.8C11 8.6 11 6 12 3z"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>',
    box: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    up: '<path d="m6 15 6-6 6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    indent: '<path d="M3 6h18M11 12h10M11 18h10M3 10l4 3-4 3"/>',
    outdent: '<path d="M3 6h18M11 12h10M11 18h10M7 10l-4 3 4 3"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    restart: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    back: '<path d="M19 20 9 12l10-8zM5 5v14"/>',
    fwd: '<path d="m5 4 10 8-10 8zM19 5v14"/>',
    film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
    code: '<path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m14 6 4 4"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/>',
  };
  const icon = (n, extra) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"${extra ? ' ' + extra : ''}>${ICONS[n] || ''}</svg>`;
  const tmpDiv = document.createElement('div');
  const htmlToText = (h) => { tmpDiv.innerHTML = h || ''; return tmpDiv.textContent || ''; };
  const IRREG = { try: 'tries', box: 'boxes', entry: 'entries' };
  const plural = (n, w) => `${n} ${n === 1 ? w : (IRREG[w] || w + 's')}`;
  const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00') - Date.parse(a + 'T00:00:00')) / 86400000);
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } }

  // ---------------------------------------------------------------- syntax highlighting
  const KW = new Set(['and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield']);
  const BI = new Set(['True', 'False', 'None', 'print', 'len', 'range', 'int', 'str', 'float', 'list', 'dict', 'set', 'tuple', 'bool', 'sum', 'min', 'max', 'sorted', 'reversed', 'enumerate', 'zip', 'map', 'filter', 'abs', 'round', 'input', 'type', 'isinstance', 'any', 'all', 'chr', 'ord', 'super', 'self', 'object', 'iter', 'next', 'divmod', 'pow', 'hash', 'repr', 'open']);
  const TOK = /((?:\b[rRbBfFuU]{1,2})?(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?))|(#[^\n]*)|(\b0[xXbBoO][0-9a-fA-F_]+\b|\b\d[\d_]*(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+\b)|([A-Za-z_][A-Za-z0-9_]*)|(\n)|([^\S\n]+)|([\s\S])/g;
  function hl(code) {
    const lines = [''];
    const push = (text, cls) => {
      const parts = text.split('\n');
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) lines.push('');
        if (parts[i]) lines[lines.length - 1] += cls ? `<span class="${cls}">${esc(parts[i])}</span>` : esc(parts[i]);
      }
    };
    let m, expectName = false;
    TOK.lastIndex = 0;
    while ((m = TOK.exec(code)) !== null) {
      if (m[0] === '') { TOK.lastIndex++; continue; }
      if (m[1]) push(m[1], 'st');
      else if (m[2]) push(m[2], 'cm');
      else if (m[3]) push(m[3], 'nu');
      else if (m[4]) {
        const w = m[4];
        let cls = null;
        if (expectName) { cls = 'fn'; expectName = false; }
        else if (KW.has(w)) { cls = 'kw'; if (w === 'def' || w === 'class') expectName = true; }
        else if (BI.has(w)) cls = 'bi';
        else if (/^\s*\(/.test(code.slice(TOK.lastIndex, TOK.lastIndex + 40))) cls = 'fn';
        push(w, cls);
      } else if (m[5]) push('\n', null);
      else push(m[0], null);
    }
    return lines;
  }
  function codeRows(code, o) {
    o = o || {};
    const lines = hl(code);
    return lines.map((h, i) => {
      const n = i + 1;
      const cls = ['cl'];
      if (o.hot && o.hot.indexOf(n) >= 0) cls.push('hot');
      if (o.cur === n) cls.push('cur');
      if (o.prev === n && o.cur !== n) cls.push('prev');
      if (o.sel && n >= o.sel[0] && n <= o.sel[1]) cls.push('sel');
      if (o.err === n) cls.push('errl');
      if (o.clickable) cls.push('clickable');
      const tag = o.tags && o.tags[n] ? `<span class="tag">${esc(o.tags[n])}</span>` : '';
      const act = o.clickable ? ` data-act="exline" data-line="${n}"` : '';
      return `<div class="${cls.join(' ')}"${act}><span class="ln" aria-hidden="true">${n}</span><span class="tx">${h || ' '}</span>${tag}</div>`;
    }).join('');
  }
  function highlightSnippets(scope) {
    scope.querySelectorAll('pre.snippet:not([data-done])').forEach((pre) => {
      const lang = pre.getAttribute('data-lang') || 'python';
      if (lang === 'output' || lang === 'text') pre.classList.add('out');
      else pre.innerHTML = hl(pre.textContent).join('\n');
      pre.setAttribute('data-done', '1');
    });
  }
  function miniMd(text) {
    const parts = String(text).split(/```(?:python)?\n?([\s\S]*?)```/g);
    return parts.map((p, i) => {
      if (i % 2 === 1) return `<pre class="snippet" data-done="1">${hl(p.replace(/\n$/, '')).join('\n')}</pre>`;
      return esc(p).replace(/`([^`\n]+)`/g, '<code class="ic">$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    }).join('');
  }

  // ---------------------------------------------------------------- course index
  const ORDER = [];
  const INFO = {};
  const LESSONS = C.lessons || {};
  C.units.forEach((u, ui) => {
    u.items.forEach((it, k) => {
      if (it.id) {
        INFO[it.id] = { unit: u, unitIdx: ui, num: String(k + 1), total: u.items.length, title: it.title, n: it.n || 30, parent: null };
        ORDER.push(it.id);
      }
      (it.children || []).forEach((ch, j) => {
        if (!ch.id) return;
        INFO[ch.id] = { unit: u, unitIdx: ui, num: `${k + 1}.${j + 1}`, total: u.items.length, title: ch.title, n: ch.n || 30, parent: it.id ? it : { title: it.title } };
        ORDER.push(ch.id);
      });
    });
  });
  const loading = {};
  function loadLesson(id) {
    if (LESSONS[id]) return Promise.resolve(LESSONS[id]);
    if (!loading[id]) {
      loading[id] = fetch('lessons/' + id + '.json').then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then((L) => { LESSONS[id] = L; return L; })
        .catch((e) => { delete loading[id]; throw e; });
    }
    return loading[id];
  }
  function ntasks(id) { return LESSONS[id] ? LESSONS[id].tasks.length : (INFO[id] ? INFO[id].n : 30); }
  const DIFF_NAME = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
  const TASK_XP = { easy: 10, medium: 15, hard: 20 };
  const TYPE_NAME = { mcq: 'Multiple choice', multi: 'Choose all that apply', predict: 'Predict the output', fill: 'Fill in the blank', parsons: 'Arrange the lines', code: 'Write the code', cells: 'Trace it', order: 'Put in order' };

  // ---------------------------------------------------------------- progress
  const PKEY = 'stepwise-progress-v1';
  function blankProgress() { return { v: 1, xp: 0, streak: { day: null, count: 0 }, lessons: {}, last: null, updated: 0 }; }
  let prog = blankProgress();
  try { const raw = lsGet(PKEY); if (raw) prog = Object.assign(blankProgress(), JSON.parse(raw)); } catch (e) { prog = blankProgress(); }
  let cloudRef = null, saving = false, dirty = false, saveTimer = null;
  function mergeProgress(a, b) {
    const out = blankProgress();
    out.xp = Math.max(a.xp || 0, b.xp || 0);
    const sa = a.streak || {}, sb = b.streak || {};
    out.streak = (sa.day || '') > (sb.day || '') ? sa : (sb.day || '') > (sa.day || '') ? sb : { day: sa.day || sb.day || null, count: Math.max(sa.count || 0, sb.count || 0) };
    const ids = new Set([...Object.keys(a.lessons || {}), ...Object.keys(b.lessons || {})]);
    for (const id of ids) {
      const la = (a.lessons || {})[id] || {}, lb = (b.lessons || {})[id] || {};
      const t = {};
      const keys = new Set([...Object.keys(la.t || {}), ...Object.keys(lb.t || {})]);
      for (const k of keys) {
        const x = (la.t || {})[k], y = (lb.t || {})[k];
        if (!x) t[k] = y; else if (!y) t[k] = x;
        else t[k] = x.s === 'ok' && y.s !== 'ok' ? x : y.s === 'ok' && x.s !== 'ok' ? y : (x.tries || 0) >= (y.tries || 0) ? x : y;
      }
      out.lessons[id] = { learn: !!(la.learn || lb.learn), t };
    }
    out.last = (a.updated || 0) >= (b.updated || 0) ? a.last : b.last;
    out.updated = Math.max(a.updated || 0, b.updated || 0);
    return out;
  }
  async function flushCloud() {
    if (!cloudRef) return;
    if (saving) { dirty = true; return; }
    saving = true;
    try { await cloudRef.set(JSON.parse(JSON.stringify(prog))); } catch (e) { /* keep local copy */ }
    saving = false;
    if (dirty) { dirty = false; flushCloud(); }
  }
  function saveProgress() {
    prog.updated = Date.now();
    lsSet(PKEY, JSON.stringify(prog));
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushCloud, 1200);
  }
  function lessonProg(lid) { if (!prog.lessons[lid]) prog.lessons[lid] = { learn: false, t: {} }; return prog.lessons[lid]; }
  function taskProg(lid, i) { const lp = prog.lessons[lid]; return lp && lp.t ? lp.t[i] : null; }
  function doneCount(lid) { const lp = prog.lessons[lid]; if (!lp) return 0; return Object.values(lp.t || {}).filter((x) => x.s === 'ok').length; }
  function bumpStreak() {
    const t = todayStr();
    const st = prog.streak || { day: null, count: 0 };
    if (st.day === t) return;
    if (st.day && dayDiff(st.day, t) === 1) st.count = (st.count || 0) + 1;
    else st.count = 1;
    st.day = t;
    prog.streak = st;
  }
  function streakCount() {
    const st = prog.streak || {};
    if (!st.day) return 0;
    const d = dayDiff(st.day, todayStr());
    return d <= 1 ? st.count || 0 : 0;
  }
  // drafts of code answers (per-viewer convenience)
  const DKEY = 'stepwise-drafts-v1';
  let drafts = {};
  try { drafts = JSON.parse(lsGet(DKEY) || '{}') || {}; } catch (e) { drafts = {}; }
  let draftTimer = null;
  function saveDraft(key, code) { drafts[key] = code; clearTimeout(draftTimer); draftTimer = setTimeout(() => lsSet(DKEY, JSON.stringify(drafts)), 500); }

  // ---------------------------------------------------------------- view state
  const S = {
    lesson: ORDER[0],
    step: 0,
    tab: 'ex0',
    drawer: false,
    ts: {},
    ex: {},
    anim: { key: null, i: 0, playing: false, speed: 1, timer: null },
  };
  function tkey(lid, step) { return lid + ':' + step; }
  function TS(lid, step) {
    const k = tkey(lid, step);
    if (!S.ts[k]) {
      const L = LESSONS[lid], T = L.tasks[step - 1];
      const st = { hints: 0, tries: 0, revealed: false, result: null, run: null, ask: null, tab: 'solution' };
      if (T.type === 'multi') st.sel = [];
      if (T.type === 'mcq') st.sel = null;
      if (T.type === 'predict') st.text = '';
      if (T.type === 'fill') st.fills = T.answers.map(() => '');
      if (T.type === 'parsons') st.placed = [];
      if (T.type === 'cells') st.cells = T.answer ? T.answer.map(() => '') : [];
      if (T.type === 'order') st.order = T.shuffled.slice();
      if (T.type === 'code') st.code = drafts[k] !== undefined ? drafts[k] : T.starter;
      const tp = taskProg(lid, step - 1);
      if (tp) { st.tries = tp.tries || 0; st.hints = tp.hints || 0; }
      S.ts[k] = st;
    }
    return S.ts[k];
  }
  if (prog.last && INFO[prog.last.lesson]) { S.lesson = prog.last.lesson; S.step = Math.min(prog.last.step || 0, ntasks(prog.last.lesson)); }
  const hashId = decodeURIComponent((location.hash || '').slice(1));
  if (hashId && INFO[hashId]) { S.lesson = hashId; S.step = 0; }

  // ---------------------------------------------------------------- Claude (sample)
  let sampleFn = null;

  // ---------------------------------------------------------------- render: header
  function segButton(s, lp, label) {
    const cls = [];
    if (s === 0) { cls.push('learn'); if (lp.learn) cls.push('done'); }
    else { const t = (lp.t || {})[s - 1]; if (t && t.s === 'ok') cls.push('done'); else if (t && t.s === 'tried') cls.push('tried'); }
    if (s === S.step) cls.push('cur');
    const solved = s > 0 && (lp.t || {})[s - 1] && lp.t[s - 1].s === 'ok';
    const lab = label + (solved ? ' (solved)' : '');
    return `<li><button class="${cls.join(' ')}" data-act="step" data-step="${s}" aria-label="${lab}" title="${lab}"${s === S.step ? ' aria-current="step"' : ''}></button></li>`;
  }
  function headerHTML() {
    const L = LESSONS[S.lesson];
    const info = INFO[S.lesson];
    const lp = prog.lessons[S.lesson] || { t: {} };
    let segs = segButton(0, lp, 'Learn');
    if (L) {
      for (const d of ['easy', 'medium', 'hard']) {
        const idx = L.tasks.map((t, i) => (t.diff === d ? i + 1 : 0)).filter(Boolean);
        if (!idx.length) continue;
        segs += `<li class="sgroup"><span class="glab">${DIFF_NAME[d]}</span><ol>${idx.map((s, k) => segButton(s, lp, `Task ${s}, ${DIFF_NAME[d].toLowerCase()} ${k + 1} of ${idx.length}`)).join('')}</ol></li>`;
      }
    }
    const here = S.step === 0 ? 'Learn' : `Task ${S.step} of ${ntasks(S.lesson)}`;
    const crumbs = info.parent ? `<span>${esc(htmlToText(info.parent.title))}</span><span class="sep" aria-hidden="true">/</span>` : '';
    return `<header class="appbar">
      <button class="wordmark" data-act="drawer" aria-label="Open the course map">stepwise<span>_</span></button>
      <nav class="crumbs" aria-label="Breadcrumb"><button data-act="drawer">Unit ${info.unitIdx + 1} · ${esc(info.unit.title)}</button><span class="sep" aria-hidden="true">/</span>${crumbs}<span>${esc(htmlToText(info.title))}</span><span class="sep" aria-hidden="true">/</span><span class="here">${here}</span></nav>
      <div class="spacer"></div>
      <ol class="segs" aria-label="Lesson progress: ${here}">${segs}</ol>
      <div class="stats"><span>${icon('flame', 'style="color:var(--orange)"')}${plural(streakCount(), 'day')} streak</span><span>${icon('bolt', 'style="color:var(--accent)"')}${prog.xp || 0} XP</span></div>
    </header>`;
  }

  // ---------------------------------------------------------------- render: learn
  function learnLeft(L) {
    const info = INFO[L.id];
    const done = doneCount(L.id);
    const steps = L.learn.map((s, i) => `<section class="step"><span class="step-n" aria-hidden="true">${i + 1}</span><div>${s.h ? `<h3>${esc(s.h)}</h3>` : ''}<div class="prose">${s.html}</div></div></section>`).join('');
    const where = info.parent ? `<b>Lesson ${info.num}</b> · part of ${esc(htmlToText(info.parent.title))}` : `<b>Lesson ${info.num} of ${info.total}</b> · ${esc(info.unit.title)}`;
    return `<div class="chip">${icon('book', 'style="color:var(--accent)"')}<span>${where} · ${done}/${L.tasks.length} tasks solved</span></div>
      <div class="block">
        <div class="label">Learn</div>
        <h1 class="title">${L.title}</h1>
        <div class="prose"><p>${L.summary}</p></div>
      </div>
      <div class="steps">${steps}</div>
      <div class="keypoints"><h3>Key points</h3><ul>${L.keypoints.map((k) => `<li>${k}</li>`).join('')}</ul></div>
      <div class="block">
        <div class="prose"><p>On the right: ${plural(L.examples.length, 'example')} you can run and edit, and ${plural(L.anims.length, 'animation')} that step through the code line by line. Then try the ${L.tasks.length} tasks: ${taskMixText(L)}.</p></div>
        <div class="lesson-actions"><button class="btn primary" data-act="step" data-step="1">Start the ${L.tasks.length} tasks ${icon('arrow')}</button></div>
      </div>`;
  }

  function taskMixText(L) {
    const c = { easy: 0, medium: 0, hard: 0 };
    L.tasks.forEach((t) => { c[t.diff] = (c[t.diff] || 0) + 1; });
    return `${c.easy} easy, ${c.medium} medium and ${c.hard} hard`;
  }

  function learnTabs(L) {
    const tabs = [];
    L.examples.forEach((e, i) => tabs.push(`<button class="tab" aria-pressed="${S.tab === 'ex' + i}" data-act="tab" data-tab="ex${i}">${icon('code')}example_${i + 1}.py</button>`));
    L.anims.forEach((a, i) => tabs.push(`<button class="tab" aria-pressed="${S.tab === 'an' + i}" data-act="tab" data-tab="an${i}">${icon('film')}animation_${i + 1}</button>`));
    return tabs.join('');
  }

  function exState(L, i) {
    const k = L.id + ':ex' + i;
    if (!S.ex[k]) S.ex[k] = { code: L.examples[i].code, editing: false, run: null, sel: null };
    return S.ex[k];
  }

  function learnRight(L) {
    const isAnim = S.tab.startsWith('an');
    const idx = parseInt(S.tab.slice(2), 10) || 0;
    let toolbar = '<div class="tabs">' + learnTabs(L) + '</div><div class="spacer"></div>';
    let body = '';
    if (!isAnim) {
      const ex = L.examples[idx];
      const es = exState(L, idx);
      toolbar += `<button class="btn" data-act="exrun">${icon('play')}Run</button>`;
      toolbar += es.editing ? `<button class="btn quiet" data-act="exreset">Reset</button>` : `<button class="btn quiet" data-act="exedit">${icon('edit')}Edit</button>`;
      const head = `<div class="codehead" style="padding-top:18px"><b>Example ${idx + 1} · ${esc(ex.title)}</b>${ex.intro ? `<span>${ex.intro}</span>` : ''}</div>`;
      const code = es.editing
        ? editorHTML('ex-editor', es.code) + '<div class="edhint">Change anything, then press Run. Ctrl+Enter also runs it.</div>'
        : `<div class="codearea" style="padding-top:6px">${codeRows(ex.code, { sel: es.sel, clickable: true })}</div>`;
      let out = es.run ? es.run : { stdout: ex.output, error: ex.errorText ? { traceback: ex.errorText } : null, live: false };
      const outHTML = `<div class="card wide"><div class="card-h"><b>Output</b><span style="color:var(--muted)">${es.run ? 'ran in your browser' : 'what Python prints'}</span></div>`
        + (out.stdout ? `<pre class="console">${esc(out.stdout)}</pre>` : (out.error ? '' : '<pre class="console empty">(nothing printed)</pre>'))
        + (out.error ? `<pre class="console err" style="margin-top:8px">${esc(out.error.traceback || (out.error.type + ': ' + out.error.message))}</pre>` : '') + '</div>';
      const notes = ex.notes.length ? `<div class="card wide"><div class="card-h"><b>Line by line</b><span style="color:var(--muted)">tap a note to highlight its line</span></div><ul class="trows" style="font-family:var(--sans);font-size:14px;gap:8px">${ex.notes.map((nt) => `<li><button class="btn small quiet" data-act="exnote" data-from="${nt.from}" data-to="${nt.to}" style="min-width:76px;font-family:var(--mono)">${nt.from === nt.to ? 'Line ' + nt.from : 'Lines ' + nt.from + '–' + nt.to}</button><span class="call" style="color:var(--fg2);padding-top:8px">${nt.html}</span></li>`).join('')}</ul></div>` : '';
      body = head + code + `<div class="results"><div class="cards">${outHTML}${notes}</div></div>`;
    } else {
      const an = L.anims[idx];
      const head = `<div class="codehead" style="padding-top:18px"><b>Animation ${idx + 1} · ${esc(an.title)}</b>${an.intro ? `<span>${an.intro}</span>` : ''}</div>`;
      const codeHtml = an.code ? `<div class="codearea" id="anim-code" style="padding-top:6px"></div>` : '';
      body = head + codeHtml + `<div class="results"><div class="player" id="anim-player"></div></div>`;
    }
    return `<div class="toolbar">${toolbar}</div>${body}`;
  }

  // ---------------------------------------------------------------- animation player
  function animKey() { return S.lesson + ':' + S.tab; }
  function animFrame(an) { return an.frames[Math.min(S.anim.i, an.frames.length - 1)]; }
  function autoCaption(an, f) {
    if (f.cap) return f.cap;
    if (an.views[0] && an.views[0].type === 'chart') return f.cap || `n = ${f.n}`;
    if (f.ev === 'end' && f.err) return `Python stopped with an error on line ${f.l}: \`${f.err}\`. Lines after it never ran.`;
    if (f.ev === 'end') return f.out ? 'The program has finished. Everything it printed is in the output box.' : 'The program has finished.';
    if (f.ev === 'return') { const fn = (f.st[f.st.length - 1] || {}).fn || 'the function'; return `${fn}() is done and hands back ${AV.vrepr(f.ret)}.`; }
    const line = (an.code.split('\n')[f.l - 1] || '').trim();
    return `Next, Python runs line ${f.l}: ${line}`;
  }
  function renderAnim() {
    const L = LESSONS[S.lesson];
    if (!S.tab.startsWith('an')) return;
    const an = L.anims[parseInt(S.tab.slice(2), 10) || 0];
    if (!an || !an.frames || !an.frames.length) return;
    if (S.anim.key !== animKey()) { stopAnim(); S.anim.key = animKey(); S.anim.i = 0; }
    const fi = Math.min(S.anim.i, an.frames.length - 1);
    const f = an.frames[fi];
    const prevF = fi > 0 ? an.frames[fi - 1] : null;
    const codeEl = document.getElementById('anim-code');
    if (codeEl) {
      const cur = f.ev === 'end' ? null : f.l;
      const prevLine = prevF && prevF.ev !== 'end' ? prevF.l : null;
      codeEl.innerHTML = codeRows(an.code, { cur, prev: f.err ? null : prevLine, err: f.err ? f.l : null });
      const curEl = codeEl.querySelector('.cl.cur');
      if (curEl && S.anim.playing) { const pane = codeEl.closest('.editor-pane'); if (pane) { const r = curEl.getBoundingClientRect(), pr = pane.getBoundingClientRect(); if (r.top < pr.top + 60 || r.bottom > pr.bottom - 20) curEl.scrollIntoView({ block: 'nearest' }); } }
    }
    const pl = document.getElementById('anim-player');
    if (!pl) return;
    const total = an.frames.length;
    const isChart = an.views[0] && an.views[0].type === 'chart';
    const output = isChart ? '' : `<section class="view"><h5>Output</h5>${f.out ? `<pre class="console">${esc(f.out)}</pre>` : '<pre class="console empty">(nothing printed yet)</pre>'}</section>`;
    pl.innerHTML = `<div class="caption" aria-live="polite"><b>${fi + 1}/${total}</b>${miniMd(autoCaption(an, f))}</div>
      <div class="pctl">
        <button class="ib" data-act="anim-restart" aria-label="Back to the start">${icon('restart')}</button>
        <button class="ib" data-act="anim-prev" aria-label="Previous step">${icon('back')}</button>
        <button class="ib play" data-act="anim-play" aria-label="${S.anim.playing ? 'Pause' : 'Play'}">${icon(S.anim.playing ? 'pause' : 'play')}</button>
        <button class="ib" data-act="anim-next" aria-label="Next step">${icon('fwd')}</button>
        <span class="pos">step ${fi + 1} of ${total}</span>
        <label class="sr" for="anim-speed">Speed</label>
        <select id="anim-speed" data-act="anim-speed">${[0.5, 1, 2, 4].map((s) => `<option value="${s}"${S.anim.speed === s ? ' selected' : ''}>${s}× speed</option>`).join('')}</select>
      </div>
      <label class="sr" for="anim-scrub">Jump to step</label>
      <input class="scrub" id="anim-scrub" type="range" min="0" max="${total - 1}" value="${fi}" data-act="anim-scrub">
      <div class="views">${AV.renderViews(an, fi)}${output}</div>`;
  }
  function stopAnim() { S.anim.playing = false; clearTimeout(S.anim.timer); S.anim.timer = null; }
  function tickAnim() {
    const L = LESSONS[S.lesson];
    if (!S.tab.startsWith('an')) { stopAnim(); return; }
    const an = L.anims[parseInt(S.tab.slice(2), 10) || 0];
    if (S.anim.i >= an.frames.length - 1) { stopAnim(); renderAnim(); return; }
    S.anim.i++;
    renderAnim();
    S.anim.timer = setTimeout(tickAnim, 1300 / S.anim.speed);
  }

  // ---------------------------------------------------------------- editor
  function editorHTML(id, code) {
    const lines = code.split('\n').length;
    let gut = '';
    for (let i = 1; i <= lines; i++) gut += i + (i < lines ? '\n' : '');
    return `<div class="editor"><div class="gut" aria-hidden="true">${gut}</div><div class="ed"><pre aria-hidden="true">${hl(code).join('\n')}\n</pre><textarea id="${id}" spellcheck="false" autocomplete="off" autocapitalize="off" autocorrect="off" wrap="off" aria-label="Code editor. Tab indents, Escape then Tab leaves the editor.">${esc(code)}</textarea></div></div>`;
  }
  function mountEditor(id, onChange, onRun) {
    const ta = document.getElementById(id);
    if (!ta) return;
    const pre = ta.previousElementSibling;
    const gut = ta.closest('.editor').querySelector('.gut');
    let escPressed = false;
    const sync = () => {
      const v = ta.value;
      pre.innerHTML = hl(v).join('\n') + '\n';
      const n = v.split('\n').length;
      let g = '';
      for (let i = 1; i <= n; i++) g += i + (i < n ? '\n' : '');
      gut.textContent = g;
      onChange(v);
    };
    const insert = (text) => {
      ta.focus();
      let ok = false;
      try { ok = document.execCommand('insertText', false, text); } catch (e) { ok = false; }
      if (!ok) { ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end'); }
      sync();
    };
    ta.addEventListener('input', sync);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { escPressed = true; return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); onRun(); return; }
      const v = ta.value, s = ta.selectionStart, en = ta.selectionEnd;
      if (e.key === 'Tab') {
        if (escPressed) { escPressed = false; return; }
        e.preventDefault();
        const ls = v.lastIndexOf('\n', s - 1) + 1;
        if (s !== en && v.slice(s, en).indexOf('\n') >= 0) {
          const le = en;
          const block = v.slice(ls, le);
          const out = e.shiftKey ? block.replace(/^ {1,4}/gm, '') : block.replace(/^/gm, '    ');
          ta.setSelectionRange(ls, le);
          insert(out);
          ta.setSelectionRange(ls, ls + out.length);
          return;
        }
        if (e.shiftKey) {
          const lineStart = ls;
          const lead = v.slice(lineStart).match(/^ {1,4}/);
          if (lead) { ta.setSelectionRange(lineStart, lineStart + lead[0].length); insert(''); ta.setSelectionRange(Math.max(lineStart, s - lead[0].length), Math.max(lineStart, s - lead[0].length)); }
          return;
        }
        insert('    ');
        return;
      }
      escPressed = false;
      if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        const ls = v.lastIndexOf('\n', s - 1) + 1;
        const line = v.slice(ls, s);
        let ind = line.match(/^ */)[0];
        if (/:\s*(#.*)?$/.test(line)) ind += '    ';
        else if (/^\s*(return|pass|break|continue|raise)\b/.test(line)) ind = ind.slice(0, Math.max(0, ind.length - 4));
        insert('\n' + ind);
        return;
      }
      if (e.key === 'Backspace' && s === en && s > 0) {
        const ls = v.lastIndexOf('\n', s - 1) + 1;
        const before = v.slice(ls, s);
        if (before.length >= 4 && /^ +$/.test(before)) {
          e.preventDefault();
          const del = before.length % 4 === 0 ? 4 : before.length % 4;
          ta.setSelectionRange(s - del, s);
          insert('');
        }
      }
    });
  }

  // ---------------------------------------------------------------- render: task (left)
  function chipForPrevious(L) {
    if (S.step <= 1) {
      const lp = prog.lessons[L.id];
      return `<div class="chip">${icon(lp && lp.learn ? 'check' : 'book', `style="color:${lp && lp.learn ? 'var(--pass)' : 'var(--accent)'}"`)}<span><b>Learn · ${L.title}</b>${lp && lp.learn ? ' — read' : ' — <button class="btn ghost small" style="min-height:auto;padding:0" data-act="step" data-step="0">open the lesson</button>'}</span></div>`;
    }
    const pi = S.step - 2;
    const T = L.tasks[pi];
    const tp = taskProg(L.id, pi);
    let what;
    if (tp && tp.s === 'ok') what = `<span class="ok">${tp.tries <= 1 ? 'right on the first try' : 'right after ' + plural(tp.tries, 'try')}</span>`;
    else if (tp && tp.s === 'tried') what = '<span class="no">not solved yet</span>';
    else what = 'not tried yet';
    return `<div class="chip">${icon(tp && tp.s === 'ok' ? 'check' : 'x', `style="color:${tp && tp.s === 'ok' ? 'var(--pass)' : 'var(--muted)'}"`)}<span><b>Task ${pi + 1} · ${T.title}</b> — ${what}</span></div>`;
  }
  function taskLeft(L, T, ts) {
    const recapOpen = S.step <= 2 ? ' open' : '';
    let checks = '';
    if (T.type === 'code') {
      const items = [];
      if (T.mode === 'stdout') items.push(`${icon('box')}Output must match exactly`);
      else if (T.cases) items.push(`${icon('box')}Checked in ${plural(T.cases.length, 'case')}, each starting from different values`);
      else items.push(`${icon('box')}${plural(T.tests.length, 'test')}`);
      if (T.speed) items.push(`${icon('clock')}Speed check: should grow like ${esc(T.speed.target)} or better`);
      [...new Set((T.require || []).concat(T.forbid || []).map((r) => htmlToText(r.html)))].forEach((txt) => items.push(`${icon('check')}<span>${esc(txt)}</span>`));
      checks = `<ul class="checks">${items.map((x) => `<li>${x}</li>`).join('')}</ul>`;
    }
    const hintsShown = Math.min(ts.hints, T.hints.length);
    const hintsHtml = T.hints.slice(0, hintsShown).map((h, i) => `<div class="hint"><b>HINT ${i + 1}</b>${h}</div>`).join('');
    const hintBtn = hintsShown < T.hints.length
      ? `<button class="btn" data-act="hint">Hint ${hintsShown + 1} of ${T.hints.length}</button>`
      : (sampleFn ? `<button class="btn" data-act="ask-open">${icon('chat')}Ask Claude</button>` : '');
    return `${chipForPrevious(L)}
      <details class="recap"${recapOpen}><summary><span class="label">Learn</span><span>Key points · ${L.title}</span></summary><ul>${L.keypoints.map((k) => `<li>${k}</li>`).join('')}</ul></details>
      <div class="block">
        <div class="label-row"><span class="label task">Your task</span><span class="diff ${T.diff}">${T.diff}</span><span class="count">${S.step} of ${L.tasks.length} · ${TYPE_NAME[T.type]}</span></div>
        <h2 class="title">${T.title}</h2>
        <div class="prose">${T.prompt}</div>
        ${checks}
      </div>
      <div class="hintbox">
        <div class="hintrow"><div>${icon('bulb')}${hintsShown < T.hints.length ? 'Stuck? Hints go from a nudge to almost the answer.' : (T.hints.length ? 'That was the last hint.' : 'No hints for this one.')}</div>${hintBtn}</div>
        ${hintsHtml}
      </div>`;
  }

  // ---------------------------------------------------------------- render: task (right)
  function submitButtons(T, ts) {
    const solved = ts.result && ts.result.ok;
    let b = '';
    if (T.type === 'code') b += `<button class="btn" data-act="runtests">${icon('play')}Run tests</button>`;
    if (T.type === 'fill' || T.type === 'parsons') b += `<button class="btn" data-act="tryrun">${icon('play')}Run</button>`;
    if (T.type === 'predict' && ts.result) b += `<button class="btn" data-act="predict-run">${icon('play')}Run it</button>`;
    const last = S.step === LESSONS[S.lesson].tasks.length;
    b += solved ? `<button class="btn primary" data-act="next">${last ? 'Finish lesson' : 'Next task'}</button>` : `<button class="btn primary" data-act="submit">Submit</button>`;
    return b;
  }
  function taskRight(L, T, ts) {
    let tabs = '';
    let body = '';
    const locked = ts.result && ts.result.ok;
    switch (T.type) {
      case 'code': {
        tabs = `<button class="tab" aria-pressed="${ts.tab !== 'tests'}" data-act="ttab" data-tab="solution">solution.py</button><button class="tab" aria-pressed="${ts.tab === 'tests'}" data-act="ttab" data-tab="tests">tests.py</button>`;
        if (ts.tab === 'tests') {
          if (T.mode === 'stdout') body = `<div class="answer" style="padding-top:18px"><div class="answer-h">Expected output</div><pre class="console">${esc(T.expected)}</pre></div>`;
          else if (T.cases) body = `<div class="codearea">${codeRows(T.cases.map((cs, ci) => `# case ${ci + 1}: your code runs after these lines\n${cs.setup}\n` + T.tests.map((t, i) => `${t.code}  # expected: ${cs.expect[i]}`).join('\n')).join('\n\n'))}</div>`;
          else body = `<div class="codearea">${codeRows(T.tests.map((t) => t.code + '  # expected: ' + t.expect).join('\n'))}</div>`;
        } else {
          const hot = ts.result && ts.result.hotLine ? [ts.result.hotLine] : [];
          body = editorHTML('task-editor', ts.code) + `<div class="edhint">Tab indents · Shift+Tab un-indents · Ctrl+Enter runs the tests${hot.length ? ` · the problem is on line ${hot[0]}` : ''}</div>`;
        }
        break;
      }
      case 'mcq': case 'multi': {
        tabs = `<button class="tab" aria-pressed="true">${T.code ? 'question.py' : 'question'}</button>`;
        const res = ts.result;
        const showAll = ts.revealed;
        const opts = T.options.map((o, i) => {
          const picked = T.type === 'mcq' ? ts.sel === i : ts.sel.indexOf(i) >= 0;
          let cls = 'opt' + (T.type === 'multi' ? ' multi' : '');
          let fb = '';
          if (res) {
            cls += ' locked';
            if (picked && o.ok) cls += ' right';
            else if (picked && !o.ok) cls += ' wrong';
            else if (!picked && o.ok && (res.ok || showAll)) cls += T.type === 'multi' ? ' missed' : ' right';
            if (showAll || res.ok) fb = `<span class="ofb">${o.fb}</span>`;
          }
          const role = T.type === 'mcq' ? `role="radio" aria-checked="${picked}"` : `aria-pressed="${picked}"`;
          return `<button class="${cls}" ${role} data-act="pick" data-i="${i}"${res ? ' aria-disabled="true"' : ''}><span class="mark" aria-hidden="true"></span><span class="otext">${o.html}${fb}</span></button>`;
        }).join('');
        body = (T.code ? `<div class="codearea">${codeRows(T.code)}</div>` : '<div style="height:18px"></div>')
          + `<div class="answer"><div class="answer-h" id="opts-h">${T.type === 'mcq' ? 'Choose one answer' : 'Choose every correct answer'}</div><div class="opts" ${T.type === 'mcq' ? 'role="radiogroup"' : 'role="group"'} aria-labelledby="opts-h">${opts}</div></div>`;
        break;
      }
      case 'predict': {
        tabs = `<button class="tab" aria-pressed="true">program.py</button>`;
        body = `<div class="codearea">${codeRows(T.code)}</div><div class="answer"><label class="answer-h" for="predict-in">What it prints (one line per printed line)</label><textarea class="out-input" id="predict-in" spellcheck="false" autocomplete="off"${locked ? ' readonly' : ''} placeholder="Type the output here">${esc(ts.text)}</textarea></div>`;
        if (ts.liveRun) body += `<div class="answer"><div class="answer-h">Real output (ran in your browser)</div><pre class="console">${esc(ts.liveRun)}</pre></div>`;
        break;
      }
      case 'fill': {
        tabs = `<button class="tab" aria-pressed="true">program.py</button>`;
        const placeholder = T.code.split('??').map((p, i, arr) => p + (i < arr.length - 1 ? 'ZZBLANK' + i + 'ZZ' : '')).join('');
        let rows = codeRows(placeholder + (T.after ? '\n' + T.after : ''));
        T.answers.forEach((_, i) => {
          const cls = ts.result ? (ts.result.ok ? ' ok' : ' bad') : '';
          const w = Math.max(4, (ts.fills[i] || '').length + 2, Math.min(18, T.answers[i].length + 3));
          rows = rows.replace(new RegExp('(<span class="[a-z]+">)?ZZBLANK' + i + 'ZZ(</span>)?'), `<input class="blank${cls}" data-blank="${i}" value="${esc(ts.fills[i] || '')}" style="width:${w + 2}ch" aria-label="Blank ${i + 1}" autocomplete="off" spellcheck="false"${locked ? ' readonly' : ''}>`);
        });
        body = `<div class="codearea">${rows}</div>`;
        if (ts.run) body += `<div class="answer"><div class="answer-h">Output with your answer</div>${outputBlock(ts.run)}</div>`;
        break;
      }
      case 'parsons': {
        tabs = `<button class="tab" aria-pressed="true">build.py</button>`;
        const all = T.lines.concat(T.distractors);
        const placedIdx = new Set(ts.placed.map((p) => p.idx));
        const resLines = ts.result && ts.result.lineMarks;
        const prog2 = ts.placed.map((p, k) => {
          const ln = all[p.idx];
          const mark = resLines ? (resLines[k] ? ' good' : ' bad') : '';
          return `<div class="pz-line${mark}"><span class="code" style="padding-left:${p.indent * 4}ch">${hl(ln.text).join('')}</span>${locked ? '' : `<span class="ctl"><button data-act="pz" data-op="up" data-k="${k}" aria-label="Move up">${icon('up')}</button><button data-act="pz" data-op="down" data-k="${k}" aria-label="Move down">${icon('down')}</button><button data-act="pz" data-op="out" data-k="${k}" aria-label="Indent less">${icon('outdent')}</button><button data-act="pz" data-op="in" data-k="${k}" aria-label="Indent more">${icon('indent')}</button><button data-act="pz" data-op="del" data-k="${k}" aria-label="Remove line">${icon('trash')}</button></span>`}</div>`;
        }).join('') || '<div class="pz-empty">Tap lines on the right to add them here, in order.</div>';
        const pool = T.shuffled.filter((i) => !placedIdx.has(i)).map((i) => `<button class="pz-line add" data-act="pz-add" data-idx="${i}"${locked ? ' disabled' : ''}><span class="code">${hl(all[i].text).join('')}</span>${icon('plus')}</button>`).join('') || '<div class="pz-empty">All lines used.</div>';
        body = `<div class="answer" style="padding-top:18px"><div class="pz"><div><h5>Your program</h5><div class="pz-list">${prog2}</div></div><div><h5>Available lines${T.distractors.length ? ' · not all are needed' : ''}</h5><div class="pz-list">${pool}</div></div></div>${T.after ? `<div class="answer-h" style="margin-top:6px">Then this runs</div><div class="codearea" style="padding:6px 0">${codeRows(T.after)}</div>` : ''}</div>`;
        if (ts.run) body += `<div class="answer"><div class="answer-h">Output of your program</div>${outputBlock(ts.run)}</div>`;
        break;
      }
      case 'cells': {
        tabs = `<button class="tab" aria-pressed="true">${T.code ? 'trace.py' : 'trace'}</button>`;
        const n = T.answer ? T.answer.length : 0;
        const labels = T.labels || Array.from({ length: n }, (_, i) => String(i));
        const startRow = T.start ? `<div class="answer-h">Before</div><div class="cellrow">${T.start.map((v, i) => `<div class="cellcol"><div class="cellbox">${esc(v)}</div><small>${esc(labels[i] || '')}</small></div>`).join('')}</div>` : '';
        const marks = ts.result && ts.result.cellMarks;
        const inputs = Array.from({ length: n }, (_, i) => `<div class="cellcol"><label class="sr" for="cell-${i}">Value at ${esc(labels[i] || i)}</label><input class="cellin${marks ? (marks[i] ? ' ok' : ' bad') : ''}" id="cell-${i}" data-cell="${i}" value="${esc(ts.cells[i] || '')}" autocomplete="off" spellcheck="false"${locked ? ' readonly' : ''}><small>${esc(labels[i] || '')}</small></div>`).join('');
        body = (T.code ? `<div class="codearea">${codeRows(T.code)}</div>` : '<div style="height:18px"></div>') + `<div class="answer">${startRow}<div class="answer-h">Your answer</div><div class="cellrow">${inputs}</div></div>`;
        break;
      }
      case 'order': {
        tabs = `<button class="tab" aria-pressed="true">order</button>`;
        const marks = ts.result && ts.result.orderMarks;
        body = `<div class="answer" style="padding-top:18px"><div class="answer-h">Top = first</div><ol class="olist">${ts.order.map((idx, k) => `<li class="${marks ? (marks[k] ? 'good' : 'bad') : ''}"><span class="onum">${k + 1}</span><span class="otx">${T.items[idx]}</span>${locked ? '' : `<span class="ctl"><button data-act="ord" data-op="up" data-k="${k}" aria-label="Move up">${icon('up')}</button><button data-act="ord" data-op="down" data-k="${k}" aria-label="Move down">${icon('down')}</button></span>`}</li>`).join('')}</ol></div>`;
        break;
      }
    }
    const res = resultsHTML(L, T, ts);
    return `<div class="toolbar"><div class="tabs">${tabs}</div><div class="spacer"></div>${submitButtons(T, ts)}</div>${body}${res ? `<div class="results" id="results">${res}</div>` : ''}`;
  }

  function outputBlock(r) {
    let h = '';
    if (r.stdout) h += `<pre class="console">${esc(r.stdout)}</pre>`;
    if (r.error) h += `<pre class="console err"${r.stdout ? ' style="margin-top:8px"' : ''}>${esc(r.error.traceback || r.error.type + ': ' + r.error.message)}</pre>`;
    if (!r.stdout && !r.error) h += '<pre class="console empty">(nothing printed)</pre>';
    return h;
  }

  // ---------------------------------------------------------------- results + feedback
  const ERR_HELP = {
    SyntaxError: 'Python couldn\'t read this line, so nothing ran. Look for a missing colon at the end of an if/for/while/def line, a missing bracket or quote, or = where you meant ==.',
    IndentationError: 'The spaces at the start of a line are off. Every line inside an if, for, while or def needs 4 more spaces than the line that opens the block, and lines in the same block must line up.',
    TabError: 'Tabs and spaces are mixed in the indentation. Use 4 spaces per level.',
    NameError: 'Python doesn\'t know this name. Check the spelling (capital letters count), and make sure the variable or function is created before this line runs.',
    TypeError: 'A value has the wrong type for what you did with it, like adding a number to text, or calling a function with the wrong number of arguments.',
    IndexError: 'You asked for a position that doesn\'t exist. Positions start at 0, so the last one is len(...) - 1. Empty lists have no positions at all.',
    KeyError: 'That key isn\'t in the dictionary. Use .get(key, default) or check with `if key in d` first.',
    ZeroDivisionError: 'Something was divided by zero. Check the value before dividing.',
    AttributeError: 'That value doesn\'t have this method or attribute. Check the spelling and what type the value really is (for example, a list has .append but a string doesn\'t).',
    ValueError: 'The value has the right type but can\'t be used, like int("abc") or removing something that isn\'t in the list.',
    UnboundLocalError: 'You give this variable a value somewhere in the function, so Python treats it as local to the function, but this line reads it before it has a value.',
    RecursionError: 'The function kept calling itself and never stopped. It needs a base case that returns without another call, and each call must move closer to it.',
    TimeoutError: 'Your code ran for too long, so it was stopped. Usually a while loop whose condition never becomes False, or a loop that never changes the variable it checks.',
    AssertionError: 'An assert line found something False.',
    ImportError: 'That import isn\'t available here.',
    ModuleNotFoundError: 'That module isn\'t available in this runner. The course only needs math, collections, heapq, functools, itertools, bisect and a few others.',
    RuntimeError: 'Something went wrong while the code was running.',
    StopIteration: 'next() was called on an iterator that had no items left.',
    InternalError: 'The in-page runner hit a problem it couldn\'t handle. Try simplifying the code, or ask Claude.',
  };
  function errHelp(err) { return ERR_HELP[err.type] || 'Your code raised an error.'; }

  function resultsHTML(L, T, ts) {
    const r = ts.result || (T.type === 'code' ? ts.run : null);
    if (!r) return '';
    let h = '';
    h += `<div class="verdict-row"><div class="pill ${r.pill}">${icon(r.pill === 'ok' ? 'check' : r.pill === 'warn' ? 'clock' : 'x')}${esc(r.title)}</div>${r.sub ? `<div class="verdict-sub">${esc(r.sub)}</div>` : ''}</div>`;
    if (r.cards) h += `<div class="cards">${r.cards}</div>`;
    if (ts.result) h += whyHTML(L, T, ts, ts.result);
    else if (T.type === 'code') h += '<div class="note-sm">That was a practice run. Press Submit when you\'re ready for feedback.</div>';
    return h;
  }

  function whyHTML(L, T, ts, r) {
    const good = r.ok;
    let title = good ? 'Why it\'s right' : (r.kind === 'slow' ? 'Why it\'s slow' : r.kind === 'error' ? 'What went wrong' : r.kind === 'rule' ? 'Why it isn\'t accepted yet' : 'Why it\'s not right yet');
    let chips = '';
    if (r.bigo) chips = `<span class="bigo${r.bigo.ok ? ' good' : ''}">yours: ${esc(r.bigo.yours)}</span><span class="bigo good">goal: ${esc(r.bigo.goal)}</span>`;
    let body = '';
    if (r.specific) body += `<div class="prose specific">${r.specific}</div>`;
    body += `<div class="prose">${good ? (T.right || '') : (T.wrong || '')}</div>`;
    let actions = '';
    if (good) {
      actions += `<button class="btn primary" data-act="next">${S.step === L.tasks.length ? 'Finish lesson' : 'Next task'} ${icon('arrow')}</button>`;
      if (r.xp) actions += `<span class="xp" style="align-self:center">+${r.xp} XP</span>`;
    } else {
      actions += `<button class="btn primary" data-act="retry">Try again</button>`;
    }
    if (sampleFn) actions += `<button class="btn" data-act="ask-open">${icon('chat')}Ask Claude a follow-up</button>`;
    if (!good && !ts.revealed) actions += `<button class="btn ghost" data-act="reveal">${T.type === 'code' ? 'Show the fix' : 'Show the answer'}</button>`;
    if (good && T.type === 'code' && !ts.showModel) actions += `<button class="btn ghost" data-act="model">Compare with the model answer</button>`;
    let reveal = '';
    if (ts.revealed || (good && ts.showModel)) reveal = revealHTML(T, ts);
    let lessonDone = '';
    if (good && doneCount(L.id) === L.tasks.length) {
      const nextId = ORDER[ORDER.indexOf(L.id) + 1];
      lessonDone = `<div class="reveal"><h4>Lesson complete</h4><div class="prose"><p>All ${L.tasks.length} tasks solved. ${nextId ? `Next up: <strong>${esc(htmlToText(INFO[nextId].title))}</strong>.` : 'That was the last lesson available right now.'}</p></div></div>`;
    }
    return `<div class="why${good ? ' good' : ''}"><div class="why-h"><b>${title}</b>${chips}</div>${body}${reveal}${lessonDone}<div class="actions">${actions}</div>${askHTML(ts)}</div>`;
  }

  function revealHTML(T, ts) {
    let inner = '';
    switch (T.type) {
      case 'code': inner = `<div class="codearea" style="padding:8px 0;background:var(--bg);border-radius:8px">${codeRows(T.solution)}</div>`; break;
      case 'predict': inner = `<pre class="console">${esc(T.expected)}</pre>`; break;
      case 'fill': inner = `<div class="codearea" style="padding:8px 0;background:var(--bg);border-radius:8px">${codeRows(T.code.split('??').map((p, i, a) => p + (i < a.length - 1 ? T.answers[i] : '')).join(''))}</div>`; break;
      case 'parsons': inner = `<div class="codearea" style="padding:8px 0;background:var(--bg);border-radius:8px">${codeRows(T.lines.map((l) => '    '.repeat(l.indent) + l.text).join('\n'))}</div>`; break;
      case 'cells': inner = `<div class="cellrow">${T.answer.map((v, i) => `<div class="cellcol"><div class="cellbox">${esc(v)}</div><small>${esc((T.labels || [])[i] || i)}</small></div>`).join('')}</div>`; break;
      case 'order': inner = `<ol style="margin:0;padding-left:20px;color:var(--fg2)">${T.items.map((it) => `<li>${it}</li>`).join('')}</ol>`; break;
      case 'mcq': case 'multi': inner = `<div class="prose"><p>The correct ${T.type === 'mcq' ? 'answer is' : 'answers are'} marked in green above, with an explanation under each option.</p></div>`; break;
    }
    const label = T.type === 'code' ? (ts.revealed ? 'One way to solve it' : 'Model answer') : 'The answer';
    return `<div class="reveal"><h4>${label}</h4>${inner}${ts.revealed ? '<div class="note-sm" style="margin-top:8px">Read it, close it in your head, then try writing it yourself. XP isn\'t given for this task after revealing.</div>' : ''}</div>`;
  }

  function askHTML(ts) {
    if (!ts.ask || !ts.ask.open) return '';
    const turns = ts.ask.turns.map((t) => `<div class="answer-bubble${t.role === 'user' ? ' q' : ''}"><span class="who">${t.role === 'user' ? 'YOU' : 'CLAUDE'}</span>${t.role === 'user' ? esc(t.text) : miniMd(t.text)}</div>`).join('');
    const busy = ts.ask.busy;
    return `<div class="ask">${turns}${busy ? '' : `<div class="chips"><button data-act="ask-quick" data-q="Why was my answer wrong?">Why was my answer wrong?</button><button data-act="ask-quick" data-q="Explain this more simply, step by step.">Explain it more simply</button><button data-act="ask-quick" data-q="Give me another small example of this idea.">Give me another example</button></div>
      <label class="sr" for="ask-in">Your question for Claude</label><textarea id="ask-in" placeholder="Ask anything about this task">${esc(ts.ask.draft || '')}</textarea>
      <div class="actions" style="margin-top:0"><button class="btn primary" data-act="ask-send">Send</button><button class="btn ghost" data-act="ask-close">Close</button></div>`}
      ${busy ? '<div class="actions" style="margin-top:0"><button class="btn" data-act="ask-stop">Stop</button></div>' : ''}${ts.ask.error ? `<div class="note-sm">${esc(ts.ask.error)}</div>` : ''}</div>`;
  }

  // ---------------------------------------------------------------- checking answers
  const normOut = (s) => String(s || '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').replace(/^\n+|\n+$/g, '');
  const normKey = (s) => String(s || '').trim().replace(/\s+/g, ' ');
  const squash = (s) => String(s || '').replace(/\s+/g, '');

  function check(L, T, ts) {
    switch (T.type) {
      case 'mcq': {
        if (ts.sel === null || ts.sel === undefined) return { needInput: 'Pick an answer first.' };
        const o = T.options[ts.sel];
        return { ok: o.ok, kind: o.ok ? 'right' : 'wrong', pill: o.ok ? 'ok' : 'bad', title: o.ok ? 'Correct' : 'Not quite', specific: o.ok ? (T.right ? '' : o.fb) : o.fb };
      }
      case 'multi': {
        if (!ts.sel.length) return { needInput: 'Pick at least one answer.' };
        const want = T.options.map((o, i) => (o.ok ? i : -1)).filter((i) => i >= 0);
        const ok = want.length === ts.sel.length && want.every((i) => ts.sel.indexOf(i) >= 0);
        const wrongPicks = ts.sel.filter((i) => !T.options[i].ok);
        const missed = want.filter((i) => ts.sel.indexOf(i) < 0);
        let sub = '';
        if (!ok) sub = [wrongPicks.length ? plural(wrongPicks.length, 'wrong pick') : '', missed.length ? plural(missed.length, 'correct answer') + ' missed' : ''].filter(Boolean).join(' · ');
        const specific = ok ? '' : wrongPicks.map((i) => `<p><strong>${htmlToText(T.options[i].html)}:</strong> ${T.options[i].fb}</p>`).join('') + (missed.length && !wrongPicks.length ? '<p>Everything you picked is right, but at least one more option is also correct.</p>' : '');
        return { ok, kind: ok ? 'right' : 'wrong', pill: ok ? 'ok' : 'bad', title: ok ? 'Correct' : 'Not quite', sub, specific };
      }
      case 'predict': {
        const ans = normOut(ts.text);
        if (!ans) return { needInput: 'Type what you think the program prints.' };
        const exp = normOut(T.expected);
        const ok = ans === exp;
        let specific = '';
        if (!ok) {
          if (T.wrongs[ans]) specific = T.wrongs[ans];
          else if (ans.replace(/['"]/g, '') === exp.replace(/['"]/g, '')) specific = '<p>Check the quotes. print() shows the text itself, without the quotes around it (unless the quotes are part of the string).</p>';
          else if (ans.toLowerCase() === exp.toLowerCase()) specific = '<p>Very close: check capital letters. The output keeps the exact case of the text.</p>';
          else if (ans.replace(/\s+/g, '') === exp.replace(/\s+/g, '')) specific = '<p>The characters are right but the spacing or line breaks differ. Each print() starts a new line, and print with several values puts one space between them.</p>';
          else if (ans.split('\n').length !== exp.split('\n').length) specific = `<p>Your answer has ${plural(ans.split('\n').length, 'line')}, but the program prints ${plural(exp.split('\n').length, 'line')}. Count how many times print() actually runs.</p>`;
        }
        return { ok, kind: ok ? 'right' : 'wrong', pill: ok ? 'ok' : 'bad', title: ok ? 'Correct' : 'Not quite', specific };
      }
      case 'fill': {
        const fills = ts.fills.map((x) => (x || '').trim());
        if (fills.some((x) => !x)) return { needInput: 'Fill in every blank first.' };
        const src = T.code.split('??').map((p, i, a) => p + (i < a.length - 1 ? fills[i] : '')).join('') + (T.after ? '\n' + T.after : '');
        const run = PR.run(src, { stepLimit: 300000, filename: 'program.py' });
        ts.run = { stdout: run.stdout, error: run.error };
        const key = normKey(fills.join(' | '));
        const exact = fills.every((x, i) => squash(x) === squash(T.answers[i]));
        const ok = exact || (!run.error && normOut(run.stdout) === normOut(T.expected));
        let specific = '';
        if (!ok) {
          const wk = Object.keys(T.wrongs).find((k) => squash(k) === squash(key));
          if (wk) specific = T.wrongs[wk];
          else if (run.error) specific = `<p><strong>${esc(run.error.type)}:</strong> ${esc(run.error.message)}</p><p>${esc(errHelp(run.error))}</p>`;
          else specific = '<p>With your answer the program runs, but prints something different from what the task asks for. Compare the output above with the goal.</p>';
        }
        return { ok, kind: ok ? 'right' : (run.error ? 'error' : 'wrong'), pill: ok ? 'ok' : 'bad', title: ok ? 'Correct' : (run.error ? 'The program raised an error' : 'Not quite'), specific };
      }
      case 'parsons': {
        if (!ts.placed.length) return { needInput: 'Add some lines to your program first.' };
        const all = T.lines.concat(T.distractors);
        const src = ts.placed.map((p) => '    '.repeat(p.indent) + all[p.idx].text).join('\n') + (T.after ? '\n' + T.after : '');
        const run = PR.run(src, { stepLimit: 300000, filename: 'build.py' });
        ts.run = { stdout: run.stdout, error: run.error };
        const usedDistractor = ts.placed.some((p) => all[p.idx].d);
        const exactMatch = ts.placed.length === T.lines.length && ts.placed.every((p, k) => p.idx === k && p.indent === T.lines[k].indent);
        const ok = exactMatch || (!usedDistractor && !run.error && ts.placed.length === T.lines.length && normOut(run.stdout) === normOut(T.expected));
        let specific = '';
        const lineMarks = ts.placed.map((p, k) => p.idx === k && p.indent === T.lines[k].indent);
        if (!ok) {
          if (usedDistractor) { const d = ts.placed.find((p) => all[p.idx].d); specific = `<p>This line isn't needed: <code class="ic">${esc(all[d.idx].text)}</code>. Some lines are there to tempt you.</p>`; }
          else if (ts.placed.length < T.lines.length) specific = `<p>Your program uses ${ts.placed.length} of the ${T.lines.length} lines it needs.</p>`;
          else {
            const k = lineMarks.indexOf(false);
            const p = ts.placed[k];
            if (p.idx === k) specific = `<p>Line ${k + 1} (<code class="ic">${esc(all[p.idx].text)}</code>) is in the right place, but its indentation is off. Indentation decides which block a line belongs to.</p>`;
            else specific = `<p>The first problem is at line ${k + 1}: <code class="ic">${esc(all[p.idx].text)}</code> doesn't belong there yet.</p>`;
          }
          if (run.error) specific += `<p><strong>${esc(run.error.type)}:</strong> ${esc(run.error.message)}</p>`;
        }
        return { ok, kind: ok ? 'right' : 'wrong', pill: ok ? 'ok' : 'bad', title: ok ? 'Correct' : 'Not quite', specific, lineMarks: ok ? lineMarks.map(() => true) : lineMarks };
      }
      case 'cells': {
        const vals = ts.cells.map((x) => (x || '').trim());
        if (vals.some((x) => !x)) return { needInput: 'Fill in every box first.' };
        const normCell = (x) => squash(x).replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1').toLowerCase();
        const cellMarks = vals.map((v, i) => normCell(v) === normCell(T.answer[i]));
        const ok = cellMarks.every(Boolean);
        let specific = '';
        if (!ok) {
          const key = vals.join(' | ');
          const wk = Object.keys(T.wrongs).find((k) => squash(k).toLowerCase() === squash(key).toLowerCase());
          specific = wk ? T.wrongs[wk] : `<p>${plural(cellMarks.filter((x) => !x).length, 'box')} ${cellMarks.filter((x) => !x).length === 1 ? 'is' : 'are'} wrong (marked in red).</p>`;
        }
        return { ok, kind: ok ? 'right' : 'wrong', pill: ok ? 'ok' : 'bad', title: ok ? 'Correct' : 'Not quite', specific, cellMarks };
      }
      case 'order': {
        const orderMarks = ts.order.map((idx, k) => idx === k);
        const ok = orderMarks.every(Boolean);
        return { ok, kind: ok ? 'right' : 'wrong', pill: ok ? 'ok' : 'bad', title: ok ? 'Correct' : 'Not quite', specific: ok ? '' : `<p>${plural(orderMarks.filter((x) => !x).length, 'item')} ${orderMarks.filter((x) => !x).length === 1 ? 'is' : 'are'} in the wrong spot (marked in red).</p>`, orderMarks };
      }
      case 'code': return checkCode(T, ts, true);
    }
    return { ok: false, pill: 'bad', title: 'Unknown task' };
  }

  function stripComments(code) {
    return code.split('\n').map((line) => {
      let q = null;
      for (let k = 0; k < line.length; k++) {
        const c = line[k];
        if (q) { if (c === '\\') { k++; continue; } if (c === q) q = null; }
        else if (c === '"' || c === "'") q = c;
        else if (c === '#') return line.slice(0, k);
      }
      return line;
    }).join('\n');
  }
  function ruleProblems(T, code) {
    const flat = stripComments(code).replace(/\s+/g, '');
    const probs = [];
    (T.require || []).forEach((r) => { if (flat.indexOf(r.pat.replace(/\s+/g, '')) < 0) probs.push(r.html); });
    (T.forbid || []).forEach((r) => { if (flat.indexOf(r.pat.replace(/\s+/g, '')) >= 0) probs.push(r.html); });
    return [...new Set(probs)];
  }

  function checkCode(T, ts, full) {
    const code = ts.code;
    if (!code.trim()) return { needInput: 'Write some code first.' };
    const rules = ruleProblems(T, code);
    const rulesHTML = rules.length ? `<div class="errline">${rules.length === 1 ? 'One rule of this task isn\'t met' : rules.length + ' rules of this task aren\'t met'}</div>${rules.join('')}` : '';
    if (T.mode === 'stdout') {
      const run = PR.run(code, { stepLimit: 500000, filename: 'solution.py' });
      const outOk = !run.error && normOut(run.stdout) === normOut(T.expected);
      const ok = outOk && !rules.length;
      const cards = `<div class="card${ok ? '' : ' badcard'}"><div class="card-h"><b>Your output</b><span class="${ok ? 'okt' : 'badt'}">${ok ? 'matches' : 'different'}</span></div>${outputBlock(run)}</div><div class="card"><div class="card-h"><b>Expected output</b></div><pre class="console">${esc(T.expected)}</pre></div>`;
      let specific = '';
      if (run.error) specific = errorSpecific(T, run.error);
      else if (!ok) {
        const a = normOut(run.stdout), b = normOut(T.expected);
        if (a.toLowerCase() === b.toLowerCase()) specific = '<p>Almost: only capital letters differ. The output has to match exactly.</p>';
        else if (a.replace(/\s+/g, '') === b.replace(/\s+/g, '')) specific = '<p>Almost: the characters match but spaces or line breaks differ. Remember print() adds a space between values and a new line at the end.</p>';
        else if (a.split('\n').length !== b.split('\n').length) specific = `<p>Your program prints ${plural(a ? a.split('\n').length : 0, 'line')}; the goal is ${plural(b.split('\n').length, 'line')}.</p>`;
      }
      if (rules.length) specific += rulesHTML;
      return { ok, kind: run.error ? 'error' : ok ? 'right' : outOk ? 'rule' : 'wrong', pill: ok ? 'ok' : outOk ? 'warn' : 'bad', title: ok ? 'Output matches' : run.error ? 'Your code raised an error' : outOk ? 'Output matches, but a rule isn\'t met' : 'Output is different', cards, specific, hotLine: run.error ? run.error.line : null };
    }
    if (T.cases) return checkCases(T, ts, code, rules, rulesHTML);
    const res = PR.runTests(code, T.tests.map((t) => ({ code: t.code, expect: t.expect })), { loadLimit: 1000000, testLimit: 1000000 });
    if (!res.load.ok) {
      const err = res.load.error;
      const cards = `<div class="card badcard wide"><div class="card-h"><b>Your code didn't run</b><span class="badt">${esc(err.type)}</span></div><pre class="console err">${esc(err.traceback || err.type + ': ' + err.message)}</pre></div>` + (res.load.stdout ? `<div class="card wide"><div class="card-h"><b>Printed before the error</b></div><pre class="console">${esc(res.load.stdout)}</pre></div>` : '');
      return { ok: false, kind: 'error', pill: 'bad', title: err.syntax ? 'Python can\'t read your code' : 'Your code raised an error', sub: `line ${err.line}`, cards, specific: errorSpecific(T, err), hotLine: err.line };
    }
    const results = res.results;
    const passed = results.filter((x) => x.ok).length;
    const rows = results.map((x, i) => {
      const got = x.error ? `${x.error.type}` : x.gotRepr;
      return `<li>${x.ok ? icon('check', 'role="img" aria-label="passed" style="color:var(--pass)"') : icon('x', 'role="img" aria-label="failed" style="color:var(--fail)"')}<span class="call">${esc(T.tests[i].code)}${x.ok ? '' : `<span class="exp">expected ${esc(x.expectRepr)}</span>`}</span><span class="got">${esc(got)}</span></li>`;
    }).join('');
    const allOk = passed === results.length;
    let cards = `<div class="card${allOk ? '' : ' badcard'}"><div class="card-h"><b>Tests</b><span class="${allOk ? 'okt' : 'badt'}">${passed} / ${results.length} passed</span></div><ul class="trows">${rows}</ul></div>`;
    const printed = (res.load.stdout || '') + results.map((x) => x.stdout || '').join('');
    let specific = '';
    let hotLine = null;
    let kind = allOk ? 'right' : 'wrong';
    const firstFail = results.findIndex((x) => !x.ok);
    if (firstFail >= 0) {
      const x = results[firstFail];
      if (T.fails[String(firstFail + 1)]) specific += T.fails[String(firstFail + 1)];
      if (x.error) {
        hotLine = x.error.userLine;
        specific += errorSpecific(T, x.error, firstFail);
        kind = 'error';
      } else if (!T.fails[String(firstFail + 1)]) {
        specific += `<p>For <code class="ic">${esc(T.tests[firstFail].code)}</code> your function returned <code class="ic">${esc(x.gotRepr)}</code>, but the answer should be <code class="ic">${esc(x.expectRepr)}</code>.</p>`;
        if (x.gotRepr === 'None' && x.expectRepr !== 'None') specific += '<p>Getting <code class="ic">None</code> usually means the function never reaches a <code class="ic">return</code> line, or it prints the answer instead of returning it.</p>';
      }
    }
    let bigo = null;
    let speedFail = false;
    if (allOk && T.speed && full) {
      const sp = PR.speedCheck(res.vm, T.speed);
      if (sp.error) {
        cards += `<div class="card badcard"><div class="card-h"><b>Speed check</b><span class="badt">error</span></div><pre class="console err">${esc(sp.error.type + ': ' + sp.error.message)}</pre></div>`;
      } else {
        const okSpeed = PR.growthRank(sp.growth) <= PR.growthRank(T.speed.target);
        speedFail = !okSpeed;
        const last = sp.points[sp.points.length - 1];
        const goalTxt = T.speed.target;
        bigo = { yours: sp.growth || 'too slow', goal: goalTxt, ok: okSpeed };
        const pts = sp.points.map((p) => `n=${p.n.toLocaleString('en-US')}: ${p.steps.toLocaleString('en-US')} steps`).join(' · ');
        const pct = okSpeed ? 30 : 100;
        cards += `<div class="card${okSpeed ? '' : ' badcard'}"><div class="card-h"><b>Speed check</b><span class="${okSpeed ? 'okt' : 'badt'}">${okSpeed ? 'passed' : 'too slow'}</span></div>
          <p style="margin:0 0 14px;font-size:13.5px;color:var(--muted)">We counted the steps your code takes as the input doubles.</p>
          <div class="bar"><div class="fill${okSpeed ? ' good' : ''}" style="width:${pct}%"></div><div class="goal" style="left:${okSpeed ? 55 : 22}%"></div></div>
          <div class="barlabels"><span>grows like ${esc(goalTxt)} (goal)</span><span style="color:${okSpeed ? 'var(--pass)' : 'var(--fail2)'}">yours: ${esc(sp.growth || 'too slow')}</span></div>
          <p style="margin:10px 0 0;font-size:12.5px;color:var(--fg2);font-family:var(--mono)">${esc(pts)}${sp.exceeded ? ` · n=${sp.exceeded.toLocaleString('en-US')}: over ${T.speed.maxSteps.toLocaleString('en-US')} steps, stopped` : ''}</p></div>`;
        if (!okSpeed) {
          kind = 'slow';
          specific = `<p>Every test passes, so your logic is right. But when the input doubles, your code's work grows like <strong>${esc(sp.growth || 'something very slow')}</strong>, and the goal is <strong>${esc(goalTxt)}</strong>.${last ? ` At n = ${last.n.toLocaleString('en-US')} it already took ${last.steps.toLocaleString('en-US')} steps.` : ''}</p>` + (T.fails.speed || '');
        }
      }
    }
    if (printed) cards += `<div class="card wide"><div class="card-h"><b>Printed</b></div><pre class="console">${esc(printed)}</pre></div>`;
    const ruleFail = rules.length > 0;
    if (ruleFail) { specific += rulesHTML; if (allOk && !speedFail) kind = 'rule'; }
    const ok = allOk && !speedFail && !ruleFail;
    const title = ok ? (T.speed ? 'All tests and the speed check pass' : 'All tests pass') : speedFail ? 'Correct, but too slow' : allOk ? 'Tests pass, but a rule isn\'t met' : `${results.length - passed} of ${results.length} tests failed`;
    const sub = ok ? `${results.length} of ${results.length} tests passed` : speedFail ? `${results.length} of ${results.length} tests passed · speed check failed` : allOk ? `${results.length} of ${results.length} tests passed` : '';
    return { ok, kind, pill: ok ? 'ok' : (speedFail || (allOk && ruleFail)) ? 'warn' : 'bad', title, sub, cards, specific, hotLine, bigo };
  }

  // A code task checked several times, each run starting from a different setup (e.g. age = 3, then age = 70)
  function checkCases(T, ts, code, rules, rulesHTML) {
    const syn = PR.parseCheck(code);
    if (syn) {
      const r0 = PR.run(code, { stepLimit: 1000, filename: 'solution.py' });
      const err = r0.error || { type: syn.type, message: syn.message, line: syn.line, syntax: true };
      const cards = `<div class="card badcard wide"><div class="card-h"><b>Your code didn't run</b><span class="badt">${esc(err.type)}</span></div><pre class="console err">${esc(err.traceback || err.type + ': ' + err.message)}</pre></div>`;
      return { ok: false, kind: 'error', pill: 'bad', title: 'Python can\'t read your code', sub: `line ${err.line}`, cards, specific: errorSpecific(T, err), hotLine: err.line };
    }
    let rows = '', total = 0, passed = 0, first = null, printed = '';
    T.cases.forEach((cs, ci) => {
      const res = PR.runTests(code, T.tests.map((t, i) => ({ code: t.code, expect: cs.expect[i] })), { pre: cs.setup, loadLimit: 1000000, testLimit: 1000000 });
      rows += `<li class="casehead"><span>Case ${ci + 1}: starting with <code class="ic">${esc(cs.setup.split('\n').join('; '))}</code></span></li>`;
      if (res.load.stdout) printed += res.load.stdout;
      if (!res.load.ok) {
        total += T.tests.length;
        rows += `<li>${icon('x', 'role="img" aria-label="failed" style="color:var(--fail)"')}<span class="call">your code raised an error</span><span class="got">${esc(res.load.error.type)}</span></li>`;
        if (!first) first = { ci, err: res.load.error };
        return;
      }
      res.results.forEach((x, i) => {
        total++;
        if (x.ok) passed++;
        else if (!first) first = { ci, i, x };
        const got = x.error ? x.error.type : x.gotRepr;
        rows += `<li>${x.ok ? icon('check', 'role="img" aria-label="passed" style="color:var(--pass)"') : icon('x', 'role="img" aria-label="failed" style="color:var(--fail)"')}<span class="call">${esc(T.tests[i].code)}${x.ok ? '' : `<span class="exp">expected ${esc(x.expectRepr)}</span>`}</span><span class="got">${esc(got)}</span></li>`;
      });
    });
    const allOk = passed === total;
    let cards = `<div class="card wide${allOk ? '' : ' badcard'}"><div class="card-h"><b>Checks</b><span class="${allOk ? 'okt' : 'badt'}">${passed} / ${total} passed</span></div><ul class="trows">${rows}</ul></div>`;
    if (printed) cards += `<div class="card wide"><div class="card-h"><b>Printed</b></div><pre class="console">${esc(printed)}</pre></div>`;
    let specific = '', hotLine = null, kind = allOk ? 'right' : 'wrong';
    if (first) {
      const cs = T.cases[first.ci];
      const setupTxt = cs.setup.split('\n').join('; ');
      if (T.fails[String(first.ci + 1)]) specific += T.fails[String(first.ci + 1)];
      if (first.err) {
        kind = 'error';
        hotLine = first.err.line;
        specific += errorSpecific(T, first.err) + `<p>This happened in case ${first.ci + 1}, starting with <code class="ic">${esc(setupTxt)}</code>.</p>`;
      } else if (first.x.error) {
        kind = 'error';
        hotLine = first.x.error.userLine;
        specific += errorSpecific(T, first.x.error, first.i);
      } else if (!T.fails[String(first.ci + 1)]) {
        specific += `<p>Starting with <code class="ic">${esc(setupTxt)}</code>, <code class="ic">${esc(T.tests[first.i].code)}</code> came out as <code class="ic">${esc(first.x.gotRepr)}</code>, but it should be <code class="ic">${esc(first.x.expectRepr)}</code>.</p>`;
      }
    }
    if (!allOk) {
      // a common mix-up: setting the input variable yourself, which overrides every case's own value
      const setNames = new Set();
      T.cases.forEach((cs) => cs.setup.split('\n').forEach((ln) => { const m = ln.match(/^\s*([A-Za-z_]\w*)\s*=(?!=)/); if (m) setNames.add(m[1]); }));
      const mine = stripComments(code);
      const clash = [...setNames].filter((nm) => new RegExp('^\\s*' + nm + '\\s*=(?!=)', 'm').test(mine));
      if (clash.length) specific = `<p>Your code sets <code class="ic">${esc(clash[0])}</code> itself, so every check ends up using your value instead of the one it set. Remove that line: <code class="ic">${esc(clash[0])}</code> is already set before your code runs.</p>` + specific;
    }
    const ruleFail = rules.length > 0;
    if (ruleFail) { specific += rulesHTML; if (allOk) kind = 'rule'; }
    const ok = allOk && !ruleFail;
    const title = ok ? `All ${T.cases.length} cases pass` : allOk ? 'Checks pass, but a rule isn\'t met' : `${total - passed} of ${total} checks failed`;
    return { ok, kind, pill: ok ? 'ok' : allOk ? 'warn' : 'bad', title, sub: `${passed} of ${total} checks passed`, cards, specific, hotLine };
  }

  function errorSpecific(T, err, testIdx) {
    let s = '';
    if (T.errors && T.errors[err.type]) s += T.errors[err.type];
    const where = err.userLine ? ` on line ${err.userLine}${err.userFunc && err.userFunc !== '<module>' ? ` (inside ${esc(err.userFunc)})` : ''}` : err.line ? ` on line ${err.line}` : '';
    s += `<div class="errline">${esc(err.type)}${err.message ? ': ' + esc(err.message) : ''}${testIdx !== undefined ? ` — while running <code class="ic">${esc(T.tests[testIdx].code)}</code>` : ''}${where}</div><p>${esc(errHelp(err))}</p>`;
    return s;
  }

  // ---------------------------------------------------------------- actions
  function recordResult(L, i, r, ts) {
    const lp = lessonProg(L.id);
    const prev = lp.t[i] || { s: null, tries: 0 };
    const T = L.tasks[i];
    const tries = (prev.tries || 0) + 1;
    let xp = 0;
    if (r.ok && prev.s !== 'ok') {
      if (!ts.revealed) {
        const base = TASK_XP[T.diff] || 10;
        xp = tries === 1 && ts.hints === 0 ? base : Math.max(5, Math.round(base / 2));
      }
      prog.xp = (prog.xp || 0) + xp;
      bumpStreak();
    }
    lp.t[i] = { s: r.ok || prev.s === 'ok' ? 'ok' : 'tried', tries: prev.s === 'ok' ? prev.tries : tries, hints: ts.hints, rev: ts.revealed || prev.rev || false, xp: (prev.xp || 0) + xp };
    ts.tries = tries;
    prog.last = { lesson: L.id, step: S.step };
    saveProgress();
    return xp;
  }

  function submit() {
    const L = LESSONS[S.lesson];
    const T = L.tasks[S.step - 1];
    const ts = TS(S.lesson, S.step);
    collectInputs(T, ts);
    const r = check(L, T, ts);
    if (r.needInput) { toast(r.needInput); return; }
    r.xp = recordResult(L, S.step - 1, r, ts);
    ts.result = r;
    if (T.type === 'code') ts.run = null;
    render({ keepScroll: true });
    scrollToResults();
    if (r.xp) toast(`+${r.xp} XP`);
  }

  function runTests() {
    const L = LESSONS[S.lesson];
    const T = L.tasks[S.step - 1];
    const ts = TS(S.lesson, S.step);
    collectInputs(T, ts);
    const r = checkCode(T, ts, true);
    if (r.needInput) { toast(r.needInput); return; }
    ts.run = r;
    ts.result = null;
    render({ keepScroll: true });
    scrollToResults();
  }

  function tryRun() {
    const L = LESSONS[S.lesson];
    const T = L.tasks[S.step - 1];
    const ts = TS(S.lesson, S.step);
    collectInputs(T, ts);
    let src = '';
    if (T.type === 'fill') src = T.code.split('??').map((p, i, a) => p + (i < a.length - 1 ? (ts.fills[i] || '') : '')).join('') + (T.after ? '\n' + T.after : '');
    if (T.type === 'parsons') { const all = T.lines.concat(T.distractors); src = ts.placed.map((p) => '    '.repeat(p.indent) + all[p.idx].text).join('\n') + (T.after ? '\n' + T.after : ''); }
    const run = PR.run(src, { stepLimit: 300000, filename: 'program.py' });
    ts.run = { stdout: run.stdout, error: run.error };
    render({ keepScroll: true });
  }

  function collectInputs(T, ts) {
    if (T.type === 'predict') { const el = document.getElementById('predict-in'); if (el) ts.text = el.value; }
    if (T.type === 'fill') document.querySelectorAll('input.blank').forEach((el) => { ts.fills[+el.dataset.blank] = el.value; });
    if (T.type === 'cells') document.querySelectorAll('input.cellin').forEach((el) => { ts.cells[+el.dataset.cell] = el.value; });
    if (T.type === 'code') { const el = document.getElementById('task-editor'); if (el) ts.code = el.value; }
  }

  function scrollToResults() {
    requestAnimationFrame(() => {
      const el = document.getElementById('results');
      if (el) el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    });
  }

  function goStep(step) {
    stopAnim();
    const L = LESSONS[S.lesson];
    if (S.step === 0 && step > 0) { lessonProg(L.id).learn = true; saveProgress(); }
    S.step = Math.max(0, Math.min(L.tasks.length, step));
    prog.last = { lesson: S.lesson, step: S.step };
    saveProgress();
    render({ top: true });
  }
  function goLesson(lid, step) {
    stopAnim();
    S.lesson = lid;
    S.step = step || 0;
    S.tab = 'ex0';
    S.drawer = false;
    prog.last = { lesson: lid, step: S.step };
    saveProgress();
    try { history.replaceState(null, '', '#' + lid); } catch (e) { /* ignore */ }
    render({ top: true });
  }
  function next() {
    if (S.step < LESSONS[S.lesson].tasks.length) { goStep(S.step + 1); return; }
    const idx = ORDER.indexOf(S.lesson);
    if (idx + 1 < ORDER.length) goLesson(ORDER[idx + 1], 0);
    else { S.drawer = true; render({ keepScroll: true }); }
  }

  let toastTimer = null;
  function toast(msg) {
    let el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
  }

  // ---------------------------------------------------------------- Ask Claude
  function taskContextText(L, T, ts) {
    const lines = [];
    lines.push(`Lesson: ${htmlToText(L.title)}`);
    lines.push('Key points: ' + L.keypoints.map(htmlToText).join(' | '));
    lines.push(`Task ${S.step} of ${L.tasks.length} (${TYPE_NAME[T.type]}, ${T.diff}): ${htmlToText(T.title)}`);
    lines.push('Task prompt: ' + htmlToText(T.prompt));
    if (T.code) lines.push('Code shown with the task:\n```python\n' + T.code + '\n```');
    if (T.type === 'mcq' || T.type === 'multi') {
      lines.push('Options: ' + T.options.map((o, i) => `(${i + 1}) ${htmlToText(o.html)}${o.ok ? ' [correct]' : ''}`).join('  '));
      const sel = T.type === 'mcq' ? (ts.sel === null ? [] : [ts.sel]) : ts.sel;
      lines.push('Learner picked: ' + (sel.length ? sel.map((i) => htmlToText(T.options[i].html)).join(', ') : 'nothing yet'));
    }
    if (T.type === 'predict') { lines.push('Learner\'s answer for the output:\n' + (ts.text || '(empty)')); lines.push('Actual output:\n' + T.expected); }
    if (T.type === 'fill') { lines.push('Learner filled the blanks with: ' + ts.fills.join(' | ')); lines.push('Correct answer: ' + T.answers.join(' | ')); }
    if (T.type === 'parsons') { const all = T.lines.concat(T.distractors); lines.push('Learner\'s arrangement:\n' + ts.placed.map((p) => '    '.repeat(p.indent) + all[p.idx].text).join('\n')); lines.push('Correct program:\n' + T.lines.map((l) => '    '.repeat(l.indent) + l.text).join('\n')); }
    if (T.type === 'cells') { lines.push('Learner\'s boxes: ' + ts.cells.join(' | ')); lines.push('Correct: ' + T.answer.join(' | ')); }
    if (T.type === 'order') lines.push('Learner\'s order: ' + ts.order.map((i) => htmlToText(T.items[i])).join(' > ') + '\nCorrect order: ' + T.items.map(htmlToText).join(' > '));
    if (T.type === 'code') {
      lines.push('Learner\'s code:\n```python\n' + (ts.code || '') + '\n```');
      lines.push('Model solution (for your reference; do not paste it unless they ask for the answer):\n```python\n' + T.solution + '\n```');
      if (T.cases) lines.push('The code is checked in several cases. ' + T.cases.map((cs, ci) => `Case ${ci + 1} starts with: ${cs.setup.split('\n').join('; ')}; then expects ` + T.tests.map((t, i) => `${t.code} -> ${cs.expect[i]}`).join(', ')).join('. '));
      else if (T.tests) lines.push('Tests: ' + T.tests.map((t) => `${t.code} -> ${t.expect}`).join('; '));
    }
    const r = ts.result;
    if (r) lines.push(`Result: ${r.ok ? 'correct' : 'not correct'} (${r.title}${r.sub ? ', ' + r.sub : ''}). Feedback shown: ${htmlToText((r.specific || '') + ' ' + (r.ok ? T.right : T.wrong))}`);
    else lines.push('They have not submitted yet.');
    return lines.join('\n');
  }
  async function askSend(question) {
    const L = LESSONS[S.lesson];
    const T = L.tasks[S.step - 1];
    const ts = TS(S.lesson, S.step);
    if (!sampleFn || !question.trim() || (ts.ask && ts.ask.busy)) return;
    ts.ask = ts.ask || { open: true, turns: [] };
    ts.ask.turns.push({ role: 'user', text: question.trim() });
    ts.ask.turns.push({ role: 'assistant', text: 'Thinking…' });
    ts.ask.busy = true;
    ts.ask.draft = '';
    ts.ask.error = null;
    render({ keepScroll: true });
    const rules = 'You are a patient, encouraging Python tutor inside a beginner course called Stepwise (Python, then Big O, data structures and algorithms). '
      + 'Answer the learner\'s question about the task below in plain, simple English, step by step, in under 180 words. Use a tiny code example only if it helps. '
      + 'Explain why, and connect it to the lesson\'s key points. If they were wrong, help them see the exact mistake; give the full answer only if they ask for it.\n\n'
      + taskContextText(L, T, ts);
    const history = [{ role: 'user', content: rules }];
    const prior = ts.ask.turns.slice(0, -2);
    for (const t of prior) history.push({ role: t.role, content: t.text });
    history.push({ role: 'user', content: question.trim() });
    const ctl = new AbortController();
    ts.ask.ctl = ctl;
    const target = ts.ask.turns[ts.ask.turns.length - 1];
    let lastPaint = 0;
    try {
      const out = await sampleFn(history, {
        signal: ctl.signal, cache: false,
        onText: ({ text }) => { target.text = text; const now = Date.now(); if (now - lastPaint > 150) { lastPaint = now; render({ keepScroll: true }); } },
      });
      target.text = out.text;
      if (out.truncated) target.text += '\n\n(cut short)';
    } catch (e) {
      const code = e && e.code;
      if (e && e.text) target.text = e.text; else ts.ask.turns.pop();
      if (code === 'not_granted' || code === 'sampling_disabled' || code === 'not_declared' || code === 'capability_disabled' || code === 'capability_removed') { sampleFn = null; ts.ask.error = 'Claude isn\'t available on this page.'; }
      else if (code === 'cancelled') ts.ask.error = null;
      else if (code === 'rate_limited') ts.ask.error = 'Too many questions in a short time. Wait a moment, then ask again.';
      else ts.ask.error = 'Claude couldn\'t answer just now. Try again in a moment.';
    }
    ts.ask.busy = false;
    render({ keepScroll: true });
  }

  // ---------------------------------------------------------------- drawer
  function drawerHTML() {
    const totalSolved = ORDER.reduce((a, lid) => a + doneCount(lid), 0);
    const units = C.units.map((u, ui) => {
      const row = (it, label, sub) => {
        if (!it.id) return `<button class="lrow${sub ? ' sub' : ''}" disabled><span class="n">${label}</span><span class="t">${esc(it.title)}</span><span class="p">being written</span></button>`;
        const d = doneCount(it.id);
        const n = ntasks(it.id);
        return `<button class="lrow${sub ? ' sub' : ''}${it.id === S.lesson ? ' cur' : ''}" data-act="lesson" data-id="${it.id}"${it.id === S.lesson ? ' aria-current="true"' : ''}><span class="n">${label}</span><span class="t">${esc(htmlToText(it.title))}</span><span class="mini" aria-hidden="true"><div style="width:${Math.round((d / n) * 100)}%"></div></span><span class="p${d >= n ? ' full' : ''}">${d}/${n}</span></button>`;
      };
      const rows = u.items.map((it, k) => {
        const n = String(k + 1).padStart(2, '0');
        return row(it, n, false) + (it.children || []).map((ch, j) => row(ch, `${k + 1}.${j + 1}`, true)).join('');
      }).join('');
      return `<section class="unit"><div class="unit-h"><span class="label">Unit ${ui + 1}</span><b>${esc(u.title)}</b><span>${esc(u.blurb)}</span></div>${rows}</section>`;
    }).join('');
    return `<div class="drawer-back" data-act="drawer-close-bg"><div class="drawer" role="dialog" aria-modal="true" aria-label="Course map" data-stop="1">
      <div class="drawer-h"><h2>Course map</h2><button class="btn" data-act="drawer-close" aria-label="Close course map">${icon('close')}Close</button></div>
      <div class="totals"><span>${totalSolved} tasks solved</span><span>${prog.xp || 0} XP</span><span>${plural(streakCount(), 'day')} streak</span></div>
      ${units}
      <p class="note-sm">Your progress is saved to your account when you're signed in, and in this browser either way.</p>
    </div></div>`;
  }

  // ---------------------------------------------------------------- main render
  let lastView = null;
  function render(opts) {
    opts = opts || {};
    const L = LESSONS[S.lesson];
    if (!L) { renderLoading(opts); return; }
    if (S.step > L.tasks.length) S.step = 0;
    const lp = root.querySelector('.lesson-pane'), ep = root.querySelector('.editor-pane');
    const keep = opts.keepScroll && lp && ep ? { l: lp.scrollTop, e: ep.scrollTop, w: window.scrollY } : null;
    const active = document.activeElement && document.activeElement.id;
    let left, right;
    if (S.step === 0) { left = learnLeft(L); right = learnRight(L); }
    else { const T = L.tasks[S.step - 1]; const ts = TS(S.lesson, S.step); left = taskLeft(L, T, ts); right = taskRight(L, T, ts); }
    root.innerHTML = headerHTML() + `<main class="work"><section class="lesson-pane" aria-label="Lesson">${left}</section><section class="editor-pane" aria-label="Code and results">${right}</section></main>` + (S.drawer ? drawerHTML() : '');
    highlightSnippets(root);
    const view = S.lesson + ':' + S.step + ':' + S.tab;
    const nlp = root.querySelector('.lesson-pane'), nep = root.querySelector('.editor-pane');
    if (keep) { nlp.scrollTop = keep.l; nep.scrollTop = keep.e; window.scrollTo(0, keep.w); }
    else if (opts.top || view !== lastView) { nlp.scrollTop = 0; nep.scrollTop = 0; if (opts.top) window.scrollTo(0, 0); }
    lastView = view;
    // mount interactive parts
    if (S.step === 0) {
      if (S.tab.startsWith('an')) renderAnim();
      const exIdx = parseInt(S.tab.slice(2), 10) || 0;
      if (!S.tab.startsWith('an') && exState(L, exIdx).editing) mountEditor('ex-editor', (v) => { exState(L, exIdx).code = v; }, () => runExample());
    } else {
      const T = L.tasks[S.step - 1];
      const ts = TS(S.lesson, S.step);
      if (T.type === 'code' && ts.tab !== 'tests') mountEditor('task-editor', (v) => { ts.code = v; saveDraft(tkey(S.lesson, S.step), v); }, () => runTests());
      const pin = document.getElementById('predict-in');
      if (pin) pin.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); submit(); } });
    }
    if (active) { const el = document.getElementById(active); if (el && opts.keepScroll) { try { el.focus({ preventScroll: true }); } catch (e) { /* ignore */ } } }
    if (S.drawer) { const d = root.querySelector('.drawer .btn'); if (d && !opts.keepScroll) d.focus(); }
  }

  // the lesson's content arrives as its own small file the first time it's opened
  function renderLoading(opts) {
    const id = S.lesson;
    const info = INFO[id];
    root.innerHTML = headerHTML() + `<main class="work"><section class="lesson-pane" aria-label="Lesson"><div class="block"><div class="label">Lesson ${esc(info.num)}</div><h1 class="title">${esc(htmlToText(info.title))}</h1><div class="prose" id="load-msg"><p>Loading the lesson…</p></div></div></section><section class="editor-pane" aria-label="Code and results"></section></main>` + (S.drawer ? drawerHTML() : '');
    loadLesson(id).then(() => { if (S.lesson === id) render(opts); }, () => {
      const m = document.getElementById('load-msg');
      if (m && S.lesson === id) m.innerHTML = '<p>This lesson couldn\'t be loaded. Check your connection, then try again.</p><div class="lesson-actions"><button class="btn primary" data-act="reload-lesson">Try again</button></div>';
    });
  }

  function runExample() {
    const L = LESSONS[S.lesson];
    const idx = parseInt(S.tab.slice(2), 10) || 0;
    const es = exState(L, idx);
    const ed = document.getElementById('ex-editor');
    if (ed) es.code = ed.value;
    const r = PR.run(es.editing ? es.code : L.examples[idx].code, { stepLimit: 2000000, filename: `example_${idx + 1}.py` });
    es.run = { stdout: r.stdout, error: r.error, live: true };
    render({ keepScroll: true });
  }

  // ---------------------------------------------------------------- events
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    if (act === 'drawer-close-bg') { if (e.target.closest('[data-stop]')) return; S.drawer = false; render({ keepScroll: true }); return; }
    const L = LESSONS[S.lesson];
    if (act === 'reload-lesson') { render({ top: true }); return; }
    if (!L && act !== 'drawer' && act !== 'drawer-close' && act !== 'lesson') return;
    const ts = L && S.step > 0 ? TS(S.lesson, S.step) : null;
    const T = L && S.step > 0 ? L.tasks[S.step - 1] : null;
    switch (act) {
      case 'drawer': S.drawer = true; render({ keepScroll: true }); break;
      case 'drawer-close': S.drawer = false; render({ keepScroll: true }); break;
      case 'lesson': goLesson(t.dataset.id, 0); break;
      case 'step': goStep(parseInt(t.dataset.step, 10)); break;
      case 'tab': stopAnim(); S.tab = t.dataset.tab; render({ keepScroll: false }); break;
      case 'exrun': runExample(); break;
      case 'exedit': { const idx = parseInt(S.tab.slice(2), 10) || 0; exState(L, idx).editing = true; render({ keepScroll: true }); const ed = document.getElementById('ex-editor'); if (ed) ed.focus(); break; }
      case 'exreset': { const idx = parseInt(S.tab.slice(2), 10) || 0; const es = exState(L, idx); es.code = L.examples[idx].code; es.editing = false; es.run = null; render({ keepScroll: true }); break; }
      case 'exnote': { const idx = parseInt(S.tab.slice(2), 10) || 0; const es = exState(L, idx); const sel = [+t.dataset.from, +t.dataset.to]; es.sel = es.sel && es.sel[0] === sel[0] && es.sel[1] === sel[1] ? null : sel; es.editing = false; render({ keepScroll: true }); break; }
      case 'exline': { const idx = parseInt(S.tab.slice(2), 10) || 0; const es = exState(L, idx); const n = +t.dataset.line; const nt = L.examples[idx].notes.find((x) => n >= x.from && n <= x.to); es.sel = nt ? [nt.from, nt.to] : [n, n]; render({ keepScroll: true }); break; }
      case 'anim-play': { const an = L.anims[parseInt(S.tab.slice(2), 10) || 0]; if (S.anim.playing) { stopAnim(); renderAnim(); } else { if (S.anim.i >= an.frames.length - 1) S.anim.i = 0; S.anim.playing = true; renderAnim(); S.anim.timer = setTimeout(tickAnim, 900 / S.anim.speed); } break; }
      case 'anim-next': { stopAnim(); const an = L.anims[parseInt(S.tab.slice(2), 10) || 0]; S.anim.i = Math.min(an.frames.length - 1, S.anim.i + 1); renderAnim(); break; }
      case 'anim-prev': stopAnim(); S.anim.i = Math.max(0, S.anim.i - 1); renderAnim(); break;
      case 'anim-restart': stopAnim(); S.anim.i = 0; renderAnim(); break;
      case 'hint': ts.hints = Math.min(T.hints.length, ts.hints + 1); { const lp2 = lessonProg(L.id); if (lp2.t[S.step - 1]) lp2.t[S.step - 1].hints = ts.hints; saveProgress(); } render({ keepScroll: true }); break;
      case 'submit': submit(); break;
      case 'runtests': runTests(); break;
      case 'tryrun': tryRun(); break;
      case 'predict-run': { collectInputs(T, ts); const r = PR.run(T.code, { stepLimit: 500000 }); ts.liveRun = r.stdout + (r.error ? (r.error.traceback || r.error.message) : ''); render({ keepScroll: true }); break; }
      case 'next': next(); break;
      case 'retry': collectInputs(T, ts); ts.result = null; if (T.type === 'mcq') ts.sel = null; if (T.type === 'multi') ts.sel = []; if (T.type !== 'fill' && T.type !== 'parsons') ts.run = null; ts.ask = ts.ask ? Object.assign(ts.ask, { open: false }) : null; render({ keepScroll: true }); break;
      case 'reveal': collectInputs(T, ts); ts.revealed = true; { const lp2 = lessonProg(L.id); const cur = lp2.t[S.step - 1] || { s: 'tried', tries: 0 }; cur.rev = true; lp2.t[S.step - 1] = cur; saveProgress(); } render({ keepScroll: true }); break;
      case 'model': ts.showModel = true; render({ keepScroll: true }); break;
      case 'ttab': collectInputs(T, ts); ts.tab = t.dataset.tab; render({ keepScroll: true }); break;
      case 'pick': {
        if (ts.result) break;
        const i = parseInt(t.dataset.i, 10);
        if (T.type === 'mcq') ts.sel = i;
        else { const k = ts.sel.indexOf(i); if (k >= 0) ts.sel.splice(k, 1); else ts.sel.push(i); }
        render({ keepScroll: true });
        break;
      }
      case 'pz-add': { if (ts.result && ts.result.ok) break; const idx = parseInt(t.dataset.idx, 10); const all = T.lines.concat(T.distractors); const prevIndent = ts.placed.length ? ts.placed[ts.placed.length - 1].indent : 0; const prevText = ts.placed.length ? all[ts.placed[ts.placed.length - 1].idx].text : ''; ts.placed.push({ idx, indent: /:\s*$/.test(prevText) ? prevIndent + 1 : prevIndent }); ts.result = null; render({ keepScroll: true }); break; }
      case 'pz': {
        const k = parseInt(t.dataset.k, 10);
        const op = t.dataset.op;
        const p = ts.placed;
        if (op === 'up' && k > 0) [p[k - 1], p[k]] = [p[k], p[k - 1]];
        if (op === 'down' && k < p.length - 1) [p[k + 1], p[k]] = [p[k], p[k + 1]];
        if (op === 'in') p[k].indent = Math.min(6, p[k].indent + 1);
        if (op === 'out') p[k].indent = Math.max(0, p[k].indent - 1);
        if (op === 'del') p.splice(k, 1);
        ts.result = null;
        render({ keepScroll: true });
        break;
      }
      case 'ord': {
        const k = parseInt(t.dataset.k, 10);
        const o = ts.order;
        if (t.dataset.op === 'up' && k > 0) [o[k - 1], o[k]] = [o[k], o[k - 1]];
        if (t.dataset.op === 'down' && k < o.length - 1) [o[k + 1], o[k]] = [o[k], o[k + 1]];
        ts.result = null;
        render({ keepScroll: true });
        break;
      }
      case 'ask-open': collectInputs(T, ts); ts.ask = ts.ask || { open: true, turns: [] }; ts.ask.open = true; render({ keepScroll: true }); { const el = document.getElementById('ask-in'); if (el) el.focus(); else scrollToResults(); } break;
      case 'ask-close': ts.ask.open = false; render({ keepScroll: true }); break;
      case 'ask-quick': askSend(t.dataset.q); break;
      case 'ask-send': { const el = document.getElementById('ask-in'); if (el) askSend(el.value); break; }
      case 'ask-stop': if (ts.ask && ts.ask.ctl) ts.ask.ctl.abort(); break;
    }
  });
  root.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'anim-scrub') { stopAnim(); S.anim.i = parseInt(t.value, 10) || 0; renderAnim(); return; }
    if (S.step > 0) {
      const ts = TS(S.lesson, S.step);
      if (t.classList.contains('blank')) { ts.fills[+t.dataset.blank] = t.value; t.style.width = Math.max(6, t.value.length + 4) + 'ch'; }
      if (t.classList.contains('cellin')) ts.cells[+t.dataset.cell] = t.value;
      if (t.id === 'predict-in') ts.text = t.value;
      if (t.id === 'ask-in' && ts.ask) ts.ask.draft = t.value;
    }
  });
  window.addEventListener('hashchange', () => {
    const id = decodeURIComponent((location.hash || '').slice(1));
    if (id && INFO[id] && id !== S.lesson) goLesson(id, 0);
  });
  root.addEventListener('change', (e) => {
    if (e.target.id === 'anim-speed') { S.anim.speed = parseFloat(e.target.value) || 1; }
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && S.drawer) { S.drawer = false; render({ keepScroll: true }); }
    if (e.target && e.target.id === 'ask-in' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); askSend(e.target.value); }
    if (e.target && e.target.classList && (e.target.classList.contains('blank') || e.target.classList.contains('cellin')) && e.key === 'Enter') { e.preventDefault(); submit(); }
  });

  // ---------------------------------------------------------------- boot
  render({ top: true });
  setTimeout(() => {
    try { PR.run('def _w(n):\n    return 0 if n == 0 else 1 + _w(n - 1)\nfor _ in range(30):\n    _w(150)\n', { stepLimit: 2000000 }); } catch (e) { /* ignore */ }
  }, 400);
  (async function cloud() {
    const cl = window.claude;
    if (!cl || typeof cl.use !== 'function') return;
    try {
      const [dbNs, userNs, smp] = await Promise.all([cl.use('db').catch(() => null), cl.use('user').catch(() => null), cl.use('sample').catch(() => null)]);
      if (smp) { sampleFn = smp; render({ keepScroll: true }); }
      if (dbNs && userNs) {
        const uid = await userNs.id();
        if (uid) {
          const ref = dbNs.doc('data/users/' + uid + '/progress');
          const snap = await ref.get();
          cloudRef = ref;
          if (snap.exists) {
            prog = mergeProgress(prog, snap.data() || {});
            lsSet(PKEY, JSON.stringify(prog));
            render({ keepScroll: true });
          }
          flushCloud();
        }
      }
    } catch (e) { /* keep working locally */ }
  })();
})();
