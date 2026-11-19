import './styles.css';
import { now } from 'gan-web-bluetooth';
import { SOLVED, FACES, applyMove, applyAlg, isSolved, COLOR_NAMES, groupMoves, CROSS_DOWN, phaseStatus, solvedSlots, relativeState } from './cube/facelets.js';
import { analyzeSolve } from './cube/analysis.js';
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
import { AlgsView } from './ui/algs-view.js';
import { Trainer } from './ui/trainer.js';
import { ArchiveView } from './ui/archive-view.js';
import { isArchived, addToArchive, removeFromArchive } from './archive.js';
import { easyState } from './cube/easy-scramble.js';
import { setupAlgFor } from './ui/cube-view.js';
import { toast, undoable } from './ui/toast.js';
import { confetti, chime, shareSolveImage } from './ui/celebrate.js';
import { coachInsights } from './coach.js';
import { metricsOf, skillProfile, SKILLS } from './metrics.js';
import { radarSvg } from './ui/radar.js';

const $ = (id) => document.getElementById(id);
const SOLVES_KEY = 'smartcube.solves.v1';
const SETTINGS_KEY = 'smartcube.settings.v1';

const settings = { inspection: false, autoScramble: true, hideTime: false, gyro: true, viewDown: 'auto', theme: 'auto', replayGyro: true, crossColor: 'auto', scrambleType: 'wca', ...load(SETTINGS_KEY, {}) };
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
const statsView = new StatsView($('stats-view'));
const trainer = new Trainer($('trainer-dialog'), {
  state: () => app.state,
  crossFace: () => crossFace(),
  connected: () => !!app.conn,
  now: () => now(),
});
const algsView = new AlgsView($('tab-algs'), $('case-dialog'), {
  solves: () => solves,
  crossFace: () => crossFace(),
  connected: () => !!app.conn,
  train: (ids, title) => trainer.start(ids, title),
});
const archiveView = new ArchiveView($('archive-view'), {
  open: (a) => {
    const data = a && replayData(a);
    if (data) replay.open({ ...data, name: profile.name }, { title: 'Archiv' });
  },
});

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

  // Algorithmus am Würfel aufnehmen oder trainieren: dann kein Solve-Ablauf
  if (algsView.recording && $('case-dialog').open) return void algsView.recordMove(e.move);
  if (trainer.active && trainer.onMove(e, app.state)) return;

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
      app.liveStage = Math.max(app.liveStage || 0, liveStage(app.state));
      renderLiveBar();
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

/** Leichtes Scramble: Kreuzkanten (und ggf. ein Paar) der eigenen Kreuzfarbe schon gelöst */
async function easyScramble(type) {
  const target = easyState(applyAlg(SOLVED, await randomScramble()), crossFace(), type);
  return setupAlgFor(target);
}

/** Kreuzfarbe des Nutzers: Einstellung oder häufigste der letzten 50 Solves (Standard Weiß) */
function crossFace() {
  if (settings.crossColor && settings.crossColor !== 'auto') return settings.crossColor;
  const count = {};
  for (const s of solves.slice(-50)) if (s.crossFace) count[s.crossFace] = (count[s.crossFace] || 0) + 1;
  return Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'U';
}

async function randomScramble() {
  const { randomScrambleForEvent } = await import('cubing/scramble');
  return (await randomScrambleForEvent('333')).toString();
}

