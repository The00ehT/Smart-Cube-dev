import { analyzeSolve } from './analysis.js';

/**
 * Zeiten der Züge relativ zum ersten Zug.
 * GAN-Würfel liefern eigene Zeitstempel (Würfeluhr). Sie sind die verlässlichste Quelle:
 * Wenn der Browser im Hintergrund war, kommen die Züge danach gesammelt auf einmal an,
 * die Gerätezeit ist dann für alle fast gleich (früher ergab das Solves mit 0 Sekunden).
 * Die Würfeluhr wird nur dann an die Gerätezeit angeglichen, wenn die gemessene
 * Abweichung plausibel klein ist (wenige Prozent), sonst gilt sie unverändert.
 */
export function moveTimes(moves) {
  if (!moves.length) return [];
  const cube = cubeClock(moves);
  if (cube) {
    // Gangabweichung aus erstem und letztem live angekommenen Zug (robust gegen gesammelte Nachzügler)
    let slope = 1;
    const live = moves.map((m, i) => [cube[i], m.localTimestamp]).filter((p) => p[1] != null);
    if (live.length >= 4) {
      const [x0, y0] = live[0];
      const [x1, y1] = live[live.length - 1];
      const s = x1 > x0 ? (y1 - y0) / (x1 - x0) : 1;
      if (s > 0.97 && s < 1.03) slope = s;
    }
    return cube.map((c) => (c - cube[0]) * slope);
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

/** Würfeluhr je Zug; fehlende (nachgeholte) Züge 50 ms neben den Nachbarn. null ohne Würfeluhr */
function cubeClock(moves) {
  const known = moves.filter((m) => m.cubeTimestamp != null).length;
  if (known < 2 || known < moves.length / 2) return null;
  const c = moves.map((m) => m.cubeTimestamp ?? null);
  for (let i = c.length - 1; i > 0; i--) if (c[i] != null && c[i - 1] == null) c[i - 1] = c[i] - 50;
  for (let i = 0; i < c.length - 1; i++) if (c[i] != null && c[i + 1] == null) c[i + 1] = c[i] + 50;
  return c;
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
