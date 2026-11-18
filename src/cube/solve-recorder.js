import { cubeTimestampLinearFit } from 'gan-web-bluetooth';
import { FACES, phaseStatus } from './facelets.js';

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

export class SolveRecorder {
  constructor() {
    this.moves = [];
    // je Kreuzseite: Zugindex, bei dem Kreuz / F2L / OLL erstmals erreicht wurden
    this.phaseIdx = Object.fromEntries(FACES.map((f) => [f, { cross: null, f2l: null, oll: null }]));
  }

  push(moveEvent, stateAfter) {
    const i = this.moves.length;
    this.moves.push({ move: moveEvent.move, localTimestamp: moveEvent.localTimestamp, cubeTimestamp: moveEvent.cubeTimestamp });
    const st = phaseStatus(stateAfter);
    for (const f of FACES) {
      const p = this.phaseIdx[f];
      for (const k of ['cross', 'f2l', 'oll']) if (p[k] === null && st[f][k]) p[k] = i;
    }
  }

  /** Ergebnis nach dem lösenden Zug */
  finish() {
    const times = moveTimes(this.moves);
    const n = this.moves.length;
    const time = n ? times[n - 1] : 0;
    // Kreuzseite: dort, wo F2L zuerst fertig war (bei Gleichstand das frühere Kreuz)
    let face = FACES[0];
    for (const f of FACES) {
      const a = this.phaseIdx[f];
      const b = this.phaseIdx[face];
      if (a.f2l < b.f2l || (a.f2l === b.f2l && a.cross < b.cross)) face = f;
    }
    const p = this.phaseIdx[face];
    const marks = [
      ['Kreuz', p.cross],
      ['F2L', p.f2l],
      ['OLL', p.oll],
      ['PLL', n - 1],
    ];
    let prevIdx = -1;
    let prevT = 0;
    const phases = marks.map(([name, idx]) => {
      const i = Math.max(idx ?? prevIdx, prevIdx);
      const t = i >= 0 ? times[i] : 0;
      const ph = { name, time: t - prevT, moves: i - prevIdx, at: t };
      prevIdx = i;
      prevT = t;
      return ph;
    });
    return {
      time,
      moveCount: n,
      tps: time > 0 ? (n / time) * 1000 : 0,
      crossFace: face,
      phases,
      solution: this.moves.map((m) => m.move).join(' '),
      moveTimes: times,
    };
  }
}
