'use strict';
/* Tests for lib/lib42.js: timestamp-based countdown math, phases, and durable completion/reconciliation. */
const test = require('node:test'), assert = require('node:assert/strict');
const K = require('../lib/lib42.js'), P = require('../lib/lib41.js');
const at = (y, mo, d, h = 0, mi = 0) => `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
const ms = (y, mo, d, h = 0, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();
const ev = (id, a, extra = {}) => ({ id, title: 'Event ' + id, at: a, desc: '', start: 0, completed: '', ...extra });

test('targetMs parses valid local targets and rejects invalid ones', () => {
  assert.equal(K.targetMs('2030-06-15T10:30'), ms(2030, 6, 15, 10, 30));
  for (const bad of ['', 'abc', null, undefined, 123, {}, '2030-02-30T10:00', '2030-13-01T00:00', '2030-00-10T00:00', '2030-01-01T24:00', '2030-01-01T10:60', '1899-12-31T00:00', '2030-01-01', '2030-01-01T10:00:00'])
    assert.equal(K.targetMs(bad), null, 'should be invalid: ' + String(bad));
});
test('remainingMs is derived from the target and the clock only', () => {
  const t = at(2030, 1, 1, 12); const base = ms(2030, 1, 1, 11);
  assert.equal(K.remainingMs(t, base), 3600e3);
  assert.equal(K.remainingMs(t, base + 1500), 3600e3 - 1500);
});
test('remainingMs does not drift: a thousand intermediate calls change nothing', () => {
  const t = at(2030, 1, 1, 12); const later = ms(2030, 1, 1, 11, 30);
  const direct = K.remainingMs(t, later);
  for (let i = 0; i < 1000; i++) K.remainingMs(t, ms(2030, 1, 1, 11) + i * 1800);
  assert.equal(K.remainingMs(t, later), direct); assert.equal(direct, 1800e3);
});
test('after a long pause (suspended/throttled app) the very next calculation is exact', () => {
  const t = at(2030, 1, 1, 12); assert.equal(K.remainingMs(t, ms(2030, 1, 1, 9)), 3 * 3600e3); /* last tick */
  assert.equal(K.remainingMs(t, ms(2030, 1, 1, 11, 59, 30)), 30e3); /* first tick after resuming */
});
test('remainingMs is never negative and handles invalid input', () => {
  assert.equal(K.remainingMs(at(2020, 1, 1), ms(2030, 1, 1)), 0);
  assert.equal(K.remainingMs('garbage', 1), null); assert.equal(K.remainingMs(at(2030, 1, 1), NaN), null); assert.equal(K.remainingMs(at(2030, 1, 1), undefined), null);
});
test('phase boundaries: upcoming / final-minute / final-10 / done / invalid', () => {
  const t = at(2030, 1, 1, 12), z = ms(2030, 1, 1, 12);
  assert.equal(K.phase(t, z - 61e3), 'upcoming'); assert.equal(K.phase(t, z - 60e3), 'final-minute'); assert.equal(K.phase(t, z - 10001), 'final-minute');
  assert.equal(K.phase(t, z - 10e3), 'final-10'); assert.equal(K.phase(t, z - 1), 'final-10'); assert.equal(K.phase(t, z), 'done'); assert.equal(K.phase(t, z + 5e3), 'done');
  assert.equal(K.phase('nope', z), 'invalid');
});
test('isCompleted requires completed to equal the current target string', () => {
  assert.ok(K.isCompleted(ev('a', at(2020, 1, 1), { completed: at(2020, 1, 1) })));
  assert.ok(!K.isCompleted(ev('a', at(2020, 1, 1)))); assert.ok(!K.isCompleted(ev('a', at(2020, 1, 2), { completed: at(2020, 1, 1) })));
  assert.ok(!K.isCompleted(null)); assert.ok(!K.isCompleted({ at: 'x' }));
});
test('reconcile completes a passed event exactly once (duplicate prevention)', () => {
  const e = ev('a', at(2030, 1, 1, 12)), now = ms(2030, 1, 1, 12, 0, 5);
  const r1 = K.reconcile([e], now); assert.equal(r1.completed.length, 1); assert.ok(r1.changed); assert.equal(e.completed, e.at);
  const r2 = K.reconcile([e], now + 1000); assert.equal(r2.completed.length, 0); assert.ok(!r2.changed);
  for (let i = 0; i < 50; i++) assert.equal(K.reconcile([e], now + i * 100).completed.length, 0);
});
test('reconcile leaves future and invalid events alone', () => {
  const f = ev('f', at(2031, 1, 1)), bad = ev('b', 'not a date'), r = K.reconcile([f, bad], ms(2030, 1, 1));
  assert.equal(r.completed.length, 0); assert.equal(f.completed, ''); assert.equal(bad.completed, '');
});
test('reconcile handles several independent events, each once', () => {
  const now = ms(2030, 1, 1, 12), a = ev('a', at(2030, 1, 1, 11)), b = ev('b', at(2030, 1, 1, 11, 59)), c = ev('c', at(2030, 1, 1, 13)), d = ev('d', at(2030, 1, 1, 11));
  const r = K.reconcile([a, b, c, d], now); assert.deepEqual(r.completed.map(x => x.id), ['a', 'b', 'd']); assert.equal(c.completed, '');
  assert.equal(K.reconcile([a, b, c, d], now + 1000).completed.length, 0);
  assert.equal(K.reconcile([a, b, c, d], ms(2030, 1, 1, 13, 0, 1)).completed.map(x => x.id).join(), 'c'); /* c completes later, independently */
});
test('live / away / announce classification', () => {
  const now = ms(2030, 1, 10, 12);
  const r = K.reconcile([ev('just', at(2030, 1, 10, 11, 59)), ev('hour', at(2030, 1, 10, 11)), ev('day', at(2030, 1, 9, 12)), ev('week', at(2030, 1, 3, 12))], now);
  const by = Object.fromEntries(r.completed.map(x => [x.id, x]));
  assert.ok(by.just.live && by.just.announce); assert.ok(!by.hour.live && by.hour.announce); assert.ok(by.day.announce, 'exactly 24 h ago is still announced');
  assert.ok(!by.week.live && !by.week.announce, 'old events are recorded silently'); assert.equal(by.hour.late, 3600e3); /* 11:59 is exactly 60 s ago = the live boundary (inclusive) */
});
test('events completed while the app was closed are reconciled on the next open', () => {
  const e = ev('a', at(2030, 1, 1, 12)); const r = K.reconcile([e], ms(2030, 1, 1, 15));
  assert.equal(r.completed.length, 1); assert.ok(!r.completed[0].live, 'no live celebration for something that finished 3 h ago'); assert.ok(r.completed[0].announce);
});
test('editing the target re-arms the event; restoring the old text does not matter once re-completed', () => {
  const e = ev('a', at(2030, 1, 1, 12)); K.reconcile([e], ms(2030, 1, 1, 12, 1));
  assert.ok(K.isCompleted(e)); e.at = at(2030, 6, 1, 12); assert.ok(!K.isCompleted(e));
  assert.equal(K.reconcile([e], ms(2030, 1, 2)).completed.length, 0, 'new target is still in the future');
  assert.equal(K.reconcile([e], ms(2030, 6, 1, 12, 0, 1)).completed.length, 1, 'completes again for the new target');
});
test('a device clock moved backwards does not re-trigger a completed event', () => {
  const e = ev('a', at(2030, 1, 1, 12)); K.reconcile([e], ms(2030, 1, 1, 12, 0, 1));
  assert.equal(K.reconcile([e], ms(2029, 12, 31)).completed.length, 0); /* clock set back */
  assert.equal(K.reconcile([e], ms(2030, 1, 1, 12, 0, 30)).completed.length, 0); /* clock reaches the target again */
});
test('changing the device timezone does not re-trigger a completed event', () => {
  const old = process.env.TZ;
  try {
    const e = ev('a', at(2030, 1, 1, 12)); K.reconcile([e], ms(2031, 1, 1));
    for (const tz of ['UTC', 'Asia/Kolkata', 'America/Los_Angeles', 'Pacific/Auckland']) { process.env.TZ = tz; assert.equal(K.reconcile([e], Date.now() + 9e12).completed.length, 0, tz); assert.ok(K.isCompleted(e)); }
  } finally { if (old === undefined) delete process.env.TZ; else process.env.TZ = old; }
});
test('reconcile is safe with bad input', () => {
  for (const bad of [null, undefined, 'x', {}, 5]) assert.deepEqual(K.reconcile(bad, 1), { changed: false, completed: [] });
  assert.equal(K.reconcile([null, undefined, 3, {}], 1).completed.length, 0); assert.equal(K.reconcile([ev('a', at(2020, 1, 1))], NaN).completed.length, 0);
});
test('completion state survives save -> reload -> reconcile (no repeat after refresh)', () => {
  const mem = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } }; };
  const st = mem(), now = ms(2030, 1, 1, 12, 0, 5);
  const S = P.sanitize41({ events: [{ id: 'a', title: 'Launch', at: at(2030, 1, 1, 12) }, { id: 'b', title: 'Later', at: at(2031, 1, 1, 12) }] }, { now });
  assert.equal(K.reconcile(S.events, now).completed.length, 1); assert.ok(P.saveState(st, S).ok);
  const L = P.loadState(st, now + 5000); assert.equal(L.status, 'ok');
  assert.equal(L.state.events.find(e => e.id === 'a').completed, at(2030, 1, 1, 12));
  assert.equal(K.reconcile(L.state.events, now + 5000).completed.length, 0, 'refresh must not complete it a second time');
  assert.equal(L.state.events.find(e => e.id === 'b').completed, '');
});
test('a backup keeps completion state, so restoring it does not replay the event', () => {
  const now = ms(2030, 1, 1, 12, 0, 5), S = P.sanitize41({ events: [{ id: 'a', title: 'Launch', at: at(2030, 1, 1, 12) }] }, { now });
  K.reconcile(S.events, now);
  const v = P.validateBackup(JSON.parse(JSON.stringify(P.makeBackup(S))), now); assert.ok(v.ok);
  assert.equal(K.reconcile(v.state.events, now + 1000).completed.length, 0);
});
test('live window is exactly 60 s: 61 s and 5 min ago are not live, 59 s is', () => {
  /* targets are minute-precision, so the clock (`now`) is what moves */
  const r = (a, n) => K.reconcile([ev('x', a)], n).completed[0];
  assert.ok(r(at(2030, 1, 10, 12), ms(2030, 1, 10, 12, 0, 59)).live, '59 s late is live');
  assert.ok(r(at(2030, 1, 10, 12), ms(2030, 1, 10, 12, 1, 0)).live, '60 s late is live (inclusive)');
  assert.ok(!r(at(2030, 1, 10, 12), ms(2030, 1, 10, 12, 1, 1)).live, '61 s late is not live');
  assert.ok(!r(at(2030, 1, 10, 12), ms(2030, 1, 10, 12, 5, 0)).live, '5 min late is not live');
  assert.ok(r(at(2030, 1, 10, 12), ms(2030, 1, 10, 12, 5, 0)).announce, '5 min late is still announced once');
});
test('announce window is exactly 24 h', () => {
  const t = at(2030, 1, 10, 12), r = n => K.reconcile([ev('x', t)], n).completed[0];
  assert.ok(r(ms(2030, 1, 11, 12)).announce); assert.ok(!r(ms(2030, 1, 11, 12, 0, 1)).announce);
});
