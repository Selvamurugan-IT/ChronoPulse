# ChronoPulse 4.2 — Release guide (Phase 4)

Status: **release candidate 4.2.5.** Automated checks (Node + real-browser) are listed with real results in the hand-off message. Section 2 is the on-device checklist: nothing in it has been run on a physical phone by the author.

## 1. Pre-release gate (run on the release commit)
```
npm test                                    # all Node suites
npm run e2e                                 # real Chromium (needs Playwright): cinema, streak, reminder sound, offline at / and at /repository-name
git diff --stat v4.1-stable..HEAD     # review; no unexpected deletions
git diff --diff-filter=D --name-only v4.1-stable..HEAD   # must list nothing you did not intend
grep -rniE "BEGIN [A-Z ]*PRIVATE KEY|api[_-]?key|secret|token" --include=*.js --include=*.json --include=*.html --include=*.md . | grep -v node_modules   # expect only code comments / test words
```
Confirm: `service-worker.js` `VERSION` bumped; `PRECACHE` lists every file `index.html` loads (a test enforces it); cache prefix still `chronopulse-v4.2-` (4.1 caches `chronopulse-v4.1-*` are never touched); data key still `chronopulse:v4.1`, schema 7.

## 2. Manual mobile verification (do on a real Android phone and a real iPhone)
Install the staging URL first. Tick each box; note device/OS/browser.

**A. Setup**
- [ ] Open site in the browser, create profile, add event "QA" 3 minutes ahead (all five reminders on).
- [ ] Settings → Sound & effects: tap **Preview** on each sound — audible, volume slider changes loudness (iPhone: volume follows the side buttons, slider affects synthesized sounds only).
- [ ] Settings → Notifications: allow, **Send a test notification** arrives.

**B. App states** (repeat for each row)
| State | Expected | ✔ |
|---|---|---|
| **Foreground, sound on, tapped once** | 1-min warning tone once; digits 10→1 with beeps; overlay + impact at 0; Replay/Mute/Close work | |
| **Foreground, never tapped since opening** | No sound; hint "Tap anywhere…" in last 2 min; visuals + overlay still work; overlay note offers Replay | |
| **Foreground, master Sound OFF** | Visuals only; zero sound; Mute button says "Sound off" | |
| **Foreground, Vibration ON** (Android) | Buzz at 1 min, last 3 s, finish. iPhone: row shows "Not available" | |
| **Background (switch app, ≤ 5 min after target)** | No custom sound while away. System notification only if permitted. On return: celebration plays once | |
| **Background > 5 min** | On return: toast "reached its target", no stale celebration | |
| **Locked screen** | Only the OS notification sound (if permitted) / calendar alarm. **No custom audio, no vibration pattern from the app** — if you hear it, report it | |
| **App closed (swipe away)** | Same as locked. Reopen after target: toast "finished while you were away"; no celebration | |
| **Return from background/lock before target** | Tick resumes; if iPhone needs a tap, hint appears; one tap restores sound | |

**C. Permissions**
- [ ] Notifications **allowed**: banner in-app when foreground; system notification when backgrounded; tap opens the event.
- [ ] Notifications **denied**: no prompt loops; in-app banners still appear; Settings explains it.
- [ ] Sound allowed vs blocked (site settings → Sound blocked): app stays usable, hint/notes honest.

**D. PWA / offline / refresh**
- [ ] Install to home screen (Android: Install app; iPhone: Share → Add to Home Screen). Icon and name correct; opens standalone.
- [ ] Turn on airplane mode, force-close, reopen: app loads, countdown runs, **tick sound plays offline**, Preview sounds play, `.ics` button works.
- [ ] Refresh during the last 10 s: countdown continues from the clock; overlay appears once at 0.
- [ ] Refresh after completion: no celebration repeats.
- [ ] Open two tabs (desktop) at completion: exactly one celebration.
- [ ] Reduced motion: enable OS "Reduce motion" → calm overlay, no canvas, switch locked on.

## 3. Deploy to GitHub Pages (safe order)
1. Work on a branch; do **not** push to the Pages branch yet. `git tag v4.1-stable` must already point at the last good 4.1 commit (verify: `git show v4.1-stable --stat`).
2. Run the section 1 gate. Fix anything red.
3. Back up first: on a device that has 4.1 data, Settings → *Backup, restore & CSV export* → export JSON (the 4.2 upgrade also keeps a safety copy under `chronopulse:v4.1:pre42`).
4. Merge to the Pages branch (or `git push origin HEAD:main` if Pages serves `main`). Wait for the Pages build to turn green.
5. Keep `.nojekyll` in the root (present). All paths are relative, so project-site sub-paths work.

