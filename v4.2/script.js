'use strict';
/* ChronoPulse 4.1 — core UI layer (countdown, profile, habits, life, date diff, settings, sharing). All data is created by the user and persisted in localStorage.
   Calculation / validation logic lives in lib/lib.js (window.CP) and lib/lib41.js (window.CP41) and is unit-tested separately.
   Focus, tasks, dashboard, backup and notifications live in focus-ui.js and plug in through the X registry below. */
const { pad, dkey, day, isKey, dim, ymd, dateDiff, age, nextBirthday, countdownParts, currentStreak, longestStreak, dayStatus, lifeProgress, sanitize, blank } = CP;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const STORE = (() => { try { return window.localStorage; } catch (e) { return { getItem() { throw e; }, setItem() { throw e; }, removeItem() { throw e; } }; } })(); /* reading localStorage itself can throw in locked-down browsers */
const X = { render: {}, rev: 0, onHome() {}, onHabits() {}, onState() {}, onSettings() {}, afterSave() {}, boot() {}, notes: [] }; /* extension points used by focus-ui.js */
let storageOk = true;
const LOADED = CP41.loadState(STORE); /* validates, migrates 4.0 data safely, never throws */
let S = LOADED.state; X.notes = LOADED.notes; X.loadStatus = LOADED.status;
const save = () => {
  X.rev++; const r = CP41.saveState(STORE, S); X.afterSave();
  if (r.ok) { storageOk = true; return true; }
  if (storageOk) toast(r.reason === 'quota' ? 'Could not save: browser storage is full. Export a backup from More → Backup & Export.' : 'Could not save: browser storage is blocked');
  storageOk = false; return false;
};
X.setState = ns => { S = ns; X.rev++; selGoal = null; renderWho(); X.onState(); renderTab(); syncLoop(); audioSync(); };
/* another tab changed the data: adopt it instead of overwriting it later with a stale copy */
addEventListener('storage', e => { if (e.storageArea !== STORE || (e.key !== null && e.key !== CP41.KEY)) return; X.setState(CP41.loadState(STORE).state); if (!hasProfile()) openOnboarding(); });

