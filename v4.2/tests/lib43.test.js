'use strict';
/* Phase 3: pure cinematic logic (lib/lib43.js) + the fx settings added to cfg (lib/lib41.js). No DOM, no audio. */
const test = require('node:test'), assert = require('node:assert/strict');
const P = require('../lib/lib43.js'), K = require('../lib/lib42.js'), C = require('../lib/lib.js'), V = require('../lib/lib41.js');
const AT = '2030-06-15T12:00', T = K.targetMs(AT), ev = (o = {}) => ({ id: 'e1', title: 'Launch', at: AT, completed: '', ...o });

test('phases are derived from the clock: idle > 60 s, minute <= 60 s, ten <= 10 s, done at 0', () => {
  const ph = ms => P.cinemaPhase(AT, T - ms);
  assert.equal(ph(60001), 'idle'); assert.equal(ph(60000), 'minute'); assert.equal(ph(10001), 'minute'); assert.equal(ph(10000), 'ten'); assert.equal(ph(1), 'ten');
  assert.equal(ph(0), 'done'); assert.equal(ph(-5000), 'done'); assert.equal(P.cinemaPhase('garbage', T), 'invalid'); assert.equal(P.cinemaPhase(AT, NaN), 'invalid');
});
test('digitOf: 10 for the first second of the final ten, 1 for the last, 0 outside', () => {
  assert.equal(P.digitOf(10000), 10); assert.equal(P.digitOf(9001), 10); assert.equal(P.digitOf(9000), 9); assert.equal(P.digitOf(1001), 2); assert.equal(P.digitOf(1000), 1); assert.equal(P.digitOf(1), 1);
  assert.equal(P.digitOf(0), 0); assert.equal(P.digitOf(-1), 0); assert.equal(P.digitOf(10001), 0); assert.equal(P.digitOf(NaN), 0); assert.equal(P.digitOf(undefined), 0);
});
test('final-minute warning fires exactly once per target, not on every frame', () => {
  const run = P.newRun(), e = ev(); let n = 0;
  for (let ms = 70000; ms >= 11000; ms -= 16) if (P.plan(run, e, T - ms).warn) n++;
  assert.equal(n, 1);
});
test('a full 60 fps countdown from 70 s to 0 gives 1 warning and each digit 10..1 exactly once, in order', () => {
  const run = P.newRun(), e = ev(), beeps = []; let warns = 0;
  for (let ms = 70000; ms > 0; ms -= 16.67) { const p = P.plan(run, e, T - ms); if (p.warn) warns++; if (p.beep) beeps.push(p.beep); }
  assert.equal(warns, 1); assert.deepEqual(beeps, [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
});
test('a throttled tab that skips frames beeps once for the digit now showing — never a burst', () => {
  const run = P.newRun(), e = ev(); assert.equal(P.plan(run, e, T - 30000).warn, true);
  const p = P.plan(run, e, T - 3500); assert.equal(p.beep, 4); assert.equal(p.warn, false);
  assert.equal(P.plan(run, e, T - 3400).beep, 0, 'same digit again: silent');
  assert.equal(P.plan(run, e, T - 900).beep, 1, 'jump straight to 1: one beep, not 3,2,1');
});
test('opening the app inside the last 10 s beeps the current digit but does not play the final-minute warning', () => {
  const run = P.newRun(), p = P.plan(run, ev(), T - 7200); assert.equal(p.warn, false); assert.equal(p.beep, 8); assert.equal(p.phase, 'ten');
});
test('reload / tab return inside the final minute plays the warning once (page memory is fresh), then never again', () => {
  const a = P.newRun(); assert.equal(P.plan(a, ev(), T - 20000).warn, true); assert.equal(P.plan(a, ev(), T - 19000).warn, false);
});
test('a device clock moved backwards cannot repeat warnings or beeps', () => {
  const run = P.newRun(), e = ev(); P.plan(run, e, T - 30000); P.plan(run, e, T - 5500);
  assert.equal(P.plan(run, e, T - 40000).warn, false); assert.equal(P.plan(run, e, T - 5500).beep, 0); assert.equal(P.plan(run, e, T - 30000).warn, false);
});
test('a new target time (edited event) re-arms the warning; a different event has its own', () => {
  const run = P.newRun(); P.plan(run, ev(), T - 30000);
  const moved = ev({ at: '2030-06-15T12:30' }), tm = K.targetMs(moved.at); assert.equal(P.plan(run, moved, tm - 30000).warn, true);
  const other = ev({ id: 'e2' }); assert.equal(P.plan(run, other, T - 30000).warn, true);
});
test('completed, missing, invalid events and bad clocks produce no actions', () => {
  const run = P.newRun(), none = { phase: 'idle', digit: 0, warn: false, beep: 0, key: '' };
  assert.deepEqual(P.plan(run, ev({ completed: AT }), T - 5000), none); assert.deepEqual(P.plan(run, null, T), none); assert.deepEqual(P.plan(run, ev({ at: 'x' }), T), none);
  assert.deepEqual(P.plan(run, ev(), NaN), none); assert.deepEqual(P.plan(null, ev(), T - 5000), none);
});
test('plan memory is bounded (many events cannot grow it without limit)', () => {
  const run = P.newRun(); for (let i = 0; i < 100; i++) P.plan(run, ev({ id: 'x' + i }), T - 5000);
  assert.ok(Object.keys(run.warned).length <= 21 && Object.keys(run.beeped).length <= 21);
});
test('planCompletion: show now when visible, defer when hidden, none for other events / old completions', () => {
  assert.equal(P.planCompletion({ active: true, live: true, hidden: false }), 'show'); assert.equal(P.planCompletion({ active: true, live: true, hidden: true }), 'defer');
  assert.equal(P.planCompletion({ active: false, live: true, hidden: false }), 'none'); assert.equal(P.planCompletion({ active: true, live: false, hidden: false }), 'none'); assert.equal(P.planCompletion(null), 'none');
});
test('a deferred celebration is only shown when the user returns within 5 minutes', () => {
  assert.equal(P.deferStillValid(AT, T + 60e3), true); assert.equal(P.deferStillValid(AT, T + P.DEFER_WINDOW_MS), true); assert.equal(P.deferStillValid(AT, T + P.DEFER_WINDOW_MS + 1), false); assert.equal(P.deferStillValid('bad', T), false);
});

/* ----- single-play guard ----- */
const mkStore = (o = {}) => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { if (o.failWrite) throw new Error('quota'); m.set(k, String(v)); }, m }; };
test('claimOnce: the first claim wins, every repeat of the same target loses', () => {
  const st = mkStore(), mem = new Set(); assert.equal(P.claimOnce(st, mem, 'e1|' + AT), true); assert.equal(P.claimOnce(st, mem, 'e1|' + AT), false); assert.equal(P.claimOnce(st, mem, 'e1|2031-01-01T00:00'), true, 'new target time = new token');
});
test('claimOnce works across two tabs sharing one storage (each tab has its own memory set)', () => {
  const st = mkStore(); assert.equal(P.claimOnce(st, new Set(), 'e1|' + AT), true); assert.equal(P.claimOnce(st, new Set(), 'e1|' + AT), false);
});
test('claimOnce still guards this page when storage is blocked, full or corrupt', () => {
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }, mem = new Set();
  assert.equal(P.claimOnce(blocked, mem, 't1'), true); assert.equal(P.claimOnce(blocked, mem, 't1'), false);
  const full = mkStore({ failWrite: true }), m2 = new Set(); assert.equal(P.claimOnce(full, m2, 't1'), true); assert.equal(P.claimOnce(full, m2, 't1'), false);
  const bad = mkStore(); bad.m.set(P.CINE_KEY, '{not json'); assert.equal(P.claimOnce(bad, new Set(), 't1'), true); bad.m.set(P.CINE_KEY, '"str"'); assert.equal(P.claimOnce(bad, new Set(), 't2'), true);
  for (const t of ['', null, undefined, 5]) assert.equal(P.claimOnce(mkStore(), new Set(), t), false);
});
test('claimOnce keeps only the most recent tokens and uses the chronopulse: key prefix (so Reset clears it)', () => {
  const st = mkStore(), mem = new Set(); for (let i = 0; i < 50; i++) P.claimOnce(st, mem, 'id' + i + '|x');
  const list = JSON.parse(st.getItem(P.CINE_KEY)); assert.equal(list.length, P.MAX_TOKENS); assert.equal(list.at(-1), 'id49|x'); assert.ok(P.CINE_KEY.startsWith('chronopulse:'));
});

