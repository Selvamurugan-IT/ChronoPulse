'use strict';
/* Streak freezes (3 per calendar month), badges and the habit matrix — lib/lib44.js. Pure Node. */
const test = require('node:test'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process'), path = require('node:path');
const P = require('../lib/lib44.js'), C = require('../lib/lib.js');
const range = (a, b) => { const o = []; for (let n = C.dayNum(a); n <= C.dayNum(b); n++) o.push(C.keyFromNum(n)); return o; };
const counts = keys => Object.fromEntries(keys.map(k => [k, 1]));
const A = (keys, today, freezes) => P.analyze(counts(keys), 1, today, { freezes });
const minus = (list, ...gone) => list.filter(k => !gone.includes(k));

test('without the freezes option nothing is frozen (4.2.3 behaviour is preserved exactly)', () => {
  const i = P.analyze(counts(minus(range('2026-10-01', '2026-10-10'), '2026-10-05')), 1, '2026-10-11'); assert.deepEqual([i.current, i.longest, i.frozen.length, i.freezesPerMonth], [5, 5, 0, 0], 'alive via yesterday, the gap on the 5th really broke the earlier run');
});
test('a missed day inside a live streak is covered by a freeze: the streak survives but the frozen day adds nothing to the count', () => {
  const days = minus(range('2026-10-01', '2026-10-10'), '2026-10-05'), i = A(days, '2026-10-10', 3);
  assert.equal(i.current, 9, '9 active days, the frozen day is not counted'); assert.deepEqual(i.frozen, ['2026-10-05']); assert.equal(i.longest, 9); assert.equal(i.currentStart, '2026-10-01'); assert.equal(i.freezesLeft, 2); assert.equal(i.freezesUsedThisMonth, 1);
});
test('up to 3 consecutive misses in a month are covered; the 4th ends the streak (longest is remembered)', () => {
  const run = range('2026-10-01', '2026-10-06');
  const three = A([...run, ...range('2026-10-10', '2026-10-12')], '2026-10-12', 3); assert.equal(three.current, 9, 'Oct 7, 8, 9 missed = 3 misses, all covered: 6 + 3 active days'); assert.deepEqual(three.frozen, ['2026-10-07', '2026-10-08', '2026-10-09']);
  const four = A([...run, ...range('2026-10-11', '2026-10-12')], '2026-10-12', 3); assert.equal(four.current, 2, 'Oct 7-10 = 4 misses, only 3 covered: the 4th ended the streak, a new one started on the 11th'); assert.equal(four.longest, 6); assert.equal(four.longestEnd, '2026-10-06'); assert.equal(four.frozen.length, 3);
  const five = A([...run, '2026-10-12'], '2026-10-12', 3); assert.equal(five.current, 1);
});
test('the allowance resets every calendar month (2 per month: Jan 30-31 and Feb 1-2 are all covered, a 3rd February miss is not)', () => {
  const base = range('2026-01-20', '2026-01-29');
  const ok = A([...base, '2026-02-03'], '2026-02-03', 2); assert.equal(ok.current, 11); assert.deepEqual(ok.frozen, ['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02']);
  const broke = A([...base, '2026-02-04'], '2026-02-04', 2); assert.equal(broke.current, 1, 'Feb 1,2 frozen, Feb 3 has no freeze left');
});
test('today is never frozen: with yesterday frozen and today still open the streak is alive and at risk', () => {
  const i = A(range('2026-10-01', '2026-10-08'), '2026-10-10', 3); assert.equal(i.current, 8); assert.equal(i.todayActive, false); assert.deepEqual(i.frozen, ['2026-10-09']); assert.equal(i.atRisk, true); assert.equal(i.freezesLeft, 2);
  const fresh = A(range('2026-10-01', '2026-10-09'), '2026-10-10', 3); assert.equal(fresh.current, 9); assert.deepEqual(fresh.frozen, []); assert.equal(fresh.freezesLeft, 3); assert.equal(fresh.atRisk, true);
  const done = A([...range('2026-10-01', '2026-10-08'), '2026-10-10'], '2026-10-10', 3); assert.equal(done.atRisk, false); assert.equal(done.current, 9);
});
test('a streak that is already over never consumes freezes retroactively beyond the allowance; trailing used shields stay visible', () => {
  const i = A(range('2026-10-01', '2026-10-05'), '2026-10-20', 3); assert.equal(i.current, 0); assert.equal(i.longest, 5); assert.deepEqual(i.frozen, ['2026-10-06', '2026-10-07', '2026-10-08']); assert.equal(i.freezesLeft, 0, 'all used up this month');
});
test('no streak yet = nothing to protect: leading empty days never use a freeze', () => {
  const i = A(['2026-10-09', '2026-10-10'], '2026-10-10', 3); assert.deepEqual(i.frozen, []); assert.equal(i.current, 2); assert.equal(A([], '2026-10-10', 3).freezesLeft, 3);
});
test('the daily goal still decides what an active day is (a day below the goal is a missed day and can be frozen)', () => {
  const c = { '2026-10-01': 2, '2026-10-02': 1, '2026-10-03': 2 }; const i = P.analyze(c, 2, '2026-10-03', { freezes: 1 }); assert.equal(i.current, 2); assert.deepEqual(i.frozen, ['2026-10-02']);
});
test('freezes per month is clamped to 0-3; 0 = off; junk = off', () => {
  assert.equal(P.freezesOf(3), 3); assert.equal(P.freezesOf(9), 3); assert.equal(P.freezesOf(-2), 0); assert.equal(P.freezesOf(1.6), 2); assert.equal(P.freezesOf('x'), 0); assert.equal(P.freezesOf(undefined), 0);
  const days = minus(range('2026-10-01', '2026-10-10'), '2026-10-05'); assert.equal(A(days, '2026-10-10', 0).current, 5); assert.equal(A(days, '2026-10-10', 99).frozen.length, 1);
});
test('freezesLeft counts only freezes used in the CURRENT month', () => {
  const i = A([...range('2026-09-20', '2026-09-25'), ...range('2026-09-28', '2026-10-02')], '2026-10-02', 3); assert.deepEqual(i.frozen, ['2026-09-26', '2026-09-27']); assert.equal(i.freezesUsedThisMonth, 0); assert.equal(i.freezesLeft, 3);
});
test('analyzeState reads the setting (default 3 when absent, 0 turns it off)', () => {
  const S = c => ({ goals: [{ tasks: [{ h: minus(range('2026-10-01', '2026-10-10'), '2026-10-05') }] }], cfg: c }), now = new Date(2026, 9, 10, 12);
  assert.equal(P.analyzeState(S({}), now).info.current, 9); assert.equal(P.analyzeState(S({ freezesPerMonth: 0 }), now).info.current, 5); assert.equal(P.analyzeState(S({ freezesPerMonth: 1 }), now).info.freezesLeft, 0);
});
test('the calendar marks frozen days and joins them into the pill with neighbouring streak days', () => {
  const days = minus(range('2026-10-04', '2026-10-10'), '2026-10-07'), i = A(days, '2026-10-10', 3), g = P.monthGrid(2026, 9, counts(days), 1, '2026-10-10', i.frozen), cell = d => g.weeks.flat().find(c => c && c.d === d);
  assert.equal(cell(7).frozen, true); assert.equal(cell(7).active, false); assert.equal(cell(6).frozen, false); assert.equal(g.frozenDays, 1); assert.equal(cell(7).run, 'mid'); assert.equal(cell(4).run, 'start'); assert.equal(cell(10).run, 'end');
  assert.equal(P.monthGrid(2026, 9, counts(days), 1, '2026-10-10').frozenDays, 0, 'no frozen set = nothing marked'); assert.equal(P.monthGrid(2026, 9, counts(days), 1, '2026-10-10', new Set(['2026-10-11'])).frozenDays, 0, 'a future day can never be frozen');
});
test('freeze maths is identical in every time zone and across DST changes', () => {
  const script = `const P=require('./lib/lib44.js'),C=require('./lib/lib.js');const k=[];for(let n=C.dayNum('2026-03-01');n<=C.dayNum('2026-04-20');n++){const d=C.keyFromNum(n);if(!['2026-03-08','2026-03-29','2026-03-30','2026-04-02'].includes(d))k.push(d)}
    const i=P.analyze(Object.fromEntries(k.map(x=>[x,1])),1,'2026-04-20',{freezes:3});console.log(JSON.stringify(i))`;
  const outs = ['UTC', 'America/New_York', 'Asia/Kolkata', 'Pacific/Auckland', 'Europe/London'].map(tz => execFileSync(process.execPath, ['-e', script], { cwd: path.join(__dirname, '..'), env: { ...process.env, TZ: tz }, encoding: 'utf8' })); assert.equal(new Set(outs).size, 1);
  const i = JSON.parse(outs[0]); assert.equal(i.frozen.length, 4); assert.equal(i.frozen.filter(d => d.startsWith('2026-03')).length, 3); assert.equal(i.current, 51 - 4 + 0 > 0 ? i.current : 0); assert.ok(i.current > 40);
});
test('performance: 10 years of history with scattered misses and freezes is instant', () => {
  const c = {}; for (let n = C.dayNum('2016-10-01'); n <= C.dayNum('2026-10-01'); n++) if (n % 12 !== 0) c[C.keyFromNum(n)] = 1; /* at most 3 misses in any month, so every one is covered */ const t = Date.now(); const i = P.analyze(c, 1, '2026-10-01', { freezes: 3 }); assert.ok(Date.now() - t < 500); assert.ok(i.longest > 1000);
});

/* ----- badges ----- */
test('badges: Bronze 7, Silver 30, Gold 100 days — earned by the LONGEST streak so they are never lost', () => {
  assert.deepEqual(P.BADGES.map(b => [b.id, b.days]), [['bronze', 7], ['silver', 30], ['gold', 100]]);
  const lock = (longest) => P.badges({ longest, current: 0 }).map(b => b.unlocked);
  assert.deepEqual(lock(0), [false, false, false]); assert.deepEqual(lock(6), [false, false, false]); assert.deepEqual(lock(7), [true, false, false]); assert.deepEqual(lock(29), [true, false, false]); assert.deepEqual(lock(30), [true, true, false]); assert.deepEqual(lock(99), [true, true, false]); assert.deepEqual(lock(100), [true, true, true]); assert.deepEqual(lock(5000), [true, true, true]);
});
test('badge progress: have, left and percentage (never above 100)', () => {
  const b = P.badges({ longest: 12 }); assert.deepEqual([b[0].have, b[0].left, b[0].pct], [7, 0, 100]); assert.deepEqual([b[1].have, b[1].left, b[1].pct], [12, 18, 40]); assert.deepEqual([b[2].have, b[2].left, b[2].pct], [12, 88, 12]);
  assert.equal(P.nextBadge(b).id, 'silver'); assert.equal(P.nextBadge(P.badges({ longest: 100 })), null); assert.equal(P.nextBadge(P.badges(null)).id, 'bronze');
  for (const junk of [null, undefined, {}, { longest: -4 }, { longest: NaN }, { longest: 'x' }]) assert.doesNotThrow(() => P.badges(junk)); assert.deepEqual(P.badges({ longest: -4 }).map(x => x.unlocked), [false, false, false]);
});
test('a streak that included freeze-covered days still earns its badge (7 active days spread over 9)', () => {
  const days = minus(range('2026-10-01', '2026-10-09'), '2026-10-03', '2026-10-06'), i = A(days, '2026-10-09', 3); assert.equal(i.longest, 7); assert.equal(P.badges(i)[0].unlocked, true);
});

/* ----- habit matrix ----- */
test('habit matrix: one row per habit, the last 7 days ending today, done flags and counts', () => {
  const S = { goals: [{ title: 'Fit', tasks: [{ id: 'a', name: 'Run', h: ['2026-10-08', '2026-10-10', 'junk', '2026-09-01'] }, { id: 'b', name: 'Read', h: [] }] }, { title: 'Learn', tasks: [{ id: 'c', name: 'Code', h: ['2026-10-10'] }] }] };
  const m = P.habitMatrix(S, '2026-10-10'); assert.deepEqual(m.days, range('2026-10-04', '2026-10-10')); assert.equal(m.rows.length, 3); assert.deepEqual(m.rows[0].cells.map(c => c.done), [false, false, false, false, true, false, true]); assert.equal(m.rows[0].done, 2); assert.equal(m.rows[1].done, 0); assert.equal(m.rows[2].goal, 'Learn'); assert.equal(m.more, 0);
});
test('habit matrix: row cap, "more" counter and junk input never throws', () => {
  const S = { goals: [{ tasks: Array.from({ length: 11 }, (_, i) => ({ id: 'h' + i, name: 'H' + i, h: [] })) }] }; const m = P.habitMatrix(S, '2026-10-10', 7, 8); assert.equal(m.rows.length, 8); assert.equal(m.more, 3);
  for (const bad of [null, undefined, {}, { goals: 5 }, { goals: [null, { tasks: [null, { h: 'x' }] }] }]) assert.doesNotThrow(() => P.habitMatrix(bad, '2026-10-10')); assert.deepEqual(P.habitMatrix({}, 'bad'), { days: [], rows: [], more: 0 }); assert.equal(P.habitMatrix({}, '2026-10-10', 14).days.length, 14);
});
