'use strict';
/* Phase 3: the Web Audio engine (sfx.js) driven by a fake AudioContext — autoplay gating and graceful failure. */
const test = require('node:test'), assert = require('node:assert/strict');
const { createEngine } = require('../sfx.js'), P = require('../lib/lib43.js');

function fake(opt = {}) {
  const log = { ctors: 0, nodes: { osc: 0, src: 0, gain: 0, filt: 0 }, started: 0, stopped: 0, masterGain: null, resumed: 0 };
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} });
  class Ctx {
    constructor() { log.ctors++; if (opt.ctorThrows) throw new Error('no audio device'); this.state = opt.initial || 'suspended'; this.currentTime = 0; this.sampleRate = 8000; this.destination = {}; log.ctx = this; }
    createGain() { log.nodes.gain++; const g = { gain: param(), connect() {}, disconnect() {} }; if (!log.masterGain) log.masterGain = g; return g; }
    createDynamicsCompressor() { return { threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(), connect() {}, disconnect() {} }; }
    createOscillator() { if (opt.oscThrows) throw new Error('boom'); log.nodes.osc++; return { frequency: param(), connect() {}, start() { log.started++; }, stop() { log.stopped++; } }; }
    createBufferSource() { log.nodes.src++; return { connect() {}, start() { log.started++; }, stop() { log.stopped++; } }; }
    createBiquadFilter() { log.nodes.filt++; return { frequency: param(), Q: param(), connect() {} }; }
    createBuffer(c, n) { return { getChannelData: () => new Float32Array(n) }; }
    resume() { log.resumed++; if (opt.resumeRejects) return Promise.reject(new Error('NotAllowedError')); if (!opt.stayLocked) this.state = 'running'; return Promise.resolve(); }
    addEventListener() {}
  }
  return { log, engine: createEngine({ AudioContext: Ctx, audioSession: opt.audioSession }) };
}
const REC = { dur: 1, voices: [{ k: 'osc', w: 'sine', t: 0, d: 0.3, f0: 440, f1: 880, g: 0.3, a: 0.01 }, { k: 'noise', t: 0.1, d: 0.3, filt: 'lowpass', ff0: 2000, ff1: 200, q: 1, g: 0.3, a: 0.01 }] };

