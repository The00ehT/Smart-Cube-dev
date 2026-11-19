/**
 * Statistik je OLL-/PLL-Fall aus den Solves: Anzahl, Ø Zeit, Ø Erkennung, Ø Ausführung.
 * Ältere Solves mit Zugzeiten werden einmalig nachträglich ausgewertet.
 */
import { hasDetail } from './solve-data.js';
import { analyzeSolve } from './cube/analysis.js';

export function ensureLl(s) {
  if (s.ll !== undefined) return s.ll;
  if (!hasDetail(s)) return null;
  try {
    s.ll = analyzeSolve(s.start, s.solution.split(' ').filter(Boolean), s.times).ll;
  } catch {
    s.ll = null;
  }
  return s.ll;
}

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** { OLL: { 'OLL 27': {...}, Skip: {...} }, PLL: {...}, total: { OLL: {...}, PLL: {...} } } */
export function llStats(solves) {
  const out = { OLL: {}, PLL: {}, total: {} };
  const add = (set, key, phase) => {
    const e = (out[set][key] ??= { n: 0, times: [], recogs: [] });
    e.n++;
    e.times.push(phase.time);
    e.recogs.push(phase.recog || 0);
  };
  for (const s of solves) {
    const ll = ensureLl(s);
    if (!ll) continue;
    if (ll.oll !== null && ll.oll !== undefined) add('OLL', ll.oll === 0 ? 'Skip' : `OLL ${ll.oll}`, s.phases[5]);
    if (ll.pll) add('PLL', ll.pll === 'Skip' ? 'Skip' : `PLL ${ll.pll}`, s.phases[6]);
  }
  for (const set of ['OLL', 'PLL']) {
    const all = Object.entries(out[set]);
    const cases = all.filter(([k]) => k !== 'Skip').map(([, e]) => e);
    const n = all.reduce((a, [, e]) => a + e.n, 0);
    for (const [, e] of all) {
      e.mean = avg(e.times);
      e.best = e.times.length ? Math.min(...e.times) : null;
      e.recog = avg(e.recogs);
      e.exec = e.mean !== null ? e.mean - e.recog : null;
      e.share = n ? e.n / n : 0;
    }
    const times = cases.flatMap((e) => e.times);
    const recogs = cases.flatMap((e) => e.recogs);
    out.total[set] = { n, mean: avg(times), recog: avg(recogs), exec: avg(times) !== null ? avg(times) - avg(recogs) : null, skip: out[set].Skip?.n || 0, seen: cases.length };
  }
  return out;
}
