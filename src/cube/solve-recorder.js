import { cubeTimestampLinearFit } from 'gan-web-bluetooth';
import { analyzeSolve } from './analysis.js';

/**
 * Zeiten der Züge relativ zum ersten Zug.
 * GAN-Würfel liefern eigene Zeitstempel, deren Uhr leicht abweicht: per linearer
 * Regression gegen die Uhr des Geräts angeglichen (Verfahren aus csTimer).
 */
export function moveTimes(moves) {
  if (!moves.length) return [];
  const withCube = moves.filter((m) => m.cubeTimestamp != null).length;
  const withLocal = moves.filter((m) => m.localTimestamp != null).length;
  if (withCube >= 2 && withLocal >= 2) {
    const fitted = cubeTimestampLinearFit(moves.map((m) => ({ ...m, face: 0, direction: 0 })));
    return fitted.map((m) => m.cubeTimestamp);
  }
  // Nur Gerätezeit: Lücken (verlorene Ereignisse) mit dem Vorgänger füllen
  const out = [];
  let last = moves.find((m) => m.localTimestamp != null)?.localTimestamp ?? 0;
  const t0 = last;
  for (const m of moves) {
    if (m.localTimestamp != null) last = m.localTimestamp;
    out.push(last - t0);
  }
  return out;
}

/** Sammelt die Züge eines Solves; die Auswertung passiert erst am Ende (analysis.js) */
export class SolveRecorder {
  /** @param {string} start Zustand vor dem ersten Zug */
  constructor(start) {
    this.start = start;
    this.moves = [];
  }

  push(moveEvent) {
    this.moves.push({ move: moveEvent.move, localTimestamp: moveEvent.localTimestamp, cubeTimestamp: moveEvent.cubeTimestamp });
  }

  /** Ergebnis nach dem lösenden Zug */
  finish() {
    const times = moveTimes(this.moves).map((x) => Math.max(0, Math.round(x)));
    // Zeiten dürfen nicht rückwärts laufen (verlorene oder vertauschte Ereignisse)
    for (let i = 1; i < times.length; i++) if (times[i] < times[i - 1]) times[i] = times[i - 1];
    const moves = this.moves.map((m) => m.move);
    const a = analyzeSolve(this.start, moves, times);
    return { ...a, start: this.start, moves, times, solution: moves.join(' ') };
  }
}
