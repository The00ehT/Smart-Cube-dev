import './styles.css';
import { now } from 'gan-web-bluetooth';
import { SOLVED, applyMove, applyAlg, isSolved, COLOR_NAMES, groupMoves, CROSS_DOWN } from './cube/facelets.js';
import { analyzeGyro, fromGan } from './cube/gyro.js';
import { ScrambleTracker } from './cube/scramble-tracker.js';
import { SolveRecorder } from './cube/solve-recorder.js';
import { bluetoothAvailable, connectGan, connectOther, connectVirtual } from './cube/connection.js';
import { CubeView } from './ui/cube-view.js';
import { forgetMacs } from './ui/mac-dialog.js';
import { load, save } from './storage.js';
import { averageOf, bestAverage, best, mean, formatTime, formatSolve, effectiveTime } from './stats.js';
import { buildSolve, hasDetail, phasesOf, phaseName } from './solve-data.js';
import { decodeShare } from './share.js';
import { Replay, colorChip } from './ui/replay.js';
import { StatsView } from './ui/stats-view.js';
import { donut, phaseSegments } from './ui/donut.js';
import { profile, saveProfile, avatarHtml, resizeImage, EMOJIS } from './profile.js';
import { Room, normalizeCode } from './room.js';
import { RoomView } from './ui/room-view.js';

const $ = (id) => document.getElementById(id);
const SOLVES_KEY = 'smartcube.solves.v1';
const SETTINGS_KEY = 'smartcube.settings.v1';

const settings = { inspection: false, autoScramble: true, hideTime: false, gyro: true, viewDown: 'auto', theme: 'auto', replayGyro: true, ...load(SETTINGS_KEY, {}) };
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
const replay = new Replay($('replay-dialog'));
const statsView = new StatsView($('stats-dialog'));

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
      if (!settings.gyro) break; // ausgeschaltet: nichts verarbeiten, nichts zeichnen
      view.setGyro(e.quaternion);
      recordGyro(e.quaternion);
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
  view.resetGyroSeen();
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
  const before = app.state;
  app.state = applyMove(app.state, e.move);
  view.addMove(e.move);
  app.room?.live('move', { m: e.move });
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
      startSolve(e, before);
      break;
    case 'running':
      app.recorder.push(e);
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

async function randomScramble() {
  const { randomScrambleForEvent } = await import('cubing/scramble');
  return (await randomScrambleForEvent('333')).toString();
}