/* ---------- helpers ---------- */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fmt = d => new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const fmtDay = k => day(k).toLocaleDateString(undefined, { dateStyle: 'medium' });
const num = n => Math.floor(n).toLocaleString();
const ico = n => `<svg class="i" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const setT = (el, t) => { if (el && el.textContent !== t) el.textContent = t; };
const todayK = () => dkey(new Date());
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600); }
const empty = (title, text, btn, attrs = '') => `<div class="empty glass sm"><h3>${title}</h3><p>${text}</p>${btn ? `<button class="btn sm" ${attrs}>${ico('plus')}${btn}</button>` : ''}</div>`;
const ringSvg = '<svg viewBox="0 0 100 100"><circle class="bg" cx="50" cy="50" r="44"/><circle class="fg" cx="50" cy="50" r="44" pathLength="100"/></svg>';
const setRing = (el, pct) => { el.querySelector('.fg').style.strokeDashoffset = 100 - Math.max(0, Math.min(100, pct)); };
function showErr(el, msg, ...fields) { el.hidden = !msg; el.textContent = msg || ''; $$('.in', el.closest('form')).forEach(f => f.classList.toggle('bad', !!msg && fields.includes(f))); if (msg && fields[0]) fields[0].focus(); }
function ask(title, text, yes = 'Delete') {
  return new Promise(res => { $('#cfTitle').textContent = title; $('#cfText').textContent = text; $('#cfYes').textContent = yes; const d = $('#confirmDlg'); d.returnValue = ''; d.addEventListener('close', () => res(d.returnValue === 'yes'), { once: true }); d.showModal(); });
}
function downloadBlob(blob, name) { const a = document.createElement('a'); a.download = name; a.href = URL.createObjectURL(blob); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }

/* ---------- navigation ---------- */
const TITLES = {
  countdown: ['Countdown Engine', 'Make every second count!'],
  insights: ['Insights', 'Charts built from your own data'],
  profile: ['My Profile', 'Your personal timeline and important moments'],
  habits: ['Habits & Tasks', 'Build better habits. Achieve bigger dreams.'],
  life: ['Life Progress', 'Track your journey. Visualize your progress.'],
  focus: ['Focus & Productivity', 'One focused session at a time.'],
  dash: ['Dashboard', 'Your day and week, from real data.'],
  data: ['Backup & Export', 'Your data stays on this device.'],
  more: ['More', 'Tools and settings'],
  diff: ['Date Difference', 'Find the difference between any two dates.'],
  settings: ['Settings', 'Profile, audio, notifications and offline']
};
let tab = 'countdown';
function showTab(name, fromHash) {
  if (!TITLES[name]) name = 'countdown';
  tab = name;
  const group = ['diff', 'settings', 'dash', 'data', 'insights'].includes(name) ? 'more' : name;
  $$('.nav button').forEach(b => { const on = b.dataset.tab === name; b.classList.toggle('on', on); on ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'); });
  $$('.bnav button').forEach(b => { const on = b.dataset.tab === group; b.classList.toggle('on', on); on ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'); });
  $$('.panel').forEach(p => p.classList.toggle('on', p.id === 'tab-' + name));
  setT($('#pageTitle'), TITLES[name][0]); setT($('#pageSub'), TITLES[name][1]);
  if (!fromHash && location.hash !== '#' + name) history.pushState(null, '', '#' + name);
  renderTab(); syncLoop(); audioSync(); /* tick plays on the Countdown destination only */
  window.scrollTo(0, 0);
}
/* Click-to-open: a notification opens #event=<id> (new window) or posts OPEN_EVENT (existing window). Unknown ids fail safely. */
const hashEventId = () => { const m = /^#event=([^&]{1,60})$/.exec(location.hash); try { return m ? decodeURIComponent(m[1]) : ''; } catch (e) { return ''; } };
function openEventById(id) {
  const ev = typeof id === 'string' && S.events.find(e => e.id === id);
  if (!ev) { showTab('countdown'); return toast('That event no longer exists.'); }
  S.active = ev.id; save(); showTab('countdown');
}
function routeEventHash() { const id = hashEventId(); if (!id) return false; history.replaceState(null, '', '#countdown'); openEventById(id); return true; }
addEventListener('popstate', () => { if (!routeEventHash()) showTab(location.hash.slice(1) || 'countdown', true); });
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => { const d = e.data; if (d && d.type === 'OPEN_EVENT' && typeof d.id === 'string') openEventById(d.id); });
function renderTab() { (X.render[tab] || ({ countdown: renderCountdown, profile: renderProfile, habits: renderHabits, life: renderLife, more() {}, diff: renderDiff, settings: renderSettings })[tab])(); }

/* ---------- audio: only doomsday-tick.mp3, only on the Countdown destination ---------- */
const tickAudio = new Audio('doomsday-tick.mp3');
tickAudio.loop = true; tickAudio.preload = 'auto';
let aligned = false, audioFail = null; /* null | 'missing' | 'blocked' */
const ASTATE = { playing: 'Playing', paused: 'Paused', muted: 'Muted', missing: 'File missing', blocked: 'Tap to start' };
function audioRender() {
  const playing = !tickAudio.paused && !audioFail;
  const st = audioFail === 'missing' ? 'missing' : playing ? 'playing' : !S.sound ? 'muted' : (audioFail === 'blocked' && tab === 'countdown') ? 'blocked' : 'paused', b = $('#audioBtn');
  b.dataset.state = st; b.setAttribute('aria-checked', S.sound);
  setT($('#audioLabel'), S.sound ? 'ON' : 'OFF'); setT($('#audioState'), ASTATE[st]);
  b.title = st === 'missing' ? 'doomsday-tick.mp3 was not found next to index.html' : st === 'blocked' ? 'Your browser needs a tap before sound can start' : 'Turn tick sound on or off';
  const t = $('#sAudio'); if (t) t.setAttribute('aria-checked', S.sound);
  setT($('#sAudioNote'), st === 'missing' ? 'doomsday-tick.mp3 is missing — add it next to index.html' : 'Plays only on the Countdown screen');
}
function audioSync() {
  try { tickAudio.volume = CP43.mediaVolume(S.cfg.fxVolume); } catch (e) { /* some browsers (iOS Safari) keep media volume read-only */ }
  const allowed = S.sound && tab === 'countdown' && !document.hidden && !audioFail && !$('#onbDlg[open]') && !$('#cineDlg[open]'); /* the tick pauses under the celebration */
  if (!allowed) { if (!tickAudio.paused) tickAudio.pause(); audioRender(); return; }
  if (tickAudio.paused) {
    if (!aligned && tickAudio.duration) { const n = new Date(); tickAudio.currentTime = (n.getSeconds() + n.getMilliseconds() / 1e3) % tickAudio.duration; aligned = true; }
    const p = tickAudio.play();
    if (p) p.then(() => { if (audioFail === 'blocked') audioFail = null; audioRender(); }).catch(err => { audioFail = err && err.name === 'NotSupportedError' ? 'missing' : 'blocked'; audioRender(); });
  }
  audioRender();
}
['play', 'pause'].forEach(ev => tickAudio.addEventListener(ev, audioRender));
tickAudio.addEventListener('error', () => { audioFail = 'missing'; tickAudio.pause(); audioRender(); });
tickAudio.addEventListener('loadedmetadata', audioSync);
/* Every real gesture (not just the first) clears a 'blocked' state and retries: after a phone resume the browser may block the tick again, and a later tap must be able to restart it. */
['pointerdown', 'pointerup', 'keydown', 'touchstart', 'touchend', 'click'].forEach(ev => document.addEventListener(ev, () => { if (audioFail === 'blocked') { audioFail = null; audioSync(); } }, { passive: true, capture: true }));
/* Returning to the app (tab switch, unlock phone, bfcache restore): retry the tick and ask the sound engine to resume. A browser may still insist on a tap first (iOS); the hint then says so. */
function resumeAudio() { if (document.hidden) return; if (audioFail === 'blocked') audioFail = null; audioSync(); if (X.sfxResume) X.sfxResume(); }
document.addEventListener('visibilitychange', () => { audioSync(); syncLoop(); if (!document.hidden) { reconcileNow(); resumeAudio(); } });
addEventListener('pageshow', () => { reconcileNow(); syncLoop(); resumeAudio(); }); /* page restored from the back/forward cache */
addEventListener('pagehide', () => tickAudio.pause());
function toggleSound() { S.sound = !S.sound; if (S.sound && audioFail === 'blocked') audioFail = null; save(); audioSync(); if (X.sfxSync) X.sfxSync(); if (X.onSettings) X.onSettings(); }
$('#audioBtn').addEventListener('click', toggleSound);
$('#sAudio').addEventListener('click', toggleSound);

/* ---------- countdown engine ---------- */
const cells = $$('#cdGrid b');
const activeEvent = () => S.events.find(e => e.id === S.active);
/* Completion is stored on the event itself (ev.completed, see lib/lib42.js), so it runs once per target time, survives reloads, covers every event
   (not just the one on screen) and also covers events whose time passed while the app was closed or in the background. */
const quoted = l => (l.length > 3 ? l.slice(0, 3) : l).map(c => '“' + c.title + '”').join(', ') + (l.length > 3 ? ` and ${l.length - 3} more` : '');
function completeEvents(now = new Date()) {
  const r = CP42.reconcile(S.events, now.getTime()); if (!r.changed) return;
  save();
  if (r.completed.some(c => c.live && c.id === S.active)) { if (X.cine) X.cine.completed(S.active); else CPFX.confetti({ particleCount: 160, spread: 90, origin: { y: .5 }, colors: ['#f97316', '#ef4444', '#10b981', '#ffffff'] }); } /* Phase 3: full-screen celebration, once per target (cinema.js) */
  const live = r.completed.filter(c => c.live && c.id !== S.active), away = r.completed.filter(c => !c.live && c.announce);
  const msg = [live.length ? `${quoted(live)} reached ${live.length === 1 ? 'its' : 'their'} target.` : '', away.length ? `${quoted(away)} finished while you were away.` : ''].filter(Boolean).join(' ');
  if (msg) toast(msg);
}
const reconcileNow = () => { completeEvents(new Date()); if (X.runReminders) X.runReminders(); }; /* completion first, then reminders: both idempotent */
function greeting() { const h = new Date().getHours(), g = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; return S.profile.name ? `${g}, ${S.profile.name}! 👋` : g; }
function renderCountdown() {
  const ev = activeEvent();
  $('#cdEmpty').hidden = !!ev; $('#cdLive').hidden = !ev; $('#targetsCard').hidden = !S.events.length;
  $('#chips').innerHTML = S.events.map(e => `<button class="chip ${e.id === S.active ? 'on' : ''}" data-pick="${esc(e.id)}">${esc(e.title)}</button>`).join('') + `<button class="chip add" data-open="eventDlg" data-mode="target">${ico('plus')}New target</button>`;
  $('#cdEdit').hidden = !ev; $('#cdDel').hidden = !ev;
  setT($('#greet'), greeting());
  if (ev) { setT($('#cdTitle'), ev.title); setT($('#cdAt'), fmt(ev.at)); tickCountdown(new Date()); }
  X.onHome();
}
function tickCountdown(now) {
  const ev = activeEvent(); if (!ev) return;
  const t = new Date(ev.at), left = Math.max(0, t - now), done = left === 0;
  const p = countdownParts(now, t);
  [p.months, p.days, p.h, p.mi, p.s].map(n => pad(n)).concat(pad(p.ms, 3)).forEach((v, i) => setT(cells[i], v));
  const span = t - ev.start, pct = done ? 100 : span > 0 ? Math.min(100, Math.max(0, (now - ev.start) / span * 100)) : 0;
  $('#cdBar').style.width = pct + '%'; setRing($('#cdRing'), pct);
  const hero = $('.hero'); hero.classList.toggle('urgent', !done && left < 864e5); hero.classList.toggle('done', done);
  setT($('#cdPct'), done ? 'Target reached 🎉' : pct.toFixed(1) + '% completed');
  setT($('#cdLeft'), done ? 'Time is up' : num(left / 864e5) + ' days remaining');
  setT($('#cdNow'), 'Live clock: ' + now.toLocaleString());
  setT($('#mD'), num(left / 864e5)); setT($('#mW'), (left / 6048e5).toFixed(1)); setT($('#mH'), num(left / 36e5)); setT($('#mM'), num(left / 6e4));
  if (X.cine) { if (done) X.cine.idle(); else X.cine.tick(ev, now); } /* final-minute warning + final-ten-seconds digits (never throws); at 0 the overlay takes over */
  if (done && !CP42.isCompleted(ev)) completeEvents(now); /* idempotent: marks the event completed, so this runs once per target */
}
let raf = 0;
function loop() { tickCountdown(new Date()); raf = requestAnimationFrame(loop); }
function syncLoop() { /* one animation loop, running only while the Countdown screen is visible */
  const want = tab === 'countdown' && !document.hidden && !!activeEvent();
  if (want && !raf) raf = requestAnimationFrame(loop);
  if (!want && raf) { cancelAnimationFrame(raf); raf = 0; }
  if (!want && X.cine) X.cine.idle(); /* leaving the Countdown screen clears the warning visuals */
}
let lastDay = todayK();
setInterval(() => {
  if (document.hidden) return;
  reconcileNow();
  if (lastDay !== todayK()) { lastDay = todayK(); renderTab(); return; }
  if (tab === 'profile') { renderProfileLive(); liveEvents(); }
  if (tab === 'life') renderLife();
}, 1000);

/* ---------- personal events ---------- */
let editEv = null;
function openEvent(mode, ev) {
  editEv = ev || null; const f = $('#eventForm'); f.reset(); showErr($('#eErr'), '');
  $('#eTitleH').textContent = ev ? 'Edit event' : mode === 'target' ? 'Set countdown target' : 'Add personal event';
  $('#eSave').textContent = ev ? 'Save changes' : mode === 'target' ? 'Start countdown' : 'Save event';
  $('#eUseWrap').hidden = mode === 'target' && !ev; $('#eUse').checked = mode === 'target' ? true : ev ? ev.id === S.active : !activeEvent();
  const rem = ev ? ev.reminders : CP.normReminders(null); $$('[data-rem]').forEach(c => { c.checked = !!rem[c.dataset.rem]; }); if (X.remNote) X.remNote();
  if (ev) { $('#eTitle').value = ev.title; $('#eDate').value = ev.at.slice(0, 10); $('#eTime').value = ev.at.slice(11, 16) === '00:00' ? '' : ev.at.slice(11, 16); $('#eDesc').value = ev.desc || ''; }
  $('#eCat').value = (ev && ev.category) || '';
  $('#eventDlg').dataset.mode = mode; $('#eventDlg').showModal(); $('#eTitle').focus();
}
$('#eventForm').addEventListener('submit', e => {
  e.preventDefault(); const title = $('#eTitle').value.trim(), date = $('#eDate').value, time = $('#eTime').value || '00:00', desc = $('#eDesc').value.trim(), category = $('#eCat').value.trim().slice(0, 30), mode = $('#eventDlg').dataset.mode, err = $('#eErr');
  if (!title) return showErr(err, 'Please enter an event name.', $('#eTitle'));
  if (!isKey(date)) return showErr(err, 'Please choose a valid event date.', $('#eDate'));
  const at = `${date}T${time}`;
  if (mode === 'target' && !editEv && new Date(at) <= new Date()) return showErr(err, 'A countdown target must be in the future.', $('#eDate'));
  const use = $('#eUse').checked, nowMs = Date.now(), want = {}; $$('[data-rem]').forEach(c => { want[c.dataset.rem] = c.checked; });
  if (editEv) {
    const changed = editEv.at !== at, before = { ...editEv.reminders }; Object.assign(editEv, { title, at, desc }); if (category) editEv.category = category; else delete editEv.category;
    if (changed) editEv.completed = ''; /* a new target time re-arms the event */
    for (const k of CP.RKEYS) if (want[k] !== before[k]) CP42.setReminder(editEv, k, want[k], nowMs);
    if (changed) CP42.armEvent(editEv, nowMs); /* a new target time also re-arms its reminders (already-past ones are skipped, not announced) */
    if (use && S.active !== editEv.id) { S.active = editEv.id; editEv.start = Date.now(); } else if (!use && S.active === editEv.id) S.active = null;
  } else {
    const ev = { id: uid(), title, at, desc, ...(category ? { category } : {}), start: nowMs, completed: '', reminders: CP.normReminders(want), fired: {}, armed: false }; CP42.armEvent(ev, nowMs); S.events.push(ev); if (use) S.active = ev.id;
  }
  save(); $('#eventDlg').close(); toast(editEv ? 'Event updated' : 'Event saved'); renderTab(); syncLoop();
});
function liveEvents() {
  const now = new Date();
  $$('[data-at]').forEach(el => {
    const t = new Date(el.dataset.at);
    if (t > now) { const ms = t - now; setT(el, `${Math.floor(ms / 864e5)}d ${pad(Math.floor(ms % 864e5 / 36e5))}h ${pad(Math.floor(ms % 36e5 / 6e4))}m ${pad(Math.floor(ms % 6e4 / 1e3))}s left`); el.classList.remove('past'); }
    else { const p = countdownParts(t, now), y = Math.floor(p.months / 12), m = p.months % 12; setT(el, `${y ? y + 'y ' : ''}${m ? m + 'm ' : ''}${p.days}d ${pad(p.h)}h ago`); el.classList.add('past'); }
  });
}
function renderEventList() {
  const now = new Date(), fut = S.events.filter(e => new Date(e.at) > now).sort((a, b) => a.at.localeCompare(b.at)), past = S.events.filter(e => new Date(e.at) <= now).sort((a, b) => b.at.localeCompare(a.at));
  $('#eventList').innerHTML = S.events.length ? [...fut, ...past].map(e => `<div class="erow ${e.id === S.active ? 'active' : ''}">
    <div><span class="nm">${esc(e.title)}</span>${e.id === S.active ? '<span class="tag">COUNTDOWN</span>' : ''}<div class="dt">${esc(new Date(e.at).toLocaleDateString(undefined, { dateStyle: 'medium' }))}${e.at.slice(11) !== '00:00' ? ' · ' + esc(e.at.slice(11)) : ''}</div></div>
    <div class="row-actions"><button class="ico" data-useev="${esc(e.id)}" aria-label="Use ${esc(e.title)} as countdown" title="Use as countdown">${ico('target')}</button><button class="ico" data-icsev="${esc(e.id)}" aria-label="Download calendar file with alarms for ${esc(e.title)}" title="Add to calendar (.ics)">${ico('save')}</button><button class="ico" data-editev="${esc(e.id)}" aria-label="Edit ${esc(e.title)}">${ico('edit')}</button><button class="ico del" data-delev="${esc(e.id)}" aria-label="Delete ${esc(e.title)}">${ico('trash')}</button></div>
    ${e.desc ? `<div class="ds">${esc(e.desc)}</div>` : ''}<div class="cdtxt" data-at="${esc(e.at)}"></div></div>`).join('')
    : empty('No personal events yet', 'Add a wedding, exam, trip or anniversary. Each one gets its own live timer.', 'Add Event', 'data-open="eventDlg" data-mode="event"');
  liveEvents();
}
async function deleteEvent(id) {
  const ev = S.events.find(x => x.id === id); if (!ev || !await ask('Delete event?', `“${ev.title}” will be removed permanently.`)) return;
  S.events = S.events.filter(x => x.id !== id); if (S.active === id) S.active = null; save(); toast('Event deleted'); renderTab(); syncLoop();
}
document.addEventListener('click', e => {
  const pick = e.target.closest('[data-pick]'), ics = e.target.closest('[data-icsev]'), use = e.target.closest('[data-useev]'), ed = e.target.closest('[data-editev]'), del = e.target.closest('[data-delev]');
  if (pick) { S.active = pick.dataset.pick; save(); renderCountdown(); syncLoop(); }
  if (use) { const ev = S.events.find(x => x.id === use.dataset.useev); if (ev) { S.active = ev.id; ev.start = Date.now(); save(); toast('Countdown set to ' + ev.title); renderProfile(); syncLoop(); } }
  if (ics) { const ev = S.events.find(x => x.id === ics.dataset.icsev), text = ev && CP42.buildIcs(ev, Date.now()); if (!text) return toast('This event has no valid date, so no calendar file was made.'); downloadBlob(new Blob([text], { type: 'text/calendar;charset=utf-8' }), CP42.icsFileName(ev)); toast('Calendar file downloaded. Open it to add the event and its alarms to your calendar app.'); }
  if (ed) openEvent('event', S.events.find(x => x.id === ed.dataset.editev));
  if (del) deleteEvent(del.dataset.delev);
});
$('#cdEdit').addEventListener('click', () => { const ev = activeEvent(); if (ev) openEvent('target', ev); });
$('#cdDel').addEventListener('click', () => { const ev = activeEvent(); if (ev) deleteEvent(ev.id); });

/* ---------- profile ---------- */
const hasProfile = () => !!(S.profile.name && isKey(S.profile.dob) && S.profile.dob <= todayK());
function validateProfile(name, dob) {
  if (!name) return ['Please enter a username.', 'name'];
  if (!isKey(dob)) return ['Please enter a valid date of birth.', 'dob'];
  if (dob > todayK()) return ['Date of birth cannot be in the future.', 'dob'];
  return null;
}
function renderWho() { const w = $('#who'); w.hidden = !S.profile.name; w.innerHTML = S.profile.name ? 'Hi, <b>' + esc(S.profile.name) + '</b>' : ''; setT($('#greet'), greeting()); }
function renderProfile() { renderProfileLive(); renderEventList(); }
function renderProfileLive() {
  const { name, dob } = S.profile, f = ['#pAge', '#pBday', '#pDays', '#pHours'].map(s => $(s));
  setT($('#pNameView'), name || '—'); setT($('#pAvatar'), name ? [...name][0].toUpperCase() : '?');
  if (!isKey(dob) || dob > todayK()) { f.forEach(el => setT(el, '—')); setT($('#pDobView'), ''); setT($('#pExact'), ''); setT($('#pHint'), 'Add a valid date of birth (Edit profile) to unlock your exact age and time lived.'); return; }
  const now = new Date(), a = age(dob, dkey(now)), nb = nextBirthday(dob, dkey(now));
  setT($('#pHint'), ''); setT($('#pDobView'), 'Born ' + fmtDay(dob));
  setT(f[0], String(a.years)); setT(f[1], nb.today ? '0 🎂' : String(nb.inDays)); setT(f[2], num(a.totalDays)); setT(f[3], num((now - day(dob)) / 36e5));
  setT($('#pExact'), `${plural(a.years, 'year')}, ${plural(a.months, 'month')}, ${plural(a.days, 'day')} old${nb.today ? ' · Happy birthday!' : ''}`);
}
$('#profileForm').addEventListener('submit', e => {
  e.preventDefault(); const name = $('#pName').value.trim(), dob = $('#pDob').value, v = validateProfile(name, dob);
  if (v) return showErr($('#pErr'), v[0], v[1] === 'name' ? $('#pName') : $('#pDob'));
  S.profile = { name, dob }; save(); $('#profileDlg').close(); renderWho(); toast('Profile saved'); renderTab();
});

/* ---------- habits ---------- */
let selGoal = null;
const goal = () => S.goals.find(g => g.id === selGoal) || S.goals[0];
const allTasks = () => S.goals.flatMap(g => g.tasks);
const streakOf = t => currentStreak(t.h, todayK());
const dayWord = n => `${n} ${n === 1 ? 'Day' : 'Days'}`;
function renderHabits() {
  if (!S.goals.some(g => g.id === selGoal)) selGoal = S.goals[0]?.id || null;
  const tk = todayK(), tasks = allTasks(), done = tasks.filter(t => t.h.includes(tk)).length, pct = tasks.length ? done / tasks.length * 100 : 0;
  $('#overall').innerHTML = `<div class="ring">${ringSvg}<b>${Math.round(pct)}%</b></div><div><h3>Overall progress</h3><p>${tasks.length ? `${done} / ${tasks.length} tasks completed today` : 'No tasks yet'}</p></div>`;
  setRing($('#overall .ring'), pct);
  $('#goalCards').innerHTML = S.goals.length ? S.goals.map(g => {
    const d = g.tasks.filter(t => t.h.includes(tk)).length, p = g.tasks.length ? d / g.tasks.length * 100 : 0, best = Math.max(0, ...g.tasks.map(streakOf));
    return `<button class="glass gcard ${g.id === selGoal ? 'on' : ''}" data-sel="${esc(g.id)}" aria-pressed="${g.id === selGoal}"><div><span>${esc(g.title)}</span><span>🔥 ${dayWord(best)}</span></div><small>${g.category ? esc(g.category) + ' · ' : ''}${d}/${g.tasks.length} tasks completed</small><span class="track"><i style="width:${p}%"></i></span></button>`;
  }).join('') : empty('No goals yet', 'Create a goal, add the daily tasks behind it and check them off to build streaks.', 'Create Goal', 'data-open="goalDlg" data-mode="new"');
  const g = goal(), tc = $('#taskCard'); tc.hidden = !g;
  if (g) {
    const cur = Math.max(0, ...g.tasks.map(streakOf)), lng = Math.max(0, ...g.tasks.map(t => longestStreak(t.h))), tot = g.tasks.reduce((n, t) => n + t.h.length, 0);
    const tgt = g.target ? `<p class="hint">Target: ${esc(fmtDay(g.target))} · ${g.target >= tk ? plural(CP.dayNum(g.target) - CP.dayNum(tk), 'day') + ' left' : 'date passed'}</p>` : '';
    tc.innerHTML = `<div class="card-head"><h3>${esc(g.title)}${g.category ? `<span class="cat">${esc(g.category)}</span>` : ''}</h3><span class="row-actions"><button class="ico" data-editgoal aria-label="Edit goal">${ico('edit')}</button><button class="ico del" data-delgoal aria-label="Delete goal">${ico('trash')}</button></span></div>
      ${g.desc ? `<p class="gdesc">${esc(g.desc)}</p>` : ''}${tgt}
      <div class="sumrow"><div><small>Current streak</small><b>🔥 ${cur}</b></div><div><small>Longest streak</small><b>🏆 ${lng}</b></div><div><small>Check-ins</small><b>${tot}</b></div></div>
      ${g.tasks.map(t => { const on = t.h.includes(tk), s = streakOf(t); return `<div class="task ${on ? 'done' : ''}" data-t="${esc(t.id)}"><button class="check" data-check aria-pressed="${on}" aria-label="${on ? 'Undo check-in' : 'Check in'}: ${esc(t.name)}">${ico('check')}</button><span class="tn">${esc(t.name)}</span><button class="streak" data-cal aria-label="Open streak calendar for ${esc(t.name)}">🔥 ${dayWord(s)}</button><button class="ico del" data-deltask aria-label="Delete task ${esc(t.name)}">${ico('x')}</button></div>`; }).join('') || '<p class="hint">No tasks in this goal yet. Add the first one below.</p>'}
      <form class="addtask" data-addtask><input class="in" maxlength="60" placeholder="Add a task" aria-label="New task name"><button class="btn sm ghost" aria-label="Add task">${ico('plus')}</button></form>`;
  }
  drawChart(); X.onHabits();
}
function drawChart() { /* native SVG chart (fx.js): works offline, no library to load */
  const tasks = allTasks();
  $('#chartHint').textContent = tasks.length ? '' : 'Add tasks to see their active streaks here.';
  CPFX.barChart($('#streakChart'), { labels: tasks.map(t => t.name), values: tasks.map(streakOf), unit: 'days', label: 'Active streak in days per habit' });
}
const toggleDay = (t, k) => { t.h = (t.h.includes(k) ? t.h.filter(x => x !== k) : [...t.h, k]).sort(); }; /* a Set-like toggle: a date can never be stored twice */
$('#goalCards').addEventListener('click', e => { const b = e.target.closest('[data-sel]'); if (b) { selGoal = b.dataset.sel; renderHabits(); } });
$('#taskCard').addEventListener('click', async e => {
  const g = goal(); if (!g) return;
  if (e.target.closest('[data-editgoal]')) return openGoal(g);
  if (e.target.closest('[data-delgoal]')) { if (await ask('Delete goal?', `“${g.title}” and all its check-in history will be removed.`)) { S.goals = S.goals.filter(x => x !== g); save(); toast('Goal deleted'); renderHabits(); } return; }
  const row = e.target.closest('[data-t]'), t = row && g.tasks.find(x => x.id === row.dataset.t); if (!t) return;
  if (e.target.closest('[data-check]')) {
    const was = t.h.includes(todayK()); toggleDay(t, todayK()); save(); renderHabits();
    if (!was) CPFX.confetti({ particleCount: 50, spread: 60, origin: { y: .7 }, colors: ['#10b981', '#22c55e', '#f97316'] });
  } else if (e.target.closest('[data-deltask]')) {
    if (t.h.length && !await ask('Delete task?', `“${t.name}” has ${plural(t.h.length, 'check-in')} that will be lost.`)) return;
    g.tasks = g.tasks.filter(x => x !== t); save(); renderHabits();
  } else if (e.target.closest('[data-cal]')) openCal(t);
});
$('#taskCard').addEventListener('submit', e => {
  e.preventDefault(); const i = $('input', e.target), name = i.value.trim(), g = goal(); if (!name || !g) return i.focus();
  g.tasks.push({ id: uid(), name, h: [], created: todayK() }); save(); renderHabits();
});

/* ---------- goal form (create + edit) ---------- */
let editGoal = null;
function goalRow(name = '', id = '') {
  const r = document.createElement('div'); r.className = 'trow2'; r.dataset.id = id;
  r.innerHTML = `<input class="in" maxlength="60" placeholder="e.g. Drink 2L water" aria-label="Subtask name"><button type="button" class="ico del" aria-label="Remove subtask">${ico('x')}</button>`;
  r.firstChild.value = name; $('#gTasks').appendChild(r); return r.firstChild;
}
function openGoal(g) {
  editGoal = g || null; $('#goalForm').reset(); showErr($('#gErr'), ''); $('#gTasks').innerHTML = '';
  $('#gHead').textContent = g ? 'Edit goal' : 'Create new goal';
  if (g) { $('#gTitle').value = g.title; $('#gCat').value = g.category; $('#gTarget').value = g.target; $('#gDesc').value = g.desc; g.tasks.forEach(t => goalRow(t.name, t.id)); } else goalRow();
  $('#goalDlg').showModal(); $('#gTitle').focus();
}
$('#addRow').addEventListener('click', () => goalRow().focus());
$('#gTasks').addEventListener('click', e => { if (e.target.closest('.del')) e.target.closest('.trow2').remove(); });
$('#gTasks').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); goalRow().focus(); } });
$('#goalForm').addEventListener('submit', e => {
  e.preventDefault(); const title = $('#gTitle').value.trim(), target = $('#gTarget').value, err = $('#gErr');
  if (!title) return showErr(err, 'Please enter a goal name.', $('#gTitle'));
  if (target && !isKey(target)) return showErr(err, 'Please enter a valid target date.', $('#gTarget'));
  const rows = $$('#gTasks .trow2').map(r => ({ id: r.dataset.id, name: r.firstChild.value.trim() })).filter(r => r.name);
  const old = editGoal ? new Map(editGoal.tasks.map(t => [t.id, t])) : new Map();
  const tasks = rows.map(r => old.has(r.id) ? Object.assign(old.get(r.id), { name: r.name }) : { id: uid(), name: r.name, h: [], created: todayK() });
  const data = { title, category: $('#gCat').value.trim(), target, desc: $('#gDesc').value.trim(), tasks };
  if (editGoal) Object.assign(editGoal, data); else { editGoal = { id: uid(), ...data }; S.goals.push(editGoal); }
  selGoal = editGoal.id; save(); $('#goalDlg').close(); toast('Goal saved'); if (tab !== 'habits') showTab('habits'); else renderHabits();
});

/* ---------- streak calendar ---------- */
let cal = null;
const findTask = id => allTasks().find(t => t.id === id);
function openCal(task) { const n = new Date(); cal = { id: task.id, y: n.getFullYear(), m: n.getMonth() }; $('#calGrid').setAttribute('role', 'group'); $('#calGrid').setAttribute('aria-label', 'Days of the month'); renderCal(); $('#calDlg').showModal(); }
function renderCal() {
  const task = findTask(cal.id); if (!task) return $('#calDlg').close();
  const { y, m } = cal, first = new Date(y, m, 1), total = dim(y, m), tk = todayK();
  setT($('#calTitle'), `🔥 ${task.name}`); setT($('#calCur'), String(streakOf(task))); setT($('#calBest'), String(longestStreak(task.h))); setT($('#calTot'), String(task.h.length));
  setT($('#calMonth'), first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));
  let h = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<span class="wd" aria-hidden="true">${d}</span>`).join('') + '<span class="pad"></span>'.repeat(first.getDay());
  const L = { done: 'completed', missed: 'missed', today: 'today, not yet completed', future: 'upcoming', none: 'not completed' };
  for (let d = 1; d <= total; d++) {
    const k = dkey(new Date(y, m, d)), st = dayStatus(task, k, tk), cur = k === tk ? ' today' : '';
    h += `<button class="${st === 'done' ? 'done' : st === 'missed' ? 'missed' : ''}${cur}" data-d="${k}" ${st === 'future' ? 'disabled' : ''} aria-label="${day(k).toLocaleDateString(undefined, { dateStyle: 'full' })}, ${L[st]}${k === tk && st === 'done' ? ', today' : ''}">${d}<span class="f" aria-hidden="true">${st === 'done' ? '🔥' : ''}</span></button>`;
  }
  $('#calGrid').innerHTML = h;
}
$('#calGrid').addEventListener('click', e => { const b = e.target.closest('[data-d]'); if (!b) return; const t = findTask(cal.id); if (!t) return; toggleDay(t, b.dataset.d); save(); renderCal(); renderHabits(); });
const monthStep = n => { const d = new Date(cal.y, cal.m + n, 1); cal.y = d.getFullYear(); cal.m = d.getMonth(); renderCal(); };
$('#calPrev').addEventListener('click', () => monthStep(-1));
$('#calNext').addEventListener('click', () => monthStep(1));

