import { parseMove, formatMove } from './facelets.js';

const OPPOSITE = { U: 'D', D: 'U', R: 'L', L: 'R', F: 'B', B: 'F' };

/**
 * Führt durch ein Scramble. Statt eines Zeigers wird die Liste der noch
 * fehlenden Züge gepflegt: ein falscher Zug wird vorne als Korrektur
 * (seine Umkehrung) eingefügt, passende Züge werden verrechnet.
 * Dadurch funktionieren auch R statt R2, R' statt R, vertauschte
 * Parallelzüge (L R statt R L) und beliebig viele Fehler.
 */
export class ScrambleTracker {
  constructor(scramble) {
    this.scramble = scramble;
    this.remaining = scramble.split(/\s+/).filter(Boolean).map(parseMove);
    this.total = this.remaining.length;
    this.corrections = 0; // Anzahl Korrekturzüge vorne in der Liste
  }

  get done() {
    return this.remaining.length === 0;
  }

  /** Verarbeitet einen Zug des Würfels ("R", "U'", …) */
  push(move) {
    const mv = parseMove(move);
    if (!mv) return;
    const r = this.remaining;
    // Zug passt zum nächsten (oder zum übernächsten, wenn beide parallel sind)
    let target = -1;
    if (r[0] && r[0].face === mv.face) target = 0;
    else if (r[1] && r[1].face === mv.face && OPPOSITE[r[0].face] === mv.face) target = 1;

    if (target >= 0) {
      const amount = (((r[target].amount - mv.amount) % 4) + 4) % 4;
      if (amount === 0) {
        r.splice(target, 1);
        if (target < this.corrections) this.corrections--;
      } else {
        r[target] = { face: mv.face, amount };
      }
    } else {
      r.unshift({ face: mv.face, amount: 4 - mv.amount });
      this.corrections++;
    }
    this.corrections = Math.min(this.corrections, r.length);
  }

  /**
   * Restliche Züge durch eine kürzere Folge ersetzen (nach Fehlern neu berechnet):
   * statt alles zurückzudrehen, führt die neue Folge direkt zum Ziel-Zustand.
   */
  replace(alg) {
    const moves = String(alg).split(/\s+/).filter(Boolean).map(parseMove);
    if (moves.some((m) => !m)) return false;
    this.remaining = moves;
    this.corrections = 0;
    this.adjusted = true;
    return true;
  }

  /** Noch fehlende Züge als Text, die ersten `corrections` sind Korrekturen */
  remainingMoves() {
    return this.remaining.map((m, i) => ({ text: formatMove(m.face, m.amount), correction: i < this.corrections }));
  }

  /** Erledigter Anteil der ursprünglichen Züge (für die Fortschrittsanzeige) */
  progress() {
    const left = this.remaining.length - this.corrections;
    return Math.max(0, Math.min(1, 1 - left / Math.max(1, this.total)));
  }
}
