# ChronoPulse 4.2 — Notifications: what works, what doesn't, how to verify

> Plain-English guide. "PWA" = a website you can install like an app. "Service worker" = a small background script the browser runs for a site.

## 1. What this build does (Phase 2, no server)

Each event has five independent reminders: **24 hours before, 1 hour before, 10 minutes before, 1 minute before, At completion.**
Defaults for a new event: *1 hour before* and *At completion* are on; the rest are off. You change them in the event dialog (add/edit event).

| Situation | What you get |
|---|---|
| App is open and on screen | A message **inside the app** (banner) with an **Open** button. No system notification (you are already looking at the app). |
| App is running but not on screen (another tab/app, screen on, or a phone that keeps it alive) | The banner **plus a system notification**, if you turned notifications on in Settings and allowed them in the browser. |
| App is fully closed / phone locked or asleep | **Nothing from ChronoPulse can be guaranteed.** See sections 2 and 3. |
| You reopen the app after reminders were due | One short **"You missed N reminders"** message — never a burst of old alerts (policy below). |

Tapping a notification opens ChronoPulse and shows **that event** on the Countdown screen.

### Rules the app follows (all unit-tested)
* **Once only.** Every reminder is stored as "already done for this exact target time". Refreshing, reopening, or restoring a backup cannot repeat it. Editing the event's date/time re-arms its reminders.
* **No stale alerts for new events.** Reminders whose time had already passed when you created/edited the event (or when 4.2 first saw an old event) are skipped silently. Turning a reminder on after its time has passed also skips it.
* **Live window: 2 minutes.** A reminder at most 2 minutes late is delivered normally. Later ones are only summarised once ("You missed…") and only if the event is still upcoming or ended within 24 hours. "At completion" is never reported as missed (the completion message already covers it).
* **No bursts.** At most one alert per event per check (the most urgent due reminder); at most 3 individual alerts at once, the rest in one summary.
* **Privacy.** Settings → "Hide event names in notifications" shows a generic message so nothing private appears on a locked screen. Nothing is ever sent to any server.

## 2. Does your hosting support closed-app delivery?

**Short answer: no — not by itself.**

* The ZIP name and the `.nojekyll` file indicate **GitHub Pages**. (This is an inference — I could not see your hosting settings. If you use something else, tell me.)
* GitHub Pages serves **static files only**. It cannot run a timer, store push subscriptions, or send push messages. That is a property of static hosting, not a bug in ChronoPulse.
* A service worker can *display* a notification when something tells it to, and can run while the page is closed — but **nothing wakes it at 10:00:00 by itself**. The browser's "notification triggers" feature that would allow local scheduling is experimental/Chromium-only and not used here, because it is not dependable.
* Reliable closed-app delivery needs three things: (1) a **push service** (the browser vendor runs it: Google/FCM, Mozilla, Apple), (2) a **subscription** from the phone, and (3) a **server-side sender that runs on a schedule** and calls the push service at the right moment.

## 3. What would be required for real closed-app push (NOT implemented)

I did not build this, because it needs a backend and an account only you can create, plus your approval. Nothing here is half-built in the app: there is no push code at all (a test enforces that).

Options, from least to most work (check current pricing and limits yourself — they change):

1. **Calendar alarms (already in this build, free, no server).** On any event, press the **save/download button** to get a `.ics` file. Opening it adds the event and its alarms (the same five reminders you ticked) to your phone's calendar app, which is far more dependable while closed or locked. Times follow the phone's timezone. *I could not verify how every phone's calendar app treats these files; test on yours.*
2. **A managed push provider** (for example OneSignal): least code, but a third party stores your subscribers' data, and you must call its API to schedule sends from somewhere that can keep a schedule.
3. **Your own small backend** (for example Cloudflare Workers with a Cron Trigger and a small database/KV, or similar on Firebase or Supabase): you store, per event, only an anonymous event id, the UTC fire time(s) and the push subscription — not the title. A scheduled job runs every minute, finds due reminders, sends Web Push messages, and deletes expired subscriptions when the push service answers "gone" (HTTP 404/410).

If you ever go to option 3, these are the non-negotiables:
* **VAPID keys:** the *public* key goes in the app (safe). The *private* key lives only in the backend's secret store — never in this repository, never in the browser, never in a screenshot.
* **UTC times:** ChronoPulse stores local times. A server needs the exact UTC instant, converted on the phone when the user subscribes.
* **Validate every request** (size, type, rate-limit) and let users **unsubscribe/delete** their data.
* **Honest limits even then:** a scheduler that runs every minute is not "exact to the second"; the phone's battery saver, notification settings, Focus/Do-Not-Disturb, being offline, or the browser being force-stopped can still delay or block delivery. iPhone web push works only for an app **added to the Home Screen** on a recent iOS version.

## 4. How to verify — each situation separately

Status key: **[Automated]** = checked by the test suite or a scripted desktop Chromium run. **[You]** = must be checked by hand on a real phone. Nothing marked [You] has been verified by me.

### A. Foreground (app open and visible)
Automated: banner appears with the right text and an Open button; no duplicate banners; no system notification while visible; the five checkboxes and defaults; calendar file contents.
**[You] on your phone:**
1. Open the installed app → Profile → Add event for ~3 minutes from now. Tick *1 minute before* and *At completion*. Save.
2. Leave the app open on screen. About 2 minutes later a banner "…Starts in 1 minute." appears; at the target a second banner "Countdown complete". You should see **no** system notification (expected).
3. Tap **Open** on the banner: the event is shown.

### B. Background (app running but not on screen)
Automated: with the page hidden, the page's own timer delivers a system notification with the right title/body/tag; "hide event names" works; one notification per reminder; a jump over several due reminders gives one alert.
**[You] on your phone:**
1. Settings → Notifications → turn **on** and allow when the browser asks. Press **Send a test notification** and confirm it appears.
2. Create an event ~5 minutes away with *1 minute before* ticked. Switch to another app (don't swipe ChronoPulse away). Wait.
3. Expect a notification near the 1-minute mark. **It may be late or missing** — phones suspend background web pages. Write down what happened; this is exactly the limit described above.
4. Tap the notification: ChronoPulse opens on that event.

### C. Closed app (swiped away / phone locked)
Automated: **none, and none is possible** without a real phone. What *is* automated is that the app contains no push code and makes no network requests.
**[You] on your phone:**
1. Create an event ~5 minutes away with several reminders ticked. Press its **calendar** button, open the downloaded file and add it to your calendar.
2. Swipe ChronoPulse away, lock the phone, wait.
3. Expect the **calendar app's** alarms (they depend on your calendar's alarm settings). ChronoPulse's own notifications are **not** expected here.
4. Reopen ChronoPulse after the target time: you should see at most one "You missed…" message and the completed event — no pile of old alerts.

### D. Permission and fallback behaviour
Automated: permission is requested only after pressing the switch and confirming the explanation; "blocked" and "unsupported" browsers show an honest message and reminders still appear inside the app.
**[You]:** Settings → Notifications: try it once with notifications *allowed* and once *blocked* (browser/site settings) and confirm the wording is clear.

### E. Updating
**[You]:** after deploying, open the installed app, go to Settings → App & offline, tap the update button when offered, and confirm your events and their reminder ticks are still there.

## 5. Test commands
```
npm test            # runs every automated test (Node 18+ ; no packages to install)
```
