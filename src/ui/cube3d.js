/**
 * Eigener 3D-Würfel mit three.js – ohne externe Modelle, komplett aus Parametern gebaut.
 *
 * Aufbau: 26 Steine (Körper) mit je einer Farbfläche pro Feld. Die Steine bleiben an ihrem Platz;
 * ein Zug wird als Drehung der Schicht animiert und danach wird neu „bemalt“.
 * Lage: Gruppen-Quaternion (Gyro bzw. feste Ansicht), Koordinaten x → R, y → U, z → F.
 *
 * Aussehen (Skin):
 *   style   'gan' (spitze Würfelecken, runde Innenecken) | 'stickerless' | 'classic' | 'tiles'
 *   body    'black' | 'gray' | 'white'
 *   scheme  'bright' | 'standard' | 'pastel'        (Farben)
 *   finish  'gloss' | 'matte'
 *   theme   'colors' | 'cow' | 'neon' | 'galaxy' | 'pcb' | 'custom'   (Design; Bilder werden wie bei einem
 *           Bilderwürfel zerteilt und wandern samt Drehung mit ihrem Stein)
 *   images  { U: dataUrl, … } für 'custom', logo: dataUrl fürs weiße Mittelstück
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { STICKERS, SOLVED, FACES, applyMove, parseMove, homeOf, PIECE_STICKERS, FACE_FRAME } from '../cube/facelets.js';
import { faceImages } from './skin-textures.js';

export const SCHEMES = {
  standard: { U: '#e9e9e9', D: '#ffd200', F: '#0fa04a', B: '#0b56d0', R: '#d81e2a', L: '#ff7300' },
  bright: { U: '#ececec', D: '#fff000', F: '#00d649', B: '#0a8cff', R: '#ff1b3a', L: '#ff8a00' },
  pastel: { U: '#eeeeee', D: '#ffe57a', F: '#86dda0', B: '#86bdfa', R: '#ff9191', L: '#ffbe82' },
};
const BODIES = { black: '#121316', white: '#d4d6da', gray: '#3a3d44' };
export const SKIN_PRESETS = {
  gan: { style: 'gan', body: 'black', scheme: 'bright', finish: 'gloss', theme: 'colors' },
  classic: { style: 'classic', body: 'black', scheme: 'standard', finish: 'gloss', theme: 'colors' },
  tiles: { style: 'tiles', body: 'black', scheme: 'bright', finish: 'matte', theme: 'colors' },
  pastel: { style: 'stickerless', body: 'white', scheme: 'pastel', finish: 'matte', theme: 'colors' },
  neon: { style: 'gan', body: 'black', scheme: 'bright', finish: 'gloss', theme: 'neon' },
  galaxy: { style: 'gan', body: 'black', scheme: 'bright', finish: 'gloss', theme: 'galaxy' },
  cow: { style: 'gan', body: 'black', scheme: 'bright', finish: 'matte', theme: 'cow' },
  pcb: { style: 'gan', body: 'black', scheme: 'bright', finish: 'gloss', theme: 'pcb' },
};
export let DEFAULT_SKIN = SKIN_PRESETS.gan;
/** Aussehen für alle neu erzeugten Würfel (z. B. aus den Einstellungen) */
export function setDefaultSkin(skin) {
  DEFAULT_SKIN = { ...SKIN_PRESETS.gan, ...skin };
}

// Geometrie je Stil: Körper-Rundung, Größe der Farbfläche, Rundungen innen/Kante/Würfelecke, Dicke, Abstand
const STYLES = {
  gan: { bodyR: 0.035, size: 0.95, rIn: 0.2, rEdge: 0.1, rCorner: 0.025, depth: 0.012, off: 0.489 },
  stickerless: { bodyR: 0.14, size: 0.9, rIn: 0.16, rEdge: 0.16, rCorner: 0.16, depth: 0, off: 0.487 },
  classic: { bodyR: 0.08, size: 0.82, rIn: 0.1, rEdge: 0.1, rCorner: 0.1, depth: 0, off: 0.487 },
  tiles: { bodyR: 0.14, size: 0.78, rIn: 0.14, rEdge: 0.14, rCorner: 0.14, depth: 0.035, off: 0.47 },
};

