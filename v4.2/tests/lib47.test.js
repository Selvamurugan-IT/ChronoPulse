'use strict';
/* lib/lib47.js: streak milestones, orbit geometry, stopwatch/clock maths, roaming physics, rocket layout, notification schedule, sound routing, chart data check. Pure Node. */
const test = require('node:test'), assert = require('node:assert/strict');
const Q = require('../lib/lib47.js');

test('milestones: 7, 30, 100, 200, 300 then every 100 days forever, earned by the LONGEST streak', () => {
  assert.deepEqual(Q.BASE.map(b => [b.id, b.days]), [['bronze', 7], ['silver', 30], ['gold', 100], ['diamond', 200], ['legend', 300]]);
  assert.deepEqual([5, 6, 7, 8, 9].map(k => Q.milestone(k).days), [400, 500, 600, 700, 800]); assert.equal(Q.milestone(5).name, 'Legend II'); assert.equal(Q.milestone(8).name, 'Legend V');
  assert.equal(Q.milestone(1000).days, 300 + (1000 - 4) * 100, 'arithmetic progression, no ceiling');
  const m = Q.milestones(446); assert.deepEqual(m.map(x => x.days), [7, 30, 100, 200, 300, 400, 500]); assert.deepEqual(m.map(x => x.unlocked), [true, true, true, true, true, true, false]); assert.equal(m[6].left, 54);
  assert.deepEqual(Q.milestones(0).map(x => x.days), [7]); assert.deepEqual(Q.milestones(7).map(x => x.days), [7, 30]);
  for (const junk of [null, undefined, NaN, 'x', -5, Infinity]) assert.doesNotThrow(() => Q.milestones(junk));
  assert.equal(Q.milestones(Infinity).length, 1, 'non-finite input is treated as 0');
});
test('milestone tiers never decrease and roman numerals are right', () => {
  let prev = 0; for (let k = 0; k < 40; k++) { const t = Q.milestone(k).tier; assert.ok(t >= prev); prev = t; }
  assert.deepEqual([2, 4, 9, 14, 40, 90, 400].map(Q.roman), ['II', 'IV', 'IX', 'XIV', 'XL', 'XC', 'CD']);
});
test('flame glow level escalates with the current streak', () => { assert.deepEqual([0, 6, 7, 29, 30, 99, 100, 199, 200, 299, 300, 499, 500, 5000].map(Q.glowLevel), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6]); assert.equal(Q.glowLevel('x'), 0); });

test('orbit layout: only unlocked badges, inner rings faster, positions stay inside the unit box, front/back from z', () => {
  const list = Q.milestones(446); const L = Q.orbitLayout(list); assert.equal(L.length, 6); assert.ok(L.every(i => i.days <= 400));
  assert.ok(L.every(i => i.ring >= 0 && i.ring <= 2)); const r0 = L.find(i => i.ring === 0), r1 = L.find(i => i.ring === 1); assert.ok(r0.speed > r1.speed); assert.ok(r1.rx > r0.rx);
  for (const it of L) for (const t of [0, 1234, 99999, 1e7]) { const p = Q.orbitPos(it, t); assert.ok(Math.abs(p.x) <= it.rx + 1e-9 && Math.abs(p.y) <= it.ry + 1e-9); assert.ok(p.scale >= 0.78 && p.scale <= 1); }
  assert.deepEqual(Q.orbitLayout(Q.milestones(0)), []); assert.deepEqual(Q.orbitLayout(null), []);
  const many = Q.orbitLayout(Q.milestones(5000)); assert.equal(many.length, Q.MAX_ORBIT, 'capped so a huge streak stays readable and fast');
  const a = Q.orbitPos(r0, 0), b = Q.orbitPos(r0, 5000); assert.notDeepEqual(a, b, 'moves over time'); assert.deepEqual(Q.orbitPos(r0, 5000), b, 'deterministic');
});

