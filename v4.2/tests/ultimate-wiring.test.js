'use strict';
/* 4.2.5 Ultimate additions: static wiring, accessibility hooks and offline precache for the rocket, floating stopwatch, orbit, background reminders, sound hub, charts and themes.
   Real-browser behaviour is covered by e2e/ultimate2.e2e.py. */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8'), html = read('index.html'), sw = read('service-worker.js');
const precache = eval(sw.match(/const PRECACHE = (\[[\s\S]*?\]);/)[1]);

test('every new script is loaded by index.html, precached for offline use and present on disk', () => {
  for (const f of ['lib/lib47.js', 'orbit.js', 'floaty.js', 'bgnotify.js']) { assert.ok(fs.existsSync(path.join(root, f)), f); assert.ok(precache.includes(f), 'precache ' + f); assert.ok(html.includes(`<script defer src="${f}"></script>`), 'html ' + f); }
  assert.ok(html.indexOf('lib/lib47.js') < html.indexOf('script.js') && html.indexOf('orbit.js') < html.indexOf('streak-ui.js'));
});
test('rocket: big layout from CP47, fire + smoke + blast + confetti stages, hard particle caps, self-stopping loop, reduced motion unchanged', () => {
  const c = read('cinema.js'); assert.ok(/CP47\.rocketLayout/.test(c)); for (const k of ['fire', 'smoke', 'conf', 'sparks', 'shock', 'flash']) assert.ok(new RegExp('\\b' + k + '\\b').test(c), k);
  assert.ok(/CAP\.fire/.test(c) && /CAP\.smoke/.test(c) && /CAP\.spark/.test(c) && /CAP\.confetti/.test(c)); assert.ok(/stopped = true; ctx\.clearRect/.test(c), 'the loop stops itself'); assert.ok(/'lighter'/.test(c));
  assert.ok(/if \(motion\) anim = animate/.test(c), 'calm mode still skips the canvas'); assert.ok(!/setInterval/.test(c));
});
test('floating stopwatch: icon + dialog panel with start/pause/reset/laps, analog + digital clock, labelled controls, hidden by default panel', () => {
  for (const id of ['swFab', 'swPanel', 'swGo', 'swLap', 'swReset', 'swLaps', 'swTime', 'swDigital', 'swHH', 'swHM', 'swHS', 'swClose', 'swRoam', 'swH24', 'swShow']) assert.ok(html.includes(`id="${id}"`), id);
  assert.ok(/id="swPanel"[^>]*role="dialog"[^>]*hidden/.test(html)); assert.ok(/id="swFab"[^>]*aria-label="[^"]+"/.test(html)); assert.ok(/id="swTime"[^>]*role="timer"/.test(html)); assert.ok(/id="swAnalog"|class="sw-analog"[^>]*role="img"[^>]*aria-label/.test(html));
  const f = read('floaty.js'); assert.ok(/setPointerCapture/.test(f) && /Q\.roamStep/.test(f) && /Q\.throwVelocity/.test(f) && /Q = CP47/.test(f) && /osRm\(\)/.test(f) && /document\.hidden/.test(f), 'drag, roaming, reduced motion and hidden-tab pause'); assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon/.test(f)); assert.equal((f.match(/requestAnimationFrame\(loop\)/g) || []).length, 2);
  assert.ok(/chronopulse:widget/.test(f) && !/chronopulse:v4\.1/.test(f), 'own storage key, never the app data');
});
test('orbit: canvas inside the streak sheet, stops with the sheet, text alternative, milestones from CP47', () => {
  assert.ok(/id="stkOrbit"[\s\S]*id="stkOrbitCv" aria-hidden="true"[\s\S]*id="stkFlame"/.test(html)); assert.ok(/id="stkOrbitNote"[^>]*aria-live="polite"/.test(html));
  const o = read('orbit.js'); assert.ok(/addEventListener\('close', stop\)/.test(o) && /Q = CP47/.test(o) && /Q\.orbitLayout/.test(o) && /Q\.orbitPos/.test(o) && /osRm\(\)/.test(o) && /aria-label/.test(o));
  const s = read('streak-ui.js'); assert.ok(/CP47\.milestones\(info\.longest\)/.test(s) && /X\.orbit\.set\(info\)/.test(s) && /data-glow|dataset\.glow/.test(s));
});
test('streak sheet: glowing pill rows, escalating flame glow levels 1-6, tier styles up to Legend', () => {
  const c = read('style.css'), t = read('themes.css'); for (let n = 1; n <= 6; n++) assert.ok(c.includes(`[data-glow="${n}"] .flame`), 'glow ' + n); for (let n = 4; n <= 10; n++) assert.ok(t.includes(`.sbadge.t${n} .medal`), 'tier ' + n);
  assert.ok(/\.stk-day\.on\{[^}]*linear-gradient\(180deg/.test(c)); assert.ok(/id="stkShieldRow"/.test(html));
});
test('notifications: toggle is guarded against double taps and follows permission changes; the worker gets the schedule', () => {
  const f = read('focus-ui.js'); assert.ok(/notifBusy/.test(f) && /permissions\.query\(\{ name: 'notifications' \}\)/.test(f) && /aria-busy/.test(f)); assert.ok(/X\.renderNotif = renderNotif/.test(f));
  const b = read('bgnotify.js'); assert.ok(/type: on \? 'SCHEDULE' : 'CLEAR_SCHEDULE'/.test(b) && /CP47\.buildSchedule|Q\.buildSchedule/.test(b) && /periodicSync/.test(b)); assert.ok(html.includes('id="bgNote"'));
  assert.ok(/self\.registration\.showNotification/.test(sw) && /periodicsync/.test(sw));
});
test('sound hub: one alertSound entry for reminders, tasks and finished sessions; the tick stays on the countdown', () => {
  const n = read('notifsound.js'), f = read('focus-ui.js'); assert.ok(/X\.alertSound = category/.test(n)); assert.ok(/X\.alertSound\('alert'\)/.test(f) && /X\.alertSound\('task'\)/.test(f) && /X\.reminderSound/.test(read('reminders.js')));
  for (const file of ['notifsound.js', 'focus-ui.js', 'reminders.js', 'cinema.js']) assert.ok(!/doomsday-tick/.test(read(file)), file + ' must not use the tick'); assert.ok(/new Audio\('doomsday-tick\.mp3'\)/.test(read('script.js')));
});
test('charts: empty dashboard / insights show one placeholder instead of 0-value grids; themes can be switched from the header', () => {
  assert.ok(/id="dEmpty"[^>]*hidden/.test(html) && /id="insEmpty"[^>]*hidden/.test(html)); const f = read('focus-ui.js'); assert.ok(/CP47\.hasChartData\(S\)/.test(f) && /if \(has\) \{/.test(f)); assert.ok(/CP47\.hasChartData\(S\)/.test(read('insights-ui.js')));
  assert.ok(/id="themeQuick"[^>]*aria-label/.test(html)); assert.ok(/themeQuick/.test(read('theme.js'))); assert.ok(read('style.css').includes('.is-empty-charts .charts2{display:none}'));
});
test('stopwatch panel is fully opaque in every theme (solid --surf, no blur), so the page never shows through', () => {
  const c = read('style.css'), t = read('themes.css'), rule = c.match(/\.sw-panel\{[^}]*\}/)[0]; assert.ok(/background:var\(--surf\)/.test(rule) && /backdrop-filter:none/.test(rule) && !/--glass|--sheet/.test(rule));
  for (const th of ['oled', 'neon', 'pastel']) { const line = t.match(new RegExp('html\\[data-theme=' + th + '\\]\\{[^}]*--surf:(#[0-9a-f]{6})')); assert.ok(line, th + ' defines a solid #rrggbb --surf'); } assert.ok(/:root\{[^}]*--surf:#[0-9a-f]{6}/.test(c));
});
