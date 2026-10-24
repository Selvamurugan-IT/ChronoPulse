'use strict';
/* Runs the real service-worker.js source in a sandbox with a fake `caches` object to prove cache isolation and install behaviour. */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');

function load(existing = [], wins = []) {
  const store = new Map(existing.map(n => [n, new Map()])), deleted = [], handlers = {}, claimed = { n: 0 }, opened = [];
  const cacheObj = name => ({ addAll: async reqs => { for (const r of reqs) store.get(name).set(r.url, 'x'); }, match: async u => (store.get(name).has(u.url || u) ? 'hit' : undefined) });
  const self = { addEventListener: (t, f) => { handlers[t] = f; }, location: { origin: 'https://example.github.io' }, clients: { claim: async () => { claimed.n++; }, matchAll: async () => wins, openWindow: async u => { opened.push(u); } }, skipWaiting() {} };
  const caches = { open: async n => { if (!store.has(n)) store.set(n, new Map()); return cacheObj(n); }, keys: async () => [...store.keys()], delete: async n => { deleted.push(n); return store.delete(n); }, match: async () => undefined };
  const ctx = vm.createContext({ self, caches, Request: class { constructor(u, o) { this.url = u; this.opts = o; } }, Response: class {}, URL, encodeURIComponent, fetch: async () => ({}), MessageChannel });
  const info = vm.runInContext(src + '\n;({ VERSION, CACHE_PREFIX, CACHE, PRECACHE })', ctx);
  const fire = async type => { let p; handlers[type]({ waitUntil: x => { p = x; } }); await p; };
  const click = async data => { let closed = 0, p; handlers.notificationclick({ notification: { data, close: () => { closed++; } }, waitUntil: x => { p = x; } }); await p; return closed; };
  return { info, store, deleted, claimed, fire, click, opened, handlers };
}

