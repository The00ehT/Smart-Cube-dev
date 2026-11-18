/**
 * Würfeldrehungen (x, y, z) und Griffwechsel aus den Gyroskop-Daten eines Solves.
 *
 * Koordinaten wie im Sticker-Modell: x → R, y → U, z → F.
 * GAN liefert die Lage als Quaternion mit +X = Rot (R), +Y = Blau (B), +Z = Weiß (U);
 * umgerechnet wird mit (x, y, z, w) → (x, z, −y, w).
 *
 * Idee: Die Lage relativ zum Solve-Start (im Körpersystem des Würfels) wird auf die nächste der
 * 24 Würfellagen gerundet. Wechselt die gerundete Lage stabil, war das eine Würfeldrehung.
 * Kleine Wackler in einer Pause zwischen zwei Zügen zählen als (geschätzter) Griffwechsel.
 */
import { FACES } from './facelets.js';

// ---------- Quaternionen ----------
export const qmul = (a, b) => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});
export const qconj = (q) => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
export const qnorm = (q) => {
  const l = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l };
};
/** Winkel zwischen zwei Lagen in Grad */
export const qangle = (a, b) => {
  const d = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
  return (2 * Math.acos(Math.min(1, d)) * 180) / Math.PI;
};
function qrotate(q, v) {
  const p = qmul(qmul(q, { x: v[0], y: v[1], z: v[2], w: 0 }), qconj(q));
  return [p.x, p.y, p.z];
}
const qaxis = (axis, deg) => {
  const h = (deg * Math.PI) / 360;
  const s = Math.sin(h);
  return { x: axis[0] * s, y: axis[1] * s, z: axis[2] * s, w: Math.cos(h) };
};

/** GAN-Quaternion → Koordinaten des Sticker-Modells */
export const fromGan = (q) => qnorm({ x: q.x, y: q.z, z: -q.y, w: q.w });

// ---------- Die 24 Würfellagen mit Namen ----------
const AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
// Im Uhrzeigersinn wie R, U, F = −90° um die Achse
const TOKEN_Q = {};
for (const a of 'xyz') {
  TOKEN_Q[a] = qaxis(AXES[a], -90);
  TOKEN_Q[a + '2'] = qaxis(AXES[a], 180);
  TOKEN_Q[a + "'"] = qaxis(AXES[a], 90);
}
/** Quaternion einer Drehfolge wie "x y'" (nacheinander um feste Achsen) */
export function rotationQ(alg) {
  let q = { x: 0, y: 0, z: 0, w: 1 };
  for (const t of alg.split(/\s+/).filter(Boolean)) q = qmul(TOKEN_Q[t], q);
  return q;
}
const tokens = Object.keys(TOKEN_Q);
const cands = [''];
for (const a of tokens) cands.push(a);
for (const a of tokens) for (const b of tokens) if (a[0] !== b[0]) cands.push(`${a} ${b}`);
/** 24 Lagen: kürzester Name, Quaternion (Vorzeichen egal) */
export const ROT24 = [];
for (const name of cands) {
  const q = rotationQ(name);
  if (!ROT24.some((r) => qangle(r.q, q) < 1)) ROT24.push({ name, q });
}

function nearest(q) {
  let best = 0;
  let ang = Infinity;
  ROT24.forEach((r, i) => {
    const a = qangle(r.q, q);
    if (a < ang) {
      ang = a;
      best = i;
    }
  });
  return { i: best, angle: ang };
}
/** Name der Lage, die q am nächsten ist */
export const rotationName = (q) => ROT24[nearest(q).i].name;

/** Seitenzuordnung einer Lage: map[f] = Seite, auf der die Körperseite f zu sehen ist */
const NORMALS = { U: [0, 1, 0], R: [1, 0, 0], F: [0, 0, 1], D: [0, -1, 0], L: [-1, 0, 0], B: [0, 0, -1] };
export function faceMapOf(q) {
  const map = {};
  for (const f of FACES) {
    const v = qrotate(q, NORMALS[f]).map(Math.round);
    map[f] = FACES.find((g) => NORMALS[g].every((x, k) => x === v[k]));
  }
  return map;
}

// ---------- Auswertung ----------
const SNAP_DEG = 35; // so nah muss die Lage an einer Würfellage sein
const STABLE_MS = 90; // so lange muss eine neue Lage halten
const REGRIP_MIN_DEG = 12; // Wackeln ab hier zählt als Griffwechsel …
const REGRIP_GAP_MS = 180; // … in Pausen ab dieser Länge

