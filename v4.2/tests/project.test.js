'use strict';
/* Static integrity checks: syntax, manifest, script order, and that everything the page needs is in the offline precache list. */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8'), exists = f => fs.existsSync(path.join(root, f));
const JS = ['theme-boot.js', 'lib/lib.js', 'lib/lib41.js', 'lib/lib42.js', 'lib/lib43.js', 'lib/lib44.js', 'lib/lib45.js', 'lib/lib46.js', 'lib/lib47.js', 'fx.js', 'sfx.js', 'script.js', 'focus-ui.js', 'reminders.js', 'cinema.js', 'notifsound.js', 'orbit.js', 'streak-ui.js', 'floaty.js', 'bgnotify.js', 'theme.js', 'insights-ui.js', 'pwa.js', 'service-worker.js'];
const precache = () => eval(read('service-worker.js').match(/const PRECACHE = (\[[\s\S]*?\]);/)[1]);

for (const f of JS) test(`syntax: node --check ${f}`, () => { execFileSync(process.execPath, ['--check', path.join(root, f)], { stdio: 'pipe' }); });

test('manifest.json is valid and its icons exist', () => {
  const m = JSON.parse(read('manifest.json')); assert.ok(m.icons.length >= 3); for (const i of m.icons) assert.ok(exists(i.src), i.src);
});
test('index.html loads scripts in dependency order, with lib/lib42.js, lib/lib43.js and lib/lib44.js before script.js', () => {
  const order = [...read('index.html').matchAll(/<script defer src="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(order, ['lib/lib.js', 'lib/lib41.js', 'lib/lib42.js', 'lib/lib43.js', 'lib/lib44.js', 'lib/lib45.js', 'lib/lib46.js', 'lib/lib47.js', 'fx.js', 'sfx.js', 'script.js', 'focus-ui.js', 'reminders.js', 'cinema.js', 'notifsound.js', 'orbit.js', 'streak-ui.js', 'floaty.js', 'bgnotify.js', 'theme.js', 'insights-ui.js', 'pwa.js']);
});
test('every local file index.html references exists', () => {
  for (const m of read('index.html').matchAll(/(?:src|href)="([^"#:]+?)"/g)) if (!m[1].startsWith('data')) assert.ok(exists(m[1]), m[1]);
});
test('precache list: every entry exists, no duplicates, and covers everything the page loads', () => {
  const list = precache(); assert.equal(new Set(list).size, list.length);
  for (const f of list) assert.ok(exists(f), 'missing on disk: ' + f);
  const needed = [...read('index.html').matchAll(/(?:src|href)="([^"#:]+?)"/g)].map(m => m[1]).filter(u => !u.startsWith('data'));
  for (const f of needed) assert.ok(list.includes(f), 'not precached: ' + f);
  for (const f of ['lib/lib42.js', 'reminders.js', 'doomsday-tick.mp3', 'assets/chime.wav']) assert.ok(list.includes(f), f);
});
test('script.js no longer keeps completion in memory only', () => {
  const s = read('script.js'); assert.ok(!/\bcelebrated\b/.test(s)); assert.ok(!/\blastLeft\b/.test(s)); assert.ok(/CP42\.reconcile/.test(s) && /CP42\.isCompleted/.test(s));
});
test('reconciliation is wired to boot, resume (visibilitychange), bfcache restore (pageshow) and the periodic check', () => {
  const s = read('script.js');
  assert.ok(/function boot\(\) \{ reconcileNow\(\)/.test(s)); assert.ok(/visibilitychange', \(\) => \{[^}]*reconcileNow\(\)/.test(s)); assert.ok(/addEventListener\('pageshow'/.test(s)); assert.ok(/setInterval\(\(\) => \{\s*if \(document\.hidden\) return;\s*reconcileNow\(\)/.test(s));
});
test('no listener or timer is registered more than once for the new reconcile hooks', () => {
  const s = read('script.js'); assert.equal((s.match(/addEventListener\('pageshow'/g) || []).length, 1); assert.equal((s.match(/setInterval\(/g) || []).length, 1);
});

/* ---------- Phase 2 guards ---------- */
const APP_JS = ['lib/lib.js', 'lib/lib41.js', 'lib/lib42.js', 'lib/lib43.js', 'lib/lib44.js', 'lib/lib45.js', 'lib/lib46.js', 'lib/lib47.js', 'fx.js', 'sfx.js', 'script.js', 'focus-ui.js', 'reminders.js', 'cinema.js', 'notifsound.js', 'orbit.js', 'streak-ui.js', 'floaty.js', 'bgnotify.js', 'theme.js', 'insights-ui.js', 'pwa.js'];
test('privacy: no app script can send data anywhere (no fetch / XHR / beacon / WebSocket / external scripts)', () => {
  for (const f of APP_JS) assert.ok(!/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts)\b/.test(read(f)), f);
  assert.ok(!/<script[^>]+src="https?:/i.test(read('index.html')), 'no external scripts'); assert.ok(!/<link[^>]+href="https?:/i.test(read('index.html')), 'no external stylesheets');
});
test('no push machinery or push claims exist in the app (it is local-only)', () => {
  for (const f of [...APP_JS, 'service-worker.js']) assert.ok(!/pushManager|PushSubscription|applicationServerKey|VAPID/i.test(read(f)), f);
});
test('no secrets, private keys or environment files are in the project', () => {
  const walk = d => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap(e => e.isDirectory() ? (['tests', 'node_modules', 'docs'].includes(e.name) && d === '.' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]);
  const files = walk('.').map(f => f.replace(/^\.[\\/]/, ''));
  for (const f of files) { assert.ok(!/(^|[\\/])\.env|\.pem$|\.key$|id_rsa|serviceAccount|credentials\.json/i.test(f), 'sensitive file name: ' + f); }
  for (const f of files.filter(f => /\.(js|html|json|css|md|txt)$/.test(f))) assert.ok(!/-----BEGIN [A-Z ]*PRIVATE KEY-----|private[_ -]?key\s*[:=]|api[_-]?key\s*[:=]|secret\s*[:=]|\bBearer\s+[A-Za-z0-9._-]{20,}/i.test(read(f)), 'possible secret in ' + f);
});
test('event dialog has one accessible checkbox per reminder, in the specified order, plus a live status line', () => {
  const html = read('index.html'), keys = [...html.matchAll(/<input type="checkbox" data-rem="([a-z0-9]+)"/g)].map(m => m[1]);
  assert.deepEqual(keys, ['d1', 'h1', 'm10', 'm1', 'end']); assert.ok(/<fieldset[^>]*id="eRem"[^>]*><legend>Reminders<\/legend>/.test(html));
  for (const l of ['24 hours before', '1 hour before', '10 minutes before', '1 minute before', 'At completion']) assert.ok(html.includes(`<span>${l}</span>`), l);
  assert.ok(/id="eRemNote" aria-live="polite"/.test(html)); assert.ok(/id="nHide"[^>]*role="switch"[^>]*aria-label=/.test(html));
});
test('settings text is honest: no server, closed-app alerts not guaranteed, calendar suggested', () => {
  const html = read('index.html'); assert.ok(/cannot wake a closed app/.test(html)); assert.ok(/never guaranteed/.test(html)); assert.ok(/calendar/.test(html)); assert.ok(!/guarantee[sd]? (delivery|notification|alarm)/i.test(html.replace(/never guaranteed/g, '')));
  assert.ok(/never guaranteed/.test(read('focus-ui.js')) && /Nothing is sent to any server/.test(read('focus-ui.js')));
});
test('wiring: click-to-open, reminder runner, permission flow and scheduling are connected', () => {
  const s = read('script.js'), f = read('focus-ui.js'), r = read('reminders.js');
  assert.ok(/function openEventById/.test(s) && /type === 'OPEN_EVENT'/.test(s) && /routeEventHash\(\); \}/.test(s) && /popstate', \(\) => \{ if \(!routeEventHash\(\)\)/.test(s));
  assert.ok(/X\.runReminders\) X\.runReminders\(\)/.test(s)); assert.ok(/X\.runReminders = run/.test(r));
  assert.ok(/if \(data\) o\.data = data/.test(f) && /X\.notify = notify/.test(f));
  assert.ok(/Notification\.requestPermission\(\)/.test(f)); assert.equal((f.match(/requestPermission/g) || []).length, 1, 'permission is requested in exactly one place (after the explanation dialog)');
  assert.ok(/'serviceWorker' in navigator/.test(f) && /else new Notification\(title, o\)/.test(f), 'service-worker notification with a fallback');
});
test('no duplicate loops: reminders.js owns one timer and no interval; focus-ui.js timers are unchanged', () => {
  const r = read('reminders.js'); assert.equal((r.match(/setInterval\(/g) || []).length, 0); assert.equal((r.match(/setTimeout\(/g) || []).length, 1); assert.equal((r.match(/clearTimeout\(/g) || []).length, 1);
  assert.equal((read('focus-ui.js').match(/setInterval\(/g) || []).length, 2, 'uiTick + checkReminders, as in 4.1'); assert.equal((read('script.js').match(/setInterval\(/g) || []).length, 1);
});
test('system notifications are only requested when the app is not on screen (the in-app banner is always shown)', () => {
  const r = read('reminders.js'); assert.ok(/X\.banner\('remev-' \+ en\.id/.test(r)); assert.ok(/document\.visibilityState !== 'visible' && X\.notify/.test(r));
});
