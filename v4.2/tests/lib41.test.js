'use strict';
/* Characterization + migration tests for lib/lib41.js (storage, schema 6 -> 7, safety copies, backup/restore, focus engine, CSV). */
const test = require('node:test'), assert = require('node:assert/strict');
const P = require('../lib/lib41.js');
const mem = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; }, _m: m }; };
const NOW = new Date(2030, 0, 15, 12, 0, 0).getTime();

/* A realistic schema-6 document, as ChronoPulse 4.1 wrote it. */
const v41 = () => ({
  v: 6, profile: { name: 'Asha', dob: '1990-05-17' },
  events: [{ id: 'e1', title: 'Exam', at: '2031-03-01T09:00', desc: 'Hall 4', start: 1700000000000 }, { id: 'e2', title: 'Trip', at: '2029-01-01T00:00', desc: '', start: 1600000000000 }],
  active: 'e1', goals: [{ id: 'g1', title: 'Fit', category: 'health', desc: '', target: '2031-01-01', tasks: [{ id: 'h1', name: 'Run', created: '2030-01-01', h: ['2030-01-10', '2030-01-11'] }] }],
  diff: { a: '2030-01-01', b: '2030-02-01' }, sound: false,
  cfg: { focusMin: 30, shortMin: 5, longMin: 15, longEvery: 4, auto: false, chime: true, notify: true, breakRemind: true },
  todos: [{ id: 't1', title: 'Buy book', desc: '', due: '2030-02-01', created: '2030-01-01', doneOn: '', doneAt: 0, habit: '', via: false, remind: '', reminded: false }],
  sessions: [{ id: 's1', type: 'focus', status: 'completed', startedAt: 1700000000000, endedAt: 1700001800000, plannedSec: 1800, actualSec: 1800, day: '2023-11-14', todoId: '', habitId: '', label: '' }],
  timer: null, meta: { schema: 6, appVersion: '4.1.0', migratedFrom: null, migratedAt: '' }
});

test('version constants: schema 7, app 4.2.5, data key unchanged', () => {
  assert.equal(P.SCHEMA, 7); assert.equal(P.APP_VERSION, '4.2.5'); assert.equal(P.KEY, 'chronopulse:v4.1'); assert.equal(P.PRE42, 'chronopulse:v4.1:pre42'); assert.notEqual(P.PRE42, P.PRE41);
});
test('fresh storage loads an empty valid state', () => {
  const r = P.loadState(mem(), NOW); assert.equal(r.status, 'fresh'); assert.equal(r.state.events.length, 0); assert.equal(r.state.v, 7);
});
test('unavailable storage never throws', () => {
  const bad = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const r = P.loadState(bad, NOW); assert.equal(r.status, 'unavailable'); assert.ok(r.notes.length); assert.deepEqual(P.saveState(bad, r.state), { ok: false, reason: 'unavailable' });
});
test('save/load round trip keeps data and reports ok', () => {
  const st = mem(), S = P.sanitize41(v41(), { now: NOW }); assert.ok(P.saveState(st, S).ok);
  const r = P.loadState(st, NOW); assert.equal(r.status, 'ok'); assert.equal(r.state.events.length, 2); assert.equal(r.state.sessions.length, 1);
});
test('quota errors are reported as quota', () => {
  const full = { setItem() { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; } };
  assert.deepEqual(P.saveState(full, P.sanitize41(null)), { ok: false, reason: 'quota' });
});
test('corrupt data is kept under a recovery key, never silently erased', () => {
  const st = mem(); st.setItem(P.KEY, '{not json'); const r = P.loadState(st, 1234);
  assert.equal(r.status, 'recovered'); assert.equal(st.getItem(P.CORRUPT + ':1234'), '{not json');
});

