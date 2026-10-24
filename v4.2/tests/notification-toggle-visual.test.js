'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
test('notification switches synchronize ARIA and visual active classes', () => {
  const source = fs.readFileSync(path.join(root, 'focus-ui.js'), 'utf8');
  assert.match(source, /function syncSwitch\(el, on\)/);
  assert.match(source, /el\.setAttribute\('aria-checked', String\(value\)\)/);
  assert.match(source, /el\.classList\.toggle\('active', value\)/);
  assert.match(source, /syncSwitch\(t, on\)/);
  assert.match(source, /syncSwitch\(h, !!cfg\(\)\.hideTitles\)/);
});
test('ChronoPulse 4.2 title and package version are set', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.match(html, /<title>ChronoPulse 4\.2<\/title>/);
  assert.equal(pkg.version, '4.2.8');
});

test('notification permission result is authoritative; a lagging Permissions API state cannot force the toggle off', () => {
  const source = fs.readFileSync(path.join(root, 'focus-ui.js'), 'utf8');
  assert.match(source, /permissionGrantedThisSession = true/);
  assert.match(source, /const hasNotificationPermission = \(\) => perm\(\) === 'granted' \|\| \(permissionGrantedThisSession && perm\(\) !== 'denied'\)/);
  assert.match(source, /if \(perm\(\) === 'denied'\).*?else if \(perm\(\) === 'granted'\)/s);
  assert.doesNotMatch(source, /if \(s\.state !== 'granted' && cfg\(\)\.notify\)/);
});
