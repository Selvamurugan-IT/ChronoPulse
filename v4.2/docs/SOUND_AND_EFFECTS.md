# ChronoPulse 4.2 — Sound & cinematic countdown (Phase 3)

## What the user gets
| Moment | Visual | Sound / haptic (all optional) |
|---|---|---|
| **Final minute** (≤ 60 s) | Hero card pulses red, "Final minute" label | Two-tone warning once per target (switch: *Final-minute warning sound*); short buzz if Vibration is on |
| **Final ten seconds** (≤ 10 s) | Huge digit 10 → 1 over the page (never blocks taps) | Per digit: *Silent / Ticking / Beep / Rising synth*; buzz on the last 3 digits if Vibration is on |
| **Completion** | Full-screen overlay: rocket launch (1.4 s) → explosion + shock-ring + two smaller bursts | Synthesized *Cinematic impact*, *Bright fanfare* or *Soft pulse*; buzz pattern if Vibration is on |

Overlay controls: **Replay**, **Mute** (this celebration only), **Reduce motion** (saved), **Close** (also Esc). Settings → *Sound & effects*: master Sound switch (the existing `S.sound`), volume, celebration sound + Preview, final-ten style + Preview, warning switch + Preview, Vibration (only shown enabled where `navigator.vibrate` exists), Reduce effect motion, and *Preview the full celebration* (completes nothing).

## How it is built (and where it is tested)
- `lib/lib43.js` (pure): phase planning, once-only guards, completion claim, volume curve, sound recipes. → `tests/lib43.test.js`
- `sfx.js`: Web Audio synthesis (no audio files, works offline); gesture-gated; every failure swallowed. → `tests/sfx.test.js`
- `cinema.js`: DOM runtime (visuals, overlay, settings). → `tests/cinema-wiring.test.js`, `e2e/phase3.e2e.py`
- Settings live in `S.cfg.fx*` (additive, validated by `cfgOf`). **Schema stays 7**, key stays `chronopulse:v4.1`; older data/backups get defaults.

## Guarantees
- **Once only.** Warning: once per `id|target`. Digits: each of 10..1 at most once; a throttled frame gives one beep, never a burst; a clock moved backwards repeats nothing. Celebration: the persisted `completed === at` flag (Phase 1) **plus** `claimOnce()` (a persisted `id|at` token list shared across tabs). Editing the target re-arms. *Replay* is an explicit user action and does not count as a completion.
- **Autoplay policy.** No `AudioContext` exists until a real gesture (`pointerup/touchend/mousedown/keydown/click`). Before that, sound is skipped and a hint says "Tap anywhere once…". On return to the app (`visibilitychange`/`pageshow`) the engine is asked to resume; if the browser still wants a tap (typical on iOS) the hint stays until the next tap.
- **Timers never break.** `tick()`, `completed()`, `sound()` and `buzz()` catch everything; E2E forces audio to throw mid-countdown and the digits and completion still run.
- **Hidden page.** A completion while the page is hidden is deferred; if the user returns within 5 min it plays, otherwise a toast says it reached its target.
- **Reduced motion.** Device setting always wins; the in-app switch adds to it. Calm mode = no canvas, message shown at once, sound starts at the impact.
- **Offline.** `doomsday-tick.mp3` and `assets/chime.wav` are in `PRECACHE`; the service worker turns cached 200s into correct `206` replies for Range requests (tests: `tests/sw-audio.test.js`; real browser offline: `e2e/offline.e2e.py`).

## What it does NOT do (do not claim otherwise)
- **No custom sound or vibration while the app is closed, in the background, or the phone is locked.** Nothing runs then; only the phone's own notification sound or a calendar `.ics` alarm can alert the user (Phase 2).
- Browsers may keep audio blocked until a tap; iPhone's silent switch / volume buttons may mute or override Web Audio and ignore `audio.volume`; iOS Safari has no Vibration API. These need the on-device checklist in `RELEASE_GUIDE.md` — a desktop browser cannot prove them.
- If a countdown is first seen already inside the final minute *before* the first tap, the warning tone is skipped (it cannot play yet) and is not replayed later.