/* ---------- life progress ---------- */
function renderLife() {
  const lp = lifeProgress(new Date()), rows = [['Day progress', lp.day], ['Month progress', lp.month], ['Year progress', lp.year]], box = $('#lifeRings');
  if (box.children.length !== rows.length) box.innerHTML = rows.map(() => `<div class="glass rcard"><div class="head"></div><div class="ring">${ringSvg}<b></b></div><p class="muted det"></p><div class="track"><i></i></div></div>`).join('');
  rows.forEach(([l, v], i) => { const c = box.children[i]; setT(c.querySelector('.head'), l); setT(c.querySelector('b'), Math.floor(v.pct) + '%'); setT(c.querySelector('.det'), v.label); setRing(c.querySelector('.ring'), v.pct); c.querySelector('.track i').style.width = v.pct + '%'; });
  const tasks = allTasks(), tk = todayK();
  $('#quickStats').innerHTML = [['Total goals', S.goals.length], ['Active tasks', tasks.length], ['Completed today', tasks.filter(t => t.h.includes(tk)).length], ['Best current streak', `🔥 ${Math.max(0, ...tasks.map(streakOf))}d`], ['Longest streak', `🏆 ${Math.max(0, ...tasks.map(t => longestStreak(t.h)))}d`]].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
}

