import './styles.css';
import { pairIcon } from './ui/pair-icon.js';
import { now } from 'gan-web-bluetooth';
import { SOLVED, applyMove, applyAlg, isSolved, COLOR_NAMES, groupMoves, CROSS_DOWN, relativeState } from './cube/facelets.js';
import { analyzeSolve } from './cube/analysis.js';
import { analyzeGyro, fromGan } from './cube/gyro.js';
import { ScrambleTracker } from './cube/scramble-tracker.js';
import { SolveRecorder } from './cube/solve-recorder.js';
import { bluetoothAvailable, connectGan, connectOther, connectVirtual } from './cube/connection.js';
import { CubeView } from './ui/cube-view.js';
import { setDefaultSkin, SKIN_PRESETS } from './ui/cube3d.js';
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
import { Lobby } from './lobby.js';
import { RoomView, compareHtml } from './ui/room-view.js';
import { AlgsView } from './ui/algs-view.js';
import { Trainer } from './ui/trainer.js';
import { PLL_ALGS, OLL_ALGS } from './cube/ll-cases.js';
import { ArchiveView } from './ui/archive-view.js';
import { isArchived, addToArchive, removeFromArchive } from './archive.js';
import { easyState } from './cube/easy-scramble.js';
import { setupAlgFor } from './ui/cube-view.js';
import { toast, undoable } from './ui/toast.js';
import { confetti, chime, shareSolveImage } from './ui/celebrate.js';
import { coachInsights } from './coach.js';
import { L, locale, dec, translateStatic, lang } from './i18n.js';
const MV = L('Züge', 'moves');
import { metricsOf, skillProfile, SKILLS } from './metrics.js';
import { modeGroups, findMode } from './modes.js';
import { scopeOf, scopeName, scopeList, filterScope } from './sessions.js';
import { liveStage, barHtml } from './ui/live-bar.js';
import { keepAwake } from './wake.js';
import { InsightsView } from './ui/insights-view.js';
import { algsOf } from './algs.js';
import { radarSvg } from './ui/radar.js';
import { cfopTable, splitTone } from './ui/cfop-table.js';
import { splitBaseline } from './split-compare.js';
import { caseDiagram } from './ui/ll-diagram.js';
import { friends, myFriendCode, formatFriendCode, normalizeFriendCode, startFriends, fetchFriend, removeFriend, isFriend, friendOf } from './friends.js';

const $ = (id) => document.getElementById(id);
translateStatic(); // feste Texte der Seite (bei Englisch)
const SOLVES_KEY = 'smartcube.solves.v1';
const SETTINGS_KEY = 'smartcube.settings.v1';

const settings = { keepAwake: true, inspection: false, autoScramble: true, hideTime: false, gyro: true, viewDown: 'auto', theme: 'auto', replayGyro: true, showResult: true, crossColor: 'auto', scrambleType: 'wca', ...load(SETTINGS_KEY, {}) };
let solves = load(SOLVES_KEY, []);
// Früher zählte TPS jede Vierteldrehung (R2 = 2): einmalig auf HTM umrechnen, passend zur Zugzahl
{
  let fixed = 0;
  for (const s of solves) {
    if (s.htm2 || !s.solution || !s.time) continue;
    const mv = s.solution.split(' ').filter(Boolean);
    let n = 0;
    for (let i = 0; i < mv.length; i++) {
      n++;
      if (i + 1 < mv.length && mv[i + 1] === mv[i] && !mv[i].endsWith('2')) i++;
    }
    s.tps = Math.round((n / s.time) * 100000) / 100;
    s.moveCount = n;
    // Phasen-Züge ebenfalls in HTM (früher je Vierteldrehung gezählt)
    if (hasDetail(s)) {
      try {
        const a = analyzeSolve(s.start, mv, s.times);
        a.phases.forEach((p, k) => s.phases[k] && (s.phases[k].moves = p.moves));
      } catch {
        /* alter Solve ohne passende Daten */
      }
    }
    s.htm2 = true;
    fixed++;
  }
  if (fixed) save(SOLVES_KEY, solves);
}

// Modus: früher nur „Scramble-Art“ – übernehmen
if (!settings.mode) settings.mode = settings.scrambleType || 'wca';
const scrambleMode = () => (settings.mode === 'cross2' || settings.mode === 'xcross' ? settings.mode : 'wca');

// ---------------- Sessions / Bereiche der Statistik ----------------
settings.sessions ??= [];
if (!settings.session || (settings.session !== 'main' && !settings.sessions.some((x) => x.id === settings.session))) settings.session = 'main';
/** Bereich, in den neue Solves zählen: Leichtes Cross / X-Cross getrennt, sonst die gewählte Session */
const activeScope = () => (scrambleMode() !== 'wca' ? scrambleMode() : settings.session || 'main');
/** Bereich, den Solves- und Statistik-Tab zeigen (Standard: der aktive) */
const viewScope = () => {
  const v = settings.viewScope;
  if (!v || v === 'active') return activeScope();
  if (['main', 'cross2', 'xcross', 'all'].includes(v) || settings.sessions.some((x) => x.id === v)) return v;
  return activeScope();
};
const inScope = (id) => filterScope(solves, id);

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

setDefaultSkin(settings.skin || {});
const view = new CubeView($('cube'));
view.setGyroEnabled(settings.gyro);
const replay = new Replay($('replay-dialog'));
const statsView = new StatsView($('stats-view'), { coach: (el) => renderCoach(el), openBest: () => openBest(viewScope()) });
// Trainer für OLL/PLL/F2L/eigene Algorithmen und „Endlos-PLL“ – ohne Setup-Scramble
const trainer = new Trainer($('trainer-dialog'), {
  now: () => now(),
  crossFace: () => crossFace(),
  connected: () => !!app.conn,
  // Der echte Würfel wurde verdreht: laufendes Scramble passt nicht mehr
  onClose: () => {
    if (!app.room && (app.phase === 'scrambling' || app.phase === 'ready' || app.phase === 'inspecting')) newScramble();
  },
});
const algsView = new AlgsView($('tab-algs'), $('case-dialog'), {
  solves: () => solves,
  crossFace: () => crossFace(),
  connected: () => !!app.conn,
  train: (ids, title) => trainer.start(ids, `Training · ${title}`),
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
      // Abgleich mit dem Würfel. Nach einer Pause (Browser im Hintergrund) kommen
      // nachgeholte Züge oft erst kurz danach: kurz warten, sonst würden sie doppelt gezählt
      clearTimeout(app.syncTimer);
      if (e.facelets === app.state) break;
      app.syncMoves = app.moveCounter;
      app.syncTimer = setTimeout(() => {
        if (e.facelets === app.state || app.moveCounter !== app.syncMoves) return;
        app.state = e.facelets;
        view.setState(app.state);
        if (app.phase === 'running' && isSolved(app.state)) finishSolve();
      }, 800);
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
  setStatus(L('Verbinde …', 'Connecting …'));
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
    if (err?.name === 'NotFoundError' || /cancel/i.test(msg)) setStatus(L('Verbindung abgebrochen.', 'Connection cancelled.'));
    else if (/target BLE services/i.test(msg)) setStatus(L('Dieser Würfel nutzt ein unbekanntes Protokoll – bitte melde das Modell, dann kann es ergänzt werden.', 'This cube uses an unknown protocol – please report the model so it can be added.'));
    else setStatus(L('Verbindung fehlgeschlagen: ', 'Connection failed: ') + msg);
    console.error(err);
    renderDevice();
    return;
  }
  view.resetGyroSeen();
  renderDevice();
  renderHardware();
  if (app.phase === 'idle') setStatus(isSolved(app.state) ? L('Verbunden. Hol dir ein Scramble.', 'Connected. Grab a scramble.') : L('Verbunden.', 'Connected.'));
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
    setStatus(L('Verbindung verloren – Solve abgebrochen.', 'Connection lost – solve cancelled.'));
  } else {
    setStatus(L('Getrennt.', 'Disconnected.'));
  }
  renderDevice();
  renderHardware();
  setBattery(null);
  renderTimer();
}

// ---------------- Züge und Ablauf ----------------

