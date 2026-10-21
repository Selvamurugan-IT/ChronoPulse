#!/usr/bin/env python3
"""Streak tracker in a real browser. Recreates the reference screenshot: 98-day streak (Jul 6 - Oct 11), viewed on the morning of Oct 12 (today not done yet).
Run: python3 e2e/streak.e2e.py"""
import sys, os, datetime as dt, json
sys.path.insert(0, os.path.dirname(__file__))
from common import *
from playwright.sync_api import sync_playwright
srv, BASE = serve(); URL = BASE + 'index.html'
NOW = dt.datetime(2026, 10, 12, 13, 29, tzinfo=TZ)
H = days('2026-07-06', '2026-10-11') + days('2026-06-01', '2026-06-10')
def state(**kw): return seed(NOW.isoformat(), goals=[habit(sorted(H))], cfg={'freezesPerMonth': 0}, **kw)  # this suite checks the PLAIN streak rules; freezes have their own suite (ultimate.e2e.py)
CELL = "[...document.querySelectorAll('#stkGrid .stk-day')]"
with sync_playwright() as pw:
    p = Page(pw, state(), NOW); p.open(URL)
    check('badge shows the 98-day streak; alive (today not done yet), labelled for screen readers', p.txt('#streakCount') == '98' and p.page.get_attribute('#streakBtn', 'data-state') == 'alive' and '98 days streak' in p.page.get_attribute('#streakBtn', 'aria-label'))
    check('flame badge is animated', p.page.evaluate("getComputedStyle(document.querySelector('#streakBtn .flame')).animationName") == 'flameSway')
    check('header does not overflow at 390px', p.page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
    p.page.click('#streakBtn'); p.page.wait_for_selector('#streakDlg[open]')
    check('dialog: big flame number 98 and "Streak days"', p.txt('#stkNum') == '98' and p.txt('#stkTitle') == 'Streak days')
    check('dialog: progress line matches the reference wording', p.txt('#stkMsg') == '1 more activity and your 99-day streak is unlocked!', p.txt('#stkMsg'))
    check('dialog: opens on the current month', p.txt('#stkMonth') == 'October 2026')
    check('longest streak card: 98 Days, "Jul 6 – Oct 11"', p.txt('#stkLong') == '98' and p.txt('#stkLongU') == 'Days' and p.txt('#stkRange') == 'Jul 6 – Oct 11', p.txt('#stkRange'))
    check('today is ringed, tomorrow is dimmed', p.page.evaluate(f"{CELL}.find(c=>c.textContent==='12').classList.contains('today')") and p.page.evaluate(f"{CELL}.find(c=>c.textContent==='13').classList.contains('future')"))
    p.page.click('#stkPrev'); p.page.click('#stkPrev'); p.page.wait_for_timeout(350)
    check('month navigation: < goes back to August 2026', p.txt('#stkMonth') == 'August 2026')
    on = p.page.evaluate(f"{CELL}.filter(c=>c.classList.contains('on')).length"); check('August: all 31 days are highlighted streak days', on == 31, on)
    cls = p.page.evaluate(f"Object.fromEntries({CELL}.filter(c=>/^(1|2|8|30|31)$/.test(c.textContent)).map(c=>[c.textContent,c.className]))")
    check('August pill shapes match the reference (1 single, 2 start, 8 end, 30 start, 31 end)', all(k in cls[n] for n, k in [('1', 'single'), ('2', 'start'), ('8', 'end'), ('30', 'start'), ('31', 'end')]), cls)
    bg = p.page.evaluate(f"getComputedStyle({CELL}.find(c=>c.textContent==='15')).backgroundImage"); check('active days use the red/orange gradient', 'linear-gradient' in bg and '255, 122, 0' in bg, bg)
    p.page.screenshot(path='/tmp/streak_dialog.png')
    p.page.click('#stkPrev'); p.page.click('#stkPrev'); p.page.wait_for_timeout(350)
    check('earliest month is the first month with activity (June 2026); < is then disabled', p.txt('#stkMonth') == 'June 2026' and p.page.is_disabled('#stkPrev'), p.txt('#stkMonth'))
    check('June shows exactly the 10 recorded days', p.page.evaluate(f"{CELL}.filter(c=>c.classList.contains('on')).length") == 10)
    for _ in range(4): p.page.click('#stkNext')
    p.page.wait_for_timeout(300); check('> stops at the current month and is disabled there', p.txt('#stkMonth') == 'October 2026' and p.page.is_disabled('#stkNext'))
    p.page.keyboard.press('ArrowLeft'); p.page.wait_for_timeout(100); check('keyboard: Left arrow goes to the previous month', p.txt('#stkMonth') == 'September 2026')
    p.page.click('#stkNext'); p.page.wait_for_timeout(100)
    # live update: finishing today's habit updates badge + open dialog without reload
    p.page.evaluate("(()=>{const t=dkey(new Date());S.goals[0].tasks[0].h.push(t);save();})()"); p.advance(200)
    check('checking in today updates badge to 99 (lit) instantly', p.txt('#streakCount') == '99' and p.page.get_attribute('#streakBtn', 'data-state') == 'lit')
    check('open dialog updates: 99, "Today is counted!", Oct 12 highlighted, longest 99', p.txt('#stkNum') == '99' and p.txt('#stkMsg').startswith('Today is counted! Come back tomorrow to reach a 100-day streak.') and p.txt('#stkLong') == '99' and p.txt('#stkRange') == 'Jul 6 – Oct 12', (p.txt('#stkMsg'), p.txt('#stkRange')))
    check('storage: schema 7, same key, and NO streak data was written', p.store()['v'] == 7 and 'streak' not in json.dumps({k: v for k, v in p.store().items() if k != 'cfg'}).lower() and p.page.evaluate("Object.keys(localStorage).filter(k=>/streak/i.test(k)).length") == 0)
    p.page.keyboard.press('Escape')
    # daily goal
    p.page.evaluate("showTab('settings')"); p.page.select_option('#stkGoal', '3'); p.advance(100)
    check('daily goal 3: the saved setting is cfg.streakGoal and the streak is re-derived (days with 1 activity no longer count)', p.store()['cfg']['streakGoal'] == 3 and p.txt('#streakCount') == '0' and p.page.get_attribute('#streakBtn', 'data-state') == 'cold')
    p.page.select_option('#stkGoal', '1'); p.advance(100); check('back to goal 1: streak is 99 again (nothing was lost)', p.txt('#streakCount') == '99')
    # midnight roll-over without reloading
    p.jump(11 * 3600 * 1000 + 40 * 60 * 1000); p.advance(5000)
    check('after midnight with the app open: streak is still 99 but not lit (new day not done yet)', p.txt('#streakCount') == '99' and p.page.get_attribute('#streakBtn', 'data-state') == 'alive', (p.txt('#streakCount'), p.page.get_attribute('#streakBtn', 'data-state')))
    p.jump(24 * 3600 * 1000); p.advance(5000)
    check('a whole day missed: streak resets to 0 (cold flame) but the longest is remembered', p.txt('#streakCount') == '0' and p.page.get_attribute('#streakBtn', 'data-state') == 'cold')
    p.page.click('#streakBtn'); p.page.wait_for_selector('#streakDlg[open]'); check('cold dialog: "Streak days" 0 and the longest streak card still says 99', p.txt('#stkNum') == '0' and p.txt('#stkLong') == '99')
    check('no page errors', not p.errors, p.errors); p.close()

    p = Page(pw, state(), NOW, width=360, height=740); p.open(URL); check('header does not overflow at 360px wide either', p.page.evaluate('document.documentElement.scrollWidth <= innerWidth')); p.page.screenshot(path='/tmp/streak_header360.png'); p.close()
    p = Page(pw, state(), NOW, reduced=True); p.open(URL); p.page.click('#streakBtn')
    check('device reduced motion: flame and month slide do not animate', p.page.evaluate("getComputedStyle(document.querySelector('#streakBtn .flame')).animationName") == 'none'); p.close()
    p = Page(pw, seed(NOW.isoformat()), NOW); p.open(URL); p.page.click('#streakBtn'); p.page.wait_for_selector('#streakDlg[open]')
    check('empty state: 0, start-a-streak message, no longest range, calendar still works', p.txt('#stkNum') == '0' and 'to start your streak' in p.txt('#stkMsg') and p.txt('#stkLong') == '0' and 'Finish an activity' in p.txt('#stkRange') and p.page.is_disabled('#stkPrev') and p.page.is_disabled('#stkNext')); p.close()
    p = Page(pw, seed(NOW.isoformat(), todos=[{'id': 'a', 'title': 'x', 'doneOn': '2026-10-12', 'habit': '', 'via': False}], sessions=[{'id': 's1', 'type': 'focus', 'status': 'completed', 'startedAt': 1, 'endedAt': 2, 'plannedSec': 1500, 'actualSec': 1500, 'day': '2026-10-12'}], goals=[habit(['2026-10-11'])]), NOW, locale='en-IN'); p.open(URL)
    check('all three sources count (habit check-in, task, focus session) and a non-US locale formats dates', p.txt('#streakCount') == '2' and p.page.get_attribute('#streakBtn', 'data-state') == 'lit'); p.page.click('#streakBtn'); p.page.wait_for_selector('#streakDlg[open]')
    check('en-IN locale: range uses local format', 'Oct' in p.txt('#stkRange') and '11' in p.txt('#stkRange'), p.txt('#stkRange')); p.close()

    # offline + PWA: real clock, service worker allowed
    today = dt.date.today(); hh = [(today - dt.timedelta(n)).isoformat() for n in range(1, 6)]
    p = Page(pw, seed(dt.datetime.now(TZ).isoformat(), goals=[habit(sorted(hh))]), None, clock=False, service_workers='allow'); p.open(URL); p.page.evaluate('navigator.serviceWorker.ready.then(()=>true)'); p.page.wait_for_timeout(2000); p.page.reload(); p.page.wait_for_timeout(800)
    p.ctx.set_offline(True); p.page.reload(); p.page.wait_for_selector('#streakBtn', state='attached')
    check('OFFLINE: badge shows the 5-day streak after reload', p.txt('#streakCount') == '5', p.txt('#streakCount')); p.page.click('#streakBtn'); p.page.wait_for_selector('#streakDlg[open]')
    check('OFFLINE: calendar renders streak days and longest card', p.page.evaluate(f"{CELL}.filter(c=>c.classList.contains('on')).length") >= 4 and p.txt('#stkLong') == '5')
    check('OFFLINE: precache contains the streak files', all(f in p.page.evaluate("caches.open('chronopulse-v4.2-4.2.5').then(c=>c.keys()).then(k=>k.map(r=>new URL(r.url).pathname.split('/').pop()))") for f in ['lib/lib44.js', 'streak-ui.js']))
    check('no page errors (offline run)', not p.errors, p.errors); p.close()
srv.shutdown(); sys.exit(summary('STREAK E2E'))
