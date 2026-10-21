'use strict';
/* Offline audio: both audio files are precached, and a cached 200 is served as a correct 206 for Range requests (media elements need it, notably Safari). Runs the real service-worker.js. */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), src = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
const MP3 = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));

function load({ offline = true, base = '', files = { 'doomsday-tick.mp3': MP3, 'assets/chime.wav': MP3 } } = {}) {
  const handlers = {}, calls = { fetch: 0, match: [] };
  const mk = n => new Response(files[n], { status: 200, headers: { 'Content-Type': n.endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav' } });
  const caches = { open: async () => ({}), keys: async () => [], delete: async () => true,
    match: async (req, opt) => { const u = new URL(typeof req === 'string' ? req : req.url), n = decodeURIComponent(u.pathname.replace(base ? new RegExp('^' + base) : /^\//, '').replace(/^\//, '')); calls.match.push(opt); return files[n] ? mk(n) : undefined; } };
  const self = { addEventListener: (t, f) => { handlers[t] = f; }, location: { origin: 'https://x.github.io' }, clients: {}, skipWaiting() {} };
  const ctx = vm.createContext({ self, caches, Request, Response, Headers, URL, fetch: async () => { calls.fetch++; if (offline) throw new TypeError('offline'); return new Response('net'); }, MessageChannel, encodeURIComponent });
  const info = vm.runInContext(src + '\n;({ VERSION, CACHE, PRECACHE })', ctx);
  const get = async (name, range) => { const req = new Request('https://x.github.io' + base + '/' + name, { headers: range ? { Range: range } : {} }); let p; handlers.fetch({ request: req, respondWith: x => { p = x; } }); return p ? await p : undefined; };
  return { info, get, calls };
}

test('doomsday-tick.mp3 and assets/chime.wav are explicitly precached (and exist on disk)', () => {
  const { info } = load(); for (const f of ['doomsday-tick.mp3', 'assets/chime.wav']) { assert.ok(info.PRECACHE.includes(f), f); assert.ok(fs.existsSync(path.join(root, f)), f); }
});
test('offline: a plain request for each audio file is answered from the cache, never the network', async () => {
  const t = load(); for (const f of ['doomsday-tick.mp3', 'assets/chime.wav']) { const r = await t.get(f); assert.equal(r.status, 200); assert.equal((await r.arrayBuffer()).byteLength, 1000); } assert.equal(t.calls.fetch, 0);
});
test('Range: bytes=0-99 -> 206 with the exact slice, Content-Range, Content-Length and Accept-Ranges', async () => {
  const r = await load().get('doomsday-tick.mp3', 'bytes=0-99'); assert.equal(r.status, 206); assert.equal(r.headers.get('Content-Range'), 'bytes 0-99/1000'); assert.equal(r.headers.get('Content-Length'), '100'); assert.equal(r.headers.get('Accept-Ranges'), 'bytes'); assert.equal(r.headers.get('Content-Type'), 'audio/mpeg');
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), MP3.subarray(0, 100));
});
test('Range: open-ended (bytes=900-), suffix (bytes=-10) and end past EOF are clamped correctly', async () => {
  const t = load(); let r = await t.get('doomsday-tick.mp3', 'bytes=900-'); assert.equal(r.status, 206); assert.equal(r.headers.get('Content-Range'), 'bytes 900-999/1000'); assert.deepEqual(Buffer.from(await r.arrayBuffer()), MP3.subarray(900));
  r = await t.get('doomsday-tick.mp3', 'bytes=-10'); assert.equal(r.headers.get('Content-Range'), 'bytes 990-999/1000'); assert.equal((await r.arrayBuffer()).byteLength, 10);
  r = await t.get('doomsday-tick.mp3', 'bytes=950-5000'); assert.equal(r.headers.get('Content-Range'), 'bytes 950-999/1000');
});
test('Range: a start beyond the file gives 416 with the size; malformed Range falls back to the full 200', async () => {
  const t = load(); let r = await t.get('doomsday-tick.mp3', 'bytes=5000-6000'); assert.equal(r.status, 416); assert.equal(r.headers.get('Content-Range'), 'bytes */1000');
  for (const bad of ['bytes=-', 'items=0-5', 'bytes=a-b']) { r = await t.get('doomsday-tick.mp3', bad); assert.equal(r.status, 200, bad); }
});
test('Range works for the chime too, and the cache lookup ignores a ?query so cache-busting URLs still work offline', async () => {
  const t = load(); const r = await t.get('assets/chime.wav?v=1', 'bytes=0-9'); assert.equal(r.status, 206); assert.equal(r.headers.get('Content-Type'), 'audio/wav'); assert.ok(t.calls.match.every(o => o && o.ignoreSearch === true && /^chronopulse-v4\.2-/.test(o.cacheName)));
});
test('an audio file that is NOT cached falls through to the network (and fails cleanly offline, never a fake 200)', async () => {
  const t = load({ files: { 'assets/chime.wav': MP3 } }); await assert.rejects(() => t.get('doomsday-tick.mp3', 'bytes=0-9')); assert.equal(t.calls.fetch, 1);
});

test('GitHub Pages subfolder (https://x.github.io/repository-name/): Range requests are answered from the cache with correct 206 replies, offline', async () => {
  const t = load({ base: '/repository-name' }); const full = await t.get('doomsday-tick.mp3'); assert.equal(full.status, 200);
  for (const f of ['doomsday-tick.mp3', 'assets/chime.wav']) { const r = await t.get(f, 'bytes=100-199'); assert.equal(r.status, 206, f); assert.equal(r.headers.get('Content-Range'), 'bytes 100-199/1000'); assert.equal(r.headers.get('Accept-Ranges'), 'bytes'); assert.deepEqual(Buffer.from(await r.arrayBuffer()), MP3.subarray(100, 200)); }
  assert.equal(t.calls.fetch, 0, 'no network used');
});
