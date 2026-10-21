'use strict';
/* ChronoPulse 4.2 (Phase 3) — tiny Web Audio engine. Synthesizes every effect (no audio files, no network), so it works offline.
   Rules this file enforces:
   - Autoplay policy: the AudioContext is only created/resumed from unlock(), which the app calls from a real user gesture (tap / key). Until then play() is a
     no-op that returns false and state() says 'idle'/'locked', so the UI can show an honest "tap once to allow sound" hint instead of failing silently.
   - Nothing here can throw into the countdown: every Web Audio call is wrapped, failures set state 'error' and play() returns false.
   - No claim of background audio: sound only exists while this page is alive. A hidden/locked page is not a supported audio path.
   Loaded as a classic script (window.CPSFX) and via require() in Node tests (createEngine takes a fake AudioContext constructor). */
(function (root) {
  const P = typeof module !== 'undefined' && module.exports ? require('./lib/lib43.js') : root.CP43;

  function createEngine(env) {
    const Ctor = env && env.AudioContext;
    let ctx = null, master = null, limiter = null, noiseBuf = null, st = Ctor ? 'idle' : 'unsupported', volume = 100, muted = false, lastError = '';
    const live = new Set(), subs = new Set();
    const setState = s => { if (s !== st) { st = s; subs.forEach(f => { try { f(st); } catch (e) { /* a listener must never break audio */ } }); } };
    const fail = e => { lastError = e && e.message ? String(e.message) : String(e); if (st !== 'unsupported') setState('error'); return false; };
    const mapState = () => (!ctx ? 'idle' : ctx.state === 'running' ? 'ready' : ctx.state === 'closed' ? 'error' : 'locked'); /* 'suspended' and iOS 'interrupted' both mean "needs a tap" */

    function build() {
      ctx = new Ctor();
      master = ctx.createGain(); master.gain.value = P.webGain(volume);
      limiter = ctx.createDynamicsCompressor(); /* overlapping voices can exceed 1.0; the limiter keeps the boom from clipping */
      if (limiter.threshold) { limiter.threshold.value = -6; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.003; limiter.release.value = 0.25; }
      master.connect(limiter); limiter.connect(ctx.destination);
      if (typeof ctx.addEventListener === 'function') ctx.addEventListener('statechange', () => setState(mapState()));
      try { if (env.audioSession && env.audioSession.type !== undefined) env.audioSession.type = 'playback'; } catch (e) { /* best effort: lets iOS Safari play Web Audio even with the silent switch on, where supported */ }
    }
    /* Call ONLY from a user gesture (pointerdown / keydown / touchend / click). Resolves with the resulting state. */
    async function unlock() {
      if (!Ctor) return st;
      try {
        if (!ctx || ctx.state === 'closed') { ctx = null; build(); }
        if (ctx.state !== 'running' && typeof ctx.resume === 'function') await ctx.resume();
        setState(mapState());
      } catch (e) { fail(e); }
      return st;
    }
    /* Non-gesture retry used when the app comes back to the foreground. Chrome usually allows it; iOS may refuse until a tap, in which case state stays 'locked'. Never throws. */
    async function resume() {
      if (!ctx || ctx.state === 'running') return st;
      try { if (ctx.state !== 'closed' && typeof ctx.resume === 'function') await ctx.resume(); } catch (e) { lastError = e && e.message ? String(e.message) : String(e); }
      setState(mapState()); return st;
    }
    const noise = () => { if (noiseBuf) return noiseBuf; const n = Math.floor(ctx.sampleRate * 2), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; return (noiseBuf = b); };

    function voice(v, t0) {
      const t = t0 + v.t, end = t + v.d, g = ctx.createGain(), src = v.k === 'noise' ? ctx.createBufferSource() : ctx.createOscillator();
      if (v.k === 'noise') { src.buffer = noise(); src.loop = true; } else { src.type = v.w; src.frequency.setValueAtTime(v.f0, t); if (v.f1 !== v.f0) src.frequency.exponentialRampToValueAtTime(v.f1, end); }
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v.g, t + v.a); g.gain.exponentialRampToValueAtTime(0.0001, end);
      let node = src;
      if (v.filt) { const f = ctx.createBiquadFilter(); f.type = v.filt; f.Q.value = v.q; f.frequency.setValueAtTime(v.ff0, t); if (v.ff1 !== v.ff0) f.frequency.exponentialRampToValueAtTime(v.ff1, end); node.connect(f); node = f; }
      node.connect(g); g.connect(master);
      const rec = { src, g }; live.add(rec); src.onended = () => { live.delete(rec); try { g.disconnect(); } catch (e) { /* already gone */ } };
      src.start(t); src.stop(end + 0.05);
    }
    /* Plays one recipe (lib/lib43.js). Returns true when it was scheduled, false when muted / locked / unsupported / failed. Never throws. */
    function play(recipe, opt) {
      try {
        if (muted || !Ctor || !recipe || !P.validRecipe(recipe)) return false;
        if (!ctx || mapState() !== 'ready') { if (ctx) setState(mapState()); return false; }
        const r = opt && opt.skip ? P.trim(recipe, opt.skip) : recipe, t0 = ctx.currentTime + 0.02;
        for (const v of r.voices) voice(v, t0);
        return true;
      } catch (e) { return fail(e); }
    }
    function stopAll() {
      for (const r of [...live]) { try { r.g.gain.cancelScheduledValues(0); r.g.gain.setValueAtTime(0, ctx ? ctx.currentTime : 0); r.src.stop(); } catch (e) { /* already stopped */ } try { r.g.disconnect(); } catch (e) { /* ok */ } live.delete(r); }
    }
    function configure(o) {
      if (!o) return;
      if (o.volume !== undefined) { volume = P.normVol(o.volume); try { if (master) master.gain.value = P.webGain(volume); } catch (e) { fail(e); } }
      if (o.muted !== undefined) { muted = !!o.muted; if (muted) stopAll(); }
    }
    return { unlock, resume, play, stopAll, configure, state: () => st, lastError: () => lastError, isMuted: () => muted, onState(f) { subs.add(f); return () => subs.delete(f); }, activeVoices: () => live.size };
  }

  const api = { createEngine };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { const g = root, Ctor = g.AudioContext || g.webkitAudioContext; root.CPSFX = createEngine({ AudioContext: Ctor, audioSession: g.navigator && g.navigator.audioSession }); root.CPSFX.createEngine = createEngine; }
})(typeof globalThis !== 'undefined' ? globalThis : this);
