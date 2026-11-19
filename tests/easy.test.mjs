import assert from 'node:assert/strict';
import { easyState, isValidPattern } from '../src/cube/easy-scramble.js';
import { SOLVED, applyAlg, faceletsToPatternData, phaseStatus, solvedSlots, F2L_SLOTS, STICKERS } from '../src/cube/facelets.js';

let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const M = ['U', 'R', 'F', 'D', 'L', 'B'];
const randomState = () => {
  let a = [];
  for (let i = 0; i < 30; i++) a.push(M[Math.floor(rnd() * 6)] + ['', "'", '2'][Math.floor(rnd() * 3)]);
  return applyAlg(SOLVED, a.join(' '));
};
// Gelöste Kreuzkanten einer Seite zählen
const crossEdgesSolved = (s, f) => {
  const n = { U: [0, 1, 0], D: [0, -1, 0], R: [1, 0, 0], L: [-1, 0, 0], F: [0, 0, 1], B: [0, 0, -1] }[f];
  const groups = {};
  STICKERS.forEach((st, i) => {
    const p = st.pos;
    if (p.filter((x) => x).length === 2 && p[0] * n[0] + p[1] * n[1] + p[2] * n[2] === 1) (groups[p.join()] ??= []).push(i);
  });
  return Object.values(groups).filter((g) => g.every((i) => s[i] === STICKERS[i].face)).length;
};
for (let k = 0; k < 300; k++) {
  const face = M[k % 6];
  const level = k % 2 ? 'xcross' : 'cross2';
  const s = easyState(randomState(), face, level, rnd);
  assert.ok(isValidPattern(faceletsToPatternData(s)), 'gültig');
  assert.ok(crossEdgesSolved(s, face) >= 2, `mind. 2 Kreuzkanten (${face}, ${level})`);
  if (level === 'xcross') assert.ok(solvedSlots(s, face) > 0, 'ein Slot gelöst');
}
console.log('easy: alle Tests bestanden');

// relativeState: von C mit X nach T ⇒ relativeState(C, T) = X auf gelöst
import { relativeState } from '../src/cube/facelets.js';
for (let k = 0; k < 100; k++) {
  const C = randomState();
  const X = [];
  for (let i = 0; i < 12; i++) X.push(M[Math.floor(rnd() * 6)] + ['', "'", '2'][Math.floor(rnd() * 3)]);
  const T = applyAlg(C, X.join(' '));
  assert.equal(relativeState(C, T), applyAlg(SOLVED, X.join(' ')), 'relativeState');
}
console.log('relativeState: ok');