const NORMALS = { U: [0, 1, 0], R: [1, 0, 0], F: [0, 0, 1], D: [0, -1, 0], L: [-1, 0, 0], B: [0, 0, -1] };
const key = (p) => p.join(',');
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const eq = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const neg = (a) => a.map((v) => -v);
const faceOf = (i) => FACES[Math.floor(i / 9)];

/** Rechteck mit eigener Rundung je Ecke (unten links, unten rechts, oben rechts, oben links) */
function roundedRect4(w, [r0, r1, r2, r3]) {
  const h = w / 2;
  const s = new THREE.Shape();
  s.moveTo(-h + r0, -h);
  s.lineTo(h - r1, -h);
  s.quadraticCurveTo(h, -h, h, -h + r1);
  s.lineTo(h, h - r2);
  s.quadraticCurveTo(h, h, h - r2, h);
  s.lineTo(-h + r3, h);
  s.quadraticCurveTo(-h, h, -h, h - r3);
  s.lineTo(-h, -h + r0);
  s.quadraticCurveTo(-h, -h, -h + r0, -h);
  return s;
}

export class Cube3D {
  constructor(container, skin) {
    this.container = container;
    this.state = SOLVED;
    this.centerTurns = Object.fromEntries(FACES.map((f) => [f, 0]));
    this.queue = [];
    this.anim = null;
    this.target = new THREE.Quaternion();
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping; // Würfelfarben sollen satt bleiben
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
    this.skin = { ...SKIN_PRESETS.gan, ...skin };
    const { body, scheme, finish, theme } = this.skin;
    const st = STYLES[this.skin.style] ?? STYLES.gan;
    this.finishAnim(true);
    for (const c of [...this.root.children]) this.root.remove(c);
    const rough = finish === 'matte' ? 0.7 : 0.32;
    const bodyMat = new THREE.MeshStandardMaterial({ color: BODIES[body] ?? BODIES.black, roughness: finish === 'matte' ? 0.75 : 0.4, metalness: 0, envMapIntensity: 0.6 });
    this.colors = SCHEMES[scheme] ?? SCHEMES.bright;
    this.mats = Object.fromEntries(Object.entries(this.colors).map(([f, c]) => [f, new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: 0, envMapIntensity: finish === 'matte' ? 0.15 : 0.35 })]));
    const bodyGeo = new RoundedBoxGeometry(0.98, 0.98, 0.98, 3, st.bodyR);
    const geoCache = new Map();
    const capGeo = (radii) => {
      const k = radii.join('|');
      if (!geoCache.has(k)) {
        const shape = roundedRect4(st.size, radii);
        const geo = st.depth
          ? new THREE.ExtrudeGeometry(shape, { depth: st.depth, bevelEnabled: true, bevelThickness: st.depth * 0.8, bevelSize: Math.min(0.02, st.depth), bevelSegments: 3, curveSegments: 8 })
          : new THREE.ShapeGeometry(shape, 8);
        // Bildkoordinaten einheitlich = lokale x/y-Position (Bildausschnitte siehe paint())
        const pos = geo.attributes.position;
        const uv = new Float32Array(pos.count * 2);
        for (let v = 0; v < pos.count; v++) {
          uv[v * 2] = pos.getX(v);
          uv[v * 2 + 1] = pos.getY(v);
        }
        geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        geoCache.set(k, geo);
      }
      return geoCache.get(k);
    };
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
      // Lokales System der Fläche: x = rechts, y = oben (von außen gesehen), z = Normale
      const { right, up } = FACE_FRAME[faceOf(i)];
      // Rundung je Ecke: an der Würfelecke spitz, an der Würfelkante mittel, innen rund
      const corner = (sx, sy) => {
        const ox = dot(s.pos, right) * sx === 1;
        const oy = dot(s.pos, up) * sy === 1;
        return ox && oy ? st.rCorner : ox || oy ? st.rEdge : st.rIn;
      };
      const radii = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
      const m = new THREE.Mesh(capGeo(radii), this.mats[this.state[i]]);
      const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(...right), new THREE.Vector3(...up), new THREE.Vector3(...s.normal));
      m.quaternion.setFromRotationMatrix(basis);
      m.position.copy(new THREE.Vector3(...s.normal).multiplyScalar(st.off));
      g.add(m);
      this.stickers[i] = m;
    });
    // Design mit Bildern: Texturen asynchron erzeugen, dann neu bemalen
    this.faceTex = null;
    this.stickerTex = [];
    const token = (this.skinToken = (this.skinToken || 0) + 1);
    if (theme && theme !== 'colors' || this.skin.logo) {
      faceImages(theme || 'colors', this.colors, { images: this.skin.images, logo: this.skin.logo }).then((imgs) => {
        if (token !== this.skinToken || this.disposed) return;
        this.faceTex = {};
        for (const f of FACES) {
          const t = new THREE.CanvasTexture(imgs[f]);
          t.colorSpace = THREE.SRGBColorSpace;
          t.anisotropy = 4;
          this.faceTex[f] = t;
        }
        const Mat = theme === 'neon' ? THREE.MeshBasicMaterial : THREE.MeshStandardMaterial;
        const env = theme === 'galaxy' ? 0.12 : finish === 'matte' ? 0.15 : 0.35;
        this.texMats = this.stickers.map(() => new Mat(theme === 'neon' ? {} : { roughness: theme === 'galaxy' ? 0.5 : rough, metalness: 0, envMapIntensity: env }));
        this.paint();
      });
    }
    this.paint();
  }

  /** Farben bzw. Bildteile aus dem Zustand setzen */
  paint() {
    if (!this.faceTex) {
      for (let i = 0; i < 54; i++) this.stickers[i].material = this.mats[this.state[i]];
      this.dirty = true;
      return;
    }
    const home = homeOf(this.state);
    const size = (STYLES[this.skin.style] ?? STYLES.gan).size;
    for (let i = 0; i < 54; i++) {
      const h = home[i];
      const hf = faceOf(h);
      const r = Math.floor((h % 9) / 3);
      const c = h % 3;
      const tex = (this.stickerTex[i] ??= {})[hf] ??= this.faceTex[hf].clone();
      tex.center.set(0, 0);
      tex.repeat.set(1 / (3 * size), 1 / (3 * size));
      tex.offset.set((c + 0.5) / 3, (2.5 - r) / 3);
      tex.rotation = this.imageAngle(i, h);
      const mat = this.texMats[i];
      if (mat.map !== tex) {
        mat.map = tex;
        mat.needsUpdate = true;
      }
      this.stickers[i].material = mat;
    }
    this.dirty = true;
  }

  /** Drehwinkel des Bildteils: wie ist der Stein gegenüber seiner Ausgangslage gedreht? */
  imageAngle(i, h) {
    const f = faceOf(i);
    const frame = FACE_FRAME[f];
    const rightHome = FACE_FRAME[faceOf(h)].right;
    let rn;
    const piece = PIECE_STICKERS[i];
    if (piece.length === 1) {
      // Mittelstück: um die eigene Achse gedreht (Anzahl Vierteldrehungen im Uhrzeigersinn)
      const n = frame.normal;
      rn = rightHome;
      for (let k = 0; k < ((this.centerTurns[f] % 4) + 4) % 4; k++) rn = cross(rn, n); // −90° um n
    } else {
      const home = homeOf(this.state);
      const [j1, j2] = piece;
      const a = STICKERS[home[j1]].normal;
      const b = STICKERS[home[j2]].normal;
      const A = STICKERS[j1].normal;
      const B = STICKERS[j2].normal;
      const cAB = cross(a, b);
      const CAB = cross(A, B);
      const v = rightHome;
      const da = dot(v, a);
      const db = dot(v, b);
      const dc = dot(v, cAB);
      rn = [0, 1, 2].map((k) => da * A[k] + db * B[k] + dc * CAB[k]);
    }
    if (eq(rn, frame.right)) return 0;
    if (eq(rn, frame.up)) return Math.PI / 2;
    if (eq(rn, neg(frame.right))) return Math.PI;
    return -Math.PI / 2;
  }

  /** Zustand (Kociemba-Facelets) setzen */
  setState(facelets) {
    this.queue = [];
    if (this.anim) this.finishAnim(false);
    this.state = facelets;
    this.paint();
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
    for (const g of this.cubies.values()) if (dot(g.userData.pos, n) === 1) pivot.attach(g);
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
      this.centerTurns[a.p.face] += a.p.amount;
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
    // Hochformat: Sichtfeld so weiten, dass der Würfel auch in der Breite ganz hineinpasst
    const half = (24 / 2) * (Math.PI / 180);
    this.camera.fov = w < h ? (2 * Math.atan(Math.tan(half) / (w / h)) * 180) / Math.PI : 24;
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
