/**
 * Solve-Analyse: Was wäre bei diesem Solve besser gegangen?
 *   Cross   – optimales Kreuz (und X-Cross) für das Scramble, auch mit anderen Farben
 *   F2L     – je Paar: welcher Fall, wie kurz der Datenbank-Algorithmus ist, ob ein anderes Paar leichter war
 *   OLL/PLL – direkter Algorithmus gegen die tatsächlichen Züge (erkennt z. B. 2-Look)
 * Alles wird aus Startzustand und Zügen berechnet, funktioniert also für jeden gespeicherten Solve.
 */
import { FACES, SOLVED, applyMove, applyAnyAlg, translateMoves, mirrorState, mirrorAlg, tokenizeAlg, parseAnyMove, phaseStatus, solvedSlots, F2L_SLOTS, CROSS_DOWN } from './cube/facelets.js';
import { analyzeSolve } from './cube/analysis.js';
import { solveCross, solveXCross } from './cube/cross-solver.js';
import { f2lKey } from './cube/f2l-cases.js';
import { F2L_CASES, dbAlgs } from './cube/alg-db.js';
import { identifyOll, identifyPll, relabelToCenters, recenter, f2lSolved, llOriented } from './cube/ll-cases.js';

const FR = F2L_SLOTS.D.findIndex((s) => [...s.faces].sort().join('') === 'FR');
const FR_BIT = 1 << FR;
const Y = ['', 'y', 'y2', "y'"];
// Lage des Slots aus Sicht der Haltung: d = (Haltung, in der der Slot vorne rechts liegt) − (tatsächliche Haltung)
const POS = ['FR', 'BR', 'BL', 'FL'];
const mod4 = (n) => ((n % 4) + 4) % 4;
/** y-Schritte einer Gyro-Drehung wie "y", "y'", "y2" (x/z zählen hier nicht) */
const ySteps = (name) => tokenizeAlg(name || '').reduce((a, t) => a + (t === 'y' ? 1 : t === "y'" ? -1 : t === 'y2' ? 2 : 0), 0);
const AUF = ['', 'U', 'U2', "U'"];

/** Züge ohne Würfeldrehungen (x, y, z zählen nicht) */
export const moveCount = (alg) => tokenizeAlg(alg).filter((t) => !/^[xyz]/.test(t) && parseAnyMove(t)).length;

/** Der Würfel meldet R2 als „R R“: gleichsinnige Doppelzüge zusammenfassen (Umwege wie „R R'“ bleiben sichtbar) */
export function mergeDoubles(list) {
  const out = [];
  for (const m of list) {
    const last = out.at(-1);
    if (last && last === m && !m.includes('2')) out[out.length - 1] = m[0] + '2';
    else out.push(m);
  }
  return out;
}

/** Zustand mit Kreuzfarbe unten (plus Drehung), Farben auf die Mitten bezogen */
const view = (state, face, extra = '') => relabelToCenters(applyAnyAlg(state, `${CROSS_DOWN[face]} ${extra}`));
/** Original-Farbe vorne/rechts in dieser Haltung */
const holdColors = (state, face, extra = '') => {
  const s = applyAnyAlg(state, `${CROSS_DOWN[face]} ${extra}`);
  return { up: s[4], down: s[31], front: s[22], right: s[13], left: s[40], back: s[49] };
};

/** Bester Datenbank-Algorithmus für den FR-Slot (mit AUF vorab), sonst null */
function bestPair(s, extraAlgs = () => []) {
  if (solvedSlots(s, 'D') & FR_BIT) return null;
  const key = f2lKey(s);
  const c = F2L_CASES.find((x) => x.key === key);
  if (!c) return { stuck: true };
  const keep = solvedSlots(s, 'D');
  let best = null;
  for (const alg of [...dbAlgs(c.id), ...extraAlgs(c.id)]) {
    for (const auf of AUF) {
      const after = recenter(applyAnyAlg(s, `${auf} ${alg}`));
      const mask = solvedSlots(after, 'D');
      if (!phaseStatus(after).D.cross || !(mask & FR_BIT) || (mask & keep) !== keep) continue;
      const len = moveCount(alg) + (auf ? 1 : 0);
      if (!best || len < best.len) best = { id: c.id, alg: `${auf} ${alg}`.trim(), len };
      break;
    }
  }
  return best ?? { id: c.id, stuck: true };
}

