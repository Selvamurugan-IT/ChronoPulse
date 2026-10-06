document.addEventListener('DOMContentLoaded', () => {
  let audioEnabled = true;
  let initialStartTime = Date.now();
  let confettiFired = false;

  // Audio Toggle
  const audioBtn = document.getElementById('audioBtn');
  audioBtn.addEventListener('click', () => {
    audioEnabled = !audioEnabled;
    document.getElementById('audioIcon').innerText = audioEnabled ? '🔊' : '🔇';
    document.getElementById('audioText').innerText = audioEnabled ? 'Audio On' : 'Audio Off';
  });

  // Share Clipboard
  document.getElementById('shareBtn').addEventListener('click', () => {
    navigator.clipboard.writeText(window.location.href);
    alert('⚡ Link copied to clipboard!');
  });

  // Tab Switching
  const tabs = document.querySelectorAll('.tab-btn');
  const contents = document.querySelectorAll('.tab-content');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      contents.forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.tab).classList.add('active');
    });
  });

  // Base Input Setup
  const baseInput = document.getElementById('baseDateInput');
  const targetInput = document.getElementById('targetDateInput');

  function updateSystemClock() {
    const now = new Date();
    const isoNow = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    baseInput.value = isoNow;
    document.getElementById('liveClockText').innerText = now.toLocaleString();
  }

  updateSystemClock();
  setInterval(updateSystemClock, 1000);

  // Live Countdown Engine (Fixes precision calculation & millisecond ticks)
  function runCountdown() {
    const now = new Date();
    const target = new Date(targetInput.value);
    const diff = target.getTime() - now.getTime();

    if (isNaN(diff) || diff <= 0) {
      document.getElementById('cdMonths').innerText = '00';
      document.getElementById('cdDays').innerText = '00';
      document.getElementById('cdHours').innerText = '00';
      document.getElementById('cdMins').innerText = '00';
      document.getElementById('cdSecs').innerText = '00';
      document.getElementById('cdMs').innerText = '000';
      document.getElementById('progressBarFill').style.width = '100%';
      document.getElementById('progressPercent').innerText = '100.0% Completed';
      document.getElementById('progressDaysRemaining').innerText = '0 days remaining';

      if (!confettiFired && typeof confetti === 'function') {
        confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
        confettiFired = true;
      }
      return;
    }

    const totalSecs = Math.floor(diff / 1000);
    const totalDays = Math.floor(totalSecs / (3600 * 24));

    // Exact month / day calculation
    let tempDate = new Date(now);
    let months = 0;
    while (true) {
      let nextMonth = new Date(tempDate);
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      if (nextMonth <= target) {
        months++;
        tempDate = nextMonth;
      } else {
        break;
      }
    }
    const remDays = Math.floor((target - tempDate) / (1000 * 3600 * 24));

    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const secs = Math.floor((diff % (1000 * 60)) / 1000);
    const ms = Math.floor((diff % 1000));

    document.getElementById('cdMonths').innerText = String(months).padStart(2, '0');
    document.getElementById('cdDays').innerText = String(remDays).padStart(2, '0');
    document.getElementById('cdHours').innerText = String(hours).padStart(2, '0');
    document.getElementById('cdMins').innerText = String(mins).padStart(2, '0');
    document.getElementById('cdSecs').innerText = String(secs).padStart(2, '0');
    document.getElementById('cdMs').innerText = String(ms).padStart(3, '0');

    // Metrics Box
    const totalHours = Math.floor(diff / (1000 * 60 * 60));
    const totalMins = Math.floor(diff / (1000 * 60));
    const totalWeeks = (totalDays / 7).toFixed(1);

    document.getElementById('metricDays').innerText = totalDays.toLocaleString();
    document.getElementById('metricWeeks').innerText = totalWeeks;
    document.getElementById('metricHours').innerText = totalHours.toLocaleString();
    document.getElementById('metricMins').innerText = totalMins.toLocaleString();

    // Progress Bar Calculation
    const totalDuration = target.getTime() - initialStartTime;
    const elapsed = now.getTime() - initialStartTime;
    const pct = Math.min(100, Math.max(0, (elapsed / totalDuration) * 100));

    document.getElementById('progressDaysRemaining').innerText = `${totalDays} days remaining`;
    document.getElementById('progressBarFill').style.width = `${pct.toFixed(1)}%`;
    document.getElementById('progressPercent').innerText = `${pct.toFixed(1)}% Completed`;
  }

  setInterval(runCountdown, 10);
  runCountdown();

  // Target Presets Click Handler
  document.querySelectorAll('.chip-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.chip-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');

      const newTarget = e.target.dataset.target;
      targetInput.value = newTarget;
      initialStartTime = Date.now();
      confettiFired = false;

      const formattedDate = new Date(newTarget).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
      document.getElementById('heroTargetName').innerText = formattedDate;
      document.getElementById('targetDateSubtitle').innerText = formattedDate.toLowerCase();
      runCountdown();
    });
  });

  // Tab 2: Date Difference Logic
  function calcDiff() {
    const s = new Date(document.getElementById('diffStart').value);
    const e = new Date(document.getElementById('diffEnd').value);
    if (!isNaN(s) && !isNaN(e)) {
      const d = Math.ceil(Math.abs(e - s) / (1000 * 60 * 60 * 24));
      document.getElementById('diffResultText').innerText = `${d.toLocaleString()} Total Days`;
    }
  }
  document.getElementById('diffStart').addEventListener('change', calcDiff);
  document.getElementById('diffEnd').addEventListener('change', calcDiff);

  // Tab 3: Add / Subtract Logic
  function calcAddSub() {
    const s = new Date(document.getElementById('asStart').value);
    const op = document.getElementById('asOp').value;
    const days = parseInt(document.getElementById('asDaysVal').value) || 0;
    if (!isNaN(s)) {
      const res = new Date(s);
      res.setDate(res.getDate() + (op === 'add' ? days : -days));
      document.getElementById('asResultText').innerText = res.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    }
  }
  document.getElementById('asStart').addEventListener('change', calcAddSub);
  document.getElementById('asOp').addEventListener('change', calcAddSub);
  document.getElementById('asDaysVal').addEventListener('input', calcAddSub);

  // Tab 4: Age Calculator Logic
  function calcAge() {
    const dob = new Date(document.getElementById('ageDob').value);
    const asOf = new Date(document.getElementById('ageAsOf').value);
    if (!isNaN(dob) && !isNaN(asOf)) {
      let y = asOf.getFullYear() - dob.getFullYear();
      let m = asOf.getMonth() - dob.getMonth();
      let d = asOf.getDate() - dob.getDate();
      if (d < 0) { m--; d += new Date(asOf.getFullYear(), asOf.getMonth(), 0).getDate(); }
      if (m < 0) { y--; m += 12; }
      document.getElementById('ageResultText').innerText = `${y} years, ${m} months, ${d} days`;
    }
  }
  document.getElementById('ageDob').addEventListener('change', calcAge);
  document.getElementById('ageAsOf').addEventListener('change', calcAge);

  // Default Init
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('diffStart').value = today;
  document.getElementById('asStart').value = today;
  document.getElementById('ageAsOf').value = today;
  calcDiff();
  calcAddSub();
  calcAge();
});