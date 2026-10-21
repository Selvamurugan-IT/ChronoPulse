'use strict';
/* Phase 2: reminder engine, notification text, missed-reminder policy and the .ics export (all pure logic in lib/lib42.js). */
const test = require('node:test'), assert = require('node:assert/strict');
const K = require('../lib/lib42.js'), C = require('../lib/lib.js'), P = require('../lib/lib41.js');
const at = (y, mo, d, h = 0, mi = 0) => `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
const ms = (y, mo, d, h = 0, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();
const mk = (id, a, rem = {}, extra = {}) => ({ id, title: 'Event ' + id, at: a, desc: '', start: 0, completed: '', reminders: { d1: true, h1: true, m10: true, m1: true, end: true, ...rem }, fired: {}, armed: false, ...extra });
const armed = (e, now) => { K.armEvent(e, now); return e; };
const mem = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } }; };
const T = at(2030, 6, 15, 12), TM = ms(2030, 6, 15, 12), CREATED = ms(2030, 6, 10, 9); /* created 5 days before */

test('reminder keys: single source of truth, in the specified order, with exact lead times and labels', () => {
  assert.deepEqual(K.REMINDERS.map(r => r.key), C.RKEYS); assert.deepEqual(C.RKEYS, ['d1', 'h1', 'm10', 'm1', 'end']);
  assert.deepEqual(K.REMINDERS.map(r => r.before), [864e5, 36e5, 6e5, 6e4, 0]);
  assert.deepEqual(K.REMINDERS.map(r => r.label), ['24 hours before', '1 hour before', '10 minutes before', '1 minute before', 'At completion']);
});
test('defaults: 1 hour + completion on; junk and non-booleans fall back to defaults', () => {
  assert.deepEqual(C.normReminders(null), { d1: false, h1: true, m10: false, m1: false, end: true });
  assert.deepEqual(C.normReminders({ d1: true, h1: 'yes', m10: 1, junk: true }), { d1: true, h1: true, m10: false, m1: false, end: true });
});
test('triggerMs = target minus lead time (null for invalid events or keys)', () => {
  const e = mk('a', T); assert.equal(K.triggerMs(e, 'h1'), TM - 36e5); assert.equal(K.triggerMs(e, 'end'), TM); assert.equal(K.triggerMs(e, 'nope'), null); assert.equal(K.triggerMs(mk('b', 'bad'), 'h1'), null); assert.equal(K.triggerMs(null, 'h1'), null);
});
for (const r of K.REMINDERS) test(`each reminder fires exactly at its time, not before: ${r.label}`, () => {
  const e = armed(mk('a', T, { d1: false, h1: false, m10: false, m1: false, end: false, [r.key]: true }), CREATED), trig = TM - r.before;
  assert.equal(K.dueReminders([e], trig - 1).fire.length, 0, '1 ms early');
  const out = K.dueReminders([e], trig); assert.equal(out.fire.length, 1); assert.equal(out.fire[0].key, r.key); assert.equal(out.fire[0].kind, 'fire'); assert.equal(out.fire[0].id, 'a');
  assert.equal(K.dueReminders([e], trig + 1000).fire.length, 0, 'never twice');
});
test('disabled reminders never fire and never count as missed', () => {
  const e = armed(mk('a', T, { d1: false, h1: false, m10: false, m1: false, end: false }), CREATED);
  const o = K.dueReminders([e], TM + 5000); assert.deepEqual([o.fire, o.missed, o.changed], [[], [], false]);
});
test('DUPLICATE PREVENTION: polling every second for 26 hours delivers each reminder once', () => {
  const e = armed(mk('a', T), TM - 26 * 36e5), seen = [];
  for (let t = TM - 26 * 36e5; t <= TM + 600e3; t += 1000) for (const f of K.dueReminders([e], t).fire) seen.push(f.key);
  assert.deepEqual(seen, ['d1', 'h1', 'm10', 'm1', 'end']);
});
test('sporadic opening (every 5 min, like a throttled background tab) never duplicates and never exceeds one per reminder', () => {
  const e = armed(mk('a', T), TM - 26 * 36e5), seen = [];
  for (let t = TM - 26 * 36e5; t <= TM + 3600e3; t += 300e3) { const o = K.dueReminders([e], t); for (const f of [...o.fire, ...o.missed]) seen.push(f.key); }
  assert.equal(new Set(seen).size, seen.length, 'no key twice: ' + seen); assert.ok(seen.length <= 5);
});
test('REFRESH: fired state survives save -> reload, so reopening the app does not repeat a reminder', () => {
  const st = mem(), S = P.sanitize41({ events: [mk('a', T)] }, { now: CREATED }); K.arm(S.events, CREATED);
  assert.equal(K.dueReminders(S.events, TM - 36e5 + 5000).fire.length, 1); assert.ok(P.saveState(st, S).ok);
  const L = P.loadState(st, TM - 36e5 + 9000).state;
  assert.equal(L.events[0].fired.h1, T); assert.equal(L.events[0].armed, true);
  assert.equal(K.dueReminders(L.events, TM - 36e5 + 9000).fire.length, 0);
  assert.equal(K.dueReminders(L.events, TM - 6e5 + 1000).fire[0].key, 'm10', 'the next reminder still works after the reload');
});
test('EDIT: a new target time re-arms the reminders (stale fired marks are dropped)', () => {
  const e = armed(mk('a', T), CREATED); K.dueReminders([e], TM - 36e5 + 1000); assert.equal(e.fired.h1, T);
  e.at = at(2030, 6, 20, 12); K.armEvent(e, TM); /* edited later */
  assert.deepEqual(e.fired, {}); const t2 = ms(2030, 6, 20, 12);
  assert.equal(K.dueReminders([e], t2 - 36e5 + 1000).fire[0].key, 'h1', 'fires again for the new time');
});
test('CREATE: reminders whose time had already passed are skipped silently (no stale alerts for a brand-new event)', () => {
  const e = armed(mk('a', at(2030, 6, 15, 12, 30)), ms(2030, 6, 15, 12)); /* created 30 min before */
  assert.deepEqual(Object.keys(e.fired).sort(), ['d1', 'h1']); const o = K.dueReminders([e], ms(2030, 6, 15, 12, 0, 5));
  assert.deepEqual([o.fire, o.missed], [[], []]);
  assert.equal(K.dueReminders([e], ms(2030, 6, 15, 12, 20, 1)).fire[0].key, 'm10');
});
test('TOGGLE ON late: enabling a reminder whose time already passed does not fire or announce it', () => {
  const e = armed(mk('a', T, { d1: false, h1: false, m10: false, m1: false, end: false }), CREATED); /* armed days earlier, everything off: h1's time then passes unnoticed */
  const now = TM - 30 * 60e3; assert.deepEqual(K.dueReminders([e], now), { fire: [], missed: [], changed: false }, 'a disabled reminder is ignored');
  K.setReminder(e, 'h1', true, now);
  const o = K.dueReminders([e], now + 1000); assert.deepEqual([o.fire, o.missed], [[], []]); assert.equal(e.reminders.h1, true); assert.equal(e.fired.h1, T);
  K.setReminder(e, 'm10', false, now); assert.equal(e.reminders.m10, false); assert.equal(K.setReminder(e, 'bogus', true, 0), false);
});
test('toggle ON before the time: it fires normally later', () => {
  const e = armed(mk('a', T, { m10: false }), CREATED); K.setReminder(e, 'm10', true, CREATED);
  assert.equal(K.dueReminders([e], TM - 6e5 + 1).fire[0].key, 'm10');
});
test('events that were never armed do nothing until armed (migrated/imported events cannot burst)', () => {
  const e = mk('a', T); assert.deepEqual(K.dueReminders([e], TM + 1e6), { fire: [], missed: [], changed: false });
  assert.ok(K.arm([e], TM + 1e6)); assert.ok(e.armed); assert.ok(!K.arm([e], TM + 2e6), 'arming is one-time');
  assert.deepEqual(K.dueReminders([e], TM + 1e6).fire, [], 'everything already past was skipped silently');
});
test('LIVE vs MISSED: within 2 minutes is delivered; later is summarized as missed (never delivered as a notification)', () => {
  const trig = TM - 36e5, mkE = () => armed(mk('a', T, { d1: false, m10: false, m1: false, end: false }), CREATED);
  assert.equal(K.dueReminders([mkE()], trig + K.GRACE_MS).fire.length, 1, 'exactly at the grace boundary is still live');
  const o = K.dueReminders([mkE()], trig + K.GRACE_MS + 1); assert.equal(o.fire.length, 0); assert.equal(o.missed.length, 1); assert.equal(o.missed[0].kind, 'missed'); assert.equal(o.missed[0].key, 'h1');
});
test('NO BURST: at most one entry per event per check — the most urgent reminder wins, the rest are marked done silently', () => {
  const e = armed(mk('a', T), CREATED), o = K.dueReminders([e], TM + 30e3); /* m1 (90 s late) and end (30 s late) are both live */
  assert.equal(o.fire.length, 1); assert.equal(o.fire[0].key, 'end'); assert.deepEqual(o.missed, []);
  assert.deepEqual(Object.keys(e.fired).sort(), ['d1', 'end', 'h1', 'm1', 'm10'], 'all five are now marked done, so none can come back later');
  assert.deepEqual(K.dueReminders([e], TM + 40e3), { fire: [], missed: [], changed: false });
});
test('a live reminder suppresses the "missed" summary for older reminders of the same event', () => {
  const e = armed(mk('a', T), CREATED), o = K.dueReminders([e], TM - 6e4 + 10e3); /* m1 live; d1/h1/m10 stale */
  assert.equal(o.fire.length, 1); assert.equal(o.fire[0].key, 'm1'); assert.equal(o.missed.length, 0);
});
test('opening the app much later: ONE missed entry per event (most urgent), and "At completion" is never announced as missed', () => {
  const e = armed(mk('a', T), CREATED), o = K.dueReminders([e], TM + 3600e3);
  assert.equal(o.fire.length, 0); assert.equal(o.missed.length, 1); assert.equal(o.missed[0].key, 'm1', 'm1 is the most urgent non-completion reminder');
  const onlyEnd = armed(mk('b', T, { d1: false, h1: false, m10: false, m1: false }), CREATED); assert.deepEqual(K.dueReminders([onlyEnd], TM + 3600e3).missed, []);
});
test('missed reminders are announced only while the event is upcoming or ended <= 24 h ago', () => {
  const run = n => K.dueReminders([armed(mk('a', T), CREATED)], n).missed.length;
  assert.equal(run(TM + 24 * 36e5), 1); assert.equal(run(TM + 24 * 36e5 + 1), 0); assert.equal(run(TM - 7 * 6e4), 1, 'before the event it is announced');
});
test('several events are independent: each reminder once, each event once', () => {
  const a = armed(mk('a', T), CREATED), b = armed(mk('b', T), CREATED), c = armed(mk('c', at(2030, 6, 16, 12)), CREATED);
  const o = K.dueReminders([a, b, c], TM - 36e5 + 1000); assert.deepEqual(o.fire.map(f => f.id + ':' + f.key), ['a:h1', 'b:h1']);
  assert.deepEqual(K.dueReminders([a, b, c], TM - 36e5 + 2000).fire, []);
  const o2 = K.dueReminders([a, b, c], ms(2030, 6, 16, 11, 0, 5)); assert.deepEqual(o2.fire.map(f => f.id + ':' + f.key), ['c:h1']);
});
test('a device clock moved backwards does not repeat a delivered reminder', () => {
  const e = armed(mk('a', T), CREATED); K.dueReminders([e], TM - 36e5 + 1000);
  assert.equal(K.dueReminders([e], TM - 2 * 36e5).fire.length, 0); assert.equal(K.dueReminders([e], TM - 36e5 + 5000).fire.length, 0);
});
test('changing the device timezone cannot repeat a reminder (fired is tied to the target string)', () => {
  const old = process.env.TZ;
  try { const e = armed(mk('a', T), CREATED); K.dueReminders([e], TM + 1e5); for (const tz of ['UTC', 'Asia/Kolkata', 'America/Los_Angeles']) { process.env.TZ = tz; assert.equal(K.dueReminders([e], Date.now() + 9e12).fire.length, 0, tz); } }
  finally { if (old === undefined) delete process.env.TZ; else process.env.TZ = old; }
});
test('nextTriggerMs: earliest future unfired enabled reminder, else null', () => {
  const a = armed(mk('a', T), CREATED), b = armed(mk('b', at(2030, 6, 14, 12), { d1: false }), CREATED);
  assert.equal(K.nextTriggerMs([a, b], CREATED), ms(2030, 6, 14, 12) - 36e5);
  K.dueReminders([a, b], ms(2030, 6, 14, 11, 0, 1)); assert.equal(K.nextTriggerMs([a, b], ms(2030, 6, 14, 11, 0, 1)), ms(2030, 6, 14, 11, 50));
  assert.equal(K.nextTriggerMs([mk('x', T)], CREATED), null, 'unarmed events are ignored'); assert.equal(K.nextTriggerMs([], 0), null); assert.equal(K.nextTriggerMs(null, 0), null);
  const done = armed(mk('d', T), CREATED); K.dueReminders([done], TM + 1e5); assert.equal(K.nextTriggerMs([done], TM + 1e5), null);
});
test('dueReminders / arm / nextTriggerMs are safe with bad input', () => {
  for (const bad of [null, undefined, 'x', {}, 5]) { assert.deepEqual(K.dueReminders(bad, 1), { fire: [], missed: [], changed: false }); assert.equal(K.arm(bad, 1), false); assert.equal(K.nextTriggerMs(bad, 1), null); }
  assert.deepEqual(K.dueReminders([null, 3, {}, mk('bad', 'nope', {}, { armed: true })], 1), { fire: [], missed: [], changed: false }); assert.deepEqual(K.dueReminders([mk('a', T)], NaN).fire, []);
  assert.doesNotThrow(() => K.armEvent(null, 1)); assert.doesNotThrow(() => K.armEvent({ at: 'bad' }, 1));
});
test('simulation: an event followed from creation to completion delivers each enabled reminder exactly once, in order', () => {
  const e = armed(mk('a', T, { d1: true, h1: true, m10: false, m1: true, end: true }), TM - 30 * 36e5), seen = [];
  for (let t = TM - 30 * 36e5; t <= TM + 3600e3; t += 7000) for (const f of K.dueReminders([e], t).fire) seen.push(f.key);
  assert.deepEqual(seen, ['d1', 'h1', 'm1', 'end']);
});

test('reminderText: title, body, per-event-per-reminder tag and click data', () => {
  const t = K.reminderText({ id: 'ab1', title: 'Wedding', key: 'h1' });
  assert.deepEqual(t, { title: 'Wedding', body: 'Starts in 1 hour.', tag: 'cp-ev-ab1-h1', data: { eventId: 'ab1', key: 'h1' } });
  assert.equal(K.reminderText({ id: 'ab1', title: 'Wedding', key: 'end' }).body, 'Countdown complete — it is time!');
  assert.notEqual(K.reminderText({ id: 'a', title: 'x', key: 'h1' }).tag, K.reminderText({ id: 'a', title: 'x', key: 'm1' }).tag); assert.notEqual(K.reminderText({ id: 'a', title: 'x', key: 'h1' }).tag, K.reminderText({ id: 'b', title: 'x', key: 'h1' }).tag);
});
test('hideTitles keeps the event name out of the notification (lock-screen privacy)', () => {
  for (const r of K.REMINDERS) { const t = K.reminderText({ id: 'ab1', title: 'Secret surprise party', key: r.key }, { hideTitles: true }); assert.ok(!/Secret|surprise|party/i.test(t.title + ' ' + t.body), r.key); assert.equal(t.title, 'ChronoPulse reminder'); assert.equal(t.data.eventId, 'ab1'); }
});
test('reminderText sanitizes: control characters removed, long text and ids clipped, unknown keys safe', () => {
  const t = K.reminderText({ id: 'x'.repeat(100), title: 'A\u0000B\nC' + 'z'.repeat(200), key: 'weird' }); assert.ok(!/[\u0000-\u001F]/.test(t.title)); assert.ok(t.title.length <= 60); assert.equal(t.data.eventId.length, 40); assert.equal(t.data.key, 'end');
  assert.equal(K.reminderText({ id: 'a', title: '', key: 'h1' }).title, 'Event reminder');
});
test('missedSummary wording: one, many, hidden titles, none', () => {
  const one = [{ title: 'Exam', label: '1 hour before' }];
  assert.match(K.missedSummary(one), /“Exam” \(1 hour before\)/); assert.ok(!/Exam/.test(K.missedSummary(one, { hideTitles: true })));
  assert.match(K.missedSummary([...one, ...one, ...one]), /missed 3 event reminders/); assert.equal(K.missedSummary([]), ''); assert.equal(K.missedSummary(null), '');
});

const unfold = s => s.replace(/\r\n /g, '');
test('ICS: valid structure, CRLF line endings, floating local start, stable UID, one alarm per enabled reminder', () => {
  const e = mk('ab1', T, { d1: true, h1: true, m10: false, m1: false, end: true }, { desc: 'Bring flowers' }), ics = K.buildIcs(e, Date.UTC(2030, 0, 1, 8, 30, 15));
  assert.ok(ics.endsWith('\r\n')); assert.ok(!/(?<!\r)\n/.test(ics), 'every newline is CRLF');
  const lines = unfold(ics).split('\r\n').filter(Boolean);
  assert.deepEqual(lines.slice(0, 6), ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ChronoPulse//4.2//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT']);
  assert.ok(lines.includes('UID:ab1@chronopulse.local')); assert.ok(lines.includes('DTSTAMP:20300101T083015Z')); assert.ok(lines.includes('DTSTART:20300615T120000')); assert.ok(lines.includes('SUMMARY:Event ab1')); assert.ok(lines.includes('DESCRIPTION:Bring flowers'));
  assert.deepEqual(lines.filter(l => l.startsWith('TRIGGER:')), ['TRIGGER:-PT24H', 'TRIGGER:-PT1H', 'TRIGGER:PT0S']);
  assert.equal(lines.filter(l => l === 'BEGIN:VALARM').length, 3); assert.equal(lines.filter(l => l === 'END:VALARM').length, 3); assert.equal(lines.at(-1), 'END:VCALENDAR');
  assert.equal(lines.filter(l => l === 'BEGIN:VEVENT').length, 1);
});
test('ICS: alarms map to the right TRIGGER values', () => {
  const only = k => unfold(K.buildIcs(mk('a', T, { d1: false, h1: false, m10: false, m1: false, end: false, [k]: true }), 0)).split('\r\n').filter(l => l.startsWith('TRIGGER:'));
  assert.deepEqual([only('d1'), only('h1'), only('m10'), only('m1'), only('end')], [['TRIGGER:-PT24H'], ['TRIGGER:-PT1H'], ['TRIGGER:-PT10M'], ['TRIGGER:-PT1M'], ['TRIGGER:PT0S']]);
  assert.deepEqual(unfold(K.buildIcs(mk('a', T, { d1: false, h1: false, m10: false, m1: false, end: false }), 0)).split('\r\n').filter(l => l.startsWith('TRIGGER:')), [], 'no reminders enabled -> no alarms');
});
test('ICS: every physical line is <= 75 bytes, and folding never splits a character (emoji, Tamil)', () => {
  const title = 'விழா 🎉 ' + 'நிகழ்வு'.repeat(10), e = mk('a', T, {}, { title, desc: 'é'.repeat(100) }), ics = K.buildIcs(e, 0), enc = new TextEncoder();
  for (const l of ics.split('\r\n')) assert.ok(enc.encode(l).length <= 75, l.length + ' chars: ' + l.slice(0, 30));
  const sum = unfold(ics).split('\r\n').find(l => l.startsWith('SUMMARY:')); assert.ok(sum.includes('விழா 🎉')); assert.ok(!sum.includes('\uFFFD'));
  assert.equal(K.fold('a'.repeat(200)).split('\r\n').length, 3); assert.equal(unfold(K.fold('a'.repeat(200))), 'a'.repeat(200));
});
test('ICS: text is escaped and cannot inject calendar lines', () => {
  const evil = 'Hi, there; back\\slash\r\nBEGIN:VEVENT\r\nEND:VCALENDAR', e = mk('a', T, {}, { title: evil, desc: evil }), ics = K.buildIcs(e, 0), lines = unfold(ics).split('\r\n').filter(Boolean);
  assert.equal(lines.filter(l => l === 'BEGIN:VEVENT').length, 1, 'no injected event'); assert.equal(lines.filter(l => l === 'END:VCALENDAR').length, 1);
  const sum = lines.find(l => l.startsWith('SUMMARY:')); assert.match(sum, /Hi\\, there\\; back\\\\slash/);
});
test('ICS: id is sanitized in the UID; invalid or missing events produce no file', () => {
  assert.ok(unfold(K.buildIcs(mk('a/b c\r\nX', T), 0)).includes('UID:a-b-c--X@chronopulse.local'));
  assert.equal(K.buildIcs(mk('a', 'bad'), 0), null); assert.equal(K.buildIcs(null, 0), null); assert.equal(K.buildIcs(undefined, 0), null);
});
test('icsFileName: safe ASCII slug with a fallback', () => {
  assert.equal(K.icsFileName({ title: 'My Wedding! 2030' }), 'ChronoPulse-my-wedding-2030.ics'); assert.equal(K.icsFileName({ title: 'விழா' }), 'ChronoPulse-event.ics'); assert.equal(K.icsFileName(null), 'ChronoPulse-event.ics');
  assert.ok(!/[\\/:*?"<>|]/.test(K.icsFileName({ title: 'a/b\\c:d' })));
});
