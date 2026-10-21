'use strict';
/* ChronoPulse 4.1 — Focus timer, tasks, dashboard, backup/restore, CSV and notifications (UI layer).
   Plugs into script.js through the X registry; all logic that can be tested without a DOM lives in lib/lib41.js. */
(function () {
  const P = CP41;
  window.CPX = X; /* lets pwa.js raise banners */

  /* ---------- small helpers ---------- */
  const nowMs = () => Date.now(), cfg = () => S.cfg;
  const mkId = () => 's' + nowMs().toString(36) + Math.random().toString(36).slice(2, 8);
  const PH = { focus: 'Focus', short: 'Short break', long: 'Long break' };
  const clock = ms => { const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return (h ? h + ':' + pad(m) : pad(m)) + ':' + pad(s % 60); };
  const dur = sec => sec < 3600 ? `${Math.round(sec / 60)} min` : `${Math.floor(sec / 3600)}h ${pad(Math.round(sec % 3600 / 60))}m`;
  const hhmm = ms => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const metric = (label, value, sub = '') => `<div class="metric"><span>${esc(label)}</span><b>${esc(value)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
  const bar = pct => `<span class="track"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></span>`;
  let ixc = { rev: -1, ix: null };
  const index = () => { if (ixc.rev !== X.rev) ixc = { rev: X.rev, ix: P.buildIndex(S) }; return ixc.ix; }; /* aggregates are rebuilt only after data changed, never per timer tick */

  /* ---------- banners (in-app reminders: always available, no permission needed) ---------- */
  function banner(id, text, actions = []) {
    const box = $('#banners'); let el = box.querySelector(`[data-b="${CSS.escape(id)}"]`);
    if (!el) { el = document.createElement('div'); el.className = 'banner'; el.dataset.b = id; box.appendChild(el); }
    el.textContent = ''; const p = document.createElement('span'); p.className = 'btxt'; p.textContent = text; el.appendChild(p);
    const row = document.createElement('span'); row.className = 'bact';
    actions.forEach((a, i) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm' + (i ? ' ghost' : ''); b.textContent = a.label; b.addEventListener('click', () => { el.remove(); if (a.fn) a.fn(); }); row.appendChild(b); });
    if (!actions.length) { const b = document.createElement('button'); b.type = 'button'; b.className = 'ico'; b.setAttribute('aria-label', 'Dismiss'); b.innerHTML = ico('x'); b.addEventListener('click', () => el.remove()); row.appendChild(b); }
    el.appendChild(row);
  }
  X.banner = banner;

  /* ---------- notifications ---------- */
  const supported = () => 'Notification' in window, perm = () => supported() ? Notification.permission : 'unsupported';
  // Some mobile browsers briefly lag updating Notification.permission after the prompt resolves.
  // Trust an explicit 'granted' result for this page session, while still respecting a real denial.
  let permissionGrantedThisSession = false;
  const hasNotificationPermission = () => perm() === 'granted' || (permissionGrantedThisSession && perm() !== 'denied');
  let lastNote = '';
  async function notify(title, body, tag, data) {
    if (!cfg().notify || !hasNotificationPermission()) return 'off';
    try {
      const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null, o = { body, tag, icon: 'assets/icons/icon-192.png', badge: 'assets/icons/icon-192.png' }; if (data) o.data = data; /* data.eventId lets the click open that event */
      if (reg && reg.showNotification) await reg.showNotification(title, o); else new Notification(title, o); /* tag = event id: the same event can never stack two notifications */
      lastNote = 'Last one handed to your system at ' + new Date().toLocaleTimeString() + ' (browsers cannot confirm it was seen).'; renderNotif(); return 'handed';
    } catch (e) { lastNote = 'The browser refused the last notification; the in-app reminder was shown instead.'; renderNotif(); return 'failed'; }
  }
  let chimeEl = null;
  function chime() {
    if (!cfg().chime) return;
    if (X.alertSound) return X.alertSound('alert'); /* unified sound hub (notifsound.js): Chime or your own file */
    try { chimeEl = chimeEl || new Audio('assets/chime.wav'); chimeEl.currentTime = 0; const p = chimeEl.play(); if (p) p.catch(() => { const h = $('#fHint'); if (h) h.textContent = 'Your browser blocked the chime. Interact with the page once and it will play next time.'; }); } catch (e) { /* no audio available */ }
  }
  X.notify = notify; X.notifyState = () => ({ supported: supported(), perm: perm(), on: !!cfg().notify && hasNotificationPermission() });
  function syncSwitch(el, on) {
    if (!el) return;
    const value = !!on;
    el.setAttribute('aria-checked', String(value));
    el.classList.toggle('active', value);
    el.classList.toggle('on', value);
    // Keep visual state and accessibility state in lockstep across browsers.
    if ('checked' in el) el.checked = value;
  }
  function renderNotif() {
    const p = perm(), on = !!cfg().notify && hasNotificationPermission(), t = $('#nTog'); if (!t) return;
    const h = $('#nHide'); syncSwitch(h, !!cfg().hideTitles);
    syncSwitch(t, on);
    setT($('#nNote'), p === 'unsupported' ? 'Not supported by this browser — in-app reminders only' : p === 'denied' ? 'Blocked in your browser settings — in-app reminders only' : on ? 'On' + (lastNote ? ' · ' + lastNote : '') : 'Off — you will be asked for permission when you turn this on');
    $('#nTest').disabled = !on;
    if (X.notifChanged) X.notifChanged(on);
  }
  let notifBusy = false; /* a second tap while the permission prompt is open must not start a second flow */
  async function toggleNotify() {
    if (notifBusy) return; notifBusy = true; const t = $('#nTog'); if (t) t.setAttribute('aria-busy', 'true');
    try { await toggleNotifyInner(); } finally { notifBusy = false; if (t) t.removeAttribute('aria-busy'); renderNotif(); }
  }
  async function toggleNotifyInner() {
    const p = perm();
    if (p === 'unsupported') return toast('This browser does not support notifications. In-app reminders still work.');
    if (p === 'denied') { S.cfg.notify = false; save(); renderNotif(); return toast('Notifications are blocked in your browser settings. In-app reminders still work.'); }
    if (cfg().notify && hasNotificationPermission()) { S.cfg.notify = false; save(); return renderNotif(); }
    if (p === 'default') {
      if (!await ask('Allow notifications?', 'ChronoPulse can show a system notification when a focus session or break ends, when a task reminder is due, and for the reminders you choose on each event. It works while ChronoPulse is open or in the background. On browsers that support scheduled notifications (or background sync for installed apps) upcoming reminders are also handed to the system, so they can arrive when the app is closed; delivery is never guaranteed. Nothing is sent to any server. Your browser will now ask for permission.', 'Continue')) return;
      let r; try { r = await Notification.requestPermission(); } catch (e) { r = 'default'; }
      if (r !== 'granted') { permissionGrantedThisSession = false; S.cfg.notify = false; save(); renderNotif(); return toast(r === 'denied' ? 'Permission denied. In-app reminders still work.' : 'No permission was given. In-app reminders still work.'); }
      permissionGrantedThisSession = true;
    } else if (p === 'granted') { permissionGrantedThisSession = true; }
    S.cfg.notify = true; save(); renderNotif(); toast('Notifications are on');
  }
  $('#nTog').addEventListener('click', toggleNotify);
  /* the toggle always shows the TRUTH: permission can change outside the app (browser site settings), or on another tab */
  X.renderNotif = renderNotif;
  try { if (navigator.permissions && navigator.permissions.query) navigator.permissions.query({ name: 'notifications' }).then(s => { s.onchange = () => {
      // Notification.permission is the canonical value. Permissions API can lag or disagree
      // on some mobile browsers, so never switch the app OFF from s.state alone.
      if (perm() === 'denied') { permissionGrantedThisSession = false; if (cfg().notify) { S.cfg.notify = false; save(); } }
      else if (perm() === 'granted') permissionGrantedThisSession = true;
      renderNotif();
    }; }).catch(() => {}); } catch (e) { /* not supported */ }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) renderNotif(); }); addEventListener('pageshow', renderNotif);
  $('#nHide').addEventListener('click', () => { S.cfg.hideTitles = !cfg().hideTitles; save(); renderNotif(); });
  $('#nTest').addEventListener('click', async () => { const r = await notify('ChronoPulse test', 'If you can see this, notifications work on this device.', 'test-' + nowMs()); toast(r === 'handed' ? 'Test notification handed to your system. If nothing appears, check system notification or focus-mode settings.' : 'The browser did not accept the test notification.'); });

  /* ---------- focus timer controller ---------- */
  let iv = 0, to = 0;
  function announce(r) {
    const s = r.session, late = nowMs() - s.endedAt, nxt = r.timer, focus = s.type === 'focus';
    if (r.stale) return banner('done', 'A session that was left unfinished was recorded as interrupted. It does not count as focus time.');
    if (!focus && !cfg().breakRemind) return; /* user turned break-over reminders off */
    let msg = focus ? `Focus session complete${s.label ? ' — ' + s.label : ''}. ${r.auto ? `Your ${PH[nxt.phase].toLowerCase()} has started.` : `Time for a ${PH[nxt.phase].toLowerCase()}.`}` : `${PH[s.type]} is over. ${r.auto ? 'The next focus session has started.' : 'Ready for the next focus session?'}`;
    if (late > 5000) msg += ' It finished while the app was in the background.';
    banner('done', msg, nxt.status === 'running' ? [{ label: 'OK' }] : [{ label: nxt.phase === 'focus' ? 'Start focus' : 'Start ' + PH[nxt.phase].toLowerCase(), fn: actStart }, { label: 'Dismiss' }]);
    if (late < 15000) { chime(); if (focus && !document.hidden) CPFX.confetti({ particleCount: 60, spread: 60, origin: { y: .6 } }); }
    if (late < 60000) notify(focus ? 'Focus session complete' : 'Break is over', msg, s.id);
  }
  function tickNow() { /* completes a due session exactly once: the saved timer no longer carries the old session id */
    const t = S.timer; if (t.status !== 'running') return;
    const r = P.tick(t, cfg(), nowMs(), mkId); if (!r.session) return;
    S.timer = r.timer; P.addSession(S, r.session); save(); announce(r); syncTimer(); renderFocusAll();
  }
  function uiTick() { tickNow(); if (S.timer.status !== 'running') return; renderChip(); docTitle(); if (tab === 'focus' && !document.hidden) renderFocusTime(); }
  function syncTimer() { /* one interval + one deadline timeout, never more */
    clearInterval(iv); clearTimeout(to); iv = to = 0;
    if (S.timer.status === 'running') { iv = setInterval(uiTick, 250); to = setTimeout(tickNow, Math.max(0, P.remaining(S.timer, nowMs())) + 25); }
    renderChip(); docTitle();
  }
  const BASE_TITLE = document.title;
  function docTitle() { const t = S.timer; document.title = t.status === 'idle' ? BASE_TITLE : `${t.status === 'paused' ? '⏸ ' : ''}${clock(P.remaining(t, nowMs()))} · ${PH[t.phase]} — ChronoPulse`; }
  function renderChip() { const t = S.timer, c = $('#timerChip'); c.hidden = t.status === 'idle'; if (t.status === 'idle') return; setT($('#chipTime'), clock(P.remaining(t, nowMs()))); c.classList.toggle('paused', t.status === 'paused'); c.classList.toggle('brk', t.phase !== 'focus'); }
  $('#timerChip').addEventListener('click', () => showTab('focus'));

  function readLink() {
    const v = $('#fLink').value, id = v.slice(2);
    if (v.startsWith('t:')) { const t = S.todos.find(x => x.id === id); return t ? { todoId: id, habitId: t.habit, label: t.title } : {}; }
    if (v.startsWith('h:')) { const h = P.findHabit(S, id); return h ? { habitId: id, label: h.name } : {}; }
    return {};
  }
  function actStart() {
    const t = S.timer, n = nowMs();
    S.timer = t.status === 'idle' ? P.tStart(P.setLink(t, readLink()), n, mkId()) : t.status === 'running' ? P.tPause(t, n) : P.tResume(t, n);
    save(); syncTimer(); renderFocusAll();
  }
  const elapsed = t => t.status === 'idle' ? 0 : t.plannedMs - P.remaining(t, nowMs());
  function finishStop(kind) { const r = P.stop(S.timer, cfg(), nowMs(), kind); S.timer = r.timer; if (r.session) P.addSession(S, r.session); save(); syncTimer(); renderFocusAll(); }
  async function actReset() {
    const t = S.timer;
    if (t.status === 'idle') { if (t.phase === 'focus' && t.cycle === 0) return; S.timer = P.idle(cfg(), 'focus', 0, t); save(); syncTimer(); renderFocusAll(); return toast('Back to the first focus session'); }
    if (elapsed(t) >= P.MIN_REC_MS && !await ask('Reset this session?', 'It is saved in your history as cancelled and does not count as focus time.', 'Reset')) return;
    finishStop('reset');
  }
  async function actSkip() {
    const t = S.timer;
    if (t.phase === 'focus' && t.status !== 'idle' && elapsed(t) >= P.MIN_REC_MS && !await ask('Skip this focus session?', 'It is saved as interrupted and does not count as focus time. You will move on to a break.', 'Skip')) return;
    finishStop('skip');
  }
  $('#fStart').addEventListener('click', actStart); $('#fReset').addEventListener('click', actReset); $('#fSkip').addEventListener('click', actSkip);
  $('#fLink').addEventListener('change', () => { if (S.timer.status !== 'idle') return; S.timer = P.setLink(S.timer, readLink()); save(); });

  function renderLinkOptions() {
    const sel = $('#fLink'), t = S.timer, linkedTodo = t.todoId && S.todos.find(x => x.id === t.todoId), tasks = S.todos.filter(x => !x.doneOn || x === linkedTodo), hs = P.habits(S);
    const cur = linkedTodo ? 't:' + linkedTodo.id : t.habitId && P.findHabit(S, t.habitId) ? 'h:' + t.habitId : '', sig = JSON.stringify([tasks.map(x => [x.id, x.title]), hs.map(h => [h.id, h.name]), cur, t.status]);
    if (sel.dataset.sig === sig) return; sel.dataset.sig = sig; sel.textContent = '';
    const add = (parent, v, text) => { const o = document.createElement('option'); o.value = v; o.textContent = text; parent.appendChild(o); };
    add(sel, '', 'Nothing in particular');
    if (tasks.length) { const g = document.createElement('optgroup'); g.label = 'Tasks'; tasks.forEach(x => add(g, 't:' + x.id, x.title)); sel.appendChild(g); }
    if (hs.length) { const g = document.createElement('optgroup'); g.label = 'Habits'; hs.forEach(h => add(g, 'h:' + h.id, `${h.name} (${h.goalTitle})`)); sel.appendChild(g); }
    sel.value = cur; sel.disabled = t.status !== 'idle';
  }
  function renderFocusStatic() {
    const t = S.timer, c = cfg(), brk = t.phase !== 'focus', ix = index(), d = P.dailySummary(S, todayK(), ix);
    $$('#fPhases li').forEach(li => { const on = li.dataset.p === t.phase; li.classList.toggle('on', on); on ? li.setAttribute('aria-current', 'step') : li.removeAttribute('aria-current'); });
    $('#fRing').classList.toggle('brk', brk);
    setT($('#fState'), t.status === 'paused' ? 'Paused' : t.status === 'running' ? (brk ? 'Break time — step away' : 'Focusing…') : brk ? `Ready for a ${PH[t.phase].toLowerCase()}` : 'Ready to focus');
    $('#fStart').innerHTML = `${ico(t.status === 'running' ? 'pause' : 'play')}${t.status === 'running' ? 'Pause' : t.status === 'paused' ? 'Resume' : brk ? 'Start ' + PH[t.phase].toLowerCase() : 'Start focus'}`;
    $('#fSkip').disabled = t.phase === 'focus' && t.status === 'idle';
    $('#fReset').disabled = t.status === 'idle' && t.phase === 'focus' && t.cycle === 0;
    setT($('#fCycle'), brk ? `${d.sessions} focus ${d.sessions === 1 ? 'session' : 'sessions'} completed today` : `Session ${t.cycle % c.longEvery + 1} of ${c.longEvery} before a long break`);
    const h = $('#fHint'); if (!h.dataset.keep) h.textContent = t.status === 'running' ? 'The timer follows the clock, so it stays accurate if this tab sleeps or reloads.' : t.status === 'paused' ? '' : `${c.focusMin} min focus · ${c.shortMin} min short break · ${c.longMin} min long break.`;
    renderLinkOptions();
    $('#fToday').innerHTML = metric('Focus time', dur(d.focusSec), 'completed sessions only') + metric('Sessions', String(d.sessions), `${ix.partial[todayK()] || 0} interrupted/cancelled`) + metric('Tasks done', String(d.tasksDone), `${d.tasksRemaining} still open`) + metric('Habit check-ins', String(d.checkins), d.habitsTotal ? `of ${d.habitsTotal} habits` : 'no habits yet');
    renderHistory();
  }
  function renderFocusTime() { const t = S.timer, rem = P.remaining(t, nowMs()); setT($('#fTime'), clock(rem)); const pct = t.status === 'idle' ? 0 : (1 - rem / t.plannedMs) * 100; setRing($('#fRing'), pct); $('#fRing .fg').style.opacity = pct > 0 ? 1 : 0; /* a round cap would draw a dot at 0% */ }
  function renderFocusAll() { if (tab !== 'focus') return; renderFocusStatic(); renderFocusTime(); }
  X.render.focus = () => { $('#fHint').dataset.keep = ''; renderFocusStatic(); renderFocusTime(); };

  /* history */
  let histN = 8; const STATUS = { completed: 'Completed', interrupted: 'Interrupted', cancelled: 'Cancelled' };
  function renderHistory() {
    const box = $('#fHist'), list = S.sessions.slice().reverse(); $('#fClear').hidden = !list.length;
    if (!list.length) { box.innerHTML = empty('No sessions yet', 'Start a focus session. Completed, interrupted and cancelled sessions are listed here.', null); return; }
    box.innerHTML = list.slice(0, histN).map(s => `<div class="hrow" data-sid="${esc(s.id)}"><span class="badge ${esc(s.status)}">${STATUS[s.status]}</span><div class="hmain"><b>${esc(PH[s.type])}${s.label ? ' · ' + esc(s.label) : ''}</b><small>${esc(fmtDay(s.day))} · ${esc(hhmm(s.startedAt))}–${esc(hhmm(s.endedAt))} · ${dur(s.actualSec)} of ${dur(s.plannedSec)}</small></div><button class="ico del" type="button" data-hdel aria-label="Delete this session">${ico('trash')}</button></div>`).join('') + (list.length > histN ? `<button class="btn sm ghost" type="button" data-hmore>Show more (${list.length - histN})</button>` : '');
  }
  $('#fHist').addEventListener('click', async e => {
    if (e.target.closest('[data-hmore]')) { histN += 20; return renderHistory(); }
    const del = e.target.closest('[data-hdel]'), row = del && del.closest('[data-sid]'); if (!row) return;
    if (!await ask('Delete this session?', 'It will be removed from your history and statistics.', 'Delete')) return;
    S.sessions = S.sessions.filter(s => s.id !== row.dataset.sid); save(); renderFocusStatic();
  });
  $('#fClear').addEventListener('click', async () => { if (!S.sessions.length || !await ask('Clear focus history?', `All ${S.sessions.length} recorded sessions will be removed from this device. Backups you exported earlier are not affected.`, 'Clear history')) return; S.sessions = []; save(); renderFocusStatic(); toast('Focus history cleared'); });

  /* timer settings dialog */
  function openCfg() { const c = cfg(); $('#cFocus').value = c.focusMin; $('#cShort').value = c.shortMin; $('#cLong').value = c.longMin; $('#cEvery').value = c.longEvery; $('#cAuto').checked = c.auto; $('#cChime').checked = c.chime; $('#cBreak').checked = c.breakRemind; showErr($('#cErr'), ''); $('#cfgDlg').showModal(); $('#cFocus').focus(); }
  $('#cfgForm').addEventListener('submit', e => {
    e.preventDefault(); const f = { focusMin: $('#cFocus'), shortMin: $('#cShort'), longMin: $('#cLong'), longEvery: $('#cEvery') }, names = { focusMin: 'Focus length', shortMin: 'Short break', longMin: 'Long break', longEvery: 'Sessions before a long break' }, v = {};
    for (const k in f) { const n = Number(f[k].value); if (f[k].value.trim() === '' || !Number.isInteger(n) || n < P.LIM[k][0] || n > P.LIM[k][1]) return showErr($('#cErr'), `${names[k]} must be a whole number from ${P.LIM[k][0]} to ${P.LIM[k][1]}.`, f[k]); v[k] = n; }
    S.cfg = { ...cfg(), ...v, auto: $('#cAuto').checked, chime: $('#cChime').checked, breakRemind: $('#cBreak').checked }; S.timer = P.applyCfg(S.timer, S.cfg);
    save(); $('#cfgDlg').close(); toast('Timer settings saved'); syncTimer(); renderFocusAll();
  });

  /* ---------- tasks ---------- */
  let editTodo = null;
  const byDue = (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.created.localeCompare(b.created);
  function renderTodos() {
    const c = $('#todoCard'), tk = todayK(), ix = index(), open = S.todos.filter(t => !t.doneOn);
    const now = open.filter(t => !t.due || t.due <= tk).sort(byDue), later = open.filter(t => t.due && t.due > tk).sort(byDue), today = S.todos.filter(t => t.doneOn === tk), earlier = S.todos.filter(t => t.doneOn && t.doneOn !== tk).sort((a, b) => b.doneOn.localeCompare(a.doneOn));
    const row = t => {
      const h = t.habit && P.findHabit(S, t.habit), f = ix.byTodo[t.id], meta = [t.due ? (!t.doneOn && t.due < tk ? 'Overdue · ' : 'Due ') + fmtDay(t.due) : '', t.remind && !t.doneOn ? '⏰ ' + new Date(t.remind).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '', h ? 'Habit: ' + h.name : '', f ? `⏱ ${dur(f)} focused` : '', t.doneOn && t.doneOn !== tk ? 'Done ' + fmtDay(t.doneOn) : ''].filter(Boolean).join(' · ');
      return `<div class="task trow ${t.doneOn ? 'done' : ''} ${!t.doneOn && t.due && t.due < tk ? 'late' : ''}" data-todo="${esc(t.id)}"><button class="check" type="button" data-tdone aria-pressed="${!!t.doneOn}" aria-label="${t.doneOn ? 'Mark as not done' : 'Mark as done'}: ${esc(t.title)}">${ico('check')}</button><div class="tmain"><span class="tn">${esc(t.title)}</span>${meta ? `<small>${esc(meta)}</small>` : ''}${t.desc ? `<small class="td">${esc(t.desc)}</small>` : ''}</div><span class="tact">${t.doneOn ? '' : `<button class="ico" type="button" data-tfocus aria-label="Focus on ${esc(t.title)}">${ico('timer')}</button>`}<button class="ico" type="button" data-tedit aria-label="Edit ${esc(t.title)}">${ico('edit')}</button><button class="ico del" type="button" data-tdel aria-label="Delete ${esc(t.title)}">${ico('trash')}</button></span></div>`;
    };
    const sec = (title, list) => list.length ? `<h4 class="sech">${title}</h4><div class="tlist">${list.map(row).join('')}</div>` : '';
    c.innerHTML = `<div class="card-head"><h3>Daily tasks</h3><button class="btn sm" type="button" data-open="todoDlg">${ico('plus')}Add Task</button></div>`
      + (S.todos.length ? `<p class="hint">${today.length} done today · ${now.length} to do${later.length ? ' · ' + later.length + ' upcoming' : ''}. One-time tasks; the goals below are habits you repeat daily.</p>` + sec('To do today', now) + (now.length ? '' : '<p class="hint">Nothing due today. Nice.</p>') + sec('Upcoming', later) + sec('Done today', today) + (earlier.length ? `<details class="earlier"><summary>Completed earlier (${earlier.length})</summary><div class="tlist">${earlier.slice(0, 50).map(row).join('')}</div></details>` : '')
        : empty('No tasks yet', 'Add a one-time task with an optional due date and reminder. Link it to a habit if completing it should also count as that day\'s check-in.', 'Add Task', 'data-open="todoDlg"'));
  }
  X.onHabits = renderTodos;
  function openTodo(t) {
    editTodo = t || null; $('#todoForm').reset(); showErr($('#tErr'), ''); $('#tHead').textContent = t ? 'Edit task' : 'Add task';
    const sel = $('#tHabit'); sel.textContent = ''; const o0 = document.createElement('option'); o0.value = ''; o0.textContent = 'None'; sel.appendChild(o0);
    P.habits(S).forEach(h => { const o = document.createElement('option'); o.value = h.id; o.textContent = `${h.name} (${h.goalTitle})`; sel.appendChild(o); });
    if (t) { $('#tTitle').value = t.title; $('#tDesc').value = t.desc; $('#tDue').value = t.due; $('#tRemind').value = t.remind; sel.value = t.habit; }
    sel.disabled = !!(t && t.doneOn); $('#tHabitHint').textContent = sel.disabled ? 'This task is already completed, so its habit link can no longer be changed.' : 'Completing a linked task also checks that habit in for the day (once). Undoing the task removes only the check-in it created.';
    $('#todoDlg').showModal(); $('#tTitle').focus();
  }
  $('#todoForm').addEventListener('submit', e => {
    e.preventDefault(); const title = $('#tTitle').value.trim(), due = $('#tDue').value, remind = $('#tRemind').value, err = $('#tErr');
    if (!title) return showErr(err, 'Please enter a task name.', $('#tTitle'));
    if (due && !isKey(due)) return showErr(err, 'Please enter a valid due date.', $('#tDue'));
    if (remind && !(remind.length === 16 && CP.okAt(remind))) return showErr(err, 'Please enter a valid reminder time.', $('#tRemind'));
    if (remind && new Date(remind).getTime() <= nowMs() && (!editTodo || editTodo.remind !== remind)) return showErr(err, 'Choose a reminder time in the future.', $('#tRemind'));
    const desc = $('#tDesc').value.trim(), habit = $('#tHabit').value;
    if (editTodo) { if (editTodo.remind !== remind) editTodo.reminded = false; Object.assign(editTodo, { title, desc, due, remind }); if (!editTodo.doneOn) editTodo.habit = habit; }
    else S.todos.push({ id: uid(), title, desc, due, created: todayK(), doneOn: '', doneAt: 0, habit, via: false, remind, reminded: false });
    save(); $('#todoDlg').close(); toast('Task saved'); if (tab === 'habits') renderHabits(); else renderTab();
  });
  $('#todoCard').addEventListener('click', async e => {
    const row = e.target.closest('[data-todo]'), t = row && S.todos.find(x => x.id === row.dataset.todo); if (!t) return;
    if (e.target.closest('[data-tdone]')) { const was = !!t.doneOn; P.setTodoDone(S, t.id, !was, todayK(), nowMs()); save(); renderHabits(); if (!was) CPFX.confetti({ particleCount: 40, spread: 55, origin: { y: .7 }, colors: ['#10b981', '#22c55e', '#f97316'] }); }
    else if (e.target.closest('[data-tedit]')) openTodo(t);
    else if (e.target.closest('[data-tdel]')) { if (await ask('Delete task?', `“${t.title}” will be removed. Habit check-ins it created stay in your history.`)) { S.todos = S.todos.filter(x => x !== t); if (S.timer.todoId === t.id) S.timer = P.setLink(S.timer, {}); save(); toast('Task deleted'); renderHabits(); } }
    else if (e.target.closest('[data-tfocus]')) { if (S.timer.status !== 'idle') return toast('Finish or reset the running session first'); S.timer = P.setLink(S.timer, { todoId: t.id, habitId: t.habit, label: t.title }); save(); showTab('focus'); }
  });
  function checkReminders() {
    const due = P.dueReminders(S, nowMs()); if (!due.length) return;
    if (document.visibilityState === 'visible' && X.alertSound) X.alertSound('task');
    for (const t of due) { t.reminded = true; const late = nowMs() - new Date(t.remind).getTime(); banner('rem-' + t.id, (late > 3600e3 ? 'Missed reminder: ' : 'Reminder: ') + t.title, [{ label: 'Open tasks', fn: () => showTab('habits') }, { label: 'Dismiss' }]); if (late <= 3600e3) notify('Task reminder', t.title, 'todo-' + t.id); }
    save();
  }

  /* ---------- home card + dashboard ---------- */
  X.onHome = () => {
    const c = $('#homeToday'), d = P.dailySummary(S, todayK(), index());
    if (!S.todos.length && !S.sessions.length && !P.habits(S).length) { c.innerHTML = `<div class="card-head"><h3>Today</h3></div><p class="muted">Nothing tracked yet. Start a focus session or add a task; your numbers appear here from real data.</p><div class="btns"><button class="btn" type="button" data-tab="focus">${ico('timer')}Start focusing</button><button class="btn ghost" type="button" data-open="todoDlg">${ico('plus')}Add task</button></div>`; return; }
    c.innerHTML = `<div class="card-head"><h3>Today</h3><button class="btn sm ghost" type="button" data-tab="dash">Dashboard</button></div><div class="metrics">${metric('Tasks done', String(d.tasksDone), d.tasksRemaining + ' still open')}${metric('Focus time', dur(d.focusSec), plural(d.sessions, 'session'))}${metric('Habit check-ins', String(d.checkins), d.habitsTotal ? 'of ' + d.habitsTotal + ' habits' : 'no habits yet')}${metric('Daily goals', d.pct == null ? '—' : Math.round(d.pct) + '%', d.unitsTotal ? `${d.unitsDone} of ${d.unitsTotal}` : 'none set')}</div>`;
  };
  let dashKey = '';
  const delta = (n, unit, has) => !has ? 'No data in the previous 7 days to compare' : n > 0 ? `▲ +${n} ${unit} vs previous 7 days` : n < 0 ? `▼ ${n} ${unit} vs previous 7 days` : `Same as previous 7 days`;
  function renderDash() {
    const tk = todayK(), key = X.rev + '|' + tk; if (key === dashKey) return; dashKey = key;
    const ix = index(), d = P.dailySummary(S, tk, ix), w = P.weekReport(S, tk, ix), dd = w.delta;
    $('#dToday').innerHTML = `<div class="card-head"><h3>Today</h3><span class="muted">${esc(fmtDay(tk))}</span></div><div class="todayrow"><div class="ring">${ringSvg}<b>${d.pct == null ? '—' : Math.round(d.pct) + '%'}</b></div><div><b>Daily goals</b><p class="muted">${d.unitsTotal ? `${d.unitsDone} of ${d.unitsTotal} done` : 'Add habits or tasks to track daily goals.'}</p><p class="hint">Each habit counts once. A task linked to a habit counts as that habit, never twice.</p></div></div>`
      + `<div class="metrics">${metric('Tasks done', String(d.tasksDone))}${metric('Tasks left', String(d.tasksRemaining), d.overdue ? d.overdue + ' overdue' : 'none overdue')}${metric('Focus time', dur(d.focusSec), plural(d.sessions, 'session') + ' completed')}${metric('Habit check-ins', String(d.checkins), d.habitsTotal ? 'of ' + d.habitsTotal + ' habits' : 'no habits yet')}${metric('Best streak now', d.streaks.length ? `🔥 ${d.streaks[0].current}d` : '—', d.streaks.length ? d.streaks[0].name : 'check in to start one')}</div>`;
    setRing($('#dToday .ring'), d.pct || 0);
    setT($('#dRange'), `${fmtDay(w.keys[0])} – ${fmtDay(w.keys[6])} · the last 7 days including today (previous week = the 7 days before).`);
    $('#dCompare').innerHTML = metric('Focus time', dur(w.totals.focusSec), delta(dd && Math.round(dd.focusSec / 60), 'min', w.hasPrev)) + metric('Focus sessions', String(w.totals.sessions), delta(dd && dd.sessions, '', w.hasPrev)) + metric('Tasks completed', String(w.totals.tasks), delta(dd && dd.tasks, '', w.hasPrev)) + metric('Habit check-ins', String(w.totals.checkins), delta(dd && dd.checkins, '', w.hasPrev));
    const labels = w.days.map(x => day(x.key).toLocaleDateString(undefined, { weekday: 'short' }));
    const has = CP47.hasChartData(S); $('#tab-dash').classList.toggle('is-empty-charts', !has); $('#dEmpty').hidden = has; /* nothing tracked yet: no empty 0-value grids, just one calm placeholder */
    if (has) {
      CPFX.barChart($('#chFocus'), { labels, values: w.days.map(x => x.focusMin), unit: 'min', label: 'Focus minutes per day' });
      CPFX.barChart($('#chSess'), { labels, values: w.days.map(x => x.sessions), unit: 'sessions', label: 'Completed focus sessions per day' });
      CPFX.barChart($('#chTasks'), { labels, values: w.days.map(x => x.tasks), unit: 'tasks', label: 'Tasks completed per day' });
      CPFX.barChart($('#chChk'), { labels, values: w.days.map(x => x.checkins), unit: 'check-ins', label: 'Habit check-ins per day' });
    }
    $('#dHabits').innerHTML = w.habits.length ? `<p class="hint">${w.consistency == null ? 'Consistency appears once a habit has at least one day.' : `Overall consistency: <b>${Math.round(w.consistency * 100)}%</b> of possible days in the last 7.`}</p>` + w.habits.map(h => `<div class="hrow2"><div><b>${esc(h.name)}</b><small>${esc(h.goalTitle)} · 🔥 ${h.current}d now · 🏆 ${h.longest}d best</small></div><span class="rt">${h.possible ? `${h.done}/${h.possible} days` : '—'}</span>${bar(h.possible ? h.done / h.possible * 100 : 0)}</div>`).join('')
      : empty('No habits yet', 'Create a goal with daily habits to see your weekly consistency.', 'Create Goal', 'data-open="goalDlg" data-mode="new"');
    $('#dGoals').innerHTML = w.goals.length ? w.goals.map(g => `<div class="hrow2"><div><b>${esc(g.title)}</b><small>${g.possible ? Math.round(g.done / g.possible * 100) + '% of possible check-ins' : 'No tracked days yet'}</small></div><span class="rt">${g.possible ? `${g.done}/${g.possible}` : '—'}</span>${bar(g.possible ? g.done / g.possible * 100 : 0)}</div>`).join('') : '<p class="hint">Goals you create appear here with their last-7-day progress.</p>';
  }
  X.render.dash = renderDash;
  X.afterSave = () => { if (tab === 'dash') renderDash(); };

  /* ---------- backup, restore, CSV ---------- */
  let pending = null;
  const bkNote = m => { setT($('#bkNote'), m); };
  function readSnap() { try { const raw = STORE.getItem(P.SNAP), o = raw && JSON.parse(raw); return o && o.data && typeof o.data === 'object' ? o : null; } catch (e) { return null; } }
  function refreshUndo() { const sn = readSnap(); $('#bkUndo').hidden = !sn; if (sn) setT($('#bkUndoNote'), 'Safety copy saved ' + new Date(sn.savedAt).toLocaleString()); }
  X.render.data = refreshUndo;
  $('#bkExport').addEventListener('click', () => {
    const text = JSON.stringify(P.makeBackup(S), null, 2); let chk; try { chk = P.validateBackup(JSON.parse(text)); } catch (e) { chk = { ok: false, error: 'internal error' }; }
    if (!chk.ok) return bkNote('The backup could not be created: ' + chk.error);
    const name = `ChronoPulse-Backup-${todayK()}.json`; downloadBlob(new Blob([text], { type: 'application/json' }), name);
    bkNote(`Backup file created (${(text.length / 1024).toFixed(1)} KB): ${name}. Check your downloads folder; it is stored only on this device until you move it.`); toast('Backup file created');
  });
  $('#bkImport').addEventListener('click', () => $('#bkFile').click());
  $('#bkFile').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    if (f.size > 10 * 1024 * 1024) return bkNote('That file is over 10 MB, far larger than any ChronoPulse backup. Nothing was changed.');
    let obj; try { obj = JSON.parse(await f.text()); } catch (err) { return bkNote('That file is not valid JSON, so it cannot be a ChronoPulse backup. Nothing was changed.'); }
    const v = P.validateBackup(obj); if (!v.ok) return bkNote(v.error + ' Nothing was changed.');
    pending = v; const s = v.summary, cur = P.countOf(S);
    setT($('#rMeta'), `${f.name}${v.exportedAt ? ' · exported ' + new Date(v.exportedAt).toLocaleString() : ''}${v.legacy ? ' · ChronoPulse 4.0 format' : ''}`);
    $('#rSummary').innerHTML = [['Profile', s.profile ? 'included' : 'none', S.profile.name ? 'set' : 'none'], ['Events', s.events, cur.events], ['Goals', s.goals, cur.goals], ['Habits', s.habits, cur.habits], ['Habit check-ins', s.checkins, cur.checkins], ['Tasks', s.todos, cur.todos], ['Focus sessions', s.sessions, cur.sessions]].map(([k, a, b]) => `<li><span>${esc(k)}</span><b>${esc(a)}</b><small>now: ${esc(b)}</small></li>`).join('') + (s.dropped ? `<li class="warn">${s.dropped} damaged ${s.dropped === 1 ? 'record' : 'records'} in the file will be skipped.</li>` : '');
    $('#restoreForm').elements.rMode.value = 'merge'; updateWarn(); showErr($('#rErr'), ''); $('#restoreDlg').showModal();
  });
  function updateWarn() { setT($('#rWarn'), $('#restoreForm').elements.rMode.value === 'replace' ? 'Replace overwrites everything on this device with the file, including settings, and stops a running timer. A safety copy of your current data is saved first so you can undo it.' : 'Merge removes nothing. Records that already exist here (same ID) stay as they are; check-ins are combined; missing records are added. A safety copy is saved first.'); }
  $('#restoreForm').addEventListener('change', updateWarn);
  $('#restoreForm').addEventListener('submit', e => {
    e.preventDefault(); const v = pending, err = $('#rErr'), mode = $('#restoreForm').elements.rMode.value; if (!v) return;
    try { STORE.setItem(P.SNAP, JSON.stringify({ savedAt: new Date().toISOString(), data: P.exportData(S) })); } catch (x) { return showErr(err, 'A safety copy of your current data could not be saved (storage full or blocked), so nothing was restored.'); }
    const ns = mode === 'replace' ? v.state : P.mergeStates(S, v.state); if (mode === 'replace') ns.timer = P.idle(ns.cfg);
    const r = P.saveState(STORE, ns); if (!r.ok) return showErr(err, `The restored data could not be written (${r.reason === 'quota' ? 'storage is full' : 'storage is blocked'}). Your current data was not changed.`);
    $('#restoreDlg').close(); pending = null; X.setState(ns); refreshUndo(); if (!hasProfile()) openOnboarding();
    bkNote(`Restore finished (${mode}). You now have ${plural(ns.goals.length, 'goal')}, ${plural(ns.todos.length, 'task')} and ${plural(ns.sessions.length, 'focus session')}. You can undo this below.`); toast('Backup restored');
  });
  $('#bkUndo').addEventListener('click', async () => {
    const sn = readSnap(); if (!sn) return refreshUndo();
    if (!await ask('Undo the last restore?', `Your data goes back to how it was before the restore (saved ${new Date(sn.savedAt).toLocaleString()}). What you have now is kept as a new safety copy, so you can switch back.`, 'Undo restore')) return;
    const back = P.sanitize41(sn.data), cur = JSON.stringify({ savedAt: new Date().toISOString(), data: P.exportData(S) }); back.timer = P.idle(back.cfg);
    const r = P.saveState(STORE, back); if (!r.ok) return bkNote('Could not write the previous data. Nothing was changed.');
    try { STORE.setItem(P.SNAP, cur); } catch (e) { try { STORE.removeItem(P.SNAP); } catch (e2) { /* ignore */ } }
    X.setState(back); refreshUndo(); if (!hasProfile()) openOnboarding(); bkNote('Previous data restored.'); toast('Restore undone');
  });
  const CSVS = { sessions: ['focus session history', 'FocusSessions', () => P.csvSessions(S)], tasks: ['tasks', 'Tasks', () => P.csvTasks(S)], checkins: ['habit check-ins', 'HabitCheckins', () => P.csvCheckins(S)], daily: ['daily activity', 'DailySummary', () => P.csvDaily(S, todayK())] };
  $('#csvGo').addEventListener('click', () => {
    const [label, name, make] = CSVS[$('#csvType').value], r = make();
    if (!r.count) return toast(`Nothing to export yet: no ${label} recorded.`);
    const file = `ChronoPulse-${name}-${todayK()}.csv`; downloadBlob(new Blob([r.csv], { type: 'text/csv;charset=utf-8' }), file); toast(`${plural(r.count, 'row')} exported: ${file}`);
  });

  /* ---------- wiring ---------- */
  document.addEventListener('click', e => { const o = e.target.closest('[data-open]'); if (!o) return; if (o.dataset.open === 'todoDlg') openTodo(); else if (o.dataset.open === 'cfgDlg') openCfg(); });
  X.render.settings = () => { renderSettings(); renderNotif(); if (window.PWA) PWA.render(); };
  X.onState = () => { dashKey = ''; syncTimer(); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) return; tickNow(); checkReminders(); syncTimer(); renderFocusAll(); });
  setInterval(checkReminders, 15000);
  X.boot = () => {
    X.notes.forEach((n, i) => banner('note' + i, n));
    tickNow(); syncTimer(); checkReminders(); refreshUndo(); renderNotif();
  };
})();
