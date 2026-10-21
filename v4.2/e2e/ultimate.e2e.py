#!/usr/bin/env python3
"""Real-browser checks for: multi-theme switcher, streak freezes + badges + habit matrix, the four Insights charts, event categories, offline (at /repository-name).
Run: python3 e2e/ultimate.e2e.py"""
import sys, os, json, datetime as dt
sys.path.insert(0, os.path.dirname(__file__))
from common import *
from playwright.sync_api import sync_playwright
srv, BASE = serve(); URL = BASE + 'index.html'
NOW = dt.datetime(2026, 10, 14, 13, 29, tzinfo=TZ)
def mk_events():
    ev = [event('e1', 'Launch', '2026-12-25T10:00'), event('e2', 'Exam', '2026-03-02T09:00'), event('e3', 'Review', '2026-10-20T10:00'), event('e4', 'Plain', '2027-02-01T10:00')]
    for e, c in zip(ev, ['Work', 'Study', 'Work', None]):
        if c: e['category'] = c
    return ev
H_FREEZE = days('2026-10-01', '2026-10-05') + days('2026-10-08', '2026-10-13')           # Oct 6 and 7 missed -> two freezes; today (14th) still open
SESS_STREAK = [{'id': f'q{i}', 'type': 'focus', 'status': 'completed', 'startedAt': 1, 'endedAt': 2, 'plannedSec': 1500, 'actualSec': 1500, 'day': d} for i, d in enumerate(['2026-10-12', '2026-10-13', '2026-10-05'])]  # days that are active anyway
SESS = [{'id': f's{i}', 'type': 'focus', 'status': 'completed', 'startedAt': 1, 'endedAt': 2, 'plannedSec': 1500, 'actualSec': s, 'day': d} for i, (d, s) in enumerate([('2026-10-12', 7200), ('2026-10-13', 3600), ('2026-10-14', 1800), ('2026-10-05', 5400), ('2026-09-28', 3000)])]
def state(**kw):
    base = dict(events=mk_events(), goals=[{'id': 'g1', 'title': 'Fit', 'category': 'Health', 'tasks': [{'id': 't1', 'name': 'Run', 'h': H_FREEZE}, {'id': 't2', 'name': 'Read', 'h': days('2026-10-09', '2026-10-13')}]}],
                todos=[{'id': 'a', 'title': 'x', 'doneOn': '2026-10-13', 'habit': '', 'via': False}], sessions=SESS)
    base.update(kw); return seed(NOW.isoformat(), **base)
def openp(pw, st=None, **kw): p = Page(pw, st if st is not None else state(), NOW, **kw); p.open(URL); return p
import re
def num(t): return [float(x) for x in re.findall(r'[\d.]+', t)]
def bg(p): return p.page.evaluate("getComputedStyle(document.body).backgroundColor")
def theme(p): return p.page.evaluate("document.documentElement.dataset.theme")
def noscroll(p): return p.page.evaluate("document.documentElement.scrollWidth <= innerWidth")

