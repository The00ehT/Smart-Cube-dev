import assert from 'node:assert/strict';
import { SOLVED, applyAlg, faceletsToPatternData, phaseStatus, solvedSlots } from '../src/cube/facelets.js';
import { MOVES, EDGE_MOVE, CORNER_MOVE, solveCross, solveXCross } from '../src/cube/cross-solver.js';

// Zugtabellen stimmen mit dem Facelet-Modell überein
const rnd = (n, seed = 7) => { let x = seed; return Array.from({ length: n }, () => MOVES[(x = (x * 1103515245 + 12345) % 2147483648) % 18]); };
const alg = rnd(30);
const d = faceletsToPatternData(applyAlg(SOLVED, alg.join(' ')));
for (let p = 0; p < 12; p++) {
  let v = p * 2;
  for (const m of alg) v = EDGE_MOVE[MOVES.indexOf(m)][v];
  const pos = d.EDGES.pieces.indexOf(p);
  assert.equal(v, pos * 2 + d.EDGES.orientation[pos], 'Kante ' + p);
}
for (let p = 0; p < 8; p++) {
  let v = p * 3;
  for (const m of alg) v = CORNER_MOVE[MOVES.indexOf(m)][v];
  const pos = d.CORNERS.pieces.indexOf(p);
  assert.equal(v, pos * 3 + d.CORNERS.orientation[pos], 'Ecke ' + p);
}

// Kreuz: Lösung löst wirklich das Kreuz, Länge ≤ 8
const scrambles = ["R U' F2 D L' B R2 U2 F' L D2 R' B2 U F", "D2 F' R U L2 B' D R' F U2 L B2 R D' F2", "F R' D2 L U B2 R' F2 D L' U2 B R D2 F'"];
for (const s of scrambles) {
  const st = applyAlg(SOLVED, s);
  const t0 = Date.now();
  const c = solveCross(st);
  assert.ok(c.length <= 8 && phaseStatus(applyAlg(st, c.moves.join(' '))).D.cross, 'Kreuz gelöst');
  const t1 = Date.now();
  const x = solveXCross(st);
  const after = applyAlg(st, x.moves.join(' '));
  assert.ok(phaseStatus(after).D.cross && solvedSlots(after, 'D') > 0, 'X-Cross gelöst');
  assert.ok(x.length >= c.length);
  console.log(`Kreuz ${c.length} (${c.moves.join(' ')}) ${t1 - t0} ms · X-Cross ${x.length} ${x.slot} (${x.moves.join(' ')}) ${Date.now() - t1} ms`);
}
console.log('cross: alle Tests bestanden');
