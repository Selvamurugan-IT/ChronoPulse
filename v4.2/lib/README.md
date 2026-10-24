# ChronoPulse logic modules

These files are intentionally separate: `lib.js` contains shared date and validation helpers; `lib41.js` owns persisted state and configuration; `lib42.js` handles countdown/reminder rules; `lib43.js` handles cinematic phases and sound recipes; `lib44.js` handles streak calculations; `lib45.js` handles reminder sound settings/storage; `lib46.js` handles chart data/geometry; and `lib47.js` handles streak milestones, orbit/stopwatch/roaming and rocket layout calculations; and `lib48.js` handles PulseShift (date / time / date+time offset maths for the floating panel).

They are loaded in dependency order by `../index.html`, cached by `../service-worker.js`, and covered by the corresponding tests in `../tests/`. Do not delete or merge a module without moving its tests and updating all browser/CommonJS references.
