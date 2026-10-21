'use strict';
/* Reminder sound selector: static wiring, honesty and privacy guards. Real-browser behaviour: e2e/sound.e2e.py */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const html = read('index.html'), ns = read('notifsound.js'), rem = read('reminders.js'), script = read('script.js'), sw = read('service-worker.js');

test('every element id notifsound.js looks up exists in index.html', () => {
  const ids = new Set([...ns.matchAll(/\$\('#([A-Za-z][\w-]*)/g)].map(m => m[1])); assert.ok(ids.size >= 7); for (const id of ids) assert.ok(new RegExp(`id="${id}"`).test(html), 'missing #' + id);
});
test('the selector offers exactly the three alert choices (the doomsday tick is reserved for the countdown), in the Notifications card, with a file picker restricted to mp3/wav', () => {
  const sel = html.match(/<select id="nsSound"[\s\S]*?<\/select>/)[0]; assert.deepEqual([...sel.matchAll(/value="([^"]+)"/g)].map(m => m[1]), ['system', 'chime', 'custom']);
  for (const t of ['Default system sound', 'Chime', 'Custom sound (your file)']) assert.ok(sel.includes(t), t); assert.ok(!/Doomsday/.test(sel));
  assert.ok(html.indexOf('id="nsSound"') > html.indexOf('<h3>Notifications</h3>') && html.indexOf('id="nsSound"') < html.indexOf('<h3>App &amp; offline</h3>'));
  assert.ok(/<input type="file" id="nsFile" accept="\.mp3,\.wav,audio\/mpeg,audio\/wav,audio\/x-wav" hidden>/.test(html)); assert.ok(/id="nsSound"/.test(html) && /for="nsSound"/.test(html) && /id="nsPrev"[^>]*aria-label/.test(html) && /id="nsNote"[^>]*aria-live="polite"/.test(html));
});
test('delivery: reminders play the chosen sound only when the page is visible; the system notification path is unchanged and still only for a hidden page', () => {
  assert.ok(/visibilityState === 'visible' && X\.reminderSound\) X\.reminderSound\(en\)/.test(rem)); assert.ok(/visibilityState !== 'visible' && X\.notify\) X\.notify\(/.test(rem));
  assert.ok(/X\.alertSound = category => \{\s*try \{[\s\S]*?\} catch \(e\) \{ \/\* the reminder itself must always be delivered \*\/ \}/.test(ns)); assert.ok(/X\.reminderSound = \(\) => X\.alertSound\('reminder'\)/.test(ns)); assert.ok(/visible: document\.visibilityState === 'visible', masterOn: S\.sound/.test(ns)); assert.ok(/K\.gate\(gateState\[category\]/.test(ns));
});
test('no autoplay surprises: playback starts only from a reminder or a button the user pressed, and is capped to a short alert', () => {
  assert.equal((ns.match(/\bplay\(/g) || []).length >= 3, true); assert.ok(/K\.PLAY_CAP_MS/.test(ns)); assert.ok(!/autoplay|\.loop\s*=\s*true/.test(ns)); assert.ok(/NotAllowedError/.test(ns));
});
test('privacy: no network, no sending; the file is read locally; Reset all data wipes it; backups never include it', () => {
  assert.ok(!/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|importScripts|FormData)\b/.test(ns + read('lib/lib45.js'))); assert.ok(/X\.clearSound = /.test(ns) && /store\.wipe\(\)/.test(ns)); assert.ok(/if \(X\.clearSound\) X\.clearSound\(\)/.test(script));
  assert.ok(script.indexOf('X.clearSound()') < script.indexOf('S = CP41.sanitize41(null); selGoal = null'), 'wiped before state is replaced');
});
test('validation happens before saving, on content as well as name: size, format, decodability and length', () => {
  assert.ok(/K\.validateFile\(\{ name: file\.name, size: file\.size, type: file\.type \}, head\)/.test(ns)); assert.ok(/file\.slice\(0, 16\)/.test(ns)); assert.ok(/K\.MAX_SECONDS/.test(ns) && /could not play that file/.test(ns));
  assert.ok(ns.indexOf('K.validateFile') < ns.indexOf('await probe(file)') && ns.indexOf('await probe(file)') < ns.indexOf('store.put('));
});
test('honesty: the UI says a chosen sound plays only while the app is open, never claims background/locked custom audio, and the file name is rendered as text (not HTML)', () => {
  assert.ok(/plays only while ChronoPulse is open on screen/.test(html)); assert.ok(/phone's own notification sound is used, because a web app cannot change it/.test(html)); assert.ok(/never uploaded/.test(html));
  assert.ok(!/(sounds?|audio|beeps?|chime)[^.\n]{0,60}(plays?|works?)\s+(even\s+)?(when|while)\s+(the\s+)?(app\s+|phone\s+)?(is\s+)?(closed|locked|in the background)/i.test(ns.replace(/never[^.]*\./g, ''))); assert.ok(!/innerHTML/.test(ns)); assert.ok(/setT\(name,/.test(ns));
  assert.ok(!/silent\s*:\s*false|sound\s*:\s*['"]/.test(read('focus-ui.js').match(/function notify[\s\S]*?\n  }/)?.[0] || ''), 'no fake "sound" option on system notifications');
});
test('offline: lib/lib45.js and notifsound.js are loaded in order, precached and present; defaults (tick mp3, chime) are precached', () => {
  const order = [...html.matchAll(/<script defer src="([^"]+)"/g)].map(m => m[1]); assert.ok(order.indexOf('lib/lib45.js') > order.indexOf('lib/lib44.js') && order.indexOf('lib/lib45.js') < order.indexOf('script.js')); assert.ok(order.indexOf('notifsound.js') > order.indexOf('reminders.js') && order.indexOf('notifsound.js') > order.indexOf('cinema.js'));
  for (const f of ['lib/lib45.js', 'notifsound.js', 'doomsday-tick.mp3', 'assets/chime.wav']) { assert.ok(sw.includes(`'${f}'`), f); assert.ok(fs.existsSync(path.join(root, f)), f); }
});
