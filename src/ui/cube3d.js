/**
 * Eigener 3D-Würfel mit three.js – ohne externe Modelle, komplett aus Parametern gebaut.
 *
 * Aufbau: 26 Steine (abgerundete Körper) mit Farbflächen je Feld. Die Steine bleiben an ihrem Platz;
 * ein Zug wird als Drehung der Schicht animiert und danach werden die Farben neu gesetzt.
 * Lage: Gruppen-Quaternion (Gyro bzw. feste Ansicht), Koordinaten x → R, y → U, z → F.
 *
 * Skins: style 'classic' (Sticker mit Rand) | 'stickerless' (große Farbflächen) | 'tiles' (erhabene Fliesen),
 * body 'black' | 'white' | 'gray', scheme 'standard' | 'bright' | 'pastel', finish 'gloss' | 'matte'.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { STICKERS, SOLVED, applyMove, parseMove } from '../cube/facelets.js';

export const SCHEMES = {
  standard: { U: '#e9e9e9', D: '#ffd200', F: '#0fa04a', B: '#0b56d0', R: '#d81e2a', L: '#ff7300' },
  bright: { U: '#ececec', D: '#fff000', F: '#00d649', B: '#0a8cff', R: '#ff1b3a', L: '#ff8a00' },
  pastel: { U: '#eeeeee', D: '#ffe57a', F: '#86dda0', B: '#86bdfa', R: '#ff9191', L: '#ffbe82' },
};
const BODIES = { black: '#141518', white: '#d4d6da', gray: '#3a3d44' };
export const SKIN_PRESETS = {
  classic: { style: 'classic', body: 'black', scheme: 'standard', finish: 'gloss' },
  stickerless: { style: 'stickerless', body: 'black', scheme: 'bright', finish: 'gloss' },
  tiles: { style: 'tiles', body: 'black', scheme: 'bright', finish: 'matte' },
  white: { style: 'classic', body: 'white', scheme: 'standard', finish: 'gloss' },
  pastel: { style: 'stickerless', body: 'white', scheme: 'pastel', finish: 'matte' },
};
export let DEFAULT_SKIN = SKIN_PRESETS.stickerless;
/** Aussehen für alle neu erzeugten Würfel (z. B. aus den Einstellungen) */
export function setDefaultSkin(skin) {
  DEFAULT_SKIN = { ...SKIN_PRESETS.stickerless, ...skin };
}

const NORMALS = { U: [0, 1, 0], R: [1, 0, 0], F: [0, 0, 1], D: [0, -1, 0], L: [-1, 0, 0], B: [0, 0, -1] };
const key = (p) => p.join(',');

/** Abgerundetes Rechteck als Form (Mitte im Ursprung) */
function roundedRect(w, r) {
  const s = new THREE.Shape();
  const h = w / 2;
  s.moveTo(-h + r, -h);
  s.lineTo(h - r, -h);
  s.quadraticCurveTo(h, -h, h, -h + r);
  s.lineTo(h, h - r);
  s.quadraticCurveTo(h, h, h - r, h);
  s.lineTo(-h + r, h);
  s.quadraticCurveTo(-h, h, -h, h - r);
  s.lineTo(-h, -h + r);
  s.quadraticCurveTo(-h, -h, -h + r, -h);
  return s;
}

/** Geometrie einer Farbfläche je Stil (liegt in der xy-Ebene, zeigt nach +z) */
function stickerGeometry(style) {
  if (style === 'tiles') {
    const g = new THREE.ExtrudeGeometry(roundedRect(0.78, 0.14), { depth: 0.035, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 3, curveSegments: 6 });
    return g;
  }
  if (style === 'stickerless') return new THREE.ShapeGeometry(roundedRect(0.9, 0.16), 8);
  return new THREE.ShapeGeometry(roundedRect(0.82, 0.1), 6);
}

export class Cube3D {
  constructor(container, skin) {
    this.container = container;
    this.state = SOLVED;
    this.queue = [];
    this.anim = null;
    this.target = new THREE.Quaternion();
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Keine Filmkurve: Würfelfarben sollen satt bleiben
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.domElement.className = 'cube3d';
    container.append(this.renderer.domElement);

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    const key1 = new THREE.DirectionalLight(0xffffff, 1.25);
    key1.position.set(3, 5, 9);
    const fill = new THREE.DirectionalLight(0xffffff, 0.45);
    fill.position.set(-6, -2, 4);
    this.scene.add(key1, fill, new THREE.AmbientLight(0xffffff, 0.5));
    this.camera = new THREE.PerspectiveCamera(24, 1, 0.1, 100);
    this.camera.position.set(0, 0, 13.2);
    this.camera.lookAt(0, 0, 0);

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.setSkin(skin ?? DEFAULT_SKIN);

    this.resize = this.resize.bind(this);
    this.ro = new ResizeObserver(this.resize);
    this.ro.observe(container);
    this.resize();
    this.frame = this.frame.bind(this);
    this.dirty = true;
    requestAnimationFrame(this.frame);
  }

