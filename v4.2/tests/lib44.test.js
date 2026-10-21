'use strict';
/* Streak tracking & activity calendar logic (lib/lib44.js) + the additive cfg.streakGoal setting. Pure Node, no DOM. */
const test = require('node:test'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const P = require('../lib/lib44.js'), C = require('../lib/lib.js'), V = require('../lib/lib41.js');
const range = (a, b) => { const o = []; for (let n = C.dayNum(a); n <= C.dayNum(b); n++) o.push(C.keyFromNum(n)); return o; };
const counts = (keys, n = 1) => Object.fromEntries(keys.map(k => [k, n]));
const state = (o = {}) => ({ goals: [], todos: [], sessions: [], events: [], cfg: { streakGoal: 1 }, ...o });
const habit = h => ({ id: 'g1', title: 'G', tasks: [{ id: 't1', name: 'T', h }] });
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };

/* ----- what counts as an activity ----- */
test('activities: habit check-ins, plain tasks done and completed focus sessions each add 1 on their own day', () => {
  const S = state({ goals: [habit(['2026-10-01', '2026-10-02'])], todos: [{ id: 'a', doneOn: '2026-10-02', habit: '' }], sessions: [{ type: 'focus', status: 'completed', day: '2026-10-02' }] });
  assert.deepEqual({ ...P.activityCounts(S, '2026-10-12') }, { '2026-10-01': 1, '2026-10-02': 3 });
});
test('a task linked to a habit is not counted twice (its completion IS that habit check-in)', () => {
  const S = state({ goals: [habit(['2026-10-02'])], todos: [{ id: 'a', doneOn: '2026-10-02', habit: 't1', via: true }, { id: 'b', doneOn: '2026-10-02', habit: 't1', via: false }] });
  assert.equal(P.activityCounts(S, '2026-10-12')['2026-10-02'], 1);
});
test('not counted: unfinished tasks, breaks, interrupted/cancelled sessions, finished countdown events, junk', () => {
  const S = state({ todos: [{ id: 'a', doneOn: '', habit: '' }], sessions: [{ type: 'short', status: 'completed', day: '2026-10-02' }, { type: 'focus', status: 'interrupted', day: '2026-10-02' }, { type: 'focus', status: 'cancelled', day: '2026-10-02' }],
    events: [{ id: 'e', at: '2026-10-02T10:00', completed: '2026-10-02T10:00' }] });
  assert.deepEqual({ ...P.activityCounts(S, '2026-10-12') }, {});
});
test('garbage in the data never throws and never counts', () => {
  for (const S of [null, undefined, 5, 'x', [], {}, { goals: [null, { tasks: [null, { h: 'oops' }, { h: [null, 5, 'nope', '2026-02-30', '2026-10-01'] }] }], todos: [null, 7, { doneOn: 'bad' }], sessions: [null, { type: 'focus', status: 'completed', day: 'bad' }] }]) assert.doesNotThrow(() => P.activityCounts(S, '2026-10-12'));
  assert.deepEqual({ ...P.activityCounts({ goals: [{ tasks: [{ h: [null, 5, 'nope', '2026-02-30', '2026-10-01'] }] }] }, '2026-10-12') }, { '2026-10-01': 1 });
  assert.deepEqual({ ...P.activityCounts(state(), 'bad') }, {});
});
test('future-dated activity is ignored (a clock moved backwards cannot inflate a streak)', () => {
  const S = state({ goals: [habit(['2026-10-11', '2026-10-12', '2026-10-13', '2026-12-25'])] }), c = P.activityCounts(S, '2026-10-12');
  assert.ok(!('2026-10-13' in c) && !('2026-12-25' in c)); assert.equal(P.analyze(c, 1, '2026-10-12').current, 2);
});
test('reading state never mutates it (works on a deeply frozen state)', () => {
  const S = deepFreeze(state({ goals: [habit(['2026-10-11'])], todos: [{ id: 'a', doneOn: '2026-10-11', habit: '' }], sessions: [{ type: 'focus', status: 'completed', day: '2026-10-11' }] }));
  assert.doesNotThrow(() => P.analyzeState(S, new Date(2026, 9, 12, 13, 29)));
});

