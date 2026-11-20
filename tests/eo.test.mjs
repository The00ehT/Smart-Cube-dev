/**
 * EO beim letzten Paar und alle Vorschläge der Analyse gegen eine unabhängige Rechnung prüfen.
 *
 * Erzeugt zufällige, echte Solves: Kreuz, 4 Paare (Datenbank-Algs in zufälligen Slots mit AUF),
 * OLL, PLL – in zufälliger Kreuzfarbe und Haltung, als Züge am echten Würfel (Mitten bleiben fest).
 * Geprüft wird:
 *   1. „Kanten oben x/4“ nach deinem letzten Paar = direkt am Würfel gezählt (Seite gegenüber dem Kreuz)
 *   2. jeder EO-/OLL-Vorschlag: Alg in der angezeigten Haltung ausgeführt → F2L fertig und genau die
 *      angekündigte Kanten-Zahl und OLL
 *   3. jeder Vorausschau-Vorschlag: Alg in der angezeigten Haltung löst ein Paar, ohne Kreuz/andere Paare zu zerstören
 */
import assert from 'node:assert/strict';
import { SOLVED, FACES, applyAlg, applyAnyAlg, invertAlg, rotationFaceMap, CROSS_DOWN, solvedSlots, phaseStatus, tokenizeAlg } from '../src/cube/facelets.js';
import { relabelToCenters, recenter, f2lSolved, llOriented, identifyOll, OLL_ALGS, PLL_ALGS } from '../src/cube/ll-cases.js';
import { F2L_CASES, dbAlgs } from '../src/cube/alg-db.js';
import { solveInsights } from '../src/solve-insights.js';