function onMove(e) {
  if (!$('result-overlay').hidden) hideResult();
  const before = app.state;
  app.moveCounter = (app.moveCounter || 0) + 1;
  queueMicrotask(kickTick); // Statuswechsel (z. B. Start) sofort anzeigen
  // Im Raum zugeschaut und selbst gedreht: zurück zum eigenen Würfel
  if (roomView.watch.open) roomView.watch.close();
  app.state = applyMove(app.state, e.move);
  view.addMove(e.move);
  if (app.room) {
    // t = Zeit im Solve (0 = dieser Zug startet ihn) – damit Zuschauer Splits berechnen können
    const t = app.phase === 'running' ? Math.round(now() - app.startLocal) : app.phase === 'ready' || app.phase === 'inspecting' ? 0 : null;
    roomSend('move', { m: e.move, t });
  }
  app.lastMoves.push(e.move);
  if (app.lastMoves.length > 40) app.lastMoves.shift();
  $('last-moves').textContent = app.lastMoves.join(' ');

  // Algorithmus am Würfel aufnehmen oder trainieren: dann kein Solve-Ablauf
  if (algsView.recording && $('case-dialog').open) return void algsView.recordMove(e.move);
  if (trainer.active && trainer.onMove(e)) return;
  if (insights.practicing && insights.onMove(e)) return;

  switch (app.phase) {
    case 'scrambling':
      // Scramble wird noch berechnet: Zug zählt nur für den Zustand (Hinweis erscheint, falls nicht gelöst)
      if (!app.tracker) break;
      app.tracker.push(e.move);
      if (app.tracker.done) enterReady();
      else if (app.tracker.corrections > 0) scheduleRescramble();
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
  const fromMode = typeof given !== 'string' && !app.room;
  if (fromMode && findMode(settings.mode)?.kind === 'ghost') return startModeGhost();
  if (fromMode && settings.mode === 'own') return ownPrompt();
  if (!opts.ghost && app.ghost) endGhost();
  if (app.room && typeof given !== 'string') {
    setStatus(L('Im Raum gibt der Gastgeber die Scrambles vor.', 'In a room the host sets the scrambles.'));
    return;
  }
  app.phase = 'scrambling';
  updateViewOrientation();
  app.tracker = null;
  app.scramble = '';
  $('scramble').innerHTML = `<span class="msg">${L('Scramble wird erzeugt …', 'Generating scramble …')}</span>`;
  renderTimer();
  let alg;
  const easy = typeof given !== 'string' && scrambleMode() !== 'wca';
  try {
    alg = typeof given === 'string' ? given : easy ? await easyScramble(scrambleMode()) : await randomScramble();
  } catch (err) {
    console.error(err);
    alg = await randomScramble();
  }
  if (app.phase !== 'scrambling') return; // inzwischen abgebrochen
  app.scrambleType = easy ? scrambleMode() : 'wca';
  renderModeChip();
  app.scramble = alg;
  app.tracker = new ScrambleTracker(alg);
  app.scrambleTarget = applyAlg(app.state, alg);
  app.scrambleFromSolved = isSolved(app.state);
  renderScramble();
  setStatus(app.conn ? L('Verdrehe den Würfel wie angezeigt.', 'Apply the scramble shown.') : L('Verbinde einen Würfel, damit das Scramble verfolgt wird.', 'Connect a cube so the scramble can be tracked.'));
}

/** Modus „Eigenes Scramble“: frei verdrehen, dann „Fertig“ tippen */
function ownPrompt() {
  if (app.ghost) endGhost();
  app.phase = 'scrambling';
  app.tracker = null;
  app.scramble = '';
  app.scrambleType = 'wca';
  renderModeChip();
  updateViewOrientation();
  $('scramble').innerHTML = `<div class="own-box"><span class="msg">${L('Verdrehe den Würfel nach Belieben.', 'Scramble the cube however you like.')}</span>
    <button type="button" class="primary" id="own-ready">${L('Fertig verdreht', 'Done scrambling')}</button></div>`;
  $('scramble-progress').style.width = '0%';
  $('own-ready').onclick = ownScramble;
  setStatus(app.conn ? L('Danach startet der nächste Zug die Zeit.', 'Then the next move starts the timer.') : L('Verbinde zuerst deinen Würfel.', 'Connect your cube first.'));
  renderTimer();
}

function ownScramble() {
  if (isSolved(app.state) && app.conn) {
    setStatus(L('Der Würfel ist noch gelöst – erst verdrehen, dann „Fertig verdreht“ tippen.', 'The cube is still solved – scramble it first, then tap “Done scrambling”.'));
    return;
  }
  app.scramble = '';
  app.tracker = null;
  $('scramble').innerHTML = `<span class="msg">${L('Eigenes Scramble', 'Own scramble')}</span>`;
  $('scramble-progress').style.width = '100%';
  enterReady();
}

function enterReady() {
  app.inspectionPenalty = 0;
  queueMicrotask(kickTick);
  if (settings.inspection) {
    app.phase = 'inspecting';
    app.inspectionStart = now();
    setStatus(L('Inspektion läuft – der erste Zug startet die Zeit.', 'Inspection running – the first move starts the timer.'));
  } else {
    app.phase = 'ready';
    setStatus(L('Bereit! Der erste Zug startet die Zeit.', 'Ready! The first move starts the timer.'));
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
  setStatus(L('Läuft …', 'Running …'));
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
    ...(settings.session && settings.session !== 'main' ? { session: settings.session } : {}),
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
  // Bestzeit/Durchschnitte nur im eigenen Bereich (Session, Leichtes Cross, X-Cross)
  const scoped = inScope(scopeOf(solve));
  const pb = best(scoped) === effectiveTime(solve) && scoped.length > 1;
  const prev = scoped.slice(0, -1);
  const newAo = [12, 5].find((n) => {
    const now5 = averageOf(scoped, n);
    const before = bestAverage(prev, n);
    return now5 !== null && Number.isFinite(now5) && (before === null || now5 < before) && scoped.length > n;
  });
  $('live-bar').hidden = true;
  if (pb || newAo) celebrate(solve, pb ? L('Neue Bestzeit!', 'New PB!') : L(`Neuer bester Ø${newAo}!`, `New best ao${newAo}!`));
  const ghostDone = app.ghost ? finishGhostRun(solve) : false;
  // Im Raum immer: Ergebnis mit Vergleich zu den anderen
  if (settings.showResult || app.room) showResult(solve, pb ? L('Neue Bestzeit!', 'New PB!') : newAo ? L(`Neuer bester Ø${newAo}!`, `New best ao${newAo}!`) : '');
  const summary = () => `${formatSolve(solve)} · ${metricsOf(solve)?.htm ?? solve.moveCount} ${L('Züge', 'moves')} · ${dec(metricsOf(solve)?.tps ?? solve.tps, 2)} TPS${metricsOf(solve)?.etps ? ` · Exec ${dec(metricsOf(solve).etps, 2)}` : ''}${pb ? ` · ${L('Neue Bestzeit!', 'New PB!')} 🎉` : ''}`;
  setStatus(summary());
  if (app.room) {
    app.room.result(app.roomRound, solve);
    roomView.result({ from: app.room.myId, time: solve.time, penalty: solve.penalty });
    app.lastRoomRound = app.roomRound;
    app.roomRound = null;
    renderResultCompare();
    setStatus(summary() + L(' · warte auf die anderen …', ' · waiting for the others …'));
    roomSend('state', { facelets: app.state });
    if (app.pendingRound) {
      const r = app.pendingRound;
      app.pendingRound = null;
      setTimeout(() => onRoomEvent(r), 1500);
    }
  } else if (settings.autoScramble && !ghostDone) newScramble().then(() => setStatus(L('Letzter Solve: ', 'Last solve: ') + summary()));
  renderCoachTip();
}

// ---------------- Ergebnis nach dem Solve ----------------

/** CFOP-Zeilen eines Solves für die Tabelle */
function solveRows(s) {
  const ph = s.phases;
  const ref = splitBaseline(inScope(scopeOf(s)), s);
  const pairs = ph.slice(1, 5);
  const sum = (k) => pairs.reduce((a, p) => a + (p[k] || 0), 0);
  const llNote = (p, label) => {
    const id = label === 'OLL' ? (s.ll?.oll ? `OLL ${s.ll.oll}` : null) : s.ll?.pll && s.ll.pll !== 'Skip' ? `PLL ${s.ll.pll}` : null;
    const name = label === 'OLL' ? (s.ll?.oll ? `OLL ${s.ll.oll}` : s.ll?.oll === 0 || p.skip ? 'OLL-Skip' : '–') : s.ll?.pll === 'Skip' || p.skip ? 'PLL-Skip' : s.ll?.pll ? `${s.ll.pll}-Perm` : '–';
    return `<div class="ct-case">${id ? caseDiagram(id, 44) : ''}<div><b>${name}</b><div>Recog ${formatTime(p.recog || 0)} · Exec ${formatTime(p.time - (p.recog || 0))}</div></div></div>`;
  };
  return [
    { cls: 'ph-cross', name: 'Cross', extra: ` ${colorChip(s.crossFace)}${s.xcross ? ' <span class="tag">X</span>' : ''}`, time: ph[0].time, moves: ph[0].moves, ref: ref.cross },
    {
      cls: 'ph-pair', name: 'F2L', time: sum('time'), moves: sum('moves'), recog: sum('recog'), ref: ref.f2l, open: false,
      sub: pairs.map((p, i) => ({ name: `${L('Paar', 'Pair')} ${i + 1}`, extra: p.slot ? ` ${pairIcon(p.slot, s.crossFace)}` : '', time: p.time, moves: p.moves, recog: p.recog, ref: ref.pair })),
    },
    { cls: 'ph-oll', name: 'OLL', extra: ph[5].skip ? ' <span class="tag">Skip</span>' : '', time: ph[5].time, moves: ph[5].moves, recog: ph[5].recog, ref: ref.oll, note: llNote(ph[5], 'OLL') },
    { cls: 'ph-pll', name: 'PLL', extra: ph[6].skip ? ' <span class="tag">Skip</span>' : '', time: ph[6].time, moves: ph[6].moves, recog: ph[6].recog, ref: ref.pll, note: llNote(ph[6], 'PLL') },
  ];
}

function showResult(solve, badge) {
  if (!hasDetail(solve)) return;
  $('res-room').hidden = true;
  const m = metricsOf(solve);
  const [c, f, o, p] = phasesOf(solve, { mergeF2l: true });
  $('res-device').textContent = solve.device || '';
  $('res-badge').hidden = !badge;
  $('res-badge').textContent = badge ? `🏆 ${badge}` : '';
  $('res-ring').innerHTML = donut(phaseSegments({ cross: c.time, f2l: f.time, oll: o.time, pll: p.time }), { value: formatTime(solve.time), label: L('gesamt', 'total') }, { size: 170 });
  $('res-time').textContent = formatSolve(solve);
  const tile = (v, k) => `<div><b>${v}</b><span>${k}</span></div>`;
  $('res-metrics').innerHTML = [
    tile(m?.htm ?? solve.moveCount, L('Züge', 'Moves')),
    tile(dec(m?.tps ?? solve.tps), 'TPS'),
    tile(dec(m?.etps), 'Exec TPS'),
    `<div>${m?.fluency == null ? '<b>–</b>' : gauge(m.fluency)}<span>Fluency</span></div>`,
  ].join('');
  $('res-table').innerHTML = cfopTable(solveRows(solve));
  const g = solve.gyro;
  $('res-extra').textContent = [
    g ? `${g.rotations.length} Rotations · ~${g.regrips.length} Regrips` : '',
    m ? `${L('Recog gesamt', 'Total recog')} ${formatTime(m.recog)} · ${m.pauses} ${L('Pausen', 'pauses')}` : '',
  ].filter(Boolean).join(' · ');
  $('res-archive').textContent = isArchived(solve) ? '★' : '☆';
  $('result-overlay').dataset.id = solve.id;
  $('result-overlay').hidden = false;
}
function hideResult() {
  $('result-overlay').hidden = true;
}
const resultSolve = () => solves.find((x) => String(x.id) === $('result-overlay').dataset.id);
$('res-close').addEventListener('click', hideResult);
$('result-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'result-overlay') hideResult();
});
const insights = new InsightsView($('insights-dialog'), {
  // eigene Algorithmen des Nutzers zusätzlich prüfen
  extraAlgs: (id) => (algsOf(id).own ? algsOf(id).algs : []),
  state: () => app.state,
  now: () => now(),
  persist: () => persistSolves(), // eingestellte Haltungen („vorne“) am Solve speichern
  // „Üben ab hier“ hat den Würfel verdreht: laufendes Scramble passt nicht mehr
  onClose: () => {
    if (!app.room && (app.phase === 'scrambling' || app.phase === 'ready' || app.phase === 'inspecting')) newScramble();
  },
});
$('res-insights').addEventListener('click', () => {
  const s = resultSolve();
  if (s && hasDetail(s)) insights.open(s);
});
$('res-replay').addEventListener('click', () => {
  const s = resultSolve();
  const data = s && replayData(s);
  hideResult();
  if (data) replay.open({ ...data, name: profile.name }, { title: `Solve ${solves.indexOf(s) + 1}` });
});
// Solve direkt in der Endansicht löschen (mit Rückgängig)
$('res-delete').addEventListener('click', () => {
  const s = resultSolve();
  const i = solves.indexOf(s);
  if (i < 0) return;
  const wasLast = app.lastSolve === s;
  hideResult();
  undoable(
    L(`Solve ${formatSolve(s)} gelöscht`, `Solve ${formatSolve(s)} deleted`),
    () => {
      solves.splice(i, 1);
      if (wasLast) app.lastSolve = null;
      persistSolves();
      renderSolves();
    },
    () => {
      solves.splice(i, 0, s);
      if (wasLast) app.lastSolve = s;
      persistSolves();
      renderSolves();
    },
  );
});
$('res-archive').addEventListener('click', () => {
  const s = resultSolve();
  if (!s) return;
  if (isArchived(s)) removeFromArchive(s.id);
  else addToArchive(s);
  $('res-archive').textContent = isArchived(s) ? '★' : '☆';
  renderArchiveBtn();
});
$('res-share').addEventListener('click', () => {
  const s = resultSolve();
  if (s) shareSolveImage(s, profile, $('res-badge').hidden ? '' : $('res-badge').textContent.replace('🏆 ', ''));
});

// ---------------- Live-Phasen ----------------

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
  toast(`🎉 ${badge}`, { action: L('Als Bild teilen', 'Share image'), onAction: () => shareSolveImage(solve, profile, badge), duration: 9000 });
}

// ---------------- Geister-Rennen ----------------

let ghostView = null;

/** Gegen einen gespeicherten oder geteilten Solve antreten: gleicher Startzustand, Geist löst live mit */
async function raceAgainst(g, label) {
  if (app.room) return toast(L('Im Raum geht das Geister-Rennen nicht.', 'Ghost races don’t work in a room.'));
  if (!g?.start || !g.moves?.length || !g.times?.length) return toast(L('Für diesen Solve fehlen die Zugzeiten.', 'This solve has no move times.'));
  if (!app.conn) return toast(L('Verbinde zuerst deinen Würfel.', 'Connect your cube first.'));
  showTab('timer');
  const a = analyzeSolve(g.start, g.moves, g.times);
  // Zeitpunkte, zu denen der Geist jede Stufe erreicht
  let acc = 0;
  const stageTimes = a.phases.map((p) => (acc = p.end >= 0 ? g.times[p.end] : acc));
  app.ghost = { ...g, label, stageTimes, total: a.time };
  $('ghost-card').hidden = false;
  $('ghost-name').textContent = label;
  $('ghost-time').textContent = formatTime(a.time);
  $('ghost-msg').textContent = L('Scramble ausführen – der Geist startet mit deinem ersten Zug.', 'Apply the scramble – the ghost starts with your first move.');
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
  const msg = diff < 0 ? L(`🏆 Du warst ${formatTime(-diff)} schneller!`, `🏆 You were ${formatTime(-diff)} faster!`) : diff > 0 ? L(`Der Geist war ${formatTime(diff)} schneller.`, `The ghost was ${formatTime(diff)} faster.`) : L('Exakt gleich schnell!', 'Exactly the same time!');
  $('ghost-msg').innerHTML = `${msg} <button type="button" class="link-btn" id="ghost-again">${L('Revanche', 'Rematch')}</button>`;
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
  if (findMode(settings.mode)?.kind === 'ghost') return setMode(settings.lastScrambleMode || 'wca');
  if (app.phase === 'scrambling' || app.phase === 'done') newScramble();
});
/** Gegner für die Geister-Modi: Bestzeit oder ein typischer Solve aus dem Ø12 */
function ghostOpponent(id) {
  // Geister-Rennen laufen mit normalen Scrambles: Gegner aus der aktuellen Session (nicht Leichtes Cross/X-Cross)
  const det = inScope(settings.session || 'main').filter((s) => hasDetail(s) && s.penalty !== 'DNF');
  if (!det.length) return null;
  if (id === 'ghost-avg') {
    const recent = det.slice(-12);
    const avg = mean(recent.map(effectiveTime));
    const pick = recent.reduce((a, b) => (Math.abs(effectiveTime(b) - avg) < Math.abs(effectiveTime(a) - avg) ? b : a));
    return { solve: pick, label: `${L('Dein Schnitt', 'Your average')} (${formatSolve(pick)})` };
  }
  const pb = det.reduce((a, b) => (effectiveTime(b) < effectiveTime(a) ? b : a));
  return { solve: pb, label: `${L('Deine Bestzeit', 'Your PB')} (${formatSolve(pb)})` };
}
function startModeGhost() {
  const o = ghostOpponent(settings.mode);
  if (!o) {
    toast(L('Noch kein Solve mit Zugdaten – mach erst ein paar Solves.', 'No solve with move data yet – do a few solves first.'));
    return setMode('wca');
  }
  raceAgainst({ ...o.solve, moves: o.solve.solution.split(' ').filter(Boolean) }, o.label);
}

