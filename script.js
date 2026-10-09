'use strict';
/* ChronoPulse 4.0 — all data is created by the user and persisted in localStorage. */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const KEY = 'chronopulse:v4';
const blank = () => ({ profile: { name: '', dob: '' }, events: [], active: null, goals: [], diff: { a: '', b: '' }, sound: true });
let S = blank();
try { S = { ...blank(), ...JSON.parse(localStorage.getItem(KEY) || localStorage.getItem('chronopulse:v3') || '{}') }; } catch (e) { /* corrupt or blocked storage: start clean */ }
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
const parts = (a, b) => { /* calendar-accurate difference, a <= b */
  let m = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();
  if (addMonths(a, m) > b) m--;
  const ms = b - addMonths(a, m);
  return { months: m, days: Math.floor(ms / 864e5), h: Math.floor(ms % 864e5 / 36e5), mi: Math.floor(ms % 36e5 / 6e4), s: Math.floor(ms % 6e4 / 1e3), ms: ms % 1e3 };
};
const todayK = () => dkey(new Date());
const streakOf = h => {
  const s = new Set(h), d = new Date();
  if (!s.has(dkey(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (s.has(dkey(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
};
let toastT;
const toast = msg => { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2400); };
const empty = (title, text, btn, dlg) => `<div class="empty glass sm"><h3>${title}</h3><p>${text}</p>${btn ? `<button class="btn sm" data-open="${dlg}">${ico('plus')}${btn}</button>` : ''}</div>`;
const setRing = (el, pct) => { el.querySelector('.fg').style.strokeDashoffset = 100 - Math.max(0, Math.min(100, pct)); };

/* ---------- navigation ---------- */
const TITLES = {
  countdown: ['Countdown Engine', 'Make every second count!'],
  profile: ['My Profile', 'Your personal timeline and important moments'],
  habits: ['Habit & Task Dashboard', 'Build better habits. Achieve bigger dreams.'],
  life: ['Life Progress', 'Track your journey. Visualize your progress.'],
  diff: ['Date Difference Calculator', 'Find the difference between any two dates.']
};
let tab = 'countdown';
function showTab(name) {
  tab = name;
  $$('.nav button').forEach(b => { const on = b.dataset.tab === name; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  $$('.panel').forEach(p => p.classList.toggle('on', p.id === 'tab-' + name));
  $('#pageTitle').textContent = TITLES[name][0]; $('#pageSub').textContent = TITLES[name][1];
  renderTab();
  audioSync(); // tick is allowed on the Countdown Engine tab only
}
$('.nav').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); });
$('.nav').addEventListener('keydown', e => {
  const k = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key]; if (!k) return;
  const t = $$('.nav button'), i = t.findIndex(b => b.dataset.tab === tab), n = t[(i + k + t.length) % t.length];
  e.preventDefault(); n.focus(); showTab(n.dataset.tab);
});
function renderTab() { ({ countdown: renderCountdown, profile: renderProfile, habits: renderHabits, life: renderLife, diff: renderDiff })[tab](); }

/* ---------- audio: only doomsday-tick.mp3, only on the Countdown tab ---------- */
const tickAudio = new Audio('doomsday-tick.mp3');
tickAudio.loop = true; // seamless loop of the 55 s track
tickAudio.preload = 'auto';
let aligned = false;
function audioRender() {
  const playing = !tickAudio.paused, st = playing ? 'playing' : (S.sound ? 'paused' : 'muted'), b = $('#audioBtn');
  b.dataset.state = st; b.setAttribute('aria-checked', S.sound);
  setT($('#audioLabel'), S.sound ? 'ON' : 'OFF');
  setT($('#audioState'), st[0].toUpperCase() + st.slice(1));
  b.title = st === 'paused' && tab === 'countdown' ? 'Click anywhere on the page to start the tick' : 'Turn tick sound on or off';
}
function audioSync() {
  const allowed = S.sound && tab === 'countdown' && !document.hidden;
  if (!allowed) { tickAudio.pause(); audioRender(); return; }
  if (tickAudio.paused) {
    if (!aligned && tickAudio.duration) { /* first start only: line the ticks up with the wall clock */
      const n = new Date(); tickAudio.currentTime = (n.getSeconds() + n.getMilliseconds() / 1e3) % tickAudio.duration; aligned = true;
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
const presets = () => [];
function renderCountdown() {
  const ev = activeEvent(), ps = presets();
  $('#cdEmpty').hidden = !!ev; $('#cdLive').hidden = !ev;
  $('#chips').innerHTML =
    ps.map((p, i) => `<button class="chip ${ev && ev.title === p.t ? 'on' : ''}" data-preset="${i}">${esc(p.t)}</button>`).join('') +
    S.events.filter(e => !ps.some(p => p.t === e.title)).map(e => `<button class="chip ${e.id === S.active ? 'on' : ''}" data-pick="${e.id}">${esc(e.title)}</button>`).join('') +
    `<button class="chip add" data-open="eventDlg">${ico('plus')}Custom date</button>`;
  if (ev) { setT($('#cdTitle'), ev.title); setT($('#cdAt'), fmt(ev.at)); }
}
function tickCountdown(now) {
  const ev = activeEvent(); if (!ev) return;
  const t = new Date(ev.at), done = t - now <= 0;
  const p = done ? { months: 0, days: 0, h: 0, mi: 0, s: 0, ms: 0 } : parts(now, t);
  [p.months, p.days, p.h, p.mi, p.s].map(n => pad(n)).concat(pad(p.ms, 3)).forEach((v, i) => setT(cells[i], v));
  const left = Math.max(0, t - now), pct = done ? 100 : Math.min(100, Math.max(0, (now - ev.start) / (t - ev.start) * 100));
  $('#cdBar').style.width = pct + '%'; setRing($('#cdRing'), pct);
  $('.hero').classList.toggle('urgent', !done && left < 864e5); setT($('#cdPct'), done ? 'Target reached' : pct.toFixed(1) + '% completed');
  setT($('#cdLeft'), done ? 'Time is up' : num(left / 864e5) + ' days remaining');
  setT($('#cdNow'), 'Live system clock: ' + now.toLocaleString());
  setT($('#mD'), num(left / 864e5)); setT($('#mW'), (left / 6048e5).toFixed(1)); setT($('#mH'), num(left / 36e5)); setT($('#mM'), num(left / 6e4));
  if (done && fired !== ev.id) { fired = ev.id; if (window.confetti) confetti({ particleCount: 160, spread: 90, origin: { y: .5 }, colors: ['#f97316', '#ef4444', '#10b981', '#ffffff'] }); }
}
(function frame() { if (tab === 'countdown' && !document.hidden) tickCountdown(new Date()); requestAnimationFrame(frame); })();
setInterval(() => { if (tab === 'profile') { renderProfileLive(); liveEvents(); } if (tab === 'life') renderLife(); }, 1000);

/* ---------- events ---------- */
$('#eventForm').addEventListener('submit', e => {
  e.preventDefault();
  const title = $('#eTitle').value.trim(), at = $('#eAt').value; if (!title || !at) return;
  const ev = { id: uid(), title, at, start: Date.now() };
  S.events.push(ev); S.active = ev.id; save(); $('#eventDlg').close(); toast('Countdown started'); renderTab();
});
function liveEvents() {
  $$('[data-at]').forEach(el => {
    const ms = new Date(el.dataset.at) - Date.now();
    if (ms <= 0) { setT(el, 'Reached'); el.classList.add('done'); return; }
    setT(el, `${Math.floor(ms / 864e5)}d ${pad(Math.floor(ms % 864e5 / 36e5))}h ${pad(Math.floor(ms % 36e5 / 6e4))}m ${pad(Math.floor(ms % 6e4 / 1e3))}s`);
  });
}
function renderEventList() {
  $('#eventList').innerHTML = S.events.length
    ? `<div class="trow h"><span>Event</span><span>Date</span><span>Countdown</span><span></span></div>` + S.events.map(e =>
      `<div class="trow"><span class="nm" title="${esc(e.title)}">${esc(e.title)}</span><span>${new Date(e.at).toLocaleDateString(undefined, { dateStyle: 'medium' })}</span>
       <span class="cdtxt" data-at="${esc(e.at)}"></span><button class="ico del" data-delev="${e.id}" aria-label="Delete ${esc(e.title)}">${ico('trash')}</button></div>`).join('')
    : empty('No events yet', "Click '+' to add a birthday, deadline or trip. Each one gets its own live ticker.", 'Add event', 'eventDlg');
  liveEvents();
}
document.addEventListener('click', e => {
  const ps = e.target.closest('[data-preset]'), pick = e.target.closest('[data-pick]'), del = e.target.closest('[data-delev]');
  if (ps) {
    const p = presets()[ps.dataset.preset]; let ev = S.events.find(x => x.title === p.t && x.at === p.at);
    if (!ev) { ev = { id: uid(), title: p.t, at: p.at, start: Date.now() }; S.events.push(ev); }
    S.active = ev.id; save(); renderCountdown();
  }
  if (pick) { S.active = pick.dataset.pick; save(); renderCountdown(); }
  if (del) {
    S.events = S.events.filter(x => x.id !== del.dataset.delev);
    if (S.active === del.dataset.delev) S.active = null;
    save(); renderTab();
  }
});

/* ---------- profile ---------- */
$('#profileForm').addEventListener('submit', e => {
  e.preventDefault(); const nm = $('#pName').value.trim(); if (!nm) return toast('Username is required'); S.profile = { name: nm, dob: $('#pDob').value }; save(); renderProfileLive(); renderWho(); toast('Profile saved');
});
function renderProfile() { $('#pName').value = S.profile.name; $('#pDob').value = S.profile.dob; renderProfileLive(); renderEventList(); }
function renderProfileLive() {
  const dob = S.profile.dob, f = ['#pAge', '#pBday', '#pDays', '#pHours'].map(s => $(s)), hint = $('#pEmpty');
  const reset = msg => { f.forEach(el => setT(el, '—')); setT($('#pExact'), ''); hint.hidden = false; hint.textContent = msg; };
  if (!dob) return reset('Add your date of birth to unlock your exact age and time lived.');
  const b = day(dob), now = new Date();
  if (b > now) return reset('That date of birth is in the future. Check the date and save again.');
  hint.hidden = true;
  const p = parts(b, now);
  setT(f[0], String(Math.floor(p.months / 12)));
  let nb = new Date(now.getFullYear(), b.getMonth(), b.getDate());
  if (nb <= new Date(now.getFullYear(), now.getMonth(), now.getDate())) nb = new Date(now.getFullYear() + 1, b.getMonth(), b.getDate());
  setT(f[1], String(Math.ceil((nb - now) / 864e5)));
  setT(f[2], num((now - b) / 864e5)); setT(f[3], num((now - b) / 36e5));
  setT($('#pExact'), `${S.profile.name ? S.profile.name + ', you are ' : 'You are '}${Math.floor(p.months / 12)} years, ${p.months % 12} months and ${p.days} days old.`);
}

/* ---------- habits ---------- */
let selGoal = null, chart = null;
const goal = () => S.goals.find(g => g.id === selGoal) || S.goals[0];
function renderHabits() {
  if (!S.goals.some(g => g.id === selGoal)) selGoal = S.goals[0]?.id || null;
  $('#goalCards').innerHTML = S.goals.length ? S.goals.map(g => {
    const done = g.tasks.filter(t => t.h.includes(todayK())).length, pct = g.tasks.length ? done / g.tasks.length * 100 : 0, best = Math.max(0, ...g.tasks.map(t => streakOf(t.h)));
    return `<button class="glass gcard ${g.id === selGoal ? 'on' : ''}" data-sel="${g.id}"><div><span>${esc(g.title)}</span><span>🔥 ${best} ${best === 1 ? 'Day' : 'Days'}</span></div><small>${done}/${g.tasks.length} tasks completed</small><span class="track"><i style="width:${pct}%"></i></span></button>`;
  }).join('') : empty('No goals added yet', "Click '+' to create one. Add the daily tasks behind it and check them off to build streaks.", 'Add goal', 'goalDlg');
  const g = goal(), tc = $('#taskCard');
  tc.innerHTML = g ? `<div class="card-head"><h3>${esc(g.title)} tasks</h3><button class="ico del" data-delgoal aria-label="Delete goal">${ico('trash')}</button></div>
    ${g.tasks.map(t => `<div class="task ${t.h.includes(todayK()) ? 'done' : ''}" data-t="${t.id}"><button class="check" data-check aria-label="Check in: ${esc(t.name)}">${ico('check')}</button><span class="tn">${esc(t.name)}</span><button class="streak" data-cal title="Open streak calendar">🔥 ${streakOf(t.h)} ${streakOf(t.h) === 1 ? 'Day' : 'Days'}</button><button class="ico del" data-deltask aria-label="Delete task">${ico('x')}</button></div>`).join('') || '<p class="hint">No tasks in this goal yet. Add the first one below.</p>'}
    <form class="addtask" data-addtask><input class="in" maxlength="60" placeholder="Add a task" aria-label="New task name"><button class="btn sm ghost" aria-label="Add task">${ico('plus')}</button></form>`
    : '<h3>Tasks</h3><p class="hint">Create a goal to start checking in daily.</p>';
  drawChart();
}
function drawChart() {
  const tasks = S.goals.flatMap(g => g.tasks), cv = $('#streakChart'), hint = $('#chartHint');
  if (chart) { chart.destroy(); chart = null; }
  cv.hidden = !tasks.length;
  hint.textContent = !tasks.length ? 'Add tasks to see their active streaks here.' : (!window.Chart ? 'Chart library unavailable offline.' : '');
  if (!tasks.length || !window.Chart) return;
  chart = new Chart(cv, {
    type: 'bar',
    data: { labels: tasks.map(t => t.name.length > 14 ? t.name.slice(0, 13) + '…' : t.name), datasets: [{ label: 'Streak (days)', data: tasks.map(t => streakOf(t.h)), backgroundColor: ctx => { const a = ctx.chart.chartArea; if (!a) return '#f97316'; const g = ctx.chart.ctx.createLinearGradient(0, a.bottom, 0, a.top); g.addColorStop(0, '#f97316'); g.addColorStop(1, '#22c55e'); return g; }, borderRadius: 6, maxBarThickness: 46 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { color: '#8795ab', precision: 0 }, grid: { color: '#1f293d' } }, x: { ticks: { color: '#8795ab' }, grid: { display: false } } } }
  });
}
const toggleDay = (t, k) => { t.h = t.h.includes(k) ? t.h.filter(x => x !== k) : [...t.h, k]; };
$('#goalCards').addEventListener('click', e => { const b = e.target.closest('[data-sel]'); if (b) { selGoal = b.dataset.sel; renderHabits(); } });
$('#taskCard').addEventListener('click', e => {
  const g = goal(); if (!g) return;
  if (e.target.closest('[data-delgoal]')) { S.goals = S.goals.filter(x => x !== g); save(); return renderHabits(); }
  const row = e.target.closest('[data-t]'), t = row && g.tasks.find(x => x.id === row.dataset.t); if (!t) return;
  if (e.target.closest('[data-check]')) {
    const was = t.h.includes(todayK()); toggleDay(t, todayK()); save(); renderHabits();
    if (!was && window.confetti) confetti({ particleCount: 60, spread: 60, origin: { y: .7 }, colors: ['#10b981', '#22c55e', '#f97316'] });
  } else if (e.target.closest('[data-deltask]')) { g.tasks = g.tasks.filter(x => x !== t); save(); renderHabits(); }
  else if (e.target.closest('[data-cal]')) openCal(t);
});
$('#taskCard').addEventListener('submit', e => {
  e.preventDefault(); const i = $('input', e.target), name = i.value.trim(), g = goal(); if (!name || !g) return;
  g.tasks.push({ id: uid(), name, h: [] }); save(); renderHabits();
});
function goalRow() {
  const r = document.createElement('input'); r.className = 'in'; r.maxLength = 60; r.placeholder = 'e.g. Drink 2L water'; r.setAttribute('aria-label', 'Task name');
  $('#gTasks').appendChild(r); return r;
}
$('#addRow').addEventListener('click', () => goalRow().focus());
$('#gTasks').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); goalRow().focus(); } });
$('#goalForm').addEventListener('submit', e => {
  e.preventDefault(); const title = $('#gTitle').value.trim(); if (!title) return;
  const tasks = $$('#gTasks input').map(i => i.value.trim()).filter(Boolean).map(name => ({ id: uid(), name, h: [] }));
  const g = { id: uid(), title, tasks }; S.goals.push(g); selGoal = g.id; save(); $('#goalDlg').close(); toast('Goal saved');
  if (tab !== 'habits') showTab('habits'); else renderHabits();
});

/* ---------- streak calendar modal ---------- */
let cal = null;
function openCal(task) { const n = new Date(); cal = { task, y: n.getFullYear(), m: n.getMonth() }; renderCal(); $('#calDlg').showModal(); }
function renderCal() {
  const { task, y, m } = cal, first = new Date(y, m, 1), total = new Date(y, m + 1, 0).getDate(), tk = todayK(), s = streakOf(task.h);
  $('#calTitle').textContent = `🔥 ${task.name}`;
  $('#calStats').textContent = `${s}-day current streak · ${task.h.length} total check-ins`;
  $('#calMonth').textContent = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  let h = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<span class="wd">${d}</span>`).join('') + '<span class="pad"></span>'.repeat((first.getDay() + 6) % 7);
  for (let d = 1; d <= total; d++) {
    const k = dkey(new Date(y, m, d)), hit = task.h.includes(k);
    h += `<button class="${hit ? 'hit' : ''} ${k === tk ? 'today' : ''}" data-d="${k}" ${k > tk ? 'disabled' : ''} aria-label="${k}${hit ? ', completed' : ''}">${d}<span>${hit ? '🔥' : ''}</span></button>`;
  }
  $('#calGrid').innerHTML = h;
}
$('#calGrid').addEventListener('click', e => { const b = e.target.closest('[data-d]'); if (!b) return; toggleDay(cal.task, b.dataset.d); save(); renderCal(); renderHabits(); });
const monthStep = n => { const d = new Date(cal.y, cal.m + n, 1); cal.y = d.getFullYear(); cal.m = d.getMonth(); renderCal(); };
$('#calPrev').addEventListener('click', () => monthStep(-1));
$('#calNext').addEventListener('click', () => monthStep(1));

/* ---------- life progress ---------- */
function renderLife() {
  const n = new Date(), sd = new Date(n.getFullYear(), n.getMonth(), n.getDate()), ms = new Date(n.getFullYear(), n.getMonth(), 1), me = new Date(n.getFullYear(), n.getMonth() + 1, 1);
  const ys = new Date(n.getFullYear(), 0, 1), ye = new Date(n.getFullYear() + 1, 0, 1);
  const rows = [
    ['Day progress', (n - sd) / 864e5, `${Math.floor((n - sd) / 36e5)}h ${Math.floor((n - sd) % 36e5 / 6e4)}m / 24h`],
    ['Month progress', (n - ms) / (me - ms), `${Math.floor((n - ms) / 864e5)}d / ${Math.round((me - ms) / 864e5)}d`],
    ['Year progress', (n - ys) / (ye - ys), `${Math.floor((n - ys) / 864e5)}d / ${Math.round((ye - ys) / 864e5)}d`]
  ], box = $('#lifeRings');
  if (box.children.length !== rows.length) box.innerHTML = rows.map(() => `<div class="glass rcard"><div class="head"></div><div class="ring"><svg viewBox="0 0 100 100"><circle class="bg" cx="50" cy="50" r="44"/><circle class="fg" cx="50" cy="50" r="44" pathLength="100"/></svg><b></b></div><p class="muted det"></p><div class="track"><i></i></div></div>`).join('');
  rows.forEach(([l, v, d], i) => {
    const c = box.children[i], p = v * 100;
    setT(c.querySelector('.head'), l); setT(c.querySelector('b'), Math.floor(p) + '%'); setT(c.querySelector('.det'), d);
    setRing(c.querySelector('.ring'), p); c.querySelector('.track i').style.width = p + '%';
  });
  const tasks = S.goals.flatMap(g => g.tasks), best = Math.max(0, ...tasks.map(t => streakOf(t.h)));
  $('#quickStats').innerHTML = [['Total goals', S.goals.length], ['Active tasks', tasks.length], ['Completed today', tasks.filter(t => t.h.includes(todayK())).length], ['Best streak', `🔥 ${best}d`]].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
}

/* ---------- date difference ---------- */
function renderDiff() { $('#dA').value = S.diff.a; $('#dB').value = S.diff.b; calcDiff(); }
function calcDiff() {
  const { a, b } = S.diff, out = $('#dOut');
  if (!a || !b) { out.innerHTML = empty('No dates chosen', 'Pick a start and an end date to see the time between them.'); return; }
  let x = day(a), y = day(b); if (x > y) [x, y] = [y, x];
  const d = Math.round((y - x) / 864e5), p = parts(x, y), yr = Math.floor(p.months / 12), mo = p.months % 12;
  const u = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  out.innerHTML = `<div class="dgrid"><div class="glass dcell first"><span>Time difference</span><b>${u(yr, 'Year')}<br>${u(mo, 'Month')}<br>${u(p.days, 'Day')}</b></div>
    <div class="glass dcell"><span>Total days</span><b>${num(d)}</b></div><div class="glass dcell"><span>Total weeks</span><b>${(d / 7).toFixed(1)}</b></div>
    <div class="glass dcell"><span>Total hours</span><b>${num(d * 24)}</b></div><div class="glass dcell"><span>Total minutes</span><b>${num(d * 1440)}</b></div></div>`;
}
['dA', 'dB'].forEach(id => $('#' + id).addEventListener('input', () => { S.diff = { a: $('#dA').value, b: $('#dB').value }; save(); calcDiff(); }));
$('#dCalc').addEventListener('click', () => { S.diff = { a: $('#dA').value, b: $('#dB').value }; save(); calcDiff(); if (!S.diff.a || !S.diff.b) toast('Choose both dates first'); });

/* ---------- dialogs ---------- */
document.addEventListener('click', e => {
  const o = e.target.closest('[data-open]');
  if (o) {
    const d = $('#' + o.dataset.open); d.querySelector('form')?.reset();
    if (d.id === 'goalDlg') { $('#gTasks').innerHTML = ''; goalRow(); }
    d.showModal(); d.querySelector('input')?.focus();
  }
  if (e.target.closest('[data-close]')) e.target.closest('dialog').close();
  if (e.target.tagName === 'DIALOG') e.target.close(); /* click on backdrop */
});

/* ---------- share / screenshot ---------- */
let shot = null;
const summary = () => {
  const ev = activeEvent(), L = ['ChronoPulse 4.0'];
  if (ev) { const left = new Date(ev.at) - Date.now(); L.push(left > 0 ? `${ev.title}: ${num(left / 864e5)} days to go` : `${ev.title}: reached`); }
  S.goals.forEach(g => g.tasks.forEach(t => L.push(`🔥 ${g.title} · ${t.name}: ${streakOf(t.h)}-day streak`)));
  return L.length > 1 ? L.join('\n') : 'ChronoPulse 4.0: tracking time, one day at a time.';
};
const download = () => { if (!shot) return toast('No screenshot available yet'); const a = document.createElement('a'); a.download = 'chronopulse.png'; a.href = shot.toDataURL('image/png'); a.click(); };
async function nativeShare() { /* Web Share API: opens the device share sheet (WhatsApp, Instagram, Facebook...) */
  if (!navigator.share || !shot) return false;
  const blob = await new Promise(r => shot.toBlob(r)), file = new File([blob], 'chronopulse.png', { type: 'image/png' });
  if (!(navigator.canShare && navigator.canShare({ files: [file] }))) return false;
  try { await navigator.share({ files: [file], text: summary(), title: 'ChronoPulse 4.0' }); } catch (err) { /* cancelled by user */ }
  return true;
}
$('#shareBtn').addEventListener('click', async () => {
  shot = null; $('#shotImg').removeAttribute('src'); $('#shotNote').textContent = 'Capturing your current view…'; $('#shareDlg').showModal();
  try {
    if (!window.html2canvas) throw new Error('offline');
    shot = await html2canvas($('#app'), { backgroundColor: '#0a0d14', scale: Math.min(2, window.devicePixelRatio || 1), useCORS: true, onclone: d => d.body.classList.add('shot') });
    $('#shotImg').src = shot.toDataURL('image/png'); $('#shotNote').textContent = '';
  } catch (err) { $('#shotNote').textContent = 'Screenshots need the html2canvas library, which could not load. Check your connection and try again.'; }
});
$('#shDl').addEventListener('click', download);
$('#shWa').addEventListener('click', async () => { if (await nativeShare()) return; window.open('https://wa.me/?text=' + encodeURIComponent(summary()), '_blank', 'noopener'); download(); toast('Image saved. Attach it in WhatsApp.'); });
$('#shFb').addEventListener('click', async () => {
  if (await nativeShare()) return;
  if (/^https?:/.test(location.protocol)) window.open('https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(location.href) + '&quote=' + encodeURIComponent(summary()), '_blank', 'noopener');
  download(); toast('Image saved. Upload it to Facebook.');
});
$('#shIg').addEventListener('click', async () => { if (await nativeShare()) return; download(); toast('Image saved. Upload it in Instagram.'); });

/* ---------- onboarding (first launch only) ---------- */
function renderWho() { const w = $('#who'); w.hidden = !S.profile.name; w.innerHTML = S.profile.name ? 'Hi, <b>' + esc(S.profile.name) + '</b>' : ''; }
const hasProfile = () => !!(S.profile && S.profile.name && S.profile.dob);
function openOnboarding() {
  const d = $('#onbDlg'); d.addEventListener('cancel', e => e.preventDefault()); /* cannot be dismissed with Esc */
  d.addEventListener('click', e => { if (e.target === d) e.stopPropagation(); }, true);
  $('#oDob').max = dkey(new Date()); d.showModal(); $('#oName').focus();
}
$('#onbForm').addEventListener('submit', e => {
  e.preventDefault(); const name = $('#oName').value.trim(), dob = $('#oDob').value, err = $('#oErr');
  if (!name || !dob || day(dob) > new Date()) { err.hidden = false; err.textContent = !name ? 'Please enter a username.' : 'Enter a valid date of birth (not in the future).'; return; }
  S.profile = { name, dob }; save(); $('#onbDlg').close(); renderWho(); toast('Welcome, ' + name + '!'); renderTab();
});

/* ---------- boot ---------- */
if (S.active && !activeEvent()) S.active = null;
renderWho(); renderTab(); audioRender();
if (!hasProfile()) openOnboarding();
