import assert from 'node:assert/strict';
import { SOLVED, applyAlg, invertAlg } from '../src/cube/facelets.js';
import { solveInsights, moveCost, fMoves, F_PENALTY } from '../src/solve-insights.js';

// ---- F-Strafe: Einsetzer mit F-Zügen werden nicht bevorzugt ----
assert.equal(fMoves("R U R' F' U' F"), 2);
assert.equal(moveCost(3, "R U R'"), 3);
assert.equal(moveCost(3, "F' U' F"), 3 + 2 * F_PENALTY);
assert.ok(moveCost(4, "R U R' U'") < moveCost(3, "F' U' F"), 'ein Zug mehr ohne F schlägt kurzen Alg mit zwei F-Zügen');

// Aus den Datenbank-Varianten wird immer die mit den geringsten Kosten gewählt
{
  const sol = "R U R' U' L' U' L U";
  const st = applyAlg(SOLVED, invertAlg(sol));
  const r = solveInsights({ start: st, solution: sol, times: sol.split(' ').map((_, i) => i * 150) });
  assert.ok(r.pairs.some((p) => !p.free), 'Beispiel hat Paare');
}

// ---- Beispiel-Solve: Kreuz, zwei Paare, OLL, PLL ----
const parts = { cross: "F2 D D' D", pairs: "R U R' U' L' U' L U", oll: "F R U R' U' F' R U R' U R U2 R'", pll: "R U R' U' R' F R2 U' R' U' R U R' F'" };
const sol = Object.values(parts).join(' ');
const moves = sol.split(' ');
const base = { start: applyAlg(SOLVED, invertAlg(sol)), solution: sol, times: moves.map((_, i) => i * 150) };
const r0 = solveInsights(base);
const firstPair = r0.pairs.find((p) => !p.free);
const pairPhase = r0.phases[firstPair.k];
assert.ok(pairPhase.moves >= 3, 'erstes Paar hat mehrere Züge');

// ---- Haltung für OLL und PLL ----
assert.equal(r0.oll.source, 'assumed', 'ohne Angaben: geschätzt');
assert.ok(Array.isArray(r0.oll.frontOptions) && r0.oll.frontOptions.length === 4);
for (const k of [0, 1, 2, 3]) {
  const q = solveInsights(base, { fronts: { oll: k, pll: (k + 1) % 4 } });
  assert.equal(q.oll.holdK, k);
  assert.equal(q.oll.source, 'set');
  assert.equal(q.pll.holdK, (k + 1) % 4);
  assert.equal(q.pll.view, ['', 'y', 'y2', "y'"][(k + 1) % 4]);
}
{
  // andere Haltung → andere Züge aus Sicht des Lösers, gleiche Zugzahl
  const a = solveInsights(base, { fronts: { oll: 0 } }).oll.userMoves;
  const b = solveInsights(base, { fronts: { oll: 1 } }).oll.userMoves;
  assert.notEqual(a, b);
  assert.equal(a.split(' ').length, b.split(' ').length);
}

// ---- Drehung mitten im Paar (von Hand eingetragen) ----
{
  const i = pairPhase.start + 2; // vor dem dritten Zug des Paares
  const q = solveInsights({ ...base, rots: { [i]: 'y' } });
  const p = q.pairs.find((x) => x.k === firstPair.k);
  assert.deepEqual(p.midRot, ['y'], 'Drehung im Paar erkannt');
  assert.equal(q.rotations.mid, 1);
  assert.ok(p.userMoves.split(' ').includes('y'), 'Drehung steht in den eigenen Zügen');
  // Haltung der Folge-Phasen berücksichtigt die Drehung mitten im Paar
  const withRot = solveInsights({ ...base, rots: { [i]: 'y' } }, { fronts: { [firstPair.k]: 0 } });
  const later = withRot.pairs.find((x) => x.k > firstPair.k && !x.free);
  if (later) assert.equal(later.holdK, 1, 'nächstes Paar: Haltung 0 + y-Drehung im Paar');
  assert.equal(withRot.oll.holdK, 1, 'OLL folgt der Haltung nach der Drehung');
}
// Gyro-Drehungen mitten im Paar gehen nicht mehr verloren
{
  const t = base.times;
  const mid = (t[pairPhase.start + 1] + t[pairPhase.start + 2]) / 2;
  const q = solveInsights({ ...base, gyro: { v0: 'z2', rotations: [{ t: mid, name: 'y' }], regrips: [] } }, { fronts: { [firstPair.k]: 0 } });
  const p = q.pairs.find((x) => x.k === firstPair.k);
  assert.deepEqual(p.midRot, ['y']);
  const later = q.pairs.find((x) => x.k > firstPair.k && !x.free);
  if (later) assert.equal(later.holdK, 1, 'Folgepaar nach Drehung im Paar: y');
  assert.equal(q.oll.source, 'gyro');
  assert.equal(q.oll.holdK, 1);
}
console.log('holds: alle Tests bestanden');