// ---------------- Modi ----------------

function modeHint(m) {
  if (m.kind === 'ghost' && !ghostOpponent(m.id)) return L('Braucht erst Solves mit Zugdaten', 'Needs solves with move data first');
  if (m.kind === 'ghost' && !app.conn) return L('Würfel verbinden', 'Connect your cube');
  return '';
}
function openModes() {
  if (app.phase === 'running') return;
  const current = app.room ? 'room' : settings.mode;
  // Session (eigene Statistik, Scrambles wie Standard)
  const sessions = [{ id: 'main' }, ...settings.sessions];
  const sessionHtml = `<section class="mode-group"><h3>${L('Session – eigene Statistik', 'Session – own stats')}</h3><div class="session-row">${sessions
    .map((x) => `<button type="button" class="session-chip${x.id === settings.session ? ' on' : ''}" data-session="${x.id}">${escapeHtml(scopeName(x.id, settings.sessions))}</button>`)
    .join('')}<button type="button" class="session-chip add" data-session="+">＋ ${L('Neue Session', 'New session')}</button></div>
    <p class="small">${L('Z. B. „OH“ oder „Blind“: Scrambles wie Standard, aber eigene Zeiten, Bestzeiten und Ø. Leichtes Cross und X-Cross zählen automatisch getrennt.', 'E.g. “OH” or “Blind”: scrambles like Standard, but own times, bests and averages. Easy cross and X-cross are counted separately automatically.')}</p></section>`;
  $('mode-list').innerHTML = sessionHtml + modeGroups()
    .map((g) => `<section class="mode-group"><h3>${g.title}</h3><div class="mode-grid">${g.modes
      .map((m) => {
        const hint = modeHint(m);
        return `<button type="button" class="mode-card tone-${m.tone}${m.id === current ? ' on' : ''}" data-mode="${m.id}" ${hint ? 'disabled' : ''}>
          <span class="mode-card-ic">${m.icon}</span>
          <span class="mode-card-tx"><b>${m.title}</b><span>${hint || m.desc}</span></span>
          ${m.id === current ? '<span class="mode-check" aria-label="aktiv">✓</span>' : ''}
        </button>`;
      })
      .join('')}</div></section>`)
    .join('');
  $('mode-dialog').showModal();
}

function setMode(id) {
  const m = findMode(id);
  if (!m) return;
  if (m.kind === 'link') {
    if (id === 'room') showTab('room');
    if (id === 'pll-endless') {
      if (app.phase === 'running') return;
      showTab('timer');
      trainer.start(Object.keys(PLL_ALGS).map((n) => `PLL ${n}`), `∞ ${L('Endlos-PLL', 'Endless PLL')}`);
    }
    if (id === 'oll-endless') {
      if (app.phase === 'running') return;
      showTab('timer');
      trainer.start(Object.keys(OLL_ALGS).map((n) => `OLL ${n}`), `∞ ${L('Endlos-OLL', 'Endless OLL')}`);
    }
    return;
  }
  if (app.room) return toast(L('Im Raum gibt der Gastgeber die Scrambles vor – verlasse zuerst den Raum.', 'In a room the host sets the scrambles – leave the room first.'));
  if (m.kind === 'scramble') settings.lastScrambleMode = id;
  settings.mode = id;
  settings.scrambleType = scrambleMode();
  save(SETTINGS_KEY, settings);
  renderModeChip();
  renderSolves(); // Kurzstatistik zeigt den neuen Bereich (z. B. X-Cross getrennt)
  if (app.phase !== 'running') newScramble();
}

function renderModeChip() {
  const m = findMode(app.room ? 'room' : settings.mode) || findMode('wca');
  $('mode-ic').textContent = m.icon;
  const sess = !app.room && scrambleMode() === 'wca' && settings.session !== 'main' ? ` · ${scopeName(settings.session, settings.sessions)}` : '';
  $('mode-name').textContent = (app.room ? L('Online-Raum', 'Online room') : m.title) + sess;
  $('mode-btn').className = `mode-chip tone-${m.tone}`;
  $('btn-new-scramble').title = m.kind === 'ghost' ? L('Neues Rennen', 'New race') : L('Neues Scramble', 'New scramble');
}
renderModeChip();

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
    showTab('timer');
    setMode('cross2');
    toast(L('Modus „Leichtes Cross“ ist an – umstellen über den Modus-Knopf über dem Scramble.', '“Easy cross” mode is on – switch via the mode button above the scramble.'));
  }
}
function renderCoach(el) {
  const list = coachInsights(inScope(activeScope())).slice(0, 4);
  app.coach = list;
  if (el) el.innerHTML = el.closest('details') ? coachHtml(list) : `<h3 class="coach-h">💡 Coach</h3>${coachHtml(list)}`;
}
$('stats-view').addEventListener('click', (e) => {
  const b = e.target.closest('[data-coach]');
  if (b) runCoachAction(app.coach[Number(b.dataset.coach)]?.action);
});
/** Ein Tipp unter dem Timer (wechselt nach jedem Solve) */
function renderCoachTip() {
  const list = coachInsights(inScope(activeScope())).filter((c) => c.action);
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
  setStatus(L('Abgebrochen.', 'Cancelled.'));
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
  const lv = Math.max(0, Math.min(100, Math.round(level)));
  b.innerHTML = `<i class="batt-ic" style="--lv:${lv}" aria-hidden="true"></i>${lv}%`;
  b.title = L(`Akku ${lv} %`, `Battery ${lv}%`);
  b.classList.toggle('low', lv <= 15);
}

function renderDevice() {
  const on = !!app.conn;
  $('device').classList.toggle('on', on);
  $('device-label').textContent = on ? app.conn.name : L('Nicht verbunden', 'Not connected');
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
    [L('Gerät', 'Device'), c.name],
    [L('Modell', 'Model'), info.hardwareName],
    ['Firmware', info.softwareVersion],
    ['Hardware', info.hardwareVersion],
    ['MAC', c.mac],
    ['Gyro', c.supportsGyro || info.gyroSupported ? L('ja', 'yes') : info.gyroSupported === false ? L('nein', 'no') : '–'],
  ].filter(([, v]) => v);
  hw.innerHTML = rows.map(([k, v]) => `<span>${k}</span><span>${escapeHtml(String(v))}</span>`).join('');
}

/**
 * Nach einem falschen Zug: kürzeste Folge vom aktuellen Zustand zum Scramble-Zustand berechnen.
 * Ist sie kürzer als „Fehler zurückdrehen + Rest“, ersetzt sie die restlichen Züge.
 * Kurz warten, falls noch gedreht wird.
 */
function scheduleRescramble() {
  clearTimeout(app.rescrambleTimer);
  const tracker = app.tracker;
  const mc = app.moveCounter;
  app.rescrambleTimer = setTimeout(async () => {
    const still = () => app.phase === 'scrambling' && app.tracker === tracker && app.moveCounter === mc && !tracker.done;
    if (!still() || !app.scrambleTarget) return;
    try {
      const alg = await setupAlgFor(relativeState(app.state, app.scrambleTarget));
      if (!still()) return;
      const n = alg.split(/\s+/).filter(Boolean).length;
      const before = tracker.remaining.length;
      if (n < before && tracker.replace(alg)) {
        app.scrambleNote = L(`Scramble angepasst – ${before - n} ${before - n === 1 ? 'Zug' : 'Züge'} gespart`, `Scramble adjusted – ${before - n} move${before - n === 1 ? '' : 's'} saved`);
        if (alg === '') enterReady();
        renderScramble();
      }
    } catch (err) {
      console.error(err);
    }
  }, 450);
}

function renderScramble() {
  const el = $('scramble');
  const t = app.tracker;
  if (!t) return;
  if (t.done) {
    el.innerHTML = `<span class="msg">✓ ${L('Scramble fertig', 'Scramble done')}</span>`;
    $('scramble-progress').style.width = '100%';
    return;
  }
  const moves = t.remainingMoves();
  const warn = !app.scrambleFromSolved && app.conn
    ? `<div class="warn">${L('Der Würfel war beim Erzeugen nicht gelöst – erst lösen oder „Als gelöst markieren“, dann neues Scramble.', 'The cube wasn’t solved when the scramble was made – solve it or “Mark as solved”, then get a new scramble.')}</div>`
    : '';
  const note = t.adjusted && app.scrambleNote ? `<div class="scr-note">↺ ${app.scrambleNote}</div>` : '';
  el.innerHTML = moves
    .map((m, i) => `<span class="mv${m.correction ? ' correction' : ''}${i === 0 ? ' next' : ''}">${m.text}</span>`)
    .join('') + note + warn;
  $('scramble-progress').style.width = `${Math.round(t.progress() * 100)}%`;
}