### Post-deploy smoke tests (5 minutes, on the live URL)
- [ ] `https://<user>.github.io/<repo>/service-worker.js` loads and shows `VERSION = '4.2.5'` (hard refresh; check it is not a cached copy).
- [ ] DevTools → Application → Cache Storage: `chronopulse-v4.2-4.2.5` contains all precache files incl. `doomsday-tick.mp3`, `assets/chime.wav`, `themes.css`, `theme-boot.js`, `lib/lib43.js`–`lib/lib46.js`, `sfx.js`, `cinema.js`, `notifsound.js`, `streak-ui.js`, `theme.js`, `insights-ui.js`; old `chronopulse-v4.1-*` still present on a device that had 4.1.
- [ ] Existing 4.1 user data still loads (events, goals, focus history); a toast/notes mention the upgrade only if relevant.
- [ ] Create event 2 min ahead: warning, digits, overlay, completion persisted; reload — no repeat.
- [ ] Offline reload works (DevTools → Network → Offline).
- [ ] Settings → Sound & effects → Preview works after a tap; no console errors.
- [ ] An already-open old tab updates only when the user taps *Update now* (the worker waits by design).

## 4. Rollback to v4.1-stable
Code rollback (fast):
```
git checkout main && git revert --no-edit <merge-commit>      # preferred: keeps history
# or, if the Pages branch must exactly equal 4.1:
git push --force-with-lease origin v4.1-stable:main            # only with the team's agreement
```
Wait for Pages to rebuild, then verify the live `service-worker.js` is the 4.1 one.

What rollback does and does not do:
- **Caches:** the 4.1 worker only manages `chronopulse-v4.1-*`; 4.2 caches (`chronopulse-v4.2-*`) become unused leftovers (harmless, a few MB). Users with the 4.2 worker active get the 4.1 worker on their next load; ask testers to reload twice.
- **Data (read carefully):** 4.2 stores **schema 7** under the same key `chronopulse:v4.1`. 4.1 was not run against schema-7 data in this project, so whether it reads it cleanly is **unverified**. Before any real rollback, do a drill on a staging copy: load 4.2, then deploy 4.1 to the same origin and open it. Recovery paths if 4.1 rejects the data: (1) restore the JSON backup from step 3.3 via *Restore backup*; (2) the pre-upgrade copy at `chronopulse:v4.1:pre42` (browser DevTools → Application → Local Storage) holds the pre-4.2 data.
- Do not delete user localStorage as part of a rollback.

## 5. Known limits to state in release notes
No custom sound or vibration while closed/locked/backgrounded; calendar `.ics` alarms are the closed-app option. Browsers may require a tap before sound. iPhone silent switch/volume behaviour and lack of Vibration API. Sounds are synthesized (no audio assets added); `doomsday-tick.mp3` remains the tick.

## 6. Streaks and reminder sounds (added in 4.2.3)
**Streak days** (flame badge in the header → calendar sheet). Derived from existing data only: nothing streak-related is stored, schema 7 and key `chronopulse:v4.1` are unchanged. A day is *active* when you finish at least the **daily goal** (Settings → Streaks, default 1, max 10) of: habit check-ins, tasks done (a habit-linked task is already its check-in), completed focus sessions. Streak = consecutive active days ending today, or ending yesterday while today is still open (alive until midnight). Changing the goal re-derives history; nothing is lost.

**Reminder sound** (Settings → Notifications): Default system / Doomsday tick / Chime / Custom file (.mp3/.wav, ≤ 1 MB, ≤ 30 s, validated by content). The file lives in this browser only (IndexedDB; a ≤ 300 KB localStorage copy if IndexedDB is blocked), is never uploaded, is **not** in backups and is removed by *Reset all data*. It plays **only while the app is open on screen** when a reminder comes due (one sound per 1.5 s, capped at 8 s). A web app cannot change a system notification's sound: closed / background / locked always uses the phone's own sound. A backup restored on another device keeps the *choice* but not the file, and falls back to the system sound with a visible note.

### Extra on-device checks for 4.2.3
- [ ] Header badge fits on your narrowest phone; tap it: sheet opens, month arrows work, swipe-free (buttons / arrow keys).
- [ ] Check in a habit: badge number and sheet update at once, without reload.
- [ ] Settings → Streaks → goal 3: streak recalculates; back to 1 restores it.
- [ ] Custom sound: choose a short .mp3 and a .wav; Preview plays; set an event reminder 1 minute ahead with the app open → sound plays once; with the app in the background → only the phone's own notification sound (expected).
- [ ] Airplane mode + reload: streak calendar and custom sound both still work.
- [ ] Settings → Reset all data → custom sound is gone and the selector is back to Default.

