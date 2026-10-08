'use strict';
/* ChronoPulse — every piece of data comes from the user and lives in localStorage. */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const KEY = 'chronopulse:v3';
const blank = () => ({ profile: { name: '', dob: '' }, events: [], active: null, goals: [], diff: { a: '', b: '' }, sound: true });
let S = blank();
try { S = { ...blank(), ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (e) { /* corrupt or blocked storage: start clean */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage full or blocked */ } };

/* ---------- helpers ---------- */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = (n, l = 2) => String(n).padStart(l, '0');
const dkey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const day = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmt = d => new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const num = n => Math.floor(n).toLocaleString();
const ico = n => `<svg class="i" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const setT = (el, t) => { if (el.textContent !== t) el.textContent = t; };
const addMonths = (d, n) => {
  const r = new Date(d), dd = r.getDate();
  r.setDate(1); r.setMonth(r.getMonth() + n);
  r.setDate(Math.min(dd, new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate()));
  return r;
};
/* Calendar-accurate difference between a <= b */
const parts = (a, b) => {
  let m = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();
  if (addMonths(a, m) > b) m--;
  const ms = b - addMonths(a, m);
  return { months: m, days: Math.floor(ms / 864e5), h: Math.floor(ms % 864e5 / 36e5), mi: Math.floor(ms % 36e5 / 6e4), s: Math.floor(ms % 6e4 / 1e3), ms: ms % 1e3 };
};
const streakOf = h => {
  const s = new Set(h); const d = new Date();
  if (!s.has(dkey(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (s.has(dkey(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
};
let toastT;
const toast = msg => {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2200);
};
const empty = (title, text, btn, dlg) => `<div class="empty glass sm"><h3>${title}</h3><p>${text}</p>${btn ? `<button class="btn sm" data-open="${dlg}">${ico('plus')}${btn}</button>` : ''}</div>`;

/* ---------- tabs ---------- */
let tab = 'countdown';
function showTab(name) {
  tab = name;
  $$('.tabs button').forEach(b => { const on = b.dataset.tab === name; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  $$('.panel').forEach(p => p.classList.toggle('on', p.id === 'tab-' + name));
  renderTab();
  audioSync(); // tick is only allowed on the Countdown tab
}
$('.tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); });
$('.tabs').addEventListener('keydown', e => {
  if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  const t = $$('.tabs button'), i = t.findIndex(b => b.dataset.tab === tab);
  const n = t[(i + (e.key === 'ArrowRight' ? 1 : t.length - 1)) % t.length]; n.focus(); showTab(n.dataset.tab);
});
function renderTab() {
  ({ countdown: renderCountdown, profile: renderProfile, habits: renderHabits, life: renderLife, diff: renderDiff })[tab]();
}

/* ---------- audio: one local file, Countdown tab only ---------- */
const tickAudio = new Audio('doomsday-tick.mp3');
tickAudio.loop = true;      // seamless loop of the 55 s track
tickAudio.preload = 'auto';
let aligned = false;
function audioRender() {
  const playing = !tickAudio.paused;
  const st = playing ? 'playing' : (S.sound ? 'paused' : 'muted');
  const b = $('#audioBtn');
  b.dataset.state = st;
  $('#audioLabel').textContent = st[0].toUpperCase() + st.slice(1);
  $('#audioUse').setAttribute('href', '#i-' + (st === 'playing' ? 'sound' : st === 'muted' ? 'mute' : 'pause'));
  b.setAttribute('aria-pressed', S.sound);
  b.title = st === 'paused' && tab === 'countdown' ? 'Click anywhere on the page to start the tick' : 'Toggle tick sound';
}
function audioSync() {
  const allowed = S.sound && tab === 'countdown' && !document.hidden;
  if (!allowed) { tickAudio.pause(); audioRender(); return; }
  if (tickAudio.paused) {
    if (!aligned && tickAudio.duration) { // first start only: line the ticks up with the wall clock
      const n = new Date();
      tickAudio.currentTime = (n.getSeconds() + n.getMilliseconds() / 1e3) % tickAudio.duration;
      aligned = true;
    }
    tickAudio.play().catch(() => { /* blocked until the first user gesture */ }).finally(audioRender);
  }
  audioRender();
}
['play', 'pause'].forEach(ev => tickAudio.addEventListener(ev, audioRender));
tickAudio.addEventListener('loadedmetadata', audioSync);
['pointerdown', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, audioSync, { once: true, passive: true }));
document.addEventListener('visibilitychange', audioSync);
$('#audioBtn').addEventListener('click', () => { S.sound = !S.sound; save(); audioSync(); });

/* ---------- countdown engine ---------- */
const cells = $$('#cdGrid b');
let fired = null;
const activeEvent = () => S.events.find(e => e.id === S.active);
function renderCountdown() {
  const ev = activeEvent();
  $('#cdEmpty').hidden = S.events.length > 0 && !!ev;
  $('#cdLive').hidden = !ev;
  if (S.events.length && !ev) $('#cdEmpty').hidden = false;
  $('#chips').innerHTML = S.events.map(e => `<button class="chip ${e.id === S.active ? 'on' : ''}" data-pick="${e.id}">${esc(e.title)}</button>`).join('') +
    (S.events.length ? `<button class="chip add" data-open="eventDlg">${ico('plus')}New</button>` : '');
  if (ev) { setT($('#cdTitle'), ev.title); setT($('#cdAt'), 'Target: ' + fmt(ev.at)); }
}
function tickCountdown(now) {
  const ev = activeEvent(); if (!ev) return;
  const t = new Date(ev.at), done = t - now <= 0;
  const p = done ? { months: 0, days: 0, h: 0, mi: 0, s: 0, ms: 0 } : parts(now, t);
  [p.months, p.days, p.h, p.mi, p.s].map(n => pad(n)).concat(pad(p.ms, 3)).forEach((v, i) => setT(cells[i], v));
  const left = Math.max(0, t - now);
  const pct = done ? 100 : Math.min(100, Math.max(0, (now - ev.start) / (t - ev.start) * 100));
  $('#cdBar').style.width = pct + '%';
  setT($('#cdPct'), done ? 'Reached' : pct.toFixed(1) + '% elapsed');
  setT($('#cdLeft'), done ? 'Time is up' : num(left / 864e5) + ' days remaining');
  setT($('#cdNow'), 'Now: ' + now.toLocaleString());
  setT($('#mD'), num(left / 864e5)); setT($('#mW'), (left / 6048e5).toFixed(1));
  setT($('#mH'), num(left / 36e5)); setT($('#mM'), num(left / 6e4));
  if (done && fired !== ev.id) { fired = ev.id; if (window.confetti) confetti({ particleCount: 140, spread: 85, origin: { y: .5 } }); }
}
(function frame() {
  if (tab === 'countdown' && !document.hidden) tickCountdown(new Date());
  requestAnimationFrame(frame);
})();
setInterval(() => { if (tab === 'profile') renderProfileLive(); if (tab === 'life') renderLife(); }, 1000);

/* ---------- events (countdown targets) ---------- */
$('#eventForm').addEventListener('submit', e => {
  e.preventDefault();
  const title = $('#eTitle').value.trim(), at = $('#eAt').value;
  if (!title || !at) return;
  const ev = { id: uid(), title, at, start: Date.now() };
  S.events.push(ev); S.active = ev.id; save();
  $('#eventDlg').close(); toast('Countdown started');
  if (tab !== 'countdown') renderTab(); else renderCountdown();
});
function renderEventList() {
  $('#eventList').innerHTML = S.events.length ? S.events.map(e => {
    const d = Math.ceil((new Date(e.at) - Date.now()) / 864e5);
    return `<div class="item"><div class="grow"><b>${esc(e.title)}</b><small>${fmt(e.at)}</small></div>
      <span class="tag">${d > 0 ? d + (d === 1 ? ' day left' : ' days left') : 'Reached'}</span>
      <button class="ico" data-track="${e.id}" title="Show on Countdown Engine">${ico('right')}</button>
      <button class="ico del" data-delev="${e.id}" aria-label="Delete ${esc(e.title)}">${ico('trash')}</button></div>`;
  }).join('') : empty('No dates yet', 'Add a birthday, deadline or trip. Each one can drive the live countdown.', 'Add a date', 'eventDlg');
}
document.addEventListener('click', e => {
  const pick = e.target.closest('[data-pick]'), trk = e.target.closest('[data-track]'), del = e.target.closest('[data-delev]');
  if (pick || trk) { S.active = (pick || trk).dataset.pick || trk.dataset.track; save(); if (trk) showTab('countdown'); else renderCountdown(); }
  if (del) {
    S.events = S.events.filter(x => x.id !== del.dataset.delev);
    if (S.active === del.dataset.delev) S.active = S.events.length ? S.events[S.events.length - 1].id : null;
    save(); renderTab();
  }
});

/* ---------- profile ---------- */
$('#profileForm').addEventListener('submit', e => {
  e.preventDefault();
  S.profile = { name: $('#pName').value.trim(), dob: $('#pDob').value }; save();
  renderProfileLive(); toast('Profile saved');
});
function renderProfile() {
  $('#pName').value = S.profile.name; $('#pDob').value = S.profile.dob;
  renderProfileLive(); renderEventList();
}
function renderProfileLive() {
  const dob = S.profile.dob; $('#pEmpty').hidden = !!dob;
  const f = ['#pAge', '#pBday', '#pDays', '#pHours'].map(s => $(s));
  if (!dob) { f.forEach(el => setT(el, '—')); return; }
  const b = day(dob), now = new Date();
  if (b > now) { f.forEach(el => setT(el, '—')); $('#pEmpty').hidden = false; $('#pEmpty').textContent = 'That date of birth is in the future. Check the date and save again.'; return; }
  const p = parts(b, now);
  setT(f[0], `${Math.floor(p.months / 12)}y ${p.months % 12}m ${p.days}d`);
  let nb = new Date(now.getFullYear(), b.getMonth(), b.getDate());
  if (nb <= new Date(now.getFullYear(), now.getMonth(), now.getDate())) nb = new Date(now.getFullYear() + 1, b.getMonth(), b.getDate());
  const dl = Math.ceil((nb - now) / 864e5); setT(f[1], dl + (dl === 1 ? ' day' : ' days'));
  setT(f[2], num((now - b) / 864e5)); setT(f[3], num((now - b) / 36e5));
}

/* ---------- habits ---------- */
const todayK = () => dkey(new Date());
function renderHabits() { renderGoals(); renderChart(); }
function renderGoals() {
  $('#goals').innerHTML = S.goals.length ? S.goals.map(g => {
    const done = g.tasks.filter(t => t.h.includes(todayK())).length, pct = g.tasks.length ? done / g.tasks.length * 100 : 0;
    return `<article class="glass goal" data-g="${g.id}">
      <div class="card-head"><h3>${esc(g.title)}</h3><button class="ico del" data-delgoal="${g.id}" aria-label="Delete goal">${ico('trash')}</button></div>
      <div class="meta"><span class="muted">${done}/${g.tasks.length} today</span><div class="track"><i style="width:${pct}%"></i></div></div>
      ${g.tasks.map(t => `<div class="task ${t.h.includes(todayK()) ? 'done' : ''}" data-t="${t.id}">
        <button class="check" data-check aria-label="Check in: ${esc(t.name)}">${ico('check')}</button>
        <span class="nm">${esc(t.name)}</span>
        <button class="streak" data-cal title="Open streak calendar">🔥 ${streakOf(t.h)}d</button>
        <button class="ico del" data-deltask aria-label="Delete task">${ico('x')}</button></div>`).join('') || '<p class="hint">No tasks yet. Add the first one below.</p>'}
      <form class="addtask" data-addtask><input class="in" maxlength="60" placeholder="Add a task" aria-label="New task name"><button class="btn sm ghost" aria-label="Add task">${ico('plus')}</button></form>
    </article>`;
  }).join('') : empty('No goals yet', 'Create a goal, add the daily tasks that support it, and check them off to build streaks.', 'Create your first goal', 'goalDlg');
}
function renderChart() {
  const c = $('#chart'), tasks = S.goals.flatMap(g => g.tasks);
  if (!tasks.length) { c.innerHTML = empty('Nothing to chart', 'Your 14-day completion and streaks will show up here once you add tasks.'); return; }
  const days = [...Array(14)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - 13 + i); return d; });
  const bars = days.map(d => { const k = dkey(d), n = tasks.filter(t => t.h.includes(k)).length, p = n / tasks.length * 100;
    return `<i class="${n ? '' : 'z'}" style="height:${n ? Math.max(8, p) : 3}%" title="${d.toLocaleDateString()}: ${n}/${tasks.length} tasks"></i>`; }).join('');
  const top = tasks.map(t => ({ n: t.name, s: streakOf(t.h) })).sort((a, b) => b.s - a.s).slice(0, 6), max = Math.max(1, top[0].s);
  c.innerHTML = `<h3>Last 14 days</h3><div class="bars">${bars}</div>
    <h3>Current streaks</h3>${top.map(t => `<div class="hrow"><div><span>${esc(t.n)}</span><span>🔥 ${t.s}d</span></div><div class="track"><i style="width:${t.s / max * 100}%"></i></div></div>`).join('')}`;
}
const find = el => { const g = S.goals.find(x => x.id === el.closest('[data-g]').dataset.g), t = el.closest('[data-t]'); return [g, t && g.tasks.find(x => x.id === t.dataset.t)]; };
const toggleDay = (t, k) => { t.h = t.h.includes(k) ? t.h.filter(x => x !== k) : [...t.h, k]; };
$('#goals').addEventListener('click', e => {
  const g = e.target.closest('[data-delgoal]');
  if (g) { S.goals = S.goals.filter(x => x.id !== g.dataset.delgoal); save(); return renderHabits(); }
  if (!e.target.closest('[data-g]')) return;
  const [goal, task] = find(e.target);
  if (e.target.closest('[data-check]')) {
    const was = task.h.includes(todayK()); toggleDay(task, todayK()); save(); renderHabits();
    if (!was && window.confetti) confetti({ particleCount: 60, spread: 60, origin: { y: .7 } });
  } else if (e.target.closest('[data-deltask]')) { goal.tasks = goal.tasks.filter(x => x !== task); save(); renderHabits(); }
  else if (e.target.closest('[data-cal]')) openCal(goal, task);
});
$('#goals').addEventListener('submit', e => {
  e.preventDefault();
  const inp = $('input', e.target), name = inp.value.trim(); if (!name) return;
  find(e.target)[0].tasks.push({ id: uid(), name, h: [] }); save(); renderHabits();
});
/* new goal dialog */
function goalRow() {
  const r = document.createElement('input'); r.className = 'in'; r.maxLength = 60; r.placeholder = 'e.g. 20 pushups'; r.setAttribute('aria-label', 'Task name');
  $('#gTasks').appendChild(r); return r;
}
$('#addRow').addEventListener('click', () => goalRow().focus());
$('#gTasks').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); goalRow().focus(); } });
$('#goalForm').addEventListener('submit', e => {
  e.preventDefault();
  const title = $('#gTitle').value.trim(); if (!title) return;
  const tasks = $$('#gTasks input').map(i => i.value.trim()).filter(Boolean).map(name => ({ id: uid(), name, h: [] }));
  S.goals.push({ id: uid(), title, tasks }); save(); $('#goalDlg').close(); toast('Goal saved'); renderTab();
});

/* ---------- streak calendar ---------- */
let cal = null;
function openCal(goal, task) { const n = new Date(); cal = { task, goal, y: n.getFullYear(), m: n.getMonth() }; renderCal(); $('#calDlg').showModal(); }
function renderCal() {
  const { task, y, m } = cal, first = new Date(y, m, 1), total = new Date(y, m + 1, 0).getDate(), tk = todayK();
  $('#calTitle').textContent = `🔥 ${task.name}`;
  $('#calStats').textContent = `${streakOf(task.h)}-day current streak · ${task.h.length} total check-ins`;
  $('#calMonth').textContent = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  let h = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(d => `<span class="wd">${d}</span>`).join('') + '<span class="pad"></span>'.repeat((first.getDay() + 6) % 7);
  for (let d = 1; d <= total; d++) {
    const k = dkey(new Date(y, m, d)), hit = task.h.includes(k);
    h += `<button class="${hit ? 'hit' : ''} ${k === tk ? 'today' : ''}" data-d="${k}" ${k > tk ? 'disabled' : ''} aria-label="${k}${hit ? ', completed' : ''}">${d}<span>${hit ? '🔥' : ''}</span></button>`;
  }
  $('#calGrid').innerHTML = h;
}
$('#calGrid').addEventListener('click', e => {
  const b = e.target.closest('[data-d]'); if (!b) return;
  toggleDay(cal.task, b.dataset.d); save(); renderCal(); renderHabits();
});
const monthStep = n => { const d = new Date(cal.y, cal.m + n, 1); cal.y = d.getFullYear(); cal.m = d.getMonth(); renderCal(); };
$('#calPrev').addEventListener('click', () => monthStep(-1));
$('#calNext').addEventListener('click', () => monthStep(1));

/* ---------- life progress ---------- */
function renderLife() {
  const n = new Date(), sd = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  const wk = new Date(sd); wk.setDate(sd.getDate() - ((sd.getDay() + 6) % 7));
  const rows = [
    ['Today', (n - sd) / 864e5],
    ['This week', (n - wk) / 6048e5],
    ['This month', (n - new Date(n.getFullYear(), n.getMonth(), 1)) / (new Date(n.getFullYear(), n.getMonth() + 1, 1) - new Date(n.getFullYear(), n.getMonth(), 1))],
    ['This year', (n - new Date(n.getFullYear(), 0, 1)) / (new Date(n.getFullYear() + 1, 0, 1) - new Date(n.getFullYear(), 0, 1))]
  ];
  const box = $('#lifeBars');
  if (box.children.length !== rows.length) box.innerHTML = rows.map(() => '<div class="lifebar"><div><span></span><b></b></div><div class="track"><i></i></div></div>').join('');
  rows.forEach(([l, v], i) => { const r = box.children[i]; setT(r.querySelector('span'), l); setT(r.querySelector('b'), (v * 100).toFixed(2) + '%'); r.querySelector('i').style.width = v * 100 + '%'; });
}

/* ---------- date difference ---------- */
function renderDiff() { $('#dA').value = S.diff.a; $('#dB').value = S.diff.b; calcDiff(); }
function calcDiff() {
  const { a, b } = S.diff, out = $('#dOut');
  if (!a || !b) { out.innerHTML = '<p class="muted">Choose a start and an end date to see the gap between them.</p>'; return; }
  let x = day(a), y = day(b); if (x > y) [x, y] = [y, x];
  const days = Math.round((y - x) / 864e5), p = parts(x, y);
  out.innerHTML = `<div class="big">${num(days)} ${days === 1 ? 'day' : 'days'}</div>
    <p>${Math.floor(p.months / 12)} years, ${p.months % 12} months, ${p.days} days</p>
    <p class="muted">${(days / 7).toFixed(1)} weeks · ${num(days * 24)} hours · ${num(days * 1440)} minutes</p>`;
}
['dA', 'dB'].forEach(id => $('#' + id).addEventListener('input', () => { S.diff = { a: $('#dA').value, b: $('#dB').value }; save(); calcDiff(); }));

/* ---------- dialogs ---------- */
document.addEventListener('click', e => {
  const o = e.target.closest('[data-open]');
  if (o) {
    const d = $('#' + o.dataset.open); d.querySelector('form')?.reset();
    if (d.id === 'goalDlg') { $('#gTasks').innerHTML = ''; goalRow(); }
    d.showModal(); d.querySelector('input')?.focus();
  }
  if (e.target.closest('[data-close]')) e.target.closest('dialog').close();
  if (e.target.tagName === 'DIALOG') e.target.close(); // click on backdrop
});

/* ---------- share / screenshot ---------- */
let shot = null;
const summary = () => {
  const ev = activeEvent(), L = ['ChronoPulse progress'];
  if (ev) { const left = new Date(ev.at) - Date.now(); L.push(left > 0 ? `${ev.title}: ${num(left / 864e5)} days to go` : `${ev.title}: reached`); }
  S.goals.forEach(g => g.tasks.forEach(t => L.push(`${g.title} · ${t.name}: ${streakOf(t.h)}-day streak`)));
  return L.length > 1 ? L.join('\n') : 'ChronoPulse: tracking time, one day at a time.';
};
$('#shareBtn').addEventListener('click', async () => {
  shot = null; $('#shotImg').removeAttribute('src'); $('#shotNote').textContent = 'Capturing your screen…'; $('#shareDlg').showModal();
  try {
    if (!window.html2canvas) throw new Error('offline');
    shot = await html2canvas($('#capture'), { backgroundColor: '#07090f', scale: Math.min(2, window.devicePixelRatio || 1), onclone: d => d.body.classList.add('shot') });
    $('#shotImg').src = shot.toDataURL('image/png'); $('#shotNote').textContent = '';
  } catch (err) { $('#shotNote').textContent = 'Screenshots need the html2canvas library, which could not load. You can still share a text summary.'; }
});
$('#shotDl').addEventListener('click', () => {
  if (!shot) return toast('No screenshot to download');
  const a = document.createElement('a'); a.download = 'chronopulse.png'; a.href = shot.toDataURL('image/png'); a.click();
});
$('#shotCopy').addEventListener('click', () => navigator.clipboard?.writeText(summary()).then(() => toast('Summary copied'), () => toast('Copy blocked by the browser')));
$('#shotShare').addEventListener('click', async () => {
  if (!navigator.share) return toast('Sharing is not supported here. Download the image instead.');
  try {
    const blob = shot && await new Promise(r => shot.toBlob(r)), file = blob && new File([blob], 'chronopulse.png', { type: 'image/png' });
    await navigator.share(file && navigator.canShare?.({ files: [file] }) ? { files: [file], text: summary() } : { text: summary() });
  } catch (err) { /* share cancelled */ }
});

/* ---------- boot ---------- */
if (S.active && !activeEvent()) S.active = null;
renderTab(); audioRender();
