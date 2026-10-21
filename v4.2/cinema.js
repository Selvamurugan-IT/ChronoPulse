'use strict';
/* ChronoPulse 4.2 (Phase 3) — cinematic countdown runtime (UI + delivery). Every rule (which phase, what plays once, who may celebrate) lives in lib/lib43.js and is
   unit-tested; sound synthesis lives in sfx.js. This file draws the final-minute warning, the final-ten-seconds digits, the full-screen completion overlay
   (rocket launch + explosion particles) and the Sound & effects settings.
   Hard rules:
   - Audio starts only after a real user gesture (CPSFX.unlock). Before that, sound is skipped and a visible hint says why. Visuals never depend on audio.
   - Nothing here may throw into the countdown: tick() and completed() catch everything.
   - Custom sound/vibration exist only while this page is open and on screen. Nothing is promised for a closed app or a locked phone. */
(function () {
  const P = CP43, K = CP42, E = CPSFX, run = P.newRun(), claimed = new Set(), cfg = () => S.cfg;
  const osReduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches, rm = () => P.reducedMotion(osReduced(), cfg().fxReduced);
  const canVibrate = typeof navigator.vibrate === 'function';
  const hero = () => $('#cdLive .hero');
  let pending = null, dirty = false, ovMuted = false, anim = null, shown = 0, lastPhase = 'idle', fb = null, tenPrev = [];

  /* ---------- delivery helpers: never throw ---------- */
  function sync() { try { E.configure({ volume: cfg().fxVolume, muted: !S.sound }); } catch (e) { /* ignore */ } }
  function sound(recipe, opt) { try { sync(); return E.play(recipe, opt); } catch (e) { return false; } }
  function buzz(pattern) { if (!canVibrate || !cfg().fxVibrate) return; try { navigator.vibrate(pattern); } catch (e) { /* blocked until a tap, or unsupported */ } }
  const sr = t => { const el = $('#cineSr'); if (el) { el.textContent = ''; setTimeout(() => { el.textContent = t; }, 30); } };
  function applyRm() { document.documentElement.classList.toggle('cp-rm', rm()); }
  X.sfxSync = () => { sync(); if (!S.sound) { try { E.stopAll(); } catch (e) { /* ignore */ } } };

  /* ---------- autoplay policy: unlock on the first real gesture ---------- */
  function onGesture() {
    const st = E.state(); if (st === 'ready' || st === 'unsupported' || !S.sound) return;
    E.unlock().then(() => { sync(); renderState(); }).catch(() => {});
  }
  ['pointerup', 'touchend', 'mousedown', 'keydown', 'click'].forEach(ev => addEventListener(ev, onGesture, { capture: true, passive: true }));
  /* Back in the foreground (tab switch, phone unlocked, bfcache restore): if the engine was suspended while away, try to resume it without waiting for a tap. */
  function tryResume() { if (document.hidden || !S.sound) return; const st = E.state(); if (st !== 'locked' && st !== 'error') { renderState(); return; } E.resume().then(() => { sync(); renderState(); }, () => {}); }
  X.sfxResume = tryResume;
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tryResume(); });
  addEventListener('pageshow', tryResume);

  const STATE_TXT = {
    idle: 'Sound engine: waiting for your first tap on the page (browsers block sound until then).',
    locked: 'Sound engine: paused by the browser. Tap anywhere on the page to resume it.',
    ready: 'Sound engine: ready.',
    unsupported: 'This browser has no Web Audio, so only a simple chime is available for the celebration.',
    error: 'Sound engine: the browser reported an error. The countdown is not affected. Try a Preview after tapping the page.'
  };
  function renderState() {
    const el = $('#fxState'); if (el) setT(el, S.sound ? STATE_TXT[E.state()] || '' : 'Sound is off. Turn on the master switch above to hear anything.');
  }
  E.onState(renderState);

  /* ---------- final minute + final ten seconds (called every animation frame while the Countdown screen is visible) ---------- */
  function idle() {
    if (!dirty) return; dirty = false;
    const h = hero(); if (h) h.classList.remove('fx-minute');
    const m = $('#cineMinute'); if (m) m.hidden = true;
    const t = $('#cineTen'); if (t) t.hidden = true;
    const hint = $('#cineHint'); if (hint) hint.hidden = true;
    shown = 0; lastPhase = 'idle';
  }
  function tick(ev, now) {
    try {
      now = +now; dirty = true; const p = P.plan(run, ev, now), inFinal = p.phase === 'minute' || p.phase === 'ten';
      if (!inFinal) { if (lastPhase !== 'idle' || shown) idle(); applyHint(ev, now); return; }
      const h = hero(); if (h && !h.classList.contains('fx-minute')) h.classList.add('fx-minute');
      const m = $('#cineMinute'); if (m && m.hidden) m.hidden = false;
      const t = $('#cineTen');
      if (p.phase === 'ten' && p.digit) {
        if (t.hidden) t.hidden = false;
        if (shown !== p.digit) { shown = p.digit; setT($('#cineTenN'), String(p.digit)); t.classList.remove('pop'); void t.offsetWidth; t.classList.add('pop'); }
      } else if (!t.hidden) { t.hidden = true; shown = 0; }
      if (p.phase !== lastPhase) { lastPhase = p.phase; sr(p.phase === 'minute' ? `${ev.title}: one minute left.` : `${ev.title}: ten seconds left.`); }
      if (p.warn && cfg().fxWarn) { sound(P.WARN); buzz(P.VIBRATION.warn); }
      if (p.beep) { const r = P.tenRecipe(cfg().fxTen, p.beep); if (r) sound(r); if (p.beep <= 3) buzz(P.VIBRATION.tick); }
      applyHint(ev, now);
    } catch (e) { /* the countdown must never be broken by an effect */ }
  }
  /* honest hint while the last two minutes run and sound cannot play yet */
  function applyHint(ev, now) {
    const hint = $('#cineHint'); if (!hint) return;
    const left = K.remainingMs(ev.at, now), st = E.state(), need = S.sound && left !== null && left > 0 && left <= 120e3 && st !== 'ready' && st !== 'unsupported';
    if (!need) { if (!hint.hidden) hint.hidden = true; return; }
    setT(hint, st === 'error' ? 'Sound could not start on this device. The countdown is not affected.' : 'Tap anywhere on the page once to allow sound for the final countdown.');
    if (hint.hidden) hint.hidden = false;
  }

  /* ---------- completion overlay ---------- */
  const COLORS = ['#f97316', '#ef4444', '#fbbf24', '#ffffff', '#fb923c'], rnd = (a, b) => a + Math.random() * (b - a);
  function drawRocket(c, x, y, s, flame) {
    /* s = body unit: the rocket is 1.7 s tall (nose -0.85 s .. tail +0.5 s, fins to .62 s). Drawn with a metallic body, window ring, striped nose and two fins + centre fin. */
    c.save(); c.translate(x, y);
    const fl = s * (0.9 + flame * 0.7), g = c.createLinearGradient(0, s * .5, 0, s * .5 + fl * 1.6); g.addColorStop(0, '#ffffff'); g.addColorStop(.25, '#fde047'); g.addColorStop(.6, '#f97316'); g.addColorStop(1, 'rgba(239,68,68,0)');
    c.fillStyle = g; c.beginPath(); c.moveTo(-s * .2, s * .5); c.quadraticCurveTo(-s * .08, s * .5 + fl, 0, s * .5 + fl * 1.6); c.quadraticCurveTo(s * .08, s * .5 + fl, s * .2, s * .5); c.closePath(); c.fill();
    c.fillStyle = '#b91c1c'; c.beginPath(); c.moveTo(-s * .26, s * .1); c.lineTo(-s * .62, s * .66); c.lineTo(-s * .24, s * .46); c.closePath(); c.fill(); c.beginPath(); c.moveTo(s * .26, s * .1); c.lineTo(s * .62, s * .66); c.lineTo(s * .24, s * .46); c.closePath(); c.fill();
    c.fillStyle = '#7f1d1d'; c.beginPath(); c.moveTo(-s * .06, s * .2); c.lineTo(0, s * .74); c.lineTo(s * .06, s * .2); c.closePath(); c.fill();
    const body = c.createLinearGradient(-s * .4, 0, s * .4, 0); body.addColorStop(0, '#9aa7ba'); body.addColorStop(.35, '#ffffff'); body.addColorStop(.7, '#dbe4f0'); body.addColorStop(1, '#8794aa');
    c.fillStyle = body; c.beginPath(); c.moveTo(0, -s * .85); c.quadraticCurveTo(s * .46, -s * .25, s * .27, s * .5); c.lineTo(-s * .27, s * .5); c.quadraticCurveTo(-s * .46, -s * .25, 0, -s * .85); c.fill();
    c.fillStyle = '#ef4444'; c.beginPath(); c.moveTo(0, -s * .85); c.quadraticCurveTo(s * .2, -s * .62, s * .26, -s * .4); c.lineTo(-s * .26, -s * .4); c.quadraticCurveTo(-s * .2, -s * .62, 0, -s * .85); c.fill();
    c.fillStyle = '#1e293b'; c.fillRect(-s * .27, s * .3, s * .54, s * .08); c.fillStyle = '#f97316'; c.fillRect(-s * .27, s * .38, s * .54, s * .05);
    c.fillStyle = '#cbd5e1'; c.beginPath(); c.arc(0, -s * .1, s * .185, 0, 6.2832); c.fill(); c.fillStyle = '#0b1220'; c.beginPath(); c.arc(0, -s * .1, s * .145, 0, 6.2832); c.fill();
    c.fillStyle = 'rgba(125,211,252,.55)'; c.beginPath(); c.arc(-s * .04, -s * .14, s * .05, 0, 6.2832); c.fill();
    c.fillStyle = '#475569'; c.fillRect(-s * .22, s * .5, s * .44, s * .09);
    c.restore();
  }
  /* Sequence (all canvas, one rAF loop, hard particle caps from CP47.CAPS so a phone stays smooth):
     1 ground blast: a heavy smoke plume billows out at the pad while the thruster lights  2 launch: the BIG rocket (~45% of the screen height) climbs with fire + a dense smoke trail
     3 peak: blast flash + shockwave + debris sparks  4 confetti: a full-screen colourful burst that rains down. The loop stops itself when everything has faded. */
  const CONF = ['#f97316', '#ef4444', '#fbbf24', '#22c55e', '#38bdf8', '#a78bfa', '#f472b6', '#ffffff'];
  function animate(cv) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2), ctx = cv.getContext('2d'), LAUNCH = P.LAUNCH_S * 1000, CAP = CP47.CAPS; let W = 0, H = 0, raf = 0, stopped = false, last = 0, exploded = false, flash = 0, shock = null, L;
    const fit = () => { W = cv.clientWidth; H = cv.clientHeight; cv.width = Math.max(1, Math.round(W * dpr)); cv.height = Math.max(1, Math.round(H * dpr)); L = CP47.rocketLayout(W, H); };
    fit(); const sparks = [], smoke = [], fire = [], conf = [], t0 = performance.now(); let wave2 = false, wave3 = false, shake = 0;
    const burst = (x, y, n, pow) => { for (let i = 0; i < n && sparks.length < CAP.spark; i++) { const a = rnd(0, 6.2832), v = pow * rnd(.25, 1); sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: rnd(50, 105), c: COLORS[i % COLORS.length], s: rnd(1.5, 3.8) }); } };
    const confetti = (x, y, n, pow, fromTop) => { for (let i = 0; i < n && conf.length < CAP.confetti; i++) { const a = fromTop ? Math.PI / 2 + rnd(-.9, .9) : rnd(0, 6.2832), v = pow * rnd(.35, 1); conf.push({ x: fromTop ? rnd(0, W) : x, y: fromTop ? rnd(-40, -5) : y, vx: Math.cos(a) * v, vy: fromTop ? rnd(1, 3) : Math.sin(a) * v, rot: rnd(0, 6.2832), vr: rnd(-.3, .3), w: rnd(6, 12), h: rnd(3, 7), life: 0, max: rnd(150, 260), c: CONF[(Math.random() * CONF.length) | 0], wob: rnd(0, 6.2832) }); } };
    function frame(now) {
      if (stopped) return; const t = now - t0, k = Math.min(2.5, (now - (last || now)) / 16.67 || 1); last = now;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); const s = L.s;
      if (shake > .3) { ctx.translate(rnd(-shake, shake), rnd(-shake, shake)); shake *= Math.pow(.9, k); }
      let rx = L.x0, ry = 0;
      if (t < LAUNCH) {
        const u = t / LAUNCH, e = u * u * (1.15 - .15 * u), yStart = H + s * .2, y = yStart + (L.yEnd - yStart) * e; rx = L.x0 + Math.sin(u * 11) * 5 * u; ry = y;
        if (t < 500) shake = 2 + t / 120; /* pad rumble while the engine ignites */
        const groundY = Math.min(H - 4, y + s * 1.1 + (u < .35 ? 0 : 0));
        for (let i = 0; i < 4 && fire.length < CAP.fire; i++) fire.push({ x: rx + rnd(-s * .12, s * .12), y: y + s * .52, vx: rnd(-.7, .7), vy: rnd(2.5, 5.5) * (.6 + u), life: 0, max: rnd(14, 26), r: rnd(s * .05, s * .11) });
        for (let i = 0; i < 3 && smoke.length < CAP.smoke; i++) smoke.push({ x: rx + rnd(-s * .15, s * .15), y: y + s * .7, vx: rnd(-.9, .9), vy: rnd(.5, 1.8), life: 0, max: rnd(55, 95), r: rnd(s * .1, s * .2), g: rnd(.12, .2) });
        if (u < .45) for (let i = 0; i < 4 && smoke.length < CAP.smoke; i++) { const side = Math.random() < .5 ? -1 : 1; smoke.push({ x: L.x0 + side * rnd(0, s * .4), y: H - rnd(0, 14), vx: side * rnd(1.2, 4.2) * (1 - u), vy: rnd(-.9, .1), life: 0, max: rnd(70, 130), r: rnd(s * .2, s * .42), g: rnd(.13, .22) }); } /* ground plume billowing sideways at lift-off */
        void groundY;
      } else if (!exploded) { exploded = true; ry = L.yEnd; burst(L.x0, L.yEnd, 220, 10.5); confetti(L.x0, L.yEnd, 140, 11, false); shock = { r: 0 }; flash = 1; shake = 14; }
      if (exploded) { if (!wave2 && t >= LAUNCH + 450) { wave2 = true; confetti(0, 0, 120, 0, true); } if (!wave3 && t >= LAUNCH + 1100) { wave3 = true; confetti(W * .2, H * .45, 60, 8, false); confetti(W * .8, H * .45, 60, 8, false); } }
      for (let i = smoke.length - 1; i >= 0; i--) { const p = smoke[i]; p.life += k; p.x += p.vx * k; p.y += p.vy * k; p.vx *= Math.pow(.985, k); if (p.life > p.max) { smoke.splice(i, 1); continue; } const f = p.life / p.max; ctx.globalAlpha = p.g * (1 - f) * Math.min(1, p.life / 6); ctx.fillStyle = f < .25 ? '#e2e8f0' : '#94a3b8'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 + f * 2.2), 0, 6.2832); ctx.fill(); }
      ctx.globalCompositeOperation = 'lighter';
      for (let i = fire.length - 1; i >= 0; i--) { const p = fire[i]; p.life += k; p.x += p.vx * k; p.y += p.vy * k; if (p.life > p.max) { fire.splice(i, 1); continue; } const f = p.life / p.max; ctx.globalAlpha = (1 - f) * .55; ctx.fillStyle = f < .3 ? '#fde68a' : f < .65 ? '#fb923c' : '#ef4444'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 - f * .7), 0, 6.2832); ctx.fill(); }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1; if (t < LAUNCH) drawRocket(ctx, rx, ry, s, Math.random());
      ctx.globalCompositeOperation = 'lighter';
      for (let i = sparks.length - 1; i >= 0; i--) { const p = sparks[i]; p.life += k; p.vy += .1 * k; p.vx *= Math.pow(.985, k); p.vy *= Math.pow(.99, k); p.x += p.vx * k; p.y += p.vy * k; if (p.life > p.max) { sparks.splice(i, 1); continue; } ctx.globalAlpha = Math.max(0, 1 - p.life / p.max); ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, 6.2832); ctx.fill(); }
      ctx.globalCompositeOperation = 'source-over';
      if (shock) { shock.r += 20 * k; const a = 1 - shock.r / (Math.max(W, H) * .8); if (a <= 0) shock = null; else { ctx.globalAlpha = a; ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 6 * a + 1; ctx.beginPath(); ctx.arc(L.x0, L.yEnd, shock.r, 0, 6.2832); ctx.stroke(); ctx.globalAlpha = a * .5; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(L.x0, L.yEnd, shock.r * .82, 0, 6.2832); ctx.stroke(); } }
      for (let i = conf.length - 1; i >= 0; i--) { const p = conf[i]; p.life += k; p.vy += .07 * k; p.vx *= Math.pow(.985, k); p.vy *= Math.pow(.985, k); p.wob += .12 * k; p.x += (p.vx + Math.sin(p.wob) * .8) * k; p.y += p.vy * k; p.rot += p.vr * k; if (p.life > p.max || p.y > H + 20) { conf.splice(i, 1); continue; } ctx.globalAlpha = Math.min(1, (1 - p.life / p.max) * 1.6); ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, Math.cos(p.wob)); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore(); }
      if (flash > .02) { ctx.globalAlpha = flash * .7; ctx.fillStyle = '#fff'; ctx.fillRect(-20, -20, W + 40, H + 40); flash *= Math.pow(.9, k); }
      ctx.globalAlpha = 1;
      if (t > LAUNCH + 1200 && wave3 && !sparks.length && !smoke.length && !fire.length && !conf.length && !shock) { stopped = true; ctx.clearRect(0, 0, W, H); return; }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return { fit, stop() { stopped = true; cancelAnimationFrame(raf); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); } };
  }
  addEventListener('resize', () => { if (anim) anim.fit(); });

  const note = t => setT($('#cineNote'), t || '');
  function refreshOv() {
    const m = $('#cineMute'), r = $('#cineRm'), off = !S.sound, os = osReduced();
    m.disabled = off; m.setAttribute('aria-pressed', String(!off && ovMuted)); setT(m, off ? 'Sound off' : ovMuted ? 'Unmute' : 'Mute');
    r.disabled = os; r.setAttribute('aria-pressed', String(rm())); setT(r, os ? 'Reduced motion (device)' : rm() ? 'Motion: reduced' : 'Reduce motion');
    $('.cine-wrap').classList.toggle('rm', rm());
  }
  function stopShow() {
    if (anim) { anim.stop(); anim = null; }
    try { E.stopAll(); } catch (e) { /* ignore */ }
    if (fb) { try { fb.pause(); } catch (e) { /* ignore */ } }
  }
  /* (re)starts picture + sound + vibration. Called on open and from Replay. */
  function start() {
    stopShow(); note(''); refreshOv(); const motion = !rm(), msg = $('.cine-msg');
    msg.style.animation = 'none'; void msg.offsetWidth; msg.style.animation = '';
    if (motion) anim = animate($('#cineCv'));
    if (S.sound && !ovMuted) {
      const ok = sound(P.celebrationRecipe(cfg().fxSound), { skip: motion ? 0 : P.LAUNCH_S }); /* no rocket flight in calm mode, so the sound starts at the impact */
      if (!ok) {
        if (E.state() === 'unsupported') { try { fb = fb || new Audio('assets/chime.wav'); fb.volume = P.mediaVolume(cfg().fxVolume); fb.currentTime = 0; const pr = fb.play(); if (pr) pr.catch(() => note('Your browser blocked the sound. Tap Replay to try again.')); } catch (e) { note('Sound is not available here.'); } }
        else note(E.state() === 'error' ? 'Sound could not start on this device. The celebration still works without it.' : 'Your browser is waiting for a tap before it plays sound. Tap Replay to hear it.');
      }
    }
    buzz(P.VIBRATION.done);
  }
  function open(title, sub) {
    const d = $('#cineDlg'); ovMuted = false; setT($('#cineTitle'), title); setT($('#cineSub'), sub);
    if (!d.open) { try { d.showModal(); } catch (e) { return; } }
    audioSync(); start(); $('#cineClose').focus();
  }
  function present(ev) {
    if (!P.claimOnce(STORE, claimed, `${ev.id}|${ev.at}`)) return; /* exactly once per event target, even with two tabs open */
    open(ev.title, `Reached ${fmt(ev.at)}`);
  }
  /* called by script.js when the event on screen completed in the live window */
  X.cine = {
    tick, idle,
    completed(id) {
      try {
        const ev = S.events.find(e => e.id === id); if (!ev) return;
        const act = P.planCompletion({ active: true, live: true, hidden: document.hidden });
        if (act === 'defer') pending = { id: ev.id, at: ev.at }; else if (act === 'show') present(ev);
      } catch (e) { /* never break the countdown */ }
    }
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !pending) return;
    const p = pending; pending = null; const ev = S.events.find(e => e.id === p.id && e.at === p.at); if (!ev) return;
    try { if (P.deferStillValid(p.at, Date.now())) present(ev); else toast(`“${ev.title}” reached its target.`); } catch (e) { /* ignore */ }
  });
  $('#cineDlg').addEventListener('close', () => { stopShow(); audioSync(); });
  $('#cineClose').addEventListener('click', () => $('#cineDlg').close());
  $('#cineReplay').addEventListener('click', () => { const go = () => { if ($('#cineDlg').open) start(); }; if (S.sound) E.unlock().then(go, go); else go(); }); /* a tap = a gesture: audio may start */
  $('#cineMute').addEventListener('click', () => { ovMuted = !ovMuted; if (ovMuted) { try { E.stopAll(); } catch (e) { /* ignore */ } if (fb) { try { fb.pause(); } catch (e) { /* ignore */ } } } refreshOv(); }); /* silences this celebration only; the picture keeps playing */
  $('#cineRm').addEventListener('click', () => { cfg().fxReduced = !cfg().fxReduced; save(); applyRm(); renderFx(); if ($('#cineDlg').open) start(); });

  /* ---------- Sound & effects settings ---------- */
  const tog = (id, on) => { const b = $(id); if (b) b.setAttribute('aria-checked', String(!!on)); };
  function renderFx() {
    if (!$('#fxCard')) return; const c = cfg();
    $('#fxVol').value = c.fxVolume; setT($('#fxVolVal'), c.fxVolume + '%'); $('#fxVol').setAttribute('aria-valuetext', c.fxVolume + ' percent');
    $('#fxSound').value = c.fxSound; $('#fxTen').value = c.fxTen; tog('#fxWarn', c.fxWarn);
    const v = $('#fxVib'); v.disabled = !canVibrate; tog('#fxVib', canVibrate && c.fxVibrate);
    setT($('#fxVibNote'), canVibrate ? 'Short buzzes for the warning, the last 3 seconds and the finish' : 'Not available in this browser or on this device');
    const r = $('#fxRed'), os = osReduced(); r.disabled = os; tog('#fxRed', rm());
    setT($('#fxRedNote'), os ? 'Your device already asks for reduced motion, so this stays on' : 'Replaces the rocket and particles with a calm still screen');
    renderState();
  }
  X.onSettings = renderFx;
  const prevX = X.onState; X.onState = () => { if (prevX) prevX(); renderFx(); applyRm(); sync(); };
  async function ready() { /* previews are user gestures: unlock first, then explain honestly if sound still cannot play */
    if (!S.sound) { toast('Turn the Sound switch on first.'); return false; }
    await E.unlock(); sync(); renderState();
    if (E.state() !== 'ready') { toast(E.state() === 'unsupported' ? 'This browser has no Web Audio.' : 'The browser did not allow sound yet. Tap again.'); return false; }
    return true;
  }
  $('#fxVol').addEventListener('input', e => { cfg().fxVolume = P.normVol(e.target.value); setT($('#fxVolVal'), cfg().fxVolume + '%'); e.target.setAttribute('aria-valuetext', cfg().fxVolume + ' percent'); sync(); audioSync(); });
  $('#fxVol').addEventListener('change', () => save());
  $('#fxSound').addEventListener('change', e => { cfg().fxSound = e.target.value; save(); });
  $('#fxTen').addEventListener('change', e => { cfg().fxTen = e.target.value; save(); });
  $('#fxWarn').addEventListener('click', () => { cfg().fxWarn = !cfg().fxWarn; save(); renderFx(); });
  $('#fxVib').addEventListener('click', () => { if (!canVibrate) return; cfg().fxVibrate = !cfg().fxVibrate; save(); renderFx(); buzz([60]); });
  $('#fxRed').addEventListener('click', () => { cfg().fxReduced = !cfg().fxReduced; save(); applyRm(); renderFx(); });
  $('#fxPrev').addEventListener('click', async () => { if (await ready()) sound(P.celebrationRecipe(cfg().fxSound)); });
  $('#fxWarnPrev').addEventListener('click', async () => { if (await ready()) { sound(P.WARN); buzz(P.VIBRATION.warn); } });
  $('#fxTenPrev').addEventListener('click', async () => {
    if (cfg().fxTen === 'off') return toast('Final 10 seconds is set to silent.');
    if (!await ready()) return; tenPrev.forEach(clearTimeout); tenPrev = [];
    [3, 2, 1].forEach((n, i) => tenPrev.push(setTimeout(() => { const r = P.tenRecipe(cfg().fxTen, n); if (r) sound(r); }, i * 1000)));
  });
  $('#fxDemo').addEventListener('click', async () => { if (S.sound) await E.unlock(); sync(); open('Preview', 'This is how a finished countdown looks. Nothing was changed.'); });
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => { applyRm(); renderFx(); if ($('#cineDlg').open) start(); });
  applyRm(); sync(); renderFx();
})();
