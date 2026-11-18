import './styles.css';
import { now } from 'gan-web-bluetooth';
import { SOLVED, applyMove, isSolved } from './cube/facelets.js';
import { ScrambleTracker } from './cube/scramble-tracker.js';
import { SolveRecorder } from './cube/solve-recorder.js';
import { bluetoothAvailable, connectGan, connectOther, connectVirtual } from './cube/connection.js';
import { CubeView } from './ui/cube-view.js';
import { forgetMacs } from './ui/mac-dialog.js';
import { load, save } from './storage.js';
import { averageOf, bestAverage, best, mean, formatTime, formatSolve, effectiveTime } from './stats.js';

const $ = (id) => document.getElementById(id);
const SOLVES_KEY = 'smartcube.solves.v1';
const SETTINGS_KEY = 'smartcube.settings.v1';

const settings = { inspection: false, autoScramble: true, hideTime: false, gyro: true, ...load(SETTINGS_KEY, {}) };
let solves = load(SOLVES_KEY, []);

const app = {
  conn: null,
  state: SOLVED, // aktueller Würfelzustand (Kociemba)
  phase: 'idle', // idle | scrambling | ready | inspecting | running | done
  scramble: '',
  tracker: null,
  recorder: null,
  startLocal: 0,
  inspectionStart: 0,
  inspectionPenalty: 0,
  movesSinceSync: 0,
  lastMoves: [],
};

const view = new CubeView($('cube'));
view.setGyroEnabled(settings.gyro);

// ---------------- Verbindung ----------------

function onCubeEvent(e) {
  switch (e.type) {
    case 'move':
      onMove(e);
      break;
    case 'facelets':
      if (e.facelets !== app.state) {
        app.state = e.facelets;
        view.setState(app.state);
        if (app.phase === 'running' && isSolved(app.state)) finishSolve();
      }
      break;
    case 'gyro':
      view.setGyro(e.quaternion);
      break;
    case 'gyro-available':
      renderHardware();
      break;
    case 'battery':
      setBattery(e.level);
      break;
    case 'hardware':
      app.hardware = e.info;
      renderHardware();
      break;
    case 'disconnect':
      onDisconnected();
      break;
  }
}

async function connect(kind) {
  document.querySelector('.more')?.removeAttribute('open');
  if (app.conn) await disconnect();
  setStatus('Verbinde …');
  try {
    if (kind === 'gan') app.conn = await connectGan(onCubeEvent);
    else if (kind === 'other') app.conn = await connectOther(onCubeEvent);
    else {
      app.conn = connectVirtual(onCubeEvent);
      app.state = SOLVED;
      view.setState(SOLVED);
    }
  } catch (err) {
    app.conn = null;
    const msg = String(err?.message || err);
    if (err?.name === 'NotFoundError' || /cancel/i.test(msg)) setStatus('Verbindung abgebrochen.');
    else if (/target BLE services/i.test(msg)) setStatus('Dieser Würfel nutzt ein unbekanntes Protokoll – bitte melde das Modell, dann kann es ergänzt werden.');
    else setStatus('Verbindung fehlgeschlagen: ' + msg);
    console.error(err);
    renderDevice();
    return;
  }
  renderDevice();
  renderHardware();
  if (app.phase === 'idle') setStatus(isSolved(app.state) ? 'Verbunden. Hol dir ein Scramble.' : 'Verbunden.');
  if (app.conn.kind === 'gan') {
    clearInterval(app.batteryTimer);
    app.batteryTimer = setInterval(() => app.conn?.requestBattery().catch(() => {}), 60000);
  }
}

async function disconnect() {
  const c = app.conn;
  app.conn = null;
  try {
    await c?.disconnect();
  } catch {
    /* schon getrennt */
  }
  onDisconnected();
}

function onDisconnected() {
  app.conn = null;
  app.hardware = null;
  clearInterval(app.batteryTimer);
  if (app.phase === 'running') {
    app.phase = 'idle';
    setStatus('Verbindung verloren – Solve abgebrochen.');
  } else {
    setStatus('Getrennt.');
  }
  renderDevice();
  renderHardware();
  setBattery(null);
  renderTimer();
}