## 7. GitHub Pages (project site) — concise deployment
URL shape: `https://<username>.github.io/<repository-name>/`. Everything is relative (`./`), the service worker scope is the repository folder, and a test (`tests/pages.test.js`) plus `npm run e2e` (served at `/repository-name`) prove it.
1. Repo → **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, folder `/ (root)`. Keep `.nojekyll` in the root.
2. Copy the contents of `ChronoPulse_4_2_Final.zip` into the repo root (index.html at the top level, not inside a subfolder), run `npm test`, commit, push.
3. Wait for the *pages build and deployment* Action to go green (Actions tab).
4. Open `https://<username>.github.io/<repository-name>/` in a fresh/private window. DevTools → Application → Service Workers: scope must be that exact URL; Cache Storage: `chronopulse-v4.2-4.2.5`.
5. Smoke test: run section 3's checklist; then go offline and reload.
6. Updating later: bump `VERSION` in `service-worker.js` (a test keeps it consistent), push; open tabs show *Update now*.
7. Range requests (206): for cached audio the service worker answers them itself, so it does not depend on the host; an uncached ranged request goes to GitHub Pages, which supports Range natively. (Only the local stand-in server was exercised here; github.io itself was not.)
8. Rollback: `git revert` the release commit and push; see section 4 for the data caveat.

## 8. Themes, streak freezes, badges and Insights charts (added in 4.2.5)
**Themes** (Settings → Appearance): Dark (default), OLED True Black (`#000000` page, no gradients), Cyberpunk Neon, Soft Pastel (light). Saved as `cfg.theme` inside the normal app data (`chronopulse:v4.1`, schema 7); `theme-boot.js` (synchronous, in `<head>`) applies it before the first paint so there is no flash of the wrong theme. Palettes live in `themes.css` (precached). Tests compute WCAG contrast from the real colour values for every theme. Limit: the installed app's *title-bar / splash colour* comes from `manifest.json` and cannot change per theme; only the in-browser bar colour follows the theme.

**Streak freezes**: up to 3 per calendar month (setting 0–3). A missed day inside a live streak is covered automatically while a freeze is left that month; frozen days keep the streak alive but do not add to the count; today is never frozen (open until midnight). Derived from existing data: nothing is stored apart from the setting. Shields on the streak sheet show what is left; frozen days appear ice-blue on the calendar.

**Badges**: Bronze 7, Silver 30, Gold 100 days, earned by the *longest* streak (never lost when a streak ends). Shown on the streak sheet and the Profile tab. The streak sheet also has a 7-day habit matrix.

**Insights** (More → Insights): focus bars (Mon–Sun, or 8 weeks) with a dashed daily-goal line (goal in the page, saved as `cfg.focusTargetMin`); 365-day heatmap; category donut with legend and percentages (new optional **Category** field on events; habits use their goal's category; tasks follow their linked habit; otherwise "Uncategorized"); progress rings (year / month / milestones). All inline SVG, no libraries, offline.

### Extra on-device checks for 4.2.5
- [ ] Settings → Appearance: switch through all four themes; each screen (Home, Settings, Insights, Streak sheet, a dialog) stays readable. On an AMOLED phone, OLED black looks truly black.
- [ ] Reload and reopen the installed app: the chosen theme is there from the first frame (no brief Dark flash).
- [ ] Streak sheet: three shields; miss a day on purpose (or set a test habit) and confirm a shield is used, not the streak.
- [ ] Insights: all four charts fit your narrowest phone without sideways page scroll (the heatmap scrolls inside its own box); airplane mode + reload still shows them.
- [ ] Add an event with a category; it appears in the donut.

## 4.2.5 Ultimate — what changed

- **Rocket finale:** ~45% of screen height, thruster fire, smoke plume, blast + shockwave, full-screen confetti (`cinema.js`; layout in `lib/lib47.js`). Particle counts are capped; the loop stops itself; calm/reduced-motion mode skips it.
- **Floating stopwatch & clock (`floaty.js`):** drifting, draggable, throwable icon; panel with stopwatch (start/pause/reset/laps) and analog + digital clock. Hide it in Settings. Own storage key `chronopulse:widget`.
- **Streak orbit (`orbit.js`):** unlocked badges orbit the flame. Milestones 7, 30, 100, 200, 300, then every 100 days without end. Flame glow levels 1–6.
- **Background reminders (`bgnotify.js` + service worker):** upcoming reminders go to the worker (IndexedDB `chronopulse-sw`). Delivery uses Notification Triggers where the browser has them, Periodic Background Sync for installed Chromium apps, otherwise only while the app is open or alive in the background. Settings states which mode applies. Never guaranteed when the app is closed; not available on iOS Safari or Firefox.
- **Notification toggle:** ignores double taps; follows permission changes made in browser settings.
- **Unified sound:** `X.alertSound('reminder' | 'task' | 'alert')` — system, Chime or your own file. The doomsday tick is countdown-only; an old saved "tick" choice becomes the Chime.
- **Charts:** empty Dashboard/Insights show one placeholder instead of 0-value grids. Header button cycles Dark, OLED, Neon, Pastel.
- **Version:** service worker `4.2.5`; older 4.2 caches are removed on activate.

Tests: `npm test` (391) and the Playwright suites in `e2e/` (phase3, streak, sound, ultimate, ultimate2, offline incl. sub-path).