/** Neues Scramble; im Raum kommt es vom Gastgeber (given) */
async function newScramble(given, opts = {}) {
  if (!opts.ghost && app.ghost) endGhost();
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
  let alg;
  const easy = typeof given !== 'string' && settings.scrambleType !== 'wca';
  try {
    alg = typeof given === 'string' ? given : easy ? await easyScramble(settings.scrambleType) : await randomScramble();
  } catch (err) {
    console.error(err);
    alg = await randomScramble();
  }
  if (app.phase !== 'scrambling') return; // inzwischen abgebrochen
  app.scrambleType = easy ? settings.scrambleType : 'wca';
  $('scramble-label').textContent = opts.ghost ? 'Scramble · gegen den Geist' : easy ? (settings.scrambleType === 'xcross' ? 'Scramble · X-Cross üben' : 'Scramble · leicht') : 'Scramble';
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
  app.liveStage = 0;
  renderLiveBar();
  if (app.ghost) startGhostRun();
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
    scramble: app.ghost ? (app.ghost.scramble && applyAlg(SOLVED, app.ghost.scramble) === r.start ? app.ghost.scramble : '') : app.scramble,
    device: app.conn?.name || '',
    ...(app.scrambleType && app.scrambleType !== 'wca' && app.scramble ? { scrambleType: app.scrambleType } : {}),
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
  renderSolveMetrics($('solve-metrics'), solve);
  renderArchiveBtn();
  renderSolves();
  const pb = best(solves) === effectiveTime(solve) && solves.length > 1;
  const prev = solves.slice(0, -1);
  const newAo = [12, 5].find((n) => {
    const now5 = averageOf(solves, n);
    const before = bestAverage(prev, n);
    return now5 !== null && Number.isFinite(now5) && (before === null || now5 < before) && solves.length > n;
  });
  $('live-bar').hidden = true;
  if (pb || newAo) celebrate(solve, pb ? 'Neue Bestzeit!' : `Neuer bester Ø${newAo}!`);
  const ghostDone = app.ghost ? finishGhostRun(solve) : false;
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
  } else if (settings.autoScramble && !ghostDone) newScramble().then(() => setStatus('Letzter Solve: ' + summary()));
  renderCoachTip();
}

// ---------------- Live-Phasen ----------------

const STAGES = ['Kreuz', 'Paar 1', 'Paar 2', 'Paar 3', 'Paar 4', 'OLL', 'PLL'];
const STAGE_CLASS = ['ph-cross', 'ph-pair', 'ph-pair', 'ph-pair', 'ph-pair', 'ph-oll', 'ph-pll'];
const bits = (m) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);

/** Wie weit ist der Solve? 0 = nichts, 1 = Kreuz, 2–5 = Paare, 6 = OLL, 7 = gelöst */
function liveStage(state) {
  if (isSolved(state)) return 7;
  const st = phaseStatus(state);
  let best = 0;
  for (const f of FACES) {
    if (!st[f].cross) continue;
    best = Math.max(best, st[f].oll ? 6 : 1 + bits(solvedSlots(state, f)));
  }
  return best;
}

function barHtml(stage) {
  return `<div class="lb-segs">${STAGES.map((n, i) => `<span class="lb-seg ${STAGE_CLASS[i]}${i < stage ? ' done' : i === stage ? ' cur' : ''}" title="${n}"></span>`).join('')}</div>
    <div class="lb-label">${stage >= 7 ? 'Gelöst' : STAGES[stage]}</div>`;
}
function renderLiveBar() {
  const el = $('live-bar');
  el.hidden = app.phase !== 'running';
  if (!el.hidden) el.innerHTML = barHtml(app.liveStage || 0);
}

// ---------------- Rekord-Feier ----------------

function celebrate(solve, badge) {
  confetti();
  chime();
  const t = $('timer');
  t.classList.remove('pop');
  void t.offsetWidth;
  t.classList.add('pop');
  toast(`🎉 ${badge}`, { action: 'Als Bild teilen', onAction: () => shareSolveImage(solve, profile, badge), duration: 9000 });
}

// ---------------- Geister-Rennen ----------------

let ghostView = null;

/** Gegen einen gespeicherten oder geteilten Solve antreten: gleicher Startzustand, Geist löst live mit */
async function raceAgainst(g, label) {
  if (app.room) return toast('Im Raum geht das Geister-Rennen nicht.');
  if (!g?.start || !g.moves?.length || !g.times?.length) return toast('Für diesen Solve fehlen die Zugzeiten.');
  if (!app.conn) return toast('Verbinde zuerst deinen Würfel.');
  showTab('timer');
  const a = analyzeSolve(g.start, g.moves, g.times);
  // Zeitpunkte, zu denen der Geist jede Stufe erreicht
  let acc = 0;
  const stageTimes = a.phases.map((p) => (acc = p.end >= 0 ? g.times[p.end] : acc));
  app.ghost = { ...g, label, stageTimes, total: a.time };
  $('ghost-card').hidden = false;
  $('ghost-name').textContent = label;
  $('ghost-time').textContent = formatTime(a.time);
  $('ghost-msg').textContent = 'Scramble ausführen – der Geist startet mit deinem ersten Zug.';
  $('ghost-bar').innerHTML = barHtml(0);
  if (!ghostView) ghostView = new CubeView($('ghost-cube'));
  ghostView.setDownFace(a.crossFace);
  ghostView.setState(g.start);
  const setup = await setupAlgFor(relativeState(app.state, g.start));
  newScramble(setup, { ghost: true });
}

