'use strict';
/* ChronoPulse 4.1 — offline visual helpers written for this project (no third-party libraries):
   CPFX.confetti  — canvas particle burst (replaces canvas-confetti), skipped under prefers-reduced-motion
   CPFX.barChart  — responsive SVG bar chart (replaces Chart.js)
   CPFX.card      — draws a share image on a canvas (replaces html2canvas; a purpose-built summary card, not a DOM capture) */
(function (root) {
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FONT = 'system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif';

  /* ---------- confetti ---------- */
  let cv = null, raf = 0, parts = [], onResize = null;
  function stopConfetti() { cancelAnimationFrame(raf); raf = 0; parts = []; if (onResize) removeEventListener('resize', onResize); onResize = null; if (cv) cv.remove(); cv = null; }
  function confetti(o = {}) {
    if (reduced()) return false;
    const colors = o.colors || ['#f97316', '#fb923c', '#22c55e', '#ffffff'], n = Math.min(o.particleCount || 100, 220), spread = (o.spread || 70) * Math.PI / 180, oy = o.origin && o.origin.y != null ? o.origin.y : .6;
    if (!cv) {
      cv = document.createElement('canvas'); cv.setAttribute('aria-hidden', 'true'); cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:120';
      const fit = () => { cv.width = innerWidth; cv.height = innerHeight; }; fit(); onResize = fit; addEventListener('resize', onResize); document.body.appendChild(cv);
    }
    const W = cv.width, H = cv.height;
    for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + (Math.random() - .5) * spread, v = 7 + Math.random() * 9; parts.push({ x: W / 2, y: H * oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, w: 5 + Math.random() * 6, h: 3 + Math.random() * 4, r: Math.random() * 6.28, vr: (Math.random() - .5) * .4, c: colors[i % colors.length], life: 0 }); }
    if (!raf) {
      const ctx = cv.getContext('2d'), step = () => {
        ctx.clearRect(0, 0, cv.width, cv.height);
        parts = parts.filter(p => (p.life += 1) < 150 && p.y < cv.height + 20);
        for (const p of parts) { p.vy += .32; p.vx *= .985; p.x += p.vx; p.y += p.vy; p.r += p.vr; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.globalAlpha = Math.max(0, 1 - p.life / 150); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore(); }
        if (parts.length) raf = requestAnimationFrame(step); else stopConfetti();
      };
      raf = requestAnimationFrame(step);
    }
    return true;
  }

  /* ---------- bar chart (SVG) ---------- */
  let uid = 0;
  const niceMax = v => { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };
  /* opts: labels[], values[], label (aria summary), unit, gradient (default true) | color, minSlot, height */
  function barChart(el, o) {
    const labels = o.labels || [], vals = o.values || [], n = labels.length;
    if (!el) return; if (!n) { el.innerHTML = ''; return; }
    const slot = Math.max(o.minSlot || 38, 0), left = 34, W = Math.max(300, left + n * slot + 8), H = o.height || 190, top = 20, base = H - 36, ph = base - top, max = niceMax(Math.max(...vals, 0)), id = 'cpg' + (++uid);
    const bw = Math.min(40, slot * .62), unit = o.unit || '';
    let g = `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="${base}" x2="0" y2="${top}"><stop offset="0" stop-color="#f97316"/><stop offset="1" stop-color="#22c55e"/></linearGradient></defs>`;
    [0, .5, 1].forEach(f => { const y = base - ph * f; g += `<line x1="${left}" x2="${W - 4}" y1="${y}" y2="${y}" stroke="#1f293d" stroke-width="1"/><text x="${left - 6}" y="${y + 4}" text-anchor="end" fill="#93a0b5" font-size="11" font-family='${FONT}'>${Number((max * f).toFixed(1))}</text>`; });
    vals.forEach((v, i) => {
      const cx = left + slot * i + slot / 2, h = Math.round(ph * (v / max)), lab = labels[i].length > (slot < 50 ? 6 : 12) ? labels[i].slice(0, slot < 50 ? 5 : 11) + '…' : labels[i];
      g += h > 0 ? `<rect x="${cx - bw / 2}" y="${base - h}" width="${bw}" height="${h}" rx="5" fill="${o.color || `url(#${id})`}"><title>${esc(labels[i])}: ${v}${unit ? ' ' + esc(unit) : ''}</title></rect>` : `<rect x="${cx - bw / 2}" y="${base - 2}" width="${bw}" height="2" rx="1" fill="#2a3750"/>`;
      g += `<text x="${cx}" y="${Math.max(12, base - h - 5)}" text-anchor="middle" fill="${v ? '#e8eef7' : '#93a0b5'}" font-size="11" font-weight="700" font-family='${FONT}'>${v}</text>`;
      g += `<text x="${cx}" y="${H - 14}" text-anchor="middle" fill="#93a0b5" font-size="11" font-family='${FONT}'>${esc(lab)}</text>`;
    });
    const aria = (o.label || 'Bar chart') + ': ' + labels.map((l, i) => `${l} ${vals[i]}${unit ? ' ' + unit : ''}`).join(', ');
    el.innerHTML = `<div class="chart-scroll"><svg class="bars" viewBox="0 0 ${W} ${H}" style="min-width:${n > 10 ? Math.min(W, 4000) : 0}px" role="img" aria-label="${esc(aria)}">${g}</svg></div>`;
  }

  /* ---------- share card (canvas 2D) ---------- */
  function wrap(ctx, text, x, y, maxW, lh) { const words = String(text).split(/\s+/); let line = '', yy = y; for (const w of words) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { ctx.fillText(line, x, yy); line = w; yy += lh; } else line = t; } ctx.fillText(line, x, yy); return yy + lh; }
  /* model: { heading, sub, big, bigLabel, pct (0-100|null), lines[], foot } → Promise<Blob> */
  function card(m) {
    const W = 1080, pad = 72, lines = m.lines || [], H = Math.max(900, 560 + lines.length * 70 + 140), c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'), bg = x.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#1a0f08'); bg.addColorStop(.35, '#0a0d14'); bg.addColorStop(1, '#0a0d14'); x.fillStyle = bg; x.fillRect(0, 0, W, H);
    x.strokeStyle = '#f97316'; x.lineWidth = 7; x.lineCap = 'round'; x.shadowColor = 'rgba(249,115,22,.7)'; x.shadowBlur = 24; x.beginPath(); x.arc(pad + 36, pad + 36, 34, 0, 6.2832); x.stroke(); x.beginPath(); x.moveTo(pad + 36, pad + 18); x.lineTo(pad + 36, pad + 38); x.lineTo(pad + 50, pad + 46); x.stroke(); x.shadowBlur = 0;
    x.fillStyle = '#e8eef7'; x.font = `800 44px ${FONT}`; x.textBaseline = 'alphabetic'; x.fillText('ChronoPulse', pad + 96, pad + 36); x.fillStyle = '#93a0b5'; x.font = `600 26px ${FONT}`; x.fillText(m.sub || '', pad + 96, pad + 72);
    let y = 330; x.fillStyle = '#fb923c'; x.font = `700 34px ${FONT}`; y = wrap(x, m.heading || '', pad, y, W - pad * 2, 44);
    if (m.big != null) { x.fillStyle = '#ffffff'; x.shadowColor = 'rgba(249,115,22,.6)'; x.shadowBlur = 30; x.font = `800 150px ${FONT}`; x.fillText(String(m.big), pad, y + 130); x.shadowBlur = 0; x.fillStyle = '#93a0b5'; x.font = `600 34px ${FONT}`; x.fillText(m.bigLabel || '', pad, y + 190); y += 240; }
    if (m.pct != null) { const bw = W - pad * 2; x.fillStyle = '#17223a'; x.beginPath(); x.roundRect ? x.roundRect(pad, y, bw, 18, 9) : x.rect(pad, y, bw, 18); x.fill(); const g = x.createLinearGradient(pad, 0, pad + bw, 0); g.addColorStop(0, '#f97316'); g.addColorStop(1, '#22c55e'); x.fillStyle = g; x.beginPath(); const fw = Math.max(18, bw * Math.min(100, Math.max(0, m.pct)) / 100); x.roundRect ? x.roundRect(pad, y, fw, 18, 9) : x.rect(pad, y, fw, 18); x.fill(); y += 90; }
    x.font = `600 34px ${FONT}`; for (const l of lines) { x.fillStyle = '#e8eef7'; y = wrap(x, l, pad, y, W - pad * 2, 46) + 20; }
    x.fillStyle = '#93a0b5'; x.font = `500 24px ${FONT}`; x.fillText(m.foot || '', pad, H - 56);
    return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('Image encoding failed')), 'image/png'));
  }
  root.CPFX = { confetti, barChart, card, esc };
})(typeof globalThis !== 'undefined' ? globalThis : this);
