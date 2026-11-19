/**
 * Erkennt, wann ein Algorithmus fertig ausgeführt ist – egal, wie der Würfel gehalten wird
 * und in welchem Zustand er wirklich ist (Endlos-PLL).
 *
 * Idee: Die Züge kommen vom Smartcube im eigenen System des Würfels. Wir wenden sie gedanklich
 * auf den gezeigten Fall an – in allen 24 möglichen Haltungen und mit jedem AUF vorab.
 * Ist einer dieser 96 Zustände gelöst (bis auf AUF), war der Algorithmus richtig.
 */
import { applyMove, applyAnyAlg, rotationFaceMap, parseMove, formatMove } from './facelets.js';
import { solvedUpToAuf } from './ll-cases.js';

const MAPS = [];
{
  const seen = new Set();
  for (const x of ['', 'x', 'x2', "x'", 'z', "z'"]) {
    for (const y of ['', 'y', 'y2', "y'"]) {
      const m = rotationFaceMap(`${x} ${y}`.trim());
      const k = JSON.stringify(m);
      if (!seen.has(k)) {
        seen.add(k);
        MAPS.push(m);
      }
    }
  }
}
export const ORIENTATIONS = MAPS.length; // 24

export class AlgDetector {
  /**
   * @param caseState Fall-Zustand (Kreuz unten, letzte Schicht oben)
   * @param done      Prüfung „fertig“ (Standard: gelöst bis auf AUF)
   */
  constructor(caseState, done = solvedUpToAuf) {
    this.done = done;
    this.moves = 0;
    this.states = [];
    for (const map of MAPS) for (const auf of ['', 'U', 'U2', "U'"]) this.states.push({ map, s: auf ? applyAnyAlg(caseState, auf) : caseState });
  }

  /** Zug verarbeiten; true = Fall gelöst */
  push(move) {
    const p = parseMove(move);
    if (!p) return false;
    this.moves++;
    let ok = false;
    for (const st of this.states) {
      st.s = applyMove(st.s, formatMove(st.map[p.face], p.amount));
      if (!ok && this.done(st.s)) ok = true;
    }
    return ok;
  }
}
