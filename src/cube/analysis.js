/**
 * Auswertung eines Solves nach CFOP: Kreuz, die vier F2L-Paare einzeln, OLL und PLL,
 * jeweils mit Zeit, Zügen, Erkennungszeit (Pause vor dem ersten Zug der Phase) und Skips.
 *
 * Arbeitet nur mit Startzustand, Zügen und Zeiten – damit lässt sich jeder gespeicherte
 * oder geteilte Solve jederzeit neu auswerten.
 */
import { L } from '../i18n.js';
import { FACES, applyMove, applyAnyAlg, phaseStatus, solvedSlots, F2L_SLOTS, isSolved, CROSS_DOWN, countHtm } from './facelets.js';
import { identifyOll, identifyPll, f2lSolved, llOriented } from './ll-cases.js';

const popcount = (m) => ((m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1));
const OPPOSITE = { U: 'D', D: 'U', R: 'L', L: 'R', F: 'B', B: 'F' };

export const PHASE_KEYS = ['cross', 'p1', 'p2', 'p3', 'p4', 'oll', 'pll'];
export const PHASE_NAMES = {
  cross: 'Cross', p1: L('Paar 1', 'Pair 1'), p2: L('Paar 2', 'Pair 2'), p3: L('Paar 3', 'Pair 3'), p4: L('Paar 4', 'Pair 4'), f2l: 'F2L', oll: 'OLL', pll: 'PLL',
};

/**
 * @param {string} start   Zustand vor dem ersten Zug (Kociemba-Facelets)
 * @param {string[]} moves Züge ("R", "U'", …)
 * @param {number[]} times Zeit jedes Zuges in ms relativ zum ersten Zug (times[0] = 0)
 */
export function analyzeSolve(start, moves, times) {
  const n = moves.length;
  // Zustände: states[i + 1] = nach Zug i; Index −1 bedeutet „schon vor dem ersten Zug“
  const states = [start];
  for (const m of moves) states.push(applyMove(states[states.length - 1], m));
  const at = (i) => states[i + 1];

  // Je Kreuzseite: erstes Erreichen von Kreuz, k gelösten Paaren, F2L, OLL
  const info = {};
  for (const f of FACES) info[f] = { cross: null, pairs: [null, null, null, null], pairSlot: [], f2l: null, oll: null };
  let prevMask = Object.fromEntries(FACES.map((f) => [f, 0]));
  for (let i = -1; i < n; i++) {
    const s = at(i);
    const st = phaseStatus(s);
    for (const f of FACES) {
      const p = info[f];
      if (p.cross === null && st[f].cross) p.cross = i;
      if (st[f].cross) {
        const mask = solvedSlots(s, f);
        const cnt = popcount(mask);
        for (let k = 0; k < cnt; k++) {
          if (p.pairs[k] === null) {
            p.pairs[k] = i;
            // neu gelöster Slot (bei mehreren gleichzeitig: der nächste freie)
            const fresh = mask & ~prevMask[f];
            const bits = [0, 1, 2, 3].filter((b) => fresh & (1 << b) && !p.pairSlot.includes(b));
            const any = [0, 1, 2, 3].filter((b) => mask & (1 << b) && !p.pairSlot.includes(b));
            p.pairSlot[k] = bits[0] ?? any[0] ?? null;
          }
        }
        prevMask[f] = mask;
      } else prevMask[f] = 0;
      if (p.f2l === null && st[f].f2l) p.f2l = i;
      if (p.oll === null && st[f].oll) p.oll = i;
    }
  }

  // Kreuzseite: dort, wo F2L zuerst fertig war (bei Gleichstand das frühere Kreuz)
  const rank = (v) => (v === null ? Infinity : v);
  let face = FACES[0];
  for (const f of FACES) {
    const a = info[f];
    const b = info[face];
    if (rank(a.f2l) < rank(b.f2l) || (rank(a.f2l) === rank(b.f2l) && rank(a.cross) < rank(b.cross))) face = f;
  }
  const p = info[face];
  const last = n - 1;
  const marks = [
    ['cross', p.cross],
    ['p1', p.pairs[0]],
    ['p2', p.pairs[1]],
    ['p3', p.pairs[2]],
    ['p4', p.f2l ?? p.pairs[3]],
    ['oll', p.oll],
    ['pll', last],
  ];
  const t = (i) => (i >= 0 ? times[i] : 0);
  const phases = [];
  let prev = -1;
  for (const [key, idx] of marks) {
    const end = Math.min(Math.max(idx ?? prev, prev), last);
    const moveCount = end - prev;
    const time = t(end) - t(prev);
    // Erkennung: Pause zwischen dem letzten Zug der vorigen Phase und dem ersten Zug dieser Phase
    const recog = moveCount > 0 && prev >= 0 ? t(prev + 1) - t(prev) : 0;
    // Züge der Phase in HTM (R2 = 1 Zug, auch wenn der Würfel es als R R meldet)
    const ph = { key, time, moves: moveCount > 0 ? countHtm(moves.slice(prev + 1, end + 1)) : 0, recog, start: prev + 1, end };
    if (/^p\d$/.test(key)) {
      const slot = p.pairSlot[Number(key[1]) - 1];
      if (slot != null) ph.slot = F2L_SLOTS[face][slot].faces;
    }
    phases.push(ph);
    prev = end;
  }
  const oll = phases[5];
  const pll = phases[6];
  oll.skip = oll.moves === 0;
  // PLL-Skip: keine Züge oder nur Drehungen der letzten Schicht (AUF)
  const llFace = OPPOSITE[face];
  pll.skip = pll.moves === 0 || moves.slice(pll.start, pll.end + 1).every((m) => m[0] === llFace);
  const xcross = phases[1].moves === 0 && phases[0].moves > 0;

  // OLL-/PLL-Fall: Zustand zu Beginn der Phase, gedreht auf Kreuz unten
  const down = (i) => applyAnyAlg(at(i), CROSS_DOWN[face]);
  let ll = { oll: null, pll: null };
  try {
    const sOll = down(phases[4].end);
    const sPll = down(phases[5].end);
    if (f2lSolved(sOll)) ll.oll = oll.moves === 0 ? 0 : identifyOll(sOll);
    if (f2lSolved(sPll) && llOriented(sPll)) ll.pll = identifyPll(sPll);
  } catch {
    ll = { oll: null, pll: null };
  }

  const total = n ? times[last] : 0;
  return {
    crossFace: face,
    phases,
    time: total,
    moveCount: countHtm(moves),
    tps: total > 0 ? (countHtm(moves) / total) * 1000 : 0,
    xcross,
    ll,
    solved: isSolved(states[n]),
  };
}

/** Pausen (≥ minMs) zwischen zwei Zügen: Anzahl und Summe – Maß für Lookahead */
export function pauses(times, minMs = 500) {
  let count = 0;
  let sum = 0;
  for (let i = 1; i < times.length; i++) {
    const d = times[i] - times[i - 1];
    if (d >= minMs) {
      count++;
      sum += d;
    }
  }
  return { count, sum };
}
