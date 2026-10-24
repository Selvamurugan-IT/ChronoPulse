'use strict';
/* lib/lib48.js: PulseShift — date / time / date+time offset maths for the floating panel. Pure (no DOM, no storage); loaded as window.CP48 and via require() in Node tests.
   All maths uses the native Date in LOCAL time, so month ends, leap years and DST are handled by the platform:
   - Date mode: whole days are added with setDate() on a local-midnight Date, so a DST change can never move the result by a day.
   - Time mode: the time of day wraps around midnight; the result also says how many days it rolled (e.g. 23:30 + 1h => 00:30, +1 day).
   - Date+Time mode: days are added on the calendar (setDate: wall-clock time is preserved across DST), then hours and minutes are added as real elapsed time. */
(function (root) {
  const MODES = ['date', 'time', 'datetime'], DIRS = ['past', 'future'];
  const FIELDS = { date: ['days'], time: ['hours', 'minutes', 'seconds'], datetime: ['days', 'hours', 'minutes'] };
  const MAX = 999999, YMIN = 1000, YMAX = 9999;
  const pad = (n, l = 2) => String(n).padStart(l, '0');
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], WDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  /* a stepper value: whole number 0..MAX, anything else (empty, NaN, negative, decimal text) becomes 0 / is floored */
  function clampN(v, max = MAX) { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 0; }
  const modeOf = m => (MODES.includes(m) ? m : 'date');
  const dirOf = d => (DIRS.includes(d) ? d : 'future');
  const sign = d => (dirOf(d) === 'past' ? -1 : 1);
  const inputType = m => ({ date: 'date', time: 'time', datetime: 'datetime-local' })[modeOf(m)];
  const fieldsOf = m => FIELDS[modeOf(m)].slice();

  /* strict parsers: return null for anything not exactly what the matching <input> produces */
  function parseDate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3], t = new Date(y, mo - 1, d); t.setFullYear(y);
    return y >= YMIN && t.getFullYear() === y && t.getMonth() === mo - 1 && t.getDate() === d ? { y, mo, d } : null;
  }
  function parseTime(s) {
    const m = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(String(s || '')); if (!m) return null;
    const h = +m[1], mi = +m[2], se = m[3] === undefined ? 0 : +m[3]; return h < 24 && mi < 60 && se < 60 ? { h, mi, se } : null;
  }
  function parseDateTime(s) {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/.exec(String(s || '')); if (!m) return null;
    const d = parseDate(m[1]), t = parseTime(m[2]); return d && t ? { ...d, ...t } : null;
  }
  const mk = (y, mo, d, h = 0, mi = 0, se = 0) => { const t = new Date(y, mo - 1, d, h, mi, se, 0); t.setFullYear(y); return t; };

  /* formatters: values that go back into <input>s (ISO-like, local) and human-readable text */
  const fmtDate = t => `${pad(t.getFullYear(), 4)}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  const fmtTime = (t, secs) => `${pad(t.getHours())}:${pad(t.getMinutes())}${secs ? ':' + pad(t.getSeconds()) : ''}`;
  const fmtDateTime = t => `${fmtDate(t)}T${fmtTime(t, false)}`;
  const human = t => `${WDAYS[t.getDay()]}, ${t.getDate()} ${MONTHS[t.getMonth()]} ${t.getFullYear()}`;
  function human12(t, secs) { const h = t.getHours(), h12 = h % 12 || 12; return `${h12}:${pad(t.getMinutes())}${secs ? ':' + pad(t.getSeconds()) : ''} ${h < 12 ? 'AM' : 'PM'}`; }

  /* "current" values for filling the base field when the mode changes */
  function nowValue(mode, now) {
    const t = now instanceof Date ? now : new Date(now === undefined ? Date.now() : now), m = modeOf(mode);
    return m === 'date' ? fmtDate(t) : m === 'time' ? fmtTime(t, true) : fmtDateTime(t);
  }

  /* the offsets object for a mode keeps only that mode's fields, each clamped */
  function normOffsets(mode, off) { const o = {}, src = off && typeof off === 'object' ? off : {}; for (const f of fieldsOf(mode)) o[f] = clampN(src[f]); return o; }

  /* main entry. input: { mode, base, direction, offsets }. Returns { ok:true, ... } or { ok:false, reason } where reason is 'base' (missing / invalid) or 'range' (result outside years 1000-9999). */
  function shift(input) {
    const inp = input && typeof input === 'object' ? input : {}, mode = modeOf(inp.mode), dir = dirOf(inp.direction), sg = sign(dir), off = normOffsets(mode, inp.offsets);
    let b, out, dayDelta = 0, copy, main, sub;
    if (mode === 'date') {
      b = parseDate(inp.base); if (!b) return { ok: false, reason: 'base' };
      out = mk(b.y, b.mo, b.d); out.setDate(out.getDate() + sg * off.days); if (!yearOk(out)) return { ok: false, reason: 'range' };
      dayDelta = sg * off.days; main = human(out); sub = fmtDate(out); copy = `${human(out)} (${fmtDate(out)})`;
    } else if (mode === 'time') {
      b = parseTime(inp.base); if (!b) return { ok: false, reason: 'base' };
      const total = sg * (off.hours * 3600 + off.minutes * 60 + off.seconds), start = b.h * 3600 + b.mi * 60 + b.se, raw = start + total;
      dayDelta = Math.floor(raw / 86400); const sec = ((raw % 86400) + 86400) % 86400;
      out = mk(2000, 1, 1, Math.floor(sec / 3600), Math.floor((sec % 3600) / 60), sec % 60);
      main = human12(out, true); sub = fmtTime(out, true) + (dayDelta ? ` · ${dayDelta > 0 ? '+' : '−'}${Math.abs(dayDelta)} day${Math.abs(dayDelta) === 1 ? '' : 's'}` : ''); copy = `${fmtTime(out, true)} (${human12(out, true)})` + (dayDelta ? ` ${dayDelta > 0 ? '+' : '-'}${Math.abs(dayDelta)}d` : '');
    } else {
      b = parseDateTime(inp.base); if (!b) return { ok: false, reason: 'base' };
      out = mk(b.y, b.mo, b.d, b.h, b.mi, b.se); if (!yearOk(out)) return { ok: false, reason: 'range' };
      out.setDate(out.getDate() + sg * off.days);
      out = new Date(out.getTime() + sg * (off.hours * 3600e3 + off.minutes * 60e3)); if (!yearOk(out)) return { ok: false, reason: 'range' };
      dayDelta = Math.round((Date.UTC(out.getFullYear(), out.getMonth(), out.getDate()) - Date.UTC(b.y, b.mo - 1, b.d)) / 864e5);
      main = `${human(out)}, ${human12(out, false)}`; sub = fmtDateTime(out).replace('T', ' '); copy = `${human(out)}, ${human12(out, false)} (${fmtDateTime(out).replace('T', ' ')})`;
    }
    const signChar = sg < 0 ? '−' : '+', parts = fieldsOf(mode).filter(f => off[f] > 0).map(f => `${off[f]} ${off[f] === 1 ? f.slice(0, -1) : f}`);
    return { ok: true, mode, direction: dir, offsets: off, value: mode === 'date' ? fmtDate(out) : mode === 'time' ? fmtTime(out, true) : fmtDateTime(out), date: out, dayDelta, main, sub, copy,
      summary: parts.length ? `${signChar} ${parts.join(', ')}` : 'No offset', zero: !parts.length };
  }
  const yearOk = t => Number.isFinite(t.getTime()) && t.getFullYear() >= YMIN && t.getFullYear() <= YMAX;

  const api = { MODES, DIRS, FIELDS, MAX, clampN, modeOf, dirOf, inputType, fieldsOf, parseDate, parseTime, parseDateTime, fmtDate, fmtTime, fmtDateTime, human, human12, nowValue, normOffsets, shift };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CP48 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
