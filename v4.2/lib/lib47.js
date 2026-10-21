'use strict';
/* ChronoPulse 4.2.x — pure logic for the Ultimate additions (no DOM, never throws on junk, deterministic). Loaded as a classic script (window.CP47) and via require() in Node tests.
   Covers: infinite streak milestones, orbit geometry for the streak sheet, stopwatch + clock maths, the roaming widget physics, rocket-launch layout,
   the notification schedule handed to the service worker, sound routing (what plays for which alert) and the "is there any data to chart" check. */
(function (root) {
  const fin = (n, d = 0) => (Number.isFinite(+n) ? +n : d), clamp = (n, a, b) => Math.min(b, Math.max(a, fin(n, a)));

  /* ---------- 1. streak milestones: 7, 30, 100, 200, 300, then every 100 days without end ---------- */
  const BASE = [
    { id: 'bronze', name: 'Bronze', days: 7, tier: 1 }, { id: 'silver', name: 'Silver', days: 30, tier: 2 }, { id: 'gold', name: 'Gold', days: 100, tier: 3 },
    { id: 'diamond', name: 'Diamond', days: 200, tier: 4 }, { id: 'legend', name: 'Legend', days: 300, tier: 5 }
  ];
  const STEP = 100, MAX_ORBIT = 12;
  /* Milestone number k (0-based). Beyond Legend 300 every further 100 days is a new "Legend II, III, ..." milestone, so there is always a next goal. */
  function milestone(k) {
    k = Math.max(0, Math.floor(fin(k)));
    if (k < BASE.length) return { ...BASE[k] };
    const n = k - BASE.length + 2; /* Legend 300 is the first Legend, so the next is "Legend II" at 400 */
    return { id: 'legend' + n, name: 'Legend ' + roman(n), days: BASE[BASE.length - 1].days + (k - BASE.length + 1) * STEP, tier: 5 + Math.min(n - 1, 5) };
  }
  function roman(n) {
    const t = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]; let s = ''; n = Math.max(1, Math.floor(fin(n, 1)));
    for (const [v, r] of t) while (n >= v) { s += r; n -= v; } return s;
  }
  /* Every milestone already reached by the LONGEST streak plus the next locked one (never takes a badge away once earned). */
  function milestones(longest) {
    const have = Math.max(0, Math.floor(fin(longest))), out = [];
    for (let k = 0; k < 10000; k++) { const m = milestone(k), on = have >= m.days; out.push({ ...m, unlocked: on, have: Math.min(have, m.days), left: Math.max(0, m.days - have), pct: Math.min(100, Math.floor(Math.min(have, m.days) / m.days * 100)) }); if (!on) break; }
    return out;
  }
  /* flame glow escalates with the current streak (0 = cold). 1..6 */
  function glowLevel(days) { const d = Math.max(0, fin(days)); return d >= 500 ? 6 : d >= 300 ? 5 : d >= 200 ? 4 : d >= 100 ? 3 : d >= 30 ? 2 : d >= 7 ? 1 : 0; }

  /* ---------- 2. orbit system: positions of the badges around the flame at time t (ms) ---------- */
  /* Unlocked badges only (plus none of the locked ones). Badges are spread over up to 3 rings; inner rings turn faster (Kepler-like). Elliptical, tilted for a 3D feel. */
  function orbitLayout(list) {
    const on = (Array.isArray(list) ? list : []).filter(b => b && b.unlocked).slice(-MAX_ORBIT), rings = on.length <= 3 ? 1 : on.length <= 7 ? 2 : 3, per = Math.ceil(on.length / rings) || 1;
    return on.map((b, i) => { const ring = Math.min(rings - 1, Math.floor(i / per)), idx = i - ring * per, inRing = Math.min(per, on.length - ring * per); return { id: b.id, name: b.name, days: b.days, tier: b.tier, ring, phase: (idx / inRing) * Math.PI * 2 + ring * 0.7, rx: 0.52 + ring * 0.2, ry: 0.2 + ring * 0.075, speed: 0.00022 / (1 + ring * 0.55) }; });
  }
  /* position in unit space (-1..1) for a layout item at time t; z in -1..1 (front/back, used for scale + draw order) */
  function orbitPos(it, t) { const a = it.phase + fin(t) * it.speed * 2 * Math.PI / 1, c = Math.cos(a), s = Math.sin(a); return { x: c * it.rx, y: s * it.ry, z: s, scale: 0.78 + 0.22 * ((s + 1) / 2), a }; }

  /* ---------- 3. stopwatch ---------- */
  /* state: { running, startedAt, acc, laps:[ms totals] }; all time comes in as `now` so it is testable and immune to timer throttling */
  const SW0 = () => ({ running: false, startedAt: 0, acc: 0, laps: [] });
  const swElapsed = (s, now) => (s && s.running ? fin(s.acc) + Math.max(0, fin(now) - fin(s.startedAt)) : fin(s && s.acc));
  const swStart = (s, now) => (s.running ? s : { ...s, running: true, startedAt: fin(now) });
  const swPause = (s, now) => (s.running ? { ...s, running: false, acc: swElapsed(s, now), startedAt: 0 } : s);
  const swReset = () => SW0();
  const MAX_LAPS = 200;
  function swLap(s, now) { const t = swElapsed(s, now); if (!s.running || t <= 0 || s.laps.length >= MAX_LAPS) return s; return { ...s, laps: [...s.laps, t] }; }
  /* "mm:ss.cc" or "h:mm:ss.cc" */
  function fmtMs(ms) { ms = Math.max(0, Math.floor(fin(ms))); const cs = Math.floor(ms / 10) % 100, s = Math.floor(ms / 1000) % 60, m = Math.floor(ms / 60000) % 60, h = Math.floor(ms / 3600000), p = n => String(n).padStart(2, '0'); return (h ? h + ':' + p(m) : p(m)) + ':' + p(s) + '.' + p(cs); }
  function lapRows(s) { const L = (s && s.laps) || []; const split = L.map((t, i) => t - (i ? L[i - 1] : 0)); let best = -1, worst = -1; if (split.length > 1) { best = split.indexOf(Math.min(...split)); worst = split.indexOf(Math.max(...split)); } return L.map((t, i) => ({ n: i + 1, total: t, split: split[i], best: i === best, worst: i === worst })).reverse(); }

  /* ---------- 4. analog / digital clock ---------- */
  function clockHands(d) { const h = d.getHours() % 12, m = d.getMinutes(), s = d.getSeconds(), ms = d.getMilliseconds(); const sec = s + ms / 1000, min = m + sec / 60, hr = h + min / 60; return { hour: hr * 30, minute: min * 6, second: sec * 6 }; }
  function digital(d, h24) { const p = n => String(n).padStart(2, '0'); let h = d.getHours(); const suf = h24 ? '' : h >= 12 ? ' PM' : ' AM'; if (!h24) h = h % 12 || 12; return `${p(h)}:${p(d.getMinutes())}:${p(d.getSeconds())}${suf}`; }

  /* ---------- 5. roaming widget: smooth wander + bounce, drag, throw ---------- */
  /* p = { x, y, vx, vy } in px (top-left of the widget). Returns the next p inside [0..W-size]x[0..H-size]. dt in ms (clamped so a background tab never teleports it). */
  function roamStep(p, dt, box, rnd) {
    const k = clamp(dt, 0, 50) / 16.67, W = Math.max(0, fin(box.w) - fin(box.size)), H = Math.max(0, fin(box.h) - fin(box.size)); let { x, y, vx, vy } = p;
    const turn = (rnd ? rnd() : 0.5) - 0.5; /* tiny random steer so the path curves instead of ping-ponging */
    const sp = Math.hypot(vx, vy) || 0.0001, ang = Math.atan2(vy, vx) + turn * 0.06 * k, target = fin(box.speed, 0.45), nsp = sp + (target - sp) * 0.04 * k;
    vx = Math.cos(ang) * nsp; vy = Math.sin(ang) * nsp; x += vx * k; y += vy * k;
    if (x < 0) { x = 0; vx = Math.abs(vx); } else if (x > W) { x = W; vx = -Math.abs(vx); }
    if (y < 0) { y = 0; vy = Math.abs(vy); } else if (y > H) { y = H; vy = -Math.abs(vy); }
    return { x, y, vx, vy };
  }
  const clampPos = (x, y, box) => ({ x: clamp(x, 0, Math.max(0, fin(box.w) - fin(box.size))), y: clamp(y, 0, Math.max(0, fin(box.h) - fin(box.size))) });
  /* release velocity of a drag from the last few pointer samples [{x,y,t}], capped so a flick cannot make it race */
  function throwVelocity(samples, cap = 2.2) { const s = (samples || []).filter(Boolean).slice(-4); if (s.length < 2) return { vx: 0, vy: 0 }; const a = s[0], b = s[s.length - 1], dt = Math.max(1, b.t - a.t) / 16.67; let vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt; const m = Math.hypot(vx, vy); if (m > cap) { vx *= cap / m; vy *= cap / m; } return { vx, vy }; }
  /* a tap is a pointer that barely moved; anything bigger is a drag and must not open the panel */
  const isTap = (dx, dy, tol = 6) => Math.hypot(fin(dx), fin(dy)) <= tol;

  /* ---------- 6. rocket launch layout ---------- */
  /* Rocket height = 45% of the shorter side of the screen (rocket is ~1.7x taller than wide, so it fills 40-50% of the viewport height on phones and desktop). */
  function rocketLayout(W, H) {
    W = Math.max(1, fin(W, 1)); H = Math.max(1, fin(H, 1)); const hFrac = 0.46, bodyH = Math.min(H * hFrac, W * 0.95), s = bodyH / 1.7; /* `s` is the drawRocket unit: nose to tail = 1.7 s */
    return { s, bodyH, yStart: H + s * 1.2, yEnd: H * 0.36, x0: W / 2 };
  }
  /* particle budgets (hard caps keep phones smooth) */
  const CAPS = { fire: 140, smoke: 170, spark: 320, confetti: 260 };

  /* ---------- 7. notification schedule for the service worker ---------- */
  /* Events -> [{ id, tag, at, title, body, eventId }] for reminders that are still in the future, soonest first, capped. `reminderAt(ev)` is supplied by the caller
     (CP42 knows each event's reminder offsets) so this module stays independent of how reminders are defined. */
  const MAX_SCHEDULED = 40, HORIZON_MS = 14 * 864e5;
  function buildSchedule(items, now, hideTitles) {
    const out = [], seen = new Set();
    for (const it of Array.isArray(items) ? items : []) {
      if (!it || typeof it.id !== 'string' || !Number.isFinite(+it.at) || +it.at <= now || +it.at > now + HORIZON_MS) continue;
      const tag = String(it.tag || it.id).slice(0, 80); if (seen.has(tag)) continue; seen.add(tag);
      out.push({ id: String(it.id).slice(0, 60), tag, at: Math.floor(+it.at), title: hideTitles ? 'ChronoPulse reminder' : String(it.title || 'ChronoPulse').slice(0, 80), body: hideTitles ? 'An event reminder is due.' : String(it.body || '').slice(0, 140), eventId: it.eventId === '' ? '' : String(it.eventId || it.id).slice(0, 60) });
    }
    return out.sort((a, b) => a.at - b.at).slice(0, MAX_SCHEDULED);
  }
  /* inside the service worker: which stored entries are due now (up to `grace` late) and which have expired */
  function splitDue(list, now, grace = 10 * 60e3) {
    const due = [], keep = [], dropped = [];
    for (const e of Array.isArray(list) ? list : []) { if (!e || !Number.isFinite(+e.at)) continue; if (+e.at <= now && now - +e.at <= grace) due.push(e); else if (+e.at > now) keep.push(e); else dropped.push(e); }
    return { due, keep, dropped };
  }

  /* ---------- 8. unified sound routing ---------- */
  /* Categories that play an alert sound; the countdown tick is NOT one of them: doomsday-tick.mp3 is reserved for the Countdown screen. */
  const CATEGORIES = ['reminder', 'task', 'alert'], ALERT_MODES = ['system', 'chime', 'custom'];
  function alertMode(cfgMode, hasCustom) { let m = cfgMode === 'tick' ? 'chime' : cfgMode; if (!ALERT_MODES.includes(m)) m = 'system'; if (m === 'custom' && !hasCustom) return { mode: 'system', missing: true }; return { mode: m, missing: false }; }
  const alertUrl = mode => (mode === 'chime' ? 'assets/chime.wav' : '');

  /* ---------- 9. charts: is there anything to draw? ---------- */
  function hasChartData(S) {
    if (!S || typeof S !== 'object') return false; const a = x => (Array.isArray(x) ? x : []);
    if (a(S.sessions).some(s => s && s.type === 'focus' && s.status === 'completed' && fin(s.actualSec) > 0)) return true;
    if (a(S.todos).some(t => t && t.doneOn)) return true;
    for (const g of a(S.goals)) for (const h of a(g && g.tasks)) if (h && a(h.h).length) return true;
    return false;
  }

  const api = { BASE, STEP, MAX_ORBIT, MAX_LAPS, MAX_SCHEDULED, HORIZON_MS, CATEGORIES, ALERT_MODES, CAPS, roman, milestone, milestones, glowLevel, orbitLayout, orbitPos, SW0, swElapsed, swStart, swPause, swReset, swLap, fmtMs, lapRows, clockHands, digital, roamStep, clampPos, throwVelocity, isTap, rocketLayout, buildSchedule, splitDue, alertMode, alertUrl, hasChartData };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CP47 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