// ---------------- Züge und Ablauf ----------------

function onMove(e) {
  app.state = applyMove(app.state, e.move);
  view.addMove(e.move);
  app.lastMoves.push(e.move);
  if (app.lastMoves.length > 40) app.lastMoves.shift();
  $('last-moves').textContent = app.lastMoves.join(' ');

  switch (app.phase) {
    case 'scrambling':
      app.tracker.push(e.move);
      if (app.tracker.done) enterReady();
      renderScramble();
      break;
    case 'ready':
    case 'inspecting':
      startSolve(e);
      break;
    case 'running':
      app.recorder.push(e, app.state);
      if (isSolved(app.state)) finishSolve();
      break;
    default:
      if (app.phase === 'done' || app.phase === 'idle') maybeResync();
  }
}

/** Die Darstellung bekommt sonst eine immer längere Zugliste: ab und zu neu aufsetzen */
function maybeResync() {
  if (++app.movesSinceSync > 120) {
    app.movesSinceSync = 0;
    view.setState(app.state);
  }
}

async function newScramble() {
  app.phase = 'scrambling';
  app.tracker = null;
  app.scramble = '';
  $('scramble').innerHTML = '<span class="msg">Scramble wird erzeugt …</span>';
  renderTimer();
  const { randomScrambleForEvent } = await import('cubing/scramble');
  const alg = (await randomScrambleForEvent('333')).toString();
  if (app.phase !== 'scrambling') return; // inzwischen abgebrochen
  app.scramble = alg;
  app.tracker = new ScrambleTracker(alg);
  app.scrambleFromSolved = isSolved(app.state);
  renderScramble();
  setStatus(app.conn ? 'Verdrehe den Würfel wie angezeigt.' : 'Verbinde einen Würfel, damit das Scramble verfolgt wird.');
}

function ownScramble() {
  if (isSolved(app.state) && app.conn) {
    setStatus('Verdrehe den Würfel – danach „Eigenes Scramble“ drücken, der nächste Zug startet die Zeit.');
    return;
  }
  app.scramble = '';
  app.tracker = null;
  $('scramble').innerHTML = '<span class="msg">Eigenes Scramble</span>';
  $('scramble-progress').style.width = '100%';
  enterReady();
}

function enterReady() {
  app.inspectionPenalty = 0;
  if (settings.inspection) {
    app.phase = 'inspecting';
    app.inspectionStart = now();
    setStatus('Inspektion läuft – der erste Zug startet die Zeit.');
  } else {
    app.phase = 'ready';
    setStatus('Bereit! Der erste Zug startet die Zeit.');
  }
  $('splits').innerHTML = '';
  renderTimer();
}

function startSolve(e) {
  if (app.phase === 'inspecting') {
    const t = now() - app.inspectionStart;
    app.inspectionPenalty = t > 17000 ? 'DNF' : t > 15000 ? 2000 : 0;
  }
  app.phase = 'running';
  app.recorder = new SolveRecorder();
  app.startLocal = e.localTimestamp ?? now();
  app.recorder.push(e, app.state);
  setStatus('Läuft …');
  if (isSolved(app.state)) finishSolve();
  renderTimer();
}

function finishSolve() {
  const r = app.recorder.finish();
  const solve = {
    id: Date.now(),
    date: new Date().toISOString(),
    time: Math.round(r.time),
    penalty: app.inspectionPenalty || 0,
    scramble: app.scramble,
    solution: r.solution,
    moveCount: r.moveCount,
    tps: Math.round(r.tps * 100) / 100,
    crossFace: r.crossFace,
    phases: r.phases.map((p) => ({ name: p.name, time: Math.round(p.time), moves: p.moves })),
    device: app.conn?.name || '',
  };
  solves.push(solve);
  persistSolves();
  app.phase = 'done';
  app.lastSolve = solve;
  app.movesSinceSync = 0;
  view.setState(app.state);
  renderTimer();
  renderSplits(solve);
  renderSolves();
  const pb = best(solves) === effectiveTime(solve) && solves.length > 1;
  setStatus(`${formatSolve(solve)} · ${solve.moveCount} Züge · ${solve.tps.toFixed(2)} TPS${pb ? ' · Neue Bestzeit! 🎉' : ''}`);
  if (settings.autoScramble) newScramble().then(() => setStatus(`Letzter Solve: ${formatSolve(solve)} · ${solve.moveCount} Züge · ${solve.tps.toFixed(2)} TPS${pb ? ' · Neue Bestzeit! 🎉' : ''}`));
}

