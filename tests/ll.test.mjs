import assert from 'node:assert/strict';
import { OLL_ALGS, PLL_ALGS, OLL_CASES, PLL_CASES, CASE_STATE, f2lSolved, llOriented, identifyOll, identifyPll, caseProbabilities } from '../src/cube/ll-cases.js';
import { SOLVED, applyAnyAlg } from '../src/cube/facelets.js';

// Jeder Algorithmus lässt F2L intakt; PLL-Algorithmen lassen die Orientierung intakt
for (const [n, s] of Object.entries(CASE_STATE)) assert.ok(f2lSolved(s), `${n}: F2L intakt`);
for (const n of Object.keys(PLL_ALGS)) assert.ok(llOriented(CASE_STATE['PLL ' + n]), `PLL ${n} orientiert`);
// Alle Fälle verschieden
assert.equal(Object.keys(OLL_CASES).length, 57, 'OLL: 57 verschiedene Fälle');
assert.equal(Object.keys(PLL_CASES).length, 21, 'PLL: 21 verschiedene Fälle');
// Wiedererkennung inkl. AUF / Blickwinkel
for (const n of Object.keys(OLL_ALGS)) {
  for (const pre of ['', 'U', 'U2', "U'", 'y', "y' U"]) {
    const s = applyAnyAlg(CASE_STATE['OLL ' + n], pre);
    assert.equal(identifyOll(pre.includes('y') ? applyAnyAlg(s, pre.includes("y'") ? 'y' : "y'") : s), Number(n), `OLL ${n} mit ${pre}`);
  }
}
for (const n of Object.keys(PLL_ALGS)) {
  for (const pre of ['', 'U', 'U2', "U'"]) assert.equal(identifyPll(applyAnyAlg(CASE_STATE['PLL ' + n], pre)), n, `PLL ${n} mit ${pre}`);
}
assert.equal(identifyOll(SOLVED), 0);
assert.equal(identifyPll(applyAnyAlg(SOLVED, 'U')), 'Skip');
// Inverse Paare
const inv = (n) => identifyPll(applyAnyAlg(SOLVED, PLL_ALGS[n]));
assert.equal(inv('Aa'), 'Ab');
assert.equal(inv('Ua'), 'Ub');
assert.equal(inv('Ga'), 'Gb');
assert.equal(inv('Gc'), 'Gd');
assert.equal(inv('T'), 'T');
// Wahrscheinlichkeiten: Summe 1, bekannte Werte
const p = caseProbabilities();
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
assert.ok(Math.abs(sum(p.oll) - 1) < 1e-9, 'OLL-Summe ' + sum(p.oll));
assert.ok(Math.abs(sum(p.pll) - 1) < 1e-9, 'PLL-Summe ' + sum(p.pll));
assert.equal(Object.keys(p.oll).length, 58);
assert.equal(Object.keys(p.pll).length, 22);
assert.ok(Math.abs(p.pll.T - 1 / 18) < 1e-9, 'T 1/18: ' + p.pll.T);
assert.ok(Math.abs(p.pll.H - 1 / 72) < 1e-9, 'H 1/72');
assert.ok(Math.abs(p.pll.Skip - 1 / 72) < 1e-9, 'PLL-Skip 1/72');
assert.ok(Math.abs(p.oll[0] - 1 / 216) < 1e-9, 'OLL-Skip 1/216');
assert.ok(Math.abs(p.oll[21] - 1 / 108) < 1e-9, 'OLL 21 1/108');
assert.ok(Math.abs(p.oll[20] - 1 / 216) < 1e-9, 'OLL 20 1/216');
console.log('ll: alle Tests bestanden');

// Fall aus einem kompletten Solve: weißes Kreuz (oben im Würfel), PLL = T-Perm
import { analyzeSolve } from '../src/cube/analysis.js';
import { applyAlg, invertAlg } from '../src/cube/facelets.js';
{
  // Lösung mit Kreuz auf D (Gelb): letztes Paar + OLL 45 + T-Perm, in z2 gedreht → Kreuz auf U (Weiß)
  const z2 = { U: 'D', D: 'U', R: 'L', L: 'R', F: 'F', B: 'B' };
  const solD = "U R U' R' F R U R' U' F' R U R' U' R' F R2 U' R' U' R U R' F'";
  const sol = solD.split(' ').map((m) => z2[m[0]] + m.slice(1));
  const start = applyAlg(SOLVED, invertAlg(sol.join(' ')));
  const a = analyzeSolve(start, sol, sol.map((_, i) => i * 100));
  assert.equal(a.crossFace, 'U');
  assert.equal(a.ll.oll, 45, 'OLL 45 erkannt: ' + JSON.stringify(a.ll));
  assert.equal(a.ll.pll, 'T', 'T-Perm erkannt');
  console.log('ll aus Solve:', JSON.stringify(a.ll));
}

// checkAlg und Ziel-Zustand im Körpersystem
import { checkAlg, bodyCaseState, solvedUpToAuf, stateForAlg } from '../src/cube/ll-cases.js';
import { CROSS_DOWN } from '../src/cube/facelets.js';
assert.equal(checkAlg('PLL T', PLL_ALGS.T).solves, true);
assert.equal(checkAlg('PLL T', PLL_ALGS.Jb).solves, false);
assert.equal(checkAlg('PLL T', "R U X").ok, false);
assert.equal(checkAlg('OLL 27', "R U R' U R U2 R'").solves, true);
assert.equal(checkAlg('OLL 27', "(R U R' U) R U2 R'").solves, true, 'Klammern erlaubt');
for (const cf of ['U', 'D', 'F', 'R']) {
  for (const id of ['PLL T', 'PLL Ga', 'OLL 45']) {
    const body = bodyCaseState(CASE_STATE[id], cf);
    // Was der Löser sieht (Kreuz unten): derselbe Fall
    const viewer = applyAnyAlg(body, CROSS_DOWN[cf]);
    if (id.startsWith('PLL')) assert.equal(identifyPll(viewer), id.slice(4), `${id} bei Kreuz ${cf}`);
    else assert.equal(identifyOll(viewer), 45, `${id} bei Kreuz ${cf}`);
    // Sein Algorithmus (in seiner Sicht) löst es
    const alg = id.startsWith('PLL') ? PLL_ALGS[id.slice(4)] : OLL_ALGS[45];
    const after = applyAnyAlg(viewer, 'U'); // AUF davor ist egal → prüfen für alle 4
    const ok = ['', 'U', 'U2', "U'"].some((a) => {
      const v = applyAnyAlg(applyAnyAlg(viewer, a), alg);
      return id.startsWith('PLL') ? solvedUpToAuf(v) : llOriented(v);
    });
    void after;
    assert.ok(ok, `${id} lösbar bei Kreuz ${cf}`);
  }
}
assert.equal(identifyPll(stateForAlg(PLL_ALGS.Y)), 'Y');
console.log('checkAlg/bodyCaseState: ok');
