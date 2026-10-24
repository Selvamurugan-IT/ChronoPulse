# ChronoPulse 4.2.8

An offline-first countdown, focus, task and habit progressive web app. Static site; no build step or server-side service is required.


## 4.2.8: PulseShift

Open the floating stopwatch icon, then expand **PulseShift** in the panel. Pick a mode (Date, Time or Date + Time), enter the starting point, choose **Before / Past (−)** or **After / Future (+)** (default), and set the offset with the steppers (Days; Hours/Minutes/Seconds; or Days/Hours/Minutes). The result updates on every change and **Copy Result** copies it. Maths is in `lib/lib48.js` (native local-time `Date`, so month ends, leap years and DST are handled; results must fall in years 1000-9999). Only the mode, direction and offsets are remembered (inside the existing `chronopulse:widget` key); nothing is sent anywhere.

## Project layout

- `index.html` — application entry point; keeps the PWA root URL stable.
- `script.js`, `focus-ui.js`, `reminders.js`, `notifsound.js`, `cinema.js`, `sfx.js`, `orbit.js`, `floaty.js`, `streak-ui.js`, `theme.js`, `insights-ui.js`, `pwa.js`, `bgnotify.js` — focused runtime/UI modules.
- `lib/` — pure, testable business-logic modules (`lib.js`, `lib41.js`–`lib47.js`). These are separate modules, not duplicate files; each owns a different set of calculations, validation or settings rules. Keep their dependency order as shown in `index.html`.
- `style.css`, `themes.css`, `theme-boot.js` — styling and theme startup.
- `assets/` — local icons and sound assets.
- `service-worker.js`, `manifest.json` — PWA installation and offline cache.
- `tests/` — automated Node.js tests. `e2e/` — browser automation checks.
- `docs/` — feature and release notes.

## Run locally

Use a local HTTP server (service workers and notifications do not work reliably from `file://`). For example, with Python installed:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`. For notification permission, use localhost or a deployed HTTPS origin.

## Test

```bash
npm test
```

Browser end-to-end tests are in `e2e/` and require Playwright plus its supported browser installed.

## Deploy with GitHub Pages

1. Upload the contents of this folder to the repository root.
2. In GitHub, open **Settings → Pages**.
3. Choose **Deploy from a branch**, select the branch (usually `main`) and folder `/ (root)`.
4. Wait for deployment, open the HTTPS URL, then test notification permission, the switch state, offline launch and sound.
5. If an older version is cached on your device, close the app and reopen it after the new service worker activates. The service-worker cache version is `4.2.8`.

## Notifications

Notifications require browser permission and a secure context (HTTPS or localhost). The app toggle reflects the app setting and current browser permission; if notifications were blocked in browser site settings, enable them there first. Delivery while the app is closed is browser/device-dependent and not guaranteed.
