'use strict';
/* ChronoPulse 4.2 — Insights page: four charts drawn as inline SVG (no libraries, no network, works offline). All numbers/geometry come from CP46 (lib/lib46.js, unit-tested);
   this file only turns them into SVG. Colours are CSS variables, so every theme recolours the charts. User text (category names) is always escaped.
   Only one thing is saved: the daily focus goal (cfg.focusTargetMin), through the normal save function. */
(function () {
  const Q = CP46, esc = Q.esc; let range = 'week', rafId = 0;
  const hrs = m => (m < 60 ? `${Math.round(m)} min` : `${(Math.round(m / 6) / 10).toString()} h`);
  const dtitle = k => day(k).toLocaleDateString(undefined, { dateStyle: 'medium' });

  /* ---------- 1. focus bars ---------- */
  function renderFocus() {
    const t = S.cfg.focusTargetMin, d = range === 'week' ? Q.focusWeek(S, todayK(), t) : Q.focusWeeks(S, todayK(), 8, t), items = range === 'week' ? d.days : d.weeks;
    const W = 360, H = 230, L = 40, R = 10, T = 18, B = 30, pw = W - L - R, ph = H - T - B, y = h => T + ph * (1 - h / d.axis.maxH), slot = pw / items.length, bw = Math.min(30, slot * 0.62);
    let g = d.axis.ticks.map(v => `<line class="ch-grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}h</text>`).join('');
    items.forEach((it, i) => {
      const x = L + slot * i + (slot - bw) / 2, bh = it.future ? 3 : Math.max(it.min > 0 ? 3 : 0, ph * it.hours / d.axis.maxH), cls = 'ch-bar' + (it.metGoal ? ' met' : '') + (it.today || it.current ? ' today' : '') + (it.future ? ' fut' : '');
      g += `<rect class="${cls}" x="${x.toFixed(1)}" y="${(T + ph - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="5"><title>${esc(range === 'week' ? dtitle(it.key) : 'Week of ' + it.label)}: ${esc(hrs(it.min))}</title></rect>`;
      if (it.min > 0) g += `<text x="${(x + bw / 2).toFixed(1)}" y="${(T + ph - bh - 4).toFixed(1)}" text-anchor="middle">${esc(it.hours + 'h')}</text>`;
      g += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 10}" text-anchor="middle"${range === 'weeks' ? ' style="font-size:9px"' : ''}>${esc(it.label)}</text>`;
    });
    const goalTxt = range === 'week' ? `Daily goal ${hrs(d.targetMin)}` : `Weekly goal ${hrs(d.targetMin)}`;
    if (d.targetMin > 0) g += `<line class="ch-goal" x1="${L}" x2="${W - R}" y1="${y(d.targetMin / 60)}" y2="${y(d.targetMin / 60)}"/><text class="ch-goaltxt" x="${W - R}" y="${y(d.targetMin / 60) - 5}" text-anchor="end">${esc(goalTxt)}</text>`;
    const label = `${range === 'week' ? 'Focus hours per day, Monday to Sunday' : 'Focus hours per week, last 8 weeks'}. ${d.targetMin > 0 ? goalTxt + '.' : 'No goal set.'} ` + items.map(it => `${esc(it.label)}: ${hrs(it.min)}`).join(', ');
    $('#insFocus').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">${g}</svg>`;
    setT($('#insFocusSum'), range === 'week' ? `${hrs(d.totalMin)} this week${d.targetMin > 0 ? ` · daily goal met on ${d.goalDays} of ${d.days.filter(x => !x.future).length} days so far` : ''}` : `${hrs(d.totalMin)} over the last 8 weeks${d.targetMin > 0 ? ` · weekly goal ${hrs(d.targetMin)}` : ''}`);
    $('#insTarget').value = String(t);
    $$('#insFocusCard [data-range]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.range === range)));
  }

  /* ---------- 2. 365-day heatmap ---------- */
  function renderHeat() {
    const counts = CP44.activityCounts(S, todayK()), h = Q.heatmap(counts, todayK(), 365), C = 11, G = 3, st = C + G, L = 28, T = 18, W = L + h.cols.length * st, H = T + 7 * st;
    let g = h.months.map(m => `<text x="${L + m.col * st}" y="11">${esc(m.label)}</text>`).join('') + [1, 3, 5].map(r => `<text x="0" y="${T + r * st + 9}">${Q.DAYS[r - 1]}</text>`).join('');
    h.cols.forEach((col, ci) => col.forEach((c, ri) => { if (c) g += `<rect class="hc l${c.level}${c.today ? ' today' : ''}" x="${L + ci * st}" y="${T + ri * st}" width="${C}" height="${C}" rx="2.5"><title>${esc(dtitle(c.key))}: ${c.count} ${c.count === 1 ? 'activity' : 'activities'}</title></rect>`; }));
    const sum = h.activeDays ? `${h.total} activities on ${h.activeDays} of the last ${h.days} days · busiest day ${dtitle(h.best.key)} (${h.best.count})` : 'No activity recorded yet. Check in a habit, finish a task or a focus session to start filling the grid.';
    $('#insHeat').innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc('Activity heatmap, last 365 days. ' + sum)}">${g}</svg>`;
    setT($('#insHeatSum'), sum); const sc = $('#insHeatScroll'); sc.scrollLeft = sc.scrollWidth; /* newest weeks are on the right */
  }

  /* ---------- 3. category donut ---------- */
  function renderDonut() {
    const c = Q.categories(S), r = 62, { circ, segs } = Q.donutSegments(c.items, r);
    let g = `<circle cx="100" cy="100" r="${r}" fill="none" stroke="var(--line)" stroke-width="26"/>` + segs.map((s, i) => `<circle class="donut-seg" cx="100" cy="100" r="${r}" stroke="var(--c${c.items[i].color + 1})" stroke-dasharray="${s.len.toFixed(2)} ${s.gap.toFixed(2)}" stroke-dashoffset="${s.offset.toFixed(2)}" transform="rotate(-90 100 100)"><title>${esc(c.items[i].name)}: ${c.items[i].count} (${c.items[i].pct}%)</title></circle>`).join('');
    g += `<text class="donut-total" x="100" y="104" text-anchor="middle">${c.total}</text><text class="donut-sub" x="100" y="120" text-anchor="middle">${c.total === 1 ? 'item' : 'items'}</text>`;
    $('#insDonut').innerHTML = `<svg viewBox="0 0 200 200" role="img" aria-label="${c.total ? 'Items by category: ' + c.items.map(x => `${esc(x.name)} ${x.pct}%`).join(', ') : 'No categorised items yet'}">${g}</svg>`;
    $('#insLegend').innerHTML = c.items.length ? c.items.map(x => `<li><span class="dot" style="background:var(--c${x.color + 1})"></span><span class="nm" title="${esc(x.name)}">${esc(x.name)}</span><span class="ct">${x.count}</span><span class="pc">${x.pct}%</span></li>`).join('') : '<li class="hint">Add events, habits or tasks to see how they split up.</li>';
    setT($('#insCatSum'), c.total ? `${c.sources.events} events · ${c.sources.habits} habits · ${c.sources.tasks} tasks. Set a category on an event (Add Event → Category) or on a goal; tasks follow their linked habit.` : 'Nothing to chart yet.');
  }

  /* ---------- 4. progress rings ---------- */
  function renderRings() {
    const rs = Q.rings(new Date(), S), R = [90, 68, 46], col = ['--c1', '--c3', '--c2']; let g = '', targets = [];
    rs.forEach((r, i) => { const { circ, dash } = Q.ringDash(r.pct, R[i]); g += `<circle class="ring-bg" cx="110" cy="110" r="${R[i]}"/><circle class="ring-fg" cx="110" cy="110" r="${R[i]}" stroke="var(${col[i]})" transform="rotate(-90 110 110)" style="stroke-dasharray:0 ${circ.toFixed(2)}" data-dash="${dash.toFixed(2)}" data-circ="${circ.toFixed(2)}"><title>${esc(r.title)}</title></circle>`; });
    g += `<text class="ring-center" x="110" y="112" text-anchor="middle">${rs[0].pct}%</text><text class="ring-cs" x="110" y="128" text-anchor="middle">of ${new Date().getFullYear()}</text>`;
    $('#insRings').innerHTML = `<svg viewBox="0 0 220 220" role="img" aria-label="${rs.map(r => esc(r.title)).join('. ')}">${g}</svg>`;
    $('#insRingLegend').innerHTML = rs.map((r, i) => `<li><div class="t"><span class="dot" style="background:var(${col[i]})"></span>${esc(r.title)}</div><div class="s">${esc(r.sub)}</div></li>`).join('');
    $('#insRingLegend').className = 'legend rl';
    cancelAnimationFrame(rafId); rafId = requestAnimationFrame(() => { rafId = requestAnimationFrame(() => $$('#insRings .ring-fg').forEach(c => { c.style.strokeDasharray = `${c.dataset.dash} ${c.dataset.circ}`; })); }); /* animate from empty to the value */
  }

  function render() { try { const has = CP47.hasChartData(S); $('#tab-insights').classList.toggle('is-empty-charts', !has); $('#insEmpty').hidden = has; if (has) { renderFocus(); renderHeat(); renderDonut(); } renderRings(); } catch (e) { /* a chart problem must never affect the rest of the app */ } }
  X.render.insights = render;
  const prevSave = X.afterSave; X.afterSave = () => { if (prevSave) prevSave(); if (tab === 'insights') render(); };
  const prevState = X.onState; X.onState = () => { if (prevState) prevState(); if (tab === 'insights') render(); };
  $('#insFocusCard').addEventListener('click', e => { const b = e.target.closest('[data-range]'); if (b) { range = b.dataset.range; renderFocus(); } });
  $('#insTarget').addEventListener('change', e => { S.cfg.focusTargetMin = Q.targetOf(e.target.value); save(); renderFocus(); });
  X.insights = { render };
})();