/* ---------- date difference ---------- */
function renderDiff() { $('#dA').value = S.diff.a; $('#dB').value = S.diff.b; showErr($('#dErr'), ''); calcDiff(); }
function calcDiff() {
  const { a, b } = S.diff, out = $('#dOut'), r = dateDiff(a, b);
  if (!r) { out.innerHTML = empty('No dates chosen', 'Pick a start and an end date to see the time between them.'); return; }
  const wk = Number(r.totalWeeks.toFixed(2)).toLocaleString();
  out.innerHTML = `${r.swapped ? `<p class="note">The dates were in reverse order, so the range is shown from ${esc(fmtDay(b))} to ${esc(fmtDay(a))}.</p>` : ''}<div class="dgrid"><div class="glass dcell first"><span>Time difference</span><b>${plural(r.years, 'Year')}<br>${plural(r.months, 'Month')}<br>${plural(r.days, 'Day')}</b></div>
    <div class="glass dcell"><span>Total days</span><b>${num(r.totalDays)}</b></div><div class="glass dcell"><span>Total weeks</span><b>${wk}</b></div>
    <div class="glass dcell"><span>Total hours</span><b>${num(r.totalHours)}</b></div><div class="glass dcell"><span>Total minutes</span><b>${num(r.totalMinutes)}</b></div></div>
    <p class="hint" style="margin-top:10px">Years, months and days use the calendar; hours and minutes count whole days from midnight to midnight.</p>`;
}
$('#diffForm').addEventListener('submit', e => {
  e.preventDefault(); const A = $('#dA'), B = $('#dB'), err = $('#dErr');
  if (!A.value || !B.value) return showErr(err, 'Choose both a start date and an end date.', !A.value ? A : B);
  if (!isKey(A.value) || !isKey(B.value)) return showErr(err, 'One of the dates is not valid (use 1900 or later).', !isKey(A.value) ? A : B);
  showErr(err, ''); S.diff = { a: A.value, b: B.value }; save(); calcDiff();
});