/* ----- streak maths ----- */
test('no activity: everything is zero', () => { const i = P.analyze({}, 1, '2026-10-12'); assert.deepEqual([i.current, i.longest, i.activeDays, i.todayActive, i.firstDay], [0, 0, 0, false, '']); });
test('active today only = streak 1, lit', () => { const i = P.analyze(counts(['2026-10-12']), 1, '2026-10-12'); assert.deepEqual([i.current, i.todayActive, i.currentStart, i.currentEnd], [1, true, '2026-10-12', '2026-10-12']); });
test('streak stays alive until midnight: yesterday active, today not yet', () => {
  const i = P.analyze(counts(range('2026-10-09', '2026-10-11')), 1, '2026-10-12'); assert.equal(i.current, 3); assert.equal(i.todayActive, false); assert.equal(i.currentEnd, '2026-10-11');
});
test('a missed full day breaks it: last activity two days ago = 0, but the longest is remembered', () => {
  const i = P.analyze(counts(range('2026-10-05', '2026-10-10')), 1, '2026-10-12'); assert.equal(i.current, 0); assert.equal(i.longest, 6); assert.equal(i.longestEnd, '2026-10-10');
});
test('today + yesterday + earlier run joined; a gap splits runs', () => {
  const i = P.analyze(counts([...range('2026-09-01', '2026-09-20'), ...range('2026-10-10', '2026-10-12')]), 1, '2026-10-12'); assert.equal(i.current, 3); assert.equal(i.longest, 20); assert.equal(i.longestStart, '2026-09-01');
});
test('equal-length runs: the most recent one is "the longest" (so a live streak that ties shows its own dates)', () => {
  const i = P.analyze(counts([...range('2026-08-01', '2026-08-05'), ...range('2026-10-08', '2026-10-12')]), 1, '2026-10-12'); assert.equal(i.longest, 5); assert.equal(i.longestStart, '2026-10-08');
});
test('the screenshot scenario: 98 days Jul 6 - Oct 11, viewed on Oct 12 morning', () => {
  const i = P.analyze(counts(range('2026-07-06', '2026-10-11')), 1, '2026-10-12');
  assert.deepEqual([i.current, i.longest, i.longestStart, i.longestEnd, i.todayActive], [98, 98, '2026-07-06', '2026-10-11', false]);
  assert.equal(P.progress(i).text, '1 more activity and your 99-day streak is unlocked!'); assert.equal(P.rangeLabel(i.longestStart, i.longestEnd, 'en-US', '2026-10-12'), 'Jul 6 – Oct 11');
});
test('daily goal: a day only counts when activities >= goal; changing the goal re-derives the streak', () => {
  const c = { '2026-10-10': 3, '2026-10-11': 2, '2026-10-12': 3 };
  assert.equal(P.analyze(c, 1, '2026-10-12').current, 3); assert.equal(P.analyze(c, 2, '2026-10-12').current, 3); const i3 = P.analyze(c, 3, '2026-10-12'); assert.equal(i3.current, 1); assert.equal(i3.longest, 1);
  const mid = P.analyze(c, 3, '2026-10-11'); assert.equal(mid.todayActive, false); assert.equal(mid.current, 1, 'only 2 of 3 today, but yesterday met the goal so the streak is still alive');
  assert.equal(P.analyze({ '2026-10-11': 2 }, 3, '2026-10-11').current, 0);
});
test('day arithmetic is immune to DST and leap days (runs across 2026 US/EU changes, Feb 29 2028 and New Year)', () => {
  for (const [a, b, n] of [['2026-03-06', '2026-03-10', 5], ['2026-03-27', '2026-03-31', 5], ['2026-10-24', '2026-10-28', 5], ['2026-11-01', '2026-11-03', 3], ['2028-02-27', '2028-03-01', 4], ['2026-12-30', '2027-01-02', 4]]) {
    const i = P.analyze(counts(range(a, b)), 1, b); assert.equal(i.current, n, a); assert.equal(i.longest, n, a); assert.equal(i.currentStart, a);
  }
});
test('results are identical in every time zone (TZ changes only how local dates are formed, never the maths)', () => {
  const script = `const P=require('./lib/lib44.js'),C=require('./lib/lib.js');const k=[];for(let n=C.dayNum('2026-03-01');n<=C.dayNum('2026-04-15');n++)k.push(C.keyFromNum(n));const c=Object.fromEntries(k.map(x=>[x,1]));
    const g=P.monthGrid(2026,2,c,1,'2026-04-15');console.log(JSON.stringify([P.analyze(c,1,'2026-04-15'),g.weeks.map(w=>w.map(x=>x?x.run+x.d:'_').join(','))]))`;
  const outs = ['UTC', 'America/New_York', 'Asia/Kolkata', 'Pacific/Auckland', 'Europe/London', 'America/Sao_Paulo'].map(tz => execFileSync(process.execPath, ['-e', script], { cwd: require('node:path').join(__dirname, '..'), env: { ...process.env, TZ: tz }, encoding: 'utf8' }));
  assert.equal(new Set(outs).size, 1);
});
test('performance: 10 years of data and 5000 sessions analyse in well under a second', () => {
  const sessions = Array.from({ length: 5000 }, (_, i) => ({ type: 'focus', status: 'completed', day: C.keyFromNum(C.dayNum('2016-10-12') + (i % 3650)) })), S = state({ sessions }), t = Date.now();
  const r = P.analyzeState(S, new Date(2026, 9, 12)); assert.ok(Date.now() - t < 1000); assert.ok(r.info.longest > 1000);
});
test('analyze never throws on junk', () => { for (const c of [null, undefined, 5, { bad: 1, '2026-02-30': 9 }]) assert.doesNotThrow(() => P.analyze(c, 'x', '2026-10-12')); assert.equal(P.analyze({}, 1, 'bad').current, 0); });

