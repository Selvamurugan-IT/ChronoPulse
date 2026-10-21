"""Shared helpers for the real-browser (headless Chromium) suites. Needs Playwright + Chromium; NOT part of `npm test`."""
import json, subprocess, threading, http.server, socketserver, os, functools, datetime as dt, urllib.parse
from zoneinfo import ZoneInfo
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
TZ = ZoneInfo('Asia/Kolkata')
results = []
def check(name, cond, extra=''):
    results.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name + (f'  [{extra}]' if extra and not cond else ''), flush=True)
def summary(label):
    bad = [n for n, ok in results if not ok]; print(f'\n{label}: {len(results) - len(bad)} passed, {len(bad)} failed of {len(results)}'); return 1 if bad else 0

def serve(prefix=''):
    """Serve the project folder. With prefix='/repository-name' it behaves like a GitHub Pages project site (files only exist under that folder)."""
    class H(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
        def translate_path(self, path):
            p = urllib.parse.urlparse(path).path
            if prefix:
                if not p.startswith(prefix + '/') and p != prefix: return os.path.join(ROOT, '__not_found__')
                p = p[len(prefix):] or '/'
            return super().translate_path(p)
    h = functools.partial(H, directory=ROOT); s = socketserver.TCPServer(('127.0.0.1', 0), h); threading.Thread(target=s.serve_forever, daemon=True).start()
    return s, f'http://127.0.0.1:{s.server_address[1]}{prefix}/'

SEED_JS = """const P=require('./lib/lib41.js');const a=JSON.parse(process.argv[1]);const now=new Date(a.now).getTime();
const S=P.sanitize41(Object.assign({profile:{name:'Tester',dob:'1990-01-01'},active:a.events.length?a.events[0].id:null,sound:a.sound,cfg:a.cfg||{}},{events:a.events,goals:a.goals,todos:a.todos,sessions:a.sessions}),{now});
process.stdout.write(JSON.stringify(S));"""
def seed(now_iso, events=(), goals=(), todos=(), sessions=(), cfg=None, sound=True):
    return subprocess.check_output(['node', '-e', SEED_JS, json.dumps({'now': now_iso, 'events': list(events), 'goals': list(goals), 'todos': list(todos), 'sessions': list(sessions), 'cfg': cfg or {}, 'sound': sound})], cwd=ROOT, text=True)
def days(a, b):
    d0, d1 = dt.date.fromisoformat(a), dt.date.fromisoformat(b); return [(d0 + dt.timedelta(n)).isoformat() for n in range((d1 - d0).days + 1)]
def event(id, title, at, reminders=None, start='2026-10-01T00:00'):
    return {'id': id, 'title': title, 'at': at, 'desc': '', 'start': int(dt.datetime.fromisoformat(start).replace(tzinfo=TZ).timestamp() * 1000), 'completed': '', 'fired': {}, 'armed': False,
            'reminders': reminders or {'d1': False, 'h1': False, 'm10': False, 'm1': False, 'end': False}}
def habit(h, id='g1'): return {'id': id, 'title': 'Daily', 'tasks': [{'id': 't1', 'name': 'Run', 'h': h}]}

class Page:
    """A browser page whose clock is installed at `now` and then PAUSED, so tests move time deterministically with advance()."""
    def __init__(self, pw, state, now, locale='en-US', width=390, height=844, reduced=False, init=(), service_workers='block', clock=True):
        self.errors = []; self.browser = pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE'), args=['--no-sandbox'])
        self.ctx = self.browser.new_context(viewport={'width': width, 'height': height}, timezone_id='Asia/Kolkata', locale=locale, service_workers=service_workers, reduced_motion='reduce' if reduced else 'no-preference')
        if state is not None: self.ctx.add_init_script(f"if(!localStorage.getItem('chronopulse:v4.1'))localStorage.setItem('chronopulse:v4.1',{json.dumps(state)});")
        for s in init: self.ctx.add_init_script(s)
        self.page = self.ctx.new_page(); self.page.on('pageerror', lambda e: self.errors.append(str(e)))
        self.page.on('console', lambda m: self.errors.append('console.error: ' + m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        self.now = now; self.use_clock = clock
        if clock: self.page.clock.install(time=now)
    def open(self, url, wait='#streakBtn'):
        self.page.goto(url); self.page.wait_for_selector(wait, state='attached')
        if self.use_clock:
            n = self.page.evaluate('Date.now()'); self.page.clock.pause_at(dt.datetime.fromtimestamp((n + 300) / 1000, tz=TZ)); self.t = self.page.evaluate('Date.now()')
    def advance(self, ms): self.page.clock.run_for(ms); self.t += ms
    def jump(self, ms): self.page.clock.fast_forward(ms); self.t += ms
    def txt(self, sel): return self.page.evaluate(f"document.querySelector('{sel}').textContent")
    def vis(self, sel): return self.page.evaluate(f"(()=>{{const e=document.querySelector('{sel}');return !!e&&!e.hidden&&getComputedStyle(e).display!=='none'}})()")
    def store(self): return json.loads(self.page.evaluate("localStorage.getItem('chronopulse:v4.1')"))
    def close(self): self.browser.close()
