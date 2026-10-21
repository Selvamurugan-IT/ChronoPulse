'use strict';
/* ChronoPulse 4.2 — event reminder runtime (UI + scheduling). All rules (what is due, what counts as missed, duplicate protection) live in lib/lib42.js and
   are unit-tested; this file only delivers the result. Delivery = ALWAYS an in-app banner (the visible fallback, no permission needed) PLUS a system
   notification when the app is not on screen and notifications are on. Nothing is ever sent to a server. */
(function () {
  const K = CP42, BATCH = 3; /* at most 3 individual alerts per check; the rest are summarized so a burst can never happen */
  let timer = 0, scheduledFor = null;

  function deliver(en) {
    const t = K.reminderText(en, { hideTitles: S.cfg.hideTitles });
    X.banner('remev-' + en.id, `${en.title}: ${K.REMINDERS.find(r => r.key === en.key).msg}`, [{ label: 'Open', fn: () => openEventById(en.id) }, { label: 'Dismiss' }]);
    /* A visible app already shows the banner; the system notification is for when the user is elsewhere. */
    if (document.visibilityState !== 'visible' && X.notify) X.notify(t.title, t.body, t.tag, t.data).catch(() => {});
    if (document.visibilityState === 'visible' && X.reminderSound) X.reminderSound(en); /* optional in-app sound (Settings → Notifications); never throws */
  }
  function run() {
    const now = Date.now(); let changed = K.arm(S.events, now);
    const r = K.dueReminders(S.events, now); if (r.changed) changed = true;
    if (changed) save();
    r.fire.slice(0, BATCH).forEach(deliver);
    if (r.fire.length > BATCH) {
      const n = r.fire.length - BATCH; X.banner('remev-batch', `${n} more event reminder${n === 1 ? '' : 's'} came due.`, [{ label: 'Open events', fn: () => showTab('profile') }, { label: 'Dismiss' }]);
      if (document.visibilityState !== 'visible' && X.notify) X.notify('ChronoPulse reminders', `${n} more event reminder${n === 1 ? '' : 's'}.`, 'cp-ev-batch').catch(() => {});
    }
    if (r.missed.length) X.banner('remev-missed', K.missedSummary(r.missed, { hideTitles: false }), [{ label: 'Open events', fn: () => showTab('profile') }, { label: 'Dismiss' }]);
    schedule();
  }
  /* ONE timer, aimed at the next reminder, so a backgrounded-but-alive page can still deliver on time. It is only re-created when the target moved. */
  function schedule() {
    const next = K.nextTriggerMs(S.events, Date.now());
    if (next === scheduledFor && (timer || next === null)) return;
    clearTimeout(timer); timer = 0; scheduledFor = next; if (next === null) return;
    timer = setTimeout(() => { timer = 0; scheduledFor = null; reconcileNow(); }, Math.min(Math.max(next - Date.now(), 0) + 50, 30 * 60e3));
  }
  X.runReminders = run;
  X.remNote = () => { /* honest status line inside the event dialog */
    const s = X.notifyState ? X.notifyState() : { on: false, perm: 'unsupported' };
    setT($('#eRemNote'), (s.on ? 'System notifications are on: you get a notification when ChronoPulse is in the background, and a message inside the app when it is open.'
      : s.perm === 'unsupported' ? 'This browser cannot show notifications, so reminders appear inside ChronoPulse while it is open.'
      : s.perm === 'denied' ? 'Notifications are blocked in your browser settings, so reminders appear inside ChronoPulse while it is open.'
      : 'System notifications are off (turn them on in Settings). Until then, reminders appear inside ChronoPulse while it is open.') + ' Alerts are not guaranteed when the app is closed; use the calendar button on the event for that.');
  };
})();
