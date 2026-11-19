import assert from 'node:assert/strict';
import { SOLVED, applyAlg, invertAlg } from '../src/cube/facelets.js';
import { solveInsights, moveCount } from '../src/solve-insights.js';

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
console.log('insights: alle Tests bestanden');