/* ---------- settings ---------- */
function renderSettings() { audioRender(); if (X.onSettings) X.onSettings(); }
$('#resetBtn').addEventListener('click', async () => {
  if (!await ask('Reset all data?', 'This permanently deletes your profile, events, goals, tasks, check-ins, focus history and safety copies from this browser. Export a backup first if you may want them back.', 'Reset everything')) return;
  try { for (let i = STORE.length - 1; i >= 0; i--) { const k = STORE.key(i); if (k && k.startsWith('chronopulse:')) STORE.removeItem(k); } } catch (e) { /* storage blocked: nothing to clear */ }
  if (X.clearSound) X.clearSound(); /* the custom reminder sound lives in IndexedDB, outside the chronopulse: keys */
  S = CP41.sanitize41(null); selGoal = null; X.onState(); storageOk = true; audioFail = audioFail === 'missing' ? 'missing' : null;
  renderWho(); showTab('countdown'); toast('All data cleared'); openOnboarding();
});

/* ---------- navigation + dialog wiring ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-tab]'); if (t) showTab(t.dataset.tab);
  const o = e.target.closest('[data-open]');
  if (o) {
    const id = o.dataset.open;
    if (id === 'eventDlg') openEvent(o.dataset.mode || 'event');
    else if (id === 'goalDlg') openGoal();
    else if (id === 'profileDlg') { $('#pName').value = S.profile.name; $('#pDob').value = S.profile.dob; $('#pDob').max = todayK(); showErr($('#pErr'), ''); $('#profileDlg').showModal(); $('#pName').focus(); }
  }
  if (e.target.closest('[data-close]')) e.target.closest('dialog').close();
  if (e.target.tagName === 'DIALOG') e.target.close(); /* tap on backdrop */
});
$('#onbDlg').addEventListener('close', audioSync);

