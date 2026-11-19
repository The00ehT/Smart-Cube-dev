import assert from 'node:assert/strict';
import { rotationFaceMap, tokenizeAlg } from '../src/cube/facelets.js';
import { PLL_ALGS, CASE_STATE } from '../src/cube/ll-cases.js';
import { AlgDetector, ORIENTATIONS } from '../src/cube/alg-detect.js';

assert.equal(ORIENTATIONS, 24);
// Was ein Smartcube meldet: Seitendrehungen im eigenen System (Würfeldrehungen sieht er nicht)
function cubeReports(alg, hold) {
  let map = rotationFaceMap(hold);
  const out = [];
  for (const t of tokenizeAlg(alg)) {
    if (/^[xyz]/.test(t)) {
      // Drehung: ab jetzt liegt jede Seite woanders
      const r = rotationFaceMap(t); // Seite an Position p liegt danach an r[p]
      map = Object.fromEntries(Object.entries(map).map(([f, g]) => [f, r[g]]));
      continue;
    }
    if (!/^[URFDLB]/.test(t) || /w/.test(t)) return null; // breite Züge hier nicht nachgebaut
    const face = t[0];
    const body = Object.keys(map).find((k) => map[k] === face);
    out.push(body + t.slice(1));
  }
  return out;
}
let tested = 0;
const holds = ['', 'z2', 'x y', "x' y2", 'z y'];
for (const [n, alg] of Object.entries(PLL_ALGS)) {
  for (const hold of holds) {
    for (const auf of ['', 'U']) {
      const moves = cubeReports(`${auf} ${alg}`, hold);
      if (!moves) continue;
      const d = new AlgDetector(CASE_STATE[`PLL ${n}`]);
      const hits = moves.map((m) => d.push(m));
      assert.ok(hits.at(-1), `PLL ${n} (Haltung "${hold}", AUF "${auf}") erkannt`);
      assert.ok(!hits.slice(0, -2).some(Boolean), `PLL ${n}: nicht zu früh erkannt`);
      tested++;
    }
  }
}
// Falscher Alg wird nicht erkannt
const d = new AlgDetector(CASE_STATE['PLL T']);
assert.ok(!"R U R' U' R U R' U'".split(' ').map((m) => d.push(m)).some(Boolean));
console.log(`detect: alle Tests bestanden (${tested} Ausführungen)`);
