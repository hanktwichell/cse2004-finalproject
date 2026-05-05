/* ═══════════════════════════════════════════════════════════════
   OpenF1 Explorer — script.js
   Uses OpenF1 public API: https://api.openf1.org/v1
═══════════════════════════════════════════════════════════════ */

const BASE = 'https://api.openf1.org/v1';

/* ── State ────────────────────────────────────────────────────── */
let state = {
  sessionKey: null,
  sessionName: '',
  drivers: [],        // [{driver_number, name_acronym, full_name, team_colour}]
  laps: {},           // {driver_number: [lap objects]}
  stints: {},         // {driver_number: [stint objects]}
  compareDrivers: [], // driver_numbers selected for compare view
  stintDrivers: [],   // driver_numbers selected for stint view
  telemA: null,       // {driverNum, lapNum, data:[]}
  telemB: null,
  simLaps: [],        // imported sim laps
  lapTimeChart: null,
  stintChart: null,
  telemCharts: {},
  selectedPlatform: 'iracing',
  pendingFile: null,
};

/* ── Team colours fallback map ─────────────────────────────────── */
const TEAM_COLOURS = {
  'Red Bull Racing': '#3671c6',
  'Ferrari': '#e8002d',
  'Mercedes': '#27f4d2',
  'McLaren': '#ff8000',
  'Aston Martin': '#229971',
  'Alpine': '#0093cc',
  'Williams': '#64c4ff',
  'AlphaTauri': '#5e8faa',
  'RB': '#6692ff',
  'Haas F1 Team': '#b6babd',
  'Alfa Romeo': '#c92d4b',
  'Sauber': '#52e252',
  'Kick Sauber': '#52e252',
  'Racing Bulls': '#6692ff',
};

const DRIVER_COLOURS = [
  '#e63946','#ff8000','#27f4d2','#a78bfa','#60a5fa',
  '#f4a261','#2ec27e','#fb923c','#34d399','#e879f9',
  '#f87171','#facc15','#38bdf8','#c084fc','#4ade80',
  '#fb7185','#fbbf24','#22d3ee','#818cf8','#a3e635',
];

/* ── Utilities ────────────────────────────────────────────────── */
async function fetchF1(endpoint, params = {}) {
  const url = new URL(BASE + endpoint);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  });
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`API ${res.status}: ${endpoint}`);
  const data = await res.json();
  return data;
}

function fmtTime(seconds) {
  if (!seconds || isNaN(seconds)) return '—';
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(3).padStart(6, '0');
  return `${m}:${s}`;
}

function driverColour(driverNum) {
  const d = state.drivers.find(x => x.driver_number == driverNum);
  if (d && d.team_colour) return '#' + d.team_colour.replace('#', '');
  if (d && d._colour) return d._colour;
  const idx = state.drivers.findIndex(x => x.driver_number == driverNum);
  return DRIVER_COLOURS[idx >= 0 ? idx % DRIVER_COLOURS.length : 0];
}

function driverAbbr(driverNum) {
  const d = state.drivers.find(x => x.driver_number == driverNum);
  return d ? d.name_acronym : String(driverNum);
}

function showToast(msg, duration = 2800) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

function setStatus(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function loading(msg = 'Loading…') {
  return `<span class="spinner"></span>${msg}`;
}

/* ── Navigation ───────────────────────────────────────────────── */
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const view = document.getElementById('view-' + name);
  if (view) view.classList.add('active');
  const btn = document.querySelector(`.nav-btn[data-view="${name}"]`);
  if (btn) btn.classList.add('active');

  if (name === 'compare' && state.sessionKey) populateCompareSidebar();
  if (name === 'telemetry' && state.sessionKey) populateTelemSelects();
  if (name === 'stints' && state.sessionKey) populateStintSidebar();
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});

/* ══════════════════════════════════════════════════════════════
   HOME / SESSION PICKER
══════════════════════════════════════════════════════════════ */

async function onYearChange() {
  const year = document.getElementById('filterYear').value;
  const evtSel = document.getElementById('filterEvent');
  const ssnSel = document.getElementById('filterSession');
  evtSel.innerHTML = '<option>Loading…</option>';
  evtSel.disabled = true;
  ssnSel.innerHTML = '<option>Select event first</option>';
  ssnSel.disabled = true;
  document.getElementById('btnLoad').disabled = true;
  setStatus('homeStatus', loading('Fetching events…'));
  try {
    const meetings = await fetchF1('/meetings', { year });
    if (!meetings || meetings.length === 0) {
      evtSel.innerHTML = '<option value="">No events found</option>';
      setStatus('homeStatus', `No events found for ${year}. The season may not have started yet.`);
      return;
    }
    evtSel.innerHTML = '<option value="">Select event…</option>';
    // Sort by date ascending
    meetings.sort((a, b) => new Date(a.date_start) - new Date(b.date_start));
    meetings.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.meeting_key;
      opt.textContent = m.meeting_name;
      opt.dataset.country = m.country_name || '';
      opt.dataset.date = m.date_start ? m.date_start.split('T')[0] : '';
      evtSel.appendChild(opt);
    });
    evtSel.disabled = false;
    setStatus('homeStatus', `${meetings.length} events found for ${year}.`);
  } catch(e) {
    evtSel.innerHTML = '<option value="">Error loading events</option>';
    setStatus('homeStatus', `<span style="color:var(--red)">Error: ${e.message}</span>`);
  }
}

