'use strict';
/* ChronoPulse 4.2 — streak badge, streak calendar and the "Streaks" setting. All numbers come from CP44 (lib/lib44.js, unit-tested) and are DERIVED from existing
   schema-7 data on every refresh: this file never writes streak data anywhere. The only thing it saves is cfg.streakGoal, through the app's normal save function.
   Offline: pure local code, precached like every other script. */
(function () {
  const K = CP44; let last = null, view = null, q = 0, midnight = 0;
  const FLAME = '<svg class="flame" viewBox="0 0 48 64" focusable="false"><path class="fo" d="M25 1C27 11 41 19 41 38 41 50 33.5 62 24 62 14.5 62 7 50 7 38 7 29 12 24 15.5 18 16.5 24 19 26.5 21 27 18 18 20 8 25 1Z"/><path class="fm" d="M24 62C14.5 62 7 51 7 41 13 45 18 45 24 42 30 45 35 45 41 41 41 51 33.5 62 24 62Z"/><path class="fi" d="M20.500 13C19 17.500 19.500 22 22 25.500 18.500 24.500 16.500 22 15.500 19 17.500 18 19.500 16 20.500 13Z"/></svg>';
  const cur = () => { const n = new Date(); return { y: n.getFullYear(), m0: n.getMonth() }; };
  const stateOf = i => (i.current > 0 ? (i.todayActive ? 'lit' : 'alive') : 'cold');
  const SHIELD = '<svg class="shield__" viewBox="0 0 30 34" focusable="false"><path d="M15 2 27 7v9c0 8-5.500 13.500-12 16C8.500 29.500 3 24 3 16V7z"/><path class="mk" d="M10 16.500l3.500 3.500L20.500 12"/></svg>';
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  function paintBadge(info) {
    const b = $('#streakBtn'), st = stateOf(info); if (!b) return;
    b.dataset.state = st; b.dataset.glow = String(CP47.glowLevel(info.current)); setT($('#streakCount'), String(info.current));
    b.setAttribute('aria-label', `Streak: ${K.label(info)}. Open streak calendar.`); b.title = K.label(info);
    const w = b.querySelector('.flame-wrap'); if (w && !w.firstChild) w.innerHTML = FLAME;
  }
  /* ----- freeze shields, badges, habit matrix (all derived; nothing stored) ----- */
  function renderShields(info) {
    const row = $('#stkShieldRow'), note = $('#stkShieldNote'), per = info.freezesPerMonth, left = info.freezesLeft, month = new Date().toLocaleDateString(undefined, { month: 'long' });
    row.hidden = per === 0; row.replaceChildren();
    for (let i = 0; i < per; i++) { const used = i >= left, w = document.createElement('span'); w.innerHTML = SHIELD.replace('shield__', 'shield' + (used ? ' used' : '')); row.appendChild(w.firstChild); }
    row.setAttribute('aria-label', `${left} of ${per} streak freezes left in ${month}`);
    setT(note, per === 0 ? 'Streak freezes are off (Settings → Streaks).' : info.atRisk ? (left > 0 ? `If you miss today, a freeze covers it and your streak stays alive (${left} of ${per} left in ${month}).` : `No freezes left in ${month}: missing today would reset the streak.`) : `${left} of ${per} streak freezes left in ${month}. A missed day uses one automatically.`);
  }
  function renderBadges(host, info) {
    if (!host) return; const list = CP47.milestones(info.longest), next = K.nextBadge(list);
    const shown = list.length > 9 ? list.slice(-9) : list; host.innerHTML = shown.map(b => `<div class="sbadge t${b.tier} ${b.unlocked ? 'on' : 'off'}" role="group" aria-label="${b.name} badge, ${b.days}-day streak: ${b.unlocked ? 'unlocked' : b.left + ' days to go'}"><div class="medal" aria-hidden="true">${b.days}</div><b>${b.name}</b>${b.unlocked ? '<small>Unlocked</small>' : `<div class="bar" aria-hidden="true"><i style="width:${b.pct}%"></i></div><small>${b.left} ${b.left === 1 ? 'day' : 'days'} to go</small>`}</div>`).join('');
    host.title = next ? `Next badge: ${next.name} at ${next.days} days` : 'All badges unlocked';
  }
  function renderMatrix(today) {
    const host = $('#stkMatrix'); if (!host) return; const m = K.habitMatrix(S, today, 7, 8); host.replaceChildren();
    if (!m.rows.length) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = 'Add a habit in Habits & Tasks to see it here.'; host.appendChild(p); return; }
    const mk = (cls, txt) => { const d = document.createElement('div'); d.className = cls; if (txt !== undefined) d.textContent = txt; return d; };
    const head = mk('mx-row head'); head.append(mk('nm', ''), ...m.days.map(k => mk('', day(k).toLocaleDateString(undefined, { weekday: 'narrow' }))), mk('ct', '')); host.appendChild(head);
    for (const r of m.rows) { const row = mk('mx-row'); row.setAttribute('role', 'group'); row.setAttribute('aria-label', `${r.name}: ${r.done} of 7 days`); const nm = mk('nm', r.name); nm.title = r.goal ? `${r.name} (${r.goal})` : r.name; row.append(nm, ...r.cells.map(c => mk('mx-c' + (c.done ? ' on' : ''))), mk('ct', r.done + '/7')); host.appendChild(row); }
    if (m.more) host.appendChild(Object.assign(mk('hint'), { textContent: `+${m.more} more habits` }));
  }
  function paintSettings(info) {
    const f = $('#stkFreeze'); if (f && f.value !== String(info.freezesPerMonth)) f.value = String(info.freezesPerMonth); const n = $('#stkSetNote'); if (n) setT(n, `${plural(info.current, 'day')} streak · longest ${plural(info.longest, 'day')}`); const s = $('#stkGoal'); if (s && s.value !== String(info.goal)) s.value = String(info.goal); }

  function refresh() {
    try {
      const a = K.analyzeState(S, new Date()); last = a; paintBadge(a.info); paintSettings(a.info); renderBadges($('#profBadges'), a.info);
      if ($('#streakDlg').open) renderDlg(0);
      armMidnight();
    } catch (e) { /* a streak display problem must never affect the rest of the app */ }
  }
  const queue = () => { if (!q) q = setTimeout(() => { q = 0; refresh(); }, 0); }; /* coalesce bursts of saves into one refresh */
  function armMidnight() { /* the day rolls over while the app stays open: recompute right after local midnight */
    clearTimeout(midnight); const n = new Date(), next = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 0, 1);
    midnight = setTimeout(refresh, Math.min(Math.max(next - n, 1000), 2 ** 31 - 1));
  }

  /* ---------- dialog ---------- */
  function renderDlg(dir) {
    if (!last) refresh(); const { counts, info } = last, today = info.today;
    const bounds = K.monthBounds(info, today); view = K.stepMonth(view || cur(), 0, bounds);
    const fl = $('#stkFlame'); fl.dataset.state = stateOf(info); fl.dataset.glow = String(CP47.glowLevel(info.current)); const w = fl.querySelector('.flame-wrap'); if (!w.firstChild) w.innerHTML = FLAME;
    setT($('#stkNum'), String(info.current)); setT($('#stkTitle'), info.current === 1 ? 'Streak day' : 'Streak days');
    const p = K.progress(info), msg = $('#stkMsg'); msg.textContent = '';
    if (p.state === 'counted') msg.textContent = p.text; else { const i = p.text.indexOf(' '), em = document.createElement('em'); em.textContent = p.text.slice(0, i); msg.append(em, p.text.slice(i)); }
    $('#stkBar').style.width = p.pct + '%';
    setT($('#stkMonth'), new Date(view.y, view.m0, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));
    $('#stkPrev').disabled = view.y * 12 + view.m0 <= bounds.min.y * 12 + bounds.min.m0; $('#stkNext').disabled = view.y * 12 + view.m0 >= bounds.max.y * 12 + bounds.max.m0;
    const grid = $('#stkGrid'), g = K.monthGrid(view.y, view.m0, counts, info.goal, today, info.frozen), frag = document.createDocumentFragment();
    for (const wk of g.weeks) for (const c of wk) {
      const d = document.createElement('span');
      if (!c) { d.className = 'stk-day pad'; d.setAttribute('aria-hidden', 'true'); }
      else {
        d.className = 'stk-day' + (c.active ? ' on ' + c.run : c.frozen ? ' ice ' + c.run : '') + (c.today ? ' today' : '') + (c.future ? ' future' : ''); d.textContent = String(c.d);
        d.setAttribute('aria-label', `${day(c.key).toLocaleDateString(undefined, { dateStyle: 'full' })}: ${c.future ? 'upcoming' : c.frozen ? 'covered by a streak freeze' : c.active ? 'streak day, ' + plural(c.count, 'activity').replace('activitys', 'activities') : c.count ? plural(c.count, 'activity').replace('activitys', 'activities') + ', below the daily goal' : 'no activity'}${c.today ? ', today' : ''}`);
      }
      frag.appendChild(d);
    }
    grid.replaceChildren(frag); grid.classList.remove('slide-l', 'slide-r'); if (dir) { void grid.offsetWidth; grid.classList.add(dir > 0 ? 'slide-r' : 'slide-l'); }
    setT($('#stkLong'), String(info.longest)); setT($('#stkLongU'), info.longest === 1 ? 'Day' : 'Days');
    setT($('#stkRange'), info.longest ? K.rangeLabel(info.longestStart, info.longestEnd, undefined, today) : 'Finish an activity to begin');
    renderExtras(info, today);
    setT($('#stkNote'), `Counts habit check-ins, tasks and focus sessions. Daily goal: ${plural(info.goal, 'activity').replace('activitys', 'activities')} (change it in Settings → Streaks).`);
  }
  function renderExtras(info, today) { if (X.orbit) X.orbit.set(info); renderShields(info); renderBadges($('#stkBadges'), info); renderMatrix(today); }
  function open() { refresh(); view = cur(); const d = $('#streakDlg'); if (!d.open) d.showModal(); renderDlg(0); $('#stkClose').focus(); }
  function step(delta) {
    if (!last) return; const b = K.monthBounds(last.info, last.info.today), n = K.stepMonth(view || cur(), delta, b); if (n.y === view.y && n.m0 === view.m0) return; view = n; renderDlg(delta);
    const a = document.activeElement; /* a button that just became disabled drops focus to <body>, which would silence the arrow keys: hand focus to the other month button */
    if (!a || a === document.body || a.disabled) (!$('#stkPrev').disabled ? $('#stkPrev') : !$('#stkNext').disabled ? $('#stkNext') : $('#stkClose')).focus();
  }
  $('#streakBtn').addEventListener('click', open); $('#stkOpen').addEventListener('click', open);
  $('#stkPrev').addEventListener('click', () => step(-1)); $('#stkNext').addEventListener('click', () => step(1));
  $('#streakDlg').addEventListener('keydown', e => { if (e.key === 'ArrowLeft') { step(-1); e.preventDefault(); } else if (e.key === 'ArrowRight') { step(1); e.preventDefault(); } });

  /* ---------- setting ---------- */
  const sel = $('#stkGoal'); for (let n = K.GOAL_MIN; n <= K.GOAL_MAX; n++) { const o = document.createElement('option'); o.value = String(n); o.textContent = n === 1 ? '1 activity' : n + ' activities'; sel.appendChild(o); }
  const fz = $('#stkFreeze'); fz.addEventListener('change', () => { S.cfg.freezesPerMonth = K.freezesOf(fz.value); save(); refresh(); });
  $('#profStreakOpen').addEventListener('click', open);
  sel.addEventListener('change', () => { S.cfg.streakGoal = K.goalOf(sel.value); save(); refresh(); });

  /* ---------- keep everything current ---------- */
  const prevSave = X.afterSave; X.afterSave = () => { if (prevSave) prevSave(); queue(); };
  const prevState = X.onState; X.onState = () => { if (prevState) prevState(); queue(); };
  const prevSet = X.onSettings; X.onSettings = () => { if (prevSet) prevSet(); queue(); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) queue(); }); addEventListener('pageshow', queue);
  X.streak = { refresh, open };
  refresh();
})();
