'use strict';
/* ChronoPulse 4.1/4.2 — pure logic (no DOM): focus-timer engine, tasks, aggregates, migration, backup/restore, CSV.
   Builds on lib.js (CP). Loaded as a classic script (window.CP41) and via require() in Node tests.
   Time policy: every instant is an epoch-millisecond timestamp; every "day" is the LOCAL calendar date (YYYY-MM-DD)
   of that instant, computed once when a record is created (session day = local day the session STARTED). */
(function (root) {
  const C = typeof module !== 'undefined' && module.exports ? require('./lib.js') : root.CP;
  const { dkey, isKey, dayNum, keyFromNum } = C;
  const APP_VERSION = '4.2.5', SCHEMA = 7; /* schema stays 7: Phases 2 and 3 only ADD fields with safe defaults (reminders, cfg.fx*), and 4.2 has not shipped yet */
  const KEY = 'chronopulse:v4.1', KEY_V3 = 'chronopulse:v3', PRE41 = 'chronopulse:v4.1:preupgrade', PRE42 = 'chronopulse:v4.1:pre42', SNAP = 'chronopulse:v4.1:prerestore', CORRUPT = 'chronopulse:v4.1:corrupt';
  const str = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';
  const clone = o => JSON.parse(JSON.stringify(o));
  const rid = p => p + Math.random().toString(36).slice(2, 10);
  const okLocal = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s) && C.okAt(s);

  /* ---------- timer settings ---------- */
  const CFG_DEFAULT = { focusMin: 25, shortMin: 5, longMin: 15, longEvery: 4, auto: false, chime: true, notify: false, breakRemind: true, hideTitles: false,
    fxVolume: 100, fxSound: 'impact', fxTen: 'beep', fxWarn: true, fxVibrate: false, fxReduced: false, streakGoal: 1, notifSound: 'system', notifSoundName: '', theme: 'dark', freezesPerMonth: 3, focusTargetMin: 120 }; /* Phase 3: sound & cinematic effects (master on/off stays S.sound) */
  const LIM = { focusMin: [1, 180], shortMin: [1, 60], longMin: [1, 120], longEvery: [2, 12] };
  function cfgOf(raw) {
    const r = raw && typeof raw === 'object' ? raw : {}, o = { ...CFG_DEFAULT };
    for (const k in LIM) { const n = Math.round(Number(r[k])); if (r[k] !== '' && r[k] !== null && Number.isFinite(n) && n >= LIM[k][0] && n <= LIM[k][1]) o[k] = n; }
    for (const k of ['auto', 'chime', 'notify', 'breakRemind', 'hideTitles', 'fxWarn', 'fxVibrate', 'fxReduced']) if (typeof r[k] === 'boolean') o[k] = r[k];
    if (typeof r.fxVolume === 'number' && Number.isFinite(r.fxVolume)) o.fxVolume = Math.min(100, Math.max(0, Math.round(r.fxVolume)));
    if (typeof r.streakGoal === 'number' && Number.isFinite(r.streakGoal)) o.streakGoal = Math.min(C.STREAK_GOAL_LIM[1], Math.max(C.STREAK_GOAL_LIM[0], Math.round(r.streakGoal)));
    if (C.THEMES.includes(r.theme)) o.theme = r.theme;
    const lim = (v, [lo, hi]) => Math.min(hi, Math.max(lo, Math.round(v)));
    if (typeof r.freezesPerMonth === 'number' && Number.isFinite(r.freezesPerMonth)) o.freezesPerMonth = lim(r.freezesPerMonth, C.FREEZES_LIM);
    if (typeof r.focusTargetMin === 'number' && Number.isFinite(r.focusTargetMin)) o.focusTargetMin = lim(r.focusTargetMin, C.FOCUS_TARGET_LIM);
    if (C.NOTIF_SOUNDS.includes(r.notifSound)) o.notifSound = r.notifSound === 'tick' ? 'chime' : r.notifSound; /* the tick is reserved for the countdown: older choices become the chime */
    if (typeof r.notifSoundName === 'string') o.notifSoundName = r.notifSoundName.replace(/[\u0000-\u001f\u007f<>"\\/]/g, '').trim().slice(0, 80); /* display name only; the audio itself is never in the saved data or backups */
    if (C.FX_SOUNDS.includes(r.fxSound)) o.fxSound = r.fxSound;
    if (C.FX_TEN.includes(r.fxTen)) o.fxTen = r.fxTen;
    return o;
  }

  /* ---------- focus timer engine: deadline-based, pure reducers ----------
     A running timer stores an absolute `deadline` (epoch ms). Remaining time is always derived from the clock, so throttled
     intervals, tab suspension and page reloads cannot cause drift. Remaining is clamped to [0, plannedMs], which also
     neutralises a device clock that was moved backwards.
     Session recording policy:
       completed   — the deadline was reached (also when it passed while the app was suspended/closed, up to STALE_MS late).
       interrupted — the user pressed Skip on a running/paused session, or the deadline was missed by more than STALE_MS
                     (abandoned; actual time is unknown so actualSec = 0).
       cancelled   — the user pressed Reset on a running/paused session.
     Interrupted/cancelled sessions shorter than MIN_REC_MS are not recorded (accidental starts). Only completed focus sessions
     count as focus time. */
  const PHASES = ['focus', 'short', 'long'], STATUSES = ['completed', 'interrupted', 'cancelled'];
  const STALE_MS = 6 * 3600e3, MIN_REC_MS = 30e3, MAX_PLANNED = 180 * 60e3, MAX_SESSIONS = 5000;
  const phaseMs = (cfg, p) => (p === 'focus' ? cfg.focusMin : p === 'short' ? cfg.shortMin : cfg.longMin) * 60e3;
  const idle = (cfg, phase = 'focus', cycle = 0, link = {}) => ({ phase, status: 'idle', plannedMs: phaseMs(cfg, phase), remainingMs: phaseMs(cfg, phase), deadline: null, startedAt: null, sessionId: '', cycle, todoId: link.todoId || '', habitId: link.habitId || '', label: link.label || '' });
  function normTimer(raw, cfg, now) {
    const d = idle(cfg);
    if (!raw || typeof raw !== 'object' || !PHASES.includes(raw.phase) || !['idle', 'running', 'paused'].includes(raw.status)) return d;
    const cycle = Number.isInteger(raw.cycle) && raw.cycle >= 0 && raw.cycle < 1000 ? raw.cycle : 0;
    const link = { todoId: str(raw.todoId, 40), habitId: str(raw.habitId, 40), label: str(raw.label, 80) };
    if (raw.status === 'idle') return idle(cfg, raw.phase, cycle, link);
    const planned = Number(raw.plannedMs), sid = str(raw.sessionId, 40);
    if (!(planned >= 1000 && planned <= MAX_PLANNED) || !sid || !Number.isFinite(raw.startedAt) || raw.startedAt <= 0 || raw.startedAt > now + 864e5) return d;
    const t = { ...idle(cfg, raw.phase, cycle, link), plannedMs: planned, remainingMs: planned, startedAt: raw.startedAt, sessionId: sid, status: raw.status };
    if (raw.status === 'running') { if (!Number.isFinite(raw.deadline)) return d; t.deadline = raw.deadline; }
    else { if (!(raw.remainingMs > 0 && raw.remainingMs <= planned)) return d; t.remainingMs = raw.remainingMs; }
    return t;
  }
  const remaining = (t, now) => t.status === 'running' ? Math.max(0, Math.min(t.plannedMs, t.deadline - now)) : t.remainingMs;
  const tStart = (t, now, id) => t.status === 'idle' ? { ...t, status: 'running', deadline: now + t.remainingMs, startedAt: now, sessionId: id } : t;
  const tPause = (t, now) => t.status === 'running' ? { ...t, status: 'paused', remainingMs: Math.max(1, remaining(t, now)), deadline: null } : t;
  const tResume = (t, now) => t.status === 'paused' ? { ...t, status: 'running', deadline: now + t.remainingMs } : t;
  const setLink = (t, link) => t.status === 'idle' ? { ...t, todoId: link.todoId || '', habitId: link.habitId || '', label: link.label || '' } : t;
  const applyCfg = (t, cfg) => t.status === 'idle' ? idle(cfg, t.phase, t.cycle, t) : t; /* running/paused sessions keep their planned length */
  function record(t, status, endedAt, actualMs) {
    const f = t.phase === 'focus';
    return { id: t.sessionId, type: t.phase, status, startedAt: t.startedAt, endedAt, plannedSec: Math.round(t.plannedMs / 1000), actualSec: Math.max(0, Math.round(actualMs / 1000)), day: dkey(new Date(t.startedAt)), todoId: f ? t.todoId : '', habitId: f ? t.habitId : '', label: f ? t.label : '' };
  }
  function nextOf(t, cfg, completed) {
    if (t.phase !== 'focus') return idle(cfg, 'focus', t.cycle, t);
    if (!completed) return idle(cfg, 'short', t.cycle, t); /* skipping a focus session does not advance the long-break cycle */
    const c = t.cycle + 1; return idle(cfg, c % cfg.longEvery === 0 ? 'long' : 'short', c, t);
  }
  /* tick: call as often as convenient; completes at most once because the returned timer no longer carries the old sessionId */
  function tick(t, cfg, now, mkId) {
    if (t.status !== 'running' || remaining(t, now) > 0) return { timer: t };
    const stale = now - t.deadline > STALE_MS;
    const session = stale ? record(t, 'interrupted', t.deadline, 0) : record(t, 'completed', t.deadline, t.plannedMs);
    let next = nextOf(t, cfg, !stale), auto = false;
    if (cfg.auto && !stale) { next = tStart(next, now, mkId()); auto = true; }
    return { timer: next, session, stale, auto, finished: t.phase };
  }
  function stop(t, cfg, now, kind) { /* kind: 'reset' | 'skip' */
    if (t.status === 'idle') return { timer: kind === 'skip' && t.phase !== 'focus' ? nextOf(t, cfg, false) : t };
    const elapsed = t.plannedMs - remaining(t, now), status = kind === 'reset' ? 'cancelled' : 'interrupted';
    return { timer: kind === 'skip' ? nextOf(t, cfg, false) : idle(cfg, t.phase, t.cycle, t), session: elapsed >= MIN_REC_MS ? record(t, status, now, elapsed) : null };
  }
  const hasSession = (S, id) => S.sessions.some(s => s.id === id);
  function addSession(S, s) { if (!s || hasSession(S, s.id)) return false; S.sessions.push(s); S.sessions.sort((a, b) => a.startedAt - b.startedAt); if (S.sessions.length > MAX_SESSIONS) S.sessions.splice(0, S.sessions.length - MAX_SESSIONS); return true; }

  /* ---------- tasks (one-time, dated) vs habits (daily check-ins) ---------- */
  const habits = S => S.goals.flatMap(g => g.tasks.map(t => ({ ...t, goalId: g.id, goalTitle: g.title })));
  const findHabit = (S, id) => { for (const g of S.goals) { const t = g.tasks.find(x => x.id === id); if (t) return t; } return null; };
  /* Completing a task linked to a habit also checks the habit in for that day (a date can only be stored once). The task remembers
     whether IT created that check-in (`via`), so undoing the task never removes a check-in the user made themselves. */
  function setTodoDone(S, id, done, today, now) {
    const t = S.todos.find(x => x.id === id); if (!t) return false;
    if (done) {
      if (t.doneOn) return false; /* no duplicate completion */
      t.doneOn = today; t.doneAt = now; t.via = false;
      const h = t.habit && findHabit(S, t.habit);
      if (h && !h.h.includes(today)) { h.h = [...h.h, today].sort(); t.via = true; }
    } else {
      if (!t.doneOn) return false;
      const h = t.habit && findHabit(S, t.habit);
      if (h && t.via) h.h = h.h.filter(k => k !== t.doneOn);
      t.doneOn = ''; t.doneAt = 0; t.via = false;
    }
    return true;
  }
  const dueReminders = (S, now) => S.todos.filter(t => !t.doneOn && !t.reminded && t.remind && new Date(t.remind).getTime() <= now);

  /* ---------- aggregates (derived from saved records; records stay authoritative) ---------- */
  const countedFocus = s => s.type === 'focus' && s.status === 'completed';
  function buildIndex(S) {
    const ix = { focusSec: {}, sessions: {}, partial: {}, todos: {}, checkins: {}, byTodo: {}, byHabit: {} }, add = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
    for (const s of S.sessions) {
      if (countedFocus(s)) { add(ix.focusSec, s.day, s.actualSec); add(ix.sessions, s.day); if (s.todoId) add(ix.byTodo, s.todoId, s.actualSec); if (s.habitId) add(ix.byHabit, s.habitId, s.actualSec); }
      else if (s.type === 'focus') add(ix.partial, s.day);
    }
    for (const t of S.todos) if (t.doneOn) add(ix.todos, t.doneOn);
    for (const g of S.goals) for (const t of g.tasks) for (const k of t.h) add(ix.checkins, k);
    return ix;
  }
  const windowKeys = (today, n = 7, offset = 0) => Array.from({ length: n }, (_, i) => keyFromNum(dayNum(today) - offset - (n - 1 - i)));
  /* Reporting window: the last 7 local calendar days INCLUDING today (rolling, not Monday-based); the previous week is the 7 days before that. */
  function weekReport(S, today, ix = buildIndex(S)) {
    const sum = keys => ({ focusSec: keys.reduce((n, k) => n + (ix.focusSec[k] || 0), 0), sessions: keys.reduce((n, k) => n + (ix.sessions[k] || 0), 0), tasks: keys.reduce((n, k) => n + (ix.todos[k] || 0), 0), checkins: keys.reduce((n, k) => n + (ix.checkins[k] || 0), 0) });
    const cur = windowKeys(today, 7, 0), prv = windowKeys(today, 7, 7), tot = sum(cur), ptot = sum(prv);
    const days = cur.map(k => ({ key: k, focusMin: Math.round((ix.focusSec[k] || 0) / 60), sessions: ix.sessions[k] || 0, tasks: ix.todos[k] || 0, checkins: ix.checkins[k] || 0 }));
    const hasPrev = Object.values(ptot).some(v => v > 0);
    const rate = (h) => {
      const set = new Set(h.h), start = h.created || (h.h.length ? [...h.h].sort()[0] : ''); let possible = 0, done = 0;
      for (const k of cur) { const hit = set.has(k); if (hit || (start && k >= start)) { possible++; if (hit) done++; } }
      return { done, possible };
    };
    const hb = habits(S).map(h => ({ id: h.id, name: h.name, goalId: h.goalId, goalTitle: h.goalTitle, ...rate(h), current: C.currentStreak(h.h, today), longest: C.longestStreak(h.h) }));
    const goals = S.goals.map(g => { const r = hb.filter(h => h.goalId === g.id); return { id: g.id, title: g.title, done: r.reduce((n, h) => n + h.done, 0), possible: r.reduce((n, h) => n + h.possible, 0) }; });
    const pd = hb.reduce((n, h) => n + h.done, 0), pp = hb.reduce((n, h) => n + h.possible, 0);
    return { keys: cur, days, totals: tot, prev: ptot, hasPrev, delta: hasPrev ? { focusSec: tot.focusSec - ptot.focusSec, sessions: tot.sessions - ptot.sessions, tasks: tot.tasks - ptot.tasks, checkins: tot.checkins - ptot.checkins } : null, habits: hb, goals, consistency: pp ? pd / pp : null };
  }
  /* Daily goal units: every habit counts once; a one-time task counts once UNLESS it is linked to a habit (then the habit's check-in
     is the single unit, so a linked task can never be counted twice). Tasks in play today = open tasks with no due date or due <= today,
     plus tasks completed today. */
  function dailySummary(S, today, ix = buildIndex(S)) {
    const doneToday = S.todos.filter(t => t.doneOn === today), open = S.todos.filter(t => !t.doneOn && (!t.due || t.due <= today)), hs = habits(S);
    const checked = hs.filter(h => h.h.includes(today)), plain = [...doneToday, ...open].filter(t => !t.habit);
    const total = hs.length + plain.length, done = checked.length + doneToday.filter(t => !t.habit).length;
    return { tasksDone: doneToday.length, tasksRemaining: open.length, overdue: open.filter(t => t.due && t.due < today).length, focusSec: ix.focusSec[today] || 0, sessions: ix.sessions[today] || 0, checkins: checked.length, habitsTotal: hs.length, unitsDone: done, unitsTotal: total, pct: total ? done / total * 100 : null,
      streaks: hs.map(h => ({ id: h.id, name: h.name, current: C.currentStreak(h.h, today), longest: C.longestStreak(h.h) })).filter(s => s.current > 0 || s.longest > 0).sort((a, b) => b.current - a.current) };
  }

  /* ---------- state: sanitize (4.0 fields via CP.sanitize + 4.1 fields) ---------- */
  function sanitize41(raw, opts = {}) {
    const now = opts.now ?? Date.now(), S = C.sanitize(raw), r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    S.v = SCHEMA; S.cfg = cfgOf(r.cfg);
    const hIds = new Set(S.goals.flatMap(g => g.tasks.map(t => t.id))), seen = new Set();
    S.todos = (Array.isArray(r.todos) ? r.todos : []).filter(t => t && typeof t === 'object' && str(t.title, 80)).map(t => {
      let id = str(String(t.id ?? ''), 40); if (!id || seen.has(id)) id = rid('t'); seen.add(id);
      const habit = hIds.has(t.habit) ? t.habit : '', doneOn = isKey(t.doneOn) ? t.doneOn : '';
      return { id, title: str(t.title, 80), desc: str(t.desc, 240), due: isKey(t.due) ? t.due : '', created: isKey(t.created) ? t.created : '', doneOn, doneAt: doneOn && Number.isFinite(t.doneAt) ? t.doneAt : 0, habit, via: !!(t.via && habit && doneOn), remind: okLocal(t.remind) ? t.remind : '', reminded: !!t.reminded };
    });
    const sid = new Set(), list = [];
    for (const s of Array.isArray(r.sessions) ? r.sessions : []) {
      if (!s || typeof s !== 'object') continue;
      const id = str(String(s.id ?? ''), 40); if (!id || sid.has(id)) continue; /* duplicates: first wins, never re-keyed, so re-importing cannot multiply history */
      const a = Number(s.startedAt), b = Number(s.endedAt), lim = x => Math.min(86400, Math.max(0, Math.round(Number(x))));
      if (!PHASES.includes(s.type) || !STATUSES.includes(s.status) || !(a > 0 && a < 8.64e15) || !(b >= a && b < 8.64e15) || !Number.isFinite(Number(s.plannedSec)) || !Number.isFinite(Number(s.actualSec))) continue;
      sid.add(id); const f = s.type === 'focus';
      list.push({ id, type: s.type, status: s.status, startedAt: a, endedAt: b, plannedSec: lim(s.plannedSec), actualSec: lim(s.actualSec), day: isKey(s.day) ? s.day : dkey(new Date(a)), todoId: f ? str(s.todoId, 40) : '', habitId: f ? str(s.habitId, 40) : '', label: f ? str(s.label, 80) : '' });
    }
    S.sessions = list.sort((x, y) => x.startedAt - y.startedAt).slice(-MAX_SESSIONS);
    S.timer = normTimer(r.timer, S.cfg, now);
    const m = r.meta && typeof r.meta === 'object' ? r.meta : {};
    S.meta = { schema: SCHEMA, appVersion: APP_VERSION, migratedFrom: Number.isInteger(m.migratedFrom) || m.migratedFrom === 'v3' ? m.migratedFrom : null, migratedAt: str(m.migratedAt, 40) };
    return S;
  }

  /* ---------- storage: load / migrate / save (works with any Storage-like object) ---------- */
  function loadState(st, now = Date.now()) {
    let text = null, src = null;
    try { text = st.getItem(KEY); src = 'v4.1'; }
    catch (e) { return { state: sanitize41(null, { now }), status: 'unavailable', notes: ['Browser storage is unavailable, so changes cannot be saved. Use Backup & Export to keep your data.'] }; }
    if (text == null) return { state: sanitize41(null, { now }), status: 'fresh', notes: [] };
    let parsed; try { parsed = JSON.parse(text); } catch (e) { parsed = undefined; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { /* corrupt: keep the raw text under a recovery key, never silently erase it */
      let saved = null; try { saved = CORRUPT + ':' + now; st.setItem(saved, text); } catch (e) { saved = null; }
      return { state: sanitize41(null, { now }), status: 'recovered', recoveryKey: saved, notes: [saved ? 'Saved data could not be read. A copy was kept for recovery and the app started empty.' : 'Saved data could not be read and no recovery copy could be kept. The app started empty.'] };
    }
    const state = sanitize41(parsed, { now });
    if (src === 'v4.1' && parsed.meta && parsed.meta.schema >= SCHEMA) return { state, status: 'ok', notes: [] };
    const notes = []; let safe = true;
    /* 4.2: data saved by 4.1 (schema 6) gets its own safety copy. The older PRE41 key may already hold a copy from an earlier upgrade and is never overwritten. */
    const preKey = parsed.meta && parsed.meta.schema === 6 ? PRE42 : PRE41;
    if (src === 'v4.1') { try { if (st.getItem(preKey) == null) st.setItem(preKey, text); } catch (e) { safe = false; notes.push('Could not create the pre-upgrade safety copy (storage full?). Your data was not rewritten; export a backup soon.'); } }
    state.meta = { schema: SCHEMA, appVersion: APP_VERSION, migratedFrom: Number.isInteger(parsed.v) ? parsed.v : null, migratedAt: new Date(now).toISOString() };
    if (safe) { try { st.setItem(KEY, JSON.stringify(state)); } catch (e) { notes.push('Upgraded data could not be written (storage full?). It is loaded in memory only.'); } }
    return { state, status: 'migrated', notes };
  }
  function saveState(st, S) {
    try { st.setItem(KEY, JSON.stringify(S)); return { ok: true }; }
    catch (e) { return { ok: false, reason: e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014) ? 'quota' : 'unavailable' }; }
  }

  /* ---------- backup / restore ---------- */
  const exportData = S => { const o = clone(S); delete o.timer; return o; }; /* a running timer is device-specific; it is never exported */
  const makeBackup = (S, now = new Date()) => ({ format: 'chronopulse-backup', app: 'ChronoPulse', appVersion: APP_VERSION, schemaVersion: SCHEMA, exportedAt: now.toISOString(), data: exportData(S) });
  const countOf = S => ({ events: S.events.length, goals: S.goals.length, habits: S.goals.reduce((n, g) => n + g.tasks.length, 0), checkins: S.goals.reduce((n, g) => n + g.tasks.reduce((m, t) => m + t.h.length, 0), 0), todos: S.todos.length, sessions: S.sessions.length });
  function validateBackup(input, now = Date.now()) {
    const fail = error => ({ ok: false, error });
    if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('This file is not a ChronoPulse backup.');
    let data, legacy = false;
    if (input.format === 'chronopulse-backup') {
      if (!Number.isInteger(input.schemaVersion) || input.schemaVersion < 1) return fail('The backup has no valid version number.');
      if (input.schemaVersion > SCHEMA) return fail('This backup was made by a newer ChronoPulse (schema ' + input.schemaVersion + '). Update the app and try again.');
      data = input.data;
    } else if (typeof input.app === 'string' && /^ChronoPulse/.test(input.app) && input.data) { legacy = true; data = input.data; } /* 4.0 export format */
    else return fail('This file is not a ChronoPulse backup.');
    if (!data || typeof data !== 'object' || Array.isArray(data)) return fail('The backup contains no readable data.');
    const S = sanitize41(data, { now }); S.timer = idle(S.cfg);
    const rawN = k => Array.isArray(data[k]) ? data[k].length : 0, rawHabits = Array.isArray(data.goals) ? data.goals.reduce((n, g) => n + (g && Array.isArray(g.tasks) ? g.tasks.length : 0), 0) : 0;
    const c = countOf(S), dropped = Math.max(0, rawN('events') - c.events) + Math.max(0, rawN('goals') - c.goals) + Math.max(0, rawHabits - c.habits) + Math.max(0, rawN('todos') - c.todos) + Math.max(0, rawN('sessions') - c.sessions);
    return { ok: true, state: S, legacy, exportedAt: str(input.exportedAt, 40), summary: { ...c, profile: !!S.profile.name, dropped } };
  }
  function mergeStates(L, I, now = Date.now()) {
    const S = clone(L);
    if (!S.profile.name && I.profile.name) S.profile.name = I.profile.name; if (!S.profile.dob && I.profile.dob) S.profile.dob = I.profile.dob;
    const eIds = new Set(S.events.map(e => e.id)); for (const e of I.events) if (!eIds.has(e.id)) S.events.push(clone(e));
    if (!S.active && I.active && S.events.some(e => e.id === I.active)) S.active = I.active;
    for (const g of I.goals) {
      const lg = S.goals.find(x => x.id === g.id);
      if (!lg) { S.goals.push(clone(g)); continue; }
      for (const t of g.tasks) { const lt = lg.tasks.find(x => x.id === t.id); if (lt) lt.h = [...new Set([...lt.h, ...t.h])].sort(); else lg.tasks.push(clone(t)); }
    }
    const tIds = new Set(S.todos.map(t => t.id)); for (const t of I.todos) if (!tIds.has(t.id)) S.todos.push(clone(t));
    for (const s of I.sessions) addSession(S, clone(s));
    if (!S.diff.a && !S.diff.b) S.diff = clone(I.diff);
    return sanitize41(S, { now });
  }

  /* ---------- CSV (RFC 4180, CRLF, UTF-8 with BOM for Excel, formula-injection safe) ---------- */
  const FORMULA = /^[=+\-@\t\r]/;
  function csvCell(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
    let s = String(v); if (FORMULA.test(s)) s = "'" + s; /* neutralise =, +, -, @ so spreadsheets treat it as text */
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  const toCsv = (head, rows) => '\ufeff' + [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  const pad2 = n => String(n).padStart(2, '0');
  const local = ms => { const d = new Date(ms); return `${dkey(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; };
  const min2 = sec => Number((sec / 60).toFixed(2));
  const csvSessions = S => ({ count: S.sessions.length, csv: toCsv(['session_id', 'type', 'status', 'day_local', 'start_local', 'end_local', 'start_utc', 'end_utc', 'planned_minutes', 'actual_minutes', 'label', 'task_id', 'habit_id'],
    S.sessions.map(s => [s.id, s.type, s.status, s.day, local(s.startedAt), local(s.endedAt), new Date(s.startedAt).toISOString(), new Date(s.endedAt).toISOString(), min2(s.plannedSec), min2(s.actualSec), s.label, s.todoId, s.habitId])) });
  const csvTasks = S => ({ count: S.todos.length, csv: toCsv(['task_id', 'title', 'description', 'status', 'created', 'due', 'completed_on', 'completed_at_local', 'linked_habit_id', 'linked_habit', 'reminder_local'],
    S.todos.map(t => { const h = t.habit && findHabit(S, t.habit); return [t.id, t.title, t.desc, t.doneOn ? 'done' : 'open', t.created, t.due, t.doneOn, t.doneAt ? local(t.doneAt) : '', t.habit, h ? h.name : '', t.remind.replace('T', ' ')]; })) });
  function csvCheckins(S) {
    const rows = []; for (const g of S.goals) for (const t of g.tasks) for (const k of t.h) rows.push([k, g.title, g.category, t.name, t.id]);
    rows.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]) || a[3].localeCompare(b[3]));
    return { count: rows.length, csv: toCsv(['date', 'goal', 'category', 'habit', 'habit_id'], rows) };
  }
  function csvDaily(S, today) {
    const ix = buildIndex(S), keys = [...Object.keys(ix.focusSec), ...Object.keys(ix.sessions), ...Object.keys(ix.partial), ...Object.keys(ix.todos), ...Object.keys(ix.checkins)].filter(isKey).sort();
    const rows = []; if (keys.length) for (let n = dayNum(keys[0]); n <= dayNum(today) && rows.length < 3660; n++) { const k = keyFromNum(n); rows.push([k, min2(ix.focusSec[k] || 0), ix.sessions[k] || 0, ix.partial[k] || 0, ix.todos[k] || 0, ix.checkins[k] || 0]); }
    return { count: rows.length, csv: toCsv(['date', 'focus_minutes', 'focus_sessions_completed', 'focus_sessions_not_completed', 'tasks_completed', 'habit_checkins'], rows) };
  }

  const api = { APP_VERSION, SCHEMA, KEY, KEY_V3, PRE41, PRE42, SNAP, CORRUPT, STALE_MS, MIN_REC_MS, MAX_SESSIONS, CFG_DEFAULT, LIM, cfgOf, idle, normTimer, phaseMs, remaining, tStart, tPause, tResume, setLink, applyCfg, tick, stop, nextOf, hasSession, addSession,
    habits, findHabit, setTodoDone, dueReminders, buildIndex, windowKeys, weekReport, dailySummary, sanitize41, loadState, saveState, exportData, makeBackup, validateBackup, mergeStates, countOf, csvCell, toCsv, csvSessions, csvTasks, csvCheckins, csvDaily };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CP41 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
