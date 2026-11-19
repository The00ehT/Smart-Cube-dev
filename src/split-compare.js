/**
 * Vergleichswerte für die Splits eines Solves: Ø der letzten Solves derselben Art.
 * X-Cross-Solves werden nur mit anderen X-Cross-Solves verglichen (dort steckt das erste
 * Paar schon im Cross), OLL und PLL mit allen Solves.
 */
import { hasDetail } from './solve-data.js';

const mean = (xs) => (xs.length >= 3 ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function splitBaseline(solves, solve, n = 50) {
  const pool = solves.filter((s) => s !== solve && s.id !== solve.id && hasDetail(s) && s.phases?.length >= 7);
  const same = pool.filter((s) => !!s.xcross === !!solve.xcross).slice(-n);
  const all = pool.slice(-n);
  const pairs = same.flatMap((s) => s.phases.slice(1, 5).map((p) => p.time).filter((t) => t > 0));
  return {
    cross: mean(same.map((s) => s.phases[0].time)),
    f2l: mean(same.map((s) => s.phases.slice(1, 5).reduce((a, p) => a + p.time, 0))),
    pair: mean(pairs),
    oll: mean(all.map((s) => s.phases[5].time)),
    pll: mean(all.map((s) => s.phases[6].time)),
    xcross: !!solve.xcross,
    n: same.length,
  };
}
