#!/usr/bin/env python3
"""ChronoPulse 4.2 Phase 3 — real-browser (headless Chromium) checks with a controlled clock and an AudioContext spy.
Not part of `npm test` (needs Playwright + Chromium). Run:  python3 e2e/phase3.e2e.py   (serves the project folder itself)
It proves behaviour in a real browser engine; it can NOT prove what a phone speaker/vibration motor does — see docs/RELEASE_GUIDE.md for the manual device checklist."""
import json, subprocess, sys, threading, http.server, socketserver, os, functools, datetime as dt
from zoneinfo import ZoneInfo
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
TZ = ZoneInfo('Asia/Kolkata')
TARGET = dt.datetime(2026, 10, 12, 10, 30, tzinfo=TZ)          # local target, minute resolution (as the app stores it)
AT = '2026-10-12T10:30'
results = []
def check(name, cond, extra=''):
    results.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name + (f'  [{extra}]' if extra and not cond else ''), flush=True)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
def serve():
    h = functools.partial(Quiet, directory=ROOT); s = socketserver.TCPServer(('127.0.0.1', 0), h); threading.Thread(target=s.serve_forever, daemon=True).start(); return s
srv = serve(); BASE = f'http://127.0.0.1:{srv.server_address[1]}/index.html'

def seed(cfg=None, sound=True, at=AT, extra_events=()):
    js = """const P=require('./lib/lib41.js');const a=JSON.parse(process.argv[1]);
const t0=new Date(2026,9,12,10,0).getTime();
const S=P.sanitize41({profile:{name:'Tester',dob:'1990-01-01'},events:[{id:'e1',title:'Rocket Test',at:a.at,desc:'',start:t0,completed:'',reminders:{d1:false,h1:false,m10:false,m1:false,end:false},fired:{},armed:false}].concat(a.extra),active:'e1',sound:a.sound,cfg:a.cfg||{}},{now:t0});
process.stdout.write(JSON.stringify(S));"""
    return subprocess.check_output(['node', '-e', js, json.dumps({'at': at, 'sound': sound, 'cfg': cfg or {}, 'extra': list(extra_events)})], cwd=ROOT, text=True)

SPY = """(() => { window.__a = { ctor: 0, osc: 0, src: 0, started: 0, states: [] }; const AC = window.AudioContext; if (!AC) return;
 class Spy extends AC { constructor() { super(); window.__a.ctor++; }
  createOscillator() { if (window.__failAudio) throw new Error('forced audio failure'); window.__a.osc++; const o = super.createOscillator(), s = o.start.bind(o); o.start = (...x) => { window.__a.started++; return s(...x); }; return o; }
  createBufferSource() { if (window.__failAudio) throw new Error('forced audio failure'); window.__a.src++; const o = super.createBufferSource(), s = o.start.bind(o); o.start = (...x) => { window.__a.started++; return s(...x); }; return o; } }
 window.AudioContext = Spy; })();"""

class Run:
    def __init__(self, pw, state, reduced=False, fail_audio=False, left_ms=100000):
        self.errors = []
        self.browser = pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE'), args=['--no-sandbox', '--autoplay-policy=document-user-activation-required'])
        self.ctx = self.browser.new_context(viewport={'width': 390, 'height': 844}, timezone_id='Asia/Kolkata', locale='en-IN', service_workers='block', reduced_motion='reduce' if reduced else 'no-preference', permissions=[])
        self.ctx.add_init_script(f"if(!localStorage.getItem('chronopulse:v4.1'))localStorage.setItem('chronopulse:v4.1',{json.dumps(state)});")
        self.ctx.add_init_script(SPY)
        if fail_audio: self.ctx.add_init_script('window.__failAudio = true;')
        self.page = self.ctx.new_page(); self.page.on('pageerror', lambda e: self.errors.append(str(e))); self.page.on('console', lambda m: self.errors.append('console.error: ' + m.text) if m.type == 'error' else None)
        self.left = left_ms
        self.page.clock.install(time=TARGET - dt.timedelta(milliseconds=left_ms))
        self.page.goto(BASE); self.page.wait_for_selector('#cdLive:not([hidden])')
        now = self.page.evaluate('Date.now()'); self.page.clock.pause_at(dt.datetime.fromtimestamp((now + 300) / 1000, tz=TZ))
        self.left = int(TARGET.timestamp() * 1000 - self.page.evaluate('Date.now()'))  # the real paused clock, not the requested one (they differ under load)
    def to(self, left_ms):  # advance the fake clock so `left_ms` remain until the target
        d = self.left - left_ms
        if d > 0: self.page.clock.run_for(d); self.left = left_ms
    def a(self): return self.page.evaluate('window.__a')
    def vis(self, sel): return self.page.evaluate(f"(()=>{{const e=document.querySelector('{sel}');return !!e&&!e.hidden&&getComputedStyle(e).display!=='none'}})()")
    def txt(self, sel): return self.page.evaluate(f"document.querySelector('{sel}').textContent")
    def store(self): return json.loads(self.page.evaluate("localStorage.getItem('chronopulse:v4.1')"))
    def close(self): self.browser.close()

