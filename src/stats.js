/**
 * Zeiten und Mittelwerte nach WCA-Regeln.
 * Ein Solve: { time (ms, ohne Strafe), penalty: 0 | 2000 | 'DNF', ... }
 */

export const DNF = Infinity;

export function effectiveTime(solve) {
  if (!solve) return null;
  if (solve.penalty === 'DNF') return DNF;
  return solve.time + (solve.penalty || 0);
}

/** Durchschnitt der letzten n Solves: bestes und schlechtestes (je 5 %) fallen weg */
export function averageOf(solves, n) {
  if (solves.length < n) return null;
  const times = solves.slice(-n).map(effectiveTime).sort((a, b) => a - b);
  const cut = n <= 5 ? 1 : Math.ceil(n * 0.05);
  const mid = times.slice(cut, n - cut);
  if (mid.some((t) => t === DNF)) return DNF;
  return mid.reduce((a, b) => a + b, 0) / mid.length;
}

export function mean(solves) {
  const t = solves.map(effectiveTime).filter((x) => x !== DNF);
  if (!t.length) return null;
  return t.reduce((a, b) => a + b, 0) / t.length;
}

export function best(solves) {
  const t = solves.map(effectiveTime).filter((x) => x !== DNF);
  return t.length ? Math.min(...t) : null;
}

/** Bester Durchschnitt über alle Fenster der Länge n */
export function bestAverage(solves, n) {
  let b = null;
  for (let i = n; i <= solves.length; i++) {
    const a = averageOf(solves.slice(0, i), n);
    if (a !== null && a !== DNF && (b === null || a < b)) b = a;
  }
  return b;
}

export function formatTime(ms) {
  if (ms === null || ms === undefined) return '–';
  if (ms === DNF) return 'DNF';
  const total = Math.max(0, Math.round(ms));
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const cs = Math.floor((total % 1000) / 10);
  const tail = `${String(cs).padStart(2, '0')}`;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}.${tail}` : `${s}.${tail}`;
}

export function formatSolve(solve) {
  if (solve.penalty === 'DNF') return `DNF (${formatTime(solve.time)})`;
  return formatTime(effectiveTime(solve)) + (solve.penalty ? '+' : '');
}