async function onEventChange() {
  const meetingKey = document.getElementById('filterEvent').value;
  if (!meetingKey) return;
  const ssnSel = document.getElementById('filterSession');
  ssnSel.innerHTML = '<option>Loading…</option>';
  ssnSel.disabled = true;
  document.getElementById('btnLoad').disabled = true;
  setStatus('homeStatus', loading('Fetching sessions…'));
  try {
    const sessions = await fetchF1('/sessions', { meeting_key: meetingKey });
    if (!sessions || sessions.length === 0) {
      ssnSel.innerHTML = '<option value="">No sessions found</option>';
      setStatus('homeStatus', 'No sessions found for this event.');
      return;
    }
    ssnSel.innerHTML = '<option value="">Select session…</option>';
    // Preferred order for session types
    const ORDER = ['Practice 1','Practice 2','Practice 3','Sprint Qualifying','Sprint','Qualifying','Race'];
    sessions.sort((a, b) => {
      const ia = ORDER.indexOf(a.session_name);
      const ib = ORDER.indexOf(b.session_name);
      if (ia !== -1 && ib !== -1) return ia - ib;
      return new Date(a.date_start) - new Date(b.date_start);
    });
    sessions.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.session_key;
      const dateStr = s.date_start ? ` (${s.date_start.split('T')[0]})` : '';
      opt.textContent = s.session_name + dateStr;
      ssnSel.appendChild(opt);
    });
    ssnSel.disabled = false;
    ssnSel.onchange = () => { document.getElementById('btnLoad').disabled = !ssnSel.value; };
    setStatus('homeStatus', `${sessions.length} sessions found.`);
  } catch(e) {
    ssnSel.innerHTML = '<option value="">Error loading sessions</option>';
    setStatus('homeStatus', `<span style="color:var(--red)">Error: ${e.message}</span>`);
  }
}

async function loadSession() {
  const sessionKey = document.getElementById('filterSession').value;
  if (!sessionKey) return;
  document.getElementById('btnLoad').disabled = true;
  setStatus('homeStatus', loading('Loading session data…'));
  document.getElementById('sessionInfo').style.display = 'none';
  document.getElementById('driverGrid').style.display = 'none';

  try {
    // Fetch session details
    const sessions = await fetchF1('/sessions', { session_key: sessionKey });
    const session = sessions[0];
    if (!session) throw new Error('Session not found');

    state.sessionKey = sessionKey;
    state.sessionName = `${session.meeting_name || ''} — ${session.session_name || ''}`;
    state.drivers = [];
    state.laps = {};
    state.stints = {};
    state.compareDrivers = [];
    state.stintDrivers = [];

    setStatus('homeStatus', loading('Fetching drivers…'));
    const drivers = await fetchF1('/drivers', { session_key: sessionKey });
    if (!drivers || drivers.length === 0) {
      throw new Error('No driver data found. This session may not have data available yet.');
    }
    state.drivers = drivers.map((d, i) => ({
      ...d,
      _colour: d.team_colour
        ? '#' + d.team_colour.replace('#','')
        : DRIVER_COLOURS[i % DRIVER_COLOURS.length]
    }));

    setStatus('homeStatus', loading('Fetching all laps…'));
    let allLaps = [];
    try {
      allLaps = await fetchF1('/laps', { session_key: sessionKey });
    } catch(e) {
      showToast('Could not load lap data — some features may be limited');
    }

    state.drivers.forEach(d => {
      state.laps[d.driver_number] = (allLaps || [])
        .filter(l => l.driver_number == d.driver_number)
        .sort((a, b) => a.lap_number - b.lap_number);
    });

    setStatus('homeStatus', loading('Fetching stints…'));
    let allStints = [];
    try {
      allStints = await fetchF1('/stints', { session_key: sessionKey });
    } catch(e) {
      showToast('Could not load stint data');
    }
    state.drivers.forEach(d => {
      state.stints[d.driver_number] = (allStints || []).filter(s => s.driver_number == d.driver_number);
    });

    // Update session badge
    document.getElementById('sessionBadge').style.display = 'flex';
    document.getElementById('sessionBadgeText').textContent = state.sessionName;

    // Update SIC
    const evtOpt = document.getElementById('filterEvent').selectedOptions[0];
    const meta = [evtOpt?.dataset?.country, session.circuit_short_name, evtOpt?.dataset?.date]
      .filter(Boolean).join(' · ');
    document.getElementById('sicTitle').textContent = state.sessionName;
    document.getElementById('sicMeta').textContent = meta;
    document.getElementById('sessionInfo').style.display = 'flex';

    // Driver grid
    renderDriverGrid();

    // Pre-select first two drivers for compare/stints
    if (state.drivers.length >= 2) {
      state.compareDrivers = [state.drivers[0].driver_number, state.drivers[1].driver_number];
      state.stintDrivers   = [state.drivers[0].driver_number, state.drivers[1].driver_number];
    } else if (state.drivers.length === 1) {
      state.compareDrivers = [state.drivers[0].driver_number];
      state.stintDrivers   = [state.drivers[0].driver_number];
    }

    const totalLaps = allLaps ? allLaps.length : 0;
    setStatus('homeStatus', `✓ Loaded ${state.drivers.length} drivers, ${totalLaps} laps.`);
    document.getElementById('btnLoad').disabled = false;
  } catch(e) {
    setStatus('homeStatus', `<span style="color:var(--red)">Error: ${e.message}</span>`);
    document.getElementById('btnLoad').disabled = false;
  }
}