function startGhostRun() {
  const g = app.ghost;
  g.k = 0;
  g.running = true;
  ghostView.setState(g.start);
  $('ghost-msg').textContent = '';
}

function ghostTick() {
  const g = app.ghost;
  if (!g?.running) return;
  const t = now() - app.startLocal;
  while (g.k < g.moves.length && g.times[g.k] <= t) ghostView.addMove(g.moves[g.k++]);
  const stage = g.stageTimes.filter((x, i) => i < 7 && x <= t && g.k > 0).length;
  $('ghost-time').textContent = g.k >= g.moves.length ? formatTime(g.total) : formatTime(t);
  $('ghost-bar').innerHTML = barHtml(g.k >= g.moves.length ? 7 : Math.min(stage, 6));
}

/** Ergebnis gegen den Geist; true = Geist bleibt aktiv (kein automatisches neues Scramble) */
function finishGhostRun(solve) {
  const g = app.ghost;
  g.running = false;
  const diff = solve.time - g.total;
  const msg = diff < 0 ? `🏆 Du warst ${formatTime(-diff)} schneller!` : diff > 0 ? `Der Geist war ${formatTime(diff)} schneller.` : 'Exakt gleich schnell!';
  $('ghost-msg').innerHTML = `${msg} <button type="button" class="link-btn" id="ghost-again">Revanche</button>`;
  $('ghost-again').onclick = () => raceAgainst(g, g.label);
  $('ghost-time').textContent = formatTime(g.total);
  $('ghost-bar').innerHTML = barHtml(7);
  if (diff < 0) confetti(1600);
  return true;
}

function endGhost() {
  app.ghost = null;
  $('ghost-card').hidden = true;
}
$('ghost-stop').addEventListener('click', () => {
  endGhost();
  if (app.phase === 'scrambling' || app.phase === 'done') newScramble();
});
$('btn-ghost').addEventListener('click', () => {
  const det = solves.filter((s) => hasDetail(s) && s.penalty !== 'DNF');
  if (!det.length) return toast('Noch keine Bestzeit mit Zugdaten – mach erst ein paar Solves.');
  const pbSolve = det.reduce((a, b) => (effectiveTime(b) < effectiveTime(a) ? b : a));
  raceAgainst({ ...pbSolve, moves: pbSolve.solution.split(' ').filter(Boolean) }, `Deine Bestzeit (${formatSolve(pbSolve)})`);
});

// ---------------- Coach ----------------

