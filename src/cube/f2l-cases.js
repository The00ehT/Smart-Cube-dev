/**
 * F2L-Fälle für den Slot vorne rechts (FR), Kreuz unten (D), Sicht des Lösers.
 *
 * Ein Fall = Lage und Orientierung der FR-Ecke (D-F-R) und der FR-Kante, unabhängig vom AUF.
 * Voraussetzung: Kreuz und die anderen drei Slots sind gelöst. Es gibt genau 41 Fälle (plus „gelöst“).
 */
import { L } from '../i18n.js';
import { applyAnyMove, faceletsToPatternData, phaseStatus, solvedSlots, F2L_SLOTS, SOLVED } from './facelets.js';
import { stateForAlg } from './ll-cases.js';

const CORNER = 4; // DRF in CORNER_NAMES
const EDGE = 8; // FR in EDGE_NAMES
const FR_SLOT = F2L_SLOTS.D.findIndex((s) => [...s.faces].sort().join('') === 'FR');
const OTHER_MASK = 15 & ~(1 << FR_SLOT);

/** Ist das ein reiner FR-Fall (Kreuz und andere Slots gelöst)? */
export function isFrCase(s) {
  return phaseStatus(s).D.cross && (solvedSlots(s, 'D') & OTHER_MASK) === OTHER_MASK;
}

/** Schlüssel: Ecke@Platz.Orientierung|Kante@Platz.Orientierung, kleinster über AUF */
export function f2lKey(s) {
  let best = null;
  let st = s;
  for (let k = 0; k < 4; k++) {
    const d = faceletsToPatternData(st);
    const ci = d.CORNERS.pieces.indexOf(CORNER);
    const ei = d.EDGES.pieces.indexOf(EDGE);
    const key = `${ci}.${d.CORNERS.orientation[ci]}|${ei}.${d.EDGES.orientation[ei]}`;
    if (best === null || key < best) best = key;
    st = applyAnyMove(st, 'U');
  }
  return best;
}
export const F2L_SOLVED_KEY = f2lKey(SOLVED);

/** Fall-Zustand für einen F2L-Algorithmus (oder null, wenn es kein FR-Fall ist) */
export function f2lStateForAlg(alg) {
  const s = stateForAlg(alg);
  return isFrCase(s) && f2lKey(s) !== F2L_SOLVED_KEY ? s : null;
}

/** Gruppe eines Falls (für die Anzeige) */
export function f2lGroup(key) {
  const [c, e] = key.split('|');
  const cTop = Number(c.split('.')[0]) < 4;
  const eTop = Number(e.split('.')[0]) < 4;
  const cUp = c.split('.')[1] === '0';
  if (cTop && eTop) return cUp ? G.upTop : G.top;
  if (cTop) return G.edgeIn;
  if (eTop) return G.cornerIn;
  return G.both;
}
const G = {
  top: L('Beide oben', 'Both on top'),
  upTop: L('Beide oben, Cross-Farbe nach oben', 'Both on top, cross color up'),
  edgeIn: L('Kante im Slot', 'Edge in slot'),
  cornerIn: L('Ecke im Slot', 'Corner in slot'),
  both: L('Beide im Slot', 'Both in slot'),
};
export const F2L_GROUP_ORDER = [G.top, G.upTop, G.edgeIn, G.cornerIn, G.both];

/** Für die Anzeige: AUF wählen, bei dem Ecke und Kante möglichst vorne/rechts liegen (sichtbar) */
export function displayState(s) {
  let best = s;
  let bestScore = -1;
  let st = s;
  // sichtbar in der Ansicht von vorne-rechts-oben: Plätze UF, UR (Kanten 0, 1) und UFR (Ecke 0)
  for (let k = 0; k < 4; k++) {
    const d = faceletsToPatternData(st);
    const ci = d.CORNERS.pieces.indexOf(CORNER);
    const ei = d.EDGES.pieces.indexOf(EDGE);
    const score = (ci === 0 || ci === 4 ? 2 : ci === 1 || ci === 3 ? 1 : 0) + (ei === 0 || ei === 1 || ei === 8 ? 2 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = st;
    }
    st = applyAnyMove(st, 'U');
  }
  return best;
}