test('autoplay policy: no AudioContext is created and nothing plays until unlock() is called (from a gesture)', () => {
  const { log, engine } = fake(); assert.equal(engine.state(), 'idle'); assert.equal(engine.play(REC), false); assert.equal(log.ctors, 0); assert.equal(log.started, 0);
});
test('unlock() creates the context once, resumes it, and then play() schedules every voice', async () => {
  const { log, engine } = fake(); assert.equal(await engine.unlock(), 'ready'); assert.equal(log.ctors, 1); assert.equal(engine.play(REC), true);
  assert.equal(log.nodes.osc, 1); assert.equal(log.nodes.src, 1); assert.equal(log.nodes.filt, 1); assert.equal(log.started, 2); await engine.unlock(); assert.equal(log.ctors, 1, 'second unlock reuses the context');
});
test('a browser that keeps the context suspended (or iOS "interrupted") reports "locked" and play() returns false without throwing', async () => {
  const { log, engine } = fake({ stayLocked: true }); assert.equal(await engine.unlock(), 'locked'); assert.equal(engine.play(REC), false); assert.equal(log.started, 0);
});
test('resume() rejection is swallowed: state "error", play() false, nothing thrown', async () => {
  const { engine } = fake({ resumeRejects: true }); assert.equal(await engine.unlock(), 'error'); assert.equal(engine.play(REC), false); assert.match(engine.lastError(), /NotAllowed/);
});
test('a constructor that throws (no audio device) is handled', async () => { const { engine } = fake({ ctorThrows: true }); assert.equal(await engine.unlock(), 'error'); assert.equal(engine.play(REC), false); });
test('an error while scheduling a voice never throws into the caller', async () => {
  const { engine } = fake({ oscThrows: true }); await engine.unlock(); assert.doesNotThrow(() => assert.equal(engine.play(REC), false)); assert.equal(engine.state(), 'error');
});
test('no Web Audio at all: state "unsupported", unlock and play are safe no-ops', async () => {
  const e = createEngine({}); assert.equal(e.state(), 'unsupported'); assert.equal(await e.unlock(), 'unsupported'); assert.equal(e.play(REC), false); assert.doesNotThrow(() => { e.stopAll(); e.configure({ volume: 10, muted: true }); });
});
test('muted engine plays nothing; unmuting works again; muting stops sounds already playing', async () => {
  const { log, engine } = fake(); await engine.unlock(); engine.configure({ muted: true }); assert.equal(engine.play(REC), false); assert.equal(log.started, 0);
  engine.configure({ muted: false }); assert.equal(engine.play(REC), true); assert.ok(engine.activeVoices() > 0); engine.configure({ muted: true }); assert.equal(engine.activeVoices(), 0); assert.ok(log.stopped >= 2);
});
test('stopAll() ends every playing voice immediately', async () => { const { engine } = fake(); await engine.unlock(); engine.play(REC); engine.play(REC); assert.equal(engine.activeVoices(), 4); engine.stopAll(); assert.equal(engine.activeVoices(), 0); });
test('volume maps through the shared curve onto the master gain, before and after the context exists', async () => {
  const { log, engine } = fake(); engine.configure({ volume: 50 }); await engine.unlock(); assert.ok(Math.abs(log.masterGain.gain.value - P.webGain(50)) < 1e-9); engine.configure({ volume: 0 }); assert.equal(log.masterGain.gain.value, 0);
  engine.configure({ volume: 999 }); assert.ok(Math.abs(log.masterGain.gain.value - P.webGain(100)) < 1e-9);
});
test('invalid recipes are refused (never reach Web Audio)', async () => { const { log, engine } = fake(); await engine.unlock(); assert.equal(engine.play({ dur: 1, voices: [{ k: 'osc', w: 'sine', t: 0, d: 1, f0: NaN, f1: 1, g: 1, a: 0.1 }] }), false); assert.equal(engine.play(null), false); assert.equal(log.started, 0); });
test('skip trims the riser: calm mode schedules fewer voices for every celebration sound', async () => {
  for (const id of Object.keys(P.RECIPES)) { const a = fake(), b = fake(); await a.engine.unlock(); await b.engine.unlock(); a.engine.play(P.RECIPES[id]); b.engine.play(P.RECIPES[id], { skip: P.LAUNCH_S }); assert.ok(b.log.started < a.log.started, id); assert.ok(b.log.started > 0, id); }
});
test('every built-in sound plays through the engine without error', async () => {
  const { engine } = fake(); await engine.unlock(); for (const r of [...Object.values(P.RECIPES), P.WARN, ...['tick', 'beep', 'synth'].map(s => P.tenRecipe(s, 3))]) assert.equal(engine.play(r), true, r.id);
});
test('state listeners are notified and a throwing listener cannot break audio', async () => {
  const { engine } = fake(), seen = []; engine.onState(s => seen.push(s)); engine.onState(() => { throw new Error('listener bug'); }); await engine.unlock(); assert.deepEqual(seen, ['ready']); assert.equal(engine.play(REC), true);
});
test('iOS audio session is set to "playback" when the browser offers it (best effort, never required)', async () => {
  const session = { type: 'auto' }; const { engine } = fake({ audioSession: session }); await engine.unlock(); assert.equal(session.type, 'playback');
  const { engine: e2 } = fake({ audioSession: Object.freeze({ type: 'auto' }) }); assert.equal(await e2.unlock(), 'ready');
});

test('resume(): a suspended engine is resumed without a gesture when the browser allows it; refusal is swallowed and state stays locked', async () => {
  const a = fake(); await a.engine.unlock(); a.log.ctx.state = 'suspended'; assert.equal(await a.engine.resume(), 'ready'); assert.equal(a.engine.play(REC), true);
  const b = fake(); await b.engine.unlock(); b.log.ctx.state = 'interrupted'; b.log.ctx.resume = () => Promise.reject(new Error('NotAllowedError')); assert.equal(await b.engine.resume(), 'locked'); assert.equal(b.engine.play(REC), false);
  const c = fake(); assert.equal(await c.engine.resume(), 'idle', 'before the first gesture there is no context to resume (and none is created)'); assert.equal(c.log.ctors, 0); assert.equal(await createEngine({}).resume(), 'unsupported');
});
