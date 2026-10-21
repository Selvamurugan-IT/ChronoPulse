'use strict';
/* ChronoPulse 4.2.x — floating stopwatch + live clock. The icon glides slowly around the screen, can be dragged anywhere (and thrown), and opens a panel with a precision
   stopwatch (start / pause / reset / laps) and a live analog + digital clock synced to the device clock. All maths is in lib/lib47.js (unit-tested).
   Preferences and the running stopwatch live in their own localStorage key (chronopulse:widget) as TIMESTAMPS, so a running stopwatch survives a reload and is never
   drifted by throttled timers. Nothing is sent anywhere; works offline. Roaming stops while the tab is hidden, while dragging, while the panel is open, and under reduced motion. */
(function () {
  const Q = CP47, KEY = 'chronopulse:widget', SIZE = 52;
  const fab = $('#swFab'), panel = $('#swPanel'); if (!fab || !panel) return;
  const safe = f => { try { return f(); } catch (e) { return undefined; } };
  const osRm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  let pref = { show: true, roam: true, h24: false, x: -1, y: -1, sw: Q.SW0() };
  const load = () => { const r = safe(() => JSON.parse(localStorage.getItem(KEY) || 'null')); if (r && typeof r === 'object') { pref = { ...pref, show: r.show !== false, roam: r.roam !== false, h24: r.h24 === true, x: Number.isFinite(r.x) ? r.x : -1, y: Number.isFinite(r.y) ? r.y : -1 }; const s = r.sw; if (s && typeof s === 'object') pref.sw = { running: s.running === true, startedAt: +s.startedAt || 0, acc: Math.max(0, +s.acc || 0), laps: Array.isArray(s.laps) ? s.laps.filter(Number.isFinite).slice(0, Q.MAX_LAPS) : [] }; } };
  const persist = () => safe(() => localStorage.setItem(KEY, JSON.stringify(pref)));
  load();

  /* ---------- roaming + dragging ---------- */
  const box = () => ({ w: innerWidth, h: innerHeight, size: SIZE, speed: 0.4 });
  let p = { x: 0, y: 0, vx: 0.35, vy: 0.22 }, raf = 0, lastT = 0, dragging = false, justDragged = false, samples = [], open = false, off = null;
  const place = () => { fab.style.transform = `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px)`; };
  function init() {
    const b = box(); if (pref.x >= 0) { const c = Q.clampPos(pref.x, pref.y, b); p.x = c.x; p.y = c.y; } else { p.x = Math.max(0, b.w - SIZE - 18); p.y = Math.max(0, b.h * 0.55); }
    const a = Math.random() * 6.28; p.vx = Math.cos(a) * 0.4; p.vy = Math.sin(a) * 0.4; place();
  }
  const canRoam = () => pref.show && pref.roam && !dragging && !open && !document.hidden && !osRm();
  function loop(now) {
    raf = 0; if (!canRoam()) return; const dt = lastT ? now - lastT : 16.67; lastT = now;
    p = Q.roamStep(p, dt, box(), Math.random); place(); raf = requestAnimationFrame(loop);
  }
  function kick() { if (!raf && canRoam()) { lastT = 0; raf = requestAnimationFrame(loop); } }
  function stopRoam() { if (raf) cancelAnimationFrame(raf); raf = 0; }
  fab.addEventListener('pointerdown', e => {
    if (e.button > 0) return; dragging = true; justDragged = false; stopRoam(); off = { dx: e.clientX - p.x, dy: e.clientY - p.y, sx: e.clientX, sy: e.clientY }; samples = [{ x: e.clientX, y: e.clientY, t: e.timeStamp }];
    try { fab.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } fab.classList.add('drag');
  });
  fab.addEventListener('pointermove', e => {
    if (!dragging || !off) return; if (!Q.isTap(e.clientX - off.sx, e.clientY - off.sy)) justDragged = true;
    const c = Q.clampPos(e.clientX - off.dx, e.clientY - off.dy, box()); p.x = c.x; p.y = c.y; place(); samples.push({ x: e.clientX, y: e.clientY, t: e.timeStamp }); if (samples.length > 8) samples.shift();
    if (open) placePanel();
  });
  function release() {
    if (!dragging) return; dragging = false; fab.classList.remove('drag');
    if (justDragged) { const v = Q.throwVelocity(samples); p.vx = v.vx || p.vx; p.vy = v.vy || p.vy; pref.x = p.x; pref.y = p.y; persist(); }
    samples = []; off = null; kick(); setTimeout(() => { justDragged = false; }, 0);
  }
  fab.addEventListener('pointerup', release); fab.addEventListener('pointercancel', release); fab.addEventListener('lostpointercapture', release);
  fab.addEventListener('click', () => { if (justDragged) return; toggle(); }); /* a keyboard Enter/Space is a click with no drag, so it opens the panel too */
  addEventListener('resize', () => { const c = Q.clampPos(p.x, p.y, box()); p.x = c.x; p.y = c.y; place(); if (open) placePanel(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopRoam(); else kick(); });
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => { stopRoam(); kick(); renderPrefs(); });

  /* ---------- panel ---------- */
  function placePanel() {
    const w = Math.min(340, innerWidth - 16), h = panel.offsetHeight || 420; let x = p.x + SIZE / 2 - w / 2, y = p.y - h - 10; if (y < 8) y = Math.min(p.y + SIZE + 10, innerHeight - h - 8);
    x = Math.min(Math.max(8, x), innerWidth - w - 8); y = Math.max(8, y); panel.style.width = w + 'px'; panel.style.transform = `translate(${x.toFixed(0)}px,${y.toFixed(0)}px)`;
  }
  function toggle(force) {
    open = force === undefined ? !open : !!force; panel.hidden = !open; fab.setAttribute('aria-expanded', String(open)); stopRoam();
    if (open) { placePanel(); draw(); tickUi(); $('#swClose').focus(); } else { cancelAnimationFrame(uiRaf); uiRaf = 0; kick(); fab.focus(); }
  }
  $('#swClose').addEventListener('click', () => toggle(false));
  document.addEventListener('keydown', e => { if (open && e.key === 'Escape' && !document.querySelector('dialog[open]')) { e.stopPropagation(); toggle(false); } }); /* works wherever focus is inside the panel, even on a button that just became disabled */
  document.addEventListener('pointerdown', e => { if (open && !panel.contains(e.target) && !fab.contains(e.target)) toggle(false); }, true);

  /* ---------- clock ---------- */
  const hands = { h: $('#swHH'), m: $('#swHM'), s: $('#swHS') };
  function drawClock() { const d = new Date(), a = Q.clockHands(d); hands.h.setAttribute('transform', `rotate(${a.hour.toFixed(2)} 50 50)`); hands.m.setAttribute('transform', `rotate(${a.minute.toFixed(2)} 50 50)`); hands.s.setAttribute('transform', `rotate(${a.second.toFixed(2)} 50 50)`); const t = Q.digital(d, pref.h24); if ($('#swDigital').textContent !== t) $('#swDigital').textContent = t; const ds = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }); if ($('#swDate').textContent !== ds) $('#swDate').textContent = ds; }

  /* ---------- stopwatch ---------- */
  const el = { t: $('#swTime'), go: $('#swGo'), lap: $('#swLap'), rs: $('#swReset'), laps: $('#swLaps') };
  function drawSw() {
    const s = pref.sw, ms = Q.swElapsed(s, Date.now()); el.t.textContent = Q.fmtMs(ms);
    const label = s.running ? 'Pause' : ms > 0 ? 'Resume' : 'Start'; if (el.go.dataset.l !== label) { el.go.dataset.l = label; el.go.textContent = label; el.go.setAttribute('aria-pressed', String(s.running)); el.go.classList.toggle('run', s.running); }
    el.lap.disabled = !s.running; el.rs.disabled = ms === 0 && !s.running; fab.classList.toggle('running', s.running);
  }
  function drawLaps() {
    const rows = Q.lapRows(pref.sw); el.laps.replaceChildren(); el.laps.hidden = !rows.length;
    for (const r of rows) { const li = document.createElement('li'); if (r.best) li.className = 'best'; if (r.worst) li.className = 'worst'; const a = document.createElement('span'), b = document.createElement('b'), c = document.createElement('span'); a.textContent = 'Lap ' + r.n; b.textContent = Q.fmtMs(r.split); c.textContent = Q.fmtMs(r.total); li.append(a, b, c); el.laps.appendChild(li); }
  }
  function draw() { drawSw(); drawLaps(); drawClock(); renderPrefs(); }
  let uiRaf = 0, lastSec = -1; const sr = $('#swSr');
  function tickUi() { if (!open || document.hidden) { uiRaf = 0; return; } drawSw(); drawClock(); uiRaf = requestAnimationFrame(tickUi); }
  document.addEventListener('visibilitychange', () => { if (open && !document.hidden && !uiRaf) tickUi(); });
  const say = t => { sr.textContent = ''; setTimeout(() => { sr.textContent = t; }, 30); };
  el.go.addEventListener('click', () => { const now = Date.now(); pref.sw = pref.sw.running ? Q.swPause(pref.sw, now) : Q.swStart(pref.sw, now); persist(); draw(); say(pref.sw.running ? 'Stopwatch started' : 'Stopwatch paused at ' + Q.fmtMs(Q.swElapsed(pref.sw, now))); });
  el.lap.addEventListener('click', () => { pref.sw = Q.swLap(pref.sw, Date.now()); persist(); drawLaps(); const n = pref.sw.laps.length; if (n) say('Lap ' + n + ' ' + Q.fmtMs(pref.sw.laps[n - 1])); });
  el.rs.addEventListener('click', () => { pref.sw = Q.swReset(); persist(); draw(); say('Stopwatch reset'); });
  document.addEventListener('keydown', e => { if (!open || e.target.closest('input,select,textarea') || e.ctrlKey || e.metaKey || e.altKey) return; if (e.key === ' ' && !e.target.closest('button')) { e.preventDefault(); el.go.click(); } else if (e.key.toLowerCase() === 'l' && !el.lap.disabled) el.lap.click(); });

  /* ---------- preferences ---------- */
  const tog = (id, on) => { const b = $(id); if (b) b.setAttribute('aria-checked', String(!!on)); };
  function renderPrefs() { tog('#swRoam', pref.roam && !osRm()); $('#swRoam').disabled = osRm(); tog('#swH24', pref.h24); tog('#swShow', pref.show); fab.hidden = !pref.show; setT($('#swRoamNote'), osRm() ? 'Your device asks for reduced motion, so the icon stays still' : 'Icon drifts around the screen until you touch it'); }
  $('#swRoam').addEventListener('click', () => { pref.roam = !pref.roam; persist(); renderPrefs(); stopRoam(); kick(); });
  $('#swH24').addEventListener('click', () => { pref.h24 = !pref.h24; persist(); drawClock(); renderPrefs(); });
  $('#swShow').addEventListener('click', () => { pref.show = !pref.show; persist(); if (!pref.show) { toggle(false); stopRoam(); } else kick(); renderPrefs(); });
  /* the settings page toggle is re-rendered by the app's own settings render hook */
  const prevSet = X.onSettings; X.onSettings = () => { if (prevSet) prevSet(); renderPrefs(); };
  addEventListener('storage', e => { if (e.key === KEY) { load(); draw(); } });
  init(); drawSw(); renderPrefs(); kick(); X.floaty = { toggle, state: () => ({ ...pref, open, pos: { ...p } }) };
})();