/* ----- progress / labels ----- */
test('progress text: counted today, need N more (singular/plural), start a streak', () => {
  const base = { goal: 3, todayCount: 1, todayActive: false, current: 4 };
  assert.equal(P.progress(base).text, '2 more activities and your 5-day streak is unlocked!'); assert.equal(P.progress(base).pct, 33);
  assert.equal(P.progress({ ...base, todayCount: 2 }).text, '1 more activity and your 5-day streak is unlocked!');
  assert.equal(P.progress({ ...base, todayCount: 3, todayActive: true }).text, 'Today is counted! Come back tomorrow to reach a 5-day streak.'); assert.equal(P.progress({ ...base, todayCount: 3, todayActive: true }).pct, 100);
  assert.equal(P.progress({ goal: 2, todayCount: 0, todayActive: false, current: 0 }).text, '2 more activities today to start your streak!'); assert.equal(P.progress({ goal: 2, todayCount: 5, todayActive: true, current: 1 }).pct, 100);
});
test('label for the badge / screen readers', () => {
  assert.equal(P.label({ current: 1, todayActive: true }), '1 day streak'); assert.equal(P.label({ current: 98, todayActive: false }), '98 days streak, keep it alive today'); assert.equal(P.label({ current: 0, todayActive: false }), '0 days streak');
});
test('longest-streak date range: same year, other year, single day, invalid', () => {
  assert.equal(P.rangeLabel('2026-07-06', '2026-10-11', 'en-US', '2026-10-12'), 'Jul 6 – Oct 11'); assert.equal(P.rangeLabel('2026-12-20', '2027-01-03', 'en-US', '2027-01-04'), 'Dec 20, 2026 – Jan 3, 2027');
  assert.equal(P.rangeLabel('2024-03-01', '2024-03-09', 'en-US', '2026-10-12'), 'Mar 1, 2024 – Mar 9, 2024'); assert.equal(P.rangeLabel('2026-10-11', '2026-10-11', 'en-US', '2026-10-12'), 'Oct 11'); assert.equal(P.rangeLabel('x', '2026-10-11'), '');
});