/* ---------- share / summary card (drawn natively on a canvas, see fx.js) ---------- */
let shotBlob = null, shotUrl = null;
const summary = () => {
  const ev = activeEvent(), L = ['ChronoPulse 4.2'];
  if (ev) { const left = new Date(ev.at) - Date.now(); L.push(left > 0 ? `${ev.title}: ${num(left / 864e5)} days to go` : `${ev.title}: reached`); }
  allTasks().filter(t => streakOf(t) > 0).forEach(t => L.push(`🔥 ${t.name}: ${streakOf(t)}-day streak`));
  return L.length > 1 ? L.join('\n') : 'ChronoPulse 4.1: tracking time, one day at a time.';
};
const note = m => { $('#shotNote').textContent = m; };
const filePng = () => shotBlob && new File([shotBlob], 'chronopulse.png', { type: 'image/png' });
const canShareFile = () => { try { return !!(navigator.share && navigator.canShare && shotBlob && navigator.canShare({ files: [filePng()] })); } catch (e) { return false; } };
const download = () => { if (!shotBlob) return toast('No screenshot available yet'); downloadBlob(shotBlob, 'chronopulse.png'); };
async function nativeShare() {
  if (!canShareFile()) return false;
  try { await navigator.share({ files: [filePng()], text: summary(), title: 'ChronoPulse 4.1' }); } catch (err) { if (err.name !== 'AbortError') { note('Sharing failed: ' + err.message); return false; } }
  return true;
}
const shareBtns = on => $$('#shareDlg .sh').forEach(b => { b.disabled = !on; });
function cardModel() {
  const ev = activeEvent(), now = Date.now(), d = CP41.dailySummary(S, todayK()), top = allTasks().filter(t => streakOf(t) > 0).sort((a, b) => streakOf(b) - streakOf(a)).slice(0, 5);
  const m = { sub: S.profile.name || 'Time · Focus · Habits', heading: S.profile.name ? `${S.profile.name}'s progress` : 'My progress', lines: top.map(t => `🔥 ${t.name}: ${streakOf(t)}-day streak`), foot: new Date().toLocaleDateString(undefined, { dateStyle: 'long' }) + ' · ChronoPulse 4.1' };
  if (ev) { const t = new Date(ev.at), left = t - now, span = t - ev.start; m.heading = ev.title; m.big = left > 0 ? num(left / 864e5) : '🎉'; m.bigLabel = left > 0 ? 'days to go' : 'target reached'; m.pct = left <= 0 ? 100 : span > 0 ? Math.max(0, (now - ev.start) / span * 100) : 0; }
  if (d.sessions) m.lines.push(`⏱ ${Math.round(d.focusSec / 60)} min focused today · ${plural(d.sessions, 'session')}`);
  if (d.tasksDone) m.lines.push(`✅ ${plural(d.tasksDone, 'task')} done today`);
  if (!m.lines.length && !ev) m.lines.push('Tracking time, one day at a time.');
  return m;
}
async function openShare() {
  shotBlob = null; $('#shotImg').removeAttribute('src'); shareBtns(false); $('#shNat').hidden = !navigator.share; note('Drawing your summary card…'); $('#shareDlg').showModal();
  try {
    shotBlob = await CPFX.card(cardModel());
    if (shotUrl) URL.revokeObjectURL(shotUrl); shotUrl = URL.createObjectURL(shotBlob);
    $('#shotImg').src = shotUrl; note(''); shareBtns(true); $('#shNat').hidden = !canShareFile();
  } catch (err) { note('Could not create the image: ' + err.message); }
}
$('#shareBtn').addEventListener('click', openShare);
$('#shDl').addEventListener('click', () => { download(); note('Image downloaded.'); });
$('#shNat').addEventListener('click', async () => { if (!await nativeShare()) note('Your browser cannot share image files. Use Download image instead.'); });
$('#shWa').addEventListener('click', async () => {
  if (await nativeShare()) return;
  window.open('https://wa.me/?text=' + encodeURIComponent(summary()), '_blank', 'noopener'); download();
  note('WhatsApp opened with your text. Links cannot attach images, so the picture was downloaded — attach it in the chat.');
});
$('#shFb').addEventListener('click', async () => {
  if (await nativeShare()) return; download();
  note('Facebook does not accept images from a web link. The picture was downloaded — upload it in the Facebook app or site.');
});
$('#shIg').addEventListener('click', async () => {
  if (await nativeShare()) return; download();
  note('Instagram has no web share link. The picture was downloaded — post it from the Instagram app.');
});

