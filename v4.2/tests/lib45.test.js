'use strict';
/* Reminder sound: choices, file validation, playback rules and the IndexedDB/localStorage store (lib/lib45.js) + cfg fields. Pure Node with fakes. */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const P = require('../lib/lib45.js'), C = require('../lib/lib.js'), V = require('../lib/lib41.js');
const root = path.join(__dirname, '..');
const MP3_ID3 = Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]), MP3_FRAME = Uint8Array.from([0xff, 0xfb, 0x90, 0x00]), WAV = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45]);

/* ----- fakes ----- */
function fakeIDB(o = {}) {
  const dbs = new Map(), t0 = f => setTimeout(f, 0);
  return { dbs, open() { const req = {}; t0(() => {
    if (o.failOpen) { req.error = new Error('SecurityError'); return req.onerror && req.onerror(); }
    let rec = dbs.get(P.DB); const fresh = !rec; if (fresh) { rec = { stores: new Map() }; dbs.set(P.DB, rec); }
    const db = { closed: false, objectStoreNames: { contains: n => rec.stores.has(n) }, createObjectStore: n => rec.stores.set(n, new Map()), close() { db.closed = true; },
      transaction(n) { const store = rec.stores.get(n), tx = {}, done = () => t0(() => tx.oncomplete && tx.oncomplete());
        tx.objectStore = () => ({ put(v, k) { const r = {}; t0(() => { if (o.failPut) { tx.error = new Error('QuotaExceededError'); tx.onabort && tx.onabort(); return; } store.set(k, v); r.result = k; r.onsuccess && r.onsuccess(); done(); }); return r; },
          get(k) { const r = {}; t0(() => { r.result = store.get(k); r.onsuccess && r.onsuccess(); }); return r; }, delete(k) { const r = {}; t0(() => { store.delete(k); r.onsuccess && r.onsuccess(); done(); }); return r; } }); return tx; } };
    req.result = db; if (fresh && req.onupgradeneeded) req.onupgradeneeded(); req.onsuccess && req.onsuccess(); }); return req; },
    deleteDatabase(name) { const r = {}; t0(() => { if (o.blockedDelete) return r.onblocked && r.onblocked(); dbs.delete(name); r.onsuccess && r.onsuccess(); }); return r; } };
}
function fakeLS(limit = Infinity) { const m = new Map(); return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem(k, v) { if ([...m.values()].join('').length + String(v).length > limit) throw new Error('QuotaExceededError'); m.set(k, String(v)); }, removeItem: k => m.delete(k) }; }
const bytes = n => Uint8Array.from({ length: n }, (_, i) => (i * 7) % 256);
const rec = (n = 5000, o = {}) => ({ name: 'ding.mp3', type: 'audio/mpeg', bytes: bytes(n), ...o });
const same = async (blob, u8) => Buffer.compare(Buffer.from(await blob.arrayBuffer()), Buffer.from(u8)) === 0;

