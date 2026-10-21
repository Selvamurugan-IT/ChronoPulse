'use strict';
/* ChronoPulse 4.2 — streak tracking & activity calendar logic (no DOM). Loaded as a classic script (window.CP44) and via require() in Node tests.
   NOTHING is stored for streaks: every number is DERIVED from data that already exists in schema 7 (key chronopulse:v4.1), so there is no migration and
   a backup/restore or a second tab can never disagree with it. The only new field is the additive setting cfg.streakGoal (validated in lib41.js).
   What counts as an activity (one point each, on the LOCAL day it happened):
     - a habit check-in (goals[].tasks[].h)
     - a plain task marked done (todos[].doneOn)  — tasks linked to a habit are NOT counted again: their completion is already that habit's check-in
     - a completed focus session (sessions[] with type 'focus', status 'completed', on its start day)
   Passive things (a countdown finishing, an edit, an import) never count. A day is ACTIVE when its activities >= the daily goal (default 1).
   Streak policy: the current streak is the run of consecutive active days ending today; if today is not active YET but yesterday was, the run ending
   yesterday still counts (it is alive until midnight). Days after today are ignored (a device clock moved backwards cannot inflate a streak).
   STREAK FREEZES (also derived, nothing stored): walking history day by day, a MISSED past day inside a live streak is bridged automatically if its calendar
   month still has an unused freeze (default 3 per month, setting 0-3). A bridged ("frozen") day keeps the streak alive but does not add to the count. When a
   month's freezes are used up, the next missed day ends the streak. Today is never frozen: it is still open until midnight. With 0 freezes the rules are exactly
   the plain ones above.
   Badges: Bronze 7, Silver 30, Gold 100 days, earned by the LONGEST streak (so a badge is never lost when a streak ends).
   Day arithmetic uses UTC day numbers (lib.js), so DST changes and leap days never shift or skip a day. */