function cancelSolve() {
  if (app.phase !== 'running' && app.phase !== 'inspecting' && app.phase !== 'ready') return;
  app.phase = 'idle';
  setStatus('Abgebrochen.');
  renderTimer();
}

// ---------------- Darstellung ----------------

function setStatus(text) {
  $('status').textContent = text;
}

function setBattery(level) {
  const b = $('battery');
  if (level == null) {
    b.hidden = true;
    return;
  }
  b.hidden = false;
  b.textContent = `🔋 ${level} %`;
  b.classList.toggle('low', level <= 15);
}

function renderDevice() {
  const on = !!app.conn;
  $('device').classList.toggle('on', on);
  $('device-label').textContent = on ? app.conn.name : 'Nicht verbunden';
  $('connect-buttons').hidden = on;
  $('btn-disconnect').hidden = !on;
  $('pad').hidden = app.conn?.kind !== 'virtual';
  $('btn-mark-solved').disabled = !app.conn?.supportsReset;
}

function renderHardware() {
  const hw = $('hw');
  const c = app.conn;
  if (!c || c.kind === 'virtual') {
    hw.innerHTML = '';
    return;
  }
  const info = app.hardware || {};
  const rows = [
    ['Gerät', c.name],
    ['Modell', info.hardwareName],
    ['Firmware', info.softwareVersion],
    ['Hardware', info.hardwareVersion],
    ['MAC', c.mac],
    ['Gyroskop', c.supportsGyro || info.gyroSupported ? 'ja' : info.gyroSupported === false ? 'nein' : '–'],
  ].filter(([, v]) => v);
  hw.innerHTML = rows.map(([k, v]) => `<span>${k}</span><span>${escapeHtml(String(v))}</span>`).join('');
}

function renderScramble() {
  const el = $('scramble');
  const t = app.tracker;
  if (!t) return;
  if (t.done) {
    el.innerHTML = '<span class="msg">✓ Scramble fertig</span>';
    $('scramble-progress').style.width = '100%';
    return;
  }
  const moves = t.remainingMoves();
  const warn = !app.scrambleFromSolved && app.conn
    ? '<div class="warn">Der Würfel war beim Erzeugen nicht gelöst – erst lösen oder „Als gelöst markieren“, dann neues Scramble.</div>'
    : '';
  el.innerHTML = moves
    .map((m, i) => `<span class="mv${m.correction ? ' correction' : ''}${i === 0 ? ' next' : ''}">${m.text}</span>`)
    .join('') + warn;
  $('scramble-progress').style.width = `${Math.round(t.progress() * 100)}%`;
}

function renderTimer() {
  const el = $('timer');
  el.className = 'timer';
  if (app.phase === 'running') {
    el.textContent = settings.hideTime ? 'Solve …' : formatTime(now() - app.startLocal);
  } else if (app.phase === 'inspecting') {
    el.classList.add('inspect');
    const left = 15 - Math.floor((now() - app.inspectionStart) / 1000);
    el.textContent = left > 0 ? String(left) : left > -2 ? '+2' : 'DNF';
  } else if (app.phase === 'ready') {
    el.classList.add('ready');
    el.textContent = '0.00';
  } else if (app.lastSolve && (app.phase === 'done' || app.phase === 'scrambling')) {
    el.classList.add('done');
    el.textContent = formatSolve(app.lastSolve);
  } else if (app.phase === 'idle') {
    el.textContent = '0.00';
  }
}

