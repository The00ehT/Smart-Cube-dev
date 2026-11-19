/**
 * 3D-Würfel mit cubing.js (TwistyPlayer). Züge werden animiert angehängt,
 * ein kompletter Zustand wird über einen gelösten Weg dorthin dargestellt.
 * Bei GAN-Würfeln mit Gyroskop dreht sich die Darstellung mit dem echten Würfel.
 */
import { KPattern } from 'cubing/kpuzzle';
import { cube3x3x3 } from 'cubing/puzzles';
import { experimentalSolve3x3x3IgnoringCenters } from 'cubing/search';
import { SOLVED, faceletsToPatternData } from '../cube/facelets.js';
import { Cube3D } from './cube3d.js';

// --- kleine Quaternionen-Helfer (x, y, z, w) ---
const qmul = (a, b) => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});
const qconj = (q) => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
const qnorm = (q) => {
  const l = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l };
};
/** Euler-Winkel (Grad, Reihenfolge XYZ wie three.js) → Quaternion */
function qFromEuler(xd, yd, zd) {
  const [x, y, z] = [xd, yd, zd].map((d) => (d * Math.PI) / 360);
  const [c1, c2, c3, s1, s2, s3] = [Math.cos(x), Math.cos(y), Math.cos(z), Math.sin(x), Math.sin(y), Math.sin(z)];
  return {
    x: s1 * c2 * c3 + c1 * s2 * s3,
    y: c1 * s2 * c3 - s1 * c2 * s3,
    z: c1 * c2 * s3 + s1 * s2 * c3,
    w: c1 * c2 * c3 - s1 * s2 * s3,
  };
}

const HOME = qFromEuler(24, -32, 0); // schräger Blick von oben rechts

// Drehung der Ansicht, damit die Kreuzseite unten liegt (three.js: x → R, y → U, z → F)
const H = Math.SQRT1_2;
const CROSS_DOWN_Q = {
  D: { x: 0, y: 0, z: 0, w: 1 },
  U: { x: 0, y: 0, z: 1, w: 0 }, // z2
  F: { x: H, y: 0, z: 0, w: H }, // x' (+90° um x)
  B: { x: -H, y: 0, z: 0, w: H }, // x
  R: { x: 0, y: 0, z: -H, w: H }, // z
  L: { x: 0, y: 0, z: H, w: H }, // z'
};

/** Zugfolge, die vom gelösten Würfel zum Zustand führt (für Setups) */
export async function setupAlgFor(facelets) {
  if (facelets === SOLVED) return '';
  const kpuzzle = await cube3x3x3.kpuzzle();
  const pattern = new KPattern(kpuzzle, faceletsToPatternData(facelets));
  const solution = await experimentalSolve3x3x3IgnoringCenters(pattern);
  return solution.invert().toString();
}

export class CubeView {
  constructor(container, skin) {
    this.cube = new Cube3D(container, skin);
    this.basis = null;
    this.base = HOME; // Lage ohne Gyroskop (siehe setDownFace)
    this.gyroSeen = false;
    this.gyroEnabled = true;
    this.target = HOME;
  }

  /** Lage setzen (wird im Würfel weich angesteuert) */
  set target(q) {
    this._target = q;
    this.cube?.setOrientation(q);
  }
  get target() {
    return this._target;
  }

  addMove(move) {
    this.cube.addMove(move);
  }

  /** Zeigt einen vollständigen Zustand (Kociemba-Facelets) ohne Animation */
  setState(facelets) {
    this.cube.setState(facelets);
  }

  setSkin(skin) {
    this.cube.setSkin(skin);
  }

  /** Lage aus dem Gyroskop (GAN-Koordinaten: +X rot, +Y blau, +Z weiß) */
  setGyro(q) {
    if (!this.gyroEnabled) return;
    this.gyroSeen = true;
    // GAN → three.js: y und z tauschen (Vorzeichen wie in gan-cube-sample)
    const quat = qnorm({ x: q.x, y: q.z, z: -q.y, w: q.w });
    if (!this.basis) this.basis = qconj(quat);
    this.target = qmul(HOME, qmul(this.basis, quat));
  }

  /** Aktuelle Lage gilt ab jetzt als Grundstellung (weiß oben, grün vorne) */
  resetGyro() {
    this.basis = null;
    this.target = this.base;
  }

  setGyroEnabled(on) {
    this.gyroEnabled = on;
    if (!on) {
      this.target = this.base;
      this.basis = null;
      this.gyroSeen = false;
    }
  }

  /**
   * Feste Ansicht ohne Gyroskop: Seite `face` liegt unten (null = Standard, Weiß oben).
   * Liefert der Würfel Gyro-Daten, bestimmen diese die Lage.
   */
  setDownFace(face) {
    this.base = face ? qmul(HOME, CROSS_DOWN_Q[face]) : HOME;
    if (!this.gyroSeen) this.target = this.base;
  }

  /** Neue Verbindung: wieder auf Gyro-Daten warten */
  resetGyroSeen() {
    this.gyroSeen = false;
    this.basis = null;
    this.target = this.base;
  }
}
