import assert from 'node:assert/strict';
import { mirrorAlg, applyAnyAlg, SOLVED } from '../src/cube/facelets.js';
import { PLL_ALGS, identifyPll, stateForAlg } from '../src/cube/ll-cases.js';

assert.equal(mirrorAlg("R U R'"), "L' U' L");
// Spiegel-Paare unter den PLLs
const caseOf = (alg) => identifyPll(stateForAlg(alg));
assert.equal(caseOf(mirrorAlg(PLL_ALGS.Jb)), 'Ja');
assert.equal(caseOf(mirrorAlg(PLL_ALGS.Ja)), 'Jb');
assert.equal(caseOf(mirrorAlg(PLL_ALGS.Ra)), 'Rb');
assert.equal(caseOf(mirrorAlg(PLL_ALGS.T)), 'T');
assert.equal(caseOf(mirrorAlg(PLL_ALGS.Aa)), 'Ab');
assert.equal(caseOf(mirrorAlg(PLL_ALGS.Na)), 'Nb');
assert.equal(caseOf(mirrorAlg(PLL_ALGS.H)), 'H', 'M bleibt M');
assert.equal(caseOf(mirrorAlg(PLL_ALGS.E)), 'E', 'x bleibt x');
// Spiegeln zweimal = Original
for (const a of Object.values(PLL_ALGS)) assert.equal(mirrorAlg(mirrorAlg(a)), a.split(/\s+/).join(' '));
void applyAnyAlg; void SOLVED;
console.log('mirror: alle Tests bestanden');