/** Neues Scramble; im Raum kommt es vom Gastgeber (given) */
async function newScramble(given) {
  if (app.room && typeof given !== 'string') {
    setStatus('Im Raum gibt der Gastgeber die Scrambles vor.');
    return;
  }
  app.phase = 'scrambling';
  updateViewOrientation();
  app.tracker = null;
  app.scramble = '';
  $('scramble').innerHTML = '<span class="msg">Scramble wird erzeugt …</span>';
  renderTimer();
  const alg = typeof given === 'string' ? given : await randomScramble();
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

function startSolve(e, before) {
  if (app.phase === 'inspecting') {
    const t = now() - app.inspectionStart;
    app.inspectionPenalty = t > 17000 ? 'DNF' : t > 15000 ? 2000 : 0;
  }
  app.phase = 'running';
  app.recorder = new SolveRecorder(before);
  // Gyro-Messungen: die letzte vor dem Start als Ausgangslage behalten
  app.gyroSamples = app.lastGyro ? [app.lastGyro] : [];
  app.startLocal = e.localTimestamp ?? now();
  app.recorder.push(e);
  updateViewOrientation();
  setStatus('Läuft …');
  if (isSolved(app.state)) finishSolve();
  renderTimer();
}

function finishSolve() {
  const r = app.recorder.finish();
  const gyro = gyroOfSolve(r);
  const solve = buildSolve(r, {
    ...(gyro ? { gyro } : {}),
    penalty: app.inspectionPenalty || 0,
    scramble: app.scramble,
    device: app.conn?.name || '',
  });
  solves.push(solve);
  persistSolves();
  app.phase = 'done';
  app.lastSolve = solve;
  app.movesSinceSync = 0;
  view.setState(app.state);
  updateViewOrientation();
  renderTimer();
  renderSplits(solve);
  renderSolves();
  const pb = best(solves) === effectiveTime(solve) && solves.length > 1;
  const summary = () => `${formatSolve(solve)} · ${solve.moveCount} Züge · ${solve.tps.toFixed(2)} TPS${pb ? ' · Neue Bestzeit! 🎉' : ''}`;
  setStatus(summary());
  if (app.room) {
    app.room.result(app.roomRound, solve);
    app.roomRound = null;
    setStatus(summary() + ' · warte auf die anderen …');
    app.room.live('state', { facelets: app.state });
    if (app.pendingRound) {
      const r = app.pendingRound;
      app.pendingRound = null;
      setTimeout(() => onRoomEvent(r), 1500);
    }
  } else if (settings.autoScramble) newScramble().then(() => setStatus('Letzter Solve: ' + summary()));
}

/** Gyro-Messung merken (Zeit = Gerätezeit beim Empfang) */
function recordGyro(q) {
  const sample = { t: now(), q: fromGan(q) };
  app.lastGyro = sample;
  if (app.phase === 'running' && app.gyroSamples) app.gyroSamples.push(sample);
}

/** Drehungen und Griffwechsel aus den Gyro-Messungen eines Solves */
function gyroOfSolve(r) {
  const raw = app.gyroSamples || [];
  app.gyroSamples = null;
  if (!settings.gyro || raw.length < 3) return null;
  const samples = raw.map((s) => ({ t: s.t - app.startLocal, q: s.q }));
  try {
    const g = analyzeGyro(samples, r.times, CROSS_DOWN[r.crossFace]);
    return { v0: g.v0, rotations: g.rotations, regrips: g.regrips };
  } catch (err) {
    console.error(err);
    return null;
  }
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
  // Im Raum: Statuswechsel an die anderen melden
  if (app.room && app.phase !== app.sentPhase) {
    app.sentPhase = app.phase;
    app.room.live('status', { phase: app.phase, elapsed: app.phase === 'running' ? now() - app.startLocal : 0 });
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

function renderSplits(solve) {
  const el = $('splits');
  if (!hasDetail(solve)) {
    el.innerHTML = (solve.phases || [])
      .map((p) => `<div class="sp">${phaseName(p)}<b>${formatTime(p.time)}</b>${p.moves} Z.</div>`)
      .join('');
    return;
  }
  const [cross, f2l, oll, pll] = phasesOf(solve, { mergeF2l: true });
  const pairs = solve.phases.slice(1, 5);
  const recog = (p) => (p.recog > 0 ? `<small>Erk. ${formatTime(p.recog)}</small>` : '');
  const skip = (p) => (p.skip ? '<small class="tag">Skip</small>' : '');
  el.innerHTML = `
    <div class="sp ph-cross">Kreuz ${colorChip(solve.crossFace)}<b>${formatTime(cross.time)}</b>${cross.moves} Z.${solve.xcross ? '<small class="tag">X-Cross</small>' : ''}</div>
    <div class="sp ph-pair">F2L<b>${formatTime(f2l.time)}</b>${f2l.moves} Z.
      <small class="pairs">${pairs.map((p) => formatTime(p.time)).join(' · ')}</small></div>
    <div class="sp ph-oll">OLL<b>${formatTime(oll.time)}</b>${oll.moves} Z.${recog(oll)}${skip(oll)}</div>
    <div class="sp ph-pll">PLL<b>${formatTime(pll.time)}</b>${pll.moves} Z.${recog(pll)}${skip(pll)}</div>`;
}

/**
 * Ansicht ohne Gyroskop: beim Scrambeln Standardlage (Weiß oben, Grün vorne),
 * sonst liegt die Kreuzfarbe unten (Einstellung „auto“: häufigste Kreuzfarbe der letzten 12 Solves).
 */
function updateViewOrientation() {
  if (app.phase === 'scrambling' || settings.viewDown === 'none') return view.setDownFace(null);
  let face = settings.viewDown;
  if (face === 'auto') {
    const count = {};
    for (const s of solves.slice(-12)) if (s.crossFace) count[s.crossFace] = (count[s.crossFace] || 0) + 1;
    face = Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }
  view.setDownFace(face);
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
  // Ø Erkennung OLL/PLL über die letzten 12 Solves mit Detaildaten
  const det = solves.filter(hasDetail).slice(-12);
  if (det.length) {
    const avgOf = (i) => det.reduce((a, s) => a + s.phases[i].recog, 0) / det.length;
    items.push(['Ø Erk. OLL', formatTime(avgOf(5))], ['Ø Erk. PLL', formatTime(avgOf(6))], ['Ø F2L', formatTime(det.reduce((a, s) => a + s.phases.slice(1, 5).reduce((b, p) => b + p.time, 0), 0) / det.length)]);
  }
  renderMiniPie(det);
  $('stats').innerHTML = items.map(([k, v]) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('');
}

/** Kuchendiagramm der Phasen über die letzten 12 Solves mit Detaildaten */
function renderMiniPie(det) {
  const el = $('phase-pie');
  if (!det.length) {
    el.innerHTML = '';
    return;
  }
  const m = (pick) => det.reduce((a, s) => a + pick(s), 0) / det.length;
  const f2l = m((s) => s.phases.slice(1, 5).reduce((a, p) => a + p.time, 0));
  const vals = { cross: m((s) => s.phases[0].time), f2l, oll: m((s) => s.phases[5].time), pll: m((s) => s.phases[6].time) };
  el.innerHTML = `<div class="label">Zeitverteilung · Ø letzte ${det.length}</div>` +
    donut(phaseSegments(vals), { value: formatTime(vals.cross + vals.f2l + vals.oll + vals.pll), label: 'Ø' }, { size: 132 });
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

/** Daten für die Wiedergabe; alte Solves ohne Zugzeiten bekommen gleichmäßige Zeiten */
function replayData(s) {
  if (hasDetail(s)) return { ...s, moves: s.solution.split(' ').filter(Boolean) };
  const moves = (s.solution || '').split(' ').filter(Boolean);
  if (!s.scramble || !moves.length) return null;
  const start = applyAlg(SOLVED, s.scramble);
  if (!isSolved(applyAlg(start, moves.join(' ')))) return null;
  const step = s.time / Math.max(1, moves.length - 1);
  return { ...s, start, moves, times: moves.map((_, k) => Math.round(k * step)), estimated: true };
}

function openSolve(i) {
  const s = solves[i];
  if (!s) return;
  const dlg = $('solve-dialog');
  dlg.dataset.index = i;
  $('sd-time').textContent = `${i + 1}. ${formatSolve(s)}`;
  $('sd-date').textContent = `${new Date(s.date).toLocaleString('de-DE')}${s.device ? ' · ' + s.device : ''}`;
  const detail = hasDetail(s);
  const rows = (s.phases || []).map((p) => {
    const name = phaseName(p) + (p.slot ? ' ' + [...p.slot].map(colorChip).join('') : '');
    const exec = p.time - (p.recog || 0);
    const tps = exec > 0 && p.moves ? ((p.moves / exec) * 1000).toFixed(2) : '–';
    const tag = p.skip ? ' <span class="tag">Skip</span>' : '';
    return `<tr class="${/^p\d$/.test(p.key ?? '') ? 'sub' : ''}"><td>${name}${tag}</td><td>${formatTime(p.time)}</td>${detail ? `<td>${p.key === 'cross' ? '–' : formatTime(p.recog)}</td>` : ''}<td>${p.moves}</td><td>${tps}</td></tr>`;
  });
  if (detail) {
    const [c, f, o, pl] = phasesOf(s, { mergeF2l: true });
    $('sd-pie').innerHTML = donut(phaseSegments({ cross: c.time, f2l: f.time, oll: o.time, pll: pl.time }), { value: formatTime(s.time), label: 'gesamt' }, { size: 140 });
  } else $('sd-pie').innerHTML = '';
  $('sd-phases').innerHTML = rows.length
    ? `<tr><th>Phase</th><th>Zeit</th>${detail ? '<th>Erkennung</th>' : ''}<th>Züge</th><th>TPS</th></tr>` + rows.join('')
    : '';
  const extra = [
    `${s.moveCount ?? '–'} Züge (Vierteldrehungen)`,
    `${(s.tps ?? 0).toFixed(2)} TPS`,
    s.crossFace ? `Kreuz: ${colorChip(s.crossFace)} ${COLOR_NAMES[s.crossFace]}` : '',
    s.xcross ? 'X-Cross' : '',
    s.gyro ? `${s.gyro.rotations.length} Würfeldrehungen${s.gyro.rotations.length ? ' (' + s.gyro.rotations.map((r) => r.name).join(', ') + ')' : ''}` : '',
    s.gyro ? `~${s.gyro.regrips.length} Griffwechsel` : '',
  ].filter(Boolean);
  $('sd-info').innerHTML = extra.map((x) => `<span>${x}</span>`).join('');
  $('sd-scramble').textContent = s.scramble || '(eigenes Scramble)';
  $('sd-solution').textContent = s.solution ? groupMoves(s.solution.split(' ').filter(Boolean)).map((g) => g.text).join(' ') : '–';
  $('sd-replay').hidden = !replayData(s);
  dlg.showModal();
}

$('sd-replay').addEventListener('click', (e) => {
  e.preventDefault();
  const dlg = $('solve-dialog');
  const s = solves[Number(dlg.dataset.index)];
  const data = s && replayData(s);
  if (!data) return;
  dlg.close();
  replay.open({ ...data, name: profile.name }, { title: `Solve ${Number(dlg.dataset.index) + 1}` });
});

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
bindToggle('opt-gyro', 'gyro', (on) => {
  view.setGyroEnabled(on);
  if (!on) app.lastGyro = null;
});
replay.useGyro = settings.replayGyro;
replay.onGyroToggle = (on) => {
  settings.replayGyro = on;
  save(SETTINGS_KEY, settings);
};

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

$('btn-stats').addEventListener('click', () => statsView.open(solves));

// ---------------- Einstellungen, Profil, Farbschema ----------------

const settingsDlg = $('settings-dialog');
const openSettings = () => settingsDlg.showModal();
$('btn-settings').addEventListener('click', openSettings);
$('profile-chip').addEventListener('click', openSettings);
$('settings-close').addEventListener('click', () => settingsDlg.close());

function renderProfile() {
  $('avatar-top').innerHTML = avatarHtml();
  $('avatar-preview').innerHTML = avatarHtml();
  $('name-top').textContent = profile.name || 'Profil';
  $('opt-name').value = profile.name;
  $('emoji-grid').querySelectorAll('button').forEach((b) => {
    const on = profile.avatar?.type === 'emoji' && profile.avatar.value === b.dataset.e;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on);
  });
}
function storeProfile() {
  if (!saveProfile()) setStatus('Hinweis: Profil konnte nicht gespeichert werden (Speicher voll?).');
  renderProfile();
}
$('emoji-grid').innerHTML = EMOJIS.map((e) => `<button type="button" data-e="${e}" aria-label="Avatar ${e}">${e}</button>`).join('');
$('emoji-grid').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-e]');
  if (!b) return;
  profile.avatar = { type: 'emoji', value: b.dataset.e };
  storeProfile();
});
$('opt-name').addEventListener('input', (e) => {
  profile.name = e.target.value.trim().slice(0, 24);
  storeProfile();
});
$('avatar-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    profile.avatar = { type: 'image', value: await resizeImage(file) };
    storeProfile();
  } catch (err) {
    setStatus(String(err.message || err));
  }
});
$('avatar-clear').addEventListener('click', () => {
  profile.avatar = null;
  storeProfile();
});

