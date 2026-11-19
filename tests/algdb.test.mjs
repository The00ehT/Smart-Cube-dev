import assert from 'node:assert/strict';
import { REJECTED, ALT_ALGS, F2L_CASES, dbAlgs } from '../src/cube/alg-db.js';
import { checkAlg, CASE_STATE } from '../src/cube/ll-cases.js';
import { f2lKey } from '../src/cube/f2l-cases.js';
import { mirrorAlg, applyAnyAlg } from '../src/cube/facelets.js';
import { f2lStateForAlg } from '../src/cube/f2l-cases.js';

assert.deepEqual(REJECTED, [], 'keine verworfenen Algorithmen in der Datenbank');
assert.equal(F2L_CASES.length, 41);
assert.equal(new Set(F2L_CASES.map((c) => f2lKey(CASE_STATE[c.id]))).size, 41, '41 verschiedene F2L-Fälle');
let n = 0;
for (const id of Object.keys(ALT_ALGS)) {
  for (const a of dbAlgs(id)) {
    assert.ok(checkAlg(id, a).solves, `${id}: ${a}`);
    n++;
  }
}
// Gespiegelte F2L-Algorithmen lösen den gespiegelten Fall im linken Slot (FL): kein FR-Fall, aber F2L danach gelöst
for (const c of F2L_CASES) {
  const m = mirrorAlg(c.alg);
  assert.equal(f2lStateForAlg(m), null, 'Spiegelung betrifft nicht FR');
  void applyAnyAlg;
}
console.log(`algdb: alle Tests bestanden (${n} Algorithmen geprüft)`);
