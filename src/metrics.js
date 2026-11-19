/**
 * Kennzahlen eines Solves (wie in Cube Station): Zugzahl, TPS, Flüssigkeit, Erkennung, Pausen –
 * und daraus ein Stärkenprofil über viele Solves (0–100 je Bereich).
 */
import { L } from './i18n.js';
import { hasDetail } from './solve-data.js';
import { effectiveTime, DNF } from './stats.js';

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const clamp = (x) => Math.max(0, Math.min(100, x));
/** Lineare Skala: bei `bad` 0 Punkte, bei `good` 100 */
const scale = (v, bad, good) => (v == null ? null : clamp(((v - bad) / (good - bad)) * 100));

/**
 * Zugzahl in HTM: zwei gleiche Vierteldrehungen direkt hintereinander (Doppelzug) zählen als ein Zug.
 * QTM: jede Vierteldrehung einzeln.
 */
export function moveCounts(moves) {
  let htm = 0;
  for (let i = 0; i < moves.length; i++) {
    htm++;
    if (i + 1 < moves.length && moves[i + 1] === moves[i] && !moves[i].endsWith('2')) i++;
  }
  const qtm = moves.reduce((a, m) => a + (m.endsWith('2') ? 2 : 1), 0);
  return { htm, qtm };
}

/**
 * Flüssigkeit 0–100: Anteil der Zeit ohne Stocken.
 * Eine Lücke zwischen zwei Zügen ist „Stocken“, soweit sie über der normalen Drehpause liegt
 * (das 2,5-Fache deiner mittleren Lücke, mindestens 250 ms).
 */
export function fluency(times) {
  if (times.length < 3) return null;
  const total = times[times.length - 1] - times[0];
  if (total <= 0) return null;
  const gaps = times.slice(1).map((t, i) => t - times[i]);
  const tau = Math.max(250, 2.5 * median(gaps));
  const stall = gaps.reduce((a, g) => a + Math.max(0, g - tau), 0);
  return Math.round(clamp(100 * (1 - stall / total)));
}

/** Alle Kennzahlen eines Solves mit Zugzeiten */
export function solveMetrics(s) {
  if (!hasDetail(s)) return null;
  const moves = s.solution.split(' ').filter(Boolean);
  const { htm, qtm } = moveCounts(moves);
  const time = s.time || 1;
  const recog = s.phases.slice(1).reduce((a, p) => a + (p.recog || 0), 0);
  const gaps = s.times.slice(1).map((t, i) => t - s.times[i]);
  const pauses = gaps.filter((g) => g >= 500).length;
  return {
    htm,
    qtm,
    tps: (htm / time) * 1000,
    etps: time - recog > 0 ? (htm / (time - recog)) * 1000 : null, // Drehtempo ohne Erkennungspausen
    fluency: fluency(s.times),
    recog,
    pauses,
    crossMoves: s.phases[0].moves,
    pairRecog: avg(s.phases.slice(1, 5).filter((p) => p.moves > 0).map((p) => p.recog)),
    llRecog: (s.phases[5].recog || 0) + (s.phases[6].recog || 0),
    rotations: s.gyro ? s.gyro.rotations.length : null,
  };
}

/** Kennzahlen, bei Bedarf berechnet und am Solve zwischengespeichert */
const METRICS_VERSION = 1;
export function metricsOf(s) {
  if (s.metrics === undefined || (s.metrics && s.metrics.mv !== METRICS_VERSION)) {
    const m = solveMetrics(s);
    s.metrics = m ? { ...m, mv: METRICS_VERSION } : null;
  }
  return s.metrics;
}

/**
 * Stärkenprofil über eine Auswahl von Solves: je Bereich 0–100 und der Messwert dahinter.
 * Die Skalen orientieren sich grob an Lösern zwischen ~60 s (0) und ~10 s (100).
 */
export const SKILLS = [
  { key: 'cross', name: 'Cross', hint: L('Züge und Zeit fürs Cross', 'Moves and time for the cross') },
  { key: 'lookahead', name: 'Lookahead', hint: L('Pause vor jedem F2L-Paar', 'Pause before each F2L pair') },
  { key: 'recog', name: 'Recog', hint: L('Pause vor OLL und PLL', 'Pause before OLL and PLL') },
  { key: 'tps', name: 'Exec TPS', hint: L('Züge pro Sekunde ohne Pausen', 'Turns per second without pauses') },
  { key: 'fluency', name: 'Fluency', hint: L('Anteil der Zeit ohne Stocken', 'Share of time without stalling') },
  { key: 'efficiency', name: L('Effizienz', 'Efficiency'), hint: L('Zugzahl (HTM)', 'Move count (HTM)') },
  { key: 'consistency', name: L('Konstanz', 'Consistency'), hint: L('Streuung deiner Zeiten', 'Spread of your times') },
];

export function skillProfile(solves) {
  const det = solves.filter((s) => hasDetail(s) && s.penalty !== 'DNF');
  if (det.length < 5) return null;
  const m = det.map(metricsOf).filter(Boolean);
  const v = {
    crossMoves: avg(m.map((x) => x.crossMoves)),
    crossTime: avg(det.map((s) => s.phases[0].time)),
    pairRecog: avg(m.map((x) => x.pairRecog).filter((x) => x != null)),
    llRecog: avg(m.map((x) => x.llRecog)),
    etps: avg(m.map((x) => x.etps).filter((x) => x != null)),
    fluency: avg(m.map((x) => x.fluency).filter((x) => x != null)),
    htm: avg(m.map((x) => x.htm)),
  };
  const times = det.map(effectiveTime).filter((t) => t !== DNF);
  const mean = avg(times);
  const sd = Math.sqrt(avg(times.map((t) => (t - mean) ** 2)));
  const cv = mean ? sd / mean : null;
  const crossScore = avg([scale(v.crossMoves, 13, 6), scale(v.crossTime, 5000, 1000)].filter((x) => x != null));
  return {
    n: det.length,
    values: v,
    cv,
    scores: {
      cross: crossScore,
      lookahead: scale(v.pairRecog, 1200, 150),
      recog: scale(v.llRecog, 2500, 400),
      tps: scale(v.etps, 2, 10),
      fluency: scale(v.fluency, 40, 95),
      efficiency: scale(v.htm, 85, 45),
      consistency: scale(cv, 0.3, 0.05),
    },
  };
}