function renderTimer() {
  const el = $('timer');
  el.className = 'timer';
  if (app.phase === 'running') {
    el.textContent = settings.hideTime ? L('Solve …', 'Solving …') : formatTime(now() - app.startLocal);
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

/**
 * Haupt-Schleife. Strom sparen: Nur beim Lösen, bei Inspektion, Geister-Rennen oder im Raum
 * läuft sie mit jedem Bildschirm-Frame, sonst nur 4× pro Sekunde (ein Zug weckt sie sofort).
 */
let tickRaf = null;
let tickTimer = null;
function kickTick() {
  clearTimeout(tickTimer);
  tickTimer = null;
  if (tickRaf == null) tickRaf = requestAnimationFrame(tick);
}
function tick() {
  tickRaf = null;
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
    sendRoomStatus();
  }
  // Lage des Würfels (Gyro bzw. Ansicht) für Zuschauer, höchstens ~12× pro Sekunde
  const nowMs = performance.now();
  if (app.room && nowMs - (app.sentViewAt || 0) > 80) {
    const q = view.target;
    const last = app.sentView;
    if (q && (!last || Math.abs(q.x - last.x) + Math.abs(q.y - last.y) + Math.abs(q.z - last.z) + Math.abs(q.w - last.w) > 0.01)) {
      app.sentView = { ...q };
      app.sentViewAt = nowMs;
      roomSend('view', { q: [q.x, q.y, q.z, q.w].map((v) => Math.round(v * 1000) / 1000) });
    }
  }
  // Flüssig nur, wenn eine Zeit läuft; im Raum reichen ~12 Durchläufe pro Sekunde (Lage senden)
  if (solving || app.ghost?.running) tickRaf = requestAnimationFrame(tick);
  else tickTimer = setTimeout(tick, app.room ? 80 : 250);
}
kickTick();

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
    <div class="sm sm-fl" title="${L('Anteil der Zeit, in der du ohne Stocken gedreht hast', 'Share of time you turned without stalling')}">${m.fluency == null ? '' : gauge(m.fluency)}<span>Fluency</span></div>
    ${tile(m.htm, L('Züge', 'Moves'), L(`Zugzahl in HTM (Doppelzüge als ein Zug) · ${m.qtm} Vierteldrehungen`, `Move count in HTM (double turns count once) · ${m.qtm} quarter turns`))}
    ${tile(dec(m.tps), 'TPS', L('Züge pro Sekunde, gesamt', 'Turns per second, overall'))}
    ${tile(dec(m.etps), 'Exec TPS', L('Züge pro Sekunde ohne Recog-Pausen', 'Turns per second without recognition pauses'))}
    ${tile(formatTime(m.recog), 'Recog', L('Summe aller Pausen vor den Phasen (F2L-Paare, OLL, PLL)', 'Sum of all pauses before phases (F2L pairs, OLL, PLL)'))}
    ${tile(m.pauses, L('Pausen', 'Pauses'), L('Pausen von mindestens 0,5 s', 'Pauses of at least 0.5 s'))}`;
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
      .map((p) => `<div class="sp">${phaseName(p)}<b>${formatTime(p.time)}</b>${p.moves} ${MV}</div>`)
      .join('');
    return;
  }
  const [cross, f2l, oll, pll] = phasesOf(solve, { mergeF2l: true });
  const pairs = solve.phases.slice(1, 5);
  const ref = splitBaseline(inScope(scopeOf(solve)), solve);
  const b = (t, r) => `<b><span class="ct-tv"${splitTone(t, r)}>${formatTime(t)}</span></b>`;
  const recog = (p) => (p.recog > 0 ? `<small>Recog ${formatTime(p.recog)}</small>` : '');
  const skip = (p) => (p.skip ? '<small class="tag">Skip</small>' : '');
  el.innerHTML = `
    <div class="sp ph-cross">Cross ${colorChip(solve.crossFace)}${b(cross.time, ref.cross)}${cross.moves} ${MV}${solve.xcross ? '<small class="tag">X-Cross</small>' : ''}</div>
    <div class="sp ph-pair">F2L${b(f2l.time, ref.f2l)}${f2l.moves} ${MV}
      <small class="pairs">${pairs.map((p) => formatTime(p.time)).join(' · ')}</small></div>
    <div class="sp ph-oll">OLL${b(oll.time, ref.oll)}${oll.moves} ${MV}${recog(oll)}${skip(oll)}</div>
    <div class="sp ph-pll">PLL${b(pll.time, ref.pll)}${pll.moves} ${MV}${recog(pll)}${skip(pll)}</div>`;
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
  const solves = inScope(viewScope());
  const cur = (n) => formatTime(averageOf(solves, n));
  const items = [
    [L('Bestzeit', 'Best'), formatTime(best(solves))],
    ['Ø 5', cur(5)],
    ['Ø 12', cur(12)],
    [L('Mittel', 'Mean'), formatTime(mean(solves))],
    [L('Beste Ø 5', 'Best ao5'), formatTime(bestAverage(solves, 5))],
    [L('Beste Ø 12', 'Best ao12'), formatTime(bestAverage(solves, 12))],
    ['Ø 100', cur(100)],
    ['Solves', String(solves.length)],
    ['Ø TPS', solves.length ? (solves.reduce((a, s) => a + (s.tps || 0), 0) / solves.length).toFixed(2) : '–'],
  ];
  // Ø Erkennung OLL/PLL über die letzten 12 Solves mit Detaildaten
  const det = solves.filter(hasDetail).slice(-12);
  if (det.length) {
    const avgOf = (i) => det.reduce((a, s) => a + s.phases[i].recog, 0) / det.length;
    items.push(['Ø OLL Recog', formatTime(avgOf(5))], ['Ø PLL Recog', formatTime(avgOf(6))], ['Ø F2L', formatTime(det.reduce((a, s) => a + s.phases.slice(1, 5).reduce((b, p) => b + p.time, 0), 0) / det.length)]);
  }
  renderMiniPie(det);
  if (!$('stats')) return;
  $('stats').innerHTML = items.map(([k, v]) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('');
}

/** Kurzstatistik unter dem Timer */
function renderQuick() {
  const solves = inScope(activeScope());
  const items = [
    ['Ø 5', formatTime(averageOf(solves, 5))],
    ['Ø 12', formatTime(averageOf(solves, 12))],
    [L('Bestzeit', 'Best'), formatTime(best(solves)), 'best'],
    ['Solves', String(solves.length)],
  ];
  $('stats-quick').innerHTML = items
    .map(([k, v, act]) => (act && pbIndex(activeScope()) >= 0 ? `<button type="button" class="q-link" data-act="${act}" title="${L('Details der Bestzeit', 'Details of your best')}"><span class="k">${k} ›</span><b>${v}</b></button>` : `<div><span class="k">${k}</span><b>${v}</b></div>`))
    .join('');
}

/** Index (in allen Solves) des schnellsten gültigen Solves eines Bereichs (−1 ohne) */
function pbIndex(scope = activeScope()) {
  let bi = -1;
  solves.forEach((s, i) => {
    if (scope !== 'all' && scopeOf(s) !== scope) return;
    const t = effectiveTime(s);
    if (Number.isFinite(t) && (bi < 0 || t < effectiveTime(solves[bi]))) bi = i;
  });
  return bi;
}
/** Bestzeit antippen → Solve-Details öffnen (statt in allen Solves zu suchen) */
function openBest(scope = activeScope()) {
  const i = pbIndex(scope);
  if (i >= 0) openSolve(i);
}
// Nach dem Solve: Zeit oder Phasen antippen → Übersicht (Ergebnis-Fenster) wieder öffnen
for (const id of ['timer', 'splits', 'live-bar']) {
  $(id).addEventListener('click', () => {
    if (app.phase === 'running' || app.phase === 'inspecting' || !app.lastSolve || !$('result-overlay').hidden) return;
    showResult(app.lastSolve, '');
    if (app.room) renderResultCompare();
  });
}
$('stats-quick').addEventListener('click', (e) => {
  if (e.target.closest('[data-act=best]')) openBest();
});

/** Kuchendiagramm der Phasen über die letzten 12 Solves mit Detaildaten */
function renderMiniPie(det) {
  const el = $('phase-pie');
  if (!el) return; // Zeitverteilung steht jetzt unter Statistik → Phasen
  if (!det.length) {
    el.innerHTML = '';
    return;
  }
  const m = (pick) => det.reduce((a, s) => a + pick(s), 0) / det.length;
  const f2l = m((s) => s.phases.slice(1, 5).reduce((a, p) => a + p.time, 0));
  const vals = { cross: m((s) => s.phases[0].time), f2l, oll: m((s) => s.phases[5].time), pll: m((s) => s.phases[6].time) };
  el.innerHTML = `<div class="label">${L('Zeitverteilung', 'Time split')} · Ø ${L('letzte', 'last')} ${det.length}</div>` +
    donut(phaseSegments(vals), { value: formatTime(vals.cross + vals.f2l + vals.oll + vals.pll), label: 'Ø' }, { size: 132 });
}

function renderSolves() {
  renderStats();
  renderQuick();
  if (app.tab === 'stats') statsView.open(inScope(viewScope()));
  const list = $('solves');
  const scope = viewScope();
  renderScopeButtons();
  if (!inScope(scope).length) {
    list.innerHTML = `<li class="empty">${L('Noch keine Solves', 'No solves yet')}</li>`;
    return;
  }
  // Reihenfolge: neueste/älteste zuerst oder nach Zeit (DNF ans Ende)
  const sort = settings.solvesSort || 'new';
  let order = solves.map((_, i) => i).filter((i) => scope === 'all' || scopeOf(solves[i]) === scope).reverse();
  if (sort === 'old') order.reverse();
  else if (sort === 'fast' || sort === 'slow') {
    const t = (i) => effectiveTime(solves[i]);
    order.sort((a, b) => {
      const ta = t(a);
      const tb = t(b);
      if (!Number.isFinite(ta) || !Number.isFinite(tb)) return Number.isFinite(ta) ? -1 : Number.isFinite(tb) ? 1 : b - a;
      return sort === 'fast' ? ta - tb : tb - ta;
    });
  }
  const pb = pbIndex(scope);
  const scopedAll = inScope(scope);
  const rows = [];
  for (const i of order.slice(0, 300)) {
    const s = solves[i];
    const ao5 = averageOf(scopedAll.slice(0, scopedAll.indexOf(s) + 1), 5);
    rows.push(
      `<li data-i="${i}"${i === pb ? ' class="pb"' : ''}><span class="n">${i + 1}.</span><span class="t">${formatSolve(s)}</span>` +
        `<span class="meta">${s.metrics?.htm ?? s.moveCount ?? '–'} ${MV}</span><span class="ao">${ao5 === null ? '' : 'Ø5 ' + formatTime(ao5)}</span></li>`,
    );
  }
  list.innerHTML = rows.join('');
}

function persistSolves() {
  if (!save(SOLVES_KEY, solves)) setStatus(L('Hinweis: Solves konnten im Browser nicht gespeichert werden.', 'Note: solves could not be saved in the browser.'));
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
  $('sd-date').textContent = `${new Date(s.date).toLocaleString(locale)}${s.device ? ' · ' + s.device : ''}`;
  const detail = hasDetail(s);
  const rows = (s.phases || []).map((p) => {
    const name = phaseName(p) + (p.slot ? ' ' + pairIcon(p.slot, s.crossFace) : '');
    const exec = p.time - (p.recog || 0);
    const tps = exec > 0 && p.moves ? ((p.moves / exec) * 1000).toFixed(2) : '–';
    const tag = p.skip ? ' <span class="tag">Skip</span>' : '';
    return `<tr class="${/^p\d$/.test(p.key ?? '') ? 'sub' : ''}"><td>${name}${tag}</td><td>${formatTime(p.time)}</td>${detail ? `<td>${p.key === 'cross' ? '–' : formatTime(p.recog)}</td>` : ''}<td>${p.moves}</td><td>${tps}</td></tr>`;
  });
  if (detail) {
    const [c, f, o, pl] = phasesOf(s, { mergeF2l: true });
    $('sd-pie').innerHTML = donut(phaseSegments({ cross: c.time, f2l: f.time, oll: o.time, pll: pl.time }), { value: formatTime(s.time), label: 'gesamt' }, { size: 140 });
  } else $('sd-pie').innerHTML = '';
  $('sd-cfop').innerHTML = detail && s.phases?.length >= 7 ? cfopTable(solveRows(s)) : '';
  $('sd-phases').innerHTML = rows.length && !(detail && s.phases?.length >= 7)
    ? `<tr><th>Phase</th><th>${L('Zeit', 'Time')}</th>${detail ? '<th>Recog</th>' : ''}<th>${L('Züge', 'Moves')}</th><th>TPS</th></tr>` + rows.join('')
    : '';
  const extra = [
    `${metricsOf(s)?.htm ?? s.moveCount ?? '–'} ${L('Züge', 'moves')}`,
    `${(s.tps ?? 0).toFixed(2)} TPS`,
    s.crossFace ? `Cross: ${colorChip(s.crossFace)} ${COLOR_NAMES[s.crossFace]}` : '',
    s.xcross ? 'X-Cross' : '',
    s.gyro ? `${s.gyro.rotations.length} Rotations${s.gyro.rotations.length ? ' (' + s.gyro.rotations.map((r) => r.name).join(', ') + ')' : ''}` : '',
    s.gyro ? `~${s.gyro.regrips.length} Regrips` : '',
    s.ll?.oll ? `OLL ${s.ll.oll}` : s.ll?.oll === 0 ? 'OLL-Skip' : '',
    s.ll?.pll ? (s.ll.pll === 'Skip' ? 'PLL-Skip' : `${s.ll.pll}-Perm`) : '',
    s.scrambleType ? (s.scrambleType === 'xcross' ? 'X-Cross-Scramble' : L('leichtes Scramble', 'easy scramble')) : '',
  ].filter(Boolean);
  $('sd-info').innerHTML = extra.map((x) => `<span>${x}</span>`).join('');
  $('sd-scramble').textContent = s.scramble || L('(eigenes Scramble)', '(own scramble)');
  $('sd-solution').textContent = s.solution ? groupMoves(s.solution.split(' ').filter(Boolean)).map((g) => g.text).join(' ') : '–';
  renderSolveMetrics($('sd-metrics'), s);
  $('sd-replay').hidden = !replayData(s);
  $('sd-archive').hidden = !hasDetail(s);
  $('sd-ghost').hidden = !hasDetail(s);
  $('sd-insights').hidden = !hasDetail(s);
  $('sd-archive').textContent = isArchived(s) ? '★ Im Archiv (entfernen)' : '☆ Im Archiv speichern';
  dlg.showModal();
}

$('sd-image').addEventListener('click', () => {
  const s = solves[Number($('solve-dialog').dataset.index)];
  if (s) shareSolveImage(s, profile, best(inScope(scopeOf(s))) === effectiveTime(s) ? 'Bestzeit' : '');
});
$('sd-insights').addEventListener('click', () => {
  const s = solves[Number($('solve-dialog').dataset.index)];
  if (s && hasDetail(s)) insights.open(s);
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
      L(`Solve ${formatSolve(s)} gelöscht`, `Solve ${formatSolve(s)} deleted`),
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

$('solves-sort').value = settings.solvesSort || 'new';
$('solves-sort').addEventListener('change', (e) => {
  settings.solvesSort = e.target.value;
  save(SETTINGS_KEY, settings);
  renderSolves();
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
$('mode-btn').addEventListener('click', openModes);
$('mode-close').addEventListener('click', () => $('mode-dialog').close());
$('mode-dialog').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) return $('mode-dialog').close();
  const sb = e.target.closest('[data-session]');
  if (sb) {
    const id = sb.dataset.session === '+' ? createSession() : sb.dataset.session;
    if (!id) return;
    settings.session = id;
    save(SETTINGS_KEY, settings);
    $('mode-dialog').close();
    // Sessions bauen auf dem Standard-Modus auf
    if (findMode(settings.mode)?.kind !== 'scramble' || scrambleMode() !== 'wca') setMode('wca');
    else {
      renderModeChip();
      renderSolves();
    }
    toast(L(`Session „${scopeName(id, settings.sessions)}“ aktiv`, `Session “${scopeName(id, settings.sessions)}” active`));
    return;
  }
  const b = e.target.closest('[data-mode]');
  if (b && !b.disabled) {
    $('mode-dialog').close();
    setMode(b.dataset.mode);
  }
});
$('btn-reset-gyro').addEventListener('click', () => view.resetGyro());

$('btn-mark-solved').addEventListener('click', async () => {
  if (!app.conn) return;
  if (!confirm(L('Den Würfel jetzt als gelöst markieren? Nur machen, wenn er wirklich gelöst ist.', 'Mark the cube as solved now? Only do this if it really is solved.'))) return;
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
bindToggle('opt-result', 'showResult');
bindToggle('opt-awake', 'keepAwake', (on) => keepAwake(on));
keepAwake(settings.keepAwake);
$('gyro-help').innerHTML = L(
  `<p>Aus spart Akku am <b>Handy</b>: Die App verarbeitet dann keine Lagedaten und zeichnet den Würfel nur bei Zügen neu. Den <b>Würfel-Akku</b> schont das nicht – das Gyroskop im Würfel lässt sich nur mit GANs eigenem, nicht veröffentlichtem Befehl abschalten.</p>
   <p>💡 <b>GAN i4:</b> In Cube Station den Modus <b>Endurance</b> wählen (Gyroskop aus, laut GAN bis ~200 h statt ~30 h Akku). Danach hier ganz normal verbinden – Züge, Zeiten und Analyse funktionieren weiter, nur Rotations/Regrips fehlen. Ob der Würfel den Modus dauerhaft behält, bitte einmal ausprobieren.</p>`,
  `<p>Off saves battery on your <b>phone</b>: the app then ignores orientation data and only redraws the cube on moves. It does not save the <b>cube’s</b> battery – the gyroscope inside the cube can only be turned off with GAN’s own, unpublished command.</p>
   <p>💡 <b>GAN i4:</b> choose <b>Endurance</b> mode in Cube Station (gyroscope off, per GAN up to ~200 h instead of ~30 h). Then connect here as usual – moves, times and analysis keep working, only rotations/regrips are missing. Please check whether the cube keeps the mode permanently.</p>`,
);
bindToggle('opt-gyro', 'gyro', (on) => {
  view.setGyroEnabled(on);
  if (!on) app.lastGyro = null;
});
replay.useGyro = settings.replayGyro;
replay.onRace = (sol) => raceAgainst(sol, sol.name ? `${sol.name} (${formatTime(analyzeSolve(sol.start, sol.moves, sol.times).time)})` : L('Geteilter Solve', 'Shared solve'));
replay.onGyroToggle = (on) => {
  settings.replayGyro = on;
  save(SETTINGS_KEY, settings);
};

$('btn-forget-mac').addEventListener('click', () => {
  forgetMacs();
  setStatus(L('Gespeicherte MAC-Adressen gelöscht.', 'Saved MAC addresses deleted.'));
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
    setStatus(L(`${added.length} Solves importiert.`, `${added.length} solves imported.`));
  } catch {
    setStatus(L('Import fehlgeschlagen: keine gültige Export-Datei.', 'Import failed: not a valid export file.'));
  }
});

// ---------------- Bereich (Session) wählen ----------------

function createSession() {
  const name = (prompt(L('Name der Session (z. B. OH, Blind, Füße):', 'Session name (e.g. OH, blind, feet):')) || '').trim().slice(0, 24);
  if (!name) return null;
  const id = 's' + Date.now().toString(36);
  settings.sessions.push({ id, name });
  save(SETTINGS_KEY, settings);
  return id;
}

/** Beschriftung der Bereichs-Knöpfe im Solves- und Statistik-Tab */
function renderScopeButtons() {
  const name = scopeName(viewScope(), settings.sessions);
  const n = inScope(viewScope()).length;
  $('solves-scope-btn').textContent = `${name} (${n}) ▾`;
  $('stats-scope-btn').textContent = `${name} ▾`;
}

/** Auswahl: welcher Bereich wird angezeigt (Sessions, Leichtes Cross, X-Cross, alle) */
function openScopes() {
  const cur = viewScope();
  const list = scopeList(solves, settings.sessions);
  const row = (x) => `<div class="scope-row${x.id === cur ? ' on' : ''}">
      <button type="button" class="scope-pick" data-scope="${x.id}"><b>${escapeHtml(x.name)}</b><span class="small">${x.n} Solves${x.id === activeScope() ? ` · ${L('aktiv im Timer', 'active in timer')}` : ''}</span></button>
      ${x.own ? `<button type="button" class="ghost small-btn" data-rename="${x.id}" title="${L('Umbenennen', 'Rename')}">✎</button><button type="button" class="ghost small-btn danger" data-del="${x.id}" title="${L('Löschen', 'Delete')}">🗑</button>` : ''}
    </div>`;
  const sec = (title, items) => `<section class="mode-group"><h3>${title}</h3>${items.map(row).join('')}</section>`;
  $('scope-dialog').innerHTML = `<div class="rp-head"><div><h2>${L('Welche Solves?', 'Which solves?')}</h2><div class="small">${L('Statistik und Liste zeigen nur diesen Bereich.', 'Stats and list show only this group.')}</div></div>
      <button class="rp-close" data-act="close" aria-label="${L('Schließen', 'Close')}">✕</button></div>
    ${sec(L('Sessions', 'Sessions'), list.filter((x) => x.kind === 'session'))}
    <button type="button" class="ghost small-btn" data-act="new">＋ ${L('Neue Session', 'New session')}</button>
    ${sec(L('Modi (getrennt gezählt)', 'Modes (counted separately)'), list.filter((x) => x.kind === 'mode'))}
    ${sec(L('Alles', 'Everything'), list.filter((x) => x.kind === 'all'))}`;
  if (!$('scope-dialog').open) $('scope-dialog').showModal();
}
$('scope-dialog').addEventListener('click', (e) => {
  const d = $('scope-dialog');
  if (e.target === d || e.target.closest('[data-act=close]')) return d.close();
  const pick = e.target.closest('[data-scope]');
  if (pick) {
    settings.viewScope = pick.dataset.scope === activeScope() ? 'active' : pick.dataset.scope;
    save(SETTINGS_KEY, settings);
    d.close();
    renderSolves();
    if (app.tab === 'stats') statsView.open(inScope(viewScope()));
    return;
  }
  if (e.target.closest('[data-act=new]')) {
    if (createSession()) openScopes();
    return;
  }
  const rn = e.target.closest('[data-rename]');
  if (rn) {
    const ses = settings.sessions.find((x) => x.id === rn.dataset.rename);
    const name = (prompt(L('Neuer Name:', 'New name:'), ses?.name) || '').trim().slice(0, 24);
    if (ses && name) {
      ses.name = name;
      save(SETTINGS_KEY, settings);
      renderModeChip();
      renderSolves();
      openScopes();
    }
    return;
  }
  const del = e.target.closest('[data-del]');
  if (del) {
    const id = del.dataset.del;
    const n = solves.filter((x) => x.session === id).length;
    if (!confirm(L(`Session löschen? Ihre ${n} Solves wandern zu „Standard“.`, `Delete session? Its ${n} solves move to “Standard”.`))) return;
    for (const x of solves) if (x.session === id) delete x.session;
    settings.sessions = settings.sessions.filter((x) => x.id !== id);
    if (settings.session === id) settings.session = 'main';
    if (settings.viewScope === id) settings.viewScope = 'active';
    save(SETTINGS_KEY, settings);
    persistSolves();
    renderModeChip();
    renderSolves();
    openScopes();
  }
});
$('stats-scope-btn').addEventListener('click', openScopes);

// ---------------- Solves: Liste oder Archiv ----------------

$('solves-mode').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]');
  if (!b) return;
  // „Alle Solves“ (Bereich) nochmal antippen → Auswahl der Session / des Modus
  if (b.dataset.mode === 'all' && b.classList.contains('on')) return openScopes();
  const arch = b.dataset.mode === 'archive';
  $('solves-mode').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  $('solves-all').hidden = arch;
  $('archive-view').hidden = !arch;
  document.querySelectorAll('#tab-solves .tab-actions').forEach((x) => (x.hidden = arch));
  if (arch) archiveView.render();
});

// ---------------- Training-Einstellungen ----------------

// ---------------- Würfel-Aussehen ----------------

const PRESET_NAMES = {
  gan: 'GAN',
  classic: L('Klassisch', 'Classic'),
  tiles: L('Fliesen', 'Tiles'),
  custom: L('Eigene', 'Custom'),
};
// Einstellbar sind nur noch Körper und Oberfläche; Stil und Design kommen aus den Karten, Farben immer Standard
const SKIN_KEYS = ['body', 'finish'];
const PRESET_KEYS = ['style', 'theme'];
let skinPreview = null;
const currentSkin = () => {
  const sk = { ...SKIN_PRESETS.gan, ...(settings.skin || {}) };
  if (sk.theme !== 'custom') sk.theme = 'colors'; // entfernte Designs (Kuh, Neon …)
  sk.scheme = 'standard'; // Farben immer Standard
  return sk;
};
function applySkin(skin) {
  settings.skin = skin;
  if (!save(SETTINGS_KEY, settings)) toast(L('Speicher voll – Bilder bitte kleiner wählen.', 'Storage full – please use smaller images.'));
  setDefaultSkin(skin);
  view.setSkin(skin);
  ghostView?.setSkin(skin);
  skinPreview?.setSkin(skin);
  roomView.setOwnSkin(skin);
  app.room?.setSkin(skin);
  renderSkinUi();
  if ($('settings-dialog').open) renderPresetThumbs();
}
/** 3D-Vorschaubilder der Vorlagen (einmal erzeugt, mit eigenem Logo/eigenen Bildern) */
const presetThumbs = {};
let thumbsKey = '';
let thumbsBusy = false;
async function renderPresetThumbs() {
  if (thumbsBusy) return;
  const sk = currentSkin();
  const key = `${(sk.logo || '').length}|${Object.values(sk.images || {}).map((x) => x.length).join(',')}`;
  if (key === thumbsKey && Object.keys(presetThumbs).length) return;
  thumbsKey = key;
  thumbsBusy = true;
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:-1000px;top:0;width:144px;height:144px;pointer-events:none';
  document.body.append(box);
  const cv = new CubeView(box);
  try {
    cv.setState(applyAlg(SOLVED, "R U R' U'"));
    for (const [k, p] of Object.entries(SKIN_PRESETS)) {
      cv.setSkin(k === 'custom' ? { ...sk, theme: 'custom' } : { ...sk, ...p });
      await cv.cube.skinReady;
      presetThumbs[k] = cv.cube.snapshot();
      const img = document.querySelector(`#skin-presets [data-preset="${k}"] img`);
      if (img) img.src = presetThumbs[k];
    }
  } catch (err) {
    console.warn('Vorschaubilder:', err);
  } finally {
    cv.cube.dispose();
    box.remove();
    thumbsBusy = false;
  }
  renderPresetThumbs(); // falls sich Bilder/Logo inzwischen geändert haben
}