/* ---------- onboarding (first launch only) ---------- */
function openOnboarding() {
  const d = $('#onbDlg'); if (d.open) return; $('#onbForm').reset(); showErr($('#oErr'), ''); $('#oDob').max = todayK();
  if (!d.open) d.showModal(); $('#oName').focus();
}
$('#onbDlg').addEventListener('cancel', e => e.preventDefault()); /* cannot be dismissed with Esc */
$('#onbDlg').addEventListener('keydown', e => { if (e.key === 'Escape') e.preventDefault(); });
$('#onbDlg').addEventListener('close', () => { if (!hasProfile()) setTimeout(openOnboarding); }); /* browsers may ignore preventDefault on cancel: reopen */
$('#onbDlg').addEventListener('click', e => e.stopPropagation(), true); /* nor by tapping outside */
$('#onbForm').addEventListener('submit', e => {
  e.preventDefault(); const name = $('#oName').value.trim(), dob = $('#oDob').value, v = validateProfile(name, dob);
  if (v) return showErr($('#oErr'), v[0], v[1] === 'name' ? $('#oName') : $('#oDob'));
  S.profile = { name, dob }; save(); $('#onbDlg').close(); renderWho(); toast('Welcome, ' + name + '!'); renderTab();
});

/* ---------- boot (after every deferred script, so focus-ui.js has registered its screens) ---------- */
function boot() { reconcileNow(); renderWho(); showTab(location.hash.slice(1) || 'countdown', true); audioRender(); if (!hasProfile()) openOnboarding(); X.boot(); routeEventHash(); }
addEventListener('DOMContentLoaded', boot);
