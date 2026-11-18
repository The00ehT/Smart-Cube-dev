/** Ausführliche Statistik über eine Auswahl von Solves */
import { effectiveTime, DNF, averageOf } from './stats.js';
import { hasDetail, phasesOf } from './solve-data.js';
import { pauses } from './cube/analysis.js';

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function stdev(xs) {
  if (xs.length < 2) return null;
  const m = avg(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Zeitreihe mit laufenden Durchschnitten (für das Verlaufsdiagramm) */
export function series(solves) {
  return solves.map((s, i) => {
    const upto = solves.slice(0, i + 1);
    const t = effectiveTime(s);
    return {
      i,
      time: t === DNF ? null : t,
      ao5: averageOf(upto, 5),
      ao12: averageOf(upto, 12),
    };
  });
}

export const PHASE_ORDER = ['cross', 'p1', 'p2', 'p3', 'p4', 'f2l', 'oll', 'pll'];

export function detailStats(solves) {
  const times = solves.map(effectiveTime).filter((t) => t !== DNF);
  const det = solves.filter(hasDetail);

  // Phasen: Mittelwerte über alle Solves mit Detaildaten
  const phase = {};
  for (const key of PHASE_ORDER) phase[key] = { time: [], recog: [], moves: [], exec: [], tps: [] };
  for (const s of det) {
    const all = [...phasesOf(s), ...phasesOf(s, { mergeF2l: true }).filter((p) => p.key === 'f2l')];
    for (const p of all) {
      const b = phase[p.key];
      if (!b) continue;
      b.time.push(p.time);
      b.recog.push(p.recog);
      b.moves.push(p.moves);
      const exec = p.time - p.recog;
      b.exec.push(exec);
      if (exec > 0 && p.moves > 0) b.tps.push((p.moves / exec) * 1000);
    }
  }
  const total = avg(det.map((s) => s.time)) || 0;
  const phases = PHASE_ORDER.map((key) => {
    const b = phase[key];
    const t = avg(b.time);
    return {
      key,
      time: t,
      best: b.time.length ? Math.min(...b.time) : null,
      recog: avg(b.recog),
      exec: avg(b.exec),
      moves: avg(b.moves),
      tps: avg(b.tps),
      share: total && t != null ? t / total : null,
    };
  });

  // Skips und Besonderheiten
  const count = det.length;
  const rate = (f) => (count ? det.filter(f).length / count : null);
  const ollSkip = rate((s) => s.phases[5].skip);
  const pllSkip = rate((s) => s.phases[6].skip);
  const xcross = rate((s) => s.xcross);

  // Kreuzfarben
  const crossFaces = {};
  for (const s of solves) {
    if (!s.crossFace) continue;
    const c = (crossFaces[s.crossFace] ??= { n: 0, times: [] });
    c.n++;
    const t = effectiveTime(s);
    if (t !== DNF) c.times.push(t);
  }
  for (const c of Object.values(crossFaces)) c.mean = avg(c.times);

  // Lookahead: Pausen ≥ 0,5 s
  const ps = det.map((s) => pauses(s.times, 500));
  const lookahead = count
    ? { perSolve: avg(ps.map((p) => p.count)), timePerSolve: avg(ps.map((p) => p.sum)) }
    : null;

  // F2L-Paare: Zeit nach Slot (Slot als Farben, z. B. "RF")
  const slots = {};
  for (const s of det) {
    for (const p of s.phases.slice(1, 5)) {
      if (!p.slot || p.moves === 0) continue;
      const k = [...p.slot].sort().join('');
      (slots[k] ??= []).push(p.time);
    }
  }
  const slotStats = Object.entries(slots).map(([k, ts]) => ({ slot: k, n: ts.length, mean: avg(ts) }));

  // Gyro: Würfeldrehungen und Griffwechsel, auch je Phase
  const gy = det.filter((s) => s.gyro);
  let gyro = null;
  if (gy.length) {
    const perPhase = { cross: 0, f2l: 0, oll: 0, pll: 0 };
    const kinds = {};
    for (const s of gy) {
      // Phasenenden aus den aufsummierten Phasenzeiten: Kreuz, F2L (nach Paar 4), OLL, PLL
      const cum = [];
      s.phases.reduce((acc, p) => (cum.push(acc + p.time), acc + p.time), 0);
      const ends = [cum[0], cum[4], cum[5], Infinity];
      for (const r of s.gyro.rotations) {
        const k = ['cross', 'f2l', 'oll', 'pll'][ends.findIndex((e) => r.t <= e)] ?? 'pll';
        perPhase[k]++;
        kinds[r.name] = (kinds[r.name] || 0) + 1;
      }
    }
    for (const k of Object.keys(perPhase)) perPhase[k] /= gy.length;
    gyro = {
      n: gy.length,
      rotations: avg(gy.map((s) => s.gyro.rotations.length)),
      regrips: avg(gy.map((s) => s.gyro.regrips.length)),
      perPhase,
      kinds: Object.entries(kinds).sort((a, b) => b[1] - a[1]),
    };
  }

  return {
    gyro,
    n: solves.length,
    detailed: count,
    best: times.length ? Math.min(...times) : null,
    worst: times.length ? Math.max(...times) : null,
    mean: avg(times),
    median: median(times),
    stdev: stdev(times),
    dnf: solves.filter((s) => s.penalty === 'DNF').length,
    plus2: solves.filter((s) => s.penalty === 2000).length,
    moves: avg(solves.map((s) => s.moveCount).filter((x) => x > 0)),
    tps: avg(solves.map((s) => s.tps).filter((x) => x > 0)),
    phases,
    ollSkip,
    pllSkip,
    xcross,
    crossFaces,
    lookahead,
    slotStats,
    times,
  };
}