function renderDriverGrid() {
  const grid = document.getElementById('driverGrid');
  grid.innerHTML = '';
  grid.style.display = 'grid';
  state.drivers.forEach(d => {
    const card = document.createElement('div');
    card.className = 'driver-card';
    const laps = state.laps[d.driver_number] || [];
    const bestLap = laps.filter(l => l.lap_duration && !l.is_pit_out_lap)
      .sort((a,b) => a.lap_duration - b.lap_duration)[0];
    card.innerHTML = `
      <div class="driver-dot" style="background:${d._colour}"></div>
      <div class="driver-card-info">
        <div class="driver-abbr">${d.name_acronym || d.driver_number}</div>
        <div class="driver-name">${d.full_name || '—'}</div>
        <div class="driver-pos">${bestLap ? fmtTime(bestLap.lap_duration) : '—'}</div>
      </div>`;
    grid.appendChild(card);
  });
}

/* ══════════════════════════════════════════════════════════════
   LAP COMPARE VIEW
══════════════════════════════════════════════════════════════ */

function populateCompareSidebar() {
  document.getElementById('sbSessionName').textContent = state.sessionName || 'No session loaded';
  renderCompareDriverList();
  populateDriverSelect('compareDriverAdd', state.compareDrivers);
}

function renderCompareDriverList() {
  const list = document.getElementById('compareDriverList');
  list.innerHTML = '';
  state.compareDrivers.forEach(num => {
    const d = state.drivers.find(x => x.driver_number == num);
    if (!d) return;
    const chip = document.createElement('div');
    chip.className = 'driver-chip';
    chip.innerHTML = `
      <span class="dot" style="background:${d._colour}"></span>
      <span class="abbr">${d.name_acronym}</span>
      <span class="fullname">${d.full_name || ''}</span>
      <button class="remove-btn" onclick="removeCompareDriver(${num})">×</button>`;
    list.appendChild(chip);
  });
}

function populateDriverSelect(selectId, excluded = []) {
  const sel = document.getElementById(selectId);
  sel.innerHTML = '<option value="">Add driver…</option>';
  state.drivers
    .filter(d => !excluded.includes(d.driver_number))
    .forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.driver_number;
      opt.textContent = `${d.name_acronym} — ${d.full_name || ''}`;
      sel.appendChild(opt);
    });
}

function addCompareDriver() {
  const sel = document.getElementById('compareDriverAdd');
  const num = parseInt(sel.value);
  if (!num || state.compareDrivers.includes(num)) return;
  state.compareDrivers.push(num);
  populateCompareSidebar();
}

function removeCompareDriver(num) {
  state.compareDrivers = state.compareDrivers.filter(n => n !== num);
  populateCompareSidebar();
}

