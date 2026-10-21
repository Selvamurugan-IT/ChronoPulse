'use strict';
/* GitHub Pages project-site hosting (https://username.github.io/repository-name/): everything must be relative, scoped to the subfolder, and case-exact. Runs the real service worker. */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const ORIGIN = 'https://username.github.io', BASE = ORIGIN + '/repository-name/', SWURL = BASE + 'service-worker.js';
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.name === '.git' || e.name === 'node_modules' ? [] : e.isDirectory() ? walk(path.join(d, e.name)).map(x => e.name + '/' + x) : [e.name]);

function loadSW() {
  const handlers = {}, added = [], opened = [], opens = [], matched = [];
  const cache = { addAll: async reqs => { for (const r of reqs) added.push(r.url); }, match: async () => undefined };
  const caches = { open: async n => { opened.push(n); return cache; }, keys: async () => [], delete: async () => true, match: async (req, opt) => { matched.push([typeof req === 'string' ? req : req.url, opt]); return new Response('<html>shell</html>', { status: 200 }); } };
  const self = { addEventListener: (t, f) => { handlers[t] = f; }, location: new URL(SWURL), clients: { matchAll: async () => [], openWindow: async u => { opens.push(u); }, claim: async () => {} }, skipWaiting() {} };
  class SWRequest extends Request { constructor(u, o) { super(typeof u === 'string' ? new URL(u, SWURL).href : u, o); } } /* a real worker resolves relative URLs against its own location */
  const ctx = vm.createContext({ self, caches, Request: SWRequest, Response, Headers, URL, fetch: async () => { throw new TypeError('offline'); }, MessageChannel, encodeURIComponent });
  const info = vm.runInContext(read('service-worker.js') + '\n;({ VERSION, CACHE, PRECACHE })', ctx);
  return { info, handlers, added, opened, opens, matched };
}
const waitUntil = async (h, ev) => { let p; await h({ ...ev, waitUntil: x => { p = x; } }); return p; };

