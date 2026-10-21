'use strict';
/* Phase 3: static wiring / honesty guards for cinema.js, index.html, style.css and script.js. (Behaviour in a real browser is covered by e2e/phase3.e2e.py.) */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const C = require('../lib/lib.js');
const html = read('index.html'), cinema = read('cinema.js'), script = read('script.js'), css = read('style.css'), sfx = read('sfx.js');

test('every element id cinema.js looks up exists in index.html', () => {
  const ids = new Set([...cinema.matchAll(/\$\('#([A-Za-z][\w-]*)/g)].map(m => m[1])); assert.ok(ids.size > 20);
  for (const id of ids) assert.ok(new RegExp(`id="${id}"`).test(html), 'missing #' + id);
});
test('settings: the select options are exactly the allowed values in lib/lib.js', () => {
  const opts = id => [...html.match(new RegExp(`<select id="${id}"[\\s\\S]*?</select>`))[0].matchAll(/value="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(opts('fxSound'), C.FX_SOUNDS); assert.deepEqual(opts('fxTen'), C.FX_TEN);
});
test('settings: master switch, volume, sound pick + preview, ten-second style, warning, vibration, reduced motion and demo are all present and labelled', () => {
  for (const id of ['sAudio', 'fxVol', 'fxSound', 'fxPrev', 'fxTen', 'fxTenPrev', 'fxWarn', 'fxWarnPrev', 'fxVib', 'fxRed']) assert.ok(new RegExp(`id="${id}"[^>]*aria-label=|for="${id}"`).test(html), 'unlabelled: ' + id);
  assert.ok(/id="fxDemo"[\s\S]*?Preview the full celebration/.test(html), 'demo button has a visible text label');
  assert.ok(/id="fxVol" type="range" min="0" max="100"/.test(html)); assert.ok(/id="sAudio"[^>]*role="switch"/.test(html));
});
test('celebration overlay is a modal <dialog> with Replay, Mute, Reduce motion and Close, and an accessible name', () => {
  const d = html.match(/<dialog id="cineDlg"[\s\S]*?<\/dialog>/)[0];
  for (const id of ['cineReplay', 'cineMute', 'cineRm', 'cineClose', 'cineCv']) assert.ok(d.includes(`id="${id}"`), id);
  assert.ok(/aria-labelledby="cineTitle"/.test(d)); assert.ok(/id="cineCv" aria-hidden="true"/.test(d)); assert.ok(/id="cineMute" aria-pressed/.test(d) && /id="cineRm" aria-pressed/.test(d));
});
test('final-ten display is decorative for screen readers (announced once via a live region, not every second)', () => {
  assert.ok(/id="cineTen"[^>]*aria-hidden="true"/.test(html)); assert.ok(/id="cineSr"[^>]*aria-live="polite"/.test(html)); assert.ok(/pointer-events:none/.test(css.match(/\.cine-ten\{[^}]*\}/)[0]), 'must never block taps');
});
test('script.js hands completion to the cinema once per live completion, ticks it each frame, and clears it when the Countdown screen is left', () => {
  assert.ok(/X\.cine\.completed\(S\.active\)/.test(script)); assert.ok(/X\.cine\.tick\(ev, now\)/.test(script)); assert.ok(/if \(!want && X\.cine\) X\.cine\.idle\(\)/.test(script));
  assert.ok(/CP42\.reconcile/.test(script), 'durable Phase 1 completion is still the primary guard'); assert.ok(/CP42\.isCompleted\(ev\)\) completeEvents/.test(script));
});
test('the tick sound pauses while the celebration is open, and follows the volume setting', () => { assert.ok(/#cineDlg\[open\]/.test(script)); assert.ok(/CP43\.mediaVolume\(S\.cfg\.fxVolume\)/.test(script)); });
test('autoplay: the only AudioContext is created inside sfx.js unlock(); cinema.js never constructs one and only unlocks from gesture handlers', () => {
  assert.equal((sfx.match(/new Ctor\(\)/g) || []).length, 1); assert.ok(!/new (webkit)?AudioContext/.test(cinema)); assert.ok(/async function unlock\(\)[\s\S]*?build\(\)/.test(sfx));
  assert.ok(/\['pointerup', 'touchend', 'mousedown', 'keydown', 'click'\]\.forEach\(ev => addEventListener\(ev, onGesture/.test(cinema)); assert.ok(/E\.unlock\(\)/.test(cinema));
  assert.equal((cinema.match(/E\.unlock\(\)/g) || []).length, 4 + 0 + 0 - 0 + 0, 'unlock call sites: gesture handler, replay, ready() (previews), demo');
});
test('countdown safety: tick() and completed() catch everything, so an audio problem cannot stop the timer', () => {
  assert.ok(/function tick\(ev, now\) \{\s*try \{[\s\S]*?\} catch \(e\) \{ \/\* the countdown must never be broken by an effect \*\/ \}\s*\}/.test(cinema));
  assert.ok(/completed\(id\) \{\s*try \{[\s\S]*?\} catch \(e\)/.test(cinema)); assert.ok(/function sound\(recipe, opt\) \{ try \{/.test(cinema)); assert.ok(/function buzz\(pattern\) \{[^\n]*try \{/.test(cinema));
});
test('single-play: celebration goes through claimOnce with an id|at token; Replay does not claim', () => {
  assert.ok(/P\.claimOnce\(STORE, claimed, `\$\{ev\.id\}\|\$\{ev\.at\}`\)/.test(cinema)); assert.equal((cinema.match(/claimOnce/g) || []).length, 1);
  assert.ok(/\$\('#cineReplay'\)\.addEventListener\('click', \(\) => \{ const go = \(\) => \{ if \(\$\('#cineDlg'\)\.open\) start\(\)/.test(cinema));
});
test('reduced motion: baseline CSS never hides content behind an animation, the device setting kill-switch is intact, and the in-app switch has rules', () => {
  const block = css.slice(css.indexOf('Phase 3: sound')), noKeyframes = block.replace(/@keyframes [\w-]+\{(?:[^{}]|\{[^{}]*\})*\}/g, '');
  assert.ok(!/opacity:0[;}]/.test(noKeyframes), 'content must stay visible if an animation is removed'); assert.ok(/@media\(prefers-reduced-motion:reduce\)\{\*,\*::before,\*::after\{animation:none!important/.test(css));
  assert.ok(/html\.cp-rm \.hero\.fx-minute/.test(block) && /\.cine-wrap\.rm canvas\{display:none\}/.test(block)); assert.ok(/classList\.toggle\('cp-rm', rm\(\)\)/.test(cinema));
});
test('honesty: UI text never claims custom sound while the app is closed or the phone is locked, and says what is true', () => {
  assert.ok(/only work while ChronoPulse is open and on screen/.test(html)); assert.ok(/closed or the phone is locked, only your phone's own notification sound or a calendar alarm/.test(html));
  for (const f of ['index.html', 'cinema.js', 'sfx.js', 'lib/lib43.js']) assert.ok(!/(sounds?|audio|beeps?|chime|celebration|vibration)[^.\n]{0,60}(plays?|works?)\s+(even\s+)?(when|while)\s+(the\s+)?(app\s+|phone\s+)?(is\s+)?(closed|locked)/i.test(read(f).replace(/only work while[^.]*\./g, '').replace(/closed or the phone is locked, only[^.]*\./g, '')), f);
  assert.ok(!/(background|service[- ]?worker)[^.\n]{0,40}(AudioContext|Audio\()/.test(read('service-worker.js')), 'the service worker never plays audio');
});
test('privacy: the new files send nothing anywhere and bundle no audio files (sounds are synthesized)', () => {
  for (const f of ['lib/lib43.js', 'sfx.js', 'cinema.js']) assert.ok(!/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts)\b/.test(read(f)), f);
  assert.ok(!fs.existsSync(path.join(root, 'assets', 'impact.mp3')) && !fs.existsSync(path.join(root, 'assets', 'boom.wav')));
});
test('the overlay fallback uses only the already-cached chime asset', () => { assert.ok(/new Audio\('assets\/chime\.wav'\)/.test(cinema)); assert.equal((cinema.match(/new Audio\(/g) || []).length, 1); });

test('mobile resume: visibilitychange (visible) and pageshow retry the tick sound AND the sound engine; every later tap can clear a blocked tick', () => {
  assert.ok(/visibilitychange', \(\) => \{ audioSync\(\); syncLoop\(\); if \(!document\.hidden\) \{ reconcileNow\(\); resumeAudio\(\); \}/.test(script));
  assert.ok(/addEventListener\('pageshow', \(\) => \{ reconcileNow\(\); syncLoop\(\); resumeAudio\(\); \}\)/.test(script));
  assert.ok(/function resumeAudio\(\) \{ if \(document\.hidden\) return;[^}]*X\.sfxResume\(\)/.test(script));
  assert.ok(!/once: true/.test(script.slice(script.indexOf('Every real gesture'), script.indexOf('function resumeAudio'))), 'the unlock listener must not be one-shot');
  assert.ok(/X\.sfxResume = tryResume/.test(cinema) && /addEventListener\('pageshow', tryResume\)/.test(cinema) && /E\.resume\(\)/.test(cinema));
  assert.ok(/if \(document\.hidden \|\| !S\.sound\) return;/.test(cinema), 'no resume while hidden or muted');
});