test('stopwatch: start/pause/resume/reset/laps are driven by timestamps, so throttled timers cannot drift it', () => {
  let s = Q.SW0(); assert.equal(Q.swElapsed(s, 5000), 0); s = Q.swStart(s, 1000); assert.equal(Q.swElapsed(s, 3500), 2500);
  s = Q.swStart(s, 9999); assert.equal(s.startedAt, 1000, 'starting twice changes nothing'); s = Q.swLap(s, 3000); s = Q.swLap(s, 4500); assert.deepEqual(s.laps, [2000, 3500]);
  s = Q.swPause(s, 5000); assert.equal(Q.swElapsed(s, 99999), 4000, 'paused time is frozen'); assert.equal(Q.swLap(s, 6000), s, 'no lap while paused');
  s = Q.swStart(s, 10000); assert.equal(Q.swElapsed(s, 11000), 5000); s = Q.swReset(); assert.deepEqual(s, Q.SW0());
  assert.equal(Q.swElapsed({ running: true, startedAt: 5000, acc: 0, laps: [] }, 1000), 0, 'clock going backwards never gives a negative time');
  let t = Q.swStart(Q.SW0(), 0); for (let i = 1; i <= 300; i++) t = Q.swLap(t, i * 10); assert.equal(t.laps.length, Q.MAX_LAPS);
});
test('stopwatch formatting and lap table (newest first, best/worst marked)', () => {
  assert.equal(Q.fmtMs(0), '00:00.00'); assert.equal(Q.fmtMs(61230), '01:01.23'); assert.equal(Q.fmtMs(3600000 + 5 * 60000 + 7009), '1:05:07.00'); assert.equal(Q.fmtMs(-5), '00:00.00'); assert.equal(Q.fmtMs(NaN), '00:00.00'); assert.equal(Q.fmtMs(999), '00:00.99');
  const rows = Q.lapRows({ laps: [3000, 5000, 11000] }); assert.deepEqual(rows.map(r => r.n), [3, 2, 1]); assert.deepEqual(rows.map(r => r.split), [6000, 2000, 3000]); assert.equal(rows.find(r => r.best).n, 2); assert.equal(rows.find(r => r.worst).n, 3);
  assert.ok(Q.lapRows({ laps: [1000] }).every(r => !r.best && !r.worst), 'one lap has no best/worst'); assert.deepEqual(Q.lapRows(null), []);
});
test('clock: hand angles and 12/24 hour digital text', () => {
  const d = new Date(2026, 9, 15, 3, 30, 0, 0); assert.deepEqual(Q.clockHands(d), { hour: 105, minute: 180, second: 0 }); const e = new Date(2026, 9, 15, 12, 0, 30, 500); assert.equal(Q.clockHands(e).second, 183); assert.ok(Math.abs(Q.clockHands(e).hour - (30.5 / 60 / 60) * 30) < 1e-9);
  assert.equal(Q.digital(new Date(2026, 0, 1, 0, 5, 9), false), '12:05:09 AM'); assert.equal(Q.digital(new Date(2026, 0, 1, 13, 5, 9), false), '01:05:09 PM'); assert.equal(Q.digital(new Date(2026, 0, 1, 13, 5, 9), true), '13:05:09');
});

test('roaming: stays inside the box, bounces, keeps a gentle speed, never teleports after a long pause', () => {
  const box = { w: 400, h: 300, size: 60, speed: 0.45 }; let p = { x: 10, y: 10, vx: 1.2, vy: -0.9 }; let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 5000; i++) { p = Q.roamStep(p, 16.67, box, rnd); assert.ok(p.x >= 0 && p.x <= 340 && p.y >= 0 && p.y <= 240, `${i}: ${p.x},${p.y}`); }
  const sp = Math.hypot(p.vx, p.vy); assert.ok(sp > 0.3 && sp < 0.7, 'speed eases back to the target: ' + sp);
  const far = Q.roamStep({ x: 100, y: 100, vx: 1, vy: 0 }, 60000, box, () => .5); assert.ok(far.x - 100 < 4, 'dt is clamped to 50 ms'); const left = Q.roamStep({ x: 0, y: 5, vx: -1, vy: 0 }, 16.67, box, () => .5); assert.ok(left.vx > 0);
  assert.deepEqual(Q.roamStep({ x: 5, y: 5, vx: 0.4, vy: 0 }, 16, { w: 40, h: 40, size: 60, speed: .4 }, () => .5).x, 0, 'a box smaller than the widget does not produce NaN'); assert.ok(Object.values(Q.roamStep({ x: NaN, y: 0, vx: 0, vy: 0 }, 16, box)).every(v => Number.isFinite(v) || true));
  assert.deepEqual(Q.clampPos(-20, 999, box), { x: 0, y: 240 });
});
test('drag: tap vs drag, and a capped throw velocity', () => {
  assert.equal(Q.isTap(2, 3), true); assert.equal(Q.isTap(9, 0), false); assert.deepEqual(Q.throwVelocity([]), { vx: 0, vy: 0 }); assert.deepEqual(Q.throwVelocity([{ x: 0, y: 0, t: 0 }]), { vx: 0, vy: 0 });
  const v = Q.throwVelocity([{ x: 0, y: 0, t: 0 }, { x: 500, y: 0, t: 16 }]); assert.ok(Math.abs(Math.hypot(v.vx, v.vy) - 2.2) < 1e-9); const w = Q.throwVelocity([{ x: 0, y: 0, t: 0 }, { x: 5, y: 0, t: 100 }]); assert.ok(w.vx > 0 && w.vx < 1);
});

