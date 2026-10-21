'use strict';
/* ChronoPulse 4.2 — theme picker (Settings → Appearance). The four themes are plain CSS variable sets in themes.css; this file only (1) applies the chosen one to
   <html data-theme> and the browser-bar colour, and (2) saves it as cfg.theme through the normal save function. No images or network: fully offline. */
(function () {
  const COLORS = { dark: '#0a0d14', oled: '#000000', neon: '#06010f', pastel: '#f6f1fa' }, NAMES = { dark: 'Dark', oled: 'OLED True Black', neon: 'Cyberpunk Neon', pastel: 'Soft Pastel' };
  const cur = () => (CP.THEMES.includes(S.cfg.theme) ? S.cfg.theme : 'dark');
  function apply(t) {
    document.documentElement.setAttribute('data-theme', t);
    const m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', COLORS[t]);
    $$('#themeGrid [role=radio]').forEach(b => { const on = b.dataset.theme === t; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
    setT($('#themeNow'), `Current theme: ${NAMES[t]}`);
    const qb = $('#themeQuick'); if (qb) { const nx = NAMES[CP.THEMES[(CP.THEMES.indexOf(t) + 1) % CP.THEMES.length]]; qb.title = `Theme: ${NAMES[t]}. Press for ${nx}.`; qb.setAttribute('aria-label', `Theme: ${NAMES[t]}. Switch to ${nx}.`); }
  }
  function choose(t) { if (!CP.THEMES.includes(t)) return; S.cfg.theme = t; save(); apply(t); toast(`${NAMES[t]} theme`); }
  $('#themeGrid').addEventListener('click', e => { const b = e.target.closest('[data-theme]'); if (b) choose(b.dataset.theme); });
  $('#themeGrid').addEventListener('keydown', e => { /* radio-group keyboard pattern: arrows move + select */
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }; if (!(e.key in keys)) return; e.preventDefault();
    const i = CP.THEMES.indexOf(cur()), n = CP.THEMES[(i + keys[e.key] + CP.THEMES.length) % CP.THEMES.length]; choose(n); const b = $(`#themeGrid [data-theme=${n}]`); if (b) b.focus();
  });
  const prevState = X.onState; X.onState = () => { if (prevState) prevState(); apply(cur()); }; /* backup restore / reset / other tab */
  const prevSet = X.onSettings; X.onSettings = () => { if (prevSet) prevSet(); apply(cur()); };
  const qb = $('#themeQuick'); if (qb) qb.addEventListener('click', () => { const i = CP.THEMES.indexOf(cur()); choose(CP.THEMES[(i + 1) % CP.THEMES.length]); }); /* header button: cycles Dark, OLED, Neon, Pastel */
  X.theme = { apply, choose, cur }; apply(cur());
})();
