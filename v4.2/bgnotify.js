'use strict';
/* ChronoPulse 4.2.x — hands upcoming reminders (event reminders + task reminders) to the service worker, so alerts can reach the system when the tab or app is closed or minimised.
   What is possible depends on the browser and is reported honestly in Settings → Notifications:
     "scheduled"  Notification Triggers: the OS fires each reminder at its time, even with the browser closed (Chromium builds that support it).
     "periodic"   Periodic Background Sync (installed Chromium PWA): the worker wakes now and then and delivers whatever is due. Timing is up to the browser (often 15+ min).
     "foreground" everything else (Safari/iOS, Firefox, uninstalled sites): reminders arrive while the app is open or kept alive in the background.
   The list is rebuilt from the saved data (nothing new is stored) after every save, and cleared when notifications are switched off. The list only contains reminders in the next 14 days. */
(function () {
  const Q = CP47, K = CP42; let timer = 0, mode = 'foreground', lastJson = '', ready = false;
  const supported = () => 'serviceWorker' in navigator && 'Notification' in window;
  const reg = async () => { try { return await navigator.serviceWorker.getRegistration(); } catch (e) { return null; } };

  function items() {
    const out = [], now = Date.now();
    for (const ev of S.events || []) {
      if (!ev || !ev.armed || !ev.reminders || typeof ev.reminders !== 'object') continue;
      for (const r of K.REMINDERS) {
        if (ev.reminders[r.key] !== true || (ev.fired && ev.fired[r.key] === ev.at)) continue; const at = K.triggerMs(ev, r.key); if (at === null || at <= now) continue;
        const t = K.reminderText({ id: ev.id, title: ev.title, key: r.key }, { hideTitles: false }); out.push({ id: ev.id + ':' + r.key, tag: t.tag, at, title: t.title, body: t.body, eventId: t.data.eventId });
      }
    }
    for (const t of S.todos || []) { if (!t || t.doneOn || t.reminded || !t.remind) continue; const at = new Date(t.remind).getTime(); if (Number.isFinite(at) && at > now) out.push({ id: 'task:' + t.id, tag: 'cp-task-' + String(t.id).slice(0, 40), at, title: String(t.title || 'Task reminder'), body: 'Task reminder', eventId: '' }); }
    return Q.buildSchedule(out, now, !!S.cfg.hideTitles);
  }
  const ask = async (worker, msg) => new Promise(ok => { const ch = new MessageChannel(), t = setTimeout(() => ok(null), 3000); ch.port1.onmessage = e => { clearTimeout(t); ok(e.data); }; try { worker.postMessage(msg, [ch.port2]); } catch (e) { clearTimeout(t); ok(null); } });

  async function sync() {
    timer = 0; if (!supported()) return render();
    const on = !!(X.notifyState && X.notifyState().on), r = await reg(), w = r && r.active; if (!w) return render();
    const list = on ? items() : [], json = JSON.stringify(list); if (ready && json === lastJson && on) return;
    const res = await ask(w, list.length || !on ? { type: on ? 'SCHEDULE' : 'CLEAR_SCHEDULE', list } : { type: 'SCHEDULE', list }); ready = true; lastJson = json;
    const trig = !!(res && res.triggers); let periodic = false;
    try { if (r.periodicSync) { if (on) { const st = navigator.permissions && navigator.permissions.query ? await navigator.permissions.query({ name: 'periodic-background-sync' }).catch(() => null) : null; if (!st || st.state === 'granted') { await r.periodicSync.register('cp-reminders', { minInterval: 15 * 60e3 }); periodic = true; } } else await r.periodicSync.unregister('cp-reminders'); } } catch (e) { periodic = false; }
    mode = !on ? 'foreground' : trig ? 'scheduled' : periodic ? 'periodic' : 'foreground'; render(list.length, on);
  }
  const TEXT = {
    scheduled: n => `${n} upcoming reminder${n === 1 ? '' : 's'} handed to your system, so they can arrive even when ChronoPulse is closed.`,
    periodic: n => `${n} upcoming reminder${n === 1 ? '' : 's'} saved for background checks. The browser wakes ChronoPulse now and then, so timing can be late when the app is closed.`,
    foreground: () => 'This browser delivers reminders while ChronoPulse is open or running in the background. For a guaranteed alert when the app is closed, use the calendar button on an event.'
  };
  function render(n, on) { const el = $('#bgNote'); if (!el) return; if (!supported()) return setT(el, 'This browser cannot show notifications while the app is in the background.'); setT(el, on === false ? '' : TEXT[mode](n || 0)); el.dataset.mode = mode; }
  const queue = () => { clearTimeout(timer); timer = setTimeout(sync, 400); };
  X.notifChanged = () => { ready = false; queue(); };
  const pa = X.afterSave; X.afterSave = () => { if (pa) pa(); queue(); }; const ps = X.onState; X.onState = () => { if (ps) ps(); queue(); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) { clearTimeout(timer); sync(); } else queue(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.ready.then(() => queue()).catch(() => {});
  X.bgNotify = { items, sync, mode: () => mode };
})();
