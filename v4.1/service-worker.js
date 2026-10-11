'use strict';
/* ChronoPulse 4.1 service worker.
   - Precaches the complete app shell + local assets under a versioned cache name (bump VERSION on every release).
   - Same-origin GET only. Cross-origin requests are never touched or cached. Nothing outside PRECACHE is ever stored.
   - Navigations are answered with the cached index.html (never a redirect), so offline launches cannot loop.
   - A new worker WAITS until the page asks it to take over (SKIP_WAITING), so updates never reload the app unexpectedly.
   - Only this 4.1 app's cache namespace is ever deleted; older versions' caches are left untouched. */
const VERSION = '4.1.0';
const CACHE_PREFIX = 'chronopulse-v4.1-';
const CACHE = CACHE_PREFIX + VERSION;
const PRECACHE = ['index.html', 'style.css', 'lib.js', 'lib41.js', 'fx.js', 'script.js', 'focus-ui.js', 'pwa.js', 'manifest.json', 'doomsday-tick.mp3', 'assets/chime.wav',
  'assets/icons/icon-192.png', 'assets/icons/icon-512.png', 'assets/icons/icon-maskable-512.png', 'assets/icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  /* addAll is all-or-nothing: if any file fails the install fails, the old worker/cache keep running and the page reports it. */
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE.map(u => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith(CACHE_PREFIX) && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

const OFFLINE_HTML = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ChronoPulse</title><body style="font:16px system-ui;background:#0a0d14;color:#e8eef7;padding:2rem"><h1>ChronoPulse can\'t start offline yet</h1><p>The app files are not saved on this device yet. Open ChronoPulse once while online, then it will work offline.</p>';

/* Media elements ask for byte ranges; a cached 200 response must be turned into 206 or looping/seeking can fail (notably on Safari). */
async function ranged(req, res) {
  const h = req.headers.get('range'); if (!h || !res || res.status !== 200) return res;
  const m = /^bytes=(\d*)-(\d*)$/.exec(h); if (!m || (m[1] === '' && m[2] === '')) return res;
  const buf = await res.arrayBuffer(), size = buf.byteLength; let s, e;
  if (m[1] === '') { s = Math.max(0, size - Number(m[2])); e = size - 1; } else { s = Number(m[1]); e = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1; }
  if (s > e || s >= size) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
  return new Response(buf.slice(s, e + 1), { status: 206, statusText: 'Partial Content', headers: { 'Content-Type': res.headers.get('Content-Type') || 'audio/mpeg', 'Content-Range': `bytes ${s}-${e}/${size}`, 'Content-Length': String(e - s + 1), 'Accept-Ranges': 'bytes' } });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; /* cross-origin: browser handles it, we never cache it */
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('index.html', { cacheName: CACHE }).then(hit => hit || fetch(req).catch(() => new Response(OFFLINE_HTML, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }))));
    return;
  }
  e.respondWith(caches.match(req, { cacheName: CACHE, ignoreSearch: true }).then(async hit => hit ? ranged(req, hit) : fetch(req)));
});

self.addEventListener('message', e => {
  const d = e.data || {};
  if (d.type === 'SKIP_WAITING') self.skipWaiting();
  else if (d.type === 'STATUS' && e.ports && e.ports[0]) {
    e.waitUntil(caches.open(CACHE).then(async c => { const missing = []; for (const u of PRECACHE) if (!(await c.match(u))) missing.push(u); e.ports[0].postMessage({ version: VERSION, cache: CACHE, complete: !missing.length, missing }); }).catch(() => e.ports[0].postMessage({ version: VERSION, cache: CACHE, complete: false, missing: ['(cache unreadable)'] })));
  }
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => { const w = list.find(c => 'focus' in c); return w ? w.focus() : self.clients.openWindow('./#focus'); }));
});
