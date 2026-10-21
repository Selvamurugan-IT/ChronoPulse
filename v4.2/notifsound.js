'use strict';
/* ChronoPulse 4.2 — reminder sound selector (Default system / Doomsday tick / Chime / Custom file). All rules live in lib/lib45.js (unit-tested).
   The custom file is kept ONLY on this device (IndexedDB, or a small localStorage copy where IndexedDB is unavailable), is never uploaded, and is wiped by
   "Reset all data". It is played ONLY while ChronoPulse is open and visible when a reminder comes due: a web app cannot change the sound of a system
   notification, so closed / background / locked keeps the phone's own sound. Nothing here can throw into the reminder or countdown code. */
(function () {
  const K = CP45, safe = f => { try { return f(); } catch (e) { return null; } };
  const store = K.createStore({ indexedDB: safe(() => window.indexedDB), localStorage: safe(() => window.localStorage), Blob });
  let meta = { has: false }, el = null, objUrl = '', capT = 0, lastErr = '', busy = false, flash = ''; const gateState = {}, cfg = () => S.cfg;
  const NAMES = { system: 'the default system sound', tick: 'Doomsday tick', chime: 'Chime', custom: 'your custom sound' };

  async function loadMeta() { try { meta = await store.info(); } catch (e) { meta = { has: false }; } render(); }
  function stop() { clearTimeout(capT); if (el) { try { el.pause(); } catch (e) { /* ignore */ } } }
  async function srcFor(mode) {
    if (mode !== 'custom') return K.urlFor(mode);
    const r = await store.get(); if (!r) return ''; if (objUrl) URL.revokeObjectURL(objUrl); objUrl = URL.createObjectURL(r.blob); return objUrl;
  }
  /* -> 'ok' | 'blocked' | 'missing' | 'error' */
  async function play(mode) {
    try {
      const src = await srcFor(mode); if (!src) return 'missing'; stop(); el = el || new Audio(); el.dataset.cp = 'reminder-sound'; el.src = src; el.currentTime = 0;
      try { el.volume = CP43.mediaVolume(cfg().fxVolume); } catch (e) { /* iOS keeps media volume read-only */ }
      await el.play(); capT = setTimeout(stop, K.PLAY_CAP_MS); return 'ok'; /* a reminder sound is a short alert: stop after PLAY_CAP_MS even for a long file */
    } catch (e) { return e && e.name === 'NotAllowedError' ? 'blocked' : 'error'; }
  }

  /* Local Web Audio fallback for missing/unsupported bundled or custom files. Browsers may
     still enforce their gesture policy; failures are intentionally silent and never block alerts. */
  async function synthAlert() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC || !S.sound || document.visibilityState !== 'visible') return false;
      const ctx = new AC(); if (ctx.state !== 'running') await ctx.resume();
      const master = ctx.createGain(); master.gain.value = Math.max(.01, Math.min(1, CP43.mediaVolume(cfg().fxVolume)));
      master.connect(ctx.destination);
      [880, 1174].forEach((hz, i) => {
        const osc = ctx.createOscillator(), gain = ctx.createGain(), start = ctx.currentTime + i * .13;
        osc.type = 'sine'; osc.frequency.setValueAtTime(hz, start);
        gain.gain.setValueAtTime(.0001, start); gain.gain.exponentialRampToValueAtTime(.18, start + .025);
        gain.gain.exponentialRampToValueAtTime(.0001, start + .22);
        osc.connect(gain); gain.connect(master); osc.start(start); osc.stop(start + .24);
      });
      setTimeout(() => { try { ctx.close(); } catch (_) {} }, 700);
      return true;
    } catch (_) { return false; }
  }

  /* called by reminders.js when a reminder is delivered while the app is open (never throws) */
  /* ONE entry point for every in-app alert sound: category 'reminder' (event reminders), 'task' (task reminders) or 'alert' (focus/break finished).
     The choice (Settings → Notifications → Alert sound) is the same for all three: system (no extra sound in the app), the built-in Chime, or your own MP3/WAV.
     The doomsday tick is NOT available here: it is reserved for the Countdown screen (script.js). Category 'alert' with "system" still plays the Chime, as the focus-end chime always did. */
  X.alertSound = category => {
    try {
      if (!CP47.CATEGORIES.includes(category)) return; const eff = CP47.alertMode(cfg().notifSound, meta.has), mode = eff.mode === 'system' && category === 'alert' ? 'chime' : eff.mode;
      if (!K.shouldPlay({ mode, visible: document.visibilityState === 'visible', masterOn: S.sound, volume: cfg().fxVolume }) || !K.gate(gateState[category] || (gateState[category] = {}), Date.now())) return;
      play(mode).then(async r => { if (r !== 'ok' && mode !== 'system') { const ok = await synthAlert(); lastErr = ok ? '' : r; } else lastErr = ''; render(); }, () => {});
    } catch (e) { /* the reminder itself must always be delivered */ }
  };
  X.reminderSound = () => X.alertSound('reminder');
  X.clearSound = () => { stop(); if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = ''; } meta = { has: false }; lastErr = ''; store.wipe().then(render, () => {}); };

  /* ---------- settings UI ---------- */
  function say(t) { flash = t; render(); }
  function render() {
    const sel = $('#nsSound'); if (!sel) return; const c = cfg(), eff = K.resolve(c, meta.has);
    if (sel.value !== c.notifSound) sel.value = c.notifSound;
    const name = $('#nsName'); setT(name, meta.has ? `${meta.name} · ${(meta.size / 1000).toFixed(0)} KB${meta.backend === 'ls' ? ' · small-file storage' : ''}` : 'No file chosen · .mp3 or .wav, up to 1 MB and 30 s');
    $('#nsRemove').hidden = !meta.has; $('#nsPick').disabled = busy; $('#nsPick').textContent = meta.has ? 'Replace…' : 'Choose file…';
    let n;
    if (flash) n = flash;
    else if (eff.missing) n = "Your custom sound is not on this device (storage was cleared, or settings came from another device). Choose the file again; until then the phone's own sound is used.";
    else if (c.notifSound === 'system') n = "Using the phone's own notification sound. Nothing extra plays inside the app, except the Chime when a focus session or break ends.";
    else if (!S.sound) n = `${NAMES[c.notifSound][0].toUpperCase() + NAMES[c.notifSound].slice(1)} is selected, but Sound is off (Settings → Sound & effects), so reminders stay silent inside the app.`;
    else if (lastErr === 'blocked') n = 'The browser blocked the sound. Tap anywhere on the page once, then try again.';
    else if (lastErr) n = 'That sound could not be played here. Try Preview, or choose another sound.';
    else n = `Using ${NAMES[c.notifSound]} for event reminders, task reminders and finished sessions while ChronoPulse is open. The doomsday tick stays on the Countdown screen.`;
    setT($('#nsNote'), n);
  }
  $('#nsSound').addEventListener('change', e => { cfg().notifSound = K.NOTIF_OK(e.target.value); save(); flash = e.target.value === 'custom' && !meta.has ? 'Choose a file below to use your own sound.' : ''; lastErr = ''; render(); });
  $('#nsPrev').addEventListener('click', async () => {
    const c = cfg(); if (c.notifSound === 'system') { if (!S.sound) return say('Sound is off. Turn it on in Settings → Sound & effects to hear previews.'); const r0 = await play('chime'); lastErr = r0 === 'ok' ? '' : r0; return say(r0 === 'ok' ? 'Playing the Chime. This is what plays when a focus session ends; reminders use the phone’s own sound.' : 'The Chime could not be played here. Tap the page once and try again.'); } if (false) return say("The phone's own sound cannot be previewed here. Use “Send a test notification” while the app is in the background.");
    if (!S.sound) return say('Sound is off. Turn it on in Settings → Sound & effects to hear previews.');
    if (c.notifSound === 'custom' && !meta.has) return say('Choose a file first.');
    const r = await play(c.notifSound); flash = ''; lastErr = r === 'ok' ? '' : r; if (r === 'ok') say('Playing preview…'); else render();
  });
  $('#nsPick').addEventListener('click', () => $('#nsFile').click());
  $('#nsRemove').addEventListener('click', async () => {
    busy = true; render(); await store.remove(); busy = false; if (cfg().notifSound === 'custom') cfg().notifSound = 'system'; cfg().notifSoundName = ''; save(); stop(); if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = ''; } meta = { has: false }; say('Custom sound removed from this device.');
  });
  function probe(file) { /* can this browser decode it, and is it short? */
    return new Promise(res => {
      const u = URL.createObjectURL(file), a = new Audio(), done = r => { clearTimeout(t); a.removeAttribute('src'); URL.revokeObjectURL(u); res(r); }, t = setTimeout(() => done({ ok: false, reason: 'The browser could not read that file in time.' }), 6000);
      a.preload = 'metadata'; a.onloadedmetadata = () => done(Number.isFinite(a.duration) && a.duration > K.MAX_SECONDS ? { ok: false, reason: `That sound is ${Math.round(a.duration)} seconds long. Please use a clip of ${K.MAX_SECONDS} seconds or less.` } : { ok: true });
      a.onerror = () => done({ ok: false, reason: 'Your browser could not play that file. Try another MP3 or WAV.' }); a.src = u;
    });
  }
  $('#nsFile').addEventListener('change', async e => {
    const file = e.target.files && e.target.files[0]; e.target.value = ''; if (!file) return;
    busy = true; say('Checking the file…');
    try {
      const head = new Uint8Array(await file.slice(0, 16).arrayBuffer()), v = K.validateFile({ name: file.name, size: file.size, type: file.type }, head); if (!v.ok) return say(v.reason);
      const p = await probe(file); if (!p.ok) return say(p.reason);
      const saved = await store.put({ name: v.name, type: v.mime, bytes: new Uint8Array(await file.arrayBuffer()) }); if (!saved.ok) return say(saved.reason);
      cfg().notifSound = 'custom'; cfg().notifSoundName = v.name; save(); lastErr = ''; flash = ''; await loadMeta(); toast('Custom sound saved on this device');
    } catch (err) { say('Could not save that file. Nothing was changed.'); } finally { busy = false; render(); }
  });

  const prevSet = X.onSettings; X.onSettings = () => { if (prevSet) prevSet(); flash = ''; render(); };
  const prevState = X.onState; X.onState = () => { if (prevState) prevState(); loadMeta(); };
  loadMeta();
})();
