/**
 * Schwächen finden: Fälle, die im Vergleich zu deinem eigenen Durchschnitt langsam sind –
 * aus echten Solves (OLL/PLL: Zeit und Erkennung) und aus dem Training (alle Fälle).
 */
import { L } from './i18n.js';
import { llStats } from './case-stats.js';
import { algData, caseName } from './algs.js';
import { formatTime } from './stats.js';

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** @returns [{ id, score, reason }] sortiert, schwächste zuerst */
export function weakCases(solves, limit = 6) {
  const st = llStats(solves);
  const out = new Map();
  const add = (id, score, reason) => {
    const e = out.get(id);
    if (!e || score > e.score) out.set(id, { id, score, reason });
  };
  // Aus Solves: langsamer als dein Ø dieser Phase, Erkennung zählt extra
  for (const set of ['OLL', 'PLL']) {
    const tot = st.total[set];
    if (!tot.mean) continue;
    for (const [id, e] of Object.entries(st[set])) {
      if (id === 'Skip' || e.n < 2) continue;
      const slow = e.mean / tot.mean;
      const recog = tot.recog ? e.recog / tot.recog : 1;
      const score = slow + 0.5 * (recog - 1);
      if (score > 1.05) add(id, score, L(`in Solves Ø ${formatTime(e.mean)} statt ${formatTime(tot.mean)}`, `in solves avg ${formatTime(e.mean)} vs ${formatTime(tot.mean)}`) + (recog > 1.3 ? `, Recog ${formatTime(e.recog)}` : ''));
    }
  }
  // Aus dem Training: langsamer als dein Trainings-Ø
  const tr = Object.entries(algData.train).map(([id, l]) => [id, avg(l.slice(-8).map((x) => x.exec))]).filter(([, a]) => a);
  const ref = avg(tr.map(([, a]) => a));
  for (const [id, a] of tr) {
    if (a / ref > 1.1) add(id, a / ref, L(`im Training Ø ${formatTime(a)} statt ${formatTime(ref)}`, `in training avg ${formatTime(a)} vs ${formatTime(ref)}`));
  }
  // Schon gesehen, aber nie trainiert
  for (const set of ['OLL', 'PLL']) {
    for (const [id, e] of Object.entries(st[set])) {
      if (id !== 'Skip' && e.n >= 2 && !algData.train[id]) add(id, 1.0 + e.n / 100, L(`${e.n}× in Solves, noch nie trainiert`, `${e.n}× in solves, never trained`));
    }
  }
  return [...out.values()].sort((a, b) => b.score - a.score).slice(0, limit).map((w) => ({ ...w, name: caseName(w.id) }));
}