(function (root) {
  const C = typeof module !== 'undefined' && module.exports ? require('./lib.js') : root.CP;
  const { dkey, isKey, dayNum, keyFromNum, dim } = C;
  const GOAL_MIN = C.STREAK_GOAL_LIM[0], GOAL_MAX = C.STREAK_GOAL_LIM[1];
  const goalOf = g => { const n = Math.round(Number(g)); return Number.isFinite(n) ? Math.min(GOAL_MAX, Math.max(GOAL_MIN, n)) : GOAL_MIN; };
  const arr = x => (Array.isArray(x) ? x : []);

  /* { 'YYYY-MM-DD': activities } for every day up to and including `today` (a key). Read-only: never mutates S. */
  function activityCounts(S, today) {
    const out = Object.create(null); if (!S || typeof S !== 'object' || !isKey(today)) return out;
    const add = k => { if (isKey(k) && k <= today) out[k] = (out[k] || 0) + 1; };
    for (const g of arr(S.goals)) for (const t of arr(g && g.tasks)) for (const k of arr(t && t.h)) add(k);
    for (const t of arr(S.todos)) if (t && t.doneOn && !t.habit) add(t.doneOn);
    for (const s of arr(S.sessions)) if (s && s.type === 'focus' && s.status === 'completed') add(s.day);
    return out;
  }

  const freezesOf = n => { const v = Math.round(Number(n)); return Number.isFinite(v) ? Math.min(C.FREEZES_LIM[1], Math.max(C.FREEZES_LIM[0], v)) : 0; };
  /* Full analysis. counts = activityCounts(); opts.freezes = freezes per calendar month (default 0 = none). Returns plain data, never throws. */
  function analyze(counts, goal, today, opts) {
    const g = goalOf(goal), per = freezesOf(opts && opts.freezes),
      res = { goal: g, today, todayCount: 0, todayActive: false, current: 0, currentStart: '', currentEnd: '', longest: 0, longestStart: '', longestEnd: '', activeDays: 0, firstDay: '',
        freezesPerMonth: per, frozen: [], freezesUsedThisMonth: 0, freezesLeft: per, atRisk: false };
    if (!counts || !isKey(today)) return res;
    res.todayCount = counts[today] || 0; res.todayActive = res.todayCount >= g;
    const keys = Object.keys(counts).filter(k => isKey(k) && k <= today).sort(); res.firstDay = keys[0] || '';
    const act = new Set(keys.filter(k => counts[k] >= g).map(dayNum)); res.activeDays = act.size;
    if (!act.size) return res;
    const tn = dayNum(today), used = Object.create(null); let first = Infinity; for (const n of act) if (n < first) first = n;
    let len = 0, rs = 0, re = 0;
    const settle = () => { if (len > 0 && len >= res.longest) { res.longest = len; res.longestStart = keyFromNum(rs); res.longestEnd = keyFromNum(re); } len = 0; };
    for (let n = first; n <= tn; n++) {
      if (act.has(n)) { if (len === 0) rs = n; len++; re = n; }
      else if (n === tn) { /* today is still open until midnight: neither missed nor frozen */ }
      else if (len > 0 && per > 0) {
        const k = keyFromNum(n), mk = k.slice(0, 7);
        if ((used[mk] || 0) < per) { used[mk] = (used[mk] || 0) + 1; res.frozen.push(k); } else settle();
      } else settle();
    }
    if (len > 0) { res.current = len; res.currentStart = keyFromNum(rs); res.currentEnd = keyFromNum(re); settle(); }
    res.freezesUsedThisMonth = res.frozen.filter(k => k.slice(0, 7) === today.slice(0, 7)).length; res.freezesLeft = Math.max(0, per - res.freezesUsedThisMonth);
    res.atRisk = !res.todayActive && res.current > 0;
    return res;
  }
  const analyzeState = (S, now = new Date()) => { const today = dkey(now), counts = activityCounts(S, today), cfg = (S && S.cfg) || {}; return { counts, info: analyze(counts, cfg.streakGoal, today, { freezes: typeof cfg.freezesPerMonth === 'number' ? cfg.freezesPerMonth : C.FREEZES_LIM[1] }) }; };

  /* the "X more to unlock" line + progress bar (0-100) */
  function progress(info) {
    const need = Math.max(0, info.goal - info.todayCount), pct = Math.min(100, Math.round(info.todayCount / info.goal * 100)), act = n => (n === 1 ? 'activity' : 'activities');
    if (info.todayActive) return { state: 'counted', need: 0, pct: 100, text: `Today is counted! Come back tomorrow to reach a ${info.current + 1}-day streak.` };
    if (info.current > 0) return { state: 'need', need, pct, text: `${need} more ${act(need)} and your ${info.current + 1}-day streak is unlocked!` };
    return { state: 'start', need, pct, text: `${need} more ${act(need)} today to start your streak!` };
  }

  /* calendar month grid, Sunday first. cells: null padding or { d, key, count, active, today, future, run } where run = 'single' | 'start' | 'mid' | 'end' | '' describes how an active pill joins its neighbours IN THE SAME WEEK ROW */
  function monthGrid(y, m0, counts, goal, today, frozen) {
    const g = goalOf(goal), total = dim(y, m0), lead = new Date(y, m0, 1).getDay(), cells = [], fz = frozen instanceof Set ? frozen : new Set(Array.isArray(frozen) ? frozen : []);
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= total; d++) { const key = dkey(new Date(y, m0, d)), count = (counts && counts[key]) || 0; const active = key <= today && count >= g; cells.push({ d, key, count, active, frozen: !active && key < today && fz.has(key), today: key === today, future: key > today, run: '' }); }
    while (cells.length % 7) cells.push(null);
    const weeks = []; for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    const on = c => !!c && (c.active || c.frozen); /* pills join across active AND frozen days in the same week row */
    for (const w of weeks) w.forEach((c, i) => { if (!on(c)) return; const l = on(w[i - 1]), r = on(w[i + 1]); c.run = l && r ? 'mid' : l ? 'end' : r ? 'start' : 'single'; });
    return { y, m0, weeks, activeDays: cells.filter(c => c && c.active).length, frozenDays: cells.filter(c => c && c.frozen).length };
  }
  /* months the calendar may show: from the first recorded activity (or this month) up to this month */
  function monthBounds(info, today) {
    const ty = +today.slice(0, 4), tm = +today.slice(5, 7) - 1, f = info && info.firstDay;
    return { min: f ? { y: +f.slice(0, 4), m0: +f.slice(5, 7) - 1 } : { y: ty, m0: tm }, max: { y: ty, m0: tm } };
  }
  const monthIdx = ({ y, m0 }) => y * 12 + m0;
  function stepMonth(cur, delta, bounds) { const n = Math.min(monthIdx(bounds.max), Math.max(monthIdx(bounds.min), monthIdx(cur) + delta)); return { y: Math.floor(n / 12), m0: n % 12 }; }

  /* "Jul 6 – Oct 11" (adds the year when the range crosses years or is not in the current year). Locale is a parameter so tests are deterministic. */
  function rangeLabel(startKey, endKey, locale, today) {
    if (!isKey(startKey) || !isKey(endKey)) return '';
    const d = k => new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10)), yr = startKey.slice(0, 4) !== endKey.slice(0, 4) || (isKey(today) && endKey.slice(0, 4) !== today.slice(0, 4));
    const f = k => d(k).toLocaleDateString(locale, yr ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' });
    return startKey === endKey ? f(startKey) : `${f(startKey)} – ${f(endKey)}`;
  }
  /* ---------- completion-level badges ---------- */
  const BADGES = [{ id: 'bronze', name: 'Bronze', days: 7, tier: 1 }, { id: 'silver', name: 'Silver', days: 30, tier: 2 }, { id: 'gold', name: 'Gold', days: 100, tier: 3 }];
  /* earned by the longest streak ever reached, so ending a streak never takes a badge away */
  function badges(info) {
    const have = Math.max(0, (info && info.longest) | 0);
    return BADGES.map(b => ({ ...b, unlocked: have >= b.days, have: Math.min(have, b.days), left: Math.max(0, b.days - have), pct: Math.min(100, Math.floor(have / b.days * 100)) }));
  }
  const nextBadge = list => list.find(b => !b.unlocked) || null;
  /* ---------- habit matrix: each habit x the last N days (ending today) ---------- */
  function habitMatrix(S, today, days = 7, maxRows = 8) {
    if (!S || !isKey(today)) return { days: [], rows: [], more: 0 };
    const t = dayNum(today), keys = Array.from({ length: days }, (_, i) => keyFromNum(t - (days - 1 - i))), rows = [];
    for (const g of arr(S.goals)) for (const h of arr(g && g.tasks)) {
      if (!h) continue; const set = new Set(arr(h.h).filter(isKey));
      rows.push({ id: String(h.id || ''), name: String(h.name || ''), goal: String((g && g.title) || ''), cells: keys.map(k => ({ key: k, done: set.has(k) })), done: keys.filter(k => set.has(k)).length });
    }
    return { days: keys, rows: rows.slice(0, maxRows), more: Math.max(0, rows.length - maxRows) };
  }
  const label = info => `${info.current} day${info.current === 1 ? '' : 's'} streak` + (info.current && !info.todayActive ? ', keep it alive today' : '');

  const api = { GOAL_MIN, GOAL_MAX, BADGES, goalOf, freezesOf, badges, nextBadge, habitMatrix, activityCounts, analyze, analyzeState, progress, monthGrid, monthBounds, stepMonth, rangeLabel, label };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CP44 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