function renderCompare() {
  if (!state.sessionKey) { showToast('Load a session first'); return; }
  if (state.compareDrivers.length === 0) { showToast('Add at least one driver'); return; }

  const lapFrom = parseInt(document.getElementById('lapFrom').value) || 1;
  const lapTo   = parseInt(document.getElementById('lapTo').value)   || 999;
  const showPit = document.getElementById('chkPitLaps').checked;

  // Build datasets
  const datasets = [];
  let allFastestLap = null, allFastestDriver = null;

  state.compareDrivers.forEach(num => {
    const d = state.drivers.find(x => x.driver_number == num);
    if (!d) return;
    let laps = (state.laps[num] || [])
      .filter(l => l.lap_number >= lapFrom && l.lap_number <= lapTo);
    if (!showPit) laps = laps.filter(l => !l.is_pit_out_lap);

    const points = laps.map(l => ({
      x: l.lap_number,
      y: l.lap_duration || null,
    })).filter(p => p.y && p.y < 300);

    datasets.push({
      label: d.name_acronym,
      data: points,
      borderColor: d._colour,
      backgroundColor: d._colour + '22',
      borderWidth: 1.8,
      pointRadius: 2,
      pointHoverRadius: 4,
      tension: 0.2,
      spanGaps: false,
    });

    // track fastest
    const validLaps = laps.filter(l => l.lap_duration && l.lap_duration < 300);
    const fastest = [...validLaps].sort((a,b) => a.lap_duration - b.lap_duration)[0];
    if (fastest && (!allFastestLap || fastest.lap_duration < allFastestLap.lap_duration)) {
      allFastestLap = fastest;
      allFastestDriver = d;
    }
  });

  if (datasets.every(ds => ds.data.length === 0)) {
    showToast('No lap data available for this selection');
    return;
  }

  // Metrics
  if (allFastestLap) {
    document.getElementById('mFastest').textContent = fmtTime(allFastestLap.lap_duration);
    document.getElementById('mFastestSub').textContent = `${allFastestDriver.name_acronym} · Lap ${allFastestLap.lap_number}`;
  }

  // Gap metric (first two drivers)
  if (state.compareDrivers.length >= 2) {
    const avgA = averagePace(state.compareDrivers[0], lapFrom, lapTo);
    const avgB = averagePace(state.compareDrivers[1], lapFrom, lapTo);
    const gap = avgB - avgA;
    const gapEl = document.getElementById('mGap');
    gapEl.textContent = (gap >= 0 ? '+' : '') + gap.toFixed(3) + 's';
    gapEl.className = 'metric-value ' + (gap >= 0 ? 'neg' : 'pos');
    document.getElementById('mGapSub').textContent =
      `${driverAbbr(state.compareDrivers[1])} vs ${driverAbbr(state.compareDrivers[0])} avg`;
  }

  const totalLaps = datasets.reduce((s, ds) => s + ds.data.length, 0);
  document.getElementById('mLaps').textContent = totalLaps;
  document.getElementById('mLapsSub').textContent = `across ${state.compareDrivers.length} driver(s)`;

  // Destroy old chart
  if (state.lapTimeChart) { state.lapTimeChart.destroy(); state.lapTimeChart = null; }

  const ctx = document.getElementById('lapTimeChart').getContext('2d');
  state.lapTimeChart = new Chart(ctx, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      animation: { duration: 400 },
      scales: {
        x: {
          type: 'linear',
          title: { display: true, text: 'Lap', color: '#5a5a68', font: { size: 10 } },
          ticks: { color: '#5a5a68', font: { size: 10 } },
          grid: { color: 'rgba(255,255,255,0.04)' },
        },
        y: {
          title: { display: true, text: 'Lap Time', color: '#5a5a68', font: { size: 10 } },
          ticks: {
            color: '#5a5a68', font: { size: 10, family: "'Space Mono', monospace" },
            callback: v => fmtTime(v),
          },
          grid: { color: 'rgba(255,255,255,0.04)' },
        },
      },
      plugins: {
        legend: {
          labels: {
            color: '#9a9aa8', font: { size: 11 }, boxWidth: 12, padding: 14,
          }
        },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${fmtTime(ctx.parsed.y)}`,
          },
          backgroundColor: '#1f1f25',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          titleColor: '#ededf0',
          bodyColor: '#9a9aa8',
        }
      }
    }
  });

  // Render table
  renderLapTable(lapFrom, lapTo, showPit);
}

function averagePace(driverNum, lapFrom, lapTo) {
  const laps = (state.laps[driverNum] || [])
    .filter(l => l.lap_number >= lapFrom && l.lap_number <= lapTo && l.lap_duration && l.lap_duration < 300 && !l.is_pit_out_lap);
  if (!laps.length) return 0;
  return laps.reduce((s, l) => s + l.lap_duration, 0) / laps.length;
}

function renderLapTable(lapFrom, lapTo, showPit) {
  if (state.compareDrivers.length === 0) return;

  // Find global best
  let globalBest = Infinity;
  state.compareDrivers.forEach(num => {
    (state.laps[num] || []).forEach(l => {
      if (l.lap_duration && l.lap_duration < globalBest && l.lap_duration < 300) globalBest = l.lap_duration;
    });
  });

  // Get all lap numbers
  const lapNums = new Set();
  state.compareDrivers.forEach(num => {
    (state.laps[num] || [])
      .filter(l => l.lap_number >= lapFrom && l.lap_number <= lapTo)
      .forEach(l => lapNums.add(l.lap_number));
  });

  const sortedLaps = Array.from(lapNums).sort((a,b) => a - b);

  let html = `<table class="lap-tbl"><thead><tr><th>Lap</th>`;
  state.compareDrivers.forEach(num => { html += `<th>${driverAbbr(num)}</th>`; });
  if (state.compareDrivers.length >= 2) {
    html += `<th>Δ (${driverAbbr(state.compareDrivers[0])} vs ${driverAbbr(state.compareDrivers[1])})</th>`;
  }
  html += `</tr></thead><tbody>`;

  sortedLaps.slice(0, 80).forEach(lapNum => {
    const lapDatas = state.compareDrivers.map(num =>
      (state.laps[num] || []).find(l => l.lap_number === lapNum)
    );
    const isPit = lapDatas.some(l => l && l.is_pit_out_lap);
    if (!showPit && isPit) return;

    html += `<tr class="${isPit ? 'pit-row' : ''}"><td class="lap-num">${lapNum}${isPit ? ' 🔧' : ''}</td>`;
    lapDatas.forEach(l => {
      const isBest = l && l.lap_duration && Math.abs(l.lap_duration - globalBest) < 0.001;
      html += `<td class="${isBest ? 'lap-best' : ''}">${l && l.lap_duration ? fmtTime(l.lap_duration) : '—'}</td>`;
    });
    if (state.compareDrivers.length >= 2 && lapDatas[0] && lapDatas[1] && lapDatas[0].lap_duration && lapDatas[1].lap_duration) {
      const delta = lapDatas[1].lap_duration - lapDatas[0].lap_duration;
      const cls = delta > 0 ? 'delta-neg' : 'delta-pos';
      html += `<td class="${cls}">${delta > 0 ? '+' : ''}${delta.toFixed(3)}s</td>`;
    } else {
      html += `<td>—</td>`;
    }
    html += `</tr>`;
  });

  html += `</tbody></table>`;
  document.getElementById('lapTable').innerHTML = html;
}

/* ══════════════════════════════════════════════════════════════
   TELEMETRY VIEW
══════════════════════════════════════════════════════════════ */

function populateTelemSelects() {
  ['telemLapA', 'telemLapB'].forEach(id => {
    const sel = document.getElementById(id);
    // Preserve existing sim lap options
    const simGroups = Array.from(sel.querySelectorAll('optgroup'));
    sel.innerHTML = '<option value="">Select driver/lap…</option>';

    state.drivers.forEach(d => {
      const laps = (state.laps[d.driver_number] || [])
        .filter(l => l.lap_duration && !l.is_pit_out_lap)
        .sort((a,b) => a.lap_number - b.lap_number);
      if (!laps.length) return;
      const grp = document.createElement('optgroup');
      grp.label = `${d.name_acronym} — ${d.full_name || ''}`;
      laps.forEach(l => {
        const opt = document.createElement('option');
        opt.value = `${d.driver_number}_${l.lap_number}`;
        opt.textContent = `Lap ${l.lap_number}  ${fmtTime(l.lap_duration)}`;
        grp.appendChild(opt);
      });
      sel.appendChild(grp);
    });

    // Re-append sim groups
    simGroups.forEach(g => sel.appendChild(g));
  });
}

async function loadTelemLap(slot) {
  // no-op — data loaded on "Render Telemetry"
}

/*
 * OpenF1 /car_data does NOT support lap_number filtering directly.
 * Instead, we need to:
 *  1. Find the lap object (which has date_start)
 *  2. Find the NEXT lap's date_start as the end time
 *  3. Fetch car_data between those timestamps
 */
async function fetchCarDataForLap(driverNum, lapNum) {
  const driverLaps = state.laps[driverNum] || [];
  const lapObj = driverLaps.find(l => l.lap_number === lapNum);
  if (!lapObj) throw new Error(`Lap ${lapNum} not found for driver ${driverNum}`);

  const dateStart = lapObj.date_start;
  if (!dateStart) throw new Error(`No start time for lap ${lapNum}`);

  // Try to get duration-based end time, or use the next lap's start
  let dateEnd;
  if (lapObj.lap_duration) {
    const endMs = new Date(dateStart).getTime() + lapObj.lap_duration * 1000 + 1000;
    dateEnd = new Date(endMs).toISOString();
  } else {
    const nextLap = driverLaps.find(l => l.lap_number === lapNum + 1);
    if (nextLap && nextLap.date_start) {
      dateEnd = nextLap.date_start;
    }
  }

  const params = {
    session_key: state.sessionKey,
    driver_number: driverNum,
  };
  // OpenF1 supports date filtering via query string operators
  const url = new URL(BASE + '/car_data');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set('date>', dateStart);
  if (dateEnd) url.searchParams.set('date<', dateEnd);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`API ${res.status}: /car_data`);
  const data = await res.json();
  if (!data || data.length === 0) {
    throw new Error(`No car data returned for ${driverAbbr(driverNum)} lap ${lapNum}. Telemetry may not be available for this session.`);
  }
  return data;
}


async function renderTelemetry() {
  const valA = document.getElementById('telemLapA').value;
  const valB = document.getElementById('telemLapB').value;

  if (!valA || !valB) { showToast('Select Lap A and Lap B'); return; }

  setStatus('telemStatus', loading('Fetching car data…'));
  document.getElementById('telemPlaceholder').style.display = 'none';

  // Handle sim laps
  const isSimA = valA.startsWith('sim_');
  const isSimB = valB.startsWith('sim_');

  // Parse driver/lap numbers (only for real laps)
  const parseVal = (val) => {
    const parts = val.split('_').map(Number);
    return { driverNum: parts[0], lapNum: parts[1] };
  };

  try {
    let carA, carB;

    if (isSimA) {
      const simIdx = parseInt(valA.split('_')[1]);
      const sim = state.simLaps[simIdx];
      carA = sim.data;
      state.telemA = { driverNum: 'SIM', lapNum: 0, data: carA, label: sim.label };
    } else {
      const { driverNum, lapNum } = parseVal(valA);
      setStatus('telemStatus', loading(`Fetching ${driverAbbr(driverNum)} Lap ${lapNum}…`));
      carA = await fetchCarDataForLap(driverNum, lapNum);
      state.telemA = { driverNum, lapNum, data: carA };
    }

    if (isSimB) {
      const simIdx = parseInt(valB.split('_')[1]);
      const sim = state.simLaps[simIdx];
      carB = sim.data;
      state.telemB = { driverNum: 'SIM', lapNum: 0, data: carB, label: sim.label };
    } else {
      const { driverNum, lapNum } = parseVal(valB);
      setStatus('telemStatus', loading(`Fetching ${driverAbbr(driverNum)} Lap ${lapNum}…`));
      carB = await fetchCarDataForLap(driverNum, lapNum);
      state.telemB = { driverNum, lapNum, data: carB };
    }

    // Downsample to ~250 points each for performance
    const sample = (arr, n) => {
      if (arr.length <= n) return arr;
      const step = Math.ceil(arr.length / n);
      return arr.filter((_, i) => i % step === 0);
    };

    state.telemA.data = sample(state.telemA.data, 250);
    state.telemB.data = sample(state.telemB.data, 250);

    buildTelemCharts();
    setStatus('telemStatus', `✓ Loaded — A: ${state.telemA.data.length} pts, B: ${state.telemB.data.length} pts`);
  } catch(e) {
    setStatus('telemStatus', `<span style="color:var(--red)">Error: ${e.message}</span>`);
    showToast(`Telemetry error: ${e.message}`, 4000);
    document.getElementById('telemPlaceholder').style.display = 'flex';
  }
}

function buildTelemCharts() {
  const container = document.getElementById('telemCharts');
  container.innerHTML = '';

  // Destroy old charts
  Object.values(state.telemCharts).forEach(c => c.destroy());
  state.telemCharts = {};

  const channels = [
    { key: 'speed',    label: 'Speed (km/h)',   chk: 'chSpeed' },
    { key: 'throttle', label: 'Throttle (%)',   chk: 'chThrottle' },
    { key: 'brake',    label: 'Brake',          chk: 'chBrake' },
    { key: 'n_gear',   label: 'Gear',           chk: 'chGear' },
    { key: 'drs',      label: 'DRS',            chk: 'chDRS' },
  ];

  const dA = state.telemA, dB = state.telemB;
  const colA = dA.driverNum === 'SIM' ? '#e63946' : driverColour(dA.driverNum);
  const colB = dB.driverNum === 'SIM' ? '#facc15' : driverColour(dB.driverNum);
  const abbrA = dA.label || (dA.driverNum === 'SIM' ? 'SIM' : driverAbbr(dA.driverNum));
  const abbrB = dB.label || (dB.driverNum === 'SIM' ? 'SIM' : driverAbbr(dB.driverNum));
  const labelA = dA.driverNum === 'SIM' ? abbrA : `${abbrA} · Lap ${dA.lapNum}`;
  const labelB = dB.driverNum === 'SIM' ? abbrB : `${abbrB} · Lap ${dB.lapNum}`;

  // Normalise time to 0-based seconds
  const normalise = (data) => {
    if (!data.length) return [];
    // Real F1 data has ISO date strings; sim data has _t already
    if (data[0]._t !== undefined) return data;
    const t0 = new Date(data[0].date).getTime();
    return data.map(d => ({ ...d, _t: (new Date(d.date).getTime() - t0) / 1000 }));
  };

  const ndA = normalise(dA.data);
  const ndB = normalise(dB.data);

  // Delta bar summary
  const avgField = (data, field) => {
    const vals = data.map(d => d[field]).filter(v => v != null && !isNaN(v));
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  };

  const avgSpeedA = avgField(ndA, 'speed');
  const avgSpeedB = avgField(ndB, 'speed');
  const avgThrottleA = avgField(ndA, 'throttle');
  const avgThrottleB = avgField(ndB, 'throttle');

  const lapA = dA.driverNum !== 'SIM' ? (state.laps[dA.driverNum] || []).find(l => l.lap_number === dA.lapNum) : null;
  const lapB = dB.driverNum !== 'SIM' ? (state.laps[dB.driverNum] || []).find(l => l.lap_number === dB.lapNum) : null;
  const lapDelta = lapA && lapB && lapA.lap_duration && lapB.lap_duration
    ? lapA.lap_duration - lapB.lap_duration
    : null;

  document.getElementById('telemDeltaBar').style.display = 'flex';
  document.getElementById('dtSpeed').textContent =
    avgSpeedA != null && avgSpeedB != null
      ? (avgSpeedA - avgSpeedB >= 0 ? '+' : '') + (avgSpeedA - avgSpeedB).toFixed(1) + ' km/h'
      : '—';
  document.getElementById('dtThrottle').textContent =
    avgThrottleA != null && avgThrottleB != null
      ? (avgThrottleA - avgThrottleB >= 0 ? '+' : '') + (avgThrottleA - avgThrottleB).toFixed(1) + '%'
      : '—';
  document.getElementById('dtBrake').textContent = '—';
  document.getElementById('dtLap').textContent = lapDelta !== null
    ? (lapDelta > 0 ? '+' : '') + lapDelta.toFixed(3) + 's'
    : '—';

  channels.forEach(ch => {
    if (!document.getElementById(ch.chk)?.checked) return;

    // Check if data has this channel
    const hasDataA = ndA.some(d => d[ch.key] != null);
    const hasDataB = ndB.some(d => d[ch.key] != null);
    if (!hasDataA && !hasDataB) return;

    const block = document.createElement('div');
    block.className = 'telem-chart-block';
    block.innerHTML = `
      <div class="telem-chart-label">${ch.label}</div>
      <div class="chart-legend">
        <div class="legend-item"><div class="legend-line" style="background:${colA}"></div>${labelA}</div>
        <div class="legend-item"><div class="legend-line dashed" style="color:${colB}"></div>${labelB}</div>
      </div>
      <div class="telem-canvas-wrap"><canvas id="tch_${ch.key}"></canvas></div>`;
    container.appendChild(block);

    const ctx = document.getElementById('tch_' + ch.key).getContext('2d');
    const dsA = ndA.map(d => ({ x: d._t, y: d[ch.key] ?? null }));
    const dsB = ndB.map(d => ({ x: d._t, y: d[ch.key] ?? null }));

    state.telemCharts[ch.key] = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [
          { label: labelA, data: dsA, borderColor: colA, borderWidth: 1.5, pointRadius: 0, tension: 0.15, spanGaps: true },
          { label: labelB, data: dsB, borderColor: colB, borderWidth: 1.5, pointRadius: 0, tension: 0.15, spanGaps: true,
            borderDash: [4, 2] },
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, parsing: false,
        animation: { duration: 300 },
        scales: {
          x: {
            type: 'linear',
            title: { display: true, text: 'Time (s)', color: '#4e4e5e', font: { size: 9 } },
            ticks: { color: '#4e4e5e', font: { size: 9 }, maxTicksLimit: 8 },
            grid: { color: 'rgba(255,255,255,0.03)' },
          },
          y: {
            ticks: { color: '#4e4e5e', font: { size: 9 } },
            grid: { color: 'rgba(255,255,255,0.03)' },
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: 'index', intersect: false,
            backgroundColor: '#1f1f25', borderColor: 'rgba(255,255,255,0.08)', borderWidth: 1,
            titleColor: '#ededf0', bodyColor: '#9a9aa8',
            callbacks: { title: items => `t = ${items[0]?.parsed.x?.toFixed(2)}s` }
          }
        }
      }
    });
  });

  if (Object.keys(state.telemCharts).length === 0) {
    container.innerHTML = '<div class="telem-placeholder"><div class="placeholder-icon">⚠</div><div>No channel data available for this lap. Try another lap or check channel selections.</div></div>';
  }
}

/* ══════════════════════════════════════════════════════════════
   STINTS VIEW
══════════════════════════════════════════════════════════════ */

function populateStintSidebar() {
  document.getElementById('sbStintSession').textContent = state.sessionName || 'No session loaded';
  renderStintDriverList();
  populateDriverSelect('stintDriverAdd', state.stintDrivers);
}

function renderStintDriverList() {
  const list = document.getElementById('stintDriverList');
  list.innerHTML = '';
  state.stintDrivers.forEach(num => {
    const d = state.drivers.find(x => x.driver_number == num);
    if (!d) return;
    const chip = document.createElement('div');
    chip.className = 'driver-chip';
    chip.innerHTML = `
      <span class="dot" style="background:${d._colour}"></span>
      <span class="abbr">${d.name_acronym}</span>
      <span class="fullname">${d.full_name || ''}</span>
      <button class="remove-btn" onclick="removeStintDriver(${num})">×</button>`;
    list.appendChild(chip);
  });
}

function addStintDriver() {
  const sel = document.getElementById('stintDriverAdd');
  const num = parseInt(sel.value);
  if (!num || state.stintDrivers.includes(num)) return;
  state.stintDrivers.push(num);
  populateStintSidebar();
}

function removeStintDriver(num) {
  state.stintDrivers = state.stintDrivers.filter(n => n !== num);
  populateStintSidebar();
}

function renderStints() {
  if (!state.sessionKey) { showToast('Load a session first'); return; }
  if (!state.stintDrivers.length) { showToast('Add at least one driver'); return; }

  // Strategy bars
  const strategy = document.getElementById('stintStrategy');
  strategy.innerHTML = '';

  const allLapCounts = state.stintDrivers.map(num => {
    const laps = state.laps[num] || [];
    return laps.length ? Math.max(...laps.map(l => l.lap_number)) : 0;
  });
  const maxLap = Math.max(...allLapCounts, 1);

  let hasStintData = false;
  state.stintDrivers.forEach(num => {
    const d = state.drivers.find(x => x.driver_number == num);
    if (!d) return;
    const stints = state.stints[num] || [];
    if (stints.length) hasStintData = true;

    const row = document.createElement('div');
    row.className = 'stint-driver-row';
    row.innerHTML = `<div class="stint-driver-label" style="color:${d._colour}">${d.name_acronym}</div>`;

    const bars = document.createElement('div');
    bars.className = 'stint-bars';

    if (stints.length === 0) {
      bars.innerHTML = '<span style="color:var(--text3);font-size:11px;padding-left:8px">No stint data</span>';
    } else {
      stints.forEach(s => {
        const start = s.lap_start || 1;
        const end   = s.lap_end   || maxLap;
        const width = ((end - start + 1) / maxLap) * 100;
        const compound = (s.compound || 'H').charAt(0).toUpperCase();
        const tyreClass = { S:'tyre-S', M:'tyre-M', H:'tyre-H', I:'tyre-I', W:'tyre-W' }[compound] || 'tyre-H';
        const bar = document.createElement('div');
        bar.className = `stint-bar ${tyreClass}`;
        bar.style.width = `${width}%`;
        bar.title = `${compound} · L${start}–${end}`;
        bar.textContent = width > 8 ? `${compound} · L${start}–${end}` : compound;
        bars.appendChild(bar);
      });
    }

    row.appendChild(bars);
    strategy.appendChild(row);
  });

  // Stint pace chart — plot lap times coloured by driver
  if (state.stintChart) { state.stintChart.destroy(); state.stintChart = null; }

  const datasets = [];
  state.stintDrivers.forEach(num => {
    const d = state.drivers.find(x => x.driver_number == num);
    if (!d) return;
    const laps = (state.laps[num] || [])
      .filter(l => l.lap_duration && l.lap_duration < 300 && !l.is_pit_out_lap)
      .map(l => ({ x: l.lap_number, y: l.lap_duration }));

    datasets.push({
      label: d.name_acronym,
      data: laps,
      borderColor: d._colour,
      backgroundColor: d._colour + '18',
      borderWidth: 1.8,
      pointRadius: 1.5,
      tension: 0.15,
      spanGaps: false,
    });
  });

  const ctx2 = document.getElementById('stintPaceChart').getContext('2d');
  state.stintChart = new Chart(ctx2, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false, parsing: false,
      animation: { duration: 400 },
      scales: {
        x: {
          type: 'linear',
          title: { display: true, text: 'Lap', color: '#5a5a68', font: { size: 10 } },
          ticks: { color: '#5a5a68', font: { size: 10 } },
          grid: { color: 'rgba(255,255,255,0.04)' },
        },
        y: {
          ticks: {
            color: '#5a5a68', font: { size: 10, family: "'Space Mono',monospace" },
            callback: v => fmtTime(v),
          },
          grid: { color: 'rgba(255,255,255,0.04)' },
        }
      },
      plugins: {
        legend: { labels: { color: '#9a9aa8', font: { size: 11 }, boxWidth: 12, padding: 14 } },
        tooltip: {
          callbacks: { label: ctx => `${ctx.dataset.label}: ${fmtTime(ctx.parsed.y)}` },
          backgroundColor: '#1f1f25', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1,
          titleColor: '#ededf0', bodyColor: '#9a9aa8',
        }
      }
    }
  });

  // Stint metrics
  renderStintMetrics();
}

function renderStintMetrics() {
  const container = document.getElementById('stintMetrics');
  container.innerHTML = '';

  state.stintDrivers.slice(0, 3).forEach(num => {
    const d = state.drivers.find(x => x.driver_number == num);
    if (!d) return;
    const laps = (state.laps[num] || []).filter(l => l.lap_duration && !l.is_pit_out_lap && l.lap_duration < 300);
    if (!laps.length) return;
    const avg = laps.reduce((s, l) => s + l.lap_duration, 0) / laps.length;
    const best = Math.min(...laps.map(l => l.lap_duration));
    const numStints = (state.stints[num] || []).length;

    const card = document.createElement('div');
    card.className = 'metric-card';
    card.innerHTML = `
      <div class="metric-label" style="color:${d._colour}">${d.name_acronym}</div>
      <div class="metric-value" style="font-size:16px">${fmtTime(avg)}</div>
      <div class="metric-sub">avg · best ${fmtTime(best)} · ${numStints} stint${numStints !== 1 ? 's' : ''}</div>`;
    container.appendChild(card);
  });
}

/* ══════════════════════════════════════════════════════════════
   IMPORT MODAL
══════════════════════════════════════════════════════════════ */

function openImportModal() {
  document.getElementById('importModal').style.display = 'flex';
}

function closeImportModal(e) {
  // If called from backdrop click, only close if the backdrop itself was clicked
  if (e && e.type === 'click' && e.target.id !== 'importModal') return;
  document.getElementById('importModal').style.display = 'none';
  state.pendingFile = null;
  const result = document.getElementById('importResult');
  result.style.display = 'none';
  result.style.color = '';
  document.getElementById('btnImportDo').disabled = true;
  document.querySelector('.drop-text').textContent = 'Drop file here or click to browse';
}

function selectPlatform(p) {
  state.selectedPlatform = p;
  document.getElementById('platIRacing').classList.toggle('active', p === 'iracing');
  document.getElementById('platLMU').classList.toggle('active', p === 'lmu');
}

function handleFileDrop(e) {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file) processImportFile(file);
}

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (file) processImportFile(file);
}

function processImportFile(file) {
  state.pendingFile = file;
  const result = document.getElementById('importResult');
  result.style.display = 'block';
  result.style.color = '';
  result.textContent = `✓ File ready: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
  document.getElementById('btnImportDo').disabled = false;
  document.querySelector('.drop-text').textContent = file.name;
}

function doImport() {
  if (!state.pendingFile) return;
  const file = state.pendingFile;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const text = e.target.result;
      const lines = text.split('\n').filter(l => l.trim());
      if (lines.length < 2) throw new Error('File appears empty or has no data rows.');

      // Expect CSV: time,speed,throttle,brake,gear (and optionally drs)
      const header = lines[0].toLowerCase().split(',').map(h => h.trim());
      const timeIdx     = header.findIndex(h => h.includes('time') || h === 't');
      const speedIdx    = header.findIndex(h => h.includes('speed'));
      const throttleIdx = header.findIndex(h => h.includes('throttle'));
      const brakeIdx    = header.findIndex(h => h.includes('brake'));
      const gearIdx     = header.findIndex(h => h.includes('gear'));
      const drsIdx      = header.findIndex(h => h.includes('drs'));

      if (timeIdx === -1) throw new Error('Could not find a time column. Expected headers: time, speed, throttle, brake, gear');

      const data = lines.slice(1).map(line => {
        const cols = line.split(',');
        return {
          _t:       parseFloat(cols[timeIdx] ?? 0),
          speed:    speedIdx >= 0 ? parseFloat(cols[speedIdx] ?? 0) : null,
          throttle: throttleIdx >= 0 ? parseFloat(cols[throttleIdx] ?? 0) : null,
          brake:    brakeIdx >= 0 ? parseFloat(cols[brakeIdx] ?? 0) : null,
          n_gear:   gearIdx >= 0 ? parseFloat(cols[gearIdx] ?? 0) : null,
          drs:      drsIdx >= 0 ? parseFloat(cols[drsIdx] ?? 0) : 0,
        };
      }).filter(d => !isNaN(d._t));

      if (!data.length) throw new Error('No valid rows found. Check the file format.');

      // Estimate lap time from time column
      const lapTime = data[data.length - 1]._t - data[0]._t;

      state.simLaps.push({
        label: file.name.replace(/\.[^.]+$/, ''),
        platform: state.selectedPlatform,
        data,
        lapTime,
      });

      const result = document.getElementById('importResult');
      result.textContent = `✓ Imported ${data.length} data points · Estimated lap: ${fmtTime(lapTime)}`;
      showToast(`Sim lap imported: ${fmtTime(lapTime)}`);
      document.getElementById('btnImportDo').disabled = true;

      // Inject into telemetry driver selects as a virtual entry
      injectSimLapIntoTelemetry(state.simLaps[state.simLaps.length - 1]);
    } catch(err) {
      const result = document.getElementById('importResult');
      result.textContent = `Error: ${err.message}`;
      result.style.color = '#e63946';
    }
  };
  reader.readAsText(file);
}

function injectSimLapIntoTelemetry(simLap) {
  ['telemLapA', 'telemLapB'].forEach(id => {
    const sel = document.getElementById(id);
    const grp = document.createElement('optgroup');
    grp.label = `[SIM] ${simLap.platform.toUpperCase()}`;
    const opt = document.createElement('option');
    opt.value = `sim_${state.simLaps.length - 1}`;
    opt.textContent = `${simLap.label}  ${fmtTime(simLap.lapTime)}`;
    grp.appendChild(opt);
    sel.appendChild(grp);
  });
  showView('telemetry');
  document.getElementById('importModal').style.display = 'none';
}

/* ══════════════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', () => {
  showView('home');
  onYearChange();
});
