import assert from 'node:assert/strict';
import { moveCounts, fluency, solveMetrics, skillProfile } from '../src/metrics.js';

assert.deepEqual(moveCounts(['R', 'R', 'U', "U'", 'F', 'F', 'F']), { htm: 5, qtm: 7 });
assert.deepEqual(moveCounts(['R2', 'U']), { htm: 2, qtm: 3 });
// Gleichmäßig gedreht → 100; mit großen Pausen → deutlich weniger
assert.equal(fluency([0, 100, 200, 300, 400, 500]), 100);
const f = fluency([0, 100, 200, 1700, 1800, 1900, 3400, 3500]);
assert.ok(f > 0 && f < 30, 'Pausen senken die Flüssigkeit: ' + f);

// Solve mit Detaildaten
const solve = {
  v: 2,
  time: 2000,
  solution: "R R U R' F F",
  times: [0, 100, 200, 1200, 1300, 1400, 2000].slice(0, 6),
  phases: [
    { key: 'cross', time: 200, moves: 3, recog: 0 },
    { key: 'p1', time: 1000, moves: 1, recog: 1000 },
    { key: 'p2', time: 0, moves: 0, recog: 0 },
    { key: 'p3', time: 0, moves: 0, recog: 0 },
    { key: 'p4', time: 0, moves: 0, recog: 0 },
    { key: 'oll', time: 200, moves: 2, recog: 100 },
    { key: 'pll', time: 0, moves: 0, recog: 0 },
  ],
};
const m = solveMetrics(solve);
assert.equal(m.htm, 4);
assert.equal(m.qtm, 6);
assert.equal(m.recog, 1100);
assert.ok(Math.abs(m.etps - (4 / 0.9)) < 1e-9);
// Profil braucht mindestens 5 Solves, Werte 0–100
assert.equal(skillProfile([solve]), null);
const p = skillProfile(Array.from({ length: 6 }, (_, i) => ({ ...solve, time: 2000 + i * 50, metrics: undefined })));
for (const v of Object.values(p.scores)) assert.ok(v >= 0 && v <= 100);
console.log('metrics: alle Tests bestanden', JSON.stringify(m));
