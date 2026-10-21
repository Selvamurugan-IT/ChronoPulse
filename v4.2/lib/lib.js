'use strict';
/* ChronoPulse 4.0 — pure calculation + validation logic (no DOM access).
   Loaded as a classic script in the browser (window.CP) and via require() in Node tests.
   Date policy: calendar dates are LOCAL "YYYY-MM-DD" keys; day arithmetic uses UTC day numbers so DST never shifts a day.
   Birthday/month-end policy: adding months clamps to the last day of the month (Jan 31 + 1 month = Feb 28/29).
   Feb 29 birthdays are observed on Feb 28 in non-leap years. */
(function (root) {
  const pad = (n, l = 2) => String(n).padStart(l, '0');
  const dkey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const KEYRE = /^\d{4}-\d{2}-\d{2}$/;
  const isKey = s => {
    if (typeof s !== 'string' || !KEYRE.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number), t = new Date(y, m - 1, d);
    return y >= 1900 && t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d;
  };
  const day = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const isLeap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const dim = (y, m0) => new Date(y, m0 + 1, 0).getDate();
  const dayNum = s => { const [y, m, d] = s.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
  const keyFromNum = n => { const d = new Date(n * 864e5); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
  const addMonthsKey = (k, n) => {
    const [y, m, d] = k.split('-').map(Number), t = y * 12 + (m - 1) + n, ny = Math.floor(t / 12), nm = t % 12;
    return `${pad(ny, 4)}-${pad(nm + 1)}-${pad(Math.min(d, dim(ny, nm)))}`;
  };
  /* calendar difference between two keys, a <= b */
  function ymd(a, b) {
    const [ay, am] = a.split('-').map(Number), [by, bm] = b.split('-').map(Number);
    let months = (by - ay) * 12 + (bm - am);
    if (addMonthsKey(a, months) > b) months--;
    return { years: Math.floor(months / 12), months: months % 12, days: dayNum(b) - dayNum(addMonthsKey(a, months)), totalMonths: months };
  }
  /* Date-only inputs are counted from midnight to midnight; hours/minutes = calendar days x 24 / 1440 (DST ignored on purpose). */
  function dateDiff(a, b) {
    if (!isKey(a) || !isKey(b)) return null;
    const swapped = a > b, s = swapped ? b : a, e = swapped ? a : b, p = ymd(s, e), days = dayNum(e) - dayNum(s);
    return { swapped, years: p.years, months: p.months, days: p.days, totalDays: days, totalWeeks: days / 7, totalHours: days * 24, totalMinutes: days * 1440 };
  }
  function age(dob, today) {
    const p = ymd(dob, today);
    return { years: p.years, months: p.months, days: p.days, totalDays: dayNum(today) - dayNum(dob) };
  }
  function birthdayIn(dob, y) {
    const [, m, d] = dob.split('-').map(Number);
    return `${pad(y, 4)}-${pad(m)}-${pad(m === 2 && d === 29 && !isLeap(y) ? 28 : d)}`;
  }
  function nextBirthday(dob, today) {
    const y = +today.slice(0, 4); let c = birthdayIn(dob, y);
    if (c < today) c = birthdayIn(dob, y + 1);
    return { key: c, inDays: dayNum(c) - dayNum(today), today: c === today };
  }
  /* countdown parts between two Date objects (calendar months via clamped month arithmetic) */
  const addMonths = (d, n) => { const r = new Date(d), dd = r.getDate(); r.setDate(1); r.setMonth(r.getMonth() + n); r.setDate(Math.min(dd, dim(r.getFullYear(), r.getMonth()))); return r; };
  function countdownParts(a, b) {
    if (b <= a) return { months: 0, days: 0, h: 0, mi: 0, s: 0, ms: 0 };
    let m = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();
    if (addMonths(a, m) > b) m--;
    const ms = b - addMonths(a, m);
    return { months: m, days: Math.floor(ms / 864e5), h: Math.floor(ms % 864e5 / 36e5), mi: Math.floor(ms % 36e5 / 6e4), s: Math.floor(ms % 6e4 / 1e3), ms: Math.floor(ms % 1e3) };
  }
  /* streaks: a task not yet checked today does NOT break the streak until today is over */
  function currentStreak(h, today) {
    const s = new Set(h); let n = dayNum(today); if (!s.has(keyFromNum(n))) n--;
    let c = 0; while (s.has(keyFromNum(n))) { c++; n--; } return c;
  }
  function longestStreak(h) {
    const nums = [...new Set(h)].map(dayNum).sort((x, y) => x - y); let best = 0, run = 0, prev = null;
    for (const n of nums) { run = prev !== null && n === prev + 1 ? run + 1 : 1; if (run > best) best = run; prev = n; }
    return best;
  }
  /* 'done' | 'today' | 'missed' | 'none' | 'future' */
  function dayStatus(task, k, today) {
    if (k > today) return 'future';
    if (task.h.includes(k)) return 'done';
    if (k === today) return 'today';
    const start = task.created || (task.h.length ? [...task.h].sort()[0] : null);
    return start && k >= start ? 'missed' : 'none';
  }
  function lifeProgress(n) {
    const sd = new Date(n.getFullYear(), n.getMonth(), n.getDate()), ms = new Date(n.getFullYear(), n.getMonth(), 1), me = new Date(n.getFullYear(), n.getMonth() + 1, 1),
      ys = new Date(n.getFullYear(), 0, 1), ye = new Date(n.getFullYear() + 1, 0, 1), nd = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1);
    return {
      day: { pct: (n - sd) / (nd - sd) * 100, label: `${Math.floor((n - sd) / 36e5)}h ${Math.floor((n - sd) % 36e5 / 6e4)}m / ${Math.round((nd - sd) / 36e5)}h` },
      month: { pct: (n - ms) / (me - ms) * 100, label: `${Math.floor((n - ms) / 864e5)}d / ${dim(n.getFullYear(), n.getMonth())}d` },
      year: { pct: (n - ys) / (ye - ys) * 100, label: `${Math.floor((n - ys) / 864e5)}d / ${isLeap(n.getFullYear()) ? 366 : 365}d` }
    };
  }

  /* ---------- state validation (never throws; drops anything malformed) ---------- */
  const str = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';
  const okAt = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(s) && !isNaN(new Date(s.length === 10 ? s + 'T00:00' : s));
  const blank = () => ({ v: 5, profile: { name: '', dob: '' }, events: [], active: null, goals: [], diff: { a: '', b: '' }, sound: true });
  /* 4.2 reminders. Single source of truth for the reminder keys (lib42.js re-exports them).
     reminders = which of the five reminders are on. fired = which already ran, each tied to the exact `at` string (like `completed`), so editing the
     target re-arms them and a refresh can never repeat them. armed = the one-time "skip reminders whose time was already past" step has run. */
  const RKEYS = ['d1', 'h1', 'm10', 'm1', 'end'], RDEF = { d1: false, h1: true, m10: false, m1: false, end: true };
  /* Phase 3 sound settings: allowed values live here (single source of truth, like RKEYS) so lib41.js can validate them and lib43.js can map them to sounds */
  const FX_SOUNDS = ['impact', 'fanfare', 'pulse'], FX_TEN = ['off', 'tick', 'beep', 'synth'];
  const NOTIF_SOUNDS = ['system', 'tick', 'chime', 'custom']; /* reminder sound choices (cfg.notifSound) */
  const THEMES = ['dark', 'oled', 'neon', 'pastel']; /* cfg.theme: Dark (default), OLED True Black, Cyberpunk Neon, Soft Pastel */
  const FREEZES_LIM = [0, 3], FOCUS_TARGET_LIM = [0, 720]; /* cfg.freezesPerMonth, cfg.focusTargetMin (minutes per day, 0 = no goal line) */
  const STREAK_GOAL_LIM = [1, 10]; /* Phase 5: activities needed for a day to count towards the streak (cfg.streakGoal) */
  const normReminders = r => { const s = r && typeof r === 'object' ? r : {}, o = {}; for (const k of RKEYS) o[k] = typeof s[k] === 'boolean' ? s[k] : RDEF[k]; return o; };
  const normFired = (f, at) => { const o = {}; if (f && typeof f === 'object') for (const k of RKEYS) if (f[k] === at) o[k] = at; return o; };
  function sanitize(raw) {
    const S = blank(); if (!raw || typeof raw !== 'object') return S;
    const p = raw.profile || {}; S.profile.name = str(p.name, 40); S.profile.dob = isKey(p.dob) ? p.dob : '';
    const ids = new Set(), uniq = id => { id = str(String(id ?? ''), 40); if (!id || ids.has(id)) id = 'x' + Math.random().toString(36).slice(2, 10); ids.add(id); return id; };
    /* 4.2: `completed` holds the exact `at` string the completion experience already ran for ('' = not completed yet). Because it is tied to
       the target string, editing the target time automatically re-arms the event, and a timezone change cannot re-trigger it. */
    S.events = (Array.isArray(raw.events) ? raw.events : []).filter(e => e && str(e.title, 60) && okAt(e.at)).map(e => {
      const at = e.at.length === 10 ? e.at + 'T00:00' : e.at;
      return { id: uniq(e.id), title: str(e.title, 60), at, desc: str(e.desc, 240), ...(str(e.category, 30) ? { category: str(e.category, 30) } : {}), start: Number.isFinite(e.start) ? e.start : Date.now(), completed: e.completed === at ? at : '', reminders: normReminders(e.reminders), fired: normFired(e.fired, at), armed: e.armed === true };
    });
    S.active = S.events.some(e => e.id === raw.active) ? raw.active : null;
    S.goals = (Array.isArray(raw.goals) ? raw.goals : []).filter(g => g && str(g.title, 60)).map(g => ({
      id: uniq(g.id), title: str(g.title, 60), category: str(g.category, 30), desc: str(g.desc, 240), target: isKey(g.target) ? g.target : '',
      tasks: (Array.isArray(g.tasks) ? g.tasks : []).filter(t => t && str(t.name, 60)).map(t => ({
        id: uniq(t.id), name: str(t.name, 60), created: isKey(t.created) ? t.created : '',
        h: [...new Set((Array.isArray(t.h) ? t.h : []).filter(isKey))].sort()
      }))
    }));
    const d = raw.diff || {}; S.diff = { a: isKey(d.a) ? d.a : '', b: isKey(d.b) ? d.b : '' };
    S.sound = raw.sound !== false;
    return S;
  }

  const api = { pad, dkey, isKey, day, isLeap, dim, dayNum, keyFromNum, addMonthsKey, ymd, dateDiff, age, nextBirthday, countdownParts, currentStreak, longestStreak, dayStatus, lifeProgress, sanitize, blank, okAt, RKEYS, RDEF, FX_SOUNDS, FX_TEN, NOTIF_SOUNDS, THEMES, FREEZES_LIM, FOCUS_TARGET_LIM, STREAK_GOAL_LIM, normReminders, normFired };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CP = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
