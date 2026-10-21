'use strict';
/* Multi-theme switcher: palettes (WCAG contrast computed from the real CSS values), boot script, picker wiring, persistence. */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const C = require('../lib/lib.js'), V = require('../lib/lib41.js');
const base = read('style.css'), themes = read('themes.css'), html = read('index.html'), boot = read('theme-boot.js'), ui = read('theme.js'), sw = read('service-worker.js');

/* ---- parse the CSS variables of every theme ---- */
const decls = block => Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)].map(m => [m[1], m[2].trim()]));
const rootVars = decls(base.slice(base.indexOf(':root{') + 6, base.indexOf('}', base.indexOf(':root{'))));
const themeVars = t => { const m = themes.match(new RegExp(`html\\[data-theme=${t}\\]\\{([^}]*)\\}`)); return { ...rootVars, ...(m ? decls(m[1]) : {}) }; };
const ALL = Object.fromEntries(C.THEMES.map(t => [t, themeVars(t)]));
/* ---- colour maths ---- */
function parse(c) {
  c = String(c).trim(); let m;
  if ((m = /^#([0-9a-f]{3})$/i.exec(c))) return [...m[1]].map(h => parseInt(h + h, 16)).concat(1);
  if ((m = /^#([0-9a-f]{6})$/i.exec(c))) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  if ((m = /^rgba?\(([^)]+)\)$/.exec(c))) { const p = m[1].split(',').map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
  throw new Error('unparsable colour: ' + c);
}
const over = (fg, bg) => [0, 1, 2].map(i => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1);
const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const gradStops = g => [...g.matchAll(/#[0-9a-f]{6}|#[0-9a-f]{3}\b/gi)].map(m => parse(m[0]));

test('there are exactly four themes and each has a named override block (Dark is the base)', () => {
  assert.deepEqual(C.THEMES, ['dark', 'oled', 'neon', 'pastel']); for (const t of ['oled', 'neon', 'pastel']) assert.ok(new RegExp(`html\\[data-theme=${t}\\]\\{`).test(themes), t); assert.ok(!/data-theme=dark\]\{/.test(themes), 'dark is the :root default');
});
test('every variable a theme overrides is a real variable (no typos), and every theme defines the full set the UI relies on', () => {
  for (const t of ['oled', 'neon', 'pastel']) for (const k of Object.keys(decls(themes.match(new RegExp(`html\\[data-theme=${t}\\]\\{([^}]*)\\}`))[1]))) assert.ok(k in rootVars, `${t}: unknown variable ${k}`);
  const need = ['--bg', '--tx', '--mu', '--em', '--em2', '--glass', '--sheet', '--input', '--navbg', '--scrim', '--on-em', '--grad', '--num', '--track', '--warn', '--errtx', '--ice', '--c1', '--c6', '--heat0', '--heat4', '--scheme']; for (const t of C.THEMES) for (const k of need) assert.ok(ALL[t][k], `${t} lacks ${k}`);
});
test('OLED True Black: the background is exactly #000000 and no glow gradients are painted', () => { assert.equal(ALL.oled['--bg'], '#000000'); assert.equal(ALL.oled['--g1'], 'transparent'); assert.equal(ALL.oled['--g2'], 'transparent'); assert.equal(ALL.oled['--navbg'], '#000000'); assert.ok(/html\[data-theme=oled\] body\{background:#000\}/.test(themes)); assert.ok(lum(parse(ALL.oled['--surf'])) < 0.01); });
test('Cyberpunk Neon uses cyan and magenta accents on a near-black violet; Soft Pastel is a light theme', () => { assert.equal(ALL.neon['--em'], '#00e5ff'); assert.equal(ALL.neon['--em2'], '#ff3df0'); assert.ok(lum(parse(ALL.neon['--bg'])) < 0.02); assert.equal(ALL.pastel['--scheme'], 'light'); assert.ok(lum(parse(ALL.pastel['--bg'])) > 0.8); for (const t of ['dark', 'oled', 'neon']) assert.equal(ALL[t]['--scheme'], 'dark'); });

for (const t of C.THEMES) {
  test(`${t}: WCAG contrast — body text, muted text, accent text, button text, countdown digits, warnings (>= 4.5:1) and chart colours / freeze shields (>= 3:1)`, () => {
    const v = ALL[t], bg = parse(v['--bg']), glass = over(parse(v['--glass']), bg), sheet = over(parse(v['--sheet']), bg), P = k => parse(v[k]);
    const check = (name, a, b, min) => { const r = ratio(a, b); assert.ok(r >= min, `${t}: ${name} = ${r.toFixed(2)}:1 (needs ${min})`); };
    check('text on page', P('--tx'), bg, 7); check('text on cards', P('--tx'), glass, 7); check('text on sheets', P('--tx'), sheet, 7); check('muted on page', P('--mu'), bg, 4.5); check('muted on cards', P('--mu'), glass, 4.5); check('muted on sheets', P('--mu'), sheet, 4.5);
    check('accent text on page', P('--em2'), bg, 4.5); check('accent text on cards', P('--em2'), glass, 4.5);
    for (const s of gradStops(v['--grad'])) check('button label on gradient', P('--on-em'), s, 4.5);
    check('countdown digits on cards', P('--num'), glass, 7); check('warning text on cards', P('--warn'), glass, 4.5); check('error text on cards', P('--errtx'), glass, 4.5); check('ok text on cards', P('--ok'), glass, 4.5);
    for (let i = 1; i <= 6; i++) check(`chart colour ${i} on cards`, P('--c' + i), glass, 3); check('freeze shield on cards', P('--ice'), glass, 3); check('input text', P('--tx'), over(parse(v['--input']), bg), 7);
  });
  test(`${t}: heatmap shades go from light to dark in four steps and the empty cell is distinguishable from the card`, () => {
    const v = ALL[t], L = [1, 2, 3, 4].map(i => lum(parse(v['--heat' + i]))); for (let i = 1; i < 4; i++) assert.ok(L[i] < L[i - 1], `${t}: heat${i + 1} must be darker than heat${i}`);
    assert.ok(ratio(parse(v['--heat0']), over(parse(v['--glass']), parse(v['--bg']))) >= 1.05, 'empty cell visible'); assert.ok(ratio(parse(v['--heat4']), parse(v['--heat1'])) >= 2, 'clear steps');
  });
}
test('no dark-theme-only colour literals are left outside the :root defaults (regression guard for the light theme)', () => {
  const rest = base.replace(/:root\{[^}]*\}/, '').replace(/\.cine-ten\{[^}]*\}/, ''); /* the Final-Ten overlay is deliberately a dark scrim with white digits in every theme */ for (const lit of ['rgba(18,24,36', 'rgba(8,12,20', 'rgba(10,13,20', '#17223a', '#243044', '#8795ab', 'color-scheme:dark', 'color:#ffd9b8', 'color:#ff8a8a', 'color:#fbbf24']) assert.ok(!rest.includes(lit), 'hard-coded ' + lit);
});

/* ---- boot script: applies the saved theme before first paint ---- */
function runBoot(store, meta = { content: 'x' }) {
  const attrs = {}, doc = { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } }, querySelector: sel => (sel === 'meta[name="theme-color"]' ? { setAttribute: (k, v) => { meta[k] = v; } } : null) };
  const ls = { getItem: k => { if (store === 'throw') throw new Error('blocked'); return store[k] === undefined ? null : store[k]; } }; vm.runInNewContext(boot, { document: doc, localStorage: ls, JSON, Object }); return { theme: attrs['data-theme'], meta: meta.content };
}
test('boot script: sets the saved theme and the browser-bar colour; anything invalid falls back to dark and never throws', () => {
  const key = 'chronopulse:v4.1', ok = t => runBoot({ [key]: JSON.stringify({ v: 7, cfg: { theme: t } }) });
  assert.deepEqual(ok('oled'), { theme: 'oled', meta: '#000000' }); assert.deepEqual(ok('neon'), { theme: 'neon', meta: '#06010f' }); assert.deepEqual(ok('pastel'), { theme: 'pastel', meta: '#f6f1fa' }); assert.deepEqual(ok('dark'), { theme: 'dark', meta: '#0a0d14' });
  for (const bad of ['evil', '', 5, null, '__proto__', 'constructor', 'toString', 'hasOwnProperty']) assert.equal(ok(bad).theme, 'dark', String(bad));
  assert.equal(runBoot({}).theme, 'dark'); assert.equal(runBoot({ [key]: '{not json' }).theme, 'dark'); assert.equal(runBoot({ [key]: 'null' }).theme, 'dark'); assert.equal(runBoot({ [key]: '{"cfg":null}' }).theme, 'dark'); assert.equal(runBoot('throw').theme, 'dark');
  assert.doesNotThrow(() => { const attrs = {}; vm.runInNewContext(boot, { document: { documentElement: { setAttribute() {} }, querySelector: () => null }, localStorage: { getItem: () => null }, JSON, Object }); });
});
test('boot script only reads (never writes) storage and sends nothing', () => { assert.ok(!/setItem|removeItem|sessionStorage|indexedDB|fetch|XMLHttpRequest|sendBeacon/.test(boot)); assert.ok(/'chronopulse:v4\.1'/.test(boot)); });
test('browser-bar colours agree everywhere: theme-boot.js, theme.js, themes.css/style.css (--bg) and the <meta> default', () => {
  const fromBoot = Object.fromEntries([...boot.match(/var THEMES = \{([^}]*)\}/)[1].matchAll(/(\w+): '(#[0-9a-f]+)'/g)].map(m => [m[1], m[2]])), fromUi = Object.fromEntries([...ui.match(/COLORS = \{([^}]*)\}/)[1].matchAll(/(\w+): '(#[0-9a-f]+)'/g)].map(m => [m[1], m[2]]));
  assert.deepEqual(fromBoot, fromUi); assert.deepEqual(Object.keys(fromBoot), C.THEMES); for (const t of C.THEMES) { assert.equal(fromBoot[t], ALL[t]['--bg'], t); }
  assert.ok(new RegExp(`<meta name="theme-color" content="${fromBoot.dark}">`).test(html));
});
test('the boot script runs synchronously in <head> BEFORE the page paints (no defer/async), after the theme-color meta; themes.css follows style.css', () => {
  const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>')); assert.ok(/<script src="theme-boot\.js"><\/script>/.test(head)); assert.ok(head.indexOf('theme-boot.js') > head.indexOf('name="theme-color"')); assert.ok(!/theme-boot\.js"[^>]*(defer|async)/.test(head));
  assert.ok(head.indexOf('href="style.css"') < head.indexOf('href="themes.css"')); assert.ok(/<meta name="color-scheme" content="dark light">/.test(head));
});

/* ---- picker ---- */
test('Settings → Appearance: a labelled radio group with the four themes in order, Dark selected by default', () => {
  const g = html.match(/<div class="theme-grid" id="themeGrid"[\s\S]*?<\/div>\s*<p class="hint" id="themeNow"/)[0]; assert.ok(/role="radiogroup" aria-labelledby="themeH"/.test(g)); assert.deepEqual([...g.matchAll(/data-theme="(\w+)"/g)].map(m => m[1]), C.THEMES);
  assert.equal((g.match(/role="radio"/g) || []).length, 4); assert.ok(/aria-checked="true" data-theme="dark"/.test(g)); for (const n of ['Dark', 'OLED True Black', 'Cyberpunk Neon', 'Soft Pastel']) assert.ok(g.includes(`<b>${n}</b>`), n);
  assert.ok(html.indexOf('id="themeCard"') < html.indexOf('<h3>Account</h3>'), 'first thing in Settings');
});
test('picker runtime: applies to <html data-theme> + meta, persists ONLY cfg.theme via save(), keyboard arrows move between themes, follows restores/resets', () => {
  assert.ok(/S\.cfg\.theme = t; save\(\); apply\(t\)/.test(ui)); assert.ok(!/localStorage|sessionStorage|indexedDB/.test(ui)); assert.equal((ui.match(/\bsave\(\)/g) || []).length, 1); assert.ok(/ArrowRight/.test(ui) && /ArrowLeft/.test(ui) && /tabIndex = on \? 0 : -1/.test(ui));
  assert.ok(/X\.onState = \(\) => \{ if \(prevState\) prevState\(\); apply\(cur\(\)\); \}/.test(ui)); assert.ok(/documentElement\.setAttribute\('data-theme', t\)/.test(ui)); assert.ok(/CP\.THEMES\.includes\(t\)/.test(ui));
});
test('theme assets are precached so themes work offline (css, boot script, picker, chart code)', () => { for (const f of ['themes.css', 'theme-boot.js', 'theme.js', 'insights-ui.js', 'lib/lib46.js']) { assert.ok(sw.includes(`'${f}'`), f); assert.ok(fs.existsSync(path.join(root, f)), f); } });

/* ---- persistence ---- */
test('cfg.theme: default dark, validated, survives save/load and backups; schema 7 and the key are unchanged; old data gets dark', () => {
  assert.equal(V.cfgOf({}).theme, 'dark'); for (const t of C.THEMES) assert.equal(V.cfgOf({ theme: t }).theme, t); for (const bad of ['evil', 5, null, {}, 'OLED', 'Dark ']) assert.equal(V.cfgOf({ theme: bad }).theme, 'dark');
  const S = V.sanitize41(null); S.cfg.theme = 'neon'; const back = V.sanitize41(JSON.parse(JSON.stringify(S))); assert.equal(back.cfg.theme, 'neon'); assert.equal(back.v, 7); assert.equal(V.KEY, 'chronopulse:v4.1'); assert.ok(/"theme":"neon"/.test(JSON.stringify(V.makeBackup(S))));
  const old = JSON.parse(JSON.stringify(V.sanitize41(null))); delete old.cfg.theme; assert.equal(V.sanitize41(old).cfg.theme, 'dark');
});
test('other new settings: freezes per month 0-3 (default 3), focus goal 0-720 min (default 120)', () => {
  assert.equal(V.cfgOf({}).freezesPerMonth, 3); assert.equal(V.cfgOf({ freezesPerMonth: 0 }).freezesPerMonth, 0); assert.equal(V.cfgOf({ freezesPerMonth: 9 }).freezesPerMonth, 3); assert.equal(V.cfgOf({ freezesPerMonth: -1 }).freezesPerMonth, 0); assert.equal(V.cfgOf({ freezesPerMonth: '2' }).freezesPerMonth, 3);
  assert.equal(V.cfgOf({}).focusTargetMin, 120); assert.equal(V.cfgOf({ focusTargetMin: 0 }).focusTargetMin, 0); assert.equal(V.cfgOf({ focusTargetMin: 5000 }).focusTargetMin, 720); assert.equal(V.cfgOf({ focusTargetMin: 45.4 }).focusTargetMin, 45); assert.equal(V.cfgOf({ focusTargetMin: NaN }).focusTargetMin, 120);
});