/**
 * @param samples  [{ t (ms relativ zum ersten Zug), q (Sticker-Koordinaten) }], zeitlich sortiert
 * @param times    Zeiten der Züge (ms, erster Zug = 0)
 * @param v0       Startlage in der Rekonstruktion als Drehfolge (z. B. "z2" für Kreuz oben → unten)
 * @returns { v0, rotations: [{ t, name }], regrips: [t] } – Namen aus Sicht des Lösers
 */
export function analyzeGyro(samples, times, v0 = '') {
  const out = { v0, rotations: [], regrips: [] };
  if (!samples?.length || !times?.length) return out;
  // Startlage: letzte Messung vor dem ersten Zug, sonst die erste danach
  let i0 = 0;
  for (let i = 0; i < samples.length; i++) if (samples[i].t <= 0) i0 = i;
  const q0inv = qconj(samples[i0].q);
  const V0 = rotationQ(v0);
  const V0inv = qconj(V0);

  // Gerundete Lage je Messung (im Körpersystem des Starts)
  const snapped = samples.map((s) => {
    const d = qmul(q0inv, s.q);
    const n = nearest(d);
    return { t: s.t, d, i: n.angle <= SNAP_DEG ? n.i : -1 };
  });
  const identity = ROT24.findIndex((r) => r.name === '');
  let state = identity;
  let cand = -1;
  let candStart = 0;
  let leftAt = null; // Zeitpunkt, an dem die alte Lage verlassen wurde
  const stateTimes = []; // [{ from, to, state }] für die Griffwechsel
  let stateFrom = -Infinity;
  for (let k = i0; k < snapped.length; k++) {
    const s = snapped[k];
    if (s.i === state) {
      cand = -1;
      leftAt = null;
      continue;
    }
    if (leftAt === null) leftAt = s.t;
    if (s.i === -1) {
      cand = -1;
      continue;
    }
    if (s.i !== cand) {
      cand = s.i;
      candStart = s.t;
    }
    const next = snapped[k + 1];
    if (s.t - candStart >= STABLE_MS || (next && next.i === cand && next.t - candStart >= STABLE_MS) || !next) {
      // Drehung im Startsystem: neu = R · alt  →  R = neu · alt⁻¹; aus Sicht des Lösers: V0 · R · V0⁻¹
      const Rb = qmul(ROT24[cand].q, qconj(ROT24[state].q));
      const Rv = qmul(qmul(V0, Rb), V0inv);
      const name = rotationName(Rv);
      if (name) out.rotations.push({ t: Math.max(0, Math.round(leftAt ?? candStart)), name });
      stateTimes.push({ from: stateFrom, to: leftAt ?? candStart, state });
      stateFrom = candStart;
      state = cand;
      cand = -1;
      leftAt = null;
    }
  }
  stateTimes.push({ from: stateFrom, to: Infinity, state });

  // Griffwechsel: Pause zwischen zwei Zügen ohne Drehung, aber mit deutlichem Wackeln
  for (let m = 1; m < times.length; m++) {
    const a = times[m - 1];
    const b = times[m];
    if (b - a < REGRIP_GAP_MS) continue;
    if (out.rotations.some((r) => r.t >= a && r.t <= b)) continue;
    const ref = stateTimes.find((st) => a >= st.from && a < st.to);
    if (!ref) continue;
    const refQ = ROT24[ref.state].q;
    let maxAng = 0;
    for (const s of snapped) if (s.t > a && s.t < b) maxAng = Math.max(maxAng, qangle(s.d, refQ));
    if (maxAng >= REGRIP_MIN_DEG && maxAng < SNAP_DEG + 10) out.regrips.push(Math.round((a + b) / 2));
  }
  return out;
}

/**
 * Lösungsfolge aus Sicht des Lösers: Züge (Körperseiten) und Drehungen zeitlich gemischt.
 * @returns [{ kind: 'move'|'rot', text, t, i? (Zugindex) }]
 */
export function viewerEvents(moves, times, gyro) {
  let W = rotationQ(gyro?.v0 || '');
  let map = faceMapOf(W);
  const rots = [...(gyro?.rotations || [])].sort((a, b) => a.t - b.t);
  const ev = [];
  let r = 0;
  for (let i = 0; i < moves.length; i++) {
    while (r < rots.length && rots[r].t <= times[i]) {
      const rot = rots[r++];
      ev.push({ kind: 'rot', text: rot.name, t: Math.min(rot.t, times[i]) });
      W = qmul(rotationQ(rot.name), W);
      map = faceMapOf(W);
    }
    ev.push({ kind: 'move', text: map[moves[i][0]] + moves[i].slice(1), t: times[i], i });
  }
  // Drehungen nach dem letzten Zug sind für die Lösung belanglos
  return ev;
}