  /** Steine und Farbflächen (neu) aufbauen */
  setSkin(skin) {
    this.skin = { ...DEFAULT_SKIN, ...skin };
    const { style, body, scheme, finish } = this.skin;
    for (const c of [...this.root.children]) this.root.remove(c);
    const rough = finish === 'matte' ? 0.7 : 0.32;
    const bodyMat = new THREE.MeshStandardMaterial({ color: BODIES[body] ?? BODIES.black, roughness: finish === 'matte' ? 0.75 : 0.4, metalness: 0, envMapIntensity: 0.6 });
    const colors = SCHEMES[scheme] ?? SCHEMES.standard;
    this.mats = Object.fromEntries(Object.entries(colors).map(([f, c]) => [f, new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: 0, envMapIntensity: finish === 'matte' ? 0.15 : 0.35 })]));
    const bodyGeo = new RoundedBoxGeometry(0.97, 0.97, 0.97, 3, style === 'classic' ? 0.08 : 0.14);
    const stickerGeo = stickerGeometry(style);
    this.cubies = new Map(); // Position → Gruppe
    this.stickers = []; // Feldindex → Mesh
    STICKERS.forEach((s, i) => {
      const k = key(s.pos);
      let g = this.cubies.get(k);
      if (!g) {
        g = new THREE.Group();
        g.position.set(...s.pos);
        g.userData.pos = s.pos;
        g.add(new THREE.Mesh(bodyGeo, bodyMat));
        this.root.add(g);
        this.cubies.set(k, g);
      }
      const m = new THREE.Mesh(stickerGeo, this.mats[this.state[i]]);
      // Fläche auf die Außenseite des Steins legen
      const n = new THREE.Vector3(...s.normal);
      m.position.copy(n.clone().multiplyScalar(style === 'tiles' ? 0.47 : 0.487));
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      g.add(m);
      this.stickers[i] = m;
    });
    this.dirty = true;
  }

  /** Farben aus dem Zustand (Kociemba-Facelets) setzen */
  setState(facelets) {
    this.queue = [];
    if (this.anim) this.finishAnim(false);
    this.state = facelets;
    this.paint();
  }

  paint() {
    for (let i = 0; i < 54; i++) this.stickers[i].material = this.mats[this.state[i]];
    this.dirty = true;
  }

  /** Zug animieren (Vierteldrehungen; Doppelzüge werden als zwei Schritte gezeigt) */
  addMove(move) {
    const p = parseMove(move);
    if (!p) return;
    if (p.amount === 2) this.queue.push({ face: p.face, amount: 1 }, { face: p.face, amount: 1 });
    else this.queue.push(p);
    // Bei schnellen Zügen nicht hinterherhinken: laufende Animation abschließen
    if (this.anim && this.queue.length > 1) this.finishAnim(true);
    this.dirty = true;
  }

  startAnim(p) {
    const n = NORMALS[p.face];
    const pivot = new THREE.Group();
    this.root.add(pivot);
    for (const g of this.cubies.values()) {
      const d = g.userData.pos[0] * n[0] + g.userData.pos[1] * n[1] + g.userData.pos[2] * n[2];
      if (d === 1) pivot.attach(g);
    }
    const angle = (p.amount === 3 ? 1 : -1) * (Math.PI / 2); // im Uhrzeigersinn = −90° um die Normale
    this.anim = { p, pivot, axis: new THREE.Vector3(...n), angle, t0: performance.now(), dur: this.queue.length > 1 ? 60 : 110 };
  }

  finishAnim(commit = true) {
    const a = this.anim;
    if (!a) return;
    for (const g of [...a.pivot.children]) {
      this.root.attach(g);
      g.position.set(...g.userData.pos);
      g.quaternion.identity();
    }
    this.root.remove(a.pivot);
    this.anim = null;
    if (commit) {
      this.state = applyMove(this.state, a.p);
      this.paint();
    }
  }

  /** Ziel-Lage der ganzen Gruppe (wird weich angesteuert) */
  setOrientation(q) {
    this.target.set(q.x, q.y, q.z, q.w);
    this.dirty = true;
  }

  resize() {
    const w = this.container.clientWidth || 200;
    const h = this.container.clientHeight || w;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  frame(now) {
    if (this.disposed) return;
    if (!this.anim && this.queue.length) this.startAnim(this.queue.shift());
    if (this.anim) {
      const a = this.anim;
      const k = Math.min(1, (now - a.t0) / a.dur);
      const e = 1 - (1 - k) ** 3;
      a.pivot.quaternion.setFromAxisAngle(a.axis, a.angle * e);
      if (k >= 1) this.finishAnim(true);
      this.dirty = true;
    }
    if (this.root.quaternion.angleTo(this.target) > 0.002) {
      this.root.quaternion.slerp(this.target, 0.25);
      this.dirty = true;
    }
    if (this.dirty) {
      this.renderer.render(this.scene, this.camera);
      this.dirty = false;
    }
    requestAnimationFrame(this.frame);
  }

  dispose() {
    this.disposed = true;
    this.ro.disconnect();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
