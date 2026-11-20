import assert from 'node:assert/strict';
import { SOLVED, applyAlg, invertAlg } from '../src/cube/facelets.js';
import { solveInsights, moveCount, mergeDoubles } from '../src/solve-insights.js';

// Solve aus Teilen: Kreuz (absichtlich umständlich), Paare, OLL (2-Look: Kreuz + Sune), PLL (T)
const parts = {
  cross: "F2 D D' D",                          // 4 Züge, eigentlich reicht weniger
  pairs: "R U R' U' L' U' L U",              // zwei leichte Paare
  oll: "F R U R' U' F' R U R' U R U2 R'",    // 2-Look-OLL
  pll: "R U R' U' R' F R2 U' R' U' R U R' F'",
};
const sol = Object.values(parts).join(' ');
const moves = sol.split(' ');
const solve = { start: applyAlg(SOLVED, invertAlg(sol)), solution: sol, times: moves.map((_, i) => i * 150) };
const r = solveInsights(solve);
console.log(JSON.stringify({ cross: { user: r.cross.user, opt: r.cross.optimal.len, x: r.cross.xcross, best: r.cross.bestColor.face + r.cross.bestColor.len }, pairs: r.pairs.map((p) => [p.k, p.moves, p.free ? 'frei' : p.best?.id, p.best?.len, p.easier?.id]), oll: [r.oll.moves, r.oll.best?.id, r.oll.best?.len, r.oll.twoLook], pll: [r.pll.moves, r.pll.best?.id, r.pll.best?.len], saved: r.saved }));
assert.ok(r.cross.optimal.len <= r.cross.user);
assert.equal(r.cross.colors.length, 6);
assert.ok(r.oll.best && r.oll.best.len <= 10, 'direkter OLL-Alg gefunden');
assert.ok(r.oll.twoLook, '2-Look erkannt');
assert.ok(r.pll.best, 'PLL erkannt');
assert.equal(moveCount("y R U R' x"), 3);
assert.deepEqual(mergeDoubles(['R', 'R', 'U', "U'", "F'", "F'", 'D']), ['R2', 'U', "U'", 'F2', 'D']);
// X-Cross landet immer im Slot hinten links
import { applyAnyAlg, CROSS_DOWN, solvedSlots, F2L_SLOTS, phaseStatus } from '../src/cube/facelets.js';
import { relabelToCenters } from '../src/cube/ll-cases.js';
const BL = F2L_SLOTS.D.findIndex((x) => [...x.faces].sort().join('') === 'BL');
for (const scr of ["R U' F2 D L' B R2 U2 F' L D2 R' B2 U F", "D2 F' R U L2 B' D R' F U2 L B2 R D' F2"]) {
  const st = applyAlg(SOLVED, scr);
  const q = solveInsights({ start: st, solution: invertAlg(scr), times: invertAlg(scr).split(' ').map((_, i) => i * 100) });
  const x = q.cross.xcross;
  const after = relabelToCenters(applyAnyAlg(st, `${CROSS_DOWN[q.crossFace]} ${x.r} ${x.moves}`));
  assert.ok(phaseStatus(after).D.cross && solvedSlots(after, 'D') & (1 << BL), 'X-Cross-Paar hinten links');
  console.log('X-Cross', x.len, 'Züge, Paar', x.pair, 'Haltung', x.r || '–', '| Lösung', q.solution.map((p) => p.key).join(','));
}
// Haltung („vorne“) frei wählbar: Vorschlag setzt das Paar aus jeder Haltung richtig ein
{
  let checked = 0;
  for (let hk = 0; hk < 4; hk++) {
    const q = solveInsights(solve, { fronts: { 3: hk, 4: hk } });
    for (const pr of q.pairs.filter((x) => !x.free && x.best && !x.best.stuck)) {
      const before = q.phaseStates[pr.k];
      const v = relabelToCenters(applyAnyAlg(before, `${CROSS_DOWN[q.crossFace]} ${['', 'y', 'y2', "y'"][pr.holdK]}`));
      const n0 = solvedSlots(v, 'D').toString(2).split('1').length;
      const after = relabelToCenters(applyAnyAlg(v, pr.best.alg));
      const n1 = solvedSlots(after, 'D').toString(2).split('1').length;
      assert.ok(phaseStatus(after).D.cross && n1 > n0, `Paar ${pr.k} aus Haltung ${hk} (${pr.pos}): ${pr.best.alg}`);
      checked++;
    }
  }
  const q2 = solveInsights(solve, { fronts: { 3: 0, 4: 2 } });
  console.log('Haltungen geprüft:', checked, '| Rotations:', JSON.stringify(q2.rotations), q2.pairs.map((x) => x.pos || '-').join(','));
}
console.log('insights: alle Tests bestanden');

// Vorausschau und EO beim letzten Paar
{
  const sol = "F R U' R' U R U R' U' L' U2 L U L' U' L U R' U2 R U' R' U R U L U L' U' L U' L' R U2 R' U' R U' R'";
  const q = solveInsights({ start: applyAlg(SOLVED, invertAlg(sol)), solution: sol, times: sol.split(' ').map((_, i) => i * 100) });
  const la = q.pairs.find((p) => p.lookahead)?.lookahead;
  assert.ok(la && la.total + 2 <= la.baseTotal, 'Vorausschau findet leichteres nächstes Paar');
  const last = q.pairs.filter((p) => !p.free).at(-1);
  assert.ok(last.eo && last.eo.mine && [0, 2, 4].includes(last.eo.mine.eo), 'EO nach dem letzten Paar');
  assert.ok(!q.pairs.slice(0, -1).some((p) => p.eo && p !== last), 'EO nur beim letzten Paar');
  console.log('Vorausschau ok', la.alg, la.total, '<', la.baseTotal);
}
