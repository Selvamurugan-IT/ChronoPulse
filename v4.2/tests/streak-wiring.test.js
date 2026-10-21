'use strict';
/* Streak feature: static wiring, accessibility, offline and "stores nothing" guards. Real-browser behaviour: e2e/streak.e2e.py */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const html = read('index.html'), ui = read('streak-ui.js'), css = read('style.css'), sw = read('service-worker.js');
const precache = () => eval(sw.match(/const PRECACHE = (\[[\s\S]*?\]);/)[1]);

test('every element id streak-ui.js looks up exists in index.html', () => {
  const ids = new Set([...ui.matchAll(/\$\('#([A-Za-z][\w-]*)/g)].map(m => m[1])); assert.ok(ids.size >= 15);
  for (const id of ids) assert.ok(new RegExp(`id="${id}"`).test(html), 'missing #' + id);
});
test('offline: lib/lib44.js and streak-ui.js are loaded in order and precached; the cache name was bumped', () => {
  const order = [...html.matchAll(/<script defer src="([^"]+)"/g)].map(m => m[1]); assert.ok(order.indexOf('lib/lib44.js') > order.indexOf('lib/lib43.js') && order.indexOf('lib/lib44.js') < order.indexOf('script.js'));
  assert.ok(order.indexOf('streak-ui.js') > order.indexOf('cinema.js') && order.indexOf('streak-ui.js') < order.indexOf('pwa.js'), 'after focus-ui/cinema so the hooks it wraps already exist');
  for (const f of ['lib/lib44.js', 'streak-ui.js']) { assert.ok(precache().includes(f), f); assert.ok(fs.existsSync(path.join(root, f))); } assert.ok(/VERSION = '4\.2\.6'/.test(sw));
});
test('streak-ui.js stores nothing itself: no storage access, no network, no timers except the midnight roll-over', () => {
  assert.ok(!/localStorage|sessionStorage|indexedDB|STORE\b/.test(ui)); assert.ok(!/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|importScripts)\b/.test(ui)); assert.equal((ui.match(/setInterval\(/g) || []).length, 0);
  assert.equal((ui.match(/\bsave\(\)/g) || []).length, 2, 'the only writes are the two settings (daily goal, freezes per month), through the app save()'); assert.ok(/S\.cfg\.streakGoal = K\.goalOf\(sel\.value\); save\(\)/.test(ui)); assert.ok(/S\.cfg\.freezesPerMonth = K\.freezesOf\(fz\.value\); save\(\)/.test(ui));
});
test('the display refreshes on every save, state replacement, settings render, day roll-over and app resume', () => {
  assert.ok(/X\.afterSave = \(\) => \{ if \(prevSave\) prevSave\(\); queue\(\); \}/.test(ui)); assert.ok(/X\.onState = /.test(ui) && /X\.onSettings = /.test(ui)); assert.ok(/visibilitychange/.test(ui) && /pageshow/.test(ui)); assert.ok(/function armMidnight/.test(ui) && /getDate\(\) \+ 1, 0, 0, 1/.test(ui));
});
test('header badge: a labelled button with a live count, placed before Share, opening a modal dialog', () => {
  assert.ok(/<button id="streakBtn"[^>]*aria-haspopup="dialog"[^>]*aria-label="Streak: 0 days/.test(html)); assert.ok(html.indexOf('id="streakBtn"') < html.indexOf('id="shareBtn"')); assert.ok(/id="streakCount"/.test(html));
});
test('dialog is accessible: named, closable, month buttons labelled, calendar cells carry full-date labels', () => {
  const d = html.match(/<dialog id="streakDlg"[\s\S]*?<\/dialog>/)[0]; assert.ok(/aria-labelledby="stkTitle"/.test(d)); assert.ok(/id="stkClose"[^>]*data-close|data-close[^>]*id="stkClose"/.test(d));
  assert.ok(/id="stkPrev" aria-label="Previous month"/.test(d) && /id="stkNext" aria-label="Next month"/.test(d)); assert.ok(/id="stkMonth" aria-live="polite"/.test(d)); assert.ok(/Longest Streak/.test(d) && /id="stkRange"/.test(d) && /id="stkLong"/.test(d));
  assert.ok(/setAttribute\('aria-label', `\$\{day\(c\.key\)/.test(ui)); assert.ok(/ArrowLeft/.test(ui) && /ArrowRight/.test(ui));
});
test('the flame and the month slide respect reduced motion (device setting AND the in-app switch); a cold flame never animates', () => {
  assert.ok(/@media\(prefers-reduced-motion:reduce\)\{\*,\*::before,\*::after\{animation:none!important/.test(css)); assert.ok(/html\.cp-rm \.flame/.test(css) && /\.stk-grid\.slide-l/.test(css.slice(css.indexOf('html.cp-rm .flame')))); assert.ok(/\[data-state=cold\] \.flame\{animation:none/.test(css));
  const block = css.slice(css.indexOf('Streak tracking & activity calendar')).replace(/@keyframes [\w-]+\{(?:[^{}]|\{[^{}]*\})*\}/g, ''); assert.ok(!/opacity:0[;}]/.test(block), 'no content hidden behind an animation');
});
test('streak colours: active days use the red/orange gradient; pills only round at row ends', () => {
  assert.ok(/\.stk-day\.on\{[^}]*linear-gradient\(90deg,#ff5a00,#e11d0c\)/.test(css)); for (const r of ['single', 'start', 'end', 'mid']) assert.ok(new RegExp(`\\.stk-day\\.on\\.${r}\\{`).test(css), r);
});
test('settings: a Daily goal select (1-10 built from the same limits as the validator) and a shortcut to the calendar', () => {
  assert.ok(/<select id="stkGoal"/.test(html)); assert.ok(/for \(let n = K\.GOAL_MIN; n <= K\.GOAL_MAX; n\+\+\)/.test(ui)); assert.ok(/id="stkOpen"/.test(html));
});
test('what counts is explained to the user, and the UI never claims streaks sync or back up on their own', () => {
  assert.ok(/habit check-ins, tasks and focus sessions/i.test(html) && /habit check-ins, tasks and focus sessions/i.test(ui)); assert.ok(!/\b(sync|cloud|leaderboard)\b/i.test(ui));
});
test('existing features are untouched: tick/sound/cinema hooks still wrap, not replace (X.afterSave from focus-ui keeps running)', () => {
  assert.ok(/X\.afterSave = \(\) => \{ if \(tab === 'dash'\) renderDash\(\); \}/.test(read('focus-ui.js'))); assert.ok(/X\.onSettings = renderFx/.test(read('cinema.js'))); assert.ok(/prevSet\) prevSet\(\)/.test(ui));
});