with sync_playwright() as pw:
    # ---------- 1. full countdown with sound unlocked by a tap ----------
    r = Run(pw, seed())
    check('boot: no page errors, Countdown live, no sound engine created before any gesture', not r.errors and r.a()['ctor'] == 0, r.errors)
    r.to(95000)
    check('autoplay: hint "tap once to allow sound" is shown in the last 2 minutes while sound is locked', r.vis('#cineHint') and 'Tap anywhere' in r.txt('#cineHint'))
    r.page.mouse.click(200, 700); r.page.wait_for_timeout(300)
    check('autoplay: a real tap creates exactly one AudioContext', r.a()['ctor'] == 1, r.a())
    r.to(90000)
    check('hint disappears once sound is unlocked', not r.vis('#cineHint'))
    r.to(61000)
    check('before the final minute: no warning visuals, no sound played', not r.page.evaluate("document.querySelector('.hero').classList.contains('fx-minute')") and r.a()['started'] == 0)
    r.to(59000)
    check('final minute: hero gets the warning state and the "Final minute" label shows', r.page.evaluate("document.querySelector('.hero').classList.contains('fx-minute')") and r.vis('#cineMinute'))
    check('final minute: the warning sound played exactly once (2 tones)', r.a()['osc'] == 2 and r.a()['started'] == 2, r.a())
    r.to(30000); r.to(15000)
    check('warning does not repeat while the minute runs', r.a()['osc'] == 2, r.a())
    check('screen-reader live region announced the final minute once', 'one minute left' in r.txt('#cineSr'))
    r.to(10400); check('final ten: big number overlay is not shown before 10 s', not r.vis('#cineTen'))
    digits = []; osc_after = []
    for left in range(9900, 0, -1000):
        r.to(left); digits.append(r.txt('#cineTenN')); osc_after.append(r.a()['osc'])
    check('final ten: displayed digits are 10..1 in order, one per second', digits == [str(n) for n in range(10, 0, -1)], digits)
    check('final ten: overlay visible and never blocks taps (pointer-events:none)', r.vis('#cineTen') and r.page.evaluate("getComputedStyle(document.querySelector('#cineTen')).pointerEvents") == 'none')
    check('final ten: exactly one beep per digit (10 beeps after the 2 warning tones)', osc_after == list(range(3, 13)), osc_after)
    check('before the target: celebration is not open', not r.page.evaluate("document.querySelector('#cineDlg').open"))
    r.to(-300)
    check('completion: full-screen overlay opens with the event name', r.page.evaluate("document.querySelector('#cineDlg').open") and r.txt('#cineTitle') == 'Rocket Test')
    check('completion: the ten-second overlay is gone', not r.vis('#cineTen') and not r.page.evaluate("document.querySelector('.hero').classList.contains('fx-minute')"))
    a = r.a(); check('completion: dramatic impact scheduled (riser + boom + blast + sparkles)', a['osc'] - 12 == 4 and a['src'] == 3, a)
    check('completion: persisted once (completed == target) and one claim token stored', r.store()['events'][0]['completed'] == AT and json.loads(r.page.evaluate("localStorage.getItem('chronopulse:v4.1:cine')")) == ['e1|' + AT])
    r.page.screenshot(path='/tmp/shot_launch.png'); r.to(-1500); r.page.screenshot(path='/tmp/shot_blast.png')
    px = r.page.evaluate("(()=>{const c=document.querySelector('#cineCv'),x=c.getContext('2d'),d=x.getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i]>20)n++;return n})()")
    check('completion: rocket/explosion canvas is actually drawing particles', px > 500, px)
    r.to(-9000)
    px2 = r.page.evaluate("(()=>{const c=document.querySelector('#cineCv'),x=c.getContext('2d'),d=x.getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i]>20)n++;return n})()")
    check('completion: animation ends by itself (canvas cleared, no endless loop)', px2 == 0, px2)
    before = r.a()['started']; r.page.click('#cineReplay'); r.page.wait_for_timeout(200)
    check('Replay: plays the sound again and restarts the picture', r.a()['started'] > before)
    r.page.click('#cineMute'); check('Mute: stops the sound now, label becomes Unmute, aria-pressed true', r.txt('#cineMute') == 'Unmute' and r.page.get_attribute('#cineMute', 'aria-pressed') == 'true')
    s0 = r.a()['started']; r.page.click('#cineReplay'); r.page.wait_for_timeout(200)
    check('Mute: a muted Replay starts no sound', r.a()['started'] == s0)
    r.page.click('#cineRm')
    check('Reduce motion (in overlay): calm screen, canvas hidden, preference saved in settings', r.page.evaluate("document.querySelector('.cine-wrap').classList.contains('rm')") and r.store()['cfg']['fxReduced'] is True and r.page.evaluate("document.documentElement.classList.contains('cp-rm')"))
    r.page.click('#cineClose'); check('Close: overlay closes and all sound stops', not r.page.evaluate("document.querySelector('#cineDlg').open"))
    r.to(-60000)
    check('no second celebration later (single-play)', not r.page.evaluate("document.querySelector('#cineDlg').open"))
    r.page.reload(); r.page.wait_for_selector('#cdLive:not([hidden])'); r.page.clock.run_for(3000)
    check('page refresh after completion: no celebration repeats; state still completed', not r.page.evaluate("document.querySelector('#cineDlg').open") and r.store()['events'][0]['completed'] == AT)
    check('no page errors during the whole run', not r.errors, r.errors); r.close()

    # ---------- 2. never unlocked: countdown + overlay still work, honestly silent ----------
    r = Run(pw, seed(), left_ms=15000); r.to(5000); r.to(-300)
    check('locked audio: countdown still reached completion and the overlay opened', r.page.evaluate("document.querySelector('#cineDlg').open"), r.page.evaluate('[document.hidden, document.visibilityState, localStorage.getItem("chronopulse:v4.1:cine")]'))
    check('locked audio: no AudioContext was ever created and the overlay says why', r.a()['ctor'] == 0 and 'tap' in r.txt('#cineNote').lower(), r.txt('#cineNote'))
    check('locked audio: no page errors', not r.errors, r.errors); r.close()

    # ---------- 3. audio failure must not break the timers ----------
    r = Run(pw, seed(), left_ms=15000); r.page.mouse.click(200, 700); r.page.wait_for_timeout(200); r.to(8500)
    d1 = r.txt('#cineTenN'); r.to(3500); d2 = r.txt('#cineTenN'); r.to(-300)
    check('audio failure: digits kept counting down and completion still fired', d1 == '9' and d2 == '4' and r.page.evaluate("document.querySelector('#cineDlg').open") and r.store()['events'][0]['completed'] == AT, (d1, d2))
    check('audio failure: no uncaught exceptions leaked', not r.errors, r.errors); r.close()
    r = Run(pw, seed(), left_ms=15000)
    r.page.mouse.click(200, 700); r.page.evaluate('window.__failAudio = true'); r.to(5000); r.to(-300)
    check('audio failure mid-run (after unlock): countdown + overlay unaffected, no errors', r.page.evaluate("document.querySelector('#cineDlg').open") and not r.errors, (r.errors, r.page.evaluate('[document.hidden, document.visibilityState]'))); r.close()

    # ---------- 4. master sound off ----------
    r = Run(pw, seed(sound=False), left_ms=15000); r.page.mouse.click(200, 700); r.to(5000); r.to(-300)
    check('master sound OFF: visuals + overlay work, but zero voices and no AudioContext', r.vis('#cineDlg') or r.page.evaluate("document.querySelector('#cineDlg').open"))
    check('master sound OFF: nothing synthesized', r.a()['started'] == 0 and r.a()['ctor'] == 0, r.a()); check('master sound OFF: Mute button says "Sound off" and is disabled', r.txt('#cineMute') == 'Sound off' and r.page.is_disabled('#cineMute')); r.close()

    # ---------- 5. device reduced-motion ----------
    r = Run(pw, seed(), reduced=True, left_ms=15000); r.page.mouse.click(200, 700); r.to(5500); r.to(-300)
    check('device reduced motion: digits still shown (no animation), overlay is the calm screen', r.page.evaluate("document.querySelector('.cine-wrap').classList.contains('rm')") and r.page.evaluate("getComputedStyle(document.querySelector('.cine-msg')).animationName") == 'none')
    check('device reduced motion: canvas hidden, message visible, in-overlay switch locked on', not r.vis('#cineCv') and r.vis('.cine-msg') and r.page.is_disabled('#cineRm'))
    a = r.a(); check('device reduced motion: sound starts at the impact (riser skipped: 3 osc + 2 noise)', a['osc'] == 10 + 3 and a['src'] == 2, a)  # 10 beeps + trimmed impact; the final-minute warning was skipped on purpose: its first frame ran before the tap, while audio was still locked
    r.close()

    # ---------- 6. settings UI + persistence + preview ----------
    r = Run(pw, seed(), left_ms=500000); r.page.evaluate("showTab('settings')")
    r.page.fill('#fxVol', '40'); r.page.dispatch_event('#fxVol', 'change'); r.page.select_option('#fxSound', 'fanfare'); r.page.select_option('#fxTen', 'synth'); r.page.click('#fxWarn'); r.page.click('#fxRed')
    st = r.store()['cfg']
    check('settings: volume, sound, ten-second style, warning switch and reduced-motion persist into cfg (schema 7 data)', (st['fxVolume'], st['fxSound'], st['fxTen'], st['fxWarn'], st['fxReduced']) == (40, 'fanfare', 'synth', False, True) and r.store()['v'] == 7, st)
    r.page.click('#fxPrev'); r.page.wait_for_timeout(300)
    check('settings: Preview is a gesture — it unlocks audio and plays the chosen sound', r.a()['ctor'] == 1 and r.a()['started'] >= 3, r.a())
    g = r.page.evaluate("document.querySelector('#fxState').textContent"); check('settings: engine status line reads "ready"', 'ready' in g, g)
    r.page.click('#fxDemo'); r.page.wait_for_timeout(200)
    check('settings: "Preview the full celebration" opens the overlay without completing anything', r.page.evaluate("document.querySelector('#cineDlg').open") and r.txt('#cineTitle') == 'Preview' and r.store()['events'][0]['completed'] == '')
    r.page.keyboard.press('Escape'); check('overlay closes with Escape', not r.page.evaluate("document.querySelector('#cineDlg').open"))
    r.page.click('#sAudio'); s0 = r.a()['started']; r.page.click('#fxPrev')
    check('settings: master switch off silences previews', r.a()['started'] == s0 and r.store()['sound'] is False)
    check('settings: no page errors', not r.errors, r.errors); r.close()

    # ---------- 7. hidden page: celebration is deferred, then shown (or just toasted if too late) ----------
    r = Run(pw, seed(), left_ms=15000); r.page.mouse.click(200, 700)
    r.page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'hidden'})")
    r.to(-5000); r.page.evaluate('reconcileNow()')
    check('hidden at completion: no overlay while hidden, event is marked completed', not r.page.evaluate("document.querySelector('#cineDlg').open") and r.store()['events'][0]['completed'] == AT)
    r.page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'visible'});document.dispatchEvent(new Event('visibilitychange'))")
    check('returning within 5 minutes: the celebration plays once', r.page.evaluate("document.querySelector('#cineDlg').open")); r.close()
    r = Run(pw, seed(), left_ms=15000); r.page.mouse.click(200, 700)
    r.page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'hidden'})")
    r.to(-5000); r.page.evaluate('reconcileNow()'); r.page.clock.fast_forward(6 * 60000)
    r.page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'visible'});document.dispatchEvent(new Event('visibilitychange'))")
    check('returning after 5+ minutes: no stale celebration, a toast says it reached its target', not r.page.evaluate("document.querySelector('#cineDlg').open") and 'reached its target' in r.txt('#toast'), r.txt('#toast')); r.close()

    # ---------- 8. leaving the Countdown screen clears the final-ten overlay ----------
    r = Run(pw, seed(), left_ms=15000); r.to(6000); shown = r.vis('#cineTen'); r.page.evaluate("showTab('profile')"); r.page.clock.run_for(100)
    check('leaving Countdown hides the big number and the warning state', shown and not r.vis('#cineTen')); r.close()

srv.shutdown()
bad = [n for n, ok in results if not ok]
print(f'\nE2E: {len(results) - len(bad)} passed, {len(bad)} failed of {len(results)}')
sys.exit(1 if bad else 0)
