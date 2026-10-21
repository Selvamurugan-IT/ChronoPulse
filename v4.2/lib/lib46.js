'use strict';
/* ChronoPulse 4.2 — analytics chart data & geometry (no DOM). Loaded as a classic script (window.CP46) and via require() in Node tests.
   Four charts are built from this module (insights-ui.js only DRAWS the numbers it returns):
   1. Focus bars: minutes per day (Mon-Sun) or per week (last 8 weeks) with a daily-goal line  2. 365-day activity heatmap  3. category donut  4. progress rings.
   Everything is derived from existing schema-7 data; nothing is stored. Pure, never throws on junk, deterministic for a given `today` / `now`. */
(function (root) {
  const C = typeof module !== 'undefined' && module.exports ? require('./lib.js') : root.CP;
  const A = typeof module !== 'undefined' && module.exports ? require('./lib44.js') : root.CP44;
  const { isKey, dayNum, keyFromNum } = C;
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const arr = x => (Array.isArray(x) ? x : []);
  const weekdayOf = k => new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10)).getDay(); /* local date from components: 0 = Sunday */
  const mondayIndex = k => (weekdayOf(k) + 6) % 7; /* 0 = Monday ... 6 = Sunday */
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const round1 = n => Math.round(n * 10) / 10;

  /* ---------- 1. focus time ---------- */
  function focusMinutesByDay(S) {
    const out = Object.create(null);
    for (const s of arr(S && S.sessions)) if (s && s.type === 'focus' && s.status === 'completed' && isKey(s.day) && Number.isFinite(s.actualSec) && s.actualSec > 0) out[s.day] = (out[s.day] || 0) + s.actualSec / 60;
    return out;
  }
  /* y axis in HOURS with at most 5 intervals; always includes the goal line */
  function axis(maxMin, targetMin) {
    const top = Math.max(Number(maxMin) || 0, Number(targetMin) || 0, 30) / 60, steps = [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 24, 48, 96, 168];
    const step = steps.find(s => Math.ceil(top / s) <= 5) || 168, max = Math.ceil(top / step) * step, ticks = []; for (let v = 0; v <= max + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
    return { maxH: max, stepH: step, ticks };
  }
  const targetOf = t => { const n = Math.round(Number(t)); return Number.isFinite(n) ? Math.min(C.FOCUS_TARGET_LIM[1], Math.max(C.FOCUS_TARGET_LIM[0], n)) : 0; };
  /* the calendar week (Monday..Sunday) containing `today` */
  function focusWeek(S, today, targetMin) {
    const t = targetOf(targetMin), res = { mode: 'week', targetMin: t, days: [], totalMin: 0, goalDays: 0, axis: null };
    if (!isKey(today)) return { ...res, axis: axis(0, t) };
    const by = focusMinutesByDay(S), start = dayNum(today) - mondayIndex(today); let max = 0;
    for (let i = 0; i < 7; i++) {
      const key = keyFromNum(start + i), min = key <= today ? Math.round((by[key] || 0) * 10) / 10 : 0, future = key > today;
      res.days.push({ key, label: DAYS[i], min, hours: Math.round(min / 6) / 10, future, today: key === today, metGoal: t > 0 && !future && min >= t }); res.totalMin += min; max = Math.max(max, min); if (t > 0 && !future && min >= t) res.goalDays++;
    }
    res.totalMin = Math.round(res.totalMin); res.axis = axis(max, t); return res;
  }
  /* the last n calendar weeks (Monday start), newest last; the weekly goal is 7 x the daily goal */
  function focusWeeks(S, today, n, targetMin) {
    const t = targetOf(targetMin), count = Math.min(26, Math.max(2, n | 0 || 8)), res = { mode: 'weeks', targetMin: t * 7, dailyTarget: t, weeks: [], totalMin: 0, axis: null };
    if (!isKey(today)) return { ...res, axis: axis(0, t * 7) };
    const by = focusMinutesByDay(S), cur = dayNum(today) - mondayIndex(today); let max = 0;
    for (let w = count - 1; w >= 0; w--) {
      const s = cur - w * 7; let min = 0; for (let i = 0; i < 7; i++) { const k = keyFromNum(s + i); if (k <= today) min += by[k] || 0; }
      const sk = keyFromNum(s); min = Math.round(min * 10) / 10; res.weeks.push({ key: sk, label: `${MONTHS[+sk.slice(5, 7) - 1]} ${+sk.slice(8, 10)}`, min, hours: Math.round(min / 6) / 10, current: w === 0, metGoal: t > 0 && min >= t * 7 }); max = Math.max(max, min); res.totalMin += min;
    }
    res.totalMin = Math.round(res.totalMin); res.axis = axis(max, t * 7); return res;
  }

  /* ---------- 2. 365-day heatmap (GitHub style: columns = weeks, rows = Sunday..Saturday) ---------- */
  const levelOf = (count, max) => (!(count > 0) || !(max > 0) ? 0 : Math.min(4, Math.max(1, Math.ceil(count / max * 4))));
  function heatmap(counts, today, nDays = 365) {
    const res = { cols: [], months: [], max: 0, total: 0, activeDays: 0, best: null, start: '', end: today, days: 0 };
    if (!isKey(today)) return res;
    const days = Math.min(731, Math.max(7, nDays | 0)), t = dayNum(today), s = t - days + 1, startKey = keyFromNum(s), pad = weekdayOf(startKey); res.start = startKey; res.days = days;
    for (let i = 0; i < days; i++) { const c = (counts && counts[keyFromNum(s + i)]) || 0; if (c > res.max) res.max = c; }
    const cells = []; for (let i = 0; i < pad; i++) cells.push(null);
    for (let i = 0; i < days; i++) {
      const key = keyFromNum(s + i), count = (counts && counts[key]) || 0; cells.push({ key, count, level: levelOf(count, res.max), today: key === today });
      res.total += count; if (count > 0) { res.activeDays++; if (!res.best || count > res.best.count) res.best = { key, count }; }
    }
    while (cells.length % 7) cells.push(null);
    for (let i = 0; i < cells.length; i += 7) res.cols.push(cells.slice(i, i + 7));
    let lastCol = -9; res.cols.forEach((col, ci) => { const f = col.find(c => c && (c.key.endsWith('-01') || c.key === startKey)); if (f && ci - lastCol >= 3) { const m = +f.key.slice(5, 7) - 1; if (f.key !== startKey || col.filter(Boolean).length >= 4 || ci === 0) { res.months.push({ col: ci, label: MONTHS[m] }); lastCol = ci; } } });
    return res;
  }

  /* ---------- 3. category distribution ---------- */
  const UNCAT = 'Uncategorized', MAX_SLICES = 6;
  function categories(S) {
    const map = new Map(), res = { total: 0, items: [], sources: { events: 0, habits: 0, tasks: 0 } };
    const add = (raw, src) => { const name = (typeof raw === 'string' && raw.trim()) || UNCAT, k = name.toLowerCase(); let e = map.get(k); if (!e) { e = { name, count: 0, sources: { events: 0, habits: 0, tasks: 0 } }; map.set(k, e); } e.count++; e.sources[src]++; res.sources[src]++; res.total++; };
    const catOfHabit = new Map(); for (const g of arr(S && S.goals)) for (const h of arr(g && g.tasks)) if (h && h.id) catOfHabit.set(h.id, g.category);
    for (const e of arr(S && S.events)) if (e) add(e.category, 'events');
    for (const g of arr(S && S.goals)) for (const h of arr(g && g.tasks)) if (h) add(g.category, 'habits');
    for (const t of arr(S && S.todos)) if (t) add(t.habit ? catOfHabit.get(t.habit) : '', 'tasks');
    let items = [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    if (items.length > MAX_SLICES) { const head = items.slice(0, MAX_SLICES - 1), tail = items.slice(MAX_SLICES - 1), o = { name: 'Other', count: 0, sources: { events: 0, habits: 0, tasks: 0 } }; for (const x of tail) { o.count += x.count; for (const k of Object.keys(o.sources)) o.sources[k] += x.sources[k]; } items = [...head, o]; }
    /* integer percentages that add up to exactly 100 (largest remainder) */
    if (res.total) { const raw = items.map(x => x.count / res.total * 100), fl = raw.map(Math.floor); let left = 100 - fl.reduce((a, b) => a + b, 0); raw.map((v, i) => [v - fl[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).forEach(([, i]) => { if (left > 0) { fl[i]++; left--; } }); items.forEach((x, i) => { x.pct = fl[i]; }); }
    items.forEach((x, i) => { x.color = i; }); res.items = items; return res;
  }
  /* donut as stroked circle segments: dash length and dash offset along the circumference */
  function donutSegments(items, r) {
    const circ = 2 * Math.PI * r, total = items.reduce((a, b) => a + b.count, 0); let cum = 0;
    return { circ, segs: total ? items.map(x => { const len = x.count / total * circ, seg = { len, gap: circ - len, offset: -cum }; cum += len; return seg; }) : [] };
  }

  /* ---------- 4. progress rings ---------- */
  const pctFloor = v => Math.min(100, Math.max(0, Math.floor(Number.isFinite(v) ? v : 0)));
  function rings(now, S, locale = 'en-US') {
    const n = now instanceof Date ? now : new Date(now), lp = C.lifeProgress(n), y = n.getFullYear(), monthName = n.toLocaleDateString(locale, { month: 'long' });
    const inYear = arr(S && S.events).filter(e => e && typeof e.at === 'string' && +e.at.slice(0, 4) === y), reached = inYear.filter(e => new Date(e.at.length === 10 ? e.at + 'T00:00' : e.at) <= n).length;
    const year = pctFloor(lp.year.pct), month = pctFloor(lp.month.pct), ms = inYear.length ? pctFloor(reached / inYear.length * 100) : 0;
    return [
      { id: 'year', pct: year, title: `${year}% of ${y} completed`, sub: lp.year.label },
      { id: 'month', pct: month, title: `${monthName}: ${month}% complete`, sub: lp.month.label },
      { id: 'milestones', pct: ms, title: inYear.length ? `Milestones: ${reached} of ${inYear.length} reached` : 'Milestones: none planned this year', sub: inYear.length ? `${ms}% of this year's events have arrived` : 'Add events to see them here', done: reached, total: inYear.length }
    ];
  }
  const ringDash = (pct, r) => { const circ = 2 * Math.PI * r; return { circ, dash: circ * Math.min(100, Math.max(0, pct)) / 100 }; };

  const api = { DAYS, MONTHS, UNCAT, MAX_SLICES, esc, weekdayOf, mondayIndex, focusMinutesByDay, axis, targetOf, focusWeek, focusWeeks, levelOf, heatmap, categories, donutSegments, rings, ringDash, pctFloor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CP46 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