function renderSkinUi() {
  const sk = currentSkin();
  $('skin-presets').innerHTML = Object.entries(SKIN_PRESETS)
    .map(([k, p]) => {
      const on = k === 'custom' ? sk.theme === 'custom' : sk.theme !== 'custom' && PRESET_KEYS.every((f) => p[f] === sk[f]);
      return `<button type="button" data-preset="${k}" class="skin-card${on ? ' on' : ''}" aria-pressed="${on}">
        <img alt="" ${presetThumbs[k] ? `src="${presetThumbs[k]}"` : ''} />${k === 'custom' ? '<i class="skin-badge">📷</i>' : ''}<span>${PRESET_NAMES[k]}</span></button>`;
    })
    .join('');
  for (const f of SKIN_KEYS) $(`skin-${f}`).value = sk[f];
  // Eigene Bilder je Seite
  const box = $('skin-images');
  box.hidden = sk.theme !== 'custom';
  if (!box.hidden) {
    box.innerHTML = ['U', 'F', 'R', 'D', 'B', 'L']
      .map((f) => {
        const img = sk.images?.[f];
        return `<label class="skin-img" title="${COLOR_NAMES[f]}">
          <span class="skin-img-prev" style="${img ? `background-image:url(${img})` : ''}"><i class="chip-color c-${f}"></i></span>
          <span class="small">${COLOR_NAMES[f]}</span>
          <input type="file" accept="image/*" data-face="${f}" hidden /></label>`;
      })
      .join('');
  }
  $('skin-logo-clear').hidden = !sk.logo;
  $('skin-images-clear').hidden = sk.theme !== 'custom' || !Object.keys(sk.images || {}).length;
}
$('skin-images-clear').addEventListener('click', () => {
  const before = currentSkin();
  undoable(
    L('Alle eigenen Bilder entfernt.', 'All custom images removed.'),
    () => {
      const sk = { ...before };
      delete sk.images;
      applySkin(sk);
    },
    () => applySkin(before),
  );
});
$('skin-images').addEventListener('change', async (e) => {
  const f = e.target.dataset.face;
  const file = e.target.files?.[0];
  if (!f || !file) return;
  try {
    const url = await resizeImage(file, 384);
    const sk = currentSkin();
    applySkin({ ...sk, images: { ...(sk.images || {}), [f]: url } });
  } catch (err) {
    toast(String(err.message || err));
  }
});
$('skin-logo').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    applySkin({ ...currentSkin(), logo: await resizeImage(file, 256, 'image/png') });
  } catch (err) {
    toast(String(err.message || err));
  }
});
$('skin-logo-clear').addEventListener('click', () => {
  const sk = { ...currentSkin() };
  delete sk.logo;
  applySkin(sk);
});
$('skin-presets').addEventListener('click', (e) => {
  const b = e.target.closest('[data-preset]');
  // Vorlage übernehmen, eigene Bilder und Logo behalten; „Eigene“ behält Stil und Farben
  if (!b) return;
  const k = b.dataset.preset;
  applySkin(k === 'custom' ? { ...currentSkin(), theme: 'custom' } : { ...currentSkin(), style: SKIN_PRESETS[k].style, theme: SKIN_PRESETS[k].theme });
  if (k === 'custom' && !Object.keys(currentSkin().images || {}).length) toast(L('Tippe unten auf eine Seite, um ein Bild dafür zu wählen.', 'Tap a face below to pick an image for it.'));
});
for (const f of SKIN_KEYS) {
  $(`skin-${f}`).addEventListener('change', (e) => applySkin({ ...currentSkin(), [f]: e.target.value }));
}
$('btn-settings').addEventListener('click', () => {
  // Vorschau erst beim Öffnen erzeugen (sonst Größe 0)
  requestAnimationFrame(() => {
    if (!skinPreview) {
      skinPreview = new CubeView($('skin-preview'));
      skinPreview.setState(applyAlg(SOLVED, "R U R' U'"));
      skinPreview.cube.setSpin(0.5);
      // Mit dem Finger drehen; danach dreht sie sich langsam weiter
      const el = $('skin-preview');
      let last = null;
      el.addEventListener('pointerdown', (e) => {
        last = [e.clientX, e.clientY];
        skinPreview.cube.dragging = true;
        el.setPointerCapture(e.pointerId);
      });
      el.addEventListener('pointermove', (e) => {
        if (!last) return;
        skinPreview.cube.rotateBy((e.clientX - last[0]) * 0.012, (e.clientY - last[1]) * 0.012);
        last = [e.clientX, e.clientY];
      });
      const up = () => {
        last = null;
        skinPreview.cube.dragging = false;
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    }
    renderPresetThumbs();
  });
});
renderSkinUi();

// ---------------- Offline ----------------

/** Service Worker registrieren (nur im fertigen Build) und Status anzeigen */
async function offlineStatus() {
  const el = $('offline-status');
  const set = (cls, html) => {
    el.className = `offline-status ${cls}`;
    el.innerHTML = html;
  };
  if (!('serviceWorker' in navigator) || !window.caches) {
    // z. B. Bluefy: Apple erlaubt in eingebetteten Browsern keine Service Worker
    return set(
      'warn',
      L(
        'ⓘ Dieser Browser (z. B. Bluefy) erlaubt keine Offline-Speicherung – das legt Apple für eingebettete Browser fest, die App kann es nicht umgehen. Zum <b>Öffnen</b> braucht sie deshalb Internet. <b>Danach läuft alles ohne Internet weiter</b> (Scrambles, Analyse, Statistiken), bis du die App schließt – nur Online-Räume brauchen Netz. Deine Solves sind immer auf dem Gerät gespeichert.',
        'ⓘ This browser (e.g. Bluefy) doesn’t allow offline storage – Apple decides this for embedded browsers, the app can’t work around it. So it needs internet to <b>open</b>. <b>After that everything keeps working without internet</b> (scrambles, analysis, stats) until you close the app – only online rooms need a connection. Your solves are always stored on the device.',
      ),
    );
  }
  if (!import.meta.env.PROD) return set('warn', L('Entwicklungsmodus – offline nur im fertigen Build.', 'Dev mode – offline only in the production build.'));
  try {
    const reg = await navigator.serviceWorker.ready;
    const status = await new Promise((resolve) => {
      const t = setTimeout(() => resolve(null), 3000);
      navigator.serviceWorker.addEventListener('message', function on(e) {
        if (e.data?.type !== 'status') return;
        clearTimeout(t);
        navigator.serviceWorker.removeEventListener('message', on);
        resolve(e.data);
      });
      (reg.active || navigator.serviceWorker.controller)?.postMessage('status');
    });
    const est = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
    const mb = est?.usage ? ` · ${dec(est.usage / 1048576)} MB` : '';
    if (status && status.cached >= status.total) set('good', L(`✓ Offline bereit – ${status.cached} Dateien gespeichert${mb}.`, `✓ Ready offline – ${status.cached} files stored${mb}.`));
    else if (status) set('warn', L(`… wird gespeichert (${status.cached}/${status.total})`, `… storing (${status.cached}/${status.total})`));
    else set('warn', L('… wird eingerichtet – gleich noch einmal prüfen.', '… setting up – check again in a moment.'));
  } catch (err) {
    set('bad', L('✗ Offline-Speicherung fehlgeschlagen: ', '✗ Offline storage failed: ') + (err?.message || err));
  }
}
/**
 * Nachladbare Teile (Scramble-Generator, Löser) gleich nach dem Start laden: so funktioniert die App
 * auch ohne Service Worker (Bluefy) weiter, wenn danach das Internet weg ist – und das erste Scramble kommt schneller.
 */
function warmUp() {
  setTimeout(async () => {
    try {
      const { randomScrambleForEvent } = await import('cubing/scramble');
      await randomScrambleForEvent('333');
      await setupAlgFor(applyAlg(SOLVED, "R U R' U'"));
    } catch (err) {
      console.warn('Vorladen:', err);
    }
  }, 2500);
}
warmUp();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker
    .register('./sw.js')
    .then((reg) => {
      // Bluefy lässt die Seite lange offen: beim Zurückkehren nach Updates schauen
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    })
    .catch((err) => console.warn('Service Worker:', err));
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return void (hadController = true); // erste Installation, kein Update
    const offer = () => toast(L('Neue Version verfügbar', 'New version available'), { action: L('Neu laden', 'Reload'), onAction: () => location.reload(), duration: 20000 });
    if (app.phase === 'running') {
      const t = setInterval(() => app.phase !== 'running' && (clearInterval(t), offer()), 2000);
    } else offer();
  });
  navigator.storage?.persist?.().catch(() => {});
}
$('offline-check').addEventListener('click', offlineStatus);
$('btn-settings').addEventListener('click', offlineStatus);

