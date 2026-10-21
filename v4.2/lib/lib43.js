'use strict';
/* ChronoPulse 4.2 (Phase 3) — pure cinematic-countdown logic (no DOM, no audio). Loaded as a classic script (window.CP43) and via require() in Node tests.
   What it decides (all unit-tested; cinema.js / sfx.js only DELIVER the result):
   - Which cinematic phase an event is in: idle | minute (<= 60 s) | ten (<= 10 s) | done. Always derived from the clock and the target (lib42.js), never
     from a previous value, so throttled frames, suspended tabs and reloads cannot drift.
   - Once-only guards. The final-minute warning plays at most once per event target; each of the digits 10..1 beeps at most once; a frame that was skipped
     (throttled tab) produces ONE beep for the digit now showing, never a burst. A device clock moved backwards cannot repeat them.
   - Completion celebration: claimOnce() makes it fire exactly once per event target even with two tabs open (persisted list of "id|at" tokens + in-memory set).
     The persisted "completed" flag in the event itself (lib42.js, schema 7) remains the primary guard; this is the second, cross-tab one.
   - Sound recipes (pure data: oscillator / noise voices) so a unit test can check every recipe is sane, and sfx.js can play them with Web Audio.
   Honesty rule: nothing here can run while the app is closed or the phone is locked. Custom sounds exist only while the page is open and on screen. */