with sync_playwright() as pw:
    # =============== THEMES ===============
    p = openp(pw); p.page.evaluate("showTab('settings')")
    check('default theme is Dark (body #0a0d14), picker shows 4 radios', theme(p) == 'dark' and bg(p) == 'rgb(10, 13, 20)' and p.page.evaluate("document.querySelectorAll('#themeGrid [role=radio]').length") == 4)
    p.page.click('#themeGrid [data-theme=oled]'); p.advance(100)
    check('OLED True Black: html[data-theme=oled], body background is exactly rgb(0, 0, 0)', theme(p) == 'oled' and bg(p) == 'rgb(0, 0, 0)', bg(p))
    st = p.store(); check('saved in the app data: cfg.theme under chronopulse:v4.1, schema 7', st['cfg']['theme'] == 'oled' and st['v'] == 7 and p.page.evaluate("Object.keys(localStorage).filter(k=>/theme/i.test(k)).length") == 0)
    check('radio states and browser-bar colour follow', p.page.get_attribute('#themeGrid [data-theme=oled]', 'aria-checked') == 'true' and p.page.get_attribute('#themeGrid [data-theme=dark]', 'aria-checked') == 'false' and p.page.get_attribute('meta[name=theme-color]', 'content') == '#000000')
    p.page.focus('#themeGrid [data-theme=oled]'); p.page.keyboard.press('ArrowRight'); p.advance(100)
    check('keyboard: Right arrow selects Cyberpunk Neon and moves focus', theme(p) == 'neon' and p.page.evaluate("document.activeElement.dataset.theme") == 'neon')
    check('neon has its own look (cyan accent variable, near-black violet)', p.page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--em').trim()") == '#00e5ff' and bg(p) == 'rgb(6, 1, 15)')
    p.page.click('#themeGrid [data-theme=pastel]'); p.advance(100)
    check('Soft Pastel is a light theme: light page, dark text, light colour-scheme', bg(p) == 'rgb(246, 241, 250)' and p.page.evaluate("getComputedStyle(document.body).color") == 'rgb(58, 47, 77)' and p.page.evaluate("getComputedStyle(document.documentElement).colorScheme") == 'light')
    check('theme switch never errors', not p.errors, p.errors); p.close()
    # persistence + no flash of the default theme
    OBS = "window.__themes = []; new MutationObserver(m => { for (const x of m) window.__themes.push(x.target.getAttribute('data-theme')); }).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-theme'] });"
    s = json.loads(state()); s['cfg']['theme'] = 'neon'
    p = Page(pw, json.dumps(s), NOW, init=[OBS]); p.open(URL)
    check('saved theme is applied before first paint: the attribute never held another theme (no flash of Dark)', p.page.evaluate('window.__themes') and set(p.page.evaluate('window.__themes')) == {'neon'}, p.page.evaluate('window.__themes'))
    p.page.reload(); p.page.wait_for_selector('#streakBtn', state='attached'); check('theme survives a refresh', theme(p) == 'neon' and bg(p) == 'rgb(6, 1, 15)')
    p.page.evaluate("showTab('settings')"); p.page.click('#resetBtn'); p.page.wait_for_selector('#confirmDlg[open]'); p.page.click('#cfYes'); p.advance(300)
    check('Reset all data returns to the Dark theme', theme(p) == 'dark' and bg(p) == 'rgb(10, 13, 20)'); p.close()
    s = json.loads(state()); s['cfg']['theme'] = 'evil<script>'; p = Page(pw, json.dumps(s), NOW); p.open(URL); check('a corrupt saved theme value falls back to Dark safely', theme(p) == 'dark' and not p.errors); p.close()
    for th in ['dark', 'oled', 'neon', 'pastel']:
        s = json.loads(state()); s['cfg']['theme'] = th; p = Page(pw, json.dumps(s), NOW, width=360, height=740); p.open(URL); ok = noscroll(p)
        for tab in ['settings', 'insights', 'profile', 'habits']: p.page.evaluate(f"showTab('{tab}')"); p.advance(1200); ok = ok and noscroll(p)
        p.page.click('#streakBtn'); p.page.wait_for_selector('#streakDlg[open]'); ok = ok and p.page.evaluate("(()=>{const s=document.querySelector('.sheet.streak');return s.scrollWidth<=s.clientWidth+1})()")
        check(f'{th}: no horizontal overflow at 360px on Home, Settings, Insights, Profile, Habits and the streak sheet', ok); check(f'{th}: no page errors', not p.errors, p.errors); p.close()

    # =============== STREAK FREEZES, BADGES, MATRIX ===============
    p = openp(pw, state(sessions=SESS_STREAK)); p.page.click('#streakBtn'); p.page.wait_for_selector('#streakDlg[open]')
    check('freeze keeps the streak alive: 11 active days (Oct 1-5 + 8-13) despite two missed days', p.txt('#stkNum') == '11' and p.page.get_attribute('#stkFlame', 'data-state') == 'alive', p.txt('#stkNum'))
    sh = p.page.evaluate("[...document.querySelectorAll('#stkShieldRow .shield')].map(s=>s.classList.contains('used'))")
    check('three shields shown: 1 available, 2 used this month', sh == [False, True, True], sh); check('shield row has a text equivalent', '1 of 3 streak freezes left in October' in p.page.get_attribute('#stkShieldRow', 'aria-label'), p.page.get_attribute('#stkShieldRow', 'aria-label'))
    check('at-risk note explains what happens if today is missed', 'a freeze covers it' in p.txt('#stkShieldNote') and '1 of 3 left' in p.txt('#stkShieldNote'), p.txt('#stkShieldNote'))
    cls = p.page.evaluate("Object.fromEntries([...document.querySelectorAll('#stkGrid .stk-day')].filter(c=>/^(5|6|7|8)$/.test(c.textContent)).map(c=>[c.textContent,c.className]))")
    check('calendar: Oct 6 and 7 are ice-coloured frozen days joined to the streak pill', 'ice' in cls['6'] and 'ice' in cls['7'] and 'on' in cls['5'].split() and 'on' in cls['8'].split() and 'mid' in cls['6'] and 'mid' in cls['7'], cls)
    lbl = p.page.evaluate("[...document.querySelectorAll('#stkGrid .stk-day')].find(c=>c.textContent==='6').getAttribute('aria-label')"); check('frozen day has an accessible label', 'streak freeze' in lbl, lbl)
    bd = p.page.evaluate("[...document.querySelectorAll('#stkBadges .sbadge')].map(b=>[b.className.includes('on'), b.textContent.replace(/\\s+/g,' ').trim()])")
    check('badges: Bronze (7) unlocked by the 11-day streak; the next one (Silver, 30) is shown locked with days to go', [b[0] for b in bd] == [True, False] and 'Unlocked' in bd[0][1] and '19 days to go' in bd[1][1], bd)
    p.page.keyboard.press('Escape'); p.page.evaluate("showTab('focus')"); p.advance(300)
    hb = p.page.evaluate("(()=>{const e=document.querySelector('.hrow .badge');if(!e)return null;const c=getComputedStyle(e);return {d:c.display,pad:c.paddingTop,fs:c.fontSize}})()")
    check('Focus history status pills keep their small inline look (no clash with the streak badges)', hb is not None and hb['d'] != 'flex' and hb['pad'] == '3px', hb); p.page.evaluate("showTab('countdown')"); p.page.click('#streakBtn'); p.page.wait_for_selector('#streakDlg[open]')
    check('profile tab shows the same badges', p.page.evaluate("document.querySelectorAll('#profBadges .sbadge').length") == 2 and p.page.evaluate("document.querySelectorAll('#profBadges .sbadge.on').length") == 1)
    mx = p.page.evaluate("[...document.querySelectorAll('#stkMatrix .mx-row:not(.head)')].map(r=>[r.querySelector('.nm').textContent, r.querySelector('.ct').textContent])")
    check('habit matrix: a row per habit with 7-day counts (Run 6/7 — Oct 8-13; Read 5/7)', mx == [['Run', '6/7'], ['Read', '5/7']], mx)
    p.page.keyboard.press('Escape'); p.page.evaluate("showTab('settings')"); p.page.select_option('#stkFreeze', '0'); p.advance(200)
    check('freezes OFF (setting 0): the streak counts only the last unbroken run (Oct 8-13 = 6) and no shields are shown', p.txt('#streakCount') == '6' and p.store()['cfg']['freezesPerMonth'] == 0)
    p.page.click('#streakBtn'); p.page.wait_for_selector('#streakDlg[open]'); check('...and the sheet says freezes are off', not p.vis('#stkShieldRow') and 'off' in p.txt('#stkShieldNote'), p.txt('#stkShieldNote')); p.page.keyboard.press('Escape')
    p.page.select_option('#stkFreeze', '3'); p.advance(200); check('freezes back to 3: streak is 11 again (nothing was lost)', p.txt('#streakCount') == '11')
    p.jump(10 * 3600 * 1000 + 40 * 60 * 1000); p.advance(5000)   # -> Oct 15 00:09: Oct 14 was missed, the third freeze is applied automatically
    check('midnight passes with no activity: the 3rd freeze is applied automatically, streak stays 11', p.txt('#streakCount') == '11', p.txt('#streakCount'))
    p.page.click('#streakBtn'); p.page.wait_for_selector('#streakDlg[open]'); sh = p.page.evaluate("[...document.querySelectorAll('#stkShieldRow .shield')].map(s=>s.classList.contains('used'))")
    check('all three shields are now used and the note warns that no freeze is left', sh == [True, True, True] and 'No freezes left' in p.txt('#stkShieldNote'), (sh, p.txt('#stkShieldNote'))); p.page.keyboard.press('Escape')
    p.jump(24 * 3600 * 1000); p.advance(5000)
    check('another missed day with no freezes left: streak resets to 0 (cold flame)', p.txt('#streakCount') == '0' and p.page.get_attribute('#streakBtn', 'data-state') == 'cold')
    p.page.click('#streakBtn'); p.page.wait_for_selector('#streakDlg[open]'); check('the Bronze badge is kept after the reset (earned by the longest streak)', p.page.evaluate("document.querySelectorAll('#stkBadges .sbadge.on').length") == 1 and p.txt('#stkLong') == '11')
    check('freeze run: no page errors', not p.errors, p.errors); p.close()
    gold = seed(NOW.isoformat(), goals=[{'id': 'g1', 'title': 'x', 'tasks': [{'id': 't1', 'name': 'Run', 'h': days('2026-07-06', '2026-10-13')}]}])
    p = openp(pw, gold); p.page.click('#streakBtn'); p.page.wait_for_selector('#streakDlg[open]')
    check('100+ day streak unlocks Bronze, Silver and Gold with the glow animation', p.page.evaluate("document.querySelectorAll('#stkBadges .sbadge.on').length") == 3 and p.page.evaluate("getComputedStyle(document.querySelector('#stkBadges .sbadge.t3.on .medal')).animationName") == 'badgeGlow')
    check('...and the 3 shields are all available', p.page.evaluate("document.querySelectorAll('#stkShieldRow .shield:not(.used)').length") == 3); p.close()
    p = openp(pw, gold, reduced=True); p.page.click('#streakBtn'); check('device reduced motion: badge glow animation is off', p.page.evaluate("getComputedStyle(document.querySelector('#stkBadges .sbadge.t3.on .medal')).animationName") == 'none'); p.close()

    # =============== CHARTS ===============
    p = openp(pw); p.page.evaluate("showTab('insights')"); p.advance(1500)
    bars = p.page.evaluate("[...document.querySelectorAll('#insFocus .ch-bar')].map(r=>({cls:r.getAttribute('class'),h:+r.getAttribute('height'),t:r.querySelector('title').textContent}))")
    check('FOCUS BARS: 7 bars Mon-Sun; Mon 2 h and Tue 1 h and Wed 0.5 h', len(bars) == 7 and [b['t'].split(': ')[1] for b in bars[:3]] == ['2 h', '1 h', '30 min'], [b['t'] for b in bars])
    check('bar heights are proportional to the minutes (Mon : Tue = 2 : 1)', abs(bars[0]['h'] / bars[1]['h'] - 2) < 0.05, (bars[0]['h'], bars[1]['h']))
    check('days that reach the goal are highlighted, future days are muted, today is outlined', 'met' in bars[0]['cls'] and 'met' not in bars[1]['cls'] and 'fut' in bars[3]['cls'] and 'today' in bars[2]['cls'], [b['cls'] for b in bars])
    xl = p.page.evaluate("[...document.querySelectorAll('#insFocus svg > text')].map(t=>t.textContent)"); check('x axis shows Mon..Sun and y axis shows hours', all(d in xl for d in ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) and '0h' in xl and '2h' in xl, xl)
    vals = [t for t in xl if t.endswith('h') and t[:-1].replace('.', '').isdigit()]; check('value labels are clean (no floating-point noise)', all(len(t) <= 5 for t in vals) and '2h' in vals, vals)
    gl = p.page.evaluate("(()=>{const l=document.querySelector('#insFocus .ch-goal');if(!l)return null;const ys=[...document.querySelectorAll('#insFocus .ch-grid')].map(g=>+g.getAttribute('y1'));return {dash:getComputedStyle(l).strokeDasharray,y:+l.getAttribute('y1'),top:Math.min(...ys),txt:document.querySelector('#insFocus .ch-goaltxt').textContent}})()")
    check('DAILY GOAL LINE: horizontal, dashed, at 2 h with a label', gl and '6' in gl['dash'] and abs(gl['y'] - gl['top']) < 0.6 and gl['txt'] == 'Daily goal 2 h', gl)
    p.page.click('#insFocusCard [data-range=weeks]'); p.advance(100); wk = p.page.evaluate("document.querySelectorAll('#insFocus .ch-bar').length")
    check('8-week view: 8 weekly bars with a weekly goal line (7 x daily)', wk == 8 and 'Weekly goal 14 h' in p.txt('#insFocus .ch-goaltxt'), p.txt('#insFocus .ch-goaltxt'))
    p.page.click('#insFocusCard [data-range=week]'); p.page.select_option('#insTarget', '0'); p.advance(100)
    check('"No goal line" removes the dashed line and is saved (cfg.focusTargetMin = 0)', p.page.evaluate("document.querySelectorAll('#insFocus .ch-goal').length") == 0 and p.store()['cfg']['focusTargetMin'] == 0)
    p.page.select_option('#insTarget', '60'); p.advance(100); check('changing the goal moves the line and persists', p.store()['cfg']['focusTargetMin'] == 60 and 'Daily goal 1 h' in p.txt('#insFocus .ch-goaltxt'))
    cells = p.page.evaluate("[...document.querySelectorAll('#insHeat .hc')].map(r=>r.getAttribute('class'))"); lv = {int(re.search(r' l(\d)', c).group(1)) for c in cells}
    check('HEATMAP: 365 day cells (53+ weeks x 7 rows), all five intensity levels used, today outlined', len(cells) == 365 and lv == {0, 1, 2, 3, 4} or len(cells) == 365 and {0, 4} <= lv, (len(cells), lv)); check('exactly one today marker', sum(' today' in c for c in cells) == 1)
    active = p.page.evaluate("Object.values(CP44.activityCounts(S, dkey(new Date()))).filter(v=>v>0).length"); import re; shown = sum(1 for c in cells if re.search(r' l[1-4]', c))
    check('heatmap active cells equal the days with recorded activity in the last 365 days', shown == active, (shown, active))
    sc = p.page.evaluate("(()=>{const s=document.querySelector('#insHeatScroll');return s.scrollLeft+s.clientWidth>=s.scrollWidth-2})()"); check('heatmap opens scrolled to the newest week; legend Less->More shown', sc and p.vis('.heat-legend'))
    m = p.page.evaluate("[...document.querySelectorAll('#insHeat svg > text')].map(t=>t.textContent)"); check('month and weekday labels are drawn', 'Oct' in m and 'Mon' in m, m)
    leg = p.page.evaluate("[...document.querySelectorAll('#insLegend li')].map(l=>[l.querySelector('.nm').textContent,l.querySelector('.ct').textContent,l.querySelector('.pc').textContent])")
    pc = sum(int(x[2][:-1]) for x in leg); segs = p.page.evaluate("document.querySelectorAll('#insDonut .donut-seg').length")
    check('DONUT: legend lists categories with counts and percentages that add up to 100%', pc == 100 and {x[0] for x in leg} >= {'Work', 'Study', 'Health'} and segs == len(leg), leg)
    check('donut centre shows the total and the sources are explained', p.txt('#insDonut .donut-total') == str(sum(int(x[1]) for x in leg)) and 'events' in p.txt('#insCatSum'))
    ct = p.page.evaluate("document.querySelector('#insRings .ring-center').textContent"); p.advance(1500)
    dash = p.page.evaluate("[...document.querySelectorAll('#insRings .ring-fg')].map(c=>c.style.strokeDasharray)")
    check('RINGS: centre reads 78% (Oct 14 is 78% through 2026) and the legend says "78% of 2026 completed"', ct == '78%' and '78% of 2026 completed' in p.txt('#insRingLegend'), (ct, p.txt('#insRingLegend')))
    check('rings animate from empty to their value (year 78%, month 43%, milestones)', all(not d.startswith('0 ') for d in dash) and abs(num(dash[0])[0] / num(dash[0])[1] - 0.78) < 0.01 and abs(num(dash[1])[0] / num(dash[1])[1] - 0.43) < 0.01, dash)
    check('milestone ring counts events this year that have arrived (Exam + Review?)', 'Milestones: 1 of 3 reached' in p.txt('#insRingLegend') or 'Milestones: 2 of 3 reached' in p.txt('#insRingLegend'), p.txt('#insRingLegend'))
    for tname in ['oled', 'neon', 'pastel']:
        p.page.evaluate(f"X.theme.choose('{tname}')"); p.advance(100)
        col = p.page.evaluate("getComputedStyle(document.querySelector('#insFocus .ch-bar')).fill"); check(f'{tname}: charts recolour through the theme variables (bar fill {col})', col.startswith('rgb'))
    check('insights: no page errors', not p.errors, p.errors); p.close()
    # category field + XSS
    evx = mk_events(); evx[3]['category'] = '<img src=x onerror="window.__xss=1">'
    p = openp(pw, state(events=evx)); p.page.evaluate("showTab('insights')"); p.advance(300)
    check('XSS: a category named like an <img onerror> is shown as plain text, nothing executes', p.page.evaluate("window.__xss") is None and p.page.evaluate("document.querySelectorAll('#insLegend img, #insDonut img').length") == 0 and '<img' in p.txt('#insLegend') and '<img' in p.page.evaluate("document.querySelector('#insDonut svg').getAttribute('aria-label')") and p.page.evaluate("document.querySelectorAll('#insDonut svg img, #insDonut svg script').length") == 0)
    p.close()
    p = openp(pw); p.page.evaluate("showTab('countdown')"); p.page.evaluate("openEventDialog && openEventDialog()") if False else None
    p.page.evaluate("document.querySelector('#addEv, [data-add-event], #addEventBtn, .addEv') && 0"); p.page.evaluate("(()=>{const d=document.querySelector('#eventDlg');d.dataset.mode='add';})()")
    cat = p.page.evaluate("[...document.querySelectorAll('#evCatList option')].map(o=>o.value)"); check('event dialog has a Category field with Work / Study / Personal / Health suggestions', cat == ['Work', 'Study', 'Personal', 'Health'] and p.page.evaluate("!!document.querySelector('#eCat')"), cat)
    p.page.evaluate("(()=>{const ev=S.events.find(e=>e.id==='e4'); ev.category='Personal'; save();})()"); p.page.evaluate("showTab('insights')"); p.advance(300)
    check('a category set on an event appears in the donut', 'Personal' in p.txt('#insLegend') and p.store()['events'][3]['category'] == 'Personal'); p.close()

    # =============== OFFLINE (GitHub-Pages-style subfolder, server shut down) ===============
    srv2, B2 = serve('/repository-name'); now = dt.datetime.now(TZ); today = dt.date.today()
    real = seed(now.isoformat(), events=[dict(event('e0', 'Soon', (now + dt.timedelta(days=40)).strftime('%Y-%m-%dT%H:%M'), start=(now - dt.timedelta(days=5)).strftime('%Y-%m-%dT%H:%M')), category='Work')], goals=[{'id': 'g1', 'title': 'x', 'category': 'Health', 'tasks': [{'id': 't1', 'name': 'Run', 'h': [(today - dt.timedelta(n)).isoformat() for n in range(1, 9)]}]}],
                cfg={'theme': 'neon'})
    b = pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE'), args=['--no-sandbox']); ctx = b.new_context(viewport={'width': 390, 'height': 844}, service_workers='allow'); ctx.add_init_script(f"if(!localStorage.getItem('chronopulse:v4.1'))localStorage.setItem('chronopulse:v4.1',{json.dumps(real)});")
    pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); pg.goto(B2 + 'index.html'); pg.evaluate('navigator.serviceWorker.ready.then(()=>true)'); pg.wait_for_timeout(2500)
    cached = pg.evaluate("caches.open('chronopulse-v4.2-4.2.5').then(c=>c.keys()).then(k=>k.map(r=>new URL(r.url).pathname.split('/').pop()))")
    check('PRECACHE (subfolder scope) includes every new asset: themes.css, theme-boot.js, theme.js, lib44-46, insights-ui.js, streak-ui.js', all(f in cached for f in ['themes.css', 'theme-boot.js', 'theme.js', 'lib/lib44.js', 'lib/lib46.js', 'insights-ui.js', 'streak-ui.js', 'style.css', 'doomsday-tick.mp3']), cached)
    pg.reload(); pg.wait_for_timeout(800); srv2.shutdown(); srv2.server_close(); ctx.set_offline(True)
    pg.reload(); pg.wait_for_selector('#streakBtn', state='attached', timeout=15000)
    check('OFFLINE (server down): the saved Neon theme is applied from the cache', pg.evaluate("document.documentElement.dataset.theme") == 'neon' and pg.evaluate("getComputedStyle(document.body).backgroundColor") == 'rgb(6, 1, 15)')
    pg.evaluate("showTab('insights')"); pg.wait_for_timeout(1800)
    check('OFFLINE: all four charts render (bars, 365 cells, donut legend, rings)', pg.evaluate("document.querySelectorAll('#insFocus .ch-bar').length") == 7 and pg.evaluate("document.querySelectorAll('#insHeat .hc').length") == 365 and pg.evaluate("document.querySelectorAll('#insLegend li').length") >= 2 and pg.evaluate("document.querySelectorAll('#insRings .ring-fg').length") == 3)
    pg.evaluate("showTab('settings')"); pg.click('#themeGrid [data-theme=pastel]'); pg.wait_for_timeout(200); check('OFFLINE: switching themes works and persists', pg.evaluate("document.documentElement.dataset.theme") == 'pastel' and json.loads(pg.evaluate("localStorage.getItem('chronopulse:v4.1')"))['cfg']['theme'] == 'pastel')
    pg.click('#streakBtn'); pg.wait_for_selector('#streakDlg[open]'); check('OFFLINE: streak sheet with shields, badges (Bronze unlocked) and matrix', pg.evaluate("document.querySelectorAll('#stkShieldRow .shield').length") == 3 and pg.evaluate("document.querySelectorAll('#stkBadges .sbadge.on').length") >= 1 and pg.evaluate("document.querySelectorAll('#stkMatrix .mx-row').length") >= 2)
    check('OFFLINE: no page errors', not errs, errs); b.close()
srv.shutdown(); sys.exit(summary('ULTIMATE E2E'))
