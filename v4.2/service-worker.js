'use strict';
/* ChronoPulse 4.2 service worker.
   - Precaches the complete app shell + local assets under a versioned cache name (bump VERSION on every release).
   - Same-origin GET only. Cross-origin requests are never touched or cached. Nothing outside PRECACHE is ever stored.
   - Navigations are answered with the cached index.html (never a redirect), so offline launches cannot loop.
   - A new worker WAITS until the page asks it to take over (SKIP_WAITING), so updates never reload the app unexpectedly.
   - 4.2.5: background reminders. The page hands the SW a list of upcoming reminders (SCHEDULE); the SW stores it (IndexedDB), uses Notification Triggers where the browser has them,
     and otherwise delivers anything due whenever it wakes (Periodic Background Sync, push-less wake-ups, or the page). Never promised on browsers that cannot do it.
   - Only this 4.2 app's cache namespace (chronopulse-v4.2-*) is ever deleted. 4.1 caches (chronopulse-v4.1-*) and any other site/app cache are never touched. */
const VERSION = '4.2.7';
const CACHE_PREFIX = 'chronopulse-v4.2-';
const CACHE = CACHE_PREFIX + VERSION;
const PRECACHE = ['index.html', 'style.css', 'themes.css', 'theme-boot.js', 'lib/lib.js', 'lib/lib41.js', 'lib/lib42.js', 'lib/lib43.js', 'lib/lib44.js', 'lib/lib45.js', 'lib/lib46.js', 'lib/lib47.js', 'fx.js', 'sfx.js', 'script.js', 'focus-ui.js', 'reminders.js', 'cinema.js', 'notifsound.js', 'streak-ui.js', 'orbit.js', 'floaty.js', 'bgnotify.js', 'theme.js', 'insights-ui.js', 'pwa.js', 'manifest.json', 'doomsday-tick.mp3', 'assets/chime.wav',
  'assets/icons/icon-192.png', 'assets/icons/icon-512.png', 'assets/icons/icon-maskable-512.png', 'assets/icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  /* addAll is all-or-nothing: if any file fails the install fails, the old worker/cache keep running and the page reports it. */
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE.map(u => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith(CACHE_PREFIX) && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
    await deliverDue(); /* flush any reminder that came due while the worker was stopped */
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
  else if (d.type === 'SCHEDULE') e.waitUntil(setSchedule(d.list).then(r => { if (e.ports && e.ports[0]) e.ports[0].postMessage(r); }).catch(() => { if (e.ports && e.ports[0]) e.ports[0].postMessage({ stored: 0, triggers: false, error: true }); }));
  else if (d.type === 'CLEAR_SCHEDULE') e.waitUntil(setSchedule([]).then(() => { if (e.ports && e.ports[0]) e.ports[0].postMessage({ stored: 0 }); }));
  else if (d.type === 'FLUSH') e.waitUntil(deliverDue());
  else if (d.type === 'STATUS' && e.ports && e.ports[0]) {
    e.waitUntil(caches.open(CACHE).then(async c => { const missing = []; for (const u of PRECACHE) if (!(await c.match(u))) missing.push(u); e.ports[0].postMessage({ version: VERSION, cache: CACHE, complete: !missing.length, missing }); }).catch(() => e.ports[0].postMessage({ version: VERSION, cache: CACHE, complete: false, missing: ['(cache unreadable)'] })));
  }
});

/* Click-to-open. Event reminders carry data.eventId: an already-open window is focused and told (postMessage) which event to show; otherwise a new window
   opens at #event=<id>. The id is length-limited and URL-encoded, never trusted as a path. Notifications without an event id (focus/break/task) behave as in 4.1. */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const d = e.notification.data, id = d && typeof d.eventId === 'string' && d.eventId.length > 0 && d.eventId.length <= 60 ? d.eventId : '';
  const url = id ? './#event=' + encodeURIComponent(id) : './#focus';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const w = list.find(c => 'focus' in c);
    if (!w) return self.clients.openWindow(url);
    if (id) w.postMessage({ type: 'OPEN_EVENT', id });
    return Promise.resolve(w.focus()).catch(() => self.clients.openWindow(url)); /* if the browser refuses to focus the window, open it instead of failing silently */
  }));
});