/* ----- volume ----- */
test('volume: clamped, monotonic, silent at 0, defaults to 100 on junk', () => {
  assert.equal(P.normVol(150), 100); assert.equal(P.normVol(-5), 0); assert.equal(P.normVol('40'), 40); assert.equal(P.normVol('abc'), 100); assert.equal(P.normVol(undefined), 100); assert.equal(P.normVol(NaN), 100);
  assert.equal(P.webGain(0), 0); assert.ok(P.webGain(100) <= 0.6 + 1e-9); let prev = -1; for (let v = 0; v <= 100; v += 5) { const g = P.webGain(v); assert.ok(g > prev || v === 0); prev = g; }
  assert.equal(P.mediaVolume(50), 0.5); assert.equal(P.mediaVolume(100), 1);
});
test('reducedMotion: the device preference always wins; the in-app switch adds to it', () => {
  assert.equal(P.reducedMotion(true, false), true); assert.equal(P.reducedMotion(false, true), true); assert.equal(P.reducedMotion(false, false), false); assert.equal(P.reducedMotion(true, true), true);
});

/* ----- recipes ----- */
test('every celebration sound is a valid recipe, has a label and lands its impact at LAUNCH_S', () => {
  assert.deepEqual(Object.keys(P.RECIPES).sort(), [...C.FX_SOUNDS].sort());
  for (const id of C.FX_SOUNDS) { const r = P.RECIPES[id]; assert.ok(P.validRecipe(r), id); assert.ok(r.label); assert.equal(P.celebrationRecipe(id), r); assert.ok(r.voices.some(v => v.t === P.LAUNCH_S), id + ' has an impact moment'); }
  assert.equal(P.celebrationRecipe('nope'), P.RECIPES.impact, 'unknown id falls back safely'); assert.ok(P.validRecipe(P.WARN));
});
test('ten-second sounds: tick/beep/synth valid for every digit; off and junk give silence; synth rises as the count falls', () => {
  for (const st of ['tick', 'beep', 'synth']) for (let n = 1; n <= 10; n++) assert.ok(P.validRecipe(P.tenRecipe(st, n)), st + n);
  assert.equal(P.tenRecipe('off', 5), null); assert.equal(P.tenRecipe('bogus', 5), null); assert.equal(P.tenRecipe(undefined, 5), null);
  assert.ok(P.tenRecipe('synth', 1).voices[0].f0 > P.tenRecipe('synth', 10).voices[0].f0); assert.deepEqual(C.FX_TEN.filter(s => s !== 'off').sort(), ['beep', 'synth', 'tick']);
});
test('validRecipe rejects malformed, out-of-range and non-finite recipes', () => {
  const ok = { dur: 1, voices: [{ k: 'osc', w: 'sine', t: 0, d: 0.5, f0: 440, f1: 440, g: 0.3, a: 0.01 }] };
  assert.ok(P.validRecipe(ok)); for (const bad of [null, {}, { dur: 1, voices: [] }, { dur: 99, voices: ok.voices }, { dur: 1, voices: [{ ...ok.voices[0], g: 5 }] }, { dur: 1, voices: [{ ...ok.voices[0], f0: NaN }] }, { dur: 1, voices: [{ ...ok.voices[0], w: 'evil' }] }, { dur: 1, voices: [{ ...ok.voices[0], k: 'x' }] }, { dur: 1, voices: [{ ...ok.voices[0], filt: 'notch' }] }]) assert.ok(!P.validRecipe(bad));
});
test('trim() drops the rocket riser for calm mode: the sound then starts at the impact and stays valid', () => {
  for (const id of C.FX_SOUNDS) { const r = P.RECIPES[id], t = P.trim(r, P.LAUNCH_S); assert.ok(t.voices.length < r.voices.length, id); assert.ok(P.validRecipe(t), id); assert.ok(Math.min(...t.voices.map(v => v.t)) < 0.2, id + ' starts at once'); assert.ok(t.dur < r.dur); }
  assert.equal(P.trim(P.RECIPES.impact, 0), P.RECIPES.impact);
});
test('vibration patterns are plain finite numbers (Vibration API)', () => { for (const p of Object.values(P.VIBRATION)) assert.ok(p.length && p.every(n => Number.isFinite(n) && n > 0 && n <= 1000)); });

