'use strict';
/* ChronoPulse 4.2 — pure countdown + completion logic (no DOM). Loaded as a classic script (window.CP42) and via require() in Node tests.
   Time policy: an event's target is a LOCAL "YYYY-MM-DDTHH:mm" string (as stored since 4.0). Remaining time is always recomputed from the
   clock and the target — never by subtracting from a previous value — so throttled timers, suspended tabs and reloads cannot cause drift.
   Completion policy (durable, once per target time):
     - ev.completed === ev.at  means the completion experience has already run for this exact target. It is sticky: a device clock that
       moves backwards does NOT re-arm the event. Editing the target time re-arms it (the strings no longer match).
     - reconcile() marks every event whose target has passed. `live` (finished <= LIVE_MS ago) may show the celebration; older ones are
       recorded silently. `announce` (finished <= AWAY_ANNOUNCE_MS ago) may be mentioned once in a summary; older ones are never announced,
       so upgrading or restoring a backup full of old events cannot produce a burst of stale messages. */
(function (root) {
  const C = typeof module !== 'undefined' && module.exports ? require('./lib.js') : root.CP; /* reminder keys live in lib.js (single source of truth) */
  const LIVE_MS = 60e3, AWAY_ANNOUNCE_MS = 24 * 3600e3, FINAL_MINUTE_MS = 60e3, FINAL_TEN_MS = 10e3;
  const RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

  /* local target string -> epoch ms, or null when malformed / not a real calendar date */
  function targetMs(at) {
    const m = typeof at === 'string' ? RE.exec(at) : null; if (!m) return null;
    const [y, mo, d, h, mi] = m.slice(1).map(Number);
    if (y < 1900 || mo < 1 || mo > 12 || h > 23 || mi > 59) return null;
    const t = new Date(y, mo - 1, d, h, mi);
    if (t.getFullYear() !== y || t.getMonth() !== mo - 1 || t.getDate() !== d) return null;
    const ms = t.getTime(); return Number.isFinite(ms) ? ms : null;
  }
  /* ms left (never negative), or null for an invalid target / invalid clock */
  function remainingMs(at, now) {
    const t = targetMs(at); if (t === null || !Number.isFinite(now)) return null;
    return Math.max(0, t - now);
  }
  /* 'invalid' | 'upcoming' | 'final-minute' (<= 60 s) | 'final-10' (<= 10 s) | 'done' */
  function phase(at, now) {
    const left = remainingMs(at, now); if (left === null) return 'invalid';
    return left <= 0 ? 'done' : left <= FINAL_TEN_MS ? 'final-10' : left <= FINAL_MINUTE_MS ? 'final-minute' : 'upcoming';
  }
  const isCompleted = ev => !!ev && typeof ev.completed === 'string' && ev.completed !== '' && ev.completed === ev.at;

  /* Marks (in place) every not-yet-completed event whose target has passed. Idempotent: a second call with the same events returns nothing. */
  function reconcile(events, now) {
    const out = []; if (!Array.isArray(events) || !Number.isFinite(now)) return { changed: false, completed: out };
    for (const ev of events) {
      if (!ev || isCompleted(ev)) continue;
      const t = targetMs(ev.at); if (t === null || t > now) continue;
      ev.completed = ev.at; const late = now - t;
      out.push({ id: ev.id, title: ev.title, late, live: late <= LIVE_MS, announce: late <= AWAY_ANNOUNCE_MS });
    }
    return { changed: out.length > 0, completed: out };
  }

  /* ================= Phase 2: reminders =================
     Policy (all of it unit-tested):
     - A reminder is due when now >= target - lead time. It runs ONCE per target time: ev.fired[key] === ev.at marks it done (persisted, so refresh /
       reopen can never repeat it; editing the target re-arms it).
     - "Arming": reminders whose time was ALREADY past when an event is created, edited, imported, or first seen by 4.2 are skipped silently — never
       announced as "missed" (you never asked for them at that time). Toggling a reminder on after its time has passed also skips it.
     - Live window: a due reminder at most GRACE_MS (2 min) late is delivered normally. Later ones are "missed" and summarized once, in-app only.
     - No bursts: at most ONE entry per event per check (the most urgent due reminder). Older due reminders of the same event are marked done silently.
     - Missed reminders are only announced while the event is upcoming or ended <= 24 h ago, and never for "At completion" (the completion notice already
       covers that). */
  const GRACE_MS = 120e3;
  const REMINDERS = [
    { key: 'd1', before: 864e5, label: '24 hours before', ics: '-PT24H', msg: 'Starts in 24 hours.', gen: 'An event starts in 24 hours.' },
    { key: 'h1', before: 36e5, label: '1 hour before', ics: '-PT1H', msg: 'Starts in 1 hour.', gen: 'An event starts in 1 hour.' },
    { key: 'm10', before: 6e5, label: '10 minutes before', ics: '-PT10M', msg: 'Starts in 10 minutes.', gen: 'An event starts in 10 minutes.' },
    { key: 'm1', before: 6e4, label: '1 minute before', ics: '-PT1M', msg: 'Starts in 1 minute.', gen: 'An event starts in 1 minute.' },
    { key: 'end', before: 0, label: 'At completion', ics: 'PT0S', msg: 'Countdown complete — it is time!', gen: 'A countdown has completed.' }
  ];
  const RBY = Object.fromEntries(REMINDERS.map(r => [r.key, r]));
  const triggerMs = (ev, key) => { const t = targetMs(ev && ev.at), r = RBY[key]; return t === null || !r ? null : t - r.before; };
  const firedOk = (ev, key) => !!ev.fired && typeof ev.fired === 'object' && ev.fired[key] === ev.at;
  const markFired = (ev, key) => { if (!ev.fired || typeof ev.fired !== 'object') ev.fired = {}; ev.fired[key] = ev.at; };

  function armOne(ev, now) {
    if (!ev || ev.armed) return false;
    for (const r of REMINDERS) { const t = triggerMs(ev, r.key); if (t !== null && t <= now) markFired(ev, r.key); }
    ev.armed = true; return true;
  }
  /* one-time pass for events that have never been armed (migrated, imported). Returns true when something changed (=> save). */
  function arm(events, now) { let ch = false; if (Array.isArray(events) && Number.isFinite(now)) for (const ev of events) if (armOne(ev, now)) ch = true; return ch; }
  /* call after creating an event or changing its target time */
  function armEvent(ev, now) { if (!ev) return; ev.fired = C.normFired(ev.fired, ev.at); ev.armed = false; armOne(ev, now); }
  function setReminder(ev, key, on, now) {
    if (!ev || !RBY[key]) return false;
    if (!ev.reminders || typeof ev.reminders !== 'object') ev.reminders = C.normReminders(null);
    ev.reminders[key] = !!on;
    if (on) { const t = triggerMs(ev, key); if (t !== null && t <= now) markFired(ev, key); }
    return true;
  }
  const entry = (ev, d, kind) => ({ id: ev.id, title: ev.title, key: d.r.key, label: d.r.label, kind, late: d.late, at: ev.at });
  /* Marks (in place) every due reminder as handled and returns what to show: fire[] (deliver now) and missed[] (summarize once). */
  function dueReminders(events, now) {
    const out = { fire: [], missed: [], changed: false };
    if (!Array.isArray(events) || !Number.isFinite(now)) return out;
    const urgent = list => list.reduce((a, b) => (b.r.before < a.r.before ? b : a));
    for (const ev of events) {
      if (!ev || !ev.armed || !ev.reminders || typeof ev.reminders !== 'object') continue;
      const tgt = targetMs(ev.at); if (tgt === null) continue;
      const due = [];
      for (const r of REMINDERS) { if (ev.reminders[r.key] !== true || firedOk(ev, r.key)) continue; const t = tgt - r.before; if (t <= now) due.push({ r, late: now - t }); }
      if (!due.length) continue;
      for (const d of due) markFired(ev, d.r.key);
      out.changed = true;
      const live = due.filter(d => d.late <= GRACE_MS);
      if (live.length) { out.fire.push(entry(ev, urgent(live), 'fire')); continue; }
      if (tgt + AWAY_ANNOUNCE_MS < now) continue;
      const m = due.filter(d => d.r.key !== 'end'); if (m.length) out.missed.push(entry(ev, urgent(m), 'missed'));
    }
    return out;
  }
  /* epoch ms of the next reminder that is still in the future (to schedule one timer), or null */
  function nextTriggerMs(events, now) {
    if (!Array.isArray(events) || !Number.isFinite(now)) return null;
    let best = null;
    for (const ev of events) {
      if (!ev || !ev.armed || !ev.reminders || typeof ev.reminders !== 'object') continue;
      for (const r of REMINDERS) { if (ev.reminders[r.key] !== true || firedOk(ev, r.key)) continue; const t = triggerMs(ev, r.key); if (t !== null && t > now && (best === null || t < best)) best = t; }
    }
    return best;
  }
  const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, n);
  /* Text for one delivered reminder. hideTitles keeps event names off lock screens. tag = one stable id per event+reminder (a repeat replaces, never stacks). */
  function reminderText(en, opts) {
    const hide = !!(opts && opts.hideTitles), r = RBY[en.key] || RBY.end, id = clean(en.id, 40);
    return { title: hide ? 'ChronoPulse reminder' : clean(en.title, 60) || 'Event reminder', body: hide ? r.gen : r.msg, tag: `cp-ev-${id}-${r.key}`, data: { eventId: id, key: r.key } };
  }
  function missedSummary(list, opts) {
    const hide = !!(opts && opts.hideTitles); if (!Array.isArray(list) || !list.length) return '';
    if (list.length === 1) return hide ? 'You missed an event reminder while ChronoPulse was not running.' : `You missed a reminder while ChronoPulse was not running: “${clean(list[0].title, 60)}” (${list[0].label}).`;
    return `You missed ${list.length} event reminders while ChronoPulse was not running.`;
  }

  /* ================= calendar (.ics) export =================
     The one closed-app option that needs no server: the phone's own calendar app fires these alarms. Times are "floating" local times, so they follow the
     device's timezone, exactly like ChronoPulse's own countdown targets. */
  const utf8len = ch => { const c = ch.codePointAt(0); return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; };
  function fold(line) {
    const out = []; let cur = '', bytes = 0;
    for (const ch of line) { const b = utf8len(ch); if (bytes + b > 75) { out.push(cur); cur = ' '; bytes = 1; } cur += ch; bytes += b; }
    out.push(cur); return out.join('\r\n');
  }
  const icsText = s => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
  function buildIcs(ev, now) {
    if (!ev || targetMs(ev.at) === null) return null;
    const stamp = new Date(Number.isFinite(now) ? now : Date.now()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const uid = String(ev.id || 'event').replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 60);
    const rem = ev.reminders && typeof ev.reminders === 'object' ? ev.reminders : {}, name = icsText(clean(ev.title, 60) || 'Event');
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ChronoPulse//4.2//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT', `UID:${uid}@chronopulse.local`, `DTSTAMP:${stamp}`, `DTSTART:${ev.at.replace(/[-:]/g, '')}00`, `SUMMARY:${name}`];
    if (ev.desc) L.push(`DESCRIPTION:${icsText(clean(ev.desc, 240))}`);
    for (const r of REMINDERS) if (rem[r.key] === true) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${name} — ${icsText(r.label)}`, `TRIGGER:${r.ics}`, 'END:VALARM');
    L.push('END:VEVENT', 'END:VCALENDAR');
    return L.map(fold).join('\r\n') + '\r\n';
  }
  const icsFileName = ev => 'ChronoPulse-' + (String(ev && ev.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'event') + '.ics';

  const api = { LIVE_MS, AWAY_ANNOUNCE_MS, FINAL_MINUTE_MS, FINAL_TEN_MS, GRACE_MS, REMINDERS, targetMs, remainingMs, phase, isCompleted, reconcile,
    triggerMs, arm, armEvent, setReminder, dueReminders, nextTriggerMs, reminderText, missedSummary, buildIcs, icsFileName, fold };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CP42 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
