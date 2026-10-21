#!/usr/bin/env python3
"""Reminder sound selector in a real browser: built-ins, custom upload + validation, IndexedDB / localStorage storage, persistence, foreground playback on a real
reminder, gating (hidden page, master off, system choice), Reset wiping, offline. Run: python3 e2e/sound.e2e.py"""
import sys, os, io, math, wave, struct, datetime as dt, json
sys.path.insert(0, os.path.dirname(__file__))
from common import *
from playwright.sync_api import sync_playwright
srv, BASE = serve(); URL = BASE + 'index.html'
T = dt.datetime(2026, 10, 12, 10, 30, tzinfo=TZ); NOW = T - dt.timedelta(seconds=100); AT = '2026-10-12T10:30'
def wav(sec=0.6, rate=8000, width=2):
    b = io.BytesIO(); w = wave.open(b, 'wb'); w.setnchannels(1); w.setsampwidth(width); w.setframerate(rate)
    for i in range(int(sec * rate)):
        v = math.sin(2 * math.pi * 440 * i / rate); w.writeframes(struct.pack('<h', int(v * 12000)) if width == 2 else bytes([int(128 + v * 90)]))
    w.close(); return b.getvalue()
SPY = """(() => { window.__plays = []; const op = HTMLMediaElement.prototype.play;
 HTMLMediaElement.prototype.play = function () { const r = { src: this.src || this.currentSrc, vol: this.volume, role: this.dataset && this.dataset.cp }; window.__plays.push(r); const p = op.call(this); if (p && p.then) p.then(() => { r.ok = true; }, e => { r.err = e.name; }); return p; }; })();"""
NO_IDB = "Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true });"
M1 = {'d1': False, 'h1': False, 'm10': False, 'm1': True, 'end': False}
def st(cfg=None, n=1, sound=True): return seed(NOW.isoformat(), events=[event(f'e{i}', f'Launch {i}', AT, M1) for i in range(n)], cfg=cfg, sound=sound)
def idb(p): return p.page.evaluate("new Promise(res=>{const r=indexedDB.open('chronopulse-sound',1);r.onsuccess=()=>{try{const g=r.result.transaction('sounds').objectStore('sounds').get('reminder');g.onsuccess=()=>res(g.result?{name:g.result.name,size:g.result.size,isBlob:g.result.blob instanceof Blob,type:g.result.blob.type}:null)}catch(e){res('nostore')}};r.onerror=()=>res('err')})")
def dbs(p): return p.page.evaluate("indexedDB.databases().then(l=>l.map(d=>d.name))")
def plays(p): return p.page.evaluate("window.__plays.filter(x => x.role === 'reminder-sound')")  # only OUR element (the countdown tick has its own audio)
def note(p): return p.txt('#nsNote')
def upload(p, name, data, mime='audio/wav'):
    p.page.set_input_files('#nsFile', {'name': name, 'mimeType': mime, 'buffer': data}); p.page.wait_for_function("!/Checking the file/.test(document.querySelector('#nsNote').textContent)", timeout=15000)
def settings(p): p.page.evaluate("showTab('settings')"); p.page.wait_for_selector('#nsSound')
def page(pw, state, **kw):
    p = Page(pw, state, NOW, init=[SPY] + kw.pop('init', []), **kw); p.open(URL); return p
