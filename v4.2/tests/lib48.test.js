'use strict';
/* lib/lib48.js: PulseShift date / time / date+time offset maths. Pure Node. Tests are timezone-independent (they build local Dates) and also run under TZ=America/New_York and Asia/Kolkata. */
const test = require('node:test'), assert = require('node:assert/strict');
const P = require('../lib/lib48.js');
const S = (mode, base, direction, offsets) => P.shift({ mode, base, direction, offsets });

test('modes, input types and the fields each mode exposes', () => {
  assert.deepEqual(P.MODES, ['date', 'time', 'datetime']); assert.deepEqual(P.DIRS, ['past', 'future']);
  assert.deepEqual(['date', 'time', 'datetime'].map(P.inputType), ['date', 'time', 'datetime-local']);
  assert.deepEqual(P.fieldsOf('date'), ['days']); assert.deepEqual(P.fieldsOf('time'), ['hours', 'minutes', 'seconds']); assert.deepEqual(P.fieldsOf('datetime'), ['days', 'hours', 'minutes']);
  assert.equal(P.modeOf('nonsense'), 'date'); assert.equal(P.dirOf(undefined), 'future'); assert.equal(P.inputType('x'), 'date');
});
test('clampN: whole numbers 0..999999; blanks, junk, negatives and decimals are tamed', () => {
  assert.deepEqual(['', null, undefined, 'abc', NaN, -5, '-3', Infinity].map(v => P.clampN(v)), [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(P.clampN('12'), 12); assert.equal(P.clampN(7.9), 7); assert.equal(P.clampN(1e12), P.MAX);
});
test('date mode: month ends, year ends and both directions', () => {
  assert.equal(S('date', '2025-01-31', 'future', { days: 1 }).value, '2025-02-01');
  assert.equal(S('date', '2025-12-31', 'future', { days: 1 }).value, '2026-01-01');
  assert.equal(S('date', '2026-01-01', 'past', { days: 1 }).value, '2025-12-31');
  assert.equal(S('date', '2025-03-01', 'past', { days: 1 }).value, '2025-02-28');
  assert.equal(S('date', '2025-06-15', 'future', { days: 0 }).value, '2025-06-15');
  assert.equal(S('date', '2025-06-15', 'future', { days: 365 }).value, '2026-06-15');
  assert.equal(S('date', '2025-06-15', 'past', { days: 10000 }).value, '1998-01-28');
});
test('date mode: leap years (2024 and 2000 are leap, 1900 and 2100 are not)', () => {
  assert.equal(S('date', '2024-02-28', 'future', { days: 1 }).value, '2024-02-29'); assert.equal(S('date', '2024-02-28', 'future', { days: 2 }).value, '2024-03-01');
  assert.equal(S('date', '2023-02-28', 'future', { days: 1 }).value, '2023-03-01'); assert.equal(S('date', '2000-02-28', 'future', { days: 1 }).value, '2000-02-29');
  assert.equal(S('date', '2100-02-28', 'future', { days: 1 }).value, '2100-03-01'); assert.equal(S('date', '2024-03-01', 'past', { days: 1 }).value, '2024-02-29');
  assert.equal(S('date', '2024-02-29', 'future', { days: 366 }).value, '2025-03-01');
  assert.equal(P.parseDate('2023-02-29'), null); assert.equal(P.parseDate('2024-02-29').d, 29); assert.equal(P.parseDate('2100-02-29'), null);
});
test('date mode output text, summary and day delta', () => {
  const r = S('date', '2025-01-31', 'future', { days: 1 }); assert.equal(r.main, 'Sat, 1 Feb 2025'); assert.equal(r.sub, '2025-02-01'); assert.equal(r.summary, '+ 1 day'); assert.equal(r.dayDelta, 1); assert.equal(r.copy, 'Sat, 1 Feb 2025 (2025-02-01)');
  const q = S('date', '2025-01-31', 'past', { days: 30 }); assert.equal(q.summary, '− 30 days'); assert.equal(q.dayDelta, -30); assert.equal(q.value, '2025-01-01');
  const z = S('date', '2025-01-31', 'future', { days: 0 }); assert.equal(z.zero, true); assert.equal(z.summary, 'No offset'); assert.equal(z.value, '2025-01-31');
});
test('time mode: wraps around midnight and reports how many days it rolled', () => {
  let r = S('time', '23:30', 'future', { hours: 1 }); assert.equal(r.value, '00:30:00'); assert.equal(r.dayDelta, 1); assert.match(r.sub, /\+1 day$/);
  r = S('time', '00:15', 'past', { minutes: 30 }); assert.equal(r.value, '23:45:00'); assert.equal(r.dayDelta, -1); assert.match(r.sub, /−1 day$/);
  r = S('time', '10:00:00', 'future', { hours: 1, minutes: 2, seconds: 3 }); assert.equal(r.value, '11:02:03'); assert.equal(r.dayDelta, 0); assert.equal(r.sub, '11:02:03'); assert.equal(r.main, '11:02:03 AM'); assert.equal(r.summary, '+ 1 hour, 2 minutes, 3 seconds');
  r = S('time', '12:00', 'future', { hours: 60 }); assert.equal(r.value, '00:00:00'); assert.equal(r.dayDelta, 3); assert.match(r.sub, /\+3 days$/);
  r = S('time', '12:00', 'past', { seconds: 1 }); assert.equal(r.value, '11:59:59'); assert.equal(r.main, '11:59:59 AM');
  assert.equal(S('time', '00:00', 'future', { seconds: 0 }).main, '12:00:00 AM'); assert.equal(S('time', '12:30', 'future', {}).main, '12:30:00 PM');
});
test('date+time mode: carries across day, month, year and leap-day boundaries', () => {
  let r = S('datetime', '2025-12-31T23:30', 'future', { hours: 1 }); assert.equal(r.value, '2026-01-01T00:30'); assert.equal(r.dayDelta, 1);
  r = S('datetime', '2024-02-28T23:59', 'future', { minutes: 1 }); assert.equal(r.value, '2024-02-29T00:00');
  r = S('datetime', '2025-03-01T00:10', 'past', { minutes: 20 }); assert.equal(r.value, '2025-02-28T23:50'); assert.equal(r.dayDelta, -1);
  r = S('datetime', '2025-01-31T09:00', 'future', { days: 1, hours: 15, minutes: 30 }); assert.equal(r.value, '2025-02-02T00:30'); assert.equal(r.dayDelta, 2);
  r = S('datetime', '2025-06-15T08:05', 'future', { days: 0, hours: 0, minutes: 0 }); assert.equal(r.value, '2025-06-15T08:05'); assert.equal(r.zero, true);
  r = S('datetime', '2025-06-15T14:05', 'future', { days: 2, hours: 1 }); assert.equal(r.main, 'Tue, 17 Jun 2025, 3:05 PM'); assert.equal(r.sub, '2025-06-17 15:05'); assert.equal(r.copy, 'Tue, 17 Jun 2025, 3:05 PM (2025-06-17 15:05)'); assert.equal(r.summary, '+ 2 days, 1 hour');
});
test('date+time mode: a whole-day shift keeps the wall-clock time (DST-safe) because days are added on the calendar', () => {
  const r = S('datetime', '2025-03-08T12:00', 'future', { days: 1 }); assert.equal(r.value, '2025-03-09T12:00', 'US DST starts on 9 March 2025; noon stays noon');
  const q = S('datetime', '2025-11-02T12:00', 'past', { days: 1 }); assert.equal(q.value, '2025-11-01T12:00');
  const y = S('date', '2025-03-08', 'future', { days: 1 }); assert.equal(y.value, '2025-03-09'); assert.equal(S('date', '2025-10-25', 'future', { days: 1 }).value, '2025-10-26');
});
test('invalid or missing base values are rejected with reason "base"; nothing throws on junk input', () => {
  for (const [m, b] of [['date', ''], ['date', '2025-02-30'], ['date', '2025-13-01'], ['date', 'tomorrow'], ['date', '0999-01-01'], ['time', ''], ['time', '24:00'], ['time', '12:60'], ['time', '12:00:61'], ['datetime', ''], ['datetime', '2025-01-01'], ['datetime', '2025-01-01T25:00'], ['datetime', '2025-02-30T10:00']]) { const r = S(m, b, 'future', { days: 1, hours: 1 }); assert.deepEqual([r.ok, r.reason], [false, 'base'], m + ' ' + b); }
  for (const junk of [null, undefined, 5, 'x', [], {}]) assert.doesNotThrow(() => P.shift(junk)); assert.equal(P.shift(null).ok, false);
  assert.equal(S('date', '2025-01-01', 'sideways', { days: 1 }).value, '2025-01-02', 'unknown direction falls back to future'); assert.equal(S('weird', '2025-01-01', 'future', { days: 1 }).mode, 'date');
  assert.equal(S('date', '2025-01-01', 'future', { days: -4 }).value, '2025-01-01', 'negative steppers are clamped to 0, direction is chosen only by the toggle');
  assert.equal(S('date', '2025-01-01', 'future', { days: 'abc' }).value, '2025-01-01');
});
test('out-of-range results (outside years 1000-9999) are reported as "range", never as a wrong date', () => {
  assert.deepEqual([S('date', '9999-12-31', 'future', { days: 1 })].map(r => [r.ok, r.reason])[0], [false, 'range']);
  assert.equal(S('date', '1000-01-01', 'past', { days: 1 }).reason, 'range'); assert.equal(S('date', '2025-01-01', 'future', { days: 999999 }).ok, true);
  assert.equal(S('date', '2025-01-01', 'past', { days: 999999 }).reason, 'range'); assert.equal(S('datetime', '9999-12-31T23:59', 'future', { minutes: 1 }).reason, 'range');
});
test('offsets only keep the fields that belong to the active mode', () => {
  assert.deepEqual(P.normOffsets('date', { days: 3, hours: 9 }), { days: 3 }); assert.deepEqual(P.normOffsets('time', { days: 3, hours: 9 }), { hours: 9, minutes: 0, seconds: 0 }); assert.deepEqual(P.normOffsets('datetime', { days: 1, hours: 2, minutes: 3, seconds: 4 }), { days: 1, hours: 2, minutes: 3 });
  assert.equal(S('date', '2025-01-01', 'future', { days: 1, hours: 99 }).value, '2025-01-02', 'hours are ignored in date mode'); assert.equal(S('datetime', '2025-01-01T00:00', 'future', { seconds: 99 }).value, '2025-01-01T00:00', 'seconds are ignored in date+time mode');
});
test('nowValue fills the base field in the format each <input> type expects and round-trips through the parsers', () => {
  const d = new Date(2025, 4, 9, 7, 3, 5); assert.equal(P.nowValue('date', d), '2025-05-09'); assert.equal(P.nowValue('time', d), '07:03:05'); assert.equal(P.nowValue('datetime', d), '2025-05-09T07:03');
  assert.ok(P.parseDate(P.nowValue('date', d)) && P.parseTime(P.nowValue('time', d)) && P.parseDateTime(P.nowValue('datetime', d)));
  assert.ok(P.parseTime('07:03:05.123')); assert.ok(P.parseDateTime('2025-05-09T07:03:05'));
});
test('result.date is a real Date and the shift is symmetric: +N then −N returns to the start', () => {
  for (const [m, b, o] of [['date', '2024-02-29', { days: 400 }], ['datetime', '2025-12-31T23:59', { days: 40, hours: 30, minutes: 61 }], ['time', '03:04:05', { hours: 99, minutes: 99, seconds: 99 }]]) {
    const f = S(m, b, 'future', o), back = S(m, f.value, 'past', o); assert.ok(f.date instanceof Date); const norm = m === 'time' ? b + (b.length === 5 ? ':00' : '') : b; assert.equal(back.value, norm, m);
  }
});