/* ----- format detection & validation ----- */
test('sniff: recognises MP3 (ID3 tag and MPEG frame sync) and WAV; rejects everything else', () => {
  assert.equal(P.sniff(MP3_ID3), 'mp3'); assert.equal(P.sniff(MP3_FRAME), 'mp3'); assert.equal(P.sniff(Uint8Array.from([0xff, 0xf3, 0x44, 0xc0])), 'mp3'); assert.equal(P.sniff(WAV), 'wav');
  for (const bad of [null, undefined, [], [1, 2, 3], Uint8Array.from([0x4d, 0x5a, 0x90, 0]), Uint8Array.from([0x89, 0x50, 0x4e, 0x47]), Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20]), Uint8Array.from([0xff, 0xf8, 0x90, 0]), Uint8Array.from([0xff, 0xfb, 0xf0, 0]), Uint8Array.from([0xff, 0xfb, 0x9c, 0])]) assert.equal(P.sniff(bad), '', String(bad));
});
test('validateFile: accepts a real mp3 and wav (case-insensitive extension, any normal MIME or none)', () => {
  assert.deepEqual(P.validateFile({ name: 'ding.mp3', size: 5000, type: 'audio/mpeg' }, MP3_ID3), { ok: true, kind: 'mp3', mime: 'audio/mpeg', name: 'ding.mp3' });
  assert.deepEqual(P.validateFile({ name: 'BELL.WAV', size: 5000, type: 'audio/x-wav' }, WAV), { ok: true, kind: 'wav', mime: 'audio/wav', name: 'BELL.WAV' });
  for (const type of ['', 'application/octet-stream', 'audio/mp3', 'audio/wave', 'audio/vnd.wave', 'AUDIO/MPEG']) assert.ok(P.validateFile({ name: 'a.mp3', size: 10, type }, MP3_FRAME).ok, type);
});
test('validateFile: rejects wrong extensions, empty/oversized files, non-audio MIME and mismatched contents — each with a user-facing reason', () => {
  const r = (f, h) => P.validateFile(f, h);
  for (const n of ['a.ogg', 'a.mp4', 'a.exe', 'a', 'a.mp3.exe', '', null, 'mp3']) { const v = r({ name: n, size: 10, type: '' }, MP3_ID3); assert.equal(v.ok, false, String(n)); assert.match(v.reason, /\.mp3 or \.wav/); }
  assert.match(r({ name: 'a.mp3', size: 0, type: '' }, MP3_ID3).reason, /empty/); assert.match(r({ name: 'a.mp3', size: NaN, type: '' }, MP3_ID3).reason, /empty/);
  assert.ok(r({ name: 'a.mp3', size: P.MAX_BYTES, type: '' }, MP3_ID3).ok); assert.match(r({ name: 'a.mp3', size: P.MAX_BYTES + 1, type: '' }, MP3_ID3).reason, /too large/);
  assert.match(r({ name: 'a.mp3', size: 10, type: 'image/png' }, MP3_ID3).reason, /audio file/); assert.match(r({ name: 'a.mp3', size: 10, type: '' }, Uint8Array.from([0x4d, 0x5a, 0x90, 0])).reason, /not a valid MP3 or WAV/);
  assert.match(r({ name: 'a.mp3', size: 10, type: '' }, WAV).reason, /named \.mp3 but contains WAV/); assert.match(r({ name: 'a.wav', size: 10, type: '' }, MP3_ID3).reason, /named \.wav but contains MP3/); assert.equal(r(null).ok, false);
});
test('safeName: strips paths, control characters and markup characters, caps the length', () => {
  assert.equal(P.safeName('C:\\Users\\me\\ding.mp3'), 'ding.mp3'); assert.equal(P.safeName('/tmp/a/b.wav'), 'b.wav'); assert.equal(P.safeName('<img src=x onerror=1>.mp3'), 'img src=x onerror=1.mp3'); assert.equal(P.safeName('a\u0000b\nc.mp3'), 'abc.mp3');
  assert.equal(P.safeName('x'.repeat(200) + '.mp3').length, 80); assert.equal(P.safeName(''), 'sound'); assert.equal(P.safeName(null), 'sound');
});

/* ----- choices and playback rules ----- */
test('resolve: a custom choice with no file on this device falls back to the system sound (and says so)', () => {
  assert.deepEqual(P.resolve({ notifSound: 'custom' }, false), { mode: 'system', missing: true }); assert.deepEqual(P.resolve({ notifSound: 'custom' }, true), { mode: 'custom', missing: false });
  for (const m of ['system', 'tick', 'chime']) for (const has of [true, false]) assert.deepEqual(P.resolve({ notifSound: m }, has), { mode: m, missing: false });
  for (const bad of [null, {}, { notifSound: 'evil' }, { notifSound: 5 }]) assert.deepEqual(P.resolve(bad, true), { mode: 'system', missing: false });
});
test('the four choices are exactly: Default system, Doomsday tick, Chime, Custom', () => { assert.deepEqual(C.NOTIF_SOUNDS, ['system', 'tick', 'chime', 'custom']); assert.equal(P.NOTIF_OK('chime'), 'chime'); assert.equal(P.NOTIF_OK('x'), 'system'); });
test('built-in choices map to the precached files, which exist on disk', () => {
  assert.equal(P.urlFor('tick'), 'doomsday-tick.mp3'); assert.equal(P.urlFor('chime'), 'assets/chime.wav'); assert.equal(P.urlFor('system'), ''); assert.equal(P.urlFor('custom'), '');
  for (const m of ['tick', 'chime']) assert.ok(fs.existsSync(path.join(root, P.urlFor(m))), m);
  const sw = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8'); for (const m of ['tick', 'chime']) assert.ok(sw.includes(`'${P.urlFor(m)}'`));
});
test('shouldPlay: only a non-system sound, only on a visible page, only with master Sound on and volume > 0', () => {
  const ok = { mode: 'chime', visible: true, masterOn: true, volume: 80 }; assert.equal(P.shouldPlay(ok), true);
  for (const bad of [{ mode: 'system' }, { visible: false }, { masterOn: false }, { volume: 0 }, { volume: NaN }, { volume: -1 }]) assert.equal(P.shouldPlay({ ...ok, ...bad }), false, JSON.stringify(bad)); assert.equal(P.shouldPlay(null), false);
});
test('gate: one reminder sound per 1.5 s however many reminders fire together; a backwards clock does not block forever', () => {
  const g = {}; assert.equal(P.gate(g, 10000), true); assert.equal(P.gate(g, 10001), false); assert.equal(P.gate(g, 11499), false); assert.equal(P.gate(g, 11500), true); assert.equal(P.gate(g, 5000), true, 'clock moved back'); assert.equal(P.gate(g, NaN), false); assert.equal(P.gate(null, 1), false);
});