function applyTheme() {
  const t = settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  const dark = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name=theme-color]').content = dark ? '#181b21' : '#ffffff';
  $('opt-theme').querySelectorAll('button').forEach((b) => {
    b.classList.toggle('on', b.dataset.v === t);
    b.setAttribute('aria-checked', b.dataset.v === t);
  });
}
$('opt-theme').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-v]');
  if (!b) return;
  settings.theme = b.dataset.v;
  save(SETTINGS_KEY, settings);
  applyTheme();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
applyTheme();
renderProfile();

$('opt-view-down').value = settings.viewDown;
$('opt-view-down').addEventListener('change', (e) => {
  settings.viewDown = e.target.value;
  save(SETTINGS_KEY, settings);
  updateViewOrientation();
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

// ---------------- Online-Raum ----------------

const roomView = new RoomView($('room-panel'), {
  onInvite: () => inviteToRoom(),
  onNextRound: () => hostNextRound(),
  onLeave: () => leaveRoom(),
  onAutoChange: (on) => (app.roomAuto = on),
});
app.roomAuto = true;

function roomLink(code) {
  return `${location.href.split('#')[0]}#raum=${code}`;
}

async function inviteToRoom() {
  const url = roomLink(app.room.code);
  const text = `Komm in meinen Smartcube-Raum: ${app.room.code}`;
  try {
    if (navigator.share) return await navigator.share({ title: 'Smartcube-Raum', text, url });
  } catch (e) {
    if (e?.name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(url);
    roomView.message('Einladungslink kopiert.');
  } catch {
    prompt('Einladungslink:', url);
  }
}

function onRoomEvent(ev) {
  const room = app.room;
  if (!room) return;
  switch (ev.type) {
    case 'roster':
      roomView.renderRoster(ev.roster);
      break;
    case 'board':
      roomView.renderBoard(ev.board);
      if (room.isHost && app.roomAuto && room.roundComplete() && !app.nextRoundTimer) {
        roomView.message('Alle fertig – nächste Runde in 5 s …');
        app.nextRoundTimer = setTimeout(() => {
          app.nextRoundTimer = null;
          if (app.room && room.roundComplete()) hostNextRound();
        }, 5000);
      }
      break;
    case 'round':
      if (app.phase === 'running' || app.phase === 'inspecting') {
        app.pendingRound = ev; // erst nach dem laufenden Solve
        break;
      }
      app.roomRound = ev.n;
      roomView.message(`Runde ${ev.n}: Scramble ausführen, der erste Zug danach startet die Zeit.`);
      for (const c of roomView.cards.values()) c.el.querySelector('.person-time').textContent = '–';
      if (!isSolved(app.state) && app.conn) setStatus('Löse zuerst deinen Würfel (oder „Als gelöst markieren“), dann stimmt das Scramble.');
      newScramble(ev.scramble);
      room.live('state', { facelets: app.state });
      break;
    case 'live':
      roomView.live(ev);
      break;
    case 'result':
      roomView.result(ev);
      break;
    case 'closed':
      setStatus(ev.reason);
      leaveRoom(true);
      break;
    case 'error':
      console.error(ev.error);
      roomView.message('Verbindungsproblem: ' + (ev.error?.message || ev.error));
      break;
  }
}

async function hostNextRound() {
  if (!app.room?.isHost) return;
  clearTimeout(app.nextRoundTimer);
  app.nextRoundTimer = null;
  roomView.message('Scramble wird erzeugt …');
  app.room.startRound(await randomScramble());
}

async function enterRoom(mode, code) {
  const msg = $('room-error');
  msg.textContent = '';
  if (!profile.name) {
    msg.textContent = 'Gib dir zuerst einen Namen (Einstellungen → Profil), damit die anderen dich erkennen.';
    return;
  }
  const room = new Room({ name: profile.name, avatar: profile.avatar }, (ev) => onRoomEvent(ev));
  app.room = room; // schon setzen, damit frühe Ereignisse ankommen
  $('room-dialog').querySelectorAll('button').forEach((b) => (b.disabled = true));
  msg.textContent = mode === 'create' ? 'Raum wird erstellt …' : 'Verbinde …';
  try {
    roomView.show(room); // Karten brauchen room.myId – Liste wird nach dem Öffnen gezeichnet
    if (mode === 'create') await room.create();
    else await room.join(code);
    roomView.show(room);
    roomView.renderRoster(room.roster);
    $('room-dialog').close();
    app.sentPhase = null;
    room.live('state', { facelets: app.state });
    if (app.phase === 'scrambling' || app.phase === 'done') {
      app.phase = 'idle';
      renderTimer();
    }
    setStatus(mode === 'create' ? `Raum ${room.code} erstellt.` : `Raum ${room.code} beigetreten.`);
    history.replaceState(null, '', location.pathname + location.search);
  } catch (err) {
    console.error(err);
    app.room = null;
    room.leave();
    roomView.hide();
    msg.textContent = 'Das hat nicht geklappt: ' + (err?.message || err);
  } finally {
    $('room-dialog').querySelectorAll('button').forEach((b) => (b.disabled = false));
  }
}

function leaveRoom(silent) {
  if (!app.room) return;
  if (!silent && !confirm(app.room.isHost ? 'Raum schließen? Alle anderen fliegen dann raus.' : 'Raum verlassen?')) return;
  clearTimeout(app.nextRoundTimer);
  app.nextRoundTimer = null;
  app.room.leave();
  app.room = null;
  app.roomRound = null;
  roomView.hide();
  if (!silent) setStatus('Raum verlassen.');
}

$('btn-room').addEventListener('click', () => {
  if (app.room) return $('room-panel').scrollIntoView({ behavior: 'smooth' });
  $('room-error').textContent = profile.name ? '' : 'Tipp: Gib dir in den Einstellungen einen Namen.';
  $('room-dialog').showModal();
});
$('room-create').addEventListener('click', () => enterRoom('create'));
$('room-join').addEventListener('click', () => enterRoom('join', $('room-code').value));
$('room-code').addEventListener('input', (e) => (e.target.value = normalizeCode(e.target.value)));
$('room-cancel').addEventListener('click', () => $('room-dialog').close());

/** Einladungslink #raum=CODE: Beitreten-Dialog mit Code öffnen */
function openRoomFromHash() {
  const m = /[#&]raum=([A-Za-z0-9]{5})/.exec(location.hash);
  if (!m || app.room) return;
  $('room-code').value = normalizeCode(m[1]);
  $('room-error').textContent = profile.name ? '' : 'Gib dir zuerst in den Einstellungen einen Namen.';
  $('room-dialog').showModal();
}
window.addEventListener('hashchange', openRoomFromHash);
window.addEventListener('beforeunload', () => app.room?.leave());

// ---------------- Start ----------------

if (!bluetoothAvailable()) {
  $('bt-notice').hidden = false;
  $('btn-connect-gan').disabled = true;
  $('btn-connect-other').disabled = true;
}
renderDevice();
renderSolves();
renderTimer();
updateViewOrientation();

/** Geteilter Solve im Link (#r=1&…): direkt die Rekonstruktion zeigen */
function openSharedFromHash() {
  if (!/[#&]r=1/.test(location.hash)) return;
  try {
    const shared = decodeShare(location.hash);
    replay.onClose = () => {
      replay.onClose = null;
      history.replaceState(null, '', location.pathname + location.search);
    };
    replay.open(shared, { title: shared.name ? `Solve von ${shared.name}` : 'Geteilter Solve' });
  } catch (err) {
    setStatus('Der geteilte Link ist ungültig: ' + (err?.message || err));
  }
}
openSharedFromHash();
openRoomFromHash();

// Testzugang: mit ?debug in der URL lassen sich Würfel-Ereignisse simulieren (z. B. Gyro-Daten)
if (new URLSearchParams(location.search).has('debug')) window.__smartcube = { emit: onCubeEvent, app, settings };
window.addEventListener('hashchange', openSharedFromHash);
