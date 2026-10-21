'use strict';
/* ChronoPulse 4.2 — reminder (notification) sound: choices, custom-file validation and local storage. Pure logic + a storage adapter that is given its
   browser APIs, so everything is unit-tested in Node with fakes. Loaded as a classic script (window.CP45) and via require().
   Choices (cfg.notifSound): 'system' = no in-app sound, the phone's own notification sound is used | 'tick' = doomsday-tick.mp3 | 'chime' = assets/chime.wav |
   'custom' = the user's own .mp3/.wav, stored on this device only (IndexedDB, or a small localStorage copy where IndexedDB is unavailable).
   HONEST LIMIT: a web app cannot choose the sound of a system notification. A chosen sound plays only while ChronoPulse is open and on screen, when a reminder
   comes due. Closed / background / locked = the phone's own notification sound (or a calendar alarm). The audio file is never uploaded anywhere. */
(function (root) {
  const C = typeof module !== 'undefined' && module.exports ? require('./lib.js') : root.CP;
  const MAX_BYTES = 1000000, LS_MAX_BYTES = 300000, MAX_SECONDS = 30, PLAY_CAP_MS = 8000, MIN_GAP_MS = 1500;
  const DB = 'chronopulse-sound', STORE_NAME = 'sounds', REC = 'reminder', LS_KEY = 'chronopulse:v4.1:sound'; /* LS key keeps the chronopulse: prefix so "Reset all data" clears it */
  const URLS = { tick: 'doomsday-tick.mp3', chime: 'assets/chime.wav' };
  const MIME_OK = new Set(['', 'application/octet-stream', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave']);

  /* decide the real format from the first bytes (a renamed file is rejected) */
  function sniff(b) {
    if (!b || b.length < 4) return '';
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b.length >= 12 && b[8] === 0x57 && b[9] === 0x41 && b[10] === 0x56 && b[11] === 0x45) return 'wav';
    if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return 'mp3'; /* ID3 tag */
    if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && ((b[1] >> 1) & 3) !== 0 && (b[2] >> 4) !== 15 && ((b[2] >> 2) & 3) !== 3) return 'mp3'; /* MPEG frame sync */
    return '';
  }
  const extOf = n => { const m = /\.([A-Za-z0-9]{1,5})$/.exec(String(n || '')); return m ? m[1].toLowerCase() : ''; };
  const safeName = n => String(n || 'sound').replace(/^.*[\\/]/, '').replace(/[\u0000-\u001f\u007f<>"\\/]/g, '').trim().slice(0, 80) || 'sound';
  /* file = { name, size, type }, head = first bytes. Returns { ok, kind, mime, name } or { ok:false, reason } (reason is user-facing). */
  function validateFile(file, head) {
    if (!file || typeof file !== 'object') return { ok: false, reason: 'No file was chosen.' };
    const ext = extOf(file.name);
    if (ext !== 'mp3' && ext !== 'wav') return { ok: false, reason: 'Please choose an .mp3 or .wav file.' };
    if (!Number.isFinite(file.size) || file.size <= 0) return { ok: false, reason: 'That file is empty.' };
    if (file.size > MAX_BYTES) return { ok: false, reason: `That file is too large (${(file.size / 1e6).toFixed(1)} MB). The limit is ${MAX_BYTES / 1e6} MB — a short clip is best.` };
    if (!MIME_OK.has(String(file.type || '').toLowerCase())) return { ok: false, reason: 'That does not look like an audio file.' };
    const kind = sniff(head);
    if (!kind) return { ok: false, reason: 'That file is not a valid MP3 or WAV (its contents do not match).' };
    if (kind !== ext) return { ok: false, reason: `The file is named .${ext} but contains ${kind.toUpperCase()} audio. Please re-export or rename it.` };
    return { ok: true, kind, mime: kind === 'mp3' ? 'audio/mpeg' : 'audio/wav', name: safeName(file.name) };
  }

  /* which sound is really used. A 'custom' choice whose file is missing (cleared storage, backup restored on another device) falls back to the system sound. */
  function resolve(cfg, hasCustom) {
    const want = cfg && C.NOTIF_SOUNDS.includes(cfg.notifSound) ? cfg.notifSound : 'system';
    if (want === 'custom' && !hasCustom) return { mode: 'system', missing: true };
    return { mode: want, missing: false };
  }
  const NOTIF_OK = v => (C.NOTIF_SOUNDS.includes(v) ? v : 'system');
  const urlFor = mode => URLS[mode] || '';
  /* in-app sound only while the page is visible, the master Sound switch is on and the volume is above 0 */
  const shouldPlay = o => !!o && o.mode !== 'system' && !!o.visible && !!o.masterOn && Number(o.volume) > 0;
  /* at most one reminder sound per MIN_GAP_MS, however many reminders fire together */
  function gate(state, now) { if (!state || !Number.isFinite(now)) return false; if (state.last !== undefined && now - state.last < MIN_GAP_MS && now >= state.last) return false; state.last = now; return true; }

  /* ---------- storage adapter ---------- */
  const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  const idbP = req => new Promise((ok, no) => { req.onsuccess = () => ok(req.result); req.onerror = () => no(req.error || new Error('IndexedDB request failed')); });
  const txDone = tx => new Promise((ok, no) => { tx.oncomplete = () => ok(); tx.onerror = () => no(tx.error || new Error('IndexedDB transaction failed')); tx.onabort = () => no(tx.error || new Error('IndexedDB transaction aborted')); });
  /* env = { indexedDB, localStorage, Blob }. Never throws: every method resolves to a plain result. */
  function createStore(env) {
    const idbF = env && env.indexedDB, ls = env && env.localStorage, BlobC = (env && env.Blob) || (typeof Blob !== 'undefined' ? Blob : null);
    let dbP = null, backend = idbF ? 'idb' : ls ? 'ls' : 'none';
    const open = () => dbP || (dbP = new Promise((ok, no) => {
      try { const r = idbF.open(DB, 1); r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME); }; r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error || new Error('open failed')); r.onblocked = () => no(new Error('blocked')); } catch (e) { no(e); }
    }).catch(e => { dbP = null; throw e; }));
    const lsGet = () => { try { const raw = ls && ls.getItem(LS_KEY); if (!raw) return null; const o = JSON.parse(raw); if (!o || typeof o.b64 !== 'string') return null; return o; } catch (e) { return null; } };
    async function idbGet() { const db = await open(), tx = db.transaction(STORE_NAME, 'readonly'); return idbP(tx.objectStore(STORE_NAME).get(REC)); }
    /* save: { name, type, bytes:Uint8Array }  ->  { ok, backend } | { ok:false, reason } */
    async function put(rec) {
      if (!rec || !rec.bytes || !rec.bytes.length) return { ok: false, reason: 'Nothing to save.' };
      if (rec.bytes.length > MAX_BYTES) return { ok: false, reason: 'That file is too large.' };
      if (idbF && BlobC) {
        try { const db = await open(), tx = db.transaction(STORE_NAME, 'readwrite'); tx.objectStore(STORE_NAME).put({ name: rec.name, type: rec.type, size: rec.bytes.length, blob: new BlobC([rec.bytes], { type: rec.type }), at: Date.now() }, REC); await txDone(tx); try { ls && ls.removeItem(LS_KEY); } catch (e) { /* ignore */ } backend = 'idb'; return { ok: true, backend }; } catch (e) { /* fall through to localStorage */ }
      }
      if (!ls) return { ok: false, reason: 'This browser is not letting ChronoPulse store files (private mode or storage blocked).' };
      if (rec.bytes.length > LS_MAX_BYTES) return { ok: false, reason: `This browser can only keep small files here (${Math.round(LS_MAX_BYTES / 1000)} KB). Please choose a shorter clip.` };
      try { ls.setItem(LS_KEY, JSON.stringify({ name: rec.name, type: rec.type, size: rec.bytes.length, b64: b64(rec.bytes), at: Date.now() })); backend = 'ls'; return { ok: true, backend }; } catch (e) { return { ok: false, reason: 'There is not enough free browser storage to keep this file.' }; }
    }
    /* load: -> { name, type, size, blob } | null */
    async function get() {
      if (idbF) { try { const r = await idbGet(); if (r && r.blob) { backend = 'idb'; return { name: r.name, type: r.type, size: r.size, blob: r.blob }; } } catch (e) { /* try localStorage */ } }
      const o = lsGet(); if (o && BlobC) { try { return { name: o.name, type: o.type, size: o.size, blob: new BlobC([unb64(o.b64)], { type: o.type }) }; } catch (e) { return null; } }
      return null;
    }
    async function info() { const r = await get(); return r ? { has: true, name: r.name, type: r.type, size: r.size, backend } : { has: false, backend }; }
    async function remove() {
      let ok = true;
      if (idbF) { try { const db = await open(), tx = db.transaction(STORE_NAME, 'readwrite'); tx.objectStore(STORE_NAME).delete(REC); await txDone(tx); } catch (e) { ok = false; } }
      try { ls && ls.removeItem(LS_KEY); } catch (e) { /* ignore */ }
      return { ok };
    }
    /* "Reset all data": remove the whole database, not just the record */
    async function wipe() {
      try { ls && ls.removeItem(LS_KEY); } catch (e) { /* ignore */ }
      if (!idbF) return { ok: true };
      try { if (dbP) { const db = await dbP.catch(() => null); if (db && db.close) db.close(); dbP = null; } await new Promise(res => { const r = idbF.deleteDatabase(DB); r.onsuccess = r.onerror = r.onblocked = () => res(); }); return { ok: true }; } catch (e) { return { ok: false }; }
    }
    return { put, get, info, remove, wipe, backend: () => backend };
  }

  const api = { MAX_BYTES, LS_MAX_BYTES, MAX_SECONDS, PLAY_CAP_MS, MIN_GAP_MS, DB, STORE_NAME, REC, LS_KEY, URLS, NOTIF_OK, sniff, extOf, safeName, validateFile, resolve, urlFor, shouldPlay, gate, createStore, b64, unb64 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CP45 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