GOOD = wav()
with sync_playwright() as pw:
    # ---------- A. built-in choices ----------
    p = page(pw, st()); settings(p)
    opts = p.page.evaluate("[...document.querySelectorAll('#nsSound option')].map(o=>o.value+':'+o.textContent)")
    check('selector offers Default system / Chime / Custom (the tick is reserved for the countdown)', opts == ['system:Default system sound', 'chime:Chime', 'custom:Custom sound (your file)'], opts)
    check('default is the system sound and the note says so honestly', p.page.input_value('#nsSound') == 'system' and "phone's own notification sound" in note(p), note(p))
    p.page.click('#nsPrev'); check('Preview on "system" plays the Chime (what a finished session uses) and explains that reminders use the phone sound', len(plays(p)) == 1 and plays(p)[0]['src'].endswith('/assets/chime.wav') and 'phone' in note(p), note(p))
    p.page.select_option('#nsSound', 'chime'); p.page.click('#nsPrev'); p.page.wait_for_timeout(400); pl = plays(p)
    check('Chime: saved to settings and previewed from the precached asset', p.store()['cfg']['notifSound'] == 'chime' and len(pl) == 2 and pl[-1]['src'].endswith('/assets/chime.wav') and pl[-1].get('ok'), pl)
    p.page.evaluate("S.cfg.notifSound = 'tick'; save()"); p.page.reload(); p.page.wait_for_selector('#streakBtn', state='attached'); settings(p)
    check('an old "tick" choice becomes the Chime (the tick belongs to the countdown only)', p.page.input_value('#nsSound') == 'chime' and p.page.evaluate('S.cfg.notifSound') == 'chime')
    p.page.evaluate("S.cfg.fxVolume = 40; save()"); p.page.click('#nsPrev'); p.page.wait_for_timeout(300); check('Preview follows the volume setting (40%)', abs(plays(p)[-1]['vol'] - 0.4) < 0.01, plays(p)[-1])
    p.page.select_option('#nsSound', 'custom'); check('choosing Custom with no file asks for a file and keeps the safe fallback', 'Choose a file' in note(p) and p.txt('#nsName').startswith('No file chosen'))
    p.page.click('#nsPrev'); check('Preview of custom with no file is refused politely', 'Choose a file first' in note(p), note(p))
    p.page.evaluate("S.sound = false; save(); toggleSound === undefined"); p.page.evaluate("S.sound=false"); p.page.select_option('#nsSound', 'chime'); p.page.click('#nsPrev')
    check('master Sound off: Preview is refused and the note says why', 'Sound is off' in note(p), note(p)); check('A: no page errors', not p.errors, p.errors); p.close()

    # ---------- B. invalid uploads ----------
    p = page(pw, st()); settings(p)
    cases = [('notes.txt', b'hello world, not audio at all', 'text/plain', '.mp3 or .wav'), ('evil.mp3', b'MZ\x90\x00' + b'\x00' * 200, 'audio/mpeg', 'not a valid MP3 or WAV'),
             ('song.mp3', GOOD, 'audio/mpeg', 'named .mp3 but contains WAV'), ('huge.wav', b'RIFF' + b'\x00' * 4 + b'WAVE' + b'\x00' * 1_100_000, 'audio/wav', 'too large'),
             ('empty.wav', b'', 'audio/wav', 'empty'), ('long.wav', wav(31, 8000, 1), 'audio/wav', 'seconds long'), ('broken.wav', b'RIFF\x24\x00\x00\x00WAVEfmt garbage garbage', 'audio/wav', 'could not play')]
    for name, data, mime, msg in cases:
        upload(p, name, data, mime); check(f'rejected: {name} -> "{msg}"', msg in note(p) and p.store()['cfg']['notifSound'] == 'system', note(p))
    check('nothing was stored by any rejected file', idb(p) in (None, 'nostore', 'err') and p.page.evaluate("localStorage.getItem('chronopulse:v4.1:sound')") is None and 'chronopulse-sound' not in dbs(p) or idb(p) is None, idb(p))
    check('B: no page errors', not p.errors, p.errors); p.close()

    # ---------- C. valid upload (IndexedDB), persistence, preview ----------
    p = page(pw, st()); settings(p); upload(p, 'C:\\fakepath\\ding.wav', GOOD)
    c = p.store()['cfg']; rec = idb(p)
    check('valid WAV accepted: setting switched to Custom, display name sanitized, toast shown', c['notifSound'] == 'custom' and c['notifSoundName'] == 'ding.wav' and 'ding.wav' in p.txt('#nsName') and p.page.input_value('#nsSound') == 'custom' and 'Custom sound saved' in p.txt('#toast'), (c, p.txt('#nsName')))
    check('stored in IndexedDB as a Blob (name, size, type), not in localStorage', rec and rec['isBlob'] and rec['name'] == 'ding.wav' and rec['size'] == len(GOOD) and rec['type'] == 'audio/wav' and 'UklGR' not in p.page.evaluate("JSON.stringify({...localStorage})"), rec)
    check('Remove button appears; label becomes Replace…', p.vis('#nsRemove') and p.txt('#nsPick') == 'Replace…')
    p.page.click('#nsPrev'); p.page.wait_for_timeout(500); pl = plays(p)
    check('Preview plays the custom file from a blob: URL', len(pl) == 1 and pl[0]['src'].startswith('blob:') and pl[0].get('ok'), pl)
    p.page.reload(); p.page.wait_for_selector('#streakBtn', state='attached'); settings(p); p.page.wait_for_function("document.querySelector('#nsName').textContent.includes('ding.wav')")
    check('after a page refresh the custom sound is still there (selection + file)', p.page.input_value('#nsSound') == 'custom' and 'ding.wav' in p.txt('#nsName') and (idb(p) or {}).get('size') == len(GOOD))
    # D. real reminder, foreground
    p.page.mouse.click(200, 600); p.page.evaluate('window.__plays.length = 0'); p.advance(41000); pl = plays(p)
    check('a reminder that comes due while the app is open plays the custom sound', len(pl) == 1 and pl[0]['src'].startswith('blob:') and pl[0].get('ok'), pl)
    check('...and the in-app banner is still shown (sound is in addition, not instead)', p.page.evaluate("document.querySelectorAll('#banners .banner').length") >= 1)
    # G. remove
    p.page.click('#nsRemove'); p.page.wait_for_function("!document.querySelector('#nsName').textContent.includes('ding.wav')")
    check('Remove deletes the file, falls back to the system sound and updates settings', (idb(p) is None) and p.page.input_value('#nsSound') == 'system' and p.store()['cfg']['notifSound'] == 'system' and p.store()['cfg']['notifSoundName'] == '' and not p.vis('#nsRemove'))
    check('C/D: no page errors', not p.errors, p.errors); p.close()

    # ---------- D/E. gating on a real reminder (3 reminders at once, hidden page, master off, system, volume 0) ----------
    def fire(cfg=None, n=1, sound=True, hide=False, vol=None):
        q = page(pw, st(cfg, n, sound)); q.page.mouse.click(200, 600)
        if hide: q.page.evaluate("Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'hidden'});Object.defineProperty(document,'hidden',{configurable:true,get:()=>true})")
        q.page.evaluate('window.__plays.length = 0'); q.advance(41000); out = plays(q); q.close(); return out
    c = fire({'notifSound': 'chime'}, n=3); check('three reminders due together -> exactly ONE sound (no burst)', len(c) == 1 and c[0]['src'].endswith('assets/chime.wav'), c)
    c = fire({'notifSound': 'tick'}); check('an old tick choice plays the Chime, never doomsday-tick.mp3, on a reminder', len(c) == 1 and c[0]['src'].endswith('assets/chime.wav'), c)
    check('system choice: no in-app sound', fire({'notifSound': 'system'}) == [])
    check('page hidden: no in-app sound (the system notification path is used instead)', fire({'notifSound': 'chime'}, hide=True) == [])
    check('master Sound off: silent', fire({'notifSound': 'chime'}, sound=False) == [])
    check('volume 0: silent', fire({'notifSound': 'chime', 'fxVolume': 0}) == [])
    check('custom choice but the file is not on this device (e.g. settings restored elsewhere): safe fallback, no sound, no error', fire({'notifSound': 'custom', 'notifSoundName': 'ding.wav'}) == [])
    p = page(pw, st({'notifSound': 'custom', 'notifSoundName': 'ding.wav'})); settings(p)
    check('...and the settings explain it', 'not on this device' in note(p), note(p)); p.close()

    # ---------- F. localStorage fallback (no IndexedDB) ----------
    p = page(pw, st(), init=[NO_IDB]); settings(p); check('IndexedDB really is unavailable in this scenario', p.page.evaluate('window.indexedDB === undefined'))
    upload(p, 'ding.wav', GOOD); ls = p.page.evaluate("localStorage.getItem('chronopulse:v4.1:sound')")
    check('fallback: saved as a small localStorage copy under the chronopulse: prefix, and the UI says so', ls and json.loads(ls)['name'] == 'ding.wav' and 'small-file storage' in p.txt('#nsName') and p.store()['cfg']['notifSound'] == 'custom', p.txt('#nsName'))
    p.page.reload(); p.page.wait_for_selector('#streakBtn', state='attached'); settings(p); p.page.wait_for_function("document.querySelector('#nsName').textContent.includes('ding.wav')"); p.page.click('#nsPrev'); p.page.wait_for_timeout(500)
    check('fallback: survives refresh and previews from a blob', plays(p)[-1]['src'].startswith('blob:') and plays(p)[-1].get('ok'), plays(p))
    upload(p, 'big.wav', wav(22, 8000, 2)); check('fallback: a 350 KB file is refused with a clear reason (limit protects your other data)', 'small files' in note(p), note(p))
    check('F: no page errors', not p.errors, p.errors); p.close()

    # ---------- H. Reset all data wipes the audio ----------
    p = page(pw, st()); settings(p); upload(p, 'ding.wav', GOOD); check('before reset: the sound database exists', 'chronopulse-sound' in dbs(p))
    p.page.evaluate("showTab('settings')"); p.page.click('#resetBtn'); p.page.wait_for_selector('#confirmDlg[open]'); p.page.click('#cfYes'); p.page.wait_for_timeout(800)
    check('Reset all data removes the IndexedDB sound database and the settings', 'chronopulse-sound' not in dbs(p) and p.page.evaluate("Object.keys(localStorage).filter(k=>k.includes('sound')).length") == 0 and p.page.evaluate("S.cfg.notifSound") == 'system')
    check('H: no page errors', not p.errors, p.errors); p.close()

    # ---------- J. offline with service worker (real clock) ----------
    now = dt.datetime.now(TZ); real = seed(now.isoformat(), events=[event('e0', 'Soon', (now + dt.timedelta(days=2)).strftime('%Y-%m-%dT%H:%M'), start=(now - dt.timedelta(days=1)).strftime('%Y-%m-%dT%H:%M'))])
    p = Page(pw, real, None, clock=False, service_workers='allow', init=[SPY]); p.open(URL); p.page.evaluate('navigator.serviceWorker.ready.then(()=>true)'); p.page.wait_for_timeout(2000); settings(p); upload(p, 'ding.wav', GOOD)
    p.page.reload(); p.page.wait_for_timeout(1000); p.ctx.set_offline(True); p.page.reload(); p.page.wait_for_selector('#streakBtn', state='attached'); settings(p); p.page.wait_for_function("document.querySelector('#nsName').textContent.includes('ding.wav')")
    p.page.click('#nsPrev'); p.page.wait_for_timeout(600); check('OFFLINE: the custom sound still plays (IndexedDB blob, no network)', plays(p)[-1]['src'].startswith('blob:') and plays(p)[-1].get('ok'), plays(p))
    p.page.select_option('#nsSound', 'chime'); p.page.click('#nsPrev'); p.page.wait_for_timeout(600); check('OFFLINE: the Chime plays from the precache', plays(p)[-1]['src'].endswith('assets/chime.wav') and plays(p)[-1].get('ok'), plays(p)[-1])
    rg = p.page.evaluate("fetch('doomsday-tick.mp3', { headers: { Range: 'bytes=0-99' } }).then(r => [r.status, r.headers.get('content-range')])"); check('OFFLINE: the countdown tick is served from the precache (Range request answered as 206)', rg[0] == 206 and rg[1].startswith('bytes 0-99/'), rg)
    check('J: no page errors', not p.errors, p.errors); p.close()
srv.shutdown(); sys.exit(summary('SOUND E2E'))