$('opt-lang').value = lang;
$('opt-lang').addEventListener('change', (e) => {
  settings.lang = e.target.value;
  save(SETTINGS_KEY, settings);
  location.reload(); // alle Texte neu aufbauen
});

$('opt-cross').value = settings.crossColor;
$('opt-cross').addEventListener('change', (e) => {
  settings.crossColor = e.target.value;
  save(SETTINGS_KEY, settings);
});

// ---------------- Tabs ----------------

const TABS = ['timer', 'stats', 'solves', 'algs', 'room'];
// Tatsächliche Höhe der unteren Leiste (inkl. Home-Balken) für Abstände im Inhalt
{
  const bar = document.querySelector('.tabbar');
  const setH = () => document.documentElement.style.setProperty('--tabbar-total', `${bar.offsetHeight || 0}px`);
  if (bar && 'ResizeObserver' in window) new ResizeObserver(setH).observe(bar);
}
app.tab = 'timer';
function showTab(name) {
  if (!TABS.includes(name)) name = 'timer';
  app.tab = name;
  for (const sec of document.querySelectorAll('main > .tab')) sec.hidden = sec.dataset.tab !== name;
  // Timer-Tab ist eine feste Ansicht ohne Scrollen (siehe styles.css: body.tab-timer)
  for (const t of TABS) document.body.classList.toggle(`tab-${t}`, t === name);
  for (const b of document.querySelectorAll('[role=tab][data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  if (name === 'stats') statsView.open(inScope(viewScope()));
  // Öffentliche Räume nur suchen, solange der Raum-Tab ohne eigenen Raum offen ist (nach dem Start-Code)
  queueMicrotask(() => lobbyWatch(name === 'room' && !app.room));
  if (name === 'algs') {
    const before = solves.filter((x) => x.ll === undefined).length;
    algsView.render();
    // Fälle älterer Solves wurden nachträglich erkannt: einmal speichern
    if (before && solves.filter((x) => x.ll === undefined).length < before) persistSolves();
  }
  if (name === 'solves' && !$('archive-view').hidden) archiveView.render();
  window.scrollTo({ top: 0 });
  document.querySelector('.app').scrollTop = 0; // am Handy scrollt nur der Inhaltsbereich
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
  $('pv-name').textContent = profile.name || L('Dein Profil', 'Your profile');
  const det = solves.filter(hasDetail);
  const recent = det.slice(-50);
  const older = det.slice(-100, -50);
  const prof = skillProfile(recent);
  const prevProf = older.length >= 10 ? skillProfile(older) : null;
  $('pv-sub').textContent = `${solves.length} Solves${prof ? ` · ${L('Profil aus den letzten', 'profile from last')} ${prof.n}` : ''}`;
  const ms = recent.map(metricsOf).filter(Boolean);
  const avgOf = (f) => (ms.length ? ms.reduce((a, m) => a + (f(m) ?? 0), 0) / ms.length : null);
  const tiles = [
    [L('Bestzeit', 'Best'), formatTime(best(solves))],
    ['Ø 12', formatTime(averageOf(solves, 12))],
    ['Ø Fluency', ms.length ? String(Math.round(avgOf((m) => m.fluency))) : '–'],
    [L('Ø Züge', 'Ø moves'), ms.length ? String(Math.round(avgOf((m) => m.htm))) : '–'],
    ['Ø TPS', ms.length ? dec(avgOf((m) => m.tps), 2) : '–'],
    ['Ø Exec TPS', ms.length ? dec(avgOf((m) => m.etps), 2) : '–'],
  ];
  $('pv-tiles').innerHTML = tiles.map(([k, v]) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('');
  if (!prof) {
    $('pv-radar').innerHTML = `<p class="small">${L(`Nach 5 Solves mit deinem Smartcube erscheint hier dein Stärkenprofil (noch ${Math.max(0, 5 - det.length)}).`, `Your skill profile appears after 5 solves with your smart cube (${Math.max(0, 5 - det.length)} to go).`)}</p>`;
    $('pv-skills').innerHTML = '';
  } else {
    const now = SKILLS.map((k) => prof.scores[k.key]);
    const prev = prevProf ? SKILLS.map((k) => prevProf.scores[k.key]) : null;
    $('pv-radar').innerHTML = radarSvg(SKILLS, now, prev) +
      `<div class="legend rd-legend"><span><i class="lg-area now"></i>${L(`letzte ${prof.n} Solves`, `last ${prof.n} solves`)}</span>${prev ? `<span><i class="lg-area prev"></i>${L(`die ${prevProf.n} davor`, `${prevProf.n} before`)}</span>` : ''}</div>`;
    const v = prof.values;
    const detail = {
      cross: `${dec(v.crossMoves)} ${L('Züge', 'moves')}, ${formatTime(v.crossTime)}`,
      lookahead: v.pairRecog == null ? '–' : L(`${formatTime(v.pairRecog)} Pause vor jedem Paar`, `${formatTime(v.pairRecog)} pause before each pair`),
      recog: L(`${formatTime(v.llRecog)} vor OLL und PLL`, `${formatTime(v.llRecog)} before OLL and PLL`),
      tps: v.etps == null ? '–' : `${dec(v.etps)} TPS ${L('ohne Pausen', 'without pauses')}`,
      fluency: v.fluency == null ? '–' : `${Math.round(v.fluency)} / 100`,
      efficiency: `${Math.round(v.htm)} ${L('Züge', 'moves')} (HTM)`,
      consistency: prof.cv == null ? '–' : `±${Math.round(prof.cv * 100)} % ${L('Streuung', 'spread')}`,
    };
    const ranked = SKILLS.map((k, i) => ({ ...k, v: now[i], d: prev ? now[i] - prev[i] : null })).sort((a, b) => b.v - a.v);
    const row = (k, tag) => `<div class="skill-row"><span class="skill-name">${k.name}</span>
      <span class="skill-bar"><i style="width:${Math.round(k.v)}%"></i></span><b>${Math.round(k.v)}</b>
      ${k.d != null && Math.abs(k.d) >= 3 ? `<span class="skill-d ${k.d > 0 ? 'up' : 'down'}">${k.d > 0 ? '▲' : '▼'} ${Math.abs(Math.round(k.d))}</span>` : '<span class="skill-d"></span>'}
      <span class="small skill-detail">${detail[k.key]}${tag ? ` · ${tag}` : ''}</span></div>`;
    $('pv-skills').innerHTML = `<div class="skill-list">${ranked.map((k, i) => row(k, i < 2 ? L('Stärke', 'strength') : i >= ranked.length - 2 ? L('ausbaufähig', 'to improve') : '')).join('')}</div>
      <p class="small">${L('Skalen grob von „Einsteiger“ (0) bis „sehr schnell“ (100).', 'Scales roughly from “beginner” (0) to “very fast” (100).')} ${prev ? L('▲▼ = Veränderung gegenüber den Solves davor.', '▲▼ = change vs. the solves before.') : ''}</p>`;
  }
  renderFriends();
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
  if (!saveProfile()) setStatus(L('Hinweis: Profil konnte nicht gespeichert werden (Speicher voll?).', 'Note: profile could not be saved (storage full?).'));
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
    L(`${backup.length} Solves gelöscht`, `${backup.length} solves deleted`),
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
  onReplay: (data, title) => replay.open(data, { title }),
  onAddFriend: (fc) => addFriend(fc),
  isFriend: (fc) => isFriend(fc),
});
app.roomAuto = true;

function roomLink(code) {
  return `${location.href.split('#')[0]}#raum=${code}`;
}

async function inviteToRoom() {
  const url = roomLink(app.room.code);
  const text = L(`Komm in meinen Smartcube-Raum: ${app.room.code}`, `Join my Smartcube room: ${app.room.code}`);
  try {
    if (navigator.share) return await navigator.share({ title: 'Smartcube-Raum', text, url });
  } catch (e) {
    if (e?.name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(url);
    roomView.message(L('Einladungslink kopiert.', 'Invite link copied.'));
  } catch {
    prompt('Einladungslink:', url);
  }
}

/** Live-Daten an die anderen schicken und in der eigenen Karte zeigen */
function roomSend(kind, data) {
  if (!app.room) return;
  app.room.live(kind, data);
  roomView.self(kind, data);
}

/** Eigenen Stand an die anderen: Phase, laufende Zeit und Würfelzustand */
function sendRoomStatus() {
  roomSend('status', { phase: app.phase, elapsed: app.phase === 'running' ? now() - app.startLocal : 0, facelets: app.state });
}

function onRoomEvent(ev) {
  const room = app.room;
  if (!room) return;
  switch (ev.type) {
    case 'skin':
      roomView.setSkin(ev.from, ev.skin);
      break;
    case 'roster':
      roomView.renderRoster(ev.roster);
      announceRoom();
      sendRoomStatus(); // Neue im Raum sehen sofort den aktuellen Würfel
      app.sentView = null;
      break;
    case 'board':
      roomView.renderBoard(ev.board);
      announceRoom();
      if (!$('result-overlay').hidden) renderResultCompare();
      if (room.isHost && app.roomAuto && room.roundComplete() && !app.nextRoundTimer) {
        roomView.message(L('Alle fertig – nächste Runde in 5 s …', 'Everyone done – next round in 5 s …'));
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
      if (roomView.watch.open) roomView.watch.close(); // neue Runde: zurück zum eigenen Scramble
      roomView.message(L(`Runde ${ev.n}: Scramble ausführen, der erste Zug danach startet die Zeit.`, `Round ${ev.n}: apply the scramble, the next move starts the timer.`));
      for (const c of roomView.cards.values()) c.el.querySelector('.person-time').textContent = '–';
      if (!isSolved(app.state) && app.conn) setStatus(L('Löse zuerst deinen Würfel (oder „Als gelöst markieren“), dann stimmt das Scramble.', 'Solve your cube first (or “Mark as solved”) so the scramble matches.'));
      newScramble(ev.scramble);
      showTab('timer');
      roomSend('state', { facelets: app.state });
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
      roomView.message(L('Verbindungsproblem: ', 'Connection problem: ') + (ev.error?.message || ev.error));
      break;
  }
}

async function hostNextRound() {
  if (!app.room?.isHost) return;
  clearTimeout(app.nextRoundTimer);
  app.nextRoundTimer = null;
  roomView.message(L('Scramble wird erzeugt …', 'Generating scramble …'));
  app.room.startRound(await randomScramble());
}

async function enterRoom(mode, code) {
  const msg = $('room-error');
  msg.textContent = '';
  if (!profile.name) {
    msg.textContent = L('Gib dir zuerst einen Namen (Einstellungen → Profil), damit die anderen dich erkennen.', 'Set a name first (Settings → Profile) so others recognize you.');
    return;
  }
  const room = new Room({ name: profile.name, avatar: profile.avatar, fc: myFriendCode }, (ev) => onRoomEvent(ev));
  room.setSkin(currentSkin()); // die anderen sehen deinen Würfel so, wie du ihn eingestellt hast
  app.room = room; // schon setzen, damit frühe Ereignisse ankommen
  renderModeChip();
  $('room-intro').querySelectorAll('button').forEach((b) => (b.disabled = true));
  msg.textContent = mode === 'create' ? L('Raum wird erstellt …', 'Creating room …') : L('Verbinde …', 'Connecting …');
  try {
    roomView.show(room); // Karten brauchen room.myId – Liste wird nach dem Öffnen gezeichnet
    if (mode === 'create') await room.create({ maxPlayers: Number($('room-max').value) || 0 });
    else await room.join(code);
    lobbyWatch(false);
    // Öffentlicher Raum: bei allen in der Liste, Beitritt ohne Code
    if (mode === 'create' && $('room-public').checked) {
      app.roomPublic = { code: room.code, name: $('room-name').value.trim(), host: profile.name, avatar: profile.avatar, created: Date.now(), max: room.maxPlayers };
      announceRoom();
    }
    roomView.show(room);
    if (app.roomPublic)
      roomView.message(L('🌍 Öffentlicher Raum – erscheint bei allen unter „Öffentliche Räume“, Beitritt ohne Code. Starte die erste Runde, sobald jemand da ist.', '🌍 Public room – shows up for everyone under “Public rooms”, join without a code. Start the first round once someone is here.') + (room.maxPlayers ? L(` Plätze: ${room.maxPlayers}.`, ` Seats: ${room.maxPlayers}.`) : ''));
    roomView.renderRoster(room.roster);
    $('room-intro').hidden = true;
    document.querySelectorAll('.tab-dot').forEach((d) => (d.hidden = false));
    app.sentPhase = null;
    roomSend('state', { facelets: app.state });
    if (app.phase === 'scrambling' || app.phase === 'done') {
      app.phase = 'idle';
      renderTimer();
    }
    if (!app.roomPublic) lobbyWatch(false);
    setStatus(mode === 'create' ? L(`Raum ${room.code} erstellt.`, `Room ${room.code} created.`) : L(`Raum ${room.code} beigetreten.`, `Joined room ${room.code}.`));
    history.replaceState(null, '', location.pathname + location.search);
  } catch (err) {
    console.error(err);
    app.room = null;
    renderModeChip();
    room.leave();
    roomView.hide();
    msg.textContent = L('Das hat nicht geklappt: ', 'That didn’t work: ') + (err?.message || err);
  } finally {
    $('room-intro').querySelectorAll('button').forEach((b) => (b.disabled = false));
  }
}

// ---------------- Öffentliche Räume ----------------

const lobby = new Lobby();
let stopLobbyWatch = null;
/** Liste öffentlicher Räume beobachten, solange der Raum-Tab ohne Raum offen ist */
function lobbyWatch(on) {
  if (on && !stopLobbyWatch) stopLobbyWatch = lobby.watch(renderRoomList);
  else if (!on && stopLobbyWatch) {
    stopLobbyWatch();
    stopLobbyWatch = null;
  }
}
function renderRoomList(rooms, status) {
  const box = $('room-list');
  if (!rooms.length && status === 'searching') {
    box.innerHTML = `<p class="small">${L('Suche öffentliche Räume …', 'Looking for public rooms …')}</p>`;
    return;
  }
  const others = rooms.filter((r) => r.code !== app.room?.code);
  box.innerHTML = others.length
    ? others
        .map(
          (r) => `<button type="button" class="pub-room${r.max && r.players >= r.max ? ' full' : ''}" data-join="${r.code}" ${r.max && r.players >= r.max ? 'disabled' : ''}>
            <span class="pub-ic">${escapeHtml(r.emoji || '🧊')}</span>
            <span class="pub-tx"><b>${escapeHtml(r.name || L(`Raum von ${r.host}`, `${r.host}’s room`))}</b>
              <span class="small">${escapeHtml(r.host)} · 👥 ${r.players}${r.max ? `/${r.max}` : ''}${r.round ? ` · ${L('Runde', 'Round')} ${r.round}` : ''}</span></span>
            <span class="pub-go">${r.max && r.players >= r.max ? L('voll', 'full') : `${L('Beitreten', 'Join')} ›`}</span></button>`,
        )
        .join('')
    : `<p class="small">${L('Gerade ist kein öffentlicher Raum offen. Erstelle doch selbst einen – er erscheint dann hier bei allen.', 'No public room is open right now. Create one yourself – it then shows up here for everyone.')}</p>`;
}
$('app-version').textContent = `${L('App-Version', 'App version')}: ${typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'} UTC – ${L('auf allen Geräten gleich? Sonst Seite neu laden.', 'same on all devices? Otherwise reload the page.')}`;
$('room-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-join]');
  if (b) enterRoom('join', b.dataset.join);
});
$('room-vis').addEventListener('click', (e) => {
  const b = e.target.closest('[data-vis]');
  if (!b) return;
  $('room-vis').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  $('room-public').checked = b.dataset.vis === 'public';
  $('room-public').dispatchEvent(new Event('change'));
});
$('room-public').addEventListener('change', (e) => {
  $('room-name').hidden = !e.target.checked;
  if (e.target.checked && !$('room-name').value) $('room-name').placeholder = L(`Raum von ${profile.name || '…'}`, `${profile.name || '…'}’s room`);
});
/** Angaben des eigenen öffentlichen Raums an die Lobby (Spielerzahl, Runde) */
function announceRoom() {
  const room = app.room;
  if (!room?.isHost || !app.roomPublic) return;
  lobby.announce({ ...app.roomPublic, players: room.roster.length, round: room.board.at(-1)?.n || 0 });
}

function leaveRoom(silent) {
  if (!app.room) return;
  if (!silent && !confirm(app.room.isHost ? L('Raum schließen? Alle anderen fliegen dann raus.', 'Close the room? Everyone else will be removed.') : L('Raum verlassen?', 'Leave the room?'))) return;
  clearTimeout(app.nextRoundTimer);
  app.nextRoundTimer = null;
  app.room.leave();
  if (app.roomPublic) lobby.withdraw();
  app.roomPublic = null;
  app.room = null;
  app.roomRound = null;
  if (app.tab === 'room') lobbyWatch(true);
  renderModeChip();
  roomView.hide();
  $('room-intro').hidden = false;
  $('room-strip').hidden = true;
  document.querySelectorAll('.tab-dot').forEach((d) => (d.hidden = true));
  if (!silent) setStatus(L('Raum verlassen.', 'Left the room.'));
}

$('room-strip').addEventListener('click', (e) => {
  const who = e.target.closest('[data-watch]');
  if (who) roomView.openWatch(who.dataset.watch); // Mitspieler antippen = zuschauen
  else showTab('room');
});
$('room-create').addEventListener('click', () => enterRoom('create'));
$('room-join').addEventListener('click', () => enterRoom('join', $('room-code').value));
$('room-code').addEventListener('input', (e) => (e.target.value = normalizeCode(e.target.value)));

/** Einladungslink #raum=CODE: Beitreten-Dialog mit Code öffnen */
function openRoomFromHash() {
  const m = /[#&]raum=([A-Za-z0-9]{5})/.exec(location.hash);
  if (!m || app.room) return;
  $('room-code').value = normalizeCode(m[1]);
  $('room-error').textContent = profile.name ? L('Tippe auf „Beitreten“.', 'Tap “Join”.') : L('Gib dir zuerst in den Einstellungen einen Namen, dann „Beitreten“.', 'Set a name in the settings first, then tap “Join”.');
  showTab('room');
}
window.addEventListener('hashchange', openRoomFromHash);
window.addEventListener('beforeunload', () => {
  if (app.roomPublic) lobby.withdraw();
  app.room?.leave();
});

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
    replay.open(shared, { title: shared.name ? L(`Solve von ${shared.name}`, `${shared.name}’s solve`) : L('Geteilter Solve', 'Shared solve') });
  } catch (err) {
    setStatus(L('Der geteilte Link ist ungültig: ', 'The shared link is invalid: ') + (err?.message || err));
  }
}
openSharedFromHash();
openRoomFromHash();

// Testzugang: mit ?debug in der URL lassen sich Würfel-Ereignisse simulieren (z. B. Gyro-Daten)
if (new URLSearchParams(location.search).has('debug')) window.__smartcube = { emit: onCubeEvent, app, settings, trainer, roomView, lobby };
window.addEventListener('hashchange', openSharedFromHash);

// ---------------- Freunde ----------------

const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Eigene Profilkarte für Freunde: Name, Avatar, PB, Ø5/Ø12, letzte 10 Solves (Standard-Bereich) */
function myCard() {
  const main = solves.filter((x) => scopeOf(x) === 'main');
  const valid = main.filter((x) => x.penalty !== 'DNF');
  const pbSolve = valid.reduce((b, x) => (!b || effectiveTime(x) < effectiveTime(b) ? x : b), null);
  return {
    code: myFriendCode,
    name: profile.name || L('Ohne Namen', 'No name'),
    avatar: profile.avatar,
    pb: pbSolve && { time: pbSolve.time, penalty: pbSolve.penalty || 0, date: pbSolve.date },
    ao5: averageOf(main, 5),
    ao12: averageOf(main, 12),
    count: main.length,
    last: main.slice(-10).reverse().map((x) => ({ time: x.time, penalty: x.penalty || 0, date: x.date, moves: x.moveCount ?? null, tps: x.tps ?? null })),
  };
}

const agoText = (t) => {
  if (!t) return '–';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 2) return L('gerade eben', 'just now');
  if (m < 60) return L(`vor ${m} Min.`, `${m} min ago`);
  const h = Math.round(m / 60);
  if (h < 36) return L(`vor ${h} Std.`, `${h} h ago`);
  return L(`vor ${Math.round(h / 24)} Tagen`, `${Math.round(h / 24)} days ago`);
};
const fmtPen = (x) => (x ? formatSolve({ time: x.time, penalty: x.penalty }) : '–');

