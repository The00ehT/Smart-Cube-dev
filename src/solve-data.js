/**
 * Gespeicherte Solves:
 *   v1 (alt):  { id, date, time, penalty, scramble, solution, moveCount, tps, crossFace, phases: [{name,time,moves}], device }
 *   v2 (neu):  zusätzlich { v: 2, start, times: [ms je Zug], phases: [{key,time,moves,recog,slot?,skip?}], xcross,
 *              gyro?: { v0, rotations: [{t, name}], regrips: [t] }, ll?: { oll: Nr|0|null, pll: Name|'Skip'|null } }
 * Für v2 lässt sich alles aus start + Zügen + Zeiten neu berechnen (analysis.js).
 */
import { PHASE_NAMES } from './cube/analysis.js';

const OLD_KEYS = { Kreuz: 'cross', F2L: 'f2l', OLL: 'oll', PLL: 'pll' };

export const hasDetail = (s) => s?.v === 2 && Array.isArray(s.times) && s.phases?.length === 7;

export const phaseKey = (p) => p.key ?? OLD_KEYS[p.name] ?? p.name;
export const phaseName = (p) => PHASE_NAMES[phaseKey(p)] ?? p.name;

/** Phasen eines Solves, F2L-Paare optional zusammengefasst */
export function phasesOf(solve, { mergeF2l = false } = {}) {
  const ph = solve.phases || [];
  if (!mergeF2l || !hasDetail(solve)) return ph.map((p) => ({ ...p, key: phaseKey(p) }));
  const pairs = ph.filter((p) => /^p\d$/.test(p.key));
  const f2l = {
    key: 'f2l',
    time: pairs.reduce((a, p) => a + p.time, 0),
    moves: pairs.reduce((a, p) => a + p.moves, 0),
    recog: pairs.reduce((a, p) => a + p.recog, 0),
  };
  return [ph[0], f2l, ph[5], ph[6]];
}

/** Ergebnis der Analyse → zu speichernder Solve */
/** Züge in HTM (der Würfel meldet R2 als zwei Vierteldrehungen) */
function htmOf(moves) {
  let n = 0;
  for (let i = 0; i < moves.length; i++) {
    n++;
    if (i + 1 < moves.length && moves[i + 1] === moves[i] && !moves[i].endsWith('2')) i++;
  }
  return n;
}

export function buildSolve(r, extra) {
  return {
    v: 2,
    id: Date.now(),
    date: new Date().toISOString(),
    time: Math.round(r.time),
    penalty: 0,
    scramble: '',
    solution: r.solution,
    moveCount: r.moveCount,
    // TPS passend zur angezeigten Zugzahl (HTM): R2 zählt als ein Zug
    tps: r.time > 0 ? Math.round((htmOf(r.moves) / r.time) * 100000) / 100 : 0,
    crossFace: r.crossFace,
    xcross: r.xcross,
    ll: r.ll,
    start: r.start,
    times: r.times,
    phases: r.phases.map((p) => {
      const o = { key: p.key, time: Math.round(p.time), moves: p.moves, recog: Math.round(p.recog) };
      if (p.slot) o.slot = p.slot;
      if (p.skip) o.skip = true;
      return o;
    }),
    ...extra,
  };
}
