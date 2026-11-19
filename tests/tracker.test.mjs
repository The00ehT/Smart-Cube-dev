import assert from 'node:assert/strict';
import { ScrambleTracker } from '../src/cube/scramble-tracker.js';
import { SOLVED, applyAlg } from '../src/cube/facelets.js';
import { averageOf, formatTime, DNF } from '../src/stats.js';

const quarters = (alg) => alg.split(' ').flatMap((m) => m.endsWith('2') ? [m[0], m[0]] : [m]);

// Korrekt ausgeführt (R2 als zwei Vierteldrehungen)
let t = new ScrambleTracker("R2 U F' L2");
for (const m of quarters("R2 U F' L2")) t.push(m);
assert.ok(t.done);

// R2 gegen den Uhrzeigersinn gedreht
t = new ScrambleTracker('R2 U');
t.push("R'"); t.push("R'"); t.push('U');
assert.ok(t.done);

// Falscher Zug wird korrigiert
t = new ScrambleTracker('R U');
t.push('R'); t.push('F');
assert.deepEqual(t.remainingMoves(), [{ text: "F'", correction: true }, { text: 'U', correction: false }]);
t.push("F'"); t.push('U');
assert.ok(t.done);

// Falsche Richtung: R' statt R → noch R2 nötig
t = new ScrambleTracker('R U');
t.push("R'");
assert.equal(t.remainingMoves()[0].text, 'R2');

// Neu berechneter Rest ersetzt Korrekturen
t = new ScrambleTracker("R U F");
t.push('R'); t.push('D'); t.push('B');
assert.equal(t.corrections, 2);
assert.ok(t.replace("B' D' U F"));
assert.equal(t.corrections, 0);
assert.deepEqual(t.remainingMoves().map((m) => m.text), ["B'", "D'", 'U', 'F']);
assert.ok(!t.replace('Q'), 'ungültige Züge werden abgelehnt');

// Parallelzüge vertauscht
t = new ScrambleTracker('R L U');
t.push('L'); t.push('R'); t.push('U');
assert.ok(t.done);

// Zufällige Fehlerfolgen: wer der Anzeige folgt, landet immer im Zielzustand
const faces = 'URFDLB';
for (let k = 0; k < 500; k++) {
  const scr = Array.from({ length: 20 }, () => faces[Math.floor(Math.random() * 6)] + ['', "'", '2'][Math.floor(Math.random() * 3)]).join(' ');
  const goal = applyAlg(SOLVED, scr);
  let state = SOLVED;
  t = new ScrambleTracker(scr);
  let guard = 0;
  while (!t.done && guard++ < 500) {
    let m;
    if (Math.random() < 0.15) m = faces[Math.floor(Math.random() * 6)] + (Math.random() < 0.5 ? "'" : '');
    else { const n = t.remainingMoves()[0].text; m = n.endsWith('2') ? n[0] : n; }
    state = applyAlg(state, m);
    t.push(m);
  }
  assert.ok(t.done, 'Tracker endet');
  assert.equal(state, goal, 'Zielzustand erreicht: ' + scr);
}

assert.equal(averageOf([{ time: 1000 }, { time: 2000 }, { time: 3000 }, { time: 4000 }, { time: 9000 }], 5), 3000);
assert.equal(averageOf([{ time: 1000 }, { time: 2000, penalty: 'DNF' }, { time: 3000 }, { time: 4000 }, { time: 9000, penalty: 'DNF' }], 5), DNF);
assert.equal(formatTime(83456), '1:23.45');
console.log('tracker/stats: alle Tests bestanden');