test('MIGRATION 6 -> 7: every 4.1 record survives unchanged', () => {
  const st = mem(), orig = v41(); st.setItem(P.KEY, JSON.stringify(orig));
  const r = P.loadState(st, NOW); assert.equal(r.status, 'migrated'); const s = r.state;
  assert.equal(s.v, 7); assert.equal(s.meta.schema, 7); assert.equal(s.meta.appVersion, '4.2.5'); assert.equal(s.meta.migratedFrom, 6);
  assert.deepEqual(s.profile, orig.profile); assert.equal(s.active, 'e1'); assert.equal(s.sound, false); assert.deepEqual(s.diff, orig.diff);
  assert.deepEqual(s.events.map(({ completed, reminders, fired, armed, ...e }) => e), orig.events); assert.deepEqual(s.events.map(e => e.completed), ['', '']);
  assert.deepEqual(s.events.map(e => e.armed), [false, false], 'migrated events are armed later, once, by the app'); assert.deepEqual(s.events[0].reminders, { d1: false, h1: true, m10: false, m1: false, end: true }); assert.deepEqual(s.events[0].fired, {});
  assert.deepEqual(s.goals, orig.goals); assert.deepEqual(s.todos, orig.todos); assert.deepEqual(s.sessions, orig.sessions); assert.equal(s.cfg.focusMin, 30); assert.equal(s.cfg.notify, true);
  assert.equal(JSON.parse(st.getItem(P.KEY)).meta.schema, 7, 'upgraded copy is persisted');
});
test('MIGRATION 6 -> 7: an exact safety copy of the 4.1 data is stored under PRE42', () => {
  const st = mem(), text = JSON.stringify(v41()); st.setItem(P.KEY, text); P.loadState(st, NOW);
  assert.equal(st.getItem(P.PRE42), text);
});
test('MIGRATION 6 -> 7: an older PRE41 copy is never overwritten, and an existing PRE42 is kept', () => {
  const st = mem(); st.setItem(P.PRE41, 'OLD-PRE41'); st.setItem(P.PRE42, 'OLD-PRE42'); st.setItem(P.KEY, JSON.stringify(v41())); P.loadState(st, NOW);
  assert.equal(st.getItem(P.PRE41), 'OLD-PRE41'); assert.equal(st.getItem(P.PRE42), 'OLD-PRE42');
  const st2 = mem(); st2.setItem(P.PRE41, 'OLD-PRE41'); const text = JSON.stringify(v41()); st2.setItem(P.KEY, text); P.loadState(st2, NOW);
  assert.equal(st2.getItem(P.PRE41), 'OLD-PRE41'); assert.equal(st2.getItem(P.PRE42), text, 'a pre-existing PRE41 must not stop the 4.2 safety copy');
});
test('MIGRATION from an older schema keeps using the PRE41 key', () => {
  const st = mem(), d = v41(); d.meta.schema = 5; d.v = 5; const text = JSON.stringify(d); st.setItem(P.KEY, text); P.loadState(st, NOW);
  assert.equal(st.getItem(P.PRE41), text); assert.equal(st.getItem(P.PRE42), null);
});
test('MIGRATION: if the safety copy cannot be written, stored data is NOT rewritten', () => {
  const st = mem(), text = JSON.stringify(v41()); st.setItem(P.KEY, text);
  const guarded = { getItem: k => st.getItem(k), setItem: (k, v) => { if (k === P.PRE42) throw new Error('quota'); st.setItem(k, v); } };
  const r = P.loadState(guarded, NOW); assert.equal(r.status, 'migrated'); assert.ok(r.notes.some(n => /safety copy/i.test(n)));
  assert.equal(st.getItem(P.KEY), text, 'original data untouched'); assert.equal(r.state.events.length, 2, 'still usable in memory');
});
test('already-current (schema 7) data loads as ok and writes no safety copies', () => {
  const st = mem(); P.saveState(st, P.sanitize41(v41(), { now: NOW })); const keys = Object.keys(st._m).length;
  const r = P.loadState(st, NOW); assert.equal(r.status, 'ok'); assert.equal(Object.keys(st._m).length, keys);
});
test('loading is idempotent: migrating twice equals migrating once', () => {
  const st = mem(); st.setItem(P.KEY, JSON.stringify(v41())); const a = P.loadState(st, NOW).state, b = P.loadState(st, NOW).state;
  assert.deepEqual(a.events, b.events); assert.deepEqual(a.goals, b.goals); assert.deepEqual(a.sessions, b.sessions);
});
test('4.2 data is stored under the same key, keeping 4.1 rollback possible', () => {
  const st = mem(); st.setItem(P.KEY, JSON.stringify(v41())); P.loadState(st, NOW);
  const saved = JSON.parse(st.getItem(P.KEY)); for (const k of ['profile', 'events', 'goals', 'todos', 'sessions', 'cfg', 'diff']) assert.ok(k in saved, k);
});

