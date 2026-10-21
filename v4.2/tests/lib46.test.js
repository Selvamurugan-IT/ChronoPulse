'use strict';
/* Analytics chart data & geometry (lib/lib46.js): focus bars, 365-day heatmap, category donut, progress rings. Pure Node. */
const test = require('node:test'), assert = require('node:assert/strict');
const Q = require('../lib/lib46.js'), C = require('../lib/lib.js');
const range = (a, b) => { const o = []; for (let n = C.dayNum(a); n <= C.dayNum(b); n++) o.push(C.keyFromNum(n)); return o; };
const sess = (day, sec, o = {}) => ({ type: 'focus', status: 'completed', day, actualSec: sec, ...o });

/* ----- 1. focus bars ----- */
test('week chart: Monday..Sunday of the current week, minutes per day, future days empty, no floating-point noise in hours', () => {
  const S = { sessions: [sess('2026-10-12', 4980), sess('2026-10-14', 1500), sess('2026-10-14', 600), sess('2026-10-09', 3600)] }; /* Fri 9th belongs to the previous week */
  const w = Q.focusWeek(S, '2026-10-14', 120); assert.deepEqual(w.days.map(d => d.label), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']); assert.deepEqual(w.days.map(d => d.key), range('2026-10-12', '2026-10-18'));
  assert.deepEqual(w.days.map(d => d.min), [83, 0, 35, 0, 0, 0, 0]); assert.deepEqual(w.days.map(d => d.hours), [1.4, 0, 0.6, 0, 0, 0, 0]); assert.deepEqual(w.days.map(d => d.future), [false, false, false, true, true, true, true]); assert.equal(w.days[2].today, true); assert.equal(w.totalMin, 118);
  for (const d of w.days) assert.ok(Number.isInteger(d.hours * 10), 'hours has one decimal at most: ' + d.hours);
});
test('week chart: Sunday and Monday boundaries, and sessions of other types/status never count', () => {
  assert.equal(Q.focusWeek({}, '2026-10-18', 60).days[0].key, '2026-10-12', 'Sunday belongs to the week that started on Monday'); assert.equal(Q.focusWeek({}, '2026-10-12', 60).days[0].key, '2026-10-12'); assert.equal(Q.focusWeek({}, '2026-10-19', 60).days[0].key, '2026-10-19');
  const S = { sessions: [sess('2026-10-12', 1500), sess('2026-10-12', 1500, { status: 'interrupted' }), sess('2026-10-12', 1500, { type: 'short' }), sess('2026-10-12', 0), sess('2026-10-12', -5), sess('bad', 1500), sess('2026-10-12', NaN)] };
  assert.equal(Q.focusWeek(S, '2026-10-14', 0).days[0].min, 25);
});
test('daily goal: line value, goal-met flags and counts; goal 0 means no line', () => {
  const S = { sessions: [sess('2026-10-12', 7200), sess('2026-10-13', 3600)] }, w = Q.focusWeek(S, '2026-10-14', 120);
  assert.deepEqual(w.days.map(d => d.metGoal), [true, false, false, false, false, false, false]); assert.equal(w.goalDays, 1); assert.equal(w.targetMin, 120); assert.equal(Q.focusWeek(S, '2026-10-14', 0).goalDays, 0); assert.equal(Q.focusWeek(S, '2026-10-14', 0).targetMin, 0);
  assert.equal(Q.targetOf(9999), 720); assert.equal(Q.targetOf(-4), 0); assert.equal(Q.targetOf('x'), 0); assert.equal(Q.targetOf(90.4), 90);
});
test('y axis (hours): at most 5 intervals, starts at 0, always reaches the goal line and the tallest bar', () => {
  for (const [max, goal] of [[0, 0], [20, 0], [83, 120], [250, 120], [600, 0], [900, 360], [3000, 840], [10, 720]]) {
    const a = Q.axis(max, goal); assert.equal(a.ticks[0], 0); assert.ok(a.ticks.length - 1 <= 5, `${max}/${goal}: ${a.ticks}`); assert.ok(a.maxH * 60 >= Math.max(max, goal) - 1e-9); assert.equal(a.ticks.at(-1), a.maxH);
    for (const t of a.ticks) assert.equal(t, Math.round(t * 100) / 100, 'clean tick label ' + t);
  }
  assert.deepEqual(Q.axis(250, 120).ticks, [0, 1, 2, 3, 4, 5]); assert.ok(Q.axis(0, 0).maxH >= 0.5);
});
test('8-week chart: newest week last, Monday-start week totals, weekly goal = 7 x daily goal', () => {
  const S = { sessions: [sess('2026-10-12', 3600), sess('2026-10-14', 1800), sess('2026-10-05', 6000), sess('2026-08-24', 600)] }, w = Q.focusWeeks(S, '2026-10-14', 8, 60);
  assert.equal(w.weeks.length, 8); assert.equal(w.weeks.at(-1).key, '2026-10-12'); assert.equal(w.weeks.at(-1).current, true); assert.equal(w.weeks.at(-1).label, 'Oct 12'); assert.equal(w.weeks[0].key, '2026-08-24'); assert.equal(w.weeks[0].min, 10);
  assert.equal(w.weeks.at(-1).min, 90); assert.equal(w.weeks.at(-2).min, 100); assert.equal(w.targetMin, 420); assert.equal(w.weeks.at(-2).metGoal, false); assert.equal(Q.focusWeeks(S, '2026-10-14', 8, 10).weeks.at(-2).metGoal, true);
  assert.equal(Q.focusWeeks(S, '2026-10-14', 1, 60).weeks.length, 2, 'at least 2 weeks'); assert.equal(Q.focusWeeks(S, '2026-10-14', 99, 60).weeks.length, 26, 'at most 26 weeks');
});
test('focus charts never throw on junk', () => { for (const S of [null, undefined, 5, {}, { sessions: 'x' }, { sessions: [null, 1, {}] }]) { assert.doesNotThrow(() => Q.focusWeek(S, '2026-10-14', 60)); assert.doesNotThrow(() => Q.focusWeeks(S, '2026-10-14', 8, 60)); } assert.equal(Q.focusWeek({}, 'bad', 60).days.length, 0); });

/* ----- 2. heatmap ----- */
test('heatmap: exactly 365 day cells ending today, columns are weeks (Sunday first), last cell is today', () => {
  const h = Q.heatmap({}, '2026-10-14'), cells = h.cols.flat().filter(Boolean); assert.equal(cells.length, 365); assert.equal(h.start, '2025-10-15'); assert.equal(cells.at(-1).key, '2026-10-14'); assert.equal(cells.at(-1).today, true); assert.ok(h.cols.every(c => c.length === 7)); assert.ok(h.cols.length === 53 || h.cols.length === 54);
  assert.equal(h.cols[0].findIndex(Boolean), Q.weekdayOf('2025-10-15'), 'first column is padded to the right weekday'); assert.equal(new Set(cells.map(c => c.key)).size, 365);
  for (let ci = 0; ci < h.cols.length; ci++) h.cols[ci].forEach((c, ri) => { if (c) assert.equal(Q.weekdayOf(c.key), ri, 'row = weekday'); });
});
test('heatmap: leap year window and a DST-crossing window still have 365 distinct consecutive days', () => {
  for (const today of ['2028-03-01', '2026-03-10', '2026-11-03']) { const cells = Q.heatmap({}, today).cols.flat().filter(Boolean); assert.equal(cells.length, 365); for (let i = 1; i < cells.length; i++) assert.equal(C.dayNum(cells[i].key) - C.dayNum(cells[i - 1].key), 1, today); }
});
test('heatmap: intensity levels 0 (none) and 1-4 (light to dark) relative to the busiest day; totals, active days and best day', () => {
  const c = { '2026-10-14': 8, '2026-10-13': 4, '2026-10-12': 2, '2026-10-11': 1, '2026-10-10': 3 }, h = Q.heatmap(c, '2026-10-14'), by = Object.fromEntries(h.cols.flat().filter(Boolean).map(x => [x.key, x.level]));
  assert.deepEqual([by['2026-10-14'], by['2026-10-13'], by['2026-10-12'], by['2026-10-11'], by['2026-10-10'], by['2026-10-09']], [4, 2, 1, 1, 2, 0]); assert.equal(h.total, 18); assert.equal(h.activeDays, 5); assert.deepEqual(h.best, { key: '2026-10-14', count: 8 }); assert.equal(h.max, 8);
  assert.equal(Q.levelOf(0, 5), 0); assert.equal(Q.levelOf(1, 5), 1); assert.equal(Q.levelOf(5, 5), 4); assert.equal(Q.levelOf(3, 0), 0); assert.equal(Q.levelOf(NaN, 5), 0);
  for (let n = 1; n <= 40; n++) { const l = Q.levelOf(n, 40); assert.ok(l >= 1 && l <= 4); }
});
test('heatmap: counts outside the window are ignored; empty data is all level 0; month labels do not overlap and match the first day of each month', () => {
  const h = Q.heatmap({ '2020-01-01': 9, '2030-01-01': 9 }, '2026-10-14'); assert.equal(h.total, 0); assert.equal(h.best, null); assert.ok(h.cols.flat().filter(Boolean).every(c => c.level === 0));
  for (let i = 1; i < h.months.length; i++) assert.ok(h.months[i].col - h.months[i - 1].col >= 3, 'labels spaced'); assert.ok(h.months.length >= 11 && h.months.length <= 13); const names = h.months.map(m => m.label); assert.ok(names.includes('Jan') && names.includes('Dec'));
  for (const m of h.months.slice(1)) { const col = h.cols[m.col].filter(Boolean); assert.ok(col.some(x => x.key.endsWith('-01') && Q.MONTHS[+x.key.slice(5, 7) - 1] === m.label), m.label); }
  assert.equal(Q.heatmap(null, 'bad').cols.length, 0); assert.doesNotThrow(() => Q.heatmap(undefined, '2026-10-14'));
});

/* ----- 3. categories ----- */
const S3 = { events: [{ category: 'Work' }, { category: 'work ' }, { category: 'Study' }, {}], goals: [{ category: 'Health', tasks: [{ id: 'a' }, { id: 'b' }] }, { category: '', tasks: [{ id: 'c' }] }], todos: [{ habit: 'a' }, { habit: 'c' }, { habit: '' }, { habit: 'ghost' }] };
test('categories: events by their category, habits by their goal category, tasks via their linked habit; case-insensitive merge; blank = Uncategorized', () => {
  const c = Q.categories(S3); assert.equal(c.total, 11); assert.deepEqual(c.sources, { events: 4, habits: 3, tasks: 4 }); const by = Object.fromEntries(c.items.map(x => [x.name, x.count]));
  assert.deepEqual(by, { Uncategorized: 5, Health: 3, Work: 2, Study: 1 }); assert.deepEqual(c.items.map(x => x.name), ['Uncategorized', 'Health', 'Work', 'Study'], 'sorted by size, ties by name'); assert.equal(c.items.find(x => x.name === 'Work').sources.events, 2);
});
test('category percentages are integers that always add up to exactly 100', () => {
  assert.equal(Q.categories(S3).items.reduce((a, b) => a + b.pct, 0), 100);
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let t = 0; t < 200; t++) { const n = 1 + Math.floor(rnd() * 30), cats = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', ''], S = { events: Array.from({ length: n }, () => ({ category: cats[Math.floor(rnd() * cats.length)] })) }, c = Q.categories(S); assert.equal(c.items.reduce((a, b) => a + b.pct, 0), 100); assert.equal(c.items.reduce((a, b) => a + b.count, 0), n); assert.ok(c.items.length <= Q.MAX_SLICES); assert.ok(c.items.every(x => Number.isInteger(x.pct) && x.pct >= 0)); }
});
test('more than 6 categories: the smallest are merged into "Other" without losing any counts', () => {
  const S = { events: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].flatMap((n, i) => Array(8 - i).fill({ category: n })) }, c = Q.categories(S); assert.equal(c.items.length, 6); assert.equal(c.items.at(-1).name, 'Other'); assert.equal(c.total, 36); assert.equal(c.items.reduce((a, b) => a + b.count, 0), 36); assert.deepEqual(c.items.map(x => x.color), [0, 1, 2, 3, 4, 5]);
});
test('category names are kept as plain data (escaping happens at render); empty/junk data is safe', () => {
  const c = Q.categories({ events: [{ category: '<img src=x onerror=alert(1)>' }] }); assert.equal(c.items[0].name, '<img src=x onerror=alert(1)>'); assert.equal(Q.esc(c.items[0].name), '&lt;img src=x onerror=alert(1)&gt;'); assert.equal(Q.esc('"\'&<>'), '&quot;&#39;&amp;&lt;&gt;');
  for (const bad of [null, undefined, 5, {}, { events: 'x', goals: [null, { tasks: 3 }], todos: [null, 7] }]) assert.doesNotThrow(() => Q.categories(bad)); assert.deepEqual(Q.categories({}).items, []); assert.equal(Q.categories({}).total, 0);
});
test('donut geometry: segment lengths add up to the circumference, offsets are cumulative, a single category is a full ring', () => {
  const c = Q.categories(S3), d = Q.donutSegments(c.items, 62); assert.ok(Math.abs(d.circ - 2 * Math.PI * 62) < 1e-9); assert.ok(Math.abs(d.segs.reduce((a, s) => a + s.len, 0) - d.circ) < 1e-6); let cum = 0; d.segs.forEach(s => { assert.ok(Math.abs(s.offset + cum) < 1e-6); assert.ok(Math.abs(s.len + s.gap - d.circ) < 1e-6); cum += s.len; });
  const one = Q.donutSegments([{ count: 5 }], 62); assert.ok(Math.abs(one.segs[0].len - one.circ) < 1e-9); assert.deepEqual(Q.donutSegments([], 62).segs, []);
});