test('manifest: id, start_url, scope, icons and shortcuts are all relative (no leading slash, no absolute URL)', () => {
  const m = JSON.parse(read('manifest.json')); assert.equal(m.start_url, './'); assert.equal(m.scope, './'); assert.equal(m.id, './');
  const urls = [m.start_url, m.scope, m.id, ...m.icons.map(i => i.src), ...m.shortcuts.map(s => s.url), ...m.shortcuts.flatMap(s => (s.icons || []).map(i => i.src))];
  for (const u of urls) { assert.ok(!/^(\/|[a-z]+:)/i.test(u), u); const abs = new URL(u, BASE + 'manifest.json'); assert.ok(abs.href.startsWith(BASE), `${u} -> ${abs.href}`); }
});
test('index.html: every src/href is relative (or a fragment/data URI) and resolves inside the repository folder', () => {
  const html = read('index.html'); const refs = [...html.matchAll(/\b(?:src|href)="([^"]*)"/g)].map(m => m[1]).filter(u => u && !u.startsWith('#') && !u.startsWith('data:'));
  assert.ok(refs.length > 10); for (const u of refs) { assert.ok(!/^(\/|[a-z]+:)/i.test(u), 'absolute: ' + u); assert.ok(new URL(u, BASE + 'index.html').href.startsWith(BASE), u); }
});
test('scripts never use root-absolute or hard-coded origin URLs', () => {
  for (const f of ['pwa.js', 'script.js', 'focus-ui.js', 'reminders.js', 'cinema.js', 'notifsound.js', 'streak-ui.js', 'service-worker.js']) { const s = read(f); assert.ok(!/(register|fetch|Audio|openWindow|import)\(\s*['"`]\/(?!\/)/.test(s), f + ' uses a root-absolute path'); assert.ok(!/https?:\/\/[a-z0-9.-]+\.github\.io/i.test(s), f + ' hard-codes a Pages URL'); }
  assert.ok(/register\('service-worker\.js', \{ scope: '\.\/'/.test(read('pwa.js')), 'registered relative to the page, scope = the page folder');
});
test('service worker under /repository-name/: every precached URL is inside the subfolder, unique, and the cache is created', async () => {
  const t = loadSW(); await waitUntil(t.handlers.install, {}); assert.deepEqual(t.opened, [t.info.CACHE]); assert.equal(t.added.length, t.info.PRECACHE.length); assert.equal(new Set(t.added).size, t.added.length);
  for (const u of t.added) assert.ok(u.startsWith(BASE), `${u} escapes ${BASE}`); assert.ok(t.added.includes(BASE + 'doomsday-tick.mp3') && t.added.includes(BASE + 'assets/chime.wav') && t.added.includes(BASE + 'index.html'));
  for (const f of t.info.PRECACHE) assert.ok(!/^(\/|[a-z]+:)/i.test(f), f);
});
test('navigation inside the subfolder is answered with the cached index.html from OUR cache (no redirects, no network)', async () => {
  const t = loadSW(); let q; t.handlers.fetch({ request: { method: 'GET', url: BASE + '#event=1', mode: 'navigate', headers: new Headers() }, respondWith: x => { q = x; } });
  const r = await q; assert.equal(r.status, 200); assert.equal(JSON.stringify(t.matched.at(-1)), JSON.stringify(['index.html', { cacheName: t.info.CACHE }]));
  let other; t.handlers.fetch({ request: { method: 'GET', url: 'https://other.example/x.js', mode: 'cors', headers: new Headers() }, respondWith: x => { other = x; } }); assert.equal(other, undefined, 'cross-origin requests are never touched');
});
test('notification click opens the app inside the subfolder, not the domain root', async () => {
  const t = loadSW(); for (const [data, expect] of [[{ eventId: 'abc 1' }, BASE + '#event=abc%201'], [null, BASE + '#focus']]) {
    t.opens.length = 0; let closed = false; await waitUntil(t.handlers.notificationclick, { notification: { close() { closed = true; }, data } }); assert.ok(closed); assert.equal(t.opens.length, 1);
    assert.equal(new URL(t.opens[0], SWURL).href, expect); assert.ok(new URL(t.opens[0], SWURL).pathname.startsWith('/repository-name/'));
  }
});
test('Pages is case-sensitive: every file the app references exists with EXACTLY that capitalisation', () => {
  const files = new Set(walk(root)); const html = read('index.html'), sw = read('service-worker.js');
  const refs = new Set([...html.matchAll(/\b(?:src|href)="([^"#?]+)[^"]*"/g)].map(m => m[1]).filter(u => !/^(data:|[a-z]+:)/i.test(u)));
  for (const f of eval(sw.match(/const PRECACHE = (\[[\s\S]*?\]);/)[1])) refs.add(f);
  for (const r of refs) assert.ok(files.has(r) || r === './', `missing or wrong case: ${r}`);
});
test('Pages hygiene: .nojekyll present, no spaces in file names, nothing the Jekyll default would hide is needed, no huge files', () => {
  assert.ok(fs.existsSync(path.join(root, '.nojekyll'))); const files = walk(root);
  for (const f of files) { assert.ok(!/\s/.test(f), 'space in ' + f); if (!f.startsWith('tests/') && !f.startsWith('e2e/') && !f.startsWith('docs/')) assert.ok(!/(^|\/)[_.]/.test(f) || (f === '.nojekyll' || f === '.gitignore'), 'hidden/underscore path: ' + f); assert.ok(fs.statSync(path.join(root, f)).size < 25e6, f); }
});
test('shell is precached together with every audio file the app can play, so offline never needs the network', () => {
  const t = loadSW(); for (const f of ['index.html', 'doomsday-tick.mp3', 'assets/chime.wav', 'lib/lib44.js', 'lib/lib45.js', 'notifsound.js', 'streak-ui.js', 'manifest.json']) assert.ok(t.info.PRECACHE.includes(f), f);
  const html = read('index.html'); for (const m of html.matchAll(/<script defer src="([^"]+)"/g)) assert.ok(t.info.PRECACHE.includes(m[1]), m[1]);
});