function friendError(e) {
  const m = e?.message;
  if (m === 'code') return L('Der Freundescode hat 8 Zeichen.', 'The friend code has 8 characters.');
  if (m === 'self') return L('Das ist dein eigener Code 🙂', 'That’s your own code 🙂');
  if (m === 'offline') return L('Nicht erreichbar – die App muss beim Freund gerade offen sein.', 'Not reachable – the app must be open on your friend’s device.');
  return L('Verbindung fehlgeschlagen.', 'Connection failed.');
}

async function addFriend(c) {
  const code = normalizeFriendCode(c);
  try {
    const f = await fetchFriend(code);
    toast(L(`👥 ${f.name} ist jetzt dein Freund`, `👥 ${f.name} is now your friend`));
  } catch (e) {
    toast(friendError(e));
  }
  if ($('profile-dialog').open) renderFriends();
}

function renderFriends() {
  const box = $('pv-friends');
  const list = [...friends].sort((a, b) => (a.card?.pb?.time ?? Infinity) - (b.card?.pb?.time ?? Infinity));
  box.innerHTML = `<h3 class="sub-h">👥 ${L('Freunde', 'Friends')}</h3>
    <div class="fr-code small">${L('Dein Code', 'Your code')}: <b>${formatFriendCode(myFriendCode)}</b>
      <button type="button" class="ghost small-btn" data-fr="share">🔗 ${L('Teilen', 'Share')}</button></div>
    <form class="fr-add"><input type="text" id="fr-input" maxlength="9" placeholder="${L('Code des Freundes', 'Friend’s code')}" autocomplete="off" autocapitalize="characters" />
      <button type="submit">＋ ${L('Hinzufügen', 'Add')}</button></form>
    <div class="fr-list">${list.length
      ? list.map((f) => `<button type="button" class="fr-row" data-friend="${f.code}"><span class="avatar">${avatarHtml(f)}</span>
          <span class="fr-name"><b>${esc(f.name || '?')}</b><span class="small">${f.card?.count ?? 0} Solves · ${agoText(f.at)}</span></span>
          <span class="fr-pb"><span class="small">PB</span> <b>${fmtPen(f.card?.pb)}</b></span></button>`).join('')
      : `<p class="small">${L('Noch keine Freunde. Tausche Codes aus oder tippe im Online-Raum auf eine Person → „Als Freund hinzufügen“. Profile werden direkt zwischen den Geräten geholt, solange die App beim Freund offen ist.', 'No friends yet. Swap codes or tap a person in an online room → “Add as friend”. Profiles are fetched directly between devices while the app is open on your friend’s side.')}</p>`}</div>`;
}