function tick() {
  if (app.phase === 'running' || app.phase === 'inspecting') renderTimer();
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

function renderSplits(solve) {
  $('splits').innerHTML = (solve.phases || [])
    .map((p) => `<div class="sp">${p.name}<b>${formatTime(p.time)}</b>${p.moves} ${p.moves === 1 ? 'Zug' : 'Züge'}</div>`)
    .join('');
}

function renderStats() {
  const cur = (n) => formatTime(averageOf(solves, n));
  const items = [
    ['Bestzeit', formatTime(best(solves))],
    ['Ø 5', cur(5)],
    ['Ø 12', cur(12)],
    ['Mittel', formatTime(mean(solves))],
    ['Beste Ø 5', formatTime(bestAverage(solves, 5))],
    ['Beste Ø 12', formatTime(bestAverage(solves, 12))],
    ['Ø 100', cur(100)],
    ['Solves', String(solves.length)],
    ['Ø TPS', solves.length ? (solves.reduce((a, s) => a + (s.tps || 0), 0) / solves.length).toFixed(2) : '–'],
  ];
  $('stats').innerHTML = items.map(([k, v]) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('');
}

function renderSolves() {
  renderStats();
  const list = $('solves');
  if (!solves.length) {
    list.innerHTML = '<li class="empty">Noch keine Solves</li>';
    return;
  }
  const rows = [];
  for (let i = solves.length - 1; i >= 0 && rows.length < 300; i--) {
    const s = solves[i];
    const ao5 = averageOf(solves.slice(0, i + 1), 5);
    rows.push(
      `<li data-i="${i}"><span class="n">${i + 1}.</span><span class="t">${formatSolve(s)}</span>` +
        `<span class="meta">${s.moveCount ?? '–'} Z.</span><span class="ao">${ao5 === null ? '' : 'Ø5 ' + formatTime(ao5)}</span></li>`,
    );
  }
  list.innerHTML = rows.join('');
}

function persistSolves() {
  if (!save(SOLVES_KEY, solves)) setStatus('Hinweis: Solves konnten im Browser nicht gespeichert werden.');
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// ---------------- Solve-Details ----------------

function openSolve(i) {
  const s = solves[i];
  if (!s) return;
  const dlg = $('solve-dialog');
  dlg.dataset.index = i;
  $('sd-time').textContent = `${i + 1}. ${formatSolve(s)}`;
  $('sd-date').textContent = `${new Date(s.date).toLocaleString('de-DE')}${s.device ? ' · ' + s.device : ''}`;
  $('sd-phases').innerHTML = s.phases?.length
    ? '<tr><th>Phase</th><th>Zeit</th><th>Züge</th><th>TPS</th></tr>' +
      s.phases.map((p) => `<tr><td>${p.name}</td><td>${formatTime(p.time)}</td><td>${p.moves}</td><td>${p.time > 0 ? ((p.moves / p.time) * 1000).toFixed(2) : '–'}</td></tr>`).join('')
    : '';
  $('sd-info').innerHTML = `<span>${s.moveCount ?? '–'} Züge (Vierteldrehungen)</span><span>${(s.tps ?? 0).toFixed(2)} TPS</span>`;
  $('sd-scramble').textContent = s.scramble || '(eigenes Scramble)';
  $('sd-solution').textContent = s.solution || '–';
  const link = $('sd-replay');
  if (s.scramble && s.solution) {
    link.hidden = false;
    link.href = `https://alpha.twizzle.net/edit/?setup-alg=${encodeURIComponent(s.scramble)}&alg=${encodeURIComponent(s.solution)}`;
  } else link.hidden = true;
  dlg.showModal();
}

$('solve-dialog').addEventListener('close', () => {
  const dlg = $('solve-dialog');
  const i = Number(dlg.dataset.index);
  const s = solves[i];
  if (!s) return;
  const v = dlg.returnValue;
  if (v === 'ok-pen') s.penalty = 0;
  else if (v === 'p2') s.penalty = 2000;
  else if (v === 'dnf') s.penalty = 'DNF';
  else if (v === 'del') {
    if (!confirm('Diesen Solve löschen?')) return;
    solves.splice(i, 1);
    if (app.lastSolve === s) app.lastSolve = null;
  } else return;
  persistSolves();
  renderSolves();
  renderTimer();
});

$('solves').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-i]');
  if (li) openSolve(Number(li.dataset.i));
});

