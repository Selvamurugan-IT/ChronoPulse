'use strict';
/* Characterization tests for lib/lib.js (4.0 calculation + validation logic) plus the 4.2 `completed` event field. */
const test = require('node:test'), assert = require('node:assert/strict');
const C = require('../lib/lib.js');

test('isKey accepts real dates and rejects impossible ones', () => {
  assert.ok(C.isKey('2030-02-28')); assert.ok(C.isKey('2032-02-29'));
  assert.ok(!C.isKey('2030-02-30')); assert.ok(!C.isKey('2030-13-01')); assert.ok(!C.isKey('1899-12-31')); assert.ok(!C.isKey('2030-1-1')); assert.ok(!C.isKey(null));
});
test('addMonthsKey clamps to the last day of the month', () => {
  assert.equal(C.addMonthsKey('2031-01-31', 1), '2031-02-28'); assert.equal(C.addMonthsKey('2032-01-31', 1), '2032-02-29'); assert.equal(C.addMonthsKey('2030-12-15', 1), '2031-01-15');
});
test('dateDiff counts calendar days and swaps reversed input', () => {
  const d = C.dateDiff('2030-01-01', '2030-01-31'); assert.equal(d.totalDays, 30); assert.equal(d.swapped, false);
  assert.equal(C.dateDiff('2030-01-31', '2030-01-01').swapped, true); assert.equal(C.dateDiff('bad', '2030-01-01'), null);
});
test('nextBirthday handles Feb 29 in non-leap years and "today"', () => {
  assert.equal(C.nextBirthday('2000-02-29', '2031-01-10').key, '2031-02-28');
  const t = C.nextBirthday('1990-06-15', '2030-06-15'); assert.ok(t.today); assert.equal(t.inDays, 0);
});
test('countdownParts returns zeros once the target has passed', () => {
  const p = C.countdownParts(new Date(2030, 0, 2), new Date(2030, 0, 1)); assert.deepEqual(p, { months: 0, days: 0, h: 0, mi: 0, s: 0, ms: 0 });
});
test('countdownParts splits months, days, hours, minutes, seconds, milliseconds', () => {
  const p = C.countdownParts(new Date(2030, 0, 1, 0, 0, 0, 0), new Date(2030, 1, 2, 3, 4, 5, 6));
  assert.deepEqual(p, { months: 1, days: 1, h: 3, mi: 4, s: 5, ms: 6 });
});
test('streaks: today unchecked does not break a running streak', () => {
  const h = ['2030-01-08', '2030-01-09', '2030-01-10']; assert.equal(C.currentStreak(h, '2030-01-11'), 3); assert.equal(C.currentStreak(h, '2030-01-12'), 0); assert.equal(C.longestStreak(h), 3);
});
test('sanitize drops malformed events and normalizes date-only targets', () => {
  const S = C.sanitize({ events: [{ id: 'a', title: 'Ok', at: '2030-01-01' }, { id: 'b', title: '', at: '2030-01-01' }, { id: 'c', title: 'Bad', at: 'nope' }, null] });
  assert.equal(S.events.length, 1); assert.equal(S.events[0].at, '2030-01-01T00:00');
});
test('sanitize gives duplicate event ids unique ids and never throws on junk', () => {
  const S = C.sanitize({ events: [{ id: 'a', title: 'One', at: '2030-01-01T10:00' }, { id: 'a', title: 'Two', at: '2030-01-02T10:00' }] });
  assert.equal(new Set(S.events.map(e => e.id)).size, 2);
  for (const junk of [null, undefined, 5, 'x', [], { events: 'x' }]) assert.doesNotThrow(() => C.sanitize(junk));
});
test('sanitize clips over-long text', () => {
  const S = C.sanitize({ events: [{ id: 'a', title: 'x'.repeat(200), at: '2030-01-01T10:00', desc: 'y'.repeat(999) }] });
  assert.equal(S.events[0].title.length, 60); assert.equal(S.events[0].desc.length, 240);
});
test('4.2: completed is kept only when it equals the event target string', () => {
  const S = C.sanitize({ events: [
    { id: 'a', title: 'Done', at: '2030-01-01T10:00', completed: '2030-01-01T10:00' },
    { id: 'b', title: 'Edited later', at: '2030-01-02T10:00', completed: '2030-01-01T10:00' },
    { id: 'c', title: 'Never', at: '2030-01-03T10:00' },
    { id: 'd', title: 'Junk', at: '2030-01-04T10:00', completed: true }] });
  assert.deepEqual(S.events.map(e => e.completed), ['2030-01-01T10:00', '', '', '']);
});
test('4.2: a date-only target and its completed flag normalize consistently', () => {
  const S = C.sanitize({ events: [{ id: 'a', title: 'Day', at: '2030-01-01', completed: '2030-01-01T00:00' }] });
  assert.equal(S.events[0].completed, '2030-01-01T00:00');
});
test('4.2 reminders: sanitize fills defaults, keeps valid choices, and drops junk', () => {
  const S = C.sanitize({ events: [{ id: 'a', title: 'T', at: '2030-01-01T10:00', reminders: { d1: true, h1: false, m1: 'x', zzz: true } }, { id: 'b', title: 'U', at: '2030-01-01T11:00' }] });
  assert.deepEqual(S.events[0].reminders, { d1: true, h1: false, m10: false, m1: false, end: true }); assert.deepEqual(S.events[1].reminders, C.normReminders(null));
  assert.ok(Object.keys(S.events[0].reminders).every(k => C.RKEYS.includes(k)));
});
test('4.2 reminders: fired marks are kept only for the current target string; armed must be literally true', () => {
  const at = '2030-01-01T10:00', S = C.sanitize({ events: [
    { id: 'a', title: 'T', at, fired: { h1: at, m1: '2029-01-01T10:00', end: true, zzz: at }, armed: true },
    { id: 'b', title: 'U', at, armed: 'yes' }, { id: 'c', title: 'V', at, fired: 'bad' }] });
  assert.deepEqual(S.events[0].fired, { h1: at }); assert.equal(S.events[0].armed, true); assert.equal(S.events[1].armed, false); assert.deepEqual(S.events[2].fired, {});
});