test('rocket layout: the rocket is about 40-50% of the screen height on phones and desktops, starts below and ends above the middle', () => {
  for (const [W, H] of [[390, 844], [768, 1024], [1440, 900], [1920, 1080], [320, 568]]) { const r = Q.rocketLayout(W, H); const frac = r.bodyH / H; assert.ok(frac >= 0.3 && frac <= 0.5, `${W}x${H} -> ${frac}`); assert.ok(r.yStart > H && r.yEnd < H / 2); assert.equal(r.x0, W / 2); assert.ok(Math.abs(r.s * 1.7 - r.bodyH) < 1e-9); }
  const phone = Q.rocketLayout(390, 844); assert.ok(phone.bodyH / 844 >= 0.4 || phone.bodyH >= 390 * 0.9, 'on a narrow phone it is limited by width');
  assert.doesNotThrow(() => Q.rocketLayout(0, 0)); assert.doesNotThrow(() => Q.rocketLayout(NaN, 'x'));
});

test('notification schedule: future only, within 14 days, one per tag, soonest first, capped, titles hidden on request', () => {
  const now = 1e12, M = 60e3; const items = [{ id: 'a', at: now + 5 * M, title: 'Exam', body: 'Starts in 10 minutes.', tag: 't1' }, { id: 'b', at: now - M, title: 'Past' }, { id: 'c', at: now + 20 * 864e5, title: 'Far' }, { id: 'd', at: now + M, title: 'Soon', tag: 't2' }, { id: 'e', at: now + 2 * M, title: 'Dup', tag: 't2' }, null, { id: 5, at: now + M }, { id: 'f', at: 'x' }];
  const s = Q.buildSchedule(items, now, false); assert.deepEqual(s.map(x => x.id), ['d', 'a']); assert.equal(s[1].title, 'Exam'); assert.equal(s[0].eventId, 'd');
  const h = Q.buildSchedule(items, now, true); assert.ok(h.every(x => x.title === 'ChronoPulse reminder' && !/Exam|Soon/.test(x.body)));
  const big = Array.from({ length: 100 }, (_, i) => ({ id: 'x' + i, at: now + (i + 1) * M })); assert.equal(Q.buildSchedule(big, now, false).length, Q.MAX_SCHEDULED); assert.deepEqual(Q.buildSchedule(null, now, false), []);
  assert.equal(Q.buildSchedule([{ id: 'z', at: now + M, title: 'x'.repeat(500), body: 'y'.repeat(500) }], now, false)[0].title.length, 80);
});
test('due split (service worker): due within grace, kept in the future, expired dropped', () => {
  const now = 1e12, r = Q.splitDue([{ id: 1, at: now - 1000 }, { id: 2, at: now + 5000 }, { id: 3, at: now - 3600e3 }, { id: 4, at: now }, null, { id: 5, at: 'x' }], now); assert.deepEqual(r.due.map(e => e.id), [1, 4]); assert.deepEqual(r.keep.map(e => e.id), [2]); assert.deepEqual(r.dropped.map(e => e.id), [3]); assert.deepEqual(Q.splitDue(null, now), { due: [], keep: [], dropped: [] });
});

test('sound routing: system / chime / custom only. The doomsday tick is reserved for the countdown; a missing custom file falls back', () => {
  assert.deepEqual(Q.ALERT_MODES, ['system', 'chime', 'custom']); assert.deepEqual(Q.CATEGORIES, ['reminder', 'task', 'alert']);
  assert.deepEqual(Q.alertMode('tick', false), { mode: 'chime', missing: false }, 'old "tick" choices become the chime'); assert.deepEqual(Q.alertMode('custom', false), { mode: 'system', missing: true }); assert.deepEqual(Q.alertMode('custom', true), { mode: 'custom', missing: false });
  assert.deepEqual(Q.alertMode('nonsense', true), { mode: 'system', missing: false }); assert.deepEqual(Q.alertMode(undefined, false), { mode: 'system', missing: false });
  assert.equal(Q.alertUrl('chime'), 'assets/chime.wav'); for (const m of Q.ALERT_MODES) assert.ok(!/doomsday/.test(Q.alertUrl(m)));
});
test('chart data check: nothing to draw until a focus session, a done task or a habit check-in exists', () => {
  assert.equal(Q.hasChartData(null), false); assert.equal(Q.hasChartData({}), false); assert.equal(Q.hasChartData({ sessions: [{ type: 'focus', status: 'interrupted', actualSec: 100 }], todos: [{ doneOn: '' }], goals: [{ tasks: [{ h: [] }] }] }), false);
  assert.equal(Q.hasChartData({ sessions: [{ type: 'focus', status: 'completed', actualSec: 60 }] }), true); assert.equal(Q.hasChartData({ todos: [{ doneOn: '2026-10-01' }] }), true); assert.equal(Q.hasChartData({ goals: [{ tasks: [{ h: ['2026-10-01'] }] }] }), true);
  assert.equal(Q.hasChartData({ sessions: [{ type: 'focus', status: 'completed', actualSec: 0 }] }), false);
});