// ---------------- Bedienelemente ----------------

$('btn-connect-gan').addEventListener('click', () => connect('gan'));
$('btn-connect-other').addEventListener('click', () => connect('other'));
$('btn-connect-virtual').addEventListener('click', () => connect('virtual'));
$('btn-disconnect').addEventListener('click', disconnect);
$('btn-new-scramble').addEventListener('click', newScramble);
$('btn-own-scramble').addEventListener('click', ownScramble);
$('btn-reset-gyro').addEventListener('click', () => view.resetGyro());

$('btn-mark-solved').addEventListener('click', async () => {
  if (!app.conn) return;
  if (!confirm('Den Würfel jetzt als gelöst markieren? Nur machen, wenn er wirklich gelöst ist.')) return;
  await app.conn.reset();
  app.state = SOLVED;
  view.setState(SOLVED);
  if (app.phase === 'scrambling') newScramble();
});

const bindToggle = (id, key, after) => {
  const el = $(id);
  el.checked = !!settings[key];
  el.addEventListener('change', () => {
    settings[key] = el.checked;
    save(SETTINGS_KEY, settings);
    after?.(el.checked);
  });
};
bindToggle('opt-inspection', 'inspection');
bindToggle('opt-auto-scramble', 'autoScramble');
bindToggle('opt-hide-time', 'hideTime');
bindToggle('opt-gyro', 'gyro', (on) => view.setGyroEnabled(on));

$('btn-forget-mac').addEventListener('click', () => {
  forgetMacs();
  setStatus('Gespeicherte MAC-Adressen gelöscht.');
});

$('btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ app: 'smartcube', version: 1, solves }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `smartcube-solves-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('file-import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const incoming = (Array.isArray(data) ? data : data.solves).filter((s) => typeof s.time === 'number');
    const known = new Set(solves.map((s) => s.id));
    const added = incoming.filter((s) => !known.has(s.id));
    solves = [...solves, ...added].sort((a, b) => a.id - b.id);
    persistSolves();
    renderSolves();
    setStatus(`${added.length} Solves importiert.`);
  } catch {
    setStatus('Import fehlgeschlagen: keine gültige Export-Datei.');
  }
});

$('btn-clear').addEventListener('click', () => {
  if (!solves.length || !confirm(`Alle ${solves.length} Solves löschen? Tipp: vorher exportieren.`)) return;
  solves = [];
  app.lastSolve = null;
  persistSolves();
  renderSolves();
  renderTimer();
});

// Virtueller Würfel: Knöpfe und Tastatur
const PAD = ['U', "U'", 'R', "R'", 'F', "F'", 'D', "D'", 'L', "L'", 'B', "B'"];
$('pad-grid').innerHTML = PAD.map((m) => `<button data-move="${m}">${m}</button>`).join('');
$('pad-grid').addEventListener('click', (e) => {
  const m = e.target.closest('button')?.dataset.move;
  if (m && app.conn?.kind === 'virtual') app.conn.turn(m);
});
const KEYS = { i: 'R', k: "R'", j: 'U', f: "U'", h: 'F', g: "F'", d: 'L', e: "L'", s: 'D', l: "D'", w: 'B', o: "B'" };
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, dialog') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Escape') return cancelSolve();
  const m = KEYS[e.key.toLowerCase()];
  if (m && app.conn?.kind === 'virtual') {
    e.preventDefault();
    app.conn.turn(m);
  }
});

window.addEventListener('beforeunload', () => app.conn?.disconnect());

// ---------------- Start ----------------

if (!bluetoothAvailable()) {
  $('bt-notice').hidden = false;
  $('btn-connect-gan').disabled = true;
  $('btn-connect-other').disabled = true;
}
renderDevice();
renderSolves();
renderTimer();