function coachHtml(list) {
  return list
    .map((c, i) => `<div class="coach-item"><div class="coach-icon">${c.icon}</div><div><b>${c.title}</b><p>${c.text}</p>
      ${c.action ? `<button type="button" class="ghost small-btn" data-coach="${i}">${c.action.label} →</button>` : ''}</div></div>`)
    .join('');
}
function runCoachAction(a) {
  if (!a) return;
  if (a.kind === 'weak') {
    showTab('algs');
    algsView.trainWeak();
  } else if (a.kind === 'train-set') {
    showTab('algs');
    algsView.set = a.arg;
    algsView.render();
  } else if (a.kind === 'easy-scramble') {
    settings.scrambleType = 'cross2';
    save(SETTINGS_KEY, settings);
    $('opt-scramble-type').value = 'cross2';
    toast('Leichte Scrambles sind an (2 Kreuzkanten gelöst). Umstellen unter Einstellungen → Training.');
    showTab('timer');
    newScramble();
  }
}
function renderCoach() {
  const list = coachInsights(solves).slice(0, 4);
  app.coach = list;
  $('coach').innerHTML = `<h3 class="coach-h">💡 Coach</h3>${coachHtml(list)}`;
}
$('coach').addEventListener('click', (e) => {
  const b = e.target.closest('[data-coach]');
  if (b) runCoachAction(app.coach[Number(b.dataset.coach)]?.action);
});
/** Ein Tipp unter dem Timer (wechselt nach jedem Solve) */
function renderCoachTip() {
  const list = coachInsights(solves).filter((c) => c.action);
  const el = $('coach-tip');
  if (!list.length || solves.length % 3 !== 0) {
    el.hidden = true;
    return;
  }
  const c = list[0];
  el.hidden = false;
  el.innerHTML = `<span>${c.icon}</span> <b>${c.title}</b> <span class="small">${c.action.label} →</span>`;
  el.onclick = () => runCoachAction(c.action);
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
  $('btn-disconnect-2').hidden = !on;
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
  if (app.ghost?.running) ghostTick();
  // Fokus-Modus: beim Lösen nur Timer (und Würfel) zeigen
  const solving = app.phase === 'running' || app.phase === 'inspecting';
  if (solving !== app.focus) {
    app.focus = solving;
    document.body.classList.toggle('solving', solving);
    if (solving && app.tab !== 'timer') showTab('timer');
  }
  // Im Raum: Statuswechsel an die anderen melden
  if (app.room && app.phase !== app.sentPhase) {
    app.sentPhase = app.phase;
    app.room.live('status', { phase: app.phase, elapsed: app.phase === 'running' ? now() - app.startLocal : 0 });
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

/** Kleiner Ring 0–100 (Flüssigkeit) */
function gauge(v) {
  const r = 15;
  const len = 2 * Math.PI * r;
  const cls = v >= 75 ? 'good' : v >= 50 ? 'mid' : 'low';
  return `<svg class="gauge ${cls}" viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
    <circle cx="20" cy="20" r="${r}" class="g-bg"/><circle cx="20" cy="20" r="${r}" class="g-fg" stroke-dasharray="${((v / 100) * len).toFixed(1)} ${len.toFixed(1)}" transform="rotate(-90 20 20)"/>
    <text x="20" y="24.5" text-anchor="middle">${v}</text></svg>`;
}

/** Bilanz eines Solves: Züge, TPS, Drehtempo, Flüssigkeit, Erkennung, Pausen */
function renderSolveMetrics(el, solve) {
  const m = solve && metricsOf(solve);
  el.hidden = !m;
  if (!m) return;
  const tile = (v, k, title) => `<div class="sm" title="${title}"><b>${v}</b><span>${k}</span></div>`;
  el.innerHTML = `
    <div class="sm sm-fl" title="Anteil der Zeit, in der du ohne Stocken gedreht hast">${m.fluency == null ? '' : gauge(m.fluency)}<span>Flüssigkeit</span></div>
    ${tile(m.htm, 'Züge', `Zugzahl in HTM (Doppelzüge als ein Zug) · ${m.qtm} Vierteldrehungen`)}
    ${tile(m.tps.toFixed(1).replace('.', ','), 'TPS', 'Züge pro Sekunde, gesamt')}
    ${tile(m.etps == null ? '–' : m.etps.toFixed(1).replace('.', ','), 'Drehtempo', 'Züge pro Sekunde ohne Erkennungspausen')}
    ${tile(formatTime(m.recog), 'Erkennung', 'Summe aller Pausen vor den Phasen (F2L-Paare, OLL, PLL)')}
    ${tile(m.pauses, 'Pausen', 'Pausen von mindestens 0,5 s')}`;
}

/** Knopf unter der Zeit: letzten Solve ins Archiv */
function renderArchiveBtn() {
  const b = $('btn-archive');
  const s = app.lastSolve;
  b.hidden = !s || !hasDetail(s) || !solves.includes(s);
  const on = isArchived(s);
  b.textContent = on ? '★ Im Archiv' : '☆ Rekonstruktion archivieren';
  b.classList.toggle('on', on);
}
$('btn-archive').addEventListener('click', () => {
  const s = app.lastSolve;
  if (!s) return;
  if (isArchived(s)) removeFromArchive(s.id);
  else addToArchive(s);
  renderArchiveBtn();
  if (!$('archive-view').hidden) archiveView.render();
});

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
  if (!$('stats')) return;
  $('stats').innerHTML = items.map(([k, v]) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('');
}

/** Kurzstatistik unter dem Timer */
function renderQuick() {
  const items = [
    ['Ø 5', formatTime(averageOf(solves, 5))],
    ['Ø 12', formatTime(averageOf(solves, 12))],
    ['Bestzeit', formatTime(best(solves))],
    ['Solves', String(solves.length)],
  ];
  $('stats-quick').innerHTML = items.map(([k, v]) => `<div><span class="k">${k}</span><b>${v}</b></div>`).join('');
}

/** Kuchendiagramm der Phasen über die letzten 12 Solves mit Detaildaten */
function renderMiniPie(det) {
  const el = $('phase-pie');
  $('phase-pie-card').hidden = !det.length;
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
  renderQuick();
  if (app.tab === 'stats') statsView.open(solves);
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
    s.ll?.oll ? `OLL ${s.ll.oll}` : s.ll?.oll === 0 ? 'OLL-Skip' : '',
    s.ll?.pll ? (s.ll.pll === 'Skip' ? 'PLL-Skip' : `${s.ll.pll}-Perm`) : '',
    s.scrambleType ? (s.scrambleType === 'xcross' ? 'X-Cross-Scramble' : 'leichtes Scramble') : '',
  ].filter(Boolean);
  $('sd-info').innerHTML = extra.map((x) => `<span>${x}</span>`).join('');
  $('sd-scramble').textContent = s.scramble || '(eigenes Scramble)';
  $('sd-solution').textContent = s.solution ? groupMoves(s.solution.split(' ').filter(Boolean)).map((g) => g.text).join(' ') : '–';
  renderSolveMetrics($('sd-metrics'), s);
  $('sd-replay').hidden = !replayData(s);
  $('sd-archive').hidden = !hasDetail(s);
  $('sd-ghost').hidden = !hasDetail(s);
  $('sd-archive').textContent = isArchived(s) ? '★ Im Archiv (entfernen)' : '☆ Im Archiv speichern';
  dlg.showModal();
}

$('sd-image').addEventListener('click', () => {
  const s = solves[Number($('solve-dialog').dataset.index)];
  if (s) shareSolveImage(s, profile, best(solves) === effectiveTime(s) ? 'Bestzeit' : '');
});
$('sd-ghost').addEventListener('click', () => {
  const s = solves[Number($('solve-dialog').dataset.index)];
  if (!s || !hasDetail(s)) return;
  $('solve-dialog').close();
  raceAgainst({ ...s, moves: s.solution.split(' ').filter(Boolean) }, `Solve ${formatSolve(s)}`);
});

$('sd-archive').addEventListener('click', () => {
  const s = solves[Number($('solve-dialog').dataset.index)];
  if (!s) return;
  if (isArchived(s)) removeFromArchive(s.id);
  else addToArchive(s);
  $('sd-archive').textContent = isArchived(s) ? '★ Im Archiv (entfernen)' : '☆ Im Archiv speichern';
  renderArchiveBtn();
  if (!$('archive-view').hidden) archiveView.render();
});

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
    const wasLast = app.lastSolve === s;
    undoable(
      `Solve ${formatSolve(s)} gelöscht`,
      () => {
        solves.splice(i, 1);
        if (wasLast) app.lastSolve = null;
      },
      () => {
        solves.splice(i, 0, s);
        if (wasLast) app.lastSolve = s;
        persistSolves();
        renderSolves();
        renderTimer();
      },
    );
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
$('btn-disconnect-2').addEventListener('click', disconnect);
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
replay.onRace = (sol) => raceAgainst(sol, sol.name ? `${sol.name} (${formatTime(analyzeSolve(sol.start, sol.moves, sol.times).time)})` : 'Geteilter Solve');
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

// ---------------- Solves: Liste oder Archiv ----------------

$('solves-mode').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]');
  if (!b) return;
  const arch = b.dataset.mode === 'archive';
  $('solves-mode').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  $('solves-all').hidden = arch;
  $('archive-view').hidden = !arch;
  document.querySelectorAll('#tab-solves .tab-actions').forEach((x) => (x.hidden = arch));
  if (arch) archiveView.render();
});