/* ----- storage: IndexedDB first ----- */
test('IndexedDB: save, read back the exact bytes, show info, replace, remove', async () => {
  const idb = fakeIDB(), ls = fakeLS(), s = P.createStore({ indexedDB: idb, localStorage: ls, Blob }); assert.deepEqual(await s.info(), { has: false, backend: 'idb' });
  const r1 = rec(5000); assert.deepEqual(await s.put(r1), { ok: true, backend: 'idb' }); const got = await s.get(); assert.equal(got.name, 'ding.mp3'); assert.equal(got.type, 'audio/mpeg'); assert.equal(got.size, 5000); assert.ok(await same(got.blob, r1.bytes));
  assert.deepEqual(await s.info(), { has: true, name: 'ding.mp3', type: 'audio/mpeg', size: 5000, backend: 'idb' }); assert.equal(ls.m.size, 0, 'nothing is put in localStorage when IndexedDB works');
  const r2 = rec(800, { name: 'bell.wav', type: 'audio/wav' }); await s.put(r2); const g2 = await s.get(); assert.equal(g2.name, 'bell.wav'); assert.ok(await same(g2.blob, r2.bytes));
  assert.equal((await s.remove()).ok, true); assert.equal((await s.info()).has, false);
});
test('a file survives "reopening the app" (a new store on the same database) — i.e. it works offline after a refresh', async () => {
  const idb = fakeIDB(); const a = P.createStore({ indexedDB: idb, localStorage: fakeLS(), Blob }); await a.put(rec(1234)); const b = P.createStore({ indexedDB: idb, localStorage: fakeLS(), Blob }); const g = await b.get(); assert.equal(g.size, 1234); assert.ok(await same(g.blob, rec(1234).bytes));
});
test('limits: empty and oversized files are refused before any storage is touched', async () => {
  const s = P.createStore({ indexedDB: fakeIDB(), localStorage: fakeLS(), Blob });
  assert.equal((await s.put({ name: 'a', type: 'audio/mpeg', bytes: new Uint8Array(0) })).ok, false); assert.equal((await s.put(null)).ok, false); assert.equal((await s.put(rec(P.MAX_BYTES + 1))).ok, false); assert.equal((await s.put(rec(P.MAX_BYTES))).ok, true);
});