test('backup: 4.1-era (schema 6) backups import into 4.2', () => {
  const b = { format: 'chronopulse-backup', app: 'ChronoPulse', appVersion: '4.1.0', schemaVersion: 6, exportedAt: new Date(NOW).toISOString(), data: v41() };
  const v = P.validateBackup(JSON.parse(JSON.stringify(b)), NOW); assert.ok(v.ok); assert.equal(v.summary.events, 2); assert.equal(v.summary.sessions, 1);
});
test('backup: rejects non-backups, future schemas and junk without throwing', () => {
  assert.ok(!P.validateBackup({ foo: 1 }).ok); assert.ok(!P.validateBackup(null).ok); assert.ok(!P.validateBackup([]).ok); assert.ok(!P.validateBackup('x').ok);
  assert.ok(!P.validateBackup({ format: 'chronopulse-backup', schemaVersion: 99, data: {} }).ok); assert.ok(!P.validateBackup({ format: 'chronopulse-backup', schemaVersion: 7, data: 5 }).ok);
});
test('backup: invalid records inside a valid file are dropped and counted', () => {
  const d = v41(); d.events.push({ id: 'bad', title: 'x', at: 'nope' }); d.sessions.push({ id: 'bad' });
  const v = P.validateBackup({ format: 'chronopulse-backup', schemaVersion: 6, data: d }, NOW); assert.ok(v.ok); assert.equal(v.summary.dropped, 2);
});
test('backup: export never includes the device-specific running timer', () => {
  const S = P.sanitize41(v41(), { now: NOW }); assert.ok(!('timer' in P.makeBackup(S).data));
});
test('merge never duplicates events/sessions and keeps local completion state', () => {
  const L = P.sanitize41(v41(), { now: NOW }); L.events[1].completed = L.events[1].at;
  const I = P.sanitize41(v41(), { now: NOW }); const M = P.mergeStates(L, I, NOW);
  assert.equal(M.events.length, 2); assert.equal(M.sessions.length, 1); assert.equal(M.events[1].completed, M.events[1].at);
});

test('focus timer is deadline based and completes exactly once', () => {
  const cfg = P.cfgOf({}), t = P.tStart(P.idle(cfg), 0, 's1');
  assert.equal(P.remaining(t, 60000), cfg.focusMin * 60000 - 60000);
  const r = P.tick(t, cfg, cfg.focusMin * 60000 + 10, () => 'n'); assert.equal(r.session.status, 'completed');
  assert.equal(P.tick(r.timer, cfg, cfg.focusMin * 60000 + 20, () => 'n').session, undefined);
});
test('a focus deadline missed by more than 6 hours is recorded as interrupted, not completed', () => {
  const cfg = P.cfgOf({}), t = P.tStart(P.idle(cfg), 0, 's1');
  assert.equal(P.tick(t, cfg, cfg.focusMin * 60000 + P.STALE_MS + 5, () => 'n').session.status, 'interrupted');
});
test('CSV cells neutralize spreadsheet formulas', () => {
  assert.equal(P.csvCell('=1+1'), "'=1+1"); assert.equal(P.csvCell('a,b'), '"a,b"'); assert.equal(P.csvCell(null), '');
});
test('4.2 config: hideTitles defaults to false and accepts only booleans', () => {
  assert.equal(P.cfgOf({}).hideTitles, false); assert.equal(P.cfgOf({ hideTitles: true }).hideTitles, true); assert.equal(P.cfgOf({ hideTitles: 'yes' }).hideTitles, false); assert.equal(P.cfgOf(null).hideTitles, false);
});
test('4.2 backups keep reminder choices and fired marks; 4.1-era backups get safe defaults', () => {
  const at = '2031-03-01T09:00', S = P.sanitize41(v41(), { now: NOW }); S.events[0].reminders = { d1: true, h1: false, m10: true, m1: false, end: false }; S.events[0].fired = { d1: at }; S.events[0].armed = true;
  const v = P.validateBackup(JSON.parse(JSON.stringify(P.makeBackup(S))), NOW); assert.ok(v.ok);
  assert.deepEqual(v.state.events[0].reminders, { d1: true, h1: false, m10: true, m1: false, end: false }); assert.deepEqual(v.state.events[0].fired, { d1: at }); assert.equal(v.state.events[0].armed, true);
  const old = P.validateBackup({ format: 'chronopulse-backup', schemaVersion: 6, data: v41() }, NOW); assert.deepEqual(old.state.events[0].reminders, { d1: false, h1: true, m10: false, m1: false, end: true }); assert.equal(old.state.events[0].armed, false);
});
test('4.2 backups: a tampered reminders/fired block cannot inject anything', () => {
  const d = v41(); d.events[0].reminders = { h1: { evil: 1 }, '__proto__': { polluted: true }, d1: 'true' }; d.events[0].fired = { h1: ['x'], constructor: 'x' };
  const v = P.validateBackup({ format: 'chronopulse-backup', schemaVersion: 6, data: d }, NOW); assert.ok(v.ok);
  assert.deepEqual(v.state.events[0].reminders, { d1: false, h1: true, m10: false, m1: false, end: true }); assert.deepEqual(v.state.events[0].fired, {}); assert.equal({}.polluted, undefined);
});