$('pv-friends').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('fr-input').value;
  if (v.trim()) addFriend(v);
});
$('pv-friends').addEventListener('click', async (e) => {
  const row = e.target.closest('[data-friend]');
  if (row) return openFriend(row.dataset.friend);
  if (e.target.closest('[data-fr=share]')) {
    const url = `${location.href.split('#')[0]}#freund=${myFriendCode}`;
    const text = L(`Füg mich in der Smartcube-App als Freund hinzu: ${formatFriendCode(myFriendCode)}`, `Add me as a friend in the Smartcube app: ${formatFriendCode(myFriendCode)}`);
    try {
      if (navigator.share) return await navigator.share({ title: 'Smartcube', text, url });
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast(L('Link kopiert.', 'Link copied.'));
    } catch {
      prompt(L('Dein Freundeslink:', 'Your friend link:'), url);
    }
  }
});

function openFriend(code, status = '') {
  const f = friendOf(code);
  const dlg = $('friend-dialog');
  if (!f) return dlg.close();
  const c = f.card || {};
  const tile = (v, k) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`;
  const rows = (c.last || [])
    .map((x, i) => `<tr><td>${i + 1}</td><td><b>${fmtPen(x)}</b></td><td>${x.moves ?? '–'}</td><td>${x.tps ? dec(x.tps, 2) : '–'}</td><td class="small">${x.date ? new Date(x.date).toLocaleDateString(locale) : '–'}</td></tr>`)
    .join('');
  dlg.innerHTML = `<div class="rp-head"><div class="pv-head"><span class="avatar big">${avatarHtml(f)}</span>
      <div><h2>${esc(f.name || '?')}</h2><div class="small">${formatFriendCode(f.code)} · ${L('Stand', 'Updated')}: ${agoText(f.at)}${status ? ` · ${status}` : ''}</div></div></div>
      <button type="button" class="rp-close" data-fr="close" aria-label="${L('Schließen', 'Close')}">✕</button></div>
    <div class="stats pv-tiles">${tile(fmtPen(c.pb), L('Bestzeit', 'Best'))}${tile(formatTime(c.ao5), 'Ø 5')}${tile(formatTime(c.ao12), 'Ø 12')}</div>
    ${c.pb?.date ? `<p class="small">🏆 PB ${L('vom', 'from')} ${new Date(c.pb.date).toLocaleDateString(locale)} · ${c.count || 0} Solves ${L('gesamt', 'total')}</p>` : ''}
    <h3 class="sub-h">${L('Letzte 10 Solves', 'Last 10 solves')}</h3>
    ${rows ? `<div class="table-wrap"><table class="phase-table"><tr><th>#</th><th>${L('Zeit', 'Time')}</th><th>${L('Züge', 'Moves')}</th><th>TPS</th><th>${L('Datum', 'Date')}</th></tr>${rows}</table></div>` : `<p class="small">${L('Noch keine Solves.', 'No solves yet.')}</p>`}
    <menu><button type="button" class="ghost" data-fr="remove">🗑 ${L('Entfernen', 'Remove')}</button><button type="button" data-fr="refresh">↻ ${L('Aktualisieren', 'Refresh')}</button></menu>`;
  dlg.dataset.code = code;
  if (!dlg.open) dlg.showModal();
}

$('friend-dialog').addEventListener('click', async (e) => {
  const dlg = $('friend-dialog');
  if (e.target === dlg || e.target.closest('[data-fr=close]')) return dlg.close();
  const code = dlg.dataset.code;
  if (e.target.closest('[data-fr=remove]')) {
    const f = friendOf(code);
    if (!confirm(L(`${f?.name || 'Freund'} entfernen?`, `Remove ${f?.name || 'friend'}?`))) return;
    removeFriend(code);
    dlg.close();
    return renderFriends();
  }
  const b = e.target.closest('[data-fr=refresh]');
  if (b) {
    b.disabled = true;
    b.textContent = L('Verbinde …', 'Connecting …');
    let status = '';
    try {
      await fetchFriend(code);
      status = '✓ ' + L('aktuell', 'up to date');
    } catch (err) {
      status = '⚠ ' + friendError(err);
    }
    openFriend(code, status);
    renderFriends();
  }
});

/** Freundeslink #freund=CODE: hinzufügen */
function addFriendFromHash() {
  const m = /[#&]freund=([A-Za-z0-9]{8})/.exec(location.hash);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  setTimeout(() => addFriend(m[1]), 1500);
}
window.addEventListener('hashchange', addFriendFromHash);
addFriendFromHash();

// Erreichbar für Freunde, solange die App offen ist (nach dem Start, damit nichts bremst)
setTimeout(
  () =>
    startFriends(myCard, (kind, f) => {
      if (kind === 'added' && f) toast(L(`👥 ${f.name} hat dich als Freund hinzugefügt`, `👥 ${f.name} added you as a friend`));
      if ($('profile-dialog').open) renderFriends();
    }),
  2500,
);