/* ----- 4. rings ----- */
test('rings: "78% of 2026 completed" on 14 Oct 2026, month and milestone gauges', () => {
  const S = { events: [{ at: '2026-03-01T09:00' }, { at: '2026-10-14T09:00' }, { at: '2026-12-25T10:00' }, { at: '2027-01-01' }, { at: '2025-06-01' }] }, r = Q.rings(new Date(2026, 9, 14, 12), S);
  assert.deepEqual(r.map(x => x.id), ['year', 'month', 'milestones']); assert.equal(r[0].pct, 78); assert.equal(r[0].title, '78% of 2026 completed'); assert.equal(r[1].pct, 43); assert.equal(r[1].title, 'October: 43% complete'); assert.deepEqual([r[2].done, r[2].total, r[2].pct], [2, 3, 66]); assert.equal(r[2].title, 'Milestones: 2 of 3 reached');
});
test('rings: boundaries (new year, last minute of the year, leap day), no events, floor so a ring never claims more than has elapsed', () => {
  assert.equal(Q.rings(new Date(2026, 0, 1, 0, 0), {})[0].pct, 0); assert.equal(Q.rings(new Date(2026, 11, 31, 23, 59), {})[0].pct, 99); assert.equal(Q.rings(new Date(2028, 1, 29, 12), {})[1].title, 'February: 100% complete'.replace('100', String(Q.rings(new Date(2028, 1, 29, 12), {})[1].pct)));
  const none = Q.rings(new Date(2026, 9, 14), {}); assert.equal(none[2].pct, 0); assert.match(none[2].title, /none planned/); assert.equal(Q.rings(new Date(2026, 9, 14), null).length, 3); assert.equal(Q.rings(new Date(2026, 9, 14), { events: [{ at: 5 }, null] })[2].total, 0);
  for (const [d, exp] of [[new Date(2026, 6, 2, 12), 50], [new Date(2026, 6, 1, 23, 59), 49]]) assert.equal(Q.rings(d, {})[0].pct, exp, String(d));
});
test('ring geometry: dash length is the percentage of the circumference, clamped', () => {
  const r = Q.ringDash(25, 90); assert.ok(Math.abs(r.dash - r.circ / 4) < 1e-9); assert.equal(Q.ringDash(150, 50).dash, Q.ringDash(100, 50).circ); assert.equal(Q.ringDash(-5, 50).dash, 0); assert.equal(Q.pctFloor(78.99), 78); assert.equal(Q.pctFloor(NaN), 0); assert.equal(Q.pctFloor(250), 100);
});