(function (root) {
  const C = typeof module !== 'undefined' && module.exports ? require('./lib.js') : root.CP;
  const K = typeof module !== 'undefined' && module.exports ? require('./lib42.js') : root.CP42;
  const CINE_KEY = 'chronopulse:v4.1:cine'; /* under the chronopulse: prefix, so "Reset all data" clears it */
  const DEFER_WINDOW_MS = 5 * 60e3; /* a celebration queued while the page was hidden is still shown if the user returns within this time */
  const LAUNCH_S = 1.4; /* seconds from start of the celebration to the "explosion" (visual + sound are built around this moment) */
  const MAX_TOKENS = 30;

  /* ---------- phases ---------- */
  const PHASE = { upcoming: 'idle', 'final-minute': 'minute', 'final-10': 'ten', done: 'done', invalid: 'invalid' };
  const cinemaPhase = (at, now) => PHASE[K.phase(at, now)] || 'invalid';
  /* the digit shown in the final ten seconds: 10 while 10 s >= left > 9 s ... 1 while 1 s >= left > 0; 0 outside that range */
  const digitOf = left => (Number.isFinite(left) && left > 0 && left <= 10e3 ? Math.ceil(left / 1000) : 0);
  const newRun = () => ({ warned: {}, beeped: {} });
  const prune = o => { const k = Object.keys(o); if (k.length > 20) for (const x of k.slice(0, k.length - 20)) delete o[x]; };

  /* One decision per animation frame. Mutates `run` (the once-only memory). Returns { phase, digit, warn, beep, key }:
     warn = play the final-minute warning NOW (true at most once per target, and only when the event is first seen in the final minute, not inside the last 10 s),
     beep = the digit (10..1) to beep NOW, or 0. Completed / missing / invalid events produce nothing. */
  function plan(run, ev, now) {
    now = now instanceof Date ? now.getTime() : now; /* the app's frame loop hands over a Date; everything below works in epoch ms */
    const out = { phase: 'idle', digit: 0, warn: false, beep: 0, key: '' };
    if (!run || !ev || typeof ev.at !== 'string' || K.isCompleted(ev) || !Number.isFinite(now)) return out;
    const phase = cinemaPhase(ev.at, now); if (phase === 'invalid') return out; /* a malformed target never triggers effects */
    out.phase = phase; out.key = `${ev.id}|${ev.at}`;
    if (phase !== 'minute' && phase !== 'ten') return out;
    if (!(out.key in run.warned)) { run.warned[out.key] = true; out.warn = phase === 'minute'; prune(run.warned); }
    if (phase === 'ten') {
      const d = digitOf(K.remainingMs(ev.at, now)), seen = run.beeped[out.key] || (run.beeped[out.key] = {}); out.digit = d; prune(run.beeped);
      if (d && !seen[d]) { seen[d] = true; out.beep = d; }
    }
    return out;
  }

  /* What to do when the event on screen completes. 'show' = celebrate now; 'defer' = the page is hidden, celebrate if the user returns in time; 'none' = not this event. */
  const planCompletion = c => (!c || !c.active || !c.live ? 'none' : c.hidden ? 'defer' : 'show');
  const deferStillValid = (targetAt, now) => { const t = K.targetMs(targetAt); return t !== null && Number.isFinite(now) && now - t <= DEFER_WINDOW_MS; };

  /* Exactly-once claim for one completion token ("id|at"). `store` = Storage-like, `mem` = Set (used alone when storage is blocked). Returns true only the first time. */
  function claimOnce(store, mem, token) {
    if (typeof token !== 'string' || !token || !mem || typeof mem.has !== 'function') return false;
    if (mem.has(token)) return false;
    mem.add(token);
    let list = [];
    try { const raw = store && store.getItem(CINE_KEY); const p = raw ? JSON.parse(raw) : []; list = Array.isArray(p) ? p.filter(x => typeof x === 'string') : []; } catch (e) { return true; /* storage unreadable: the in-memory guard is all we have */ }
    if (list.includes(token)) return false;
    list.push(token);
    try { store.setItem(CINE_KEY, JSON.stringify(list.slice(-MAX_TOKENS))); } catch (e) { /* storage full or blocked: in-memory guard still holds for this page */ }
    return true;
  }

  /* ---------- volume ---------- */
  const normVol = v => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 100; };
  const webGain = v => 0.6 * Math.pow(normVol(v) / 100, 2); /* squared curve (loudness is not linear); headroom because voices overlap; sfx.js also adds a limiter */
  const mediaVolume = v => normVol(v) / 100; /* HTMLAudioElement.volume (iOS Safari ignores it: the phone's volume buttons rule there) */
  const reducedMotion = (os, user) => !!os || !!user;

  /* ---------- sound recipes ----------
     voice: { k:'osc'|'noise', w:wave, t:start s, d:duration s, f0, f1 (exponential sweep), g:peak gain, a:attack s, filt:'lowpass'|'highpass'|'bandpass', ff0, ff1, q } */
  const riser = [
    { k: 'noise', t: 0, d: LAUNCH_S, filt: 'bandpass', ff0: 300, ff1: 5000, q: 1.5, g: 0.35, a: 1.3 },
    { k: 'osc', w: 'sawtooth', t: 0, d: LAUNCH_S, f0: 80, f1: 600, g: 0.1, a: 1.3, filt: 'lowpass', ff0: 400, ff1: 1600, q: 0.7 }
  ];
  const boom = (g = 0.9) => [
    { k: 'osc', w: 'sine', t: LAUNCH_S, d: 1.8, f0: 120, f1: 28, g, a: 0.01 },
    { k: 'noise', t: LAUNCH_S, d: 1.3, filt: 'lowpass', ff0: 3000, ff1: 150, q: 0.7, g: g * 0.9, a: 0.005 },
    { k: 'noise', t: LAUNCH_S, d: 0.18, filt: 'highpass', ff0: 2000, ff1: 2000, q: 0.7, g: 0.5, a: 0.002 }
  ];
  const sparkle = t => ({ k: 'osc', w: 'sine', t, d: 0.6, f0: 1800, f1: 900, g: 0.08, a: 0.005 });
  const RECIPES = {
    impact: { id: 'impact', label: 'Cinematic impact', dur: 3.4, voices: [...riser, ...boom(0.9), sparkle(1.9), sparkle(2.3)] },
    fanfare: { id: 'fanfare', label: 'Bright fanfare', dur: 3.2, voices: [...riser, ...boom(0.55), ...[523.25, 659.25, 783.99, 1046.5].map((f, i) => ({ k: 'osc', w: 'triangle', t: 1.5 + i * 0.18, d: 0.9, f0: f, f1: f, g: 0.22, a: 0.01 }))] },
    pulse: { id: 'pulse', label: 'Soft pulse', dur: 3.0, voices: [{ k: 'osc', w: 'sine', t: 0, d: LAUNCH_S, f0: 220, f1: 440, g: 0.15, a: 1.3 },
      ...[261.63, 329.63, 392].map(f => ({ k: 'osc', w: 'sine', t: LAUNCH_S, d: 1.8, f0: f, f1: f, g: 0.2, a: 0.03 })), { k: 'osc', w: 'sine', t: LAUNCH_S, d: 1.2, f0: 80, f1: 50, g: 0.35, a: 0.02 }] }
  };
  const WARN = { id: 'warn', label: 'Final-minute warning', dur: 0.5, voices: [{ k: 'osc', w: 'sine', t: 0, d: 0.2, f0: 660, f1: 660, g: 0.35, a: 0.01 }, { k: 'osc', w: 'sine', t: 0.22, d: 0.26, f0: 880, f1: 880, g: 0.35, a: 0.01 }] };
  /* the sound for one digit of the final ten seconds; style: 'tick' | 'beep' | 'synth' ('off' and unknown styles give null) */
  function tenRecipe(style, n) {
    const last = n === 1;
    if (style === 'tick') return { id: 'ten-tick', label: 'Tick', dur: 0.1, voices: [{ k: 'noise', t: 0, d: 0.04, filt: 'highpass', ff0: 3000, ff1: 3000, q: 0.7, g: last ? 0.7 : 0.5, a: 0.001 }, { k: 'osc', w: 'sine', t: 0, d: 0.05, f0: last ? 1500 : 1200, f1: last ? 1500 : 1200, g: 0.2, a: 0.001 }] };
    if (style === 'beep') return { id: 'ten-beep', label: 'Beep', dur: 0.3, voices: [{ k: 'osc', w: 'sine', t: 0, d: last ? 0.28 : 0.13, f0: last ? 1175 : 880, f1: last ? 1175 : 880, g: 0.35, a: 0.005 }] };
    if (style === 'synth') { const f = 330 * Math.pow(2, (10 - Math.min(10, Math.max(1, n))) / 6); return { id: 'ten-synth', label: 'Rising synth', dur: 0.3, voices: [{ k: 'osc', w: 'triangle', t: 0, d: last ? 0.28 : 0.14, f0: f, f1: f, g: 0.33, a: 0.005 }] }; }
    return null;
  }
  /* drops the first `skip` seconds of a recipe (used when motion is reduced: no rocket flight, so the sound starts at the impact) */
  function trim(r, skip) {
    if (!r || !(skip > 0)) return r;
    const voices = []; for (const v of r.voices) { if (v.t + v.d <= skip + 0.05) continue; /* also drops a leftover sliver of a pre-impact voice (it would be heard as a click) */ const cut = Math.max(0, skip - v.t); voices.push({ ...v, t: Math.max(0, v.t - skip), d: v.d - cut, a: Math.min(v.a, v.d - cut) }); }
    return { ...r, dur: Math.max(0, r.dur - skip), voices };
  }
  const fin = (x, lo, hi) => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;
  function validRecipe(r) {
    if (!r || !Array.isArray(r.voices) || !r.voices.length || !fin(r.dur, 0.01, 6)) return false;
    return r.voices.every(v => v && (v.k === 'osc' || v.k === 'noise') && fin(v.t, 0, 6) && fin(v.d, 0.005, 6) && v.t + v.d <= r.dur + 0.5 && fin(v.g, 0.001, 1) && fin(v.a, 0.0005, v.d)
      && (v.k === 'noise' || (['sine', 'square', 'sawtooth', 'triangle'].includes(v.w) && fin(v.f0, 20, 20000) && fin(v.f1, 20, 20000)))
      && (!v.filt || (['lowpass', 'highpass', 'bandpass'].includes(v.filt) && fin(v.ff0, 20, 20000) && fin(v.ff1, 20, 20000) && fin(v.q, 0.1, 20))));
  }
  const celebrationRecipe = id => RECIPES[id] || RECIPES.impact;
  const VIBRATION = { warn: [120], tick: [20], done: [200, 80, 200, 80, 400] }; /* ms patterns; the Vibration API takes numbers only */

  const api = { CINE_KEY, DEFER_WINDOW_MS, LAUNCH_S, MAX_TOKENS, cinemaPhase, digitOf, newRun, plan, planCompletion, deferStillValid, claimOnce, normVol, webGain, mediaVolume, reducedMotion,
    RECIPES, WARN, tenRecipe, trim, validRecipe, celebrationRecipe, VIBRATION };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CP43 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
