'use strict';
/* Insights page + event categories + streak badges UI: static wiring, escaping, accessibility, offline. Real-browser behaviour: e2e/ultimate.e2e.py */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const V = require('../lib/lib41.js');
const html = read('index.html'), ins = read('insights-ui.js'), script = read('script.js'), css = read('themes.css'), sui = read('streak-ui.js'), q = read('lib/lib46.js');

test('every element id insights-ui.js looks up exists in index.html', () => { const ids = new Set([...ins.matchAll(/\$\('#([A-Za-z][\w-]*)/g)].map(m => m[1])); assert.ok(ids.size >= 9); for (const id of ids) assert.ok(new RegExp(`id="${id}"`).test(html), 'missing #' + id); });
test('Insights is a page under More: menu entry, title, tab group, render hook, back button', () => {
  assert.ok(/data-tab="insights"/.test(html) && /<section id="tab-insights" class="panel">/.test(html)); assert.ok(/insights: \['Insights'/.test(script)); assert.ok(/'data', 'insights'\]\.includes\(name\) \? 'more' : name/.test(script)); assert.ok(/X\.render\.insights = render/.test(ins));
  const sec = html.match(/<section id="tab-insights"[\s\S]*?<\/section>/)[0]; assert.ok(/class="back" data-tab="more"/.test(sec));
});
test('all four charts exist with headings: focus bars (+ range toggle + goal), 365-day heatmap, category donut with legend, progress rings with legend', () => {
  const sec = html.match(/<section id="tab-insights"[\s\S]*?<\/section>/)[0]; for (const id of ['insFocus', 'insTarget', 'insHeat', 'insHeatScroll', 'insDonut', 'insLegend', 'insRings', 'insRingLegend']) assert.ok(sec.includes(`id="${id}"`), id);
  for (const h of ['Focus time', 'Consistency · last 365 days', 'Categories', 'Life &amp; goal progress']) assert.ok(sec.includes(h), h); assert.ok(/role="radiogroup" aria-label="Focus chart range"/.test(sec) && /data-range="week"/.test(sec) && /data-range="weeks"/.test(sec));
});
test('charts are self-contained inline SVG: no libraries, no network, no canvas dependency, colours come from theme variables', () => {
  assert.ok(!/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|importScripts|import\()/.test(ins + q)); assert.ok(!/<script[^>]+src="https?:/.test(html)); assert.ok(/<svg viewBox=/.test(ins)); assert.ok(/var\(--c\$\{/.test(ins)); assert.ok(!/#[0-9a-fA-F]{6}/.test(ins), 'no hard-coded colours: every chart colour is a theme variable');
  for (const cls of ['ch-bar', 'ch-goal', 'hc', 'donut-seg', 'ring-fg', 'ring-bg']) assert.ok(css.includes('.' + cls), cls); assert.ok(/stroke-dasharray:6 5/.test(css), 'goal line is dashed');
});
test('user-supplied text (category names, event titles) is escaped before it reaches innerHTML', () => {
  const lines = ins.split('\n').filter(l => /\.name|\.title|\.sub\b|\.label/.test(l) && /\$\{/.test(l)); /* every name/title/label interpolation must itself be escaped at the source */ assert.ok(lines.length >= 5);
  for (const l of lines) for (const m of l.matchAll(/\$\{([^}]*(?:\.name|\.title|\.sub\b|\.label)[^}]*)\}/g)) assert.ok(/esc\(/.test(m[1]), 'unescaped interpolation: ' + m[1]);
  assert.ok(/replace\(\/\[&<>"'\]\/g/.test(q)); assert.ok(!/document\.write|eval\(|new Function/.test(ins + sui));
});
test('accessibility: every chart has a text equivalent (role=img + aria-label with the numbers), toggles are radios, hover titles on bars/cells', () => {
  assert.ok((ins.match(/role="img" aria-label=/g) || []).length === 4); assert.ok(/aria-checked/.test(ins)); assert.ok(/<title>/.test(ins)); assert.ok(/for="insTarget"|<label class="ins-target">/.test(html));
});
test('reduced motion: the rings animate only when allowed (CSS transition removed by the device setting and by the in-app switch)', () => { assert.ok(/@media\(prefers-reduced-motion:reduce\)\{\.ring-fg\{transition:none\}\}/.test(css)); assert.ok(/html\.cp-rm \.ring-fg/.test(css)); assert.ok(/stroke-dasharray:0 /.test(ins) && /requestAnimationFrame/.test(ins)); });
test('only the daily focus goal is saved by the Insights page (through the normal save()), and it re-renders on data changes', () => {
  assert.equal((ins.match(/\bsave\(\)/g) || []).length, 1); assert.ok(/S\.cfg\.focusTargetMin = Q\.targetOf\(e\.target\.value\); save\(\)/.test(ins)); assert.ok(!/localStorage|sessionStorage|indexedDB/.test(ins)); assert.ok(/X\.afterSave = \(\) => \{ if \(prevSave\) prevSave\(\); if \(tab === 'insights'\) render\(\); \}/.test(ins));
});
test('the focus-goal select offers 0 (no line) and values within the validated range', () => { const sel = html.match(/<select id="insTarget"[\s\S]*?<\/select>/)[0]; const vals = [...sel.matchAll(/value="(\d+)"/g)].map(m => +m[1]); assert.equal(vals[0], 0); for (const v of vals) assert.equal(V.cfgOf({ focusTargetMin: v }).focusTargetMin, v); assert.ok(vals.includes(120)); });

/* ----- event categories ----- */
test('event dialog has an optional Category field with Work/Study/Personal/Health suggestions; saved on create and edit, cleared when emptied', () => {
  assert.ok(/id="eCat" maxlength="30" list="evCatList"/.test(html)); const dl = html.match(/<datalist id="evCatList">[\s\S]*?<\/datalist>/)[0]; for (const c of ['Work', 'Study', 'Personal', 'Health']) assert.ok(dl.includes(`value="${c}"`), c);
  assert.ok(/category = \$\('#eCat'\)\.value\.trim\(\)\.slice\(0, 30\)/.test(script)); assert.ok(/if \(category\) editEv\.category = category; else delete editEv\.category/.test(script)); assert.ok(/\.\.\.\(category \? \{ category \} : \{\}\)/.test(script)); assert.ok(/\$\('#eCat'\)\.value = \(ev && ev\.category\) \|\| ''/.test(script));
});
test('event category survives validation: trimmed, capped at 30, dropped when blank/non-text; old events are unchanged (no new key); schema 7', () => {
  const mk = c => V.sanitize41({ events: [{ id: 'e1', title: 'T', at: '2030-01-01T10:00', category: c }] }).events[0];
  assert.equal(mk('  Work ').category, 'Work'); assert.equal(mk('x'.repeat(50)).category.length, 30); for (const bad of ['', '   ', 5, null, {}, []]) assert.ok(!('category' in mk(bad)), JSON.stringify(bad));
  const S = V.sanitize41({ events: [{ id: 'e1', title: 'T', at: '2030-01-01T10:00', category: 'Health' }] }); assert.equal(V.sanitize41(JSON.parse(JSON.stringify(S))).events[0].category, 'Health'); assert.equal(S.v, 7); assert.ok(/"category":"Health"/.test(JSON.stringify(V.makeBackup(S))));
});

/* ----- streak sheet additions ----- */
test('streak sheet: freeze shields with a text equivalent, glowing badges (3 tiers) and a habit matrix; badges also on the Profile tab', () => {
  assert.ok(/id="stkShieldRow" role="img"/.test(html) && /id="stkShieldNote"/.test(html)); assert.ok(/id="stkBadges"/.test(html) && /id="stkMatrix"/.test(html) && /id="profBadges"/.test(html)); assert.ok(html.indexOf('id="profBadges"') > html.indexOf('id="tab-profile"') && html.indexOf('id="profBadges"') < html.indexOf('Age &amp; life stats'));
  assert.ok(/role="group" aria-label="\$\{b\.name\} badge/.test(sui)); assert.ok(/aria-label', `\$\{left\} of \$\{per\} streak freezes left/.test(sui)); for (const t of ['t1', 't2', 't3']) assert.ok(new RegExp(`\\.sbadge\\.${t} \\.medal`).test(css), t); assert.ok(/animation:badgeGlow/.test(css)); assert.ok(/#cd7f32/.test(css) && /#c0c8d4/.test(css) && /#ffd34d/.test(css), 'bronze / silver / gold');
  assert.ok(/\.stk-day\.ice/.test(css)); assert.ok(/id="stkFreeze"/.test(html)); assert.ok(/renderBadges\(\$\('#profBadges'\), a\.info\)/.test(sui));
});
test('HTML ids are unique (a duplicate id broke the category suggestions once)', () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]), dup = ids.filter((x, i) => ids.indexOf(x) !== i); assert.deepEqual([...new Set(dup)], [], 'duplicate ids: ' + dup.join(', '));
  for (const m of html.matchAll(/\slist="([^"]+)"/g)) assert.ok(ids.includes(m[1]), 'list= points at a missing datalist: ' + m[1]);
});
test('the streak-badge styles never touch the existing .badge class (it styles the Focus history status pills)', () => {
  const style = read('style.css'); assert.ok(/^\.badge\{font:700 \.66rem/m.test(style), 'the original pill rule is still there'); assert.ok(!/(^|[\s,}])\.badge(?![-\w])/.test(css), 'themes.css must not define .badge');
  assert.ok(/class="sbadge t\$\{b\.tier\}/.test(sui) && !/class="badge t/.test(sui)); assert.ok(/\.sbadge\.t1 \.medal/.test(css));
  assert.ok(/<span class="badge \$\{esc\(s\.status\)\}">/.test(read('focus-ui.js')), 'history pills still use .badge');
});
