#!/usr/bin/env python3
"""Real-browser service-worker / offline / GitHub Pages check.
   python3 e2e/offline.e2e.py                       # served from the site root
   python3 e2e/offline.e2e.py /repository-name      # served like https://username.github.io/repository-name/  (project site, subfolder scope)
Proves: scope = the folder, precache complete (incl. both audio files), offline reload works, Range requests are answered 206 FROM THE CACHE even though this
test server (like many static servers) does not support Range itself, and nothing outside the folder is touched."""
import sys, os, re
sys.path.insert(0, os.path.dirname(__file__))
from common import *
from playwright.sync_api import sync_playwright
PREFIX = sys.argv[1].rstrip('/') if len(sys.argv) > 1 else ''
srv, BASE = serve(PREFIX); ORIGIN = BASE[:BASE.index('/', 8)]
J = """async (u) => { const r = await fetch(u, { headers: { Range: 'bytes=0-9' } }); const full = await fetch(u); return { s: r.status, cr: r.headers.get('Content-Range'), ar: r.headers.get('Accept-Ranges'), n: (await r.arrayBuffer()).byteLength, fs: full.status, fn: (await full.arrayBuffer()).byteLength }; }"""
html = open(os.path.join(ROOT, 'index.html')).read(); SCRIPTS = re.findall(r'<script defer src="([^"]+)"', html)
label = PREFIX or '(root)'
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE'), args=['--no-sandbox']); ctx = b.new_context(viewport={'width': 390, 'height': 844}); errs = []
    p = ctx.new_page(); p.on('pageerror', lambda e: errs.append(str(e)))
    p.goto(BASE + 'index.html'); p.evaluate("navigator.serviceWorker.ready.then(() => true)"); p.wait_for_timeout(2500)
    reg = p.evaluate("navigator.serviceWorker.getRegistration().then(r => ({ scope: r.scope, script: r.active && r.active.scriptURL }))")
    check(f'{label} service worker scope is exactly the app folder', reg['scope'] == BASE and reg['script'] == BASE + 'service-worker.js', reg)
    names = p.evaluate("caches.keys()"); check(f'{label} cache name is the 4.2 one', names == ['chronopulse-v4.2-4.2.5'], names)
    cached = p.evaluate("caches.open('chronopulse-v4.2-4.2.5').then(c => c.keys()).then(k => k.map(r => r.url))")
    check(f'{label} every cached URL is inside the app folder', all(u.startswith(BASE) for u in cached), [u for u in cached if not u.startswith(BASE)])
    rel = {u[len(BASE):] for u in cached}
    for f in ['doomsday-tick.mp3', 'assets/chime.wav', 'index.html', 'manifest.json'] + SCRIPTS: check(f'{label} precached: {f}', f in rel or (f == 'index.html' and '' in rel), sorted(rel)[:5])
    mf = p.evaluate("fetch(document.querySelector('link[rel=manifest]').href).then(r => r.json()).then(m => ({ start: new URL(m.start_url, document.querySelector('link[rel=manifest]').href).href, scope: new URL(m.scope, document.querySelector('link[rel=manifest]').href).href }))")
    check(f'{label} manifest start_url and scope resolve to the app folder', mf['start'] == BASE and mf['scope'] == BASE, mf)
    p.reload(); p.wait_for_timeout(1000); check(f'{label} page is controlled by the worker', p.evaluate("!!navigator.serviceWorker.controller"))
    ctx.set_offline(True); srv.shutdown(); srv.server_close()  # the server is GONE: nothing below can come from the network (Playwright's offline mode does not cover the worker's own requests)
    p.reload(); p.wait_for_selector('#streakBtn', state='attached', timeout=15000); check(f'{label} OFFLINE reload of index.html starts the app (streak badge present)', True)
    p.goto(BASE); p.wait_for_selector('#streakBtn', state='attached', timeout=15000); check(f'{label} OFFLINE open of the folder URL itself starts the app', True)
    for u in ['doomsday-tick.mp3', 'assets/chime.wav']:
        r = p.evaluate(J, BASE + u); check(f'{label} OFFLINE {u}: Range -> 206, 10 bytes, Content-Range, Accept-Ranges', r['s'] == 206 and r['n'] == 10 and (r['cr'] or '').startswith('bytes 0-9/') and r['ar'] == 'bytes', r)
        check(f'{label} OFFLINE {u}: full request -> 200 from cache', r['fs'] == 200 and r['fn'] > 10000, r)
    ok = p.evaluate("""new Promise(res => { const a = new Audio('doomsday-tick.mp3'); a.preload = 'auto'; a.addEventListener('loadedmetadata', () => res({ d: a.duration })); a.addEventListener('error', () => res({ err: a.error && a.error.code })); setTimeout(() => res({ timeout: true }), 8000); })""")
    check(f'{label} OFFLINE: the browser loads the tick mp3 as audio (duration > 0)', 'd' in ok and ok['d'] > 0, ok)
    out = p.evaluate("fetch(location.origin + '/definitely-outside-the-app.txt').then(r => 'status ' + r.status, () => 'network error')")
    check(f'{label} requests outside the app folder are not answered by the worker', out == 'network error', out)
    check(f'{label} no page errors', not errs, errs); b.close()
sys.exit(summary(f'OFFLINE E2E {label}'))