/** Bester Algorithmus für OLL/PLL im Zustand s (Kreuz unten); done prüft das Ergebnis */
function bestLl(id, s, done, extraAlgs) {
  let best = null;
  for (const alg of [...dbAlgs(id), ...extraAlgs(id)]) {
    for (const auf of AUF) {
      let after = recenter(applyAnyAlg(s, `${auf} ${alg}`));
      let post = '';
      if (!done(after)) continue;
      // PLL: am Ende noch die letzte Schicht drehen?
      if (id.startsWith('PLL') && after !== SOLVED) post = AUF.find((u) => u && applyAnyAlg(after, u) === SOLVED) || '';
      const len = moveCount(alg) + (auf ? 1 : 0) + (post ? 1 : 0);
      if (!best || len < best.len) best = { id, alg: [auf, alg, post].filter(Boolean).join(' '), len };
      break;
    }
  }
  return best;
}

/**
 * @param solve gespeicherter Solve mit start, solution, times
 * @param opts.extraAlgs(id) eigene Algorithmen des Nutzers zusätzlich prüfen
 */
export function solveInsights(solve, opts = {}) {
  const extraAlgs = opts.extraAlgs || (() => []);
  const moves = solve.solution.split(' ').filter(Boolean);
  // Eigene Züge einer Phase in der Haltung der Analyse (Kreuz unten, ggf. y-Drehung)
  let face0 = null;
  const userAlg = (p, r) => (p.moves ? mergeDoubles(translateMoves(moves.slice(p.start, p.end + 1), `${CROSS_DOWN[face0]} ${r}`.trim())).join(' ') : '');
  const a = analyzeSolve(solve.start, moves, solve.times);
  const face = a.crossFace;
  face0 = face;
  const states = [solve.start];
  for (const m of moves) states.push(applyMove(states[states.length - 1], m));
  const ph = a.phases;
  const out = { crossFace: face, xcross: a.xcross, phases: ph };

  // ---------- Cross ----------
  const start = solve.start;
  const colors = FACES.map((f) => {
    const c = solveCross(view(start, f));
    return { face: f, len: c.length, moves: c.moves.join(' '), hold: holdColors(start, f) };
  });
  // Haltung beim Cross (welche Farbe vorne) – einstellbar wie bei den Paaren
  const ck = opts.fronts?.cross != null ? mod4(opts.fronts.cross) : null;
  let mine = colors.find((c) => c.face === face);
  if (ck != null) {
    const c = solveCross(view(start, face, Y[ck]));
    mine = { ...mine, moves: c.moves.join(' '), len: c.length, hold: holdColors(start, face, Y[ck]) };
  }
  // X-Cross: Paar immer in den Slot hinten links (vorne bleibt frei für die nächsten Paare).
  // Dafür die Haltung (y-Drehung) wählen, in der das günstigste Paar hinten links liegt –
  // oder die eingestellte Haltung nehmen.
  let x = null;
  try {
    for (const r of ck != null ? [Y[ck]] : Y) {
      const cand = solveXCross(view(start, face, r), { slots: ['BL'], maxDepth: x ? x.length - 1 : 11 });
      if (cand && (!x || cand.length < x.length)) x = { ...cand, r, hold: holdColors(start, face, r) };
    }
  } catch {
    x = null;
  }
  out.cross = {
    user: ph[0].moves,
    optimal: mine,
    xcross: x && { len: x.length, moves: x.moves.join(' '), complete: x.complete, hold: x.hold, pair: x.hold.left + x.hold.back, r: x.r },
    userMoves: userAlg(ph[0], ck != null ? Y[ck] : ''),
    frontOptions: Y.map((r) => holdColors(start, face, r).front),
    holdK: ck ?? 0,
    source: ck != null ? 'set' : 'assumed',
    colors,
    bestColor: colors.reduce((p, c) => (c.len < p.len ? c : p)),
  };
  // Bei X-Cross mit X-Cross vergleichen, sonst mit dem Kreuz.
  // Wurden mit dem Kreuz gleich mehrere Paare fertig (XX-Cross …), gibt es keinen fairen Vergleich.
  out.cross.multi = ph[1].moves === 0 && ph[2].moves === 0;
  const crossRef = a.xcross && x ? x.length : mine.len;
  out.cross.saved = out.cross.multi ? 0 : Math.max(0, ph[0].moves - crossRef);

  // ---------- F2L ----------
  // Haltung je Paar (welche Farbe vorne): selbst eingestellt, sonst aus dem Gyroskop (gemessene y-Drehungen),
  // sonst angenommen „Slot vorne rechts“. Daraus: Slot-Lage, Alg ohne Drehung, Bewertung der Rotations.
  const fronts = opts.fronts || {};
  const gyroRots = solve.gyro?.rotations || null;
  const stepsBetween = (t0, t1) => (gyroRots ? gyroRots.filter((r) => r.t > t0 && r.t <= t1).reduce((a, r) => a + ySteps(r.name), 0) : 0);
  /** Vorschlag für das Paar aus Haltung k (Slot liegt dort an POS[d]) */
  const inHold = (before, k, rt) => {
    const pos = POS[mod4(rt - k)];
    let b;
    let rot = '';
    if (pos === 'FR') b = bestPair(view(before, face, Y[k]), extraAlgs);
    else if (pos === 'FL') {
      b = bestPair(mirrorState(view(before, face, Y[k])), extraAlgs);
      if (b && !b.stuck) b = { ...b, alg: mirrorAlg(b.alg), mirrored: true };
    } else {
      // Hinten ohne Drehung: der gegenüberliegende vordere Slot (hinten rechts ↔ vorne links) um y2 übersetzt,
      // z. B. U' R' U' R. Gut ausführbar, solange keine B-Züge entstehen – sonst lieber kurz drehen.
      const opp = view(before, face, Y[mod4(k + 2)]);
      let a = pos === 'BR' ? bestPair(mirrorState(opp), extraAlgs) : bestPair(opp, extraAlgs);
      if (a && !a.stuck && pos === 'BR') a = { ...a, alg: mirrorAlg(a.alg) };
      const toks = a && !a.stuck ? tokenizeAlg(a.alg) : null;
      const plain = toks && toks.every((t) => /^[URFDLB][2']?$/.test(t));
      const noRot = plain ? translateMoves(toks, 'y2') : null;
      if (noRot && !noRot.some((t) => t[0] === 'B')) b = { ...a, alg: noRot.join(' '), back: true };
      else if (pos === 'BR') {
        rot = 'y'; // y bringt den Slot nach vorne rechts
        b = bestPair(view(before, face, Y[mod4(k + 1)]), extraAlgs);
      } else {
        rot = "y'"; // y' bringt den Slot nach vorne links → gespiegelt
        b = bestPair(mirrorState(view(before, face, Y[mod4(k + 3)])), extraAlgs);
        if (b && !b.stuck) b = { ...b, alg: mirrorAlg(b.alg), mirrored: true };
      }
    }
    if (b && !b.stuck && rot) b = { ...b, alg: `${rot} ${b.alg}` };
    return b ? { ...b, pos, rot } : null;
  };
  out.pairs = [];
  out.rotations = { count: 0, unnecessary: 0, known: !!gyroRots };
  let prevK = null;
  let prevT = 0;
  for (let k = 1; k <= 4; k++) {
    const p = ph[k];
    const entry = { k, slot: p.slot, moves: p.moves, time: p.time };
    out.pairs.push(entry);
    if (p.moves === 0) {
      entry.free = true; // im Kreuz (X-Cross) oder zusammen mit einem anderen Paar gelöst
      continue;
    }
    const before = states[p.start];
    const after = states[p.end + 1];
    const options = Y.map((r) => ({ r, s0: view(before, face, r), s1: view(after, face, r), hold: holdColors(before, face, r) }));
    const ti = options.findIndex((o) => !(solvedSlots(o.s0, 'D') & FR_BIT) && solvedSlots(o.s1, 'D') & FR_BIT);
    const rt = ti < 0 ? 0 : ti;
    const tStart = solve.times[p.start] ?? 0;
    // Haltung bestimmen
    let hk;
    let source;
    if (fronts[k] != null) {
      hk = mod4(fronts[k]);
      source = 'set';
    } else if (gyroRots && prevK != null) {
      hk = mod4(prevK + stepsBetween(prevT, tStart));
      source = 'gyro';
    } else {
      hk = rt;
      source = gyroRots ? 'gyro' : 'assumed';
    }
    entry.holdK = hk;
    entry.source = source;
    entry.frontOptions = options.map((o) => o.hold.front);
    entry.front = options[hk].hold.front;
    entry.hold = options[hk].hold;
    const sug = inHold(before, hk, rt);
    entry.best = sug && !sug.stuck ? sug : sug?.stuck ? { stuck: true, id: sug.id } : null;
    entry.pos = POS[mod4(rt - hk)];
    // Bild des Falls aus deiner Haltung: Stand vor dem Paar, das Paar an seiner echten Stelle
    entry.dia = { state: options[hk].s0, pair: entry.pos, hold: options[hk].hold };
    entry.userMoves = userAlg(p, Y[hk]);
    // Drehung vor diesem Paar? (nur bewerten, wenn die Haltungen bekannt sind)
    if (prevK != null && (gyroRots || fronts[k] != null)) {
      const steps = mod4(hk - prevK);
      if (steps) {
        out.rotations.count++;
        const without = inHold(before, prevK, rt);
        entry.rotation = { name: Y[steps], fromFront: options[prevK].hold.front, without: without && !without.stuck ? without : null };
        // Unnötig, wenn der Slot von der alten Haltung aus vorne lag (vorne rechts/links geht ohne Drehung)
        if (without && !without.stuck && !without.rot) {
          entry.rotation.unnecessary = true;
          out.rotations.unnecessary++;
        }
      }
    }
    prevK = hk;
    prevT = solve.times[p.end] ?? tStart;
    // Leichteres Paar zu diesem Zeitpunkt? (Vergleich je Fall von vorne rechts aus)
    const evals = options.map((o) => ({ ...o, best: bestPair(o.s0, extraAlgs) }));
    const mineEval = evals[rt];
    const others = evals.filter((o) => o !== mineEval && o.best && !o.best.stuck);
    const easiest = others.reduce((b, o) => (!b || o.best.len < b.best.len ? o : b), null);
    const myLen = entry.best && !entry.best.stuck ? entry.best.len : Infinity;
    if (easiest && easiest.best.len + 2 <= Math.min(myLen, p.moves)) entry.easier = { ...easiest.best, hold: easiest.hold };
    entry.saved = entry.best && !entry.best.stuck ? Math.max(0, p.moves - entry.best.len) : 0;
  }

  // ---------- OLL / PLL ----------
  const llAt = (i) => view(states[i], face);
  const oll = ph[5];
  const pll = ph[6];
  out.oll = { moves: oll.moves, time: oll.time, recog: oll.recog, skip: oll.skip, userMoves: userAlg(oll, '') };
  out.pll = { moves: pll.moves, time: pll.time, recog: pll.recog, skip: pll.skip, userMoves: userAlg(pll, '') };
  if (!oll.skip) {
    const s = llAt(oll.start);
    const n = f2lSolved(s) ? identifyOll(s) : null;
    if (n) out.oll.best = bestLl(`OLL ${n}`, s, (t) => f2lSolved(t) && llOriented(t), extraAlgs);
  }
  if (!pll.skip) {
    const s = llAt(pll.start);
    const n = f2lSolved(s) && llOriented(s) ? identifyPll(s) : null;
    if (n && n !== 'Skip') out.pll.best = bestLl(`PLL ${n}`, s, (t) => f2lSolved(t) && llOriented(t) && identifyPll(t) === 'Skip', extraAlgs);
  }
  for (const l of [out.oll, out.pll]) {
    l.saved = l.best ? Math.max(0, l.moves - l.best.len) : 0;
    l.twoLook = !!l.best && l.moves >= l.best.len + 4 && l.moves >= l.best.len * 1.35; // vermutlich 2-Look oder Umweg
  }

  // OLL/PLL sind feste Algorithmen – zählen nicht zur möglichen Ersparnis
  out.saved = out.cross.saved + out.pairs.reduce((s, p) => s + (p.saved || 0), 0);
  // Ganze Lösung je Phase in der Haltung „Kreuz unten“
  out.scramble = solve.scramble || '';
  // Für „Üben ab hier“: Zustand zu Beginn jeder Phase (im System des Würfels)
  out.phaseStates = ph.map((p) => states[p.start]);
  out.solution = ph.map((p) => ({ key: p.key, moves: userAlg(p, '') })).filter((p) => p.moves);
  return out;
}