/* ----- calendar ----- */
const shape = g => g.weeks.map(w => w.map(c => (c ? (c.run ? c.run[0] : '.') : '_')).join(''));
test('Aug 2026 (all active) matches the reference: Aug 1 alone at the row end, full rows, 30-31 as a closing pill', () => {
  const g = P.monthGrid(2026, 7, counts(range('2026-07-06', '2026-10-11')), 1, '2026-10-12'); assert.deepEqual(shape(g), ['______s', 'smmmmme', 'smmmmme', 'smmmmme', 'smmmmme', 'se_____']); assert.equal(g.activeDays, 31);
});
test('grid geometry: leading padding by weekday, every week has 7 cells, leap February, 28-day February', () => {
  const lens = g => g.weeks.every(w => w.length === 7); const days = g => g.weeks.flat().filter(Boolean).length;
  const a = P.monthGrid(2026, 7, {}, 1, '2026-10-12'); assert.equal(a.weeks[0].findIndex(Boolean), 6); assert.equal(days(a), 31); assert.ok(lens(a));
  const f27 = P.monthGrid(2027, 1, {}, 1, '2027-03-01'); assert.equal(days(f27), 28); assert.equal(f27.weeks[0].findIndex(Boolean), 1); assert.equal(f27.weeks.length, 5);
  const f28 = P.monthGrid(2028, 1, {}, 1, '2028-03-01'); assert.equal(days(f28), 29);
  const dec = P.monthGrid(2026, 11, {}, 1, '2026-12-01'); assert.equal(days(dec), 31); assert.equal(dec.weeks.flat().filter(Boolean).at(-1).key, '2026-12-31');
});
test('cell flags: today, future, goal threshold, isolated days', () => {
  const g = P.monthGrid(2026, 9, { '2026-10-09': 1, '2026-10-10': 2, '2026-10-12': 3 }, 2, '2026-10-12'), cell = d => g.weeks.flat().find(c => c && c.d === d);
  assert.equal(cell(9).active, false); assert.equal(cell(10).active, true); assert.equal(cell(12).today, true); assert.equal(cell(12).active, true); assert.equal(cell(13).future, true); assert.equal(cell(13).active, false); assert.equal(cell(10).run, 'single'); assert.equal(cell(12).run, 'single');
});
test('a run that wraps a week row is split into start/mid/end per row (pills join only inside a row)', () => {
  const g = P.monthGrid(2026, 9, counts(range('2026-10-03', '2026-10-06')), 1, '2026-10-12'), cell = d => g.weeks.flat().find(c => c && c.d === d);
  /* Oct 3 is a Saturday (end of its row) and Oct 4 a Sunday (start of the next row) */
  assert.deepEqual([3, 4, 5, 6].map(d => cell(d).run), ['single', 'start', 'mid', 'end']);
});
test('future days never light up even if data exists for them', () => { const g = P.monthGrid(2026, 9, counts(range('2026-10-10', '2026-10-20')), 1, '2026-10-12'); assert.equal(g.activeDays, 3); });
test('month bounds and stepping clamp at the first recorded month and this month, across year ends', () => {
  const b = P.monthBounds({ firstDay: '2025-11-20' }, '2026-02-10'); assert.deepEqual(b, { min: { y: 2025, m0: 10 }, max: { y: 2026, m0: 1 } });
  assert.deepEqual(P.stepMonth({ y: 2026, m0: 1 }, -1, b), { y: 2026, m0: 0 }); assert.deepEqual(P.stepMonth({ y: 2026, m0: 0 }, -1, b), { y: 2025, m0: 11 }); assert.deepEqual(P.stepMonth({ y: 2025, m0: 10 }, -1, b), { y: 2025, m0: 10 });
  assert.deepEqual(P.stepMonth({ y: 2026, m0: 1 }, 1, b), { y: 2026, m0: 1 }); assert.deepEqual(P.monthBounds({ firstDay: '' }, '2026-10-12'), { min: { y: 2026, m0: 9 }, max: { y: 2026, m0: 9 } });
});

/* ----- setting + storage compatibility ----- */
test('cfg.streakGoal: default 1, clamped to 1-10, junk rejected', () => {
  assert.equal(V.cfgOf({}).streakGoal, 1); assert.equal(V.cfgOf({ streakGoal: 4 }).streakGoal, 4); assert.equal(V.cfgOf({ streakGoal: 99 }).streakGoal, 10); assert.equal(V.cfgOf({ streakGoal: 0 }).streakGoal, 1); assert.equal(V.cfgOf({ streakGoal: -3 }).streakGoal, 1);
  assert.equal(V.cfgOf({ streakGoal: 2.6 }).streakGoal, 3); for (const j of ['5', null, NaN, Infinity, {}, [], true]) assert.equal(V.cfgOf({ streakGoal: j }).streakGoal, 1); assert.deepEqual(C.STREAK_GOAL_LIM, [1, 10]); assert.equal(P.goalOf('7'), 7); assert.equal(P.goalOf('x'), 1);
});
test('schema 7 / key unchanged: the goal round-trips, older data and backups simply get the default, and NO streak data is stored', () => {
  const S = V.sanitize41(null); S.cfg.streakGoal = 3; const back = V.sanitize41(JSON.parse(JSON.stringify(S))); assert.equal(back.cfg.streakGoal, 3); assert.equal(back.v, 7); assert.equal(back.meta.schema, 7);
  const old = JSON.parse(JSON.stringify(V.sanitize41(null))); delete old.cfg.streakGoal; assert.equal(V.sanitize41(old).cfg.streakGoal, 1); assert.equal(V.SCHEMA, 7); assert.equal(V.KEY, 'chronopulse:v4.1');
  assert.ok(!Object.keys(S).some(k => /streak/i.test(k)), 'no streak field on the state'); assert.ok(!JSON.stringify(S).match(/currentStreak|longestStreak|"streak"/));
});
test('backup export contains the goal but no derived streak numbers', () => {
  const S = V.sanitize41(null); S.cfg.streakGoal = 2; const b = JSON.stringify(V.makeBackup(S)); assert.ok(/"streakGoal":2/.test(b)); assert.ok(!/"current"|"longest"|activeDays/.test(b));
});
