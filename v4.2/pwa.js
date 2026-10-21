'use strict';
/* ChronoPulse 4.1 — PWA glue: service-worker registration, update workflow, offline status, install prompt.
   Every status shown here comes from what the browser actually reported; nothing is assumed. */
(function () {
  const st = { ctx: '', sw: 'idle', swMsg: '', offline: null, version: '', waiting: null, installed: false, standalone: false };
  let reg = null, deferred = null, updateRequested = false, reloading = false;
  const $ = (s, r = document) => r.querySelector(s);

  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  function context() {
    if (location.protocol === 'file:') return 'file';
    if (isSecureContext) return location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname === '[::1]' ? 'localhost' : 'https';
    return 'insecure';
  }
  const CTX_TEXT = {
    file: 'Opened as a local file (file://). The app works, but browsers do not allow offline install or the install button here. Run a local server (localhost) or use the HTTPS site.',
    insecure: 'Opened over plain HTTP on a network address. Browsers only allow service workers and installation on HTTPS or localhost, so offline install is unavailable here.',
    localhost: 'Secure context: localhost. Service worker and offline caching are available.',
    https: 'Secure context: HTTPS. Service worker, offline caching and installation are available.'
  };

  async function checkCache() {
    if (!reg || !reg.active) return;
    try {
      const ch = new MessageChannel(), res = await new Promise((ok, no) => { const t = setTimeout(() => no(new Error('timeout')), 4000); ch.port1.onmessage = e => { clearTimeout(t); ok(e.data); }; reg.active.postMessage({ type: 'STATUS' }, [ch.port2]); });
      st.version = res.version; st.offline = res.complete ? 'ready' : 'incomplete'; st.swMsg = res.complete ? '' : 'Missing from cache: ' + res.missing.join(', ');
    } catch (e) { st.offline = 'unknown'; }
    render();
  }

  function showUpdate(worker) {
    st.waiting = worker; render();
    if (window.CPX && CPX.banner) CPX.banner('update', 'A new version of ChronoPulse is ready.', [{ label: 'Update now', fn: applyUpdate }, { label: 'Later' }]);
  }
  async function applyUpdate() {
    const w = (reg && reg.waiting) || st.waiting; if (!w) { if (reg) reg.update().catch(() => {}); return; }
    const running = typeof S !== 'undefined' && S.timer && S.timer.status !== 'idle';
    if (running && typeof ask === 'function' && !await ask('A focus session is in progress', 'The timer is saved and keeps counting from the clock, so it will continue after the app reloads. Update now?', 'Update and reload')) return;
    updateRequested = true; w.postMessage({ type: 'SKIP_WAITING' });
    setTimeout(() => { if (!reloading && updateRequested) { updateRequested = false; if (typeof toast === 'function') toast('Update did not start. Close other ChronoPulse tabs and try again.'); } }, 6000);
  }

  function watch(r) {
    if (r.waiting && navigator.serviceWorker.controller) showUpdate(r.waiting);
    r.addEventListener('updatefound', () => {
      const w = r.installing; if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed') { if (navigator.serviceWorker.controller) showUpdate(w); else checkCache(); }
        if (w.state === 'redundant' && !navigator.serviceWorker.controller) { st.sw = 'error'; st.swMsg = 'Offline setup failed: the app files could not all be saved. Check your connection and reload.'; render(); }
        if (w.state === 'redundant' && navigator.serviceWorker.controller && !r.waiting) { st.swMsg = 'The last update could not be downloaded completely. The current version keeps working; it will retry.'; render(); }
      });
    });
  }

  async function init() {
    st.ctx = context(); st.standalone = standalone();
    if (!('serviceWorker' in navigator)) { st.sw = 'unsupported'; st.swMsg = st.ctx === 'insecure' || st.ctx === 'file' ? CTX_TEXT[st.ctx] : 'This browser does not support service workers.'; render(); return; }
    if (st.ctx === 'file' || st.ctx === 'insecure') { st.sw = 'unsupported'; st.swMsg = 'Needs HTTPS or localhost.'; render(); return; }
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!updateRequested || reloading) return; reloading = true; location.reload(); }); /* reload only when the user asked for the update: no loops, no surprise reloads */
    try {
      st.sw = 'registering'; render();
      reg = await navigator.serviceWorker.register('service-worker.js', { scope: './', updateViaCache: 'none' });
      st.sw = 'ready'; watch(reg); await navigator.serviceWorker.ready; checkCache();
      const poke = () => reg.update().catch(() => {}); addEventListener('online', poke); document.addEventListener('visibilitychange', () => { if (!document.hidden) poke(); });
    } catch (e) { st.sw = 'error'; st.swMsg = 'Service worker could not start (' + (e && e.name || 'error') + '). The app still works online; offline mode is unavailable.'; render(); }
  }

  /* online / offline */
  const pill = () => $('#netPill'), setNet = (announce) => { const off = !navigator.onLine, p = pill(); if (p) p.hidden = !off; if (announce && typeof toast === 'function') toast(off ? 'You are offline. Everything saved on this device still works.' : 'Back online.'); render(); };
  addEventListener('offline', () => setNet(true)); addEventListener('online', () => setNet(true));

  /* install */
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; render(); });
  addEventListener('appinstalled', () => { deferred = null; st.installed = true; render(); if (typeof toast === 'function') toast('ChronoPulse was installed.'); });
  matchMedia('(display-mode: standalone)').addEventListener && matchMedia('(display-mode: standalone)').addEventListener('change', () => { st.standalone = standalone(); render(); });
  async function install() {
    if (!deferred) return; const d = deferred; deferred = null; render();
    try { d.prompt(); const r = await d.userChoice; if (typeof toast === 'function') toast(r.outcome === 'accepted' ? 'Install accepted. Your browser is finishing the installation.' : 'Install dismissed. You can install later from this page.'); } catch (e) { /* prompt can only be used once */ }
  }

  function howTo() {
    const ua = navigator.userAgent, ios = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1), android = /android/i.test(ua);
    if (ios) return 'iPhone / iPad (Safari): tap the Share button, then “Add to Home Screen”.';
    if (android) return 'Android (Chrome): open the ⋮ menu, then “Install app” (or “Add to Home screen”). Requires the HTTPS site; a plain-HTTP LAN address cannot be installed.';
    return 'Desktop (Chrome / Edge): click the install icon at the right of the address bar, or open the browser menu and choose “Install ChronoPulse”. Firefox desktop does not support installing web apps.';
  }

  function render() {
    const box = $('#pwaBox'); if (!box) return;
    const rows = [];
    rows.push(['Context', CTX_TEXT[st.ctx] || '']);
    const sw = st.sw === 'ready' ? (st.offline === 'ready' ? `Offline ready — all app files are saved on this device${st.version ? ' (version ' + st.version + ')' : ''}.` : st.offline === 'incomplete' ? 'Offline setup is incomplete. Reload while online. ' + st.swMsg : 'Service worker running; checking saved files…') : st.sw === 'registering' ? 'Setting up offline mode…' : st.sw === 'unsupported' ? 'Offline mode unavailable. ' + st.swMsg : st.sw === 'error' ? st.swMsg : 'Not started.';
    rows.push(['Offline mode', sw + (st.swMsg && st.sw === 'ready' && st.offline !== 'incomplete' ? ' ' + st.swMsg : '')]);
    rows.push(['Network', navigator.onLine ? 'Browser reports: online.' : 'Browser reports: offline.']);
    rows.push(['Installation', st.standalone ? 'Running as an installed app.' : st.installed ? 'Installed (reported by the browser).' : deferred ? 'Your browser can install ChronoPulse — use the button below.' : 'Not installed. ' + howTo()]);
    rows.push(['Updates', st.waiting || (reg && reg.waiting) ? 'An update is downloaded and ready.' : 'Updates are downloaded when you are online and applied only when you choose.']);
    box.textContent = ''; const dl = document.createElement('dl'); dl.className = 'kv';
    for (const [k, v] of rows) { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = k; dd.textContent = v; dl.append(dt, dd); }
    box.appendChild(dl);
    const b = $('#installBtn'); if (b) b.hidden = !deferred;
    const u = $('#updateBtn'); if (u) { u.hidden = !(st.waiting || (reg && reg.waiting)); }
    const c = $('#checkUpdBtn'); if (c) c.hidden = !reg;
  }
  async function checkNow() { if (!reg) return; try { await reg.update(); if (typeof toast === 'function') toast(reg.waiting || reg.installing ? 'An update was found.' : 'You are on the latest version.'); } catch (e) { if (typeof toast === 'function') toast('Could not check for updates (offline?).'); } render(); }

  window.PWA = { render, init, install, applyUpdate, checkNow, state: st };
  document.addEventListener('click', e => { const t = e.target.closest('#installBtn,#updateBtn,#checkUpdBtn'); if (!t) return; ({ installBtn: install, updateBtn: applyUpdate, checkUpdBtn: checkNow })[t.id](); });
  const go = () => { setNet(false); init(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})();