// ---------------- Training-Einstellungen ----------------

$('opt-cross').value = settings.crossColor;
$('opt-cross').addEventListener('change', (e) => {
  settings.crossColor = e.target.value;
  save(SETTINGS_KEY, settings);
});
$('opt-scramble-type').value = settings.scrambleType;
$('opt-scramble-type').addEventListener('change', (e) => {
  settings.scrambleType = e.target.value;
  save(SETTINGS_KEY, settings);
  if (!app.room && (app.phase === 'scrambling' || app.phase === 'idle' || app.phase === 'done')) newScramble();
});

// ---------------- Tabs ----------------

const TABS = ['timer', 'stats', 'solves', 'algs', 'room'];
app.tab = 'timer';
function showTab(name) {
  if (!TABS.includes(name)) name = 'timer';
  app.tab = name;
  for (const sec of document.querySelectorAll('main > .tab')) sec.hidden = sec.dataset.tab !== name;
  for (const b of document.querySelectorAll('[role=tab][data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  if (name === 'stats') {
    statsView.open(solves);
    renderCoach();
  }
  if (name === 'algs') {
    const before = solves.filter((x) => x.ll === undefined).length;
    algsView.render();
    // Fälle älterer Solves wurden nachträglich erkannt: einmal speichern
    if (before && solves.filter((x) => x.ll === undefined).length < before) persistSolves();
  }
  if (name === 'solves' && !$('archive-view').hidden) archiveView.render();
  window.scrollTo({ top: 0 });
  try {
    sessionStorage.setItem('smartcube.tab', name);
  } catch {
    /* egal */
  }
}
document.querySelectorAll('[role=tab][data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
try {
  showTab(sessionStorage.getItem('smartcube.tab') || 'timer');
} catch {
  showTab('timer');
}

// ---------------- Einstellungen, Profil, Farbschema ----------------

const settingsDlg = $('settings-dialog');
const openSettings = () => settingsDlg.showModal();
$('btn-settings').addEventListener('click', openSettings);
$('profile-chip').addEventListener('click', () => openProfile());
$('pv-close').addEventListener('click', () => $('profile-dialog').close());
$('pv-edit').addEventListener('click', () => {
  $('profile-dialog').close();
  openSettings();
});

/** Profil: Kennzahlen und Stärkenprofil (letzte 50 Solves, Vergleich mit den 50 davor) */
function openProfile() {
  $('pv-avatar').innerHTML = avatarHtml();
  $('pv-name').textContent = profile.name || 'Dein Profil';
  const det = solves.filter(hasDetail);
  const recent = det.slice(-50);
  const older = det.slice(-100, -50);
  const prof = skillProfile(recent);
  const prevProf = older.length >= 10 ? skillProfile(older) : null;
  $('pv-sub').textContent = `${solves.length} Solves${prof ? ` · Profil aus den letzten ${prof.n}` : ''}`;
  const ms = recent.map(metricsOf).filter(Boolean);
  const avgOf = (f) => (ms.length ? ms.reduce((a, m) => a + (f(m) ?? 0), 0) / ms.length : null);
  const tiles = [
    ['Bestzeit', formatTime(best(solves))],
    ['Ø 12', formatTime(averageOf(solves, 12))],
    ['Ø Flüssigkeit', ms.length ? String(Math.round(avgOf((m) => m.fluency))) : '–'],
    ['Ø Züge', ms.length ? String(Math.round(avgOf((m) => m.htm))) : '–'],
    ['Ø TPS', ms.length ? avgOf((m) => m.tps).toFixed(2).replace('.', ',') : '–'],
    ['Ø Drehtempo', ms.length ? avgOf((m) => m.etps).toFixed(2).replace('.', ',') : '–'],
  ];
  $('pv-tiles').innerHTML = tiles.map(([k, v]) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('');
  if (!prof) {
    $('pv-radar').innerHTML = `<p class="small">Nach 5 Solves mit deinem Smartcube erscheint hier dein Stärkenprofil (noch ${Math.max(0, 5 - det.length)}).</p>`;
    $('pv-skills').innerHTML = '';
  } else {
    const now = SKILLS.map((k) => prof.scores[k.key]);
    const prev = prevProf ? SKILLS.map((k) => prevProf.scores[k.key]) : null;
    $('pv-radar').innerHTML = radarSvg(SKILLS, now, prev) +
      `<div class="legend rd-legend"><span><i class="lg-area now"></i>letzte ${prof.n} Solves</span>${prev ? `<span><i class="lg-area prev"></i>die ${prevProf.n} davor</span>` : ''}</div>`;
    const v = prof.values;
    const detail = {
      cross: `${v.crossMoves.toFixed(1).replace('.', ',')} Züge, ${formatTime(v.crossTime)}`,
      lookahead: v.pairRecog == null ? '–' : `${formatTime(v.pairRecog)} Pause vor jedem Paar`,
      recog: `${formatTime(v.llRecog)} vor OLL und PLL`,
      tps: v.etps == null ? '–' : `${v.etps.toFixed(1).replace('.', ',')} Züge/s beim Drehen`,
      fluency: v.fluency == null ? '–' : `${Math.round(v.fluency)} von 100`,
      efficiency: `${Math.round(v.htm)} Züge (HTM)`,
      consistency: prof.cv == null ? '–' : `±${Math.round(prof.cv * 100)} % Streuung`,
    };
    const ranked = SKILLS.map((k, i) => ({ ...k, v: now[i], d: prev ? now[i] - prev[i] : null })).sort((a, b) => b.v - a.v);
    const row = (k, tag) => `<div class="skill-row"><span class="skill-name">${k.name}</span>
      <span class="skill-bar"><i style="width:${Math.round(k.v)}%"></i></span><b>${Math.round(k.v)}</b>
      ${k.d != null && Math.abs(k.d) >= 3 ? `<span class="skill-d ${k.d > 0 ? 'up' : 'down'}">${k.d > 0 ? '▲' : '▼'} ${Math.abs(Math.round(k.d))}</span>` : '<span class="skill-d"></span>'}
      <span class="small skill-detail">${detail[k.key]}${tag ? ` · ${tag}` : ''}</span></div>`;
    $('pv-skills').innerHTML = `<div class="skill-list">${ranked.map((k, i) => row(k, i < 2 ? 'Stärke' : i >= ranked.length - 2 ? 'ausbaufähig' : '')).join('')}</div>
      <p class="small">Skalen grob von „Einsteiger“ (0) bis „sehr schnell“ (100). ${prev ? '▲▼ = Veränderung gegenüber den Solves davor.' : ''}</p>`;
  }
  $('profile-dialog').showModal();
  persistSolves(); // nachträglich berechnete Kennzahlen sichern
}
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
function toggleAvatarEditor(open) {
  const ed = $('avatar-editor');
  ed.hidden = open === undefined ? !ed.hidden : !open;
  $('avatar-edit').setAttribute('aria-expanded', String(!ed.hidden));
}
$('avatar-edit').addEventListener('click', () => toggleAvatarEditor());
$('avatar-done').addEventListener('click', () => toggleAvatarEditor(false));
$('settings-dialog').addEventListener('close', () => toggleAvatarEditor(false));
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
  document.querySelector('meta[name=theme-color]').content = dark ? '#101318' : '#ffffff';
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
  if (!solves.length) return;
  const backup = solves;
  const last = app.lastSolve;
  undoable(
    `${backup.length} Solves gelöscht`,
    () => {
      solves = [];
      app.lastSolve = null;
    },
    () => {
      solves = backup;
      app.lastSolve = last;
      persistSolves();
      renderSolves();
      renderTimer();
    },
  );
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
  if (e.target.closest('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Escape') return cancelSolve();
  const m = KEYS[e.key.toLowerCase()];
  if (m && app.conn?.kind === 'virtual') {
    e.preventDefault();
    app.conn.turn(m);
  }
});

window.addEventListener('beforeunload', () => app.conn?.disconnect());

// ---------------- Online-Raum ----------------

const roomView = new RoomView($('room-panel'), $('room-strip'), {
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
      showTab('timer');
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
  $('room-intro').querySelectorAll('button').forEach((b) => (b.disabled = true));
  msg.textContent = mode === 'create' ? 'Raum wird erstellt …' : 'Verbinde …';
  try {
    roomView.show(room); // Karten brauchen room.myId – Liste wird nach dem Öffnen gezeichnet
    if (mode === 'create') await room.create();
    else await room.join(code);
    roomView.show(room);
    roomView.renderRoster(room.roster);
    $('room-intro').hidden = true;
    document.querySelectorAll('.tab-dot').forEach((d) => (d.hidden = false));
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
    $('room-intro').querySelectorAll('button').forEach((b) => (b.disabled = false));
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
  $('room-intro').hidden = false;
  $('room-strip').hidden = true;
  document.querySelectorAll('.tab-dot').forEach((d) => (d.hidden = true));
  if (!silent) setStatus('Raum verlassen.');
}

$('room-strip').addEventListener('click', () => showTab('room'));
$('room-create').addEventListener('click', () => enterRoom('create'));
$('room-join').addEventListener('click', () => enterRoom('join', $('room-code').value));
$('room-code').addEventListener('input', (e) => (e.target.value = normalizeCode(e.target.value)));

/** Einladungslink #raum=CODE: Beitreten-Dialog mit Code öffnen */
function openRoomFromHash() {
  const m = /[#&]raum=([A-Za-z0-9]{5})/.exec(location.hash);
  if (!m || app.room) return;
  $('room-code').value = normalizeCode(m[1]);
  $('room-error').textContent = profile.name ? 'Tippe auf „Beitreten“.' : 'Gib dir zuerst in den Einstellungen einen Namen, dann „Beitreten“.';
  showTab('room');
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
