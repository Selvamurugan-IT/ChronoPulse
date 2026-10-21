/* ChronoPulse — theme bootstrap. Loaded SYNCHRONOUSLY in <head> (before the page is painted) so a saved theme never flashes the default one.
   Reads only cfg.theme from the app's normal saved data (key chronopulse:v4.1) and sets <html data-theme> plus the browser bar colour. Never throws, sends nothing,
   writes nothing. The colours below must match themes.css (tests/themes.test.js checks it). */
(function () {
  var THEMES = { dark: '#0a0d14', oled: '#000000', neon: '#06010f', pastel: '#f6f1fa' }, t = 'dark';
  try { var raw = localStorage.getItem('chronopulse:v4.1'), c = raw && JSON.parse(raw).cfg; if (c && typeof c.theme === 'string' && Object.prototype.hasOwnProperty.call(THEMES, c.theme)) t = c.theme; } catch (e) { /* storage blocked or corrupt: default theme */ }
  var h = document.documentElement; h.setAttribute('data-theme', t);
  var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', THEMES[t]);
})();
