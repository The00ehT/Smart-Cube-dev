import assert from 'node:assert/strict';
import {
  SOLVED, applyAlg, rotationFaceMap, translateMoves, CROSS_DOWN, F2L_SLOTS, solvedSlots, invertAlg,
} from '../src/cube/facelets.js';
import { analyzeSolve, pauses } from '../src/cube/analysis.js';
import { encodeShare, decodeShare } from '../src/share.js';

// Drehungen: x folgt R (F → U), y folgt U (F → L), z folgt F (U → R)
assert.equal(rotationFaceMap('x').F, 'U');
assert.equal(rotationFaceMap('x').U, 'B');
assert.equal(rotationFaceMap("x'").F, 'D');
assert.equal(rotationFaceMap('y').F, 'L');
assert.equal(rotationFaceMap('z').U, 'R');
assert.equal(rotationFaceMap('z2').U, 'D');
for (const [f, rot] of Object.entries(CROSS_DOWN)) assert.equal(rotationFaceMap(rot)[f], 'D', `Kreuz ${f} nach unten`);
assert.deepEqual(translateMoves(['U', "R'", 'F2'], 'z2'), ['D', "L'", 'F2']);

// Slots: je Seite vier, jeder mit 5 Feldern (Ecke 3 + Kante 2)
for (const f of 'URFDLB') {
  assert.equal(F2L_SLOTS[f].length, 4);
  for (const s of F2L_SLOTS[f]) assert.equal(s.stickers.length, 5);
  assert.equal(solvedSlots(SOLVED, f), 15);
}

/**
 * Gebauter CFOP-Solve mit weißem Kreuz (U-Seite):
 * Lösung = Kreuzzug, vier Paare je mit Sexy-artigem Einsetzen, OLL, PLL.
 * Der Startzustand ist die Umkehrung der ganzen Lösung.
 */
const parts = [
  ['cross', 'F2'],
  ['p1', "R U R'"],
  ['p2', "L' U' L"],
  ['p3', "R' U' R"],
  ['p4', "L U L'"],
  ['oll', "F' L' D' L D F"],
  ['pll', "R2 D R D R' D' R' D' R' D R' D"],
];
// Phasen werden von der Analyse selbst gefunden; wir prüfen Konsistenz statt exakter Grenzen
const solution = parts.map(([, a]) => a).join(' ').split(' ');
const start = applyAlg(SOLVED, invertAlg(solution.join(' ')));
const times = solution.map((_, i) => i * 100 + (i >= 20 ? 700 : 0)); // 0,7 s Pause vor Zug 20
const a = analyzeSolve(start, solution, times);
assert.ok(a.solved);
assert.equal(a.phases.length, 7);
assert.equal(a.phases.reduce((s, p) => s + p.moves, 0), solution.length, 'Züge summieren sich');
assert.equal(a.phases.reduce((s, p) => s + p.time, 0), a.time, 'Zeiten summieren sich');
for (const p of a.phases) assert.ok(p.recog >= 0 && p.recog <= p.time, 'Erkennung ≤ Phasenzeit');
const slots = a.phases.filter((p) => p.key.startsWith('p')).map((p) => p.slot).filter(Boolean);
assert.equal(new Set(slots).size, slots.length, 'jeder Slot nur einmal');

// Bekannter Fall: Kreuz auf D und drei Paare liegen schon, dann letztes Paar (4 Züge) und T-Perm (OLL-Skip)
{
  const sol = "U R U' R' R U R' U' R' F R2 U' R' U' R U R' F'".split(' ');
  const st = applyAlg(SOLVED, invertAlg(sol.join(' ')));
  const tm = sol.map((_, i) => i * 100 + (i >= 4 ? 600 : 0)); // 0,6 s Erkennung vor der PLL
  const r = analyzeSolve(st, sol, tm);
  assert.equal(r.crossFace, 'D');
  assert.deepEqual(r.phases.map((p) => p.moves), [0, 0, 0, 0, 4, 0, 14]);
  assert.equal(r.phases[4].slot, 'RF');
  assert.ok(r.phases[5].skip, 'OLL-Skip');
  assert.ok(!r.phases[6].skip);
  assert.equal(r.phases[6].recog, 700);
  assert.equal(r.phases[4].recog, 0, 'erste Phase mit Zügen hat keine messbare Erkennung');
}

// PLL nur mit AUF zählt als Skip
{
  const st = applyAlg(SOLVED, 'U');
  const r = analyzeSolve(st, ["U'"], [0]);
  assert.ok(r.phases[6].skip);
}

assert.deepEqual(pauses([0, 100, 800, 900, 1500], 500), { count: 2, sum: 1300 });

// Teilen: Hin- und Rückweg
const solve = { start, moves: solution, times, date: '2026-11-18T10:00:00.000Z', penalty: 2000, scramble: '', name: 'Theo & Co',
  gyro: { v0: 'z2', rotations: [{ t: 120, name: 'y' }, { t: 900, name: "x'" }], regrips: [450] } };
const back = decodeShare(encodeShare(solve));
assert.equal(back.start, start);
assert.deepEqual(back.moves, solution);
assert.deepEqual(back.times, times);
assert.equal(back.penalty, 2000);
assert.equal(back.name, 'Theo & Co');
assert.deepEqual(back.gyro.rotations, solve.gyro.rotations);
assert.deepEqual(back.gyro.regrips, [450]);
const sc = "R U2 F' D";
const s2 = { start: applyAlg(SOLVED, sc), scramble: sc, moves: ['D\''], times: [0], penalty: 'DNF', date: solve.date };
const b2 = decodeShare(encodeShare(s2));
assert.equal(b2.start, s2.start);
assert.equal(b2.scramble, sc);
assert.equal(b2.penalty, 'DNF');

console.log('analysis/share: alle Tests bestanden', a.phases.map((p) => `${p.key}:${p.moves}${p.slot ? '/' + p.slot : ''}`).join(' '));

// Doppelzüge zusammenfassen
import { groupMoves } from '../src/cube/facelets.js';
assert.deepEqual(groupMoves(['F', 'F', 'D', "R'", "R'", 'R']).map((g) => g.text), ['F2', 'D', 'R2', 'R']);
assert.deepEqual(groupMoves(['F', 'F'], 10)[0], { text: 'F2', first: 10, last: 11 });
console.log('groupMoves: ok');
