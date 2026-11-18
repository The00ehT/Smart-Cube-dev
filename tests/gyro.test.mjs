import assert from 'node:assert/strict';
import { ROT24, rotationQ, faceMapOf, analyzeGyro, viewerEvents, qmul, qnorm, fromGan } from '../src/cube/gyro.js';
import { rotationFaceMap } from '../src/cube/facelets.js';

assert.equal(ROT24.length, 24, '24 Würfellagen');
for (const r of ROT24) assert.deepEqual(faceMapOf(r.q), rotationFaceMap(r.name), `Lage ${r.name} passt zu rotationFaceMap`);

// Hilfen für simulierte Messungen
const axisQ = (ax, deg) => {
  const h = (deg * Math.PI) / 360;
  return { x: ax[0] * Math.sin(h), y: ax[1] * Math.sin(h), z: ax[2] * Math.sin(h), w: Math.cos(h) };
};
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
const noisy = (q, deg = 3) => qnorm(qmul(axisQ([rnd(), rnd(), rnd()].map((v, _, a) => v / Math.hypot(...a)), deg * 2 * rnd()), q));
// Unbekannter, fester Bezugsrahmen des Sensors
const G = qnorm({ x: 0.3, y: -0.5, z: 0.2, w: 0.8 });

/** Messungen alle 50 ms; Löser-Lage als Funktion der Zeit */
function simulate(viewerAt, until) {
  const out = [];
  for (let t = -200; t <= until; t += 50) out.push({ t, q: noisy(qmul(G, viewerAt(t))) });
  return out;
}

// Weißes Kreuz (Startlage z2), bei t = 500–650 eine y-Drehung, bei 1000–1400 ein Wackler um 20°
const V0 = rotationQ('z2');
const yQ = (deg) => axisQ([0, 1, 0], -deg);
const viewerAt = (t) => {
  let q = V0;
  if (t > 500) q = qmul(yQ(Math.min(90, ((t - 500) / 150) * 90)), q);
  if (t > 1050 && t < 1350) q = qmul(axisQ([1, 0, 0], 20), q);
  return q;
};
const times = [0, 100, 200, 300, 400, 700, 800, 900, 1000, 1400, 1500];
const moves = ['U', 'U', 'R', 'R', "F'", 'R', 'U', "R'", 'U', 'R', "R'"];
const g = analyzeGyro(simulate(viewerAt, 1600), times, 'z2');
assert.deepEqual(g.rotations.map((r) => r.name), ['y'], 'eine y-Drehung erkannt: ' + JSON.stringify(g.rotations));
assert.ok(g.rotations[0].t >= 500 && g.rotations[0].t <= 700, 'Zeit der Drehung');
assert.equal(g.regrips.length, 1, 'ein Griffwechsel: ' + JSON.stringify(g.regrips));
assert.ok(g.regrips[0] > 1000 && g.regrips[0] < 1400);

// Ohne Drehung und ohne Wackeln: nichts
const still = analyzeGyro(simulate(() => V0, 1600), times, 'z2');
assert.deepEqual(still, { v0: 'z2', rotations: [], regrips: [] });

// Züge aus Sicht des Lösers: vor der Drehung wie bei z2, danach zusätzlich y
const ev = viewerEvents(moves, times, g);
assert.deepEqual(ev.map((e) => e.text).slice(0, 5), ['D', 'D', 'L', 'L', "F'"], 'z2: U → D, R → L');
const ri = ev.findIndex((e) => e.kind === 'rot');
assert.equal(ri, 5, 'Drehung vor dem 6. Zug');
// Körper-R liegt nach z2 links (L), y dreht links nach hinten (B)
assert.equal(ev[6].text, 'B', 'R nach z2 y: links → hinten');
assert.equal(ev.filter((e) => e.kind === 'move').length, moves.length);

// GAN-Achsen: Weiß (+Z) zeigt nach oben (+y)
const q = fromGan({ x: 0, y: 0, z: 0, w: 1 });
assert.deepEqual([q.x, q.y, q.z, q.w], [0, 0, -0, 1]);
console.log('gyro: alle Tests bestanden', JSON.stringify(g));
