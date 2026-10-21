'use strict';
/* ChronoPulse 4.2.x — orbit system in the Streak sheet. Every unlocked streak badge (Bronze, Silver, Gold, Diamond, Legend, Legend II, ...) revolves around the flame
   like an electron around a nucleus: tilted elliptical rings, glowing fading trails, front/back depth, inner rings faster. Tap or hover a badge to read its name.
   Geometry comes from CP47.orbitLayout/orbitPos (unit-tested). The loop runs only while the sheet is open, the tab is visible and motion is allowed (otherwise one still frame). */
(function () {
  const Q = CP47, host = $('#stkOrbit'), cv = $('#stkOrbitCv'), dlg = $('#streakDlg'); if (!host || !cv || !dlg) return;
  const TIER = { 1: ['#cd7f32', '#f0b27a'], 2: ['#cbd5e1', '#ffffff'], 3: ['#fbbf24', '#fff3b0'], 4: ['#38e8ff', '#d9fbff'], 5: ['#e879f9', '#fbe1ff'], 6: ['#fb7185', '#ffe0e6'], 7: ['#a3e635', '#f0ffd0'], 8: ['#60a5fa', '#e0efff'], 9: ['#f97316', '#ffe3cc'], 10: ['#ffffff', '#fff7d6'] };
  const dpr = () => Math.min(window.devicePixelRatio || 1, 2), osRm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  let layout = [], trails = new Map(), raf = 0, W = 0, H = 0, t0 = 0, hit = [], picked = '', list = [], current = 0;
  const ctx = cv.getContext('2d');

  function fit() { const r = host.getBoundingClientRect(); W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height)); const d = dpr(); cv.width = Math.round(W * d); cv.height = Math.round(H * d); cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
  const col = tier => TIER[Math.min(10, Math.max(1, tier))] || TIER[1];

  function draw(now) {
    const t = now - t0, d = dpr(), cx = W / 2, cy = H / 2, ax = W / 2 - 22, ay = H / 2 - 14; ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, W, H); hit = [];
    const glow = Q.glowLevel(current);
    /* nucleus halo: grows with the streak */
    const hr = 46 + glow * 9, g = ctx.createRadialGradient(cx, cy + 6, 4, cx, cy + 6, hr * 1.8); g.addColorStop(0, `rgba(249,115,22,${0.22 + glow * 0.05})`); g.addColorStop(1, 'rgba(249,115,22,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const rings = [...new Set(layout.map(i => i.ring))]; if (!rings.length) rings.push(0);
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(-0.12); ctx.lineWidth = 1; ctx.setLineDash([2, 6]); ctx.strokeStyle = 'rgba(255,255,255,.2)';
    for (const r of rings) { ctx.beginPath(); ctx.ellipse(0, 0, ax * (0.52 + r * 0.2) / 0.92, ay * (0.2 + r * 0.075) / 0.4, 0, 0, 6.2832); ctx.stroke(); } ctx.restore(); ctx.setLineDash([]);
    const items = layout.map(it => { const p = Q.orbitPos(it, t), rot = -0.12, rx = p.x / 0.92 * ax, ry = p.y / 0.4 * ay; return { it, p, x: cx + rx * Math.cos(rot) - ry * Math.sin(rot), y: cy + rx * Math.sin(rot) + ry * Math.cos(rot) }; });
    /* trails (fading comet tail from recent positions) */
    ctx.globalCompositeOperation = 'lighter';
    for (const o of items) { const tr = trails.get(o.it.id) || []; tr.push({ x: o.x, y: o.y }); if (tr.length > 26) tr.shift(); trails.set(o.it.id, tr); const [c1] = col(o.it.tier); for (let i = 1; i < tr.length; i++) { ctx.globalAlpha = i / tr.length * 0.55; ctx.strokeStyle = c1; ctx.lineWidth = 1 + i / tr.length * 4 * o.p.scale; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(tr[i - 1].x, tr[i - 1].y); ctx.lineTo(tr[i].x, tr[i].y); ctx.stroke(); } }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    /* back half first, the flame (DOM) sits above the canvas so "behind" badges are dimmed instead */
    items.sort((a, b) => a.p.z - b.p.z);
    for (const o of items) {
      const [c1, c2] = col(o.it.tier), rad = (15 + Math.min(4, o.it.tier)) * o.p.scale, back = o.p.z < 0; ctx.globalAlpha = back ? 0.62 : 1;
      const gl = ctx.createRadialGradient(o.x, o.y, rad * .4, o.x, o.y, rad * 2.1); gl.addColorStop(0, c1 + '99'); gl.addColorStop(1, c1 + '00'); ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(o.x, o.y, rad * 2.1, 0, 6.2832); ctx.fill();
      const mg = ctx.createRadialGradient(o.x - rad * .35, o.y - rad * .4, rad * .1, o.x, o.y, rad); mg.addColorStop(0, c2); mg.addColorStop(1, c1); ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(o.x, o.y, rad, 0, 6.2832); ctx.fill();
      ctx.lineWidth = o.it.id === picked ? 3 : 1.5; ctx.strokeStyle = o.it.id === picked ? '#fff' : 'rgba(0,0,0,.35)'; ctx.stroke();
      ctx.fillStyle = '#2a1500'; ctx.font = `800 ${Math.round(rad * (String(o.it.days).length > 3 ? .72 : .86))}px system-ui,-apple-system,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(o.it.days), o.x, o.y + 1);
      hit.push({ id: o.it.id, name: o.it.name, days: o.it.days, x: o.x, y: o.y, r: rad + 6 });
    }
    ctx.globalAlpha = 1;
  }
  function frame(now) { raf = 0; if (!dlg.open || document.hidden) return; draw(now); if (!osRm()) raf = requestAnimationFrame(frame); }
  function start() { cancelAnimationFrame(raf); raf = 0; if (!dlg.open) return; fit(); t0 = performance.now() - 8000; trails.clear(); raf = requestAnimationFrame(frame); }
  function stop() { cancelAnimationFrame(raf); raf = 0; trails.clear(); }

  /* called by streak-ui.js whenever the sheet is rendered */
  function set(info) {
    current = info.current | 0; list = Q.milestones(info.longest); layout = Q.orbitLayout(list); const un = list.filter(b => b.unlocked), next = list.find(b => !b.unlocked);
    host.dataset.count = String(layout.length); host.dataset.glow = String(Q.glowLevel(current));
    const txt = un.length ? `${un.length} badge${un.length === 1 ? '' : 's'} orbiting your streak: ${un.map(b => b.name + ' (' + b.days + ' days)').join(', ')}.` : 'No badges yet. Reach a 7-day streak to launch your first one into orbit.';
    setT($('#stkOrbitNote'), (picked ? '' : txt) + (next && !picked ? ` Next: ${next.name} at ${next.days} days, ${next.left} to go.` : '')); host.setAttribute('role', 'img'); host.setAttribute('aria-label', txt);
    if (dlg.open && !raf) { if (osRm()) { fit(); draw(performance.now() - 8000 + 8000); } else start(); }
  }
  function pick(e) {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; const h = hit.slice().reverse().find(o => Math.hypot(o.x - x, o.y - y) <= o.r);
    picked = h ? h.id : ''; cv.style.cursor = h ? 'pointer' : ''; if (e.type === 'click' || e.type === 'pointerdown') { setT($('#stkOrbitNote'), h ? `${h.name} badge · ${h.days}-day streak, unlocked` : ''); if (!h) setT($('#stkOrbitNote'), ''); if (osRm()) draw(0); }
  }
  cv.style.pointerEvents = 'auto'; cv.addEventListener('pointermove', pick); cv.addEventListener('click', pick); cv.addEventListener('pointerleave', () => { picked = ''; });
  dlg.addEventListener('close', stop); new MutationObserver(() => { if (dlg.open) start(); }).observe(dlg, { attributes: true, attributeFilter: ['open'] });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && dlg.open && !raf && !osRm()) raf = requestAnimationFrame(frame); }); addEventListener('resize', () => { if (dlg.open) start(); });
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => { if (dlg.open) start(); });
  X.orbit = { set, start, stop, layout: () => layout.map(i => i.id), hits: () => hit.slice() };
})();
