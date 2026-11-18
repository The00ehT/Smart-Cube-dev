import assert from 'node:assert/strict';
import { cube3x3x3 } from 'cubing/puzzles';
import { createRequire } from 'node:module';
const { toKociembaFacelets } = createRequire(import.meta.url)('gan-web-bluetooth');
import { SOLVED, applyAlg, faceletsToPatternData, patternDataToFacelets, phaseStatus, isSolved } from '../src/cube/facelets.js';

const kpuzzle = await cube3x3x3.kpuzzle();
const faces = 'URFDLB';
const rand = (n) => Array.from({ length: n }, () => faces[Math.floor(Math.random() * 6)] + ['', "'", '2'][Math.floor(Math.random() * 3)]).join(' ');

// Bekannter Referenzwert aus gan-web-bluetooth: Zustand nach "F R"
const fr = toKociembaFacelets([0, 5, 2, 1, 7, 4, 6, 3], [1, 2, 0, 2, 1, 1, 0, 2], [1, 9, 2, 3, 11, 8, 6, 7, 4, 5, 10, 0], [1, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0]);
assert.equal(applyAlg(SOLVED, 'F R'), fr, 'F R stimmt mit gan-web-bluetooth überein');

// Ordnung der Züge
for (const m of 'URFDLB') assert.equal(applyAlg(SOLVED, `${m} ${m} ${m} ${m}`), SOLVED);
assert.equal(applyAlg(SOLVED, "R U R' U' ".repeat(6)), SOLVED, 'Sexy move hat Ordnung 6');

// Rundreise und Übereinstimmung mit cubing.js
for (let t = 0; t < 300; t++) {
  const alg = rand(25);
  const mine = applyAlg(SOLVED, alg);
  const pd = kpuzzle.defaultPattern().applyAlg(alg).patternData;
  assert.equal(patternDataToFacelets(pd), mine, 'cubing → Facelets: ' + alg);
  const back = faceletsToPatternData(mine);
  assert.deepEqual(back.EDGES, { pieces: [...pd.EDGES.pieces], orientation: [...pd.EDGES.orientation] }, 'Kanten: ' + alg);
  assert.deepEqual(back.CORNERS, { pieces: [...pd.CORNERS.pieces], orientation: [...pd.CORNERS.orientation] }, 'Ecken: ' + alg);
}

// Phasen
assert.ok(isSolved(SOLVED));
const ps = phaseStatus(applyAlg(SOLVED, "R U R' U'"));
assert.equal(ps.D.cross, true); assert.equal(ps.D.f2l, false);
const oll = phaseStatus(applyAlg(SOLVED, "R U R' U R U2 R' U2")); // nur U-Schicht verändert
assert.equal(oll.D.f2l, true);
const pll = phaseStatus(applyAlg(SOLVED, "R U R' U' R' F R2 U' R' U' R U R' F'")); // T-Perm
assert.equal(pll.D.oll, true);
assert.ok(!isSolved(applyAlg(SOLVED, "R U R' U' R' F R2 U' R' U' R U R' F'")));
console.log('facelets: alle Tests bestanden');