test('cache namespace is the 4.2 one and the current cache name is prefix + version', () => {
  const { info } = load(); assert.equal(info.VERSION, '4.2.8'); assert.equal(info.CACHE_PREFIX, 'chronopulse-v4.2-'); assert.equal(info.CACHE, 'chronopulse-v4.2-4.2.8');
});
test('install precaches exactly the PRECACHE list into the current cache only', async () => {
  const t = load(['chronopulse-v4.1-4.1.0']); await t.fire('install');
  assert.deepEqual([...t.store.get(t.info.CACHE).keys()].sort(), [...t.info.PRECACHE].sort()); assert.equal(t.store.get('chronopulse-v4.1-4.1.0').size, 0, '4.1 cache untouched');
});
test('activate deletes only OLDER 4.2 caches — never 4.1 caches, other apps, or non-matching names', async () => {
  const keep = ['chronopulse-v4.1-4.1.0', 'chronopulse-v4.1-4.1.1', 'chronopulse-v4.2-4.2.8', 'other-app-v1', 'workbox-precache-v2', 'chronopulse:v4.1', 'chronopulse-v4.20-x', 'my-chronopulse-v4.2-1'];
  const t = load([...keep, 'chronopulse-v4.2-4.2.0', 'chronopulse-v4.2-4.2.1', 'chronopulse-v4.2-4.2.2', 'chronopulse-v4.2-4.2.3', 'chronopulse-v4.2-4.2.5', 'chronopulse-v4.2-4.2.6', 'chronopulse-v4.2-4.2.7', 'chronopulse-v4.2-4.0.0']); await t.fire('activate');
  assert.deepEqual(t.deleted.sort(), ['chronopulse-v4.2-4.0.0', 'chronopulse-v4.2-4.2.0', 'chronopulse-v4.2-4.2.1', 'chronopulse-v4.2-4.2.2', 'chronopulse-v4.2-4.2.3', 'chronopulse-v4.2-4.2.5', 'chronopulse-v4.2-4.2.6', 'chronopulse-v4.2-4.2.7'], 'every older 4.2 cache is cleaned up');
  for (const k of keep) assert.ok(t.store.has(k), 'must survive: ' + k); assert.equal(t.claimed.n, 1);
});
test('activate with no old caches deletes nothing', async () => { const t = load(['chronopulse-v4.2-4.2.8']); await t.fire('activate'); assert.deepEqual(t.deleted, []); });
test('service worker never writes to localStorage-style data keys or touches cross-origin requests', () => {
  assert.ok(!/localStorage/.test(src)); assert.ok([...src.matchAll(/indexedDB\.open\('([^']+)'/g)].every(m => m[1] === 'chronopulse-sw'), 'the worker only ever opens its own small IndexedDB (the reminder schedule), never the app data'); assert.ok(!/chronopulse:v4\.1/.test(src)); assert.ok(/url\.origin !== self\.location\.origin\) return/.test(src));
});

const win = () => { const w = { focused: 0, messages: [], focus() { w.focused++; return Promise.resolve(w); }, postMessage(m) { w.messages.push(m); } }; return w; };
test('notification click: event reminder + open window -> window is focused and told which event to open', async () => {
  const w = win(), t = load([], [w]); const closed = await t.click({ eventId: 'ab1', key: 'h1' });
  assert.equal(closed, 1, 'notification closed'); assert.equal(w.focused, 1); assert.equal(JSON.stringify(w.messages), JSON.stringify([{ type: 'OPEN_EVENT', id: 'ab1' }])); /* JSON compare: the object was created inside the vm sandbox */ assert.deepEqual(t.opened, []);
});
test('notification click: event reminder + no open window -> opens #event=<id>', async () => {
  const t = load([], []); await t.click({ eventId: 'ab1', key: 'end' }); assert.deepEqual(t.opened, ['./#event=ab1']);
});
test('notification click: the event id is URL-encoded and length-limited, never trusted as a path', async () => {
  const t = load([], []); await t.click({ eventId: '../../x?y=1#z' }); assert.deepEqual(t.opened, ['./#event=..%2F..%2Fx%3Fy%3D1%23z']);
  for (const bad of [{ eventId: 'x'.repeat(61) }, { eventId: '' }, { eventId: 42 }, { eventId: { a: 1 } }, {}, null, undefined, 'str']) { const t2 = load([], []); await t2.click(bad); assert.deepEqual(t2.opened, ['./#focus'], JSON.stringify(bad)); }
});
test('notification click: focus/break/task notifications (no event id) behave exactly as in 4.1', async () => {
  const w = win(), t = load([], [w]); await t.click(undefined); assert.equal(w.focused, 1); assert.deepEqual(w.messages, [], 'no OPEN_EVENT message'); assert.deepEqual(t.opened, []);
  const t2 = load([], []); await t2.click(undefined); assert.deepEqual(t2.opened, ['./#focus']);
});
test('notification click: a client that cannot be focused is skipped', async () => {
  const t = load([], [{ postMessage() {} }]); await t.click({ eventId: 'a' }); assert.deepEqual(t.opened, ['./#event=a']);
});
test('the service worker has NO push handler; background reminders are scheduled only through feature-detected, honest paths (triggers, periodic sync, wake-ups)', () => {
  const t = load(); assert.ok(!('push' in t.handlers)); assert.ok(!('sync' in t.handlers)); assert.ok('periodicsync' in t.handlers); assert.ok('notificationclick' in t.handlers);
  assert.ok(!/pushManager|PushEvent/.test(src)); assert.ok(/typeof TimestampTrigger === 'function' && 'showTrigger' in Notification\.prototype/.test(src), 'triggers are used only when the browser really has them');
  assert.ok(/e\.tag === 'cp-reminders'/.test(src));
});
test('background reminders: SCHEDULE / CLEAR_SCHEDULE / FLUSH are handled by the one message listener alongside SKIP_WAITING and STATUS', () => {
  for (const k of ["'SKIP_WAITING'", "'STATUS'", "'SCHEDULE'", "'CLEAR_SCHEDULE'", "'FLUSH'"]) assert.ok(src.includes(k), k); assert.equal((src.match(/addEventListener\('message'/g) || []).length, 1); assert.equal((src.match(/addEventListener\('activate'/g) || []).length, 1);
});
test('notification click: if the browser refuses to focus the window, the app opens it instead of failing silently', async () => {
  const w = { messages: [], focus: () => Promise.reject(new Error('Not allowed to focus a window')), postMessage(m) { w.messages.push(m); } }, t = load([], [w]);
  await t.click({ eventId: 'ab1' }); assert.deepEqual(t.opened, ['./#event=ab1']); assert.equal(w.messages.length, 1, 'the open window was still told which event to show');
});