let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const Y = ['', 'y', 'y2', "y'"];
const AUF = ['', 'U', 'U2', "U'"];
const plain = (alg) => tokenizeAlg(alg).every((t) => /^[URFDLB][2']?$/.test(t));
const OLLS = Object.values(OLL_ALGS).filter(plain);
const PLLS = Object.values(PLL_ALGS).filter(plain);
const F2LS = F2L_CASES.flatMap((c) => dbAlgs(c.id)).filter(plain);
const OPP = { U: 'D', D: 'U', R: 'L', L: 'R', F: 'B', B: 'F' };

/** Züge aus der Sicht „rot“ (z. B. Kreuz unten + y) in Züge am echten Würfel übersetzen */
function toPhysical(alg, rot) {
  if (!rot) return tokenizeAlg(alg);
  const map = rotationFaceMap(rot); // echt → Sicht
  const inv = Object.fromEntries(Object.entries(map).map(([a, b]) => [b, a]));
  return tokenizeAlg(alg).map((m) => inv[m[0]] + m.slice(1));
}
/** Paar-Alg für den Slot, der in der Haltung y^k vorne rechts liegt */
const inSlot = (alg, k) => toPhysical(alg, Y[k]).join(' ');

/** Kanten der Seite gegenüber dem Kreuz, die richtig orientiert sind – direkt am Würfel (Mitten fest) */
function eoPhysical(state, crossFace) {
  const f = FACES.indexOf(OPP[crossFace]) * 9;
  return [1, 3, 5, 7].filter((i) => state[f + i] === state[f + 4]).length;
}

let checkedEo = 0;
let checkedSug = 0;
let checkedLook = 0;
let pairsChecked = 0;
for (let n = 0; n < 150; n++) {
  const face = pick(FACES);
  const h = Math.floor(rnd() * 4);
  // Lösung in der Sicht „Kreuz unten“
  const parts = ['F2 R2 D'];
  for (let i = 0; i < 4; i++) parts.push(`${pick(AUF)} ${inSlot(pick(F2LS), Math.floor(rnd() * 4))}`.trim());
  parts.push(`${pick(AUF)} ${pick(OLLS)}`.trim(), `${pick(AUF)} ${pick(PLLS)} ${pick(AUF)}`.trim());
  const rot = `${CROSS_DOWN[face]} ${Y[h]}`.trim();
  const phys = toPhysical(parts.join(' '), rot).join(' ');
  const moves = phys.split(' ').filter(Boolean).flatMap((m) => (m.endsWith('2') ? [m[0], m[0]] : [m])); // Würfel meldet R2 als R R
  const start = applyAlg(SOLVED, invertAlg(phys));
  const solve = { start, solution: moves.join(' '), times: moves.map((_, i) => i * 120) };
  const r = solveInsights(solve);
  if (r.crossFace !== face) continue; // Kreuz einer anderen Farbe zuerst fertig – anderer Solve, egal
  const states = [start];
  for (const m of moves) states.push(applyAlg(states.at(-1), m));
  const last = r.pairs.filter((p) => !p.free).at(-1);
  if (!last?.eo) continue;
  const p4 = r.phases[last.k];
  const after = states[p4.end + 1];
  // 1. eigene Kanten
  assert.equal(last.eo.mine.eo, eoPhysical(after, face), `EO nach dem letzten Paar (Solve ${n})`);
  checkedEo++;
  // 2. Vorschläge nachrechnen
  const before = states[p4.start];
  for (const sug of [last.eo.better, last.eo.allEdges].filter(Boolean)) {
    const k = Y.findIndex((y) => applyAnyAlg(before, `${CROSS_DOWN[face]} ${y}`)[22] === sug.hold.front);
    const res = recenter(applyAnyAlg(relabelToCenters(applyAnyAlg(before, `${CROSS_DOWN[face]} ${Y[k]}`)), sug.alg));
    assert.ok(f2lSolved(res), `Vorschlag löst das letzte Paar (Solve ${n}: ${sug.alg})`);
    const eo = [1, 3, 5, 7].filter((i) => res[i] === res[4]).length;
    assert.equal(eo, sug.oll.eo, `angekündigte Kanten oben (Solve ${n}: ${sug.alg})`);
    if (!sug.oll.skip) assert.equal(identifyOll(res), sug.oll.n, `angekündigte OLL (Solve ${n})`);
    else assert.ok(llOriented(res));
    checkedSug++;
  }
  // Jeder Paar-Vorschlag besteht aus Seitenzügen (ggf. mit einer y-Drehung davor) und überlebt die Gegenprobe
  for (const p of r.pairs) {
    if (p.free) continue;
    assert.ok(p.best, `Paar ${p.k} hat einen Vorschlag (Solve ${n})`);
    if (p.best.stuck) continue;
    pairsChecked++;
    for (const a of [p.best.alg, p.lookahead?.alg, p.easier?.alg, last.eo.better?.alg, last.eo.allEdges?.alg].filter(Boolean))
      assert.ok(tokenizeAlg(a).every((t) => /^([URFDLB][2']?|y2?'?)$/.test(t)) && !/y.*y/.test(a.replace(/^y\S*/, '')), `nur Seitenzüge: ${a}`);
  }
  // 3. Vorausschau
  for (const p of r.pairs) {
    const a = p.lookahead;
    if (!a) continue;
    const b0 = states[r.phases[p.k].start];
    const k = Y.findIndex((y) => applyAnyAlg(b0, `${CROSS_DOWN[face]} ${y}`)[22] === a.hold.front);
    const v0 = relabelToCenters(applyAnyAlg(b0, `${CROSS_DOWN[face]} ${Y[k]}`));
    const res = recenter(applyAnyAlg(v0, a.alg));
    const m0 = solvedSlots(v0, 'D');
    const m1 = solvedSlots(res, 'D');
    assert.ok(phaseStatus(res).D.cross && (m1 & m0) === m0 && m1 !== m0, `Vorausschau löst ein Paar (Solve ${n}: ${a.alg})`);
    checkedLook++;
  }
}
assert.ok(checkedEo > 50, `genug Solves geprüft (${checkedEo})`);
console.log(`eo: ${checkedEo} Solves, ${pairsChecked} Paar-Vorschläge, ${checkedSug} EO-Vorschläge, ${checkedLook} Vorausschauen geprüft – alle Tests bestanden`);
