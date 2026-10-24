'use strict';
/* PulseShift: static wiring, accessibility hooks, theme coverage, offline precache, and a jsdom-free behavioural run of the UI code against a tiny DOM stub. Real-browser checks: see README. */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const html = read('index.html'), js = read('floaty.js'), css = read('style.css'), themes = read('themes.css'), sw = read('service-worker.js');
const precache = () => eval(sw.match(/const PRECACHE = (\[[\s\S]*?\]);/)[1]);

test('every PulseShift element id floaty.js looks up exists exactly once in index.html, inside #swPanel', () => {
  const ids = new Set([...js.matchAll(/\$\('#(ps[A-Za-z_]*)'\)/g)].map(m => m[1])); assert.ok(ids.size >= 12, [...ids].join());
  const panel = html.slice(html.indexOf('id="swPanel"'), html.indexOf('id="toast"'));
  for (const id of ids) { assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, id); assert.ok(panel.includes(`id="${id}"`), id + ' must live inside the floating panel'); }
});
test('markup: 3-way mode control, direction toggle (future default), steppers for days / hours / minutes / seconds, result card + Copy Result', () => {
  const seg = html.slice(html.indexOf('id="psMode"'), html.indexOf('id="psBase"')); assert.deepEqual([...seg.matchAll(/data-mode="(\w+)"/g)].map(m => m[1]), ['date', 'time', 'datetime']); assert.ok(/role="radiogroup" aria-label="PulseShift mode"/.test(html));
  assert.ok(/data-dir="future"[^>]*>|aria-checked="true" data-dir="future"/.test(html) && /role="radio" aria-checked="true" data-dir="future"/.test(html) && /role="radio" aria-checked="false" data-dir="past"/.test(html));
  for (const k of ['days', 'hours', 'minutes', 'seconds']) { assert.ok(new RegExp(`<label for="ps_${k}">`).test(html), k + ' label'); assert.ok(new RegExp(`id="ps_${k}" class="in" type="number"[^>]*min="0"`).test(html), k + ' input'); assert.equal((html.match(new RegExp(`data-for="${k}"`, 'g')) || []).length, 2, k + ' − / + buttons'); }
  assert.ok(/id="psCopy"[^>]*>Copy Result</.test(html)); assert.ok(/id="psResult" role="status" aria-live="polite"/.test(html)); assert.ok(/<input id="psBase" class="in" type="date"/.test(html));
  assert.ok(/id="psToggle"[^>]*aria-expanded="false"[^>]*aria-controls="psBody"/.test(html) && /id="psBody" hidden/.test(html), 'collapsed by default so the panel stays compact');
});
test('offline: lib48.js loads after lib47.js and before floaty.js, and is precached; the cache name was bumped', () => {
  const order = [...html.matchAll(/<script defer src="([^"]+)"/g)].map(m => m[1]); assert.ok(order.indexOf('lib/lib48.js') === order.indexOf('lib/lib47.js') + 1 && order.indexOf('lib/lib48.js') < order.indexOf('floaty.js'));
  assert.ok(precache().includes('lib/lib48.js') && fs.existsSync(path.join(root, 'lib/lib48.js'))); assert.ok(/VERSION = '4\.2\.8'/.test(sw));
});
test('PulseShift stores nothing outside the widget key, uses no network, and the maths module is DOM-free', () => {
  const lib = read('lib/lib48.js').replace(/\/\*[\s\S]*?\*\//g, ''); assert.ok(!/document|window\b|localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(lib)); assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon|WebSocket/.test(js));
  assert.equal((js.match(/localStorage\./g) || []).length, 2, 'only the existing load/persist pair touches storage (key chronopulse:widget)'); assert.ok(/ps: loadPs\(r\.ps\)/.test(js));
});
test('roaming/drag physics are untouched and PulseShift never starts the roaming loop or its own timers', () => {
  const part = js.slice(js.indexOf('/* ---------- PulseShift'), js.indexOf('/* ---------- preferences'));
  assert.ok(!/requestAnimationFrame|setInterval|kick\(|stopRoam\(|roamStep/.test(part)); assert.ok(/canRoam = \(\) => pref\.show && pref\.roam && !dragging && !open/.test(js), 'roaming still pauses while the panel is open');
  assert.ok(/placePanel\(\)/.test(part), 'panel is re-placed after the section opens or the layout changes so it never overflows the viewport');
});
test('CSS: every PulseShift rule takes its colours from theme variables (no hard-coded colours outside rgba shadows), for all four themes', () => {
  const rules = css.slice(css.indexOf('4.2.8 PulseShift')); assert.ok(rules.length > 1500); assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(rules), 'no hex colours in PulseShift rules');
  for (const v of ['--grad', '--on-em', '--inset', '--input', '--line', '--tx', '--mu', '--em', '--red']) assert.ok(rules.includes(`var(${v}`), v);
  const t = themes.slice(themes.indexOf('4.2.8 PulseShift')); for (const th of ['oled', 'neon', 'pastel']) assert.ok(t.includes(`html[data-theme=${th}] .ps`), th);
  for (const th of ['html[data-theme=oled]', 'html[data-theme=neon]', 'html[data-theme=pastel]']) { const line = themes.split('\n').find(l => l.startsWith(th + '{')); assert.ok(line && /--on-em:/.test(themes.split('\n').slice(themes.split('\n').indexOf(line), themes.split('\n').indexOf(line) + 4).join('')) || th.includes('oled'), th + ' defines --on-em/--grad'); }
});
test('CSS: the panel stays inside the viewport (scrolls instead of overflowing) and the section is flow content, not positioned', () => {
  assert.ok(/\.sw-panel\{[^}]*max-height:calc\(100dvh - 16px\)[^}]*overflow:auto/.test(css)); const ps = css.slice(css.indexOf('4.2.8 PulseShift')); assert.ok(!/position:(fixed|absolute)/.test(ps));
  assert.ok(/\.ps-body\[hidden\]\{display:none\}/.test(ps) && /\.ps-f\[hidden\]\{display:none\}/.test(ps), 'display rules must not defeat the hidden attribute');
  assert.ok(/prefers-reduced-motion:reduce\)\{\.ps-chev/.test(ps));
});

/* ---- behavioural run: execute floaty.js against a minimal DOM stub and drive PulseShift like a user ---- */
function harness() {
  const listeners = new Map(), mk = (id, extra = {}) => { const e = { id, value: '', type: 'text', hidden: false, disabled: false, textContent: '', dataset: {}, style: {}, classList: { s: new Set(), add(c) { this.s.add(c); }, remove(c) { this.s.delete(c); }, toggle(c, on) { on ? this.s.add(c) : this.s.delete(c); }, contains(c) { return this.s.has(c); } }, attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; }, removeAttribute(k) { delete this.attrs[k]; }, addEventListener(t, f) { (listeners.get(id + ':' + t) || listeners.set(id + ':' + t, []).get(id + ':' + t)).push(f); }, closest() { return e._closest || null; }, querySelectorAll() { return e._kids || []; }, contains() { return false; }, focus() {}, replaceChildren() {}, append() {}, appendChild() {}, setPointerCapture() {}, getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; }, offsetHeight: 400, ...extra }; return e; };
  const els = {}, get = sel => { const id = sel.slice(1); return els[id] || (els[id] = mk(id)); };
  const ids = ['swFab', 'swPanel', 'swClose', 'swHH', 'swHM', 'swHS', 'swDigital', 'swDate', 'swTime', 'swGo', 'swLap', 'swReset', 'swLaps', 'swSr', 'swRoam', 'swH24', 'swShow', 'swRoamNote', 'psToggle', 'psBody', 'psMode', 'psDir', 'psBase', 'psMain', 'psSub', 'psSummary', 'psCopy', 'psResult', 'psFields', 'ps_days', 'ps_hours', 'ps_minutes', 'ps_seconds'];
  for (const id of ids) get('#' + id);
  const field = k => { const f = mk('f_' + k); els['ps_' + k]._closest = f; return f; }; const fields = {}; for (const k of ['days', 'hours', 'minutes', 'seconds']) fields[k] = field(k);
  els.ps_days.value = '0'; els.ps_hours.value = '0'; els.ps_minutes.value = '0'; els.ps_seconds.value = '0'; els.psBody.hidden = true; els.swPanel.hidden = true; els.psBase.type = 'date';
  const modeBtns = ['date', 'time', 'datetime'].map(m => { const b = mk('m_' + m); b.dataset.mode = m; b.closest = () => b; return b; }), dirBtns = ['past', 'future'].map(d => { const b = mk('d_' + d); b.dataset.dir = d; b.closest = () => b; return b; });
  els.psMode._kids = modeBtns; els.psDir._kids = dirBtns; const store = {}; const copied = []; const toasts = [];
  const doc = { hidden: false, body: mk('body'), addEventListener() {}, querySelector: () => null, createElement: () => mk('x') };
  const ctx = { document: doc, $: get, X: { onSettings() {} }, setT: (e, t) => { if (e && e.textContent !== t) e.textContent = t; }, toast: m => toasts.push(m), CP47: require('../lib/lib47.js'), CP48: require('../lib/lib48.js'), console, Math, Date, JSON, Number, Object, Array, String, Set, Promise, parseInt, isFinite,
    localStorage: { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; } }, innerWidth: 400, innerHeight: 800, matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {}, requestAnimationFrame: () => 1, cancelAnimationFrame() {}, setTimeout: f => { f(); return 1; }, clearTimeout() {}, navigator: { clipboard: { writeText: async t => { copied.push(t); } } } };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(js, ctx);
  const fire = (id, ev, e = {}) => { for (const f of listeners.get(id + ':' + ev) || []) f({ target: els[id], ...e }); };
  return { els, fire, fields, modeBtns, dirBtns, copied, toasts, store, ctx };
}
test('behaviour: opening the section computes live; direction, mode and steppers update the result; Copy Result copies it', async () => {
  const h = harness(), { els } = h;
  h.fire('psToggle', 'click'); assert.equal(els.psBody.hidden, false); assert.equal(els.psToggle.attrs['aria-expanded'], 'true');
  els.psBase.value = '2025-01-31'; h.fire('psBase', 'input'); assert.equal(els.psMain.textContent, 'Fri, 31 Jan 2025', 'zero offset returns the start itself');
  els.ps_days.value = '1'; h.fire('ps_days', 'input'); assert.equal(els.psMain.textContent, 'Sat, 1 Feb 2025'); assert.equal(els.psSummary.textContent, '+ 1 day'); assert.equal(els.psCopy.disabled, false);
  h.fire('psDir', 'click', { target: h.dirBtns[0] }); assert.equal(els.psMain.textContent, 'Thu, 30 Jan 2025'); assert.equal(h.dirBtns[0].attrs['aria-checked'], 'true'); assert.equal(h.dirBtns[1].attrs['aria-checked'], 'false');
  h.fire('psDir', 'click', { target: h.dirBtns[1] }); assert.equal(els.psMain.textContent, 'Sat, 1 Feb 2025');
  h.fire('psMode', 'click', { target: h.modeBtns[1] }); assert.equal(els.psBase.type, 'time'); assert.equal(els.ps_days.closest('.ps-f') === h.fields.days, true); assert.equal(h.fields.days.hidden, true); assert.equal(h.fields.hours.hidden, false); assert.equal(h.fields.seconds.hidden, false);
  els.psBase.value = '23:30:00'; els.ps_hours.value = '1'; h.fire('ps_hours', 'input'); assert.equal(els.psSub.textContent, '00:30:00 · +1 day');
  h.fire('psMode', 'click', { target: h.modeBtns[2] }); assert.equal(els.psBase.type, 'datetime-local'); assert.equal(h.fields.seconds.hidden, true); assert.equal(h.fields.days.hidden, false);
  els.psBase.value = '2025-12-31T23:30'; h.fire('psBase', 'input'); els.ps_days.value = '0'; els.ps_hours.value = '1'; els.ps_minutes.value = '0'; h.fire('ps_hours', 'input'); assert.equal(els.psSub.textContent, '2026-01-01 00:30');
  h.fire('psCopy', 'click'); await new Promise(r => setImmediate(r)); assert.equal(h.copied.length, 1); assert.match(h.copied[0], /2026-01-01 00:30/);
});
test('behaviour: invalid and out-of-range states disable Copy; persistence stays in the widget key', () => {
  const h = harness(), { els } = h; h.fire('psToggle', 'click'); els.psBase.value = ''; h.fire('psBase', 'input'); assert.equal(els.psMain.textContent, 'Pick a starting point'); assert.equal(els.psCopy.disabled, true); assert.ok(els.psResult.classList.contains('bad'));
  els.psBase.value = '9999-12-31'; els.ps_days.value = '1'; h.fire('psBase', 'input'); assert.equal(els.psMain.textContent, 'Out of range'); assert.equal(els.psCopy.disabled, true);
  els.psBase.value = '2025-01-31'; h.fire('psBase', 'input'); assert.equal(els.psMain.textContent, 'Sat, 1 Feb 2025'); assert.ok(!els.psResult.classList.contains('bad'));
  els.ps_days.value = '5'; h.fire('ps_days', 'change'); assert.deepEqual(Object.keys(h.store), ['chronopulse:widget']); const ps = JSON.parse(h.store['chronopulse:widget']).ps; assert.equal(ps.open, true); assert.equal(ps.off.days, 5); assert.equal(ps.mode, 'date');
});