/* ---------- 4.2.5 background reminders ----------
   The page sends { type: 'SCHEDULE', list: [{ id, tag, at, title, body, eventId }] } (already validated by CP47.buildSchedule). The SW keeps it in IndexedDB so it survives the worker being stopped.
   Delivery paths, best first:
   1. Notification Triggers (showTrigger + TimestampTrigger): the OS fires it even when the browser is closed. Chromium-only/experimental; used only when the constructor exists.
   2. periodicsync 'cp-reminders' (installed Chromium PWAs that were granted it) wakes the worker and delivers whatever is due.
   3. Any other wake-up (message, notification click, activate) also flushes due entries.
   A reminder is skipped when a ChronoPulse window is visible (the app shows its own in-app alert) and each tag can only show one notification (no stacking). */
const DB_NAME = 'chronopulse-sw', DB_STORE = 'kv', GRACE = 10 * 60e3, MAX_ITEMS = 40;
const idb = () => new Promise((ok, no) => { const r = indexedDB.open(DB_NAME, 1); r.onupgradeneeded = () => r.result.createObjectStore(DB_STORE); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
async function kvGet(k) { try { const db = await idb(); return await new Promise(ok => { const q = db.transaction(DB_STORE).objectStore(DB_STORE).get(k); q.onsuccess = () => { ok(q.result); db.close(); }; q.onerror = () => { ok(undefined); db.close(); }; }); } catch (e) { return undefined; } }
async function kvSet(k, v) { try { const db = await idb(); await new Promise((ok, no) => { const tx = db.transaction(DB_STORE, 'readwrite'); tx.objectStore(DB_STORE).put(v, k); tx.oncomplete = ok; tx.onerror = () => no(tx.error); tx.onabort = () => no(tx.error); }); db.close(); return true; } catch (e) { return false; } }
const cleanItem = e => (e && typeof e.id === 'string' && Number.isFinite(+e.at) ? { id: e.id.slice(0, 60), tag: String(e.tag || e.id).slice(0, 80), at: Math.floor(+e.at), title: String(e.title || 'ChronoPulse').slice(0, 80), body: String(e.body || '').slice(0, 140), eventId: e.eventId === '' ? '' : String(e.eventId || e.id).slice(0, 60) } : null);
const canTrigger = () => typeof TimestampTrigger === 'function' && 'showTrigger' in Notification.prototype;
const opts = e => ({ body: e.body, tag: e.tag, icon: 'assets/icons/icon-192.png', badge: 'assets/icons/icon-192.png', data: { eventId: e.eventId } });

async function setSchedule(raw) {
  const list = (Array.isArray(raw) ? raw : []).map(cleanItem).filter(Boolean).slice(0, MAX_ITEMS), old = (await kvGet('schedule')) || [];
  await kvSet('schedule', list);
  if (canTrigger() && self.registration.getNotifications) { /* replace OS-scheduled ones: drop what is no longer wanted, (re)schedule the rest under the same tag */
    try {
      const want = new Set(list.map(e => e.tag)); for (const n of await self.registration.getNotifications({ includeTriggered: true })) if (n.tag && /^cp-ev-|^cp-sch-/.test(n.tag) && !want.has(n.tag)) n.close();
      for (const e of list) await self.registration.showNotification(e.title, { ...opts(e), tag: e.tag, showTrigger: new TimestampTrigger(e.at) });
    } catch (x) { /* fall back to wake-up delivery */ }
  }
  return { stored: list.length, replaced: old.length, triggers: canTrigger() };
}
async function anyVisible() { try { return (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).some(c => c.visibilityState === 'visible'); } catch (e) { return false; } }
async function deliverDue() {
  const list = (await kvGet('schedule')) || [], now = Date.now(), due = [], keep = [];
  for (const e of list) { if (!e || !Number.isFinite(+e.at)) continue; if (+e.at <= now && now - +e.at <= GRACE) due.push(e); else if (+e.at > now) keep.push(e); }
  if (due.length === 0 && keep.length === list.length) return 0;
  await kvSet('schedule', keep);
  if (canTrigger() || await anyVisible()) return 0; /* OS-scheduled ones are already handled by the browser; a visible window shows its own alert */
  let n = 0; for (const e of due.slice(0, 3)) { try { await self.registration.showNotification(e.title, opts(e)); n++; } catch (x) { /* permission revoked */ } }
  if (due.length > 3) { try { await self.registration.showNotification('ChronoPulse reminders', { body: (due.length - 3) + ' more reminders came due.', tag: 'cp-sch-batch', icon: 'assets/icons/icon-192.png' }); } catch (x) { /* ignore */ } }
  return n;
}
self.addEventListener('periodicsync', e => { if (e.tag === 'cp-reminders') e.waitUntil(deliverDue()); });
