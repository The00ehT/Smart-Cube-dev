/**
 * Solve-Analyse: Was wäre bei diesem Solve besser gegangen?
 *   Cross   – optimales Kreuz (und X-Cross) für das Scramble, auch mit anderen Farben
 *   F2L     – je Paar: welcher Fall, wie kurz der Datenbank-Algorithmus ist, ob ein anderes Paar leichter war
 *   OLL/PLL – direkter Algorithmus gegen die tatsächlichen Züge (erkennt z. B. 2-Look)
 * Alles wird aus Startzustand und Zügen berechnet, funktioniert also für jeden gespeicherten Solve.
 */
import { FACES, SOLVED, applyMove, applyAnyAlg, tokenizeAlg, parseAnyMove, phaseStatus, solvedSlots, F2L_SLOTS, CROSS_DOWN } from './cube/facelets.js';
import { analyzeSolve } from './cube/analysis.js';
import { solveCross, solveXCross } from './cube/cross-solver.js';
import { f2lKey } from './cube/f2l-cases.js';
import { F2L_CASES, dbAlgs } from './cube/alg-db.js';
import { identifyOll, identifyPll, relabelToCenters, recenter, f2lSolved, llOriented } from './cube/ll-cases.js';

const FR = F2L_SLOTS.D.findIndex((s) => [...s.faces].sort().join('') === 'FR');
const FR_BIT = 1 << FR;
const Y = ['', 'y', 'y2', "y'"];
const AUF = ['', 'U', 'U2', "U'"];

/** Züge ohne Würfeldrehungen (x, y, z zählen nicht) */
export const moveCount = (alg) => tokenizeAlg(alg).filter((t) => !/^[xyz]/.test(t) && parseAnyMove(t)).length;

/** Zustand mit Kreuzfarbe unten (plus Drehung), Farben auf die Mitten bezogen */
const view = (state, face, extra = '') => relabelToCenters(applyAnyAlg(state, `${CROSS_DOWN[face]} ${extra}`));
/** Original-Farbe vorne/rechts in dieser Haltung */
const holdColors = (state, face, extra = '') => {
  const s = applyAnyAlg(state, `${CROSS_DOWN[face]} ${extra}`);
  return { down: s[31], front: s[22], right: s[13] };
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
  const a = analyzeSolve(solve.start, moves, solve.times);
  const face = a.crossFace;
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
  const mine = colors.find((c) => c.face === face);
  let x = null;
  try {
    x = solveXCross(view(start, face));
  } catch {
    x = null;
  }
  out.cross = {
    user: ph[0].moves,
    optimal: mine,
    xcross: x && { len: x.length, moves: x.moves.join(' '), complete: x.complete },
    colors,
    bestColor: colors.reduce((p, c) => (c.len < p.len ? c : p)),
  };
  // Bei X-Cross mit X-Cross vergleichen, sonst mit dem Kreuz.
  // Wurden mit dem Kreuz gleich mehrere Paare fertig (XX-Cross …), gibt es keinen fairen Vergleich.
  out.cross.multi = ph[1].moves === 0 && ph[2].moves === 0;
  const crossRef = a.xcross && x ? x.length : mine.len;
  out.cross.saved = out.cross.multi ? 0 : Math.max(0, ph[0].moves - crossRef);

  // ---------- F2L ----------
  out.pairs = [];
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
    const target = options.find((o) => !(solvedSlots(o.s0, 'D') & FR_BIT) && solvedSlots(o.s1, 'D') & FR_BIT);
    const evals = options.map((o) => ({ ...o, best: bestPair(o.s0, extraAlgs) }));
    const mineEval = target && evals.find((o) => o.r === target.r);
    entry.best = mineEval?.best || null;
    entry.hold = mineEval?.hold;
    // Leichteres Paar zu diesem Zeitpunkt?
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
  out.oll = { moves: oll.moves, time: oll.time, recog: oll.recog, skip: oll.skip };
  out.pll = { moves: pll.moves, time: pll.time, recog: pll.recog, skip: pll.skip };
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

  out.saved = out.cross.saved + out.pairs.reduce((s, p) => s + (p.saved || 0), 0) + out.oll.saved + out.pll.saved;
  return out;
}
