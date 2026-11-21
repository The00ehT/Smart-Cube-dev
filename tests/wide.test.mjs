import assert from 'node:assert/strict';
import { mergeWide, markSlices, detectWide, wideCount } from '../src/cube/wide.js';

const mv = (text, t, i) => ({ kind: 'move', text, t, i });
const rot = (text, t) => ({ kind: 'rot', text, t });
const texts = (ev) => ev.filter((e) => !e.hide).map((e) => e.label ?? e.text).join(' ');

// r = L x (Drehung kurz vor oder nach dem Zug)
for (const [m, r, w] of [['L', 'x', 'r'], ["L'", "x'", "r'"], ['R', "x'", 'l'], ["R'", 'x', "l'"], ['D', 'y', 'u'], ["D'", "y'", "u'"], ['U', "y'", 'd'], ["U'", 'y', "d'"], ['B', 'z', 'f'], ["B'", "z'", "f'"], ['F', "z'", 'b'], ["F'", 'z', "b'"]]) {
  assert.equal(texts(mergeWide([mv(m, 1000, 0), rot(r, 1060)])), w, `${m} + ${r}`);
  assert.equal(texts(mergeWide([rot(r, 940), mv(m, 1000, 0)])), w, `${r} + ${m}`);
}
// Doppelzug: L L + x2 → r r (Anzeige fasst zu r2 zusammen)
assert.equal(texts(mergeWide([mv('L', 1000, 0), mv('L', 1080, 1), rot('x2', 1100)])), 'r r');
assert.equal(texts(mergeWide([mv('R', 1000, 0), mv('R', 1080, 1), rot('y2', 1100)])), 'R R y2', 'y2 passt nicht zu R → nichts zusammenfassen');
// Außerhalb des Zeitfensters oder falsche Seite: unverändert
assert.equal(texts(mergeWide([mv('L', 1000, 0), rot('x', 1600)])), 'L x');
assert.equal(texts(mergeWide([mv('R', 1000, 0), rot('x', 1050)])), 'R x', 'R + x ist keine Wide-Move');
assert.equal(texts(mergeWide([mv('U', 1000, 0), rot('y', 1050)])), 'U y');
// Mehrere Drehungen, nächster Zug wird gewählt, jeder Zug nur einmal
{
  const ev = mergeWide([mv('R', 0, 0), mv('L', 500, 1), rot('x', 520), mv('L', 900, 2), rot('x', 940)]);
  assert.equal(texts(ev), 'R r r');
  assert.equal(wideCount(ev), 2);
  assert.deepEqual(ev.filter((e) => e.wide).map((e) => e.i), [1, 2], 'Zugindex bleibt erhalten');
}
// Slices: R L' → M, gruppiert zu M2 durch gleiche Beschriftung
{
  const ev = markSlices([mv('U', 0, 0), mv('R', 500, 1), mv("L'", 520, 2), mv('F', 900, 3)]);
  assert.equal(texts(ev), 'U M F');
  assert.equal(ev[1].span, 1);
  assert.equal(ev[2].hide, true);
  assert.equal(texts(markSlices([mv("R'", 0, 0), mv('L', 50, 1)])), "M'");
  assert.equal(texts(markSlices([mv('U', 0, 0), mv("D'", 90, 1)])), 'E');
  assert.equal(texts(markSlices([mv("F'", 0, 0), mv('B', 90, 1)])), 'S');
  assert.equal(texts(markSlices([mv('R', 0, 0), mv("L'", 300, 1)])), "R L'", 'zu weit auseinander');
  assert.equal(texts(markSlices([mv('R', 0, 0), mv('L', 20, 1)])), 'R L', 'gleichsinnig = kein Slice');
}
// detectWide: ohne Gyro keine Wide-Merge, aber Slices
assert.equal(texts(detectWide([mv('L', 0, 0), rot('x', 30)], { gyro: false })), 'L x');
assert.equal(texts(detectWide([mv('L', 0, 0), rot('x', 30)], { gyro: true })), 'r');
// Original bleibt unverändert
{
  const src = [mv('L', 0, 0), rot('x', 30)];
  mergeWide(src);
  assert.equal(src.length, 2);
  assert.equal(src[0].text, 'L');
}
console.log('wide: ok');