/* ----- cfg.fx* persistence (schema stays 7) ----- */
test('fx settings: safe defaults, validated and clamped; junk never survives', () => {
  const d = V.cfgOf({}); assert.deepEqual([d.fxVolume, d.fxSound, d.fxTen, d.fxWarn, d.fxVibrate, d.fxReduced], [100, 'impact', 'beep', true, false, false]);
  const c = V.cfgOf({ fxVolume: 250, fxSound: 'fanfare', fxTen: 'synth', fxWarn: false, fxVibrate: true, fxReduced: true }); assert.deepEqual([c.fxVolume, c.fxSound, c.fxTen, c.fxWarn, c.fxVibrate, c.fxReduced], [100, 'fanfare', 'synth', false, true, true]);
  const j = V.cfgOf({ fxVolume: 'loud', fxSound: '<script>', fxTen: 'x', fxWarn: 'yes', fxVibrate: 1, fxReduced: null }); assert.deepEqual([j.fxVolume, j.fxSound, j.fxTen, j.fxWarn, j.fxVibrate, j.fxReduced], [100, 'impact', 'beep', true, false, false]);
  assert.equal(V.cfgOf({ fxVolume: -9 }).fxVolume, 0); assert.equal(V.cfgOf({ fxVolume: 42.6 }).fxVolume, 43); assert.equal(V.cfgOf(null).fxSound, 'impact');
});
test('fx settings survive a save/load round trip and old (Phase 2) data simply gets the defaults — schema is still 7', () => {
  const S = V.sanitize41(null); S.cfg = { ...S.cfg, fxVolume: 35, fxSound: 'pulse', fxTen: 'tick', fxWarn: false };
  const back = V.sanitize41(JSON.parse(JSON.stringify(S))); assert.equal(back.cfg.fxVolume, 35); assert.equal(back.cfg.fxSound, 'pulse'); assert.equal(back.cfg.fxTen, 'tick'); assert.equal(back.cfg.fxWarn, false); assert.equal(back.v, 7); assert.equal(back.meta.schema, 7);
  const old = JSON.parse(JSON.stringify(V.sanitize41(null))); for (const k of Object.keys(old.cfg)) if (k.startsWith('fx')) delete old.cfg[k]; assert.equal(V.sanitize41(old).cfg.fxVolume, 100); assert.equal(V.sanitize41(old).cfg.fxSound, 'impact');
  assert.equal(V.SCHEMA, 7); assert.equal(V.KEY, 'chronopulse:v4.1');
});
test('the master Sound switch is still S.sound (default on, only false turns it off) — unchanged from 4.1', () => { assert.equal(V.sanitize41(null).sound, true); assert.equal(V.sanitize41({ sound: false }).sound, false); assert.equal(V.sanitize41({ sound: 'no' }).sound, true); });
test('plan() accepts the Date the app frame loop passes as well as epoch milliseconds (regression: a Date used to disable every effect)', () => {
  const run = P.newRun(), at = new Date(T - 30000), p = P.plan(run, ev(), at); assert.equal(p.phase, 'minute'); assert.equal(p.warn, true);
  assert.equal(P.plan(run, ev(), new Date(T - 5500)).beep, 6);
});