/* ----- storage: localStorage fallback ----- */
test('IndexedDB unavailable (open fails): falls back to a small localStorage copy that reads back identically', async () => {
  const ls = fakeLS(), s = P.createStore({ indexedDB: fakeIDB({ failOpen: true }), localStorage: ls, Blob }), r = rec(20000);
  assert.deepEqual(await s.put(r), { ok: true, backend: 'ls' }); assert.ok(ls.m.has(P.LS_KEY)); assert.ok(P.LS_KEY.startsWith('chronopulse:'), 'cleared by Reset all data');
  const g = await s.get(); assert.equal(g.size, 20000); assert.ok(await same(g.blob, r.bytes)); assert.equal((await s.info()).backend, 'ls');
});
test('IndexedDB write fails (quota) -> falls back to localStorage; no IndexedDB at all -> localStorage', async () => {
  const a = P.createStore({ indexedDB: fakeIDB({ failPut: true }), localStorage: fakeLS(), Blob }); assert.deepEqual(await a.put(rec(3000)), { ok: true, backend: 'ls' }); assert.equal((await a.get()).size, 3000);
  const b = P.createStore({ localStorage: fakeLS(), Blob }); assert.deepEqual(await b.put(rec(3000)), { ok: true, backend: 'ls' });
});
test('the localStorage fallback keeps files small, reports quota problems and never throws', async () => {
  const s = P.createStore({ localStorage: fakeLS(), Blob }); const big = await s.put(rec(P.LS_MAX_BYTES + 1)); assert.equal(big.ok, false); assert.match(big.reason, /small files/); assert.equal((await s.put(rec(P.LS_MAX_BYTES))).ok, true);
  const tiny = P.createStore({ localStorage: fakeLS(1000), Blob }); const q = await tiny.put(rec(5000)); assert.equal(q.ok, false); assert.match(q.reason, /storage/);
  const none = P.createStore({ Blob }); assert.equal(none.backend(), 'none'); const n = await none.put(rec(100)); assert.equal(n.ok, false); assert.match(n.reason, /not letting|blocked/); assert.deepEqual(await none.info(), { has: false, backend: 'none' });
});
test('a successful IndexedDB save removes a stale localStorage copy; corrupt localStorage data reads as "no file"', async () => {
  const ls = fakeLS(); ls.setItem(P.LS_KEY, JSON.stringify({ name: 'old.mp3', type: 'audio/mpeg', size: 3, b64: 'AAEC' })); const s = P.createStore({ indexedDB: fakeIDB(), localStorage: ls, Blob }); await s.put(rec(100)); assert.ok(!ls.m.has(P.LS_KEY));
  for (const junk of ['{not json', '"str"', '{"b64":5}', 'null']) { const l = fakeLS(); l.setItem(P.LS_KEY, junk); const t = P.createStore({ localStorage: l, Blob }); assert.equal((await t.get()), null, junk); assert.equal((await t.info()).has, false); }
});
test('wipe (Reset all data) deletes the database and the localStorage copy, and still resolves if the browser blocks the delete', async () => {
  const idb = fakeIDB(), ls = fakeLS(), s = P.createStore({ indexedDB: idb, localStorage: ls, Blob }); await s.put(rec(100)); ls.setItem(P.LS_KEY, 'x'); assert.ok(idb.dbs.has(P.DB));
  assert.equal((await s.wipe()).ok, true); assert.ok(!idb.dbs.has(P.DB)); assert.ok(!ls.m.has(P.LS_KEY)); assert.equal((await s.info()).has, false);
  const blocked = P.createStore({ indexedDB: fakeIDB({ blockedDelete: true }), localStorage: fakeLS(), Blob }); await blocked.put(rec(10)); assert.equal((await blocked.wipe()).ok, true);
});
test('remove clears both stores; every method resolves (never rejects) even when the browser APIs throw', async () => {
  const bad = { open() { throw new Error('boom'); }, deleteDatabase() { throw new Error('boom'); } }, badLS = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
  const s = P.createStore({ indexedDB: bad, localStorage: badLS, Blob }); assert.equal((await s.put(rec(100))).ok, false); assert.equal(await s.get(), null); assert.equal((await s.info()).has, false); await assert.doesNotReject(() => s.remove()); await assert.doesNotReject(() => s.wipe());
});
test('base64 helper round-trips large binary data', () => { const b = bytes(100000); assert.deepEqual(Buffer.from(P.unb64(P.b64(b))), Buffer.from(b)); });

/* ----- settings persistence ----- */
test('cfg.notifSound / notifSoundName: default system, enum validated, name sanitized and capped', () => {
  assert.deepEqual([V.cfgOf({}).notifSound, V.cfgOf({}).notifSoundName], ['system', '']);
  for (const m of C.NOTIF_SOUNDS) assert.equal(V.cfgOf({ notifSound: m }).notifSound, m === 'tick' ? 'chime' : m); /* the tick is reserved for the countdown: an old saved choice becomes the chime */ for (const bad of ['evil', 5, null, {}, 'CUSTOM']) assert.equal(V.cfgOf({ notifSound: bad }).notifSound, 'system');
  assert.equal(V.cfgOf({ notifSoundName: ' ding<b>.mp3 ' }).notifSoundName, 'dingb.mp3'); /* markup characters removed */
  assert.equal(V.cfgOf({ notifSoundName: 'x'.repeat(500) }).notifSoundName.length, 80); assert.equal(V.cfgOf({ notifSoundName: 5 }).notifSoundName, '');
});
test('the audio itself is never part of saved data or backups; schema 7 and the key are unchanged; old data gets defaults', () => {
  const S = V.sanitize41(null); S.cfg.notifSound = 'custom'; S.cfg.notifSoundName = 'ding.mp3'; const json = JSON.stringify(V.makeBackup(S)); assert.ok(/"notifSound":"custom"/.test(json)); assert.ok(!/b64|blob|data:audio|RIFF|ID3/.test(json));
  const back = V.sanitize41(JSON.parse(JSON.stringify(S))); assert.equal(back.cfg.notifSound, 'custom'); assert.equal(back.v, 7); assert.equal(V.KEY, 'chronopulse:v4.1');
  const old = JSON.parse(JSON.stringify(V.sanitize41(null))); delete old.cfg.notifSound; delete old.cfg.notifSoundName; assert.equal(V.sanitize41(old).cfg.notifSound, 'system');
  assert.deepEqual(P.resolve(back.cfg, false), { mode: 'system', missing: true }, 'restoring such a backup on a device without the file falls back safely');
});
