/**
 * 2-Look-Erkennung und Zugzählung: Einzelne PLL-Algs (auch mit Mittelschicht M, wie der Würfel sie meldet:
 * R und L' verschränkt) dürfen nie als 2-Look gelten; zwei nacheinander ausgeführte PLL (T + Y) schon.
 */
import assert from 'node:assert/strict';
import { SOLVED, applyAlg, invertAlg, flattenAlg, tokenizeAlg, countHtm } from '../src/cube/facelets.js';
import { PLL_ALGS, OLL_ALGS } from '../src/cube/ll-cases.js';
import { solveInsights } from '../src/solve-insights.js';

const OPP = { R: 'L', L: 'R', U: 'D', D: 'U', F: 'B', B: 'F' };
/** Züge so, wie der Würfel sie meldet: Vierteldrehungen; gleichzeitige Gegenseiten (Mittelschicht) verschränkt */
function deviceMoves(alg) {
  const toks = tokenizeAlg(flattenAlg(alg));
  const q = (t) => {
    const f = t[0];
    return t.endsWith('2') ? [f, f] : [t];
  };
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    const a = toks[i];
    const b = toks[i + 1];
    if (b && OPP[a[0]] === b[0] && a.endsWith('2') === b.endsWith('2') && (a.endsWith('2') || a.endsWith("'") !== b.endsWith("'"))) {
      const qa = q(a);
      const qb = q(b);
      for (let k = 0; k < qa.length; k++) out.push(qa[k], qb[k]); // R L R L
      i++;
    } else out.push(...q(a));
  }
  return out;
}
const solveOf = (alg) => {
  const full = `F2 R2 D ${alg}`; // etwas Kreuz davor, damit die Phasen stimmen
  const moves = [...deviceMoves('F2 R2 D'), ...deviceMoves(alg)];
  return { start: applyAlg(SOLVED, invertAlg(full)), solution: moves.join(' '), times: moves.map((_, i) => i * 100) };
};

assert.equal(countHtm(['R', "L'", 'R', "L'"]), 2, 'M2 verschränkt = 2 Züge');
assert.equal(countHtm(['R', 'R', 'U']), 2);
assert.equal(countHtm(['R', 'U', 'R']), 3);

let n = 0;
let withM = 0;
for (const [name, alg] of Object.entries(PLL_ALGS)) {
  const r = solveInsights(solveOf(alg));
  assert.ok(!r.pll.twoLook, `PLL ${name}: kein 2-Look (${r.pll.moves} Züge, direkt ${r.pll.best?.len})`);
  if (/[MES]/.test(alg)) withM++;
  n++;
}
for (const [name, alg] of Object.entries(OLL_ALGS)) {
  if (!/^[^xyz]*$/.test(alg)) continue;
  const r = solveInsights(solveOf(`${alg}`.replace(/^$/, '')));
  // OLL einzeln auszuführen ergibt kein gültiges Solve (LL nicht fertig) – nur prüfen, dass nichts abstürzt
  assert.ok(r.oll);
}
// Echter 2-Look: zwei PLL nacheinander (T, dann Y)
const two = solveInsights(solveOf(`${PLL_ALGS.T} ${PLL_ALGS.Y}`));
assert.ok(two.pll.twoLook, '2 PLL hintereinander gelten als 2-Look');
console.log(`twolook: ${n} PLLs (${withM} mit Mittelschicht) einzeln kein 2-Look, T + Y = 2-Look – alle Tests bestanden`);
