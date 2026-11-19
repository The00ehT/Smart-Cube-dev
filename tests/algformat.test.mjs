import assert from 'node:assert/strict';
import { groupAlg } from '../src/cube/alg-format.js';

assert.equal(groupAlg("R U R' U' R' F R F'"), "(R U R' U') (R' F R F')");
assert.equal(groupAlg("R U R' U R U2 R'"), "(R U R') U (R U2 R')");
assert.equal(groupAlg("F R U R' U' F'"), "F (R U R' U') F'");
assert.equal(groupAlg("y R U' R'"), "y (R U' R')");
assert.equal(groupAlg("R2 U R2"), 'R2 U R2', 'Halbe Drehung außen bleibt ungruppiert');
assert.equal(groupAlg("(R U R') U"), "(R U R') U", 'eigene Klammern bleiben');
assert.equal(groupAlg("r U R' U' r' F R F'"), "(r U R' U') (r' F R F')");
assert.equal(groupAlg("U R U' R'"), "U (R U' R')", 'U-Anpassungen öffnen keine Gruppe');
assert.equal(groupAlg(''), '');
console.log('algformat: alle Tests bestanden');
