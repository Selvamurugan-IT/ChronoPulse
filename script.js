document.addEventListener('DOMContentLoaded', () => {
  let audioContext = null;
  let isTickSoundOn = true;
  let alarmTriggered = false;
  let streakChartInstance = null;

  // Real-time Audio Synthesizer Engine (Mobile & Laptop Compatible)
  function initAudioContext() {
    if (!audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) audioContext = new AudioContextClass();
    }
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume();
    }
  }

  // Unlock Audio Context on first user touch / click
  ['click', 'touchstart', 'keydown'].forEach(evt => {
    document.addEventListener(evt, () => initAudioContext(), { once: true });
  });

  // Mechanical Tick Sound (Plays Every Second)
  function playTickSound() {
    if (!isTickSoundOn) return;
    initAudioContext();
    if (!audioContext) return;

    try {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, audioContext.currentTime);
      osc.frequency.exponentialRampToValueAtTime(400, audioContext.currentTime + 0.03);

      gain.gain.setValueAtTime(0.04, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.03);

      osc.connect(gain);
      gain.connect(audioContext.destination);

      osc.start();
      osc.stop(audioContext.currentTime + 0.03);
    } catch (e) {
      console.log('Audio tick error', e);
    }
  }

  // Goal Completion Sound
  function playCompletionSound() {
    if (!isTickSoundOn) return;
    initAudioContext();
    if (!audioContext) return;

    try {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, audioContext.currentTime);
      osc.frequency.setValueAtTime(659.25, audioContext.currentTime + 0.15);
      gain.gain.setValueAtTime(0.2, audioContext.currentTime);
      gain.gain.linearRampToValueAtTime(0.01, audioContext.currentTime + 0.4);

      osc.connect(gain);
      gain.connect(audioContext.destination);
      osc.start();
      osc.stop(audioContext.currentTime + 0.4);
    } catch (e) { console.log('Completion sound error', e); }
  }

  // Audio Toggle Button
  const audioBtn = document.getElementById('tickAudioToggleBtn');
  audioBtn.addEventListener('click', () => {
    isTickSoundOn = !isTickSoundOn;
    document.getElementById('audioIcon').innerText = isTickSoundOn ? '🔊' : '🔇';
    document.getElementById('audioText').innerText = isTickSoundOn ? 'Tick Sound ON' : 'Tick Sound OFF';
    if (isTickSoundOn) initAudioContext();
  });

  // Tab Navigation
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

  // System Clock & Every-Second Continuous Tick Engine
  const baseInput = document.getElementById('baseDateInput');
  const targetInput = document.getElementById('targetDateInput');
  let lastSec = -1;

  function updateSystemClock() {
    const now = new Date();
    baseInput.value = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    document.getElementById('liveClockText').innerText = now.toLocaleString();
    runLifeProgress(now);

    const currentSec = now.getSeconds();
    if (currentSec !== lastSec) {
      lastSec = currentSec;
      playTickSound(); // Trigger continuous mechanical tick sound every second!
    }
  }
  setInterval(updateSystemClock, 200);
  updateSystemClock();

  // 1. Live Countdown Engine (Target Presets & Metrics)
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
      document.getElementById('progressPercent').innerText = '100% Completed';

      document.getElementById('mTotalDays').innerText = '0';
      document.getElementById('mTotalWeeks').innerText = '0.0';
      document.getElementById('mTotalHours').innerText = '0';
      document.getElementById('mTotalMinutes').innerText = '0';

      if (!alarmTriggered) {
        playCompletionSound();
        if (typeof confetti === 'function') confetti({ particleCount: 120, spread: 80 });
        alarmTriggered = true;
      }
      return;
    }

    const months = Math.floor(diff / (1000 * 60 * 60 * 24 * 30.4375));
    const days = Math.floor((diff % (1000 * 60 * 60 * 24 * 30.4375)) / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const secs = Math.floor((diff % (1000 * 60)) / 1000);
    const ms = Math.floor((diff % 1000));

    document.getElementById('cdMonths').innerText = String(months).padStart(2, '0');
    document.getElementById('cdDays').innerText = String(days).padStart(2, '0');
    document.getElementById('cdHours').innerText = String(hours).padStart(2, '0');
    document.getElementById('cdMins').innerText = String(mins).padStart(2, '0');
    document.getElementById('cdSecs').innerText = String(secs).padStart(2, '0');
    document.getElementById('cdMs').innerText = String(ms).padStart(3, '0');

    const totalDays = Math.floor(diff / (1000 * 60 * 60 * 24));
    const totalWeeks = (diff / (1000 * 60 * 60 * 24 * 7)).toFixed(1);
    const totalHours = Math.floor(diff / (1000 * 60 * 60));
    const totalMinutes = Math.floor(diff / (1000 * 60));

    document.getElementById('mTotalDays').innerText = totalDays.toLocaleString();
    document.getElementById('mTotalWeeks').innerText = totalWeeks;
    document.getElementById('mTotalHours').innerText = totalHours.toLocaleString();
    document.getElementById('mTotalMinutes').innerText = totalMinutes.toLocaleString();
    document.getElementById('progressDaysRemaining').innerText = `${totalDays} days remaining`;
  }
  setInterval(runCountdown, 10);

  // Target Presets Handler
  document.querySelectorAll('.chip-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.chip-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      targetInput.value = e.target.dataset.target;
      alarmTriggered = false;
      document.getElementById('heroTargetName').innerText = new Date(e.target.dataset.target).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
    });
  });

  // 2. Profile Management
  function loadProfile() {
    const profile = JSON.parse(localStorage.getItem('chronoProfile2')) || { name: '', dob: '' };
    document.getElementById('userNameInput').value = profile.name;
    document.getElementById('userDobInput').value = profile.dob;

    if (profile.dob) {
      const dob = new Date(profile.dob);
      const now = new Date();
      let years = now.getFullYear() - dob.getFullYear();
      let months = now.getMonth() - dob.getMonth();
      if (months < 0 || (months === 0 && now.getDate() < dob.getDate())) years--;
      document.getElementById('profileAgeText').innerText = `${years} Yrs`;

      const diffTime = Math.abs(now - dob);
      const totalDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      document.getElementById('profileDaysLived').innerText = totalDays.toLocaleString();
      document.getElementById('profileHoursLived').innerText = (totalDays * 24).toLocaleString();

      let nextBday = new Date(now.getFullYear(), dob.getMonth(), dob.getDate());
      if (now > nextBday) nextBday.setFullYear(now.getFullYear() + 1);
      const bdayDiff = Math.ceil((nextBday - now) / (1000 * 60 * 60 * 24));
      document.getElementById('profileNextBdayDays').innerText = `${bdayDiff} Days`;
    }
  }

  document.getElementById('saveProfileBtn').addEventListener('click', () => {
    const profile = {
      name: document.getElementById('userNameInput').value,
      dob: document.getElementById('userDobInput').value
    };
    localStorage.setItem('chronoProfile2', JSON.stringify(profile));
    loadProfile();
    alert('✅ Profile Saved Successfully!');
  });

  // Personal Important Events
  let savedEvents = JSON.parse(localStorage.getItem('chronoEvents2')) || [];
  function renderEvents() {
    const container = document.getElementById('eventsContainer');
    container.innerHTML = '';
    savedEvents.forEach((ev, idx) => {
      const daysLeft = Math.ceil((new Date(ev.date) - new Date()) / (1000 * 60 * 60 * 24));
      const item = document.createElement('div');
      item.className = 'event-item';
      item.innerHTML = `
        <div><strong>${ev.title}</strong> — <span class="highlight-text">${ev.date}</span></div>
        <div><span>${daysLeft > 0 ? daysLeft + ' days left' : 'Completed'}</span> <button onclick="deleteEvent(${idx})" style="background:none;border:none;color:#ef4444;cursor:pointer;margin-left:10px;">❌</button></div>
      `;
      container.appendChild(item);
    });
  }
  window.deleteEvent = (idx) => {
    savedEvents.splice(idx, 1);
    localStorage.setItem('chronoEvents2', JSON.stringify(savedEvents));
    renderEvents();
  };
  document.getElementById('addEventBtn').addEventListener('click', () => {
    const title = document.getElementById('eventTitle').value;
    const date = document.getElementById('eventDate').value;
    if (title && date) {
      savedEvents.push({ title, date });
      localStorage.setItem('chronoEvents2', JSON.stringify(savedEvents));
      renderEvents();
      document.getElementById('eventTitle').value = '';
    }
  });

  // 3. Goal & Multiple Task per Day Habit Tracker System
  let goalsData = JSON.parse(localStorage.getItem('chronoGoals2')) || [];

  function saveGoals() {
    localStorage.setItem('chronoGoals2', JSON.stringify(goalsData));
    renderGoals();
    updateChart();
  }

  function renderGoals() {
    const container = document.getElementById('goalsContainer');
    container.innerHTML = '';
    if (goalsData.length === 0) {
      container.innerHTML = '<p style="text-align:center;color:var(--text-muted);margin-top:1.5rem;">No habit goals created yet. Add your custom goals and tasks above!</p>';
      return;
    }

    goalsData.forEach((goal, gIdx) => {
      const goalCard = document.createElement('div');
      goalCard.className = 'goal-card';
      let tasksHTML = '';

      goal.tasks.forEach((task, tIdx) => {
        const todayStr = new Date().toDateString();
        const isChecked = task.history.includes(todayStr);
        tasksHTML += `
          <div class="task-item">
            <label class="task-check-label">
              <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="toggleTaskCheck(${gIdx}, ${tIdx})">
              <span>${task.name}</span>
            </label>
            <span class="streak-fire-badge" onclick="openCalendar(${gIdx}, ${tIdx})">🔥 ${task.streak} Days</span>
          </div>
        `;
      });

      goalCard.innerHTML = `
        <div class="goal-header">
          <h3>🎯 ${goal.title}</h3>
          <button onclick="deleteGoal(${gIdx})" style="background:none;border:none;color:#ef4444;cursor:pointer;font-weight:600;">Delete Goal</button>
        </div>
        <div class="tasks-list">${tasksHTML}</div>
      `;
      container.appendChild(goalCard);
    });
  }

  document.getElementById('addGoalBtn').addEventListener('click', () => {
    const title = document.getElementById('newGoalTitle').value;
    const tasksRaw = document.getElementById('newGoalTasks').value;
    if (!title) return;

    const tasksList = tasksRaw.split(',').map(t => t.trim()).filter(t => t.length > 0).map(t => ({
      name: t,
      streak: 0,
      history: []
    }));

    goalsData.push({ title, tasks: tasksList });
    saveGoals();
    document.getElementById('newGoalTitle').value = '';
    document.getElementById('newGoalTasks').value = '';
  });

  window.toggleTaskCheck = (gIdx, tIdx) => {
    const task = goalsData[gIdx].tasks[tIdx];
    const todayStr = new Date().toDateString();
    if (task.history.includes(todayStr)) {
      task.history = task.history.filter(d => d !== todayStr);
      task.streak = Math.max(0, task.streak - 1);
    } else {
      task.history.push(todayStr);
      task.streak++;
      playCompletionSound();
      if (typeof confetti === 'function') confetti({ particleCount: 70, spread: 60 });
    }
    saveGoals();
  };

  window.deleteGoal = (gIdx) => {
    goalsData.splice(gIdx, 1);
    saveGoals();
  };

  // 🔥 Per-Task Calendar Handler
  window.openCalendar = (gIdx, tIdx) => {
    const task = goalsData[gIdx].tasks[tIdx];
    document.getElementById('modalTaskTitle').innerText = `🔥 ${task.name} — Streak History`;
    const calGrid = document.getElementById('calendarGrid');
    calGrid.innerHTML = '';

    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    for (let day = 1; day <= daysInMonth; day++) {
      const dateObj = new Date(now.getFullYear(), now.getMonth(), day);
      const dateStr = dateObj.toDateString();
      const isStreak = task.history.includes(dateStr);

      const dayCell = document.createElement('div');
      dayCell.className = `cal-day ${isStreak ? 'active-streak' : ''}`;
      dayCell.innerHTML = `${day}<br>${isStreak ? '🔥' : '•'}`;
      calGrid.appendChild(dayCell);
    }

    document.getElementById('calendarModal').classList.add('active');
  };

  document.getElementById('closeModalBtn').addEventListener('click', () => {
    document.getElementById('calendarModal').classList.remove('active');
  });

  // Chart.js Habit Streak Visualizer
  function updateChart() {
    const ctx = document.getElementById('streakChart').getContext('2d');
    const labels = [];
    const data = [];

    goalsData.forEach(g => {
      g.tasks.forEach(t => {
        labels.push(t.name);
        data.push(t.streak);
      });
    });

    if (streakChartInstance) streakChartInstance.destroy();
    streakChartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Streak (Days)',
          data: data,
          backgroundColor: '#10b981',
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        scales: {
          y: { beginAtZero: true, ticks: { color: '#64748b' } },
          x: { ticks: { color: '#64748b' } }
        },
        plugins: { legend: { display: false } }
      }
    });
  }

  // 4. Real-time Life Progress
  function runLifeProgress(now) {
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayPct = ((now - startOfDay) / (1000 * 60 * 60 * 24)) * 100;
    document.getElementById('dayProgressBar').style.width = `${dayPct.toFixed(1)}%`;
    document.getElementById('dayProgressPct').innerText = `${dayPct.toFixed(1)}%`;

    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const monthPct = (now.getDate() / daysInMonth) * 100;
    document.getElementById('monthProgressBar').style.width = `${monthPct.toFixed(1)}%`;
    document.getElementById('monthProgressPct').innerText = `${monthPct.toFixed(1)}%`;

    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const yearPct = ((now - startOfYear) / (1000 * 60 * 60 * 24 * 365)) * 100;
    document.getElementById('yearProgressBar').style.width = `${yearPct.toFixed(1)}%`;
    document.getElementById('yearProgressPct').innerText = `${yearPct.toFixed(1)}%`;
  }

  // Screenshot & Native Sharing Handler
  document.getElementById('shareBtn').addEventListener('click', () => {
    html2canvas(document.getElementById('captureArea')).then(canvas => {
      canvas.toBlob(blob => {
        const file = new File([blob], 'chronopulse-streak.png', { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({
            title: 'ChronoPulse App',
            text: 'Check out my ChronoPulse streak & countdown status!',
            files: [file]
          }).catch(err => console.log('Sharing canceled'));
        } else {
          const a = document.createElement('a');
          a.href = canvas.toDataURL();
          a.download = 'chronopulse-screenshot.png';
          a.click();
          alert('📸 Screenshot downloaded! You can share it on WhatsApp, Instagram, or Facebook.');
        }
      });
    });
  });

  // Init
  loadProfile();
  renderEvents();
  renderGoals();
  updateChart();
});