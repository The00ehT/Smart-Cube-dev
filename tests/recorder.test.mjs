import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { SOLVED, applyAlg, applyMove, isSolved } from '../src/cube/facelets.js';
// solve-recorder importiert gan-web-bluetooth (ESM-Problem unter Node): über require bereitstellen
const require = createRequire(import.meta.url);
const gan = require('gan-web-bluetooth');
const { register } = await import('node:module');
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'gan-web-bluetooth') return { url: 'gan:x', shortCircuit: true };
  return next(spec, ctx);
}
export async function load(url, ctx, next) {
  if (url === 'gan:x') return { format: 'module', shortCircuit: true, source: 'export const cubeTimestampLinearFit = globalThis.__gan.cubeTimestampLinearFit;' };
  return next(url, ctx);
}`));
globalThis.__gan = gan;
const { SolveRecorder, moveTimes } = await import('../src/cube/solve-recorder.js');

// Scramble = Umkehrung einer "Lösung" aus Kreuz-/F2L-/OLL-/PLL-artigen Teilen
let state = applyAlg(SOLVED, "F R U R' U' F'"); // OLL-Fall (Kreuz und F2L intakt)
const rec = new SolveRecorder(state);
let t = 1000;
for (const m of "F U R U' R' F'".split(' ')) {
  state = applyMove(state, m);
  rec.push({ move: m, localTimestamp: (t += 200), cubeTimestamp: t * 1.01 });
}
assert.ok(isSolved(state));
const r = rec.finish();
assert.equal(r.moveCount, 6);
assert.ok(Math.abs(r.time - 1000) < 6, 'Zeit ≈ 1000 ms, ist ' + r.time);
assert.equal(r.phases.reduce((a, p) => a + p.moves, 0), 6, 'Zugzahlen summieren sich');
assert.ok(Math.abs(r.phases.reduce((a, p) => a + p.time, 0) - r.time) < 1, 'Phasenzeiten summieren sich');
assert.ok('URFDLB'.includes(r.crossFace));
assert.deepEqual(moveTimes([{ localTimestamp: 5 }, { localTimestamp: null }, { localTimestamp: 25 }]), [0, 0, 20]);
console.log('recorder: alle Tests bestanden', r.phases);
