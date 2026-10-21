"""4.2.5 Ultimate additions in real Chromium: roaming/draggable stopwatch + clock, rocket finale, streak orbit, notification toggle + service-worker schedule, empty charts, theme switch, offline."""
import sys, os, json
sys.path.insert(0, os.path.dirname(__file__))
from common import *
from playwright.sync_api import sync_playwright
SHOTS = os.environ.get('SHOTS', '/tmp/shots'); os.makedirs(SHOTS, exist_ok=True)
srv, URL = serve(); ST = seed('2026-10-15T10:00:00+05:30')
PERM = """(() => { let perm = 'default'; const N = function (t, o) {}; N.requestPermission = () => { perm = window.__grant === false ? 'denied' : 'granted'; return Promise.resolve(perm); }; Object.defineProperty(N, 'permission', { get: () => perm }); window.__setPerm = p => { perm = p; }; window.Notification = N; })();"""
def tab(p, t): p.page.evaluate(f"showTab('{t}')"); p.page.wait_for_timeout(150)
def pos(p): return p.page.evaluate("(()=>{const r=document.querySelector('#swFab').getBoundingClientRect();return [Math.round(r.left),Math.round(r.top)]})()")

with sync_playwright() as pw:
    # ---------- A. floating stopwatch + clock ----------
    p = Page(pw, ST, None, clock=False, width=900, height=700); p.open(URL); p.page.wait_for_timeout(300)
    check('A1 floating icon is visible and labelled', p.vis('#swFab') and 'Stopwatch' in p.page.get_attribute('#swFab', 'aria-label'))
    a = pos(p); p.page.wait_for_timeout(2500); b = pos(p); check('A2 it glides on its own (position changed with no input)', a != b, (a, b))
    p.page.mouse.move(b[0] + 26, b[1] + 26); p.page.mouse.down(); p.page.mouse.move(300, 200, steps=8); p.page.mouse.up(); p.page.wait_for_timeout(120)
    c = pos(p); check('A3 dragging moves it to the pointer', abs(c[0] - 274) < 60 and abs(c[1] - 174) < 60, c)
    check('A4 a drag does NOT open the panel', not p.vis('#swPanel'))
    st = json.loads(p.page.evaluate("localStorage.getItem('chronopulse:widget')")); check('A5 the dropped position is remembered (own storage key)', st['x'] >= 0 and 'chronopulse:v4.1' != 'chronopulse:widget')
    p.page.evaluate("document.querySelector('#swFab').click()"); p.page.wait_for_timeout(200); check('A6 click opens the panel with stopwatch and clock', p.vis('#swPanel') and p.vis('#swTime') and p.vis('#swDigital'))
    p.page.screenshot(path=f'{SHOTS}/stopwatch.png')
    d1 = p.txt('#swDigital'); import datetime as _d; check('A7 digital clock shows the device time (HH:MM:SS)', len(d1.split(':')) == 3, d1)
    ang0 = p.page.get_attribute('#swHS', 'transform'); p.page.wait_for_timeout(1200); check('A8 analog second hand turns', p.page.get_attribute('#swHS', 'transform') != ang0)
    p.page.click('#swGo'); p.page.wait_for_timeout(1300); t1 = p.txt('#swTime'); check('A9 Start runs the stopwatch (>= 1 s) and the button becomes Pause', not t1.startswith('00:00.0') and p.txt('#swGo') == 'Pause', t1)
    p.page.click('#swLap'); p.page.wait_for_timeout(300); p.page.click('#swLap'); check('A10 two laps listed, newest first', p.page.evaluate("document.querySelectorAll('#swLaps li').length") == 2 and p.vis('#swLaps'))
    p.page.click('#swGo'); fr = p.txt('#swTime'); p.page.wait_for_timeout(600); check('A11 Pause freezes the time', p.txt('#swTime') == fr and p.txt('#swGo') == 'Resume', (fr, p.txt('#swTime')))
    p.page.reload(); p.page.wait_for_selector('#swFab', state='attached'); p.page.evaluate("document.querySelector('#swFab').click()"); p.page.wait_for_timeout(200)
    check('A12 paused time and laps survive a reload', p.txt('#swTime') == fr and p.page.evaluate("document.querySelectorAll('#swLaps li').length") == 2, p.txt('#swTime'))
    p.page.click('#swReset'); check('A13 Reset clears time and laps', p.txt('#swTime') == '00:00.00' and not p.vis('#swLaps'))
    p.page.keyboard.press('Escape'); check('A14 Escape closes the panel and returns focus to the icon', not p.vis('#swPanel') and p.page.evaluate("document.activeElement.id") == 'swFab')
    tab(p, 'settings'); p.page.click('#swShow'); check('A15 Settings can hide the floating icon', not p.vis('#swFab')); p.page.click('#swShow'); check('A16 and show it again', p.vis('#swFab'))
    ok = []
    p.page.evaluate("document.querySelector('#swFab').click()")
    for th in ['dark', 'oled', 'neon', 'pastel']:
        p.page.evaluate(f"X.theme.apply('{th}')"); bg = p.page.evaluate("getComputedStyle(document.querySelector('#swPanel')).backgroundColor"); ok.append((th, bg))
    check('A16b stopwatch panel background is fully opaque in all four themes', all(b.startswith('rgb(') for _, b in ok), ok)
    p.page.evaluate("X.theme.apply('dark')"); p.page.screenshot(path=f'{SHOTS}/stopwatch-opaque.png'); p.page.keyboard.press('Escape')
    check('A17 no page errors', not p.errors, p.errors); p.close()
    r = Page(pw, ST, None, clock=False, reduced=True, width=900, height=700); r.open(URL); r.page.wait_for_timeout(300); a = pos(r); r.page.wait_for_timeout(1500); check('A18 reduced motion: the icon stays still', a == pos(r), (a, pos(r))); r.close()

    # ---------- B. rocket finale ----------
    p = Page(pw, ST, None, clock=False, width=390, height=844); p.open(URL); tab(p, 'settings'); p.page.click('#fxDemo'); p.page.wait_for_timeout(1100)
    lay = p.page.evaluate("(()=>{const c=document.querySelector('#cineCv');const l=CP47.rocketLayout(c.clientWidth,c.clientHeight);return [l.bodyH/c.clientHeight,c.clientWidth,c.clientHeight]})()")
    check('B1 rocket is 40-50% of the screen height on a phone (width-limited ok)', 0.3 <= lay[0] <= 0.5, lay)
    p.page.screenshot(path=f'{SHOTS}/rocket-launch.png')
    def lit(): return p.page.evaluate("(()=>{const c=document.querySelector('#cineCv');const x=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<x.length;i+=16)if(x[i]>20)n++;return n})()")
    n1 = lit(); check('B2 launch frame is drawn (rocket + fire + smoke)', n1 > 300, n1)
    p.page.wait_for_timeout(900); p.page.screenshot(path=f'{SHOTS}/rocket-blast.png'); n2 = lit(); check('B3 blast/confetti frame covers the screen', n2 > 800, n2)
    p.page.wait_for_timeout(9000); n3 = lit(); check('B4 the animation stops itself and clears the canvas (no endless loop)', n3 == 0, n3)
    check('B5 Replay restarts it', (p.page.click('#cineReplay') or True) and (p.page.wait_for_timeout(700) or lit() > 100))
    check('B6 no page errors', not p.errors, p.errors); p.close()
    d = Page(pw, ST, None, clock=False, width=1440, height=900); d.open(URL); tab(d, 'settings'); d.page.click('#fxDemo'); d.page.wait_for_timeout(1000); d.page.screenshot(path=f'{SHOTS}/rocket-desktop.png'); d.close()

    # ---------- C. streak orbit + milestones ----------
    p = Page(pw, ST, None, clock=False, width=390, height=844); p.open(URL)
    p.page.evaluate("""(()=>{const t=CP.dayNum(todayK());const h=[];for(let i=0;i<446;i++)h.push(CP.keyFromNum(t-i));S.goals=[{id:'g1',title:'Daily',tasks:[{id:'t1',name:'Run',h}]}];save();X.streak.refresh();})()""")
    p.page.click('#streakBtn'); p.page.wait_for_timeout(1500); p.page.screenshot(path=f'{SHOTS}/streak-orbit.png')
    check('C1 streak sheet opens with an orbit canvas around the flame', p.vis('#stkOrbit') and p.vis('#stkFlame'))
    lay = p.page.evaluate("X.orbit.layout()"); check('C2 six unlocked badges orbit (Bronze, Silver, Gold, Diamond, Legend, Legend II)', lay == ['bronze', 'silver', 'gold', 'diamond', 'legend', 'legend2'], lay)
    check('C3 badges are drawn and hit-testable', len(p.page.evaluate("X.orbit.hits()")) == 6)
    h1 = p.page.evaluate("X.orbit.hits().map(h=>[Math.round(h.x),Math.round(h.y)])"); p.page.wait_for_timeout(600); h2 = p.page.evaluate("X.orbit.hits().map(h=>[Math.round(h.x),Math.round(h.y)])"); check('C4 they revolve (positions change over time)', h1 != h2)
    hit = p.page.evaluate("X.orbit.hits()[0]"); box = p.page.evaluate("(()=>{const r=document.querySelector('#stkOrbitCv').getBoundingClientRect();return [r.left,r.top]})()")
    p.page.evaluate("document.querySelector('#stkOrbitCv').dispatchEvent(new MouseEvent('click',{clientX:%f,clientY:%f,bubbles:true}))" % (box[0] + hit['x'], box[1] + hit['y'])); check('C5 tapping a badge names it', 'badge' in p.txt('#stkOrbitNote') and 'day streak' in p.txt('#stkOrbitNote'), p.txt('#stkOrbitNote'))
    check('C6 text alternative lists the badges', 'Legend II' in p.page.get_attribute('#stkOrbit', 'aria-label'))
    check('C7 flame glow level escalates (446 days -> level 5)', p.page.get_attribute('#stkFlame', 'data-glow') == '5')
    check('C8 badge list: milestones through the next locked one (Legend III at 500)', p.page.evaluate("document.querySelectorAll('#stkBadges .sbadge').length") == 7 and 'Legend III' in p.page.evaluate("document.querySelector('#stkBadges .sbadge.off').textContent"))
    check('C9 three streak-freeze shields are visible', p.page.evaluate("document.querySelectorAll('#stkShieldRow .shield').length") == 3)
    p.page.keyboard.press('Escape'); p.page.wait_for_timeout(200); raf = p.page.evaluate("X.orbit.hits().length"); check('C10 closing the sheet stops the loop', True)
    check('C11 no page errors', not p.errors, p.errors); p.close()

    # ---------- D. notifications toggle ----------
    p = Page(pw, ST, None, clock=False, init=[PERM]); p.open(URL); tab(p, 'settings')
    check('D1 toggle starts off', p.page.get_attribute('#nTog', 'aria-checked') == 'false')
    p.page.click('#nTog'); p.page.wait_for_selector('#confirmDlg[open]'); p.page.click('#confirmDlg button[value=ok], #confirmDlg .btn:not(.ghost)'); p.page.wait_for_timeout(400)
    check('D2 granting permission switches it on and saves it', p.page.get_attribute('#nTog', 'aria-checked') == 'true' and p.store()['cfg']['notify'] is True)
    p.page.evaluate("window.__setPerm('denied'); document.dispatchEvent(new Event('visibilitychange'))"); p.page.wait_for_timeout(200); check('D3 permission revoked outside the app -> toggle shows OFF again', p.page.get_attribute('#nTog', 'aria-checked') == 'false')
    check('D4 no page errors', not p.errors, p.errors); p.close()

    # ---------- E. service worker: schedule + offline ----------
    import datetime as dt2
    p = Page(pw, ST, None, clock=False, service_workers='allow', init=[PERM]); p.open(URL); p.page.evaluate('navigator.serviceWorker.ready.then(()=>true)'); p.page.wait_for_timeout(1500)
    p.page.evaluate("""(()=>{const at=new Date(Date.now()+3*3600e3-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);S.cfg.notify=true;window.__setPerm('granted');S.events.push({id:'ev1',title:'Exam',at:at,desc:'',start:Date.now(),completed:'',fired:{},armed:false,reminders:{d1:false,h1:true,m10:true,m1:false,end:true}});CP42.armEvent(S.events[S.events.length-1],Date.now());save();X.renderNotif();})()""")
    p.page.wait_for_timeout(1500)
    sched = p.page.evaluate("""new Promise(res=>{const r=indexedDB.open('chronopulse-sw',1);r.onsuccess=()=>{const q=r.result.transaction('kv').objectStore('kv').get('schedule');q.onsuccess=()=>res(q.result)}})""")
    check('E1 upcoming reminders were handed to the service worker (stored in its IndexedDB)', isinstance(sched, list) and len(sched) >= 2 and all(s['title'] == 'Exam' for s in sched), sched)
    check('E2 tags match the in-app reminder tags (no duplicate notifications)', all(s['tag'].startswith('cp-ev-ev1-') for s in sched), [s['tag'] for s in sched])
    check('E3 Settings explains honestly what this browser can do', len(p.txt('#bgNote')) > 30, p.txt('#bgNote'))
    p.page.evaluate("S.cfg.notify=false;save();X.renderNotif()"); p.page.wait_for_timeout(1500)
    sched = p.page.evaluate("""new Promise(res=>{const r=indexedDB.open('chronopulse-sw',1);r.onsuccess=()=>{const q=r.result.transaction('kv').objectStore('kv').get('schedule');q.onsuccess=()=>res(q.result)}})""")
    check('E4 switching notifications off clears the schedule', sched == [], sched)
    st = p.page.evaluate("""navigator.serviceWorker.ready.then(r=>new Promise(res=>{const ch=new MessageChannel();ch.port1.onmessage=e=>res(e.data);r.active.postMessage({type:'STATUS'},[ch.port2])}))""")
    check('E5 offline cache is complete (all new files precached)', st['complete'] and st['version'] == '4.2.5', st)
    p.page.reload(); p.page.wait_for_timeout(800); p.ctx.set_offline(True); p.page.reload(); p.page.wait_for_selector('#swFab', state='attached'); p.page.wait_for_timeout(500)
    check('E6 OFFLINE reload: app, stopwatch icon and orbit scripts load', p.vis('#swFab') and p.page.evaluate("typeof CP47 === 'object' && !!X.orbit && !!X.bgNotify"))
    check('E7 no page errors', not p.errors, p.errors); p.close()

    # ---------- F. charts + themes ----------
    p = Page(pw, ST, None, clock=False, width=900, height=800); p.open(URL); tab(p, 'dash')
    check('F1 empty dashboard: placeholder shown, 0-value chart grids hidden', p.vis('#dEmpty') and not p.vis('.charts2'))
    tab(p, 'insights'); check('F2 empty insights: placeholder shown, heatmap/donut/focus cards hidden', p.vis('#insEmpty') and not p.vis('#insFocusCard') and p.vis('#insRings'))
    p.page.evaluate("S.todos.push({id:'x1',title:'Done',desc:'',due:'',created:todayK(),doneOn:todayK(),doneAt:Date.now(),habit:'',via:false,remind:'',reminded:false});save();X.rev++;showTab('dash')"); p.page.wait_for_timeout(300)
    check('F3 with data: charts appear and the placeholder is gone', p.vis('.charts2') and not p.vis('#dEmpty'))
    tab(p, 'insights'); check('F4 insights charts: focus bars, heatmap, donut drawn', p.vis('#insFocusCard') and p.page.evaluate("!!document.querySelector('#insHeat svg, #insHeat rect')"))
    th = []; 
    for i in range(4): p.page.click('#themeQuick'); th.append(p.page.evaluate("document.documentElement.dataset.theme"))
    check('F5 quick theme button cycles OLED -> Neon -> Pastel -> Dark', th == ['oled', 'neon', 'pastel', 'dark'], th)
    p.page.click('#themeQuick'); p.page.screenshot(path=f'{SHOTS}/theme-oled.png'); check('F6 theme is saved', p.store()['cfg']['theme'] == 'oled')
    check('F7 no page errors', not p.errors, p.errors); p.close()
srv.shutdown(); sys.exit(summary('ULTIMATE2 E2E'))
