/**
 * Sticker-Modell des 3x3-Würfels im Kociemba-Format:
 * 54 Zeichen, Reihenfolge der Seiten U R F D L B, je 9 Felder zeilenweise.
 * Farben werden als Seitenbuchstaben geschrieben (Mittelsteine sind fest).
 *
 * Alles hier ist aus der 3D-Geometrie abgeleitet, damit keine handgeschriebenen
 * Permutationstabellen nötig sind.
 */

export const FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
export const SOLVED = FACES.map((f) => f.repeat(9)).join('');

// Koordinaten: x → R, y → U, z → F
const NORMALS = {
  U: [0, 1, 0], R: [1, 0, 0], F: [0, 0, 1],
  D: [0, -1, 0], L: [-1, 0, 0], B: [0, 0, -1],
};

// Position des Würfelchens für Feld (Zeile r, Spalte c) jeder Seite, von außen betrachtet
const POS = {
  U: (r, c) => [c - 1, 1, r - 1],
  R: (r, c) => [1, 1 - r, 1 - c],
  F: (r, c) => [c - 1, 1 - r, 1],
  D: (r, c) => [c - 1, -1, 1 - r],
  L: (r, c) => [-1, 1 - r, c - 1],
  B: (r, c) => [1 - c, 1 - r, -1],
};

/** Je Feld: Position des Steins, Normale, Seite, zu der das Feld gehört */
export const STICKERS = [];
for (const f of FACES) {
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    STICKERS.push({ pos: POS[f](r, c), normal: NORMALS[f], face: f });
  }
}

const key = (p, n) => `${p.join(',')}|${n.join(',')}`;
const INDEX = new Map(STICKERS.map((s, i) => [key(s.pos, s.normal), i]));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Dreht v um die Achse a (Einheitsachse) um k·90° (gegen den Uhrzeigersinn, rechte Hand) */
function rot90(v, a, k) {
  let r = v;
  for (let i = 0; i < ((k % 4) + 4) % 4; i++) {
    // a × r + (a·r) a  (für 90°: cos = 0, sin = 1)
    const c = [a[1] * r[2] - a[2] * r[1], a[2] * r[0] - a[0] * r[2], a[0] * r[1] - a[1] * r[0]];
    const d = dot(a, r);
    r = [c[0] + d * a[0], c[1] + d * a[1], c[2] + d * a[2]];
  }
  return r.map((x) => Math.round(x) + 0);
}

/** Permutation für eine Vierteldrehung im Uhrzeigersinn einer Seite: perm[i] = Ziel von Feld i */
const QUARTER = {};
for (const f of FACES) {
  const n = NORMALS[f];
  QUARTER[f] = STICKERS.map((s, i) => {
    if (dot(s.pos, n) !== 1) return i;
    // Uhrzeigersinn von außen = −90° um die nach außen zeigende Normale
    return INDEX.get(key(rot90(s.pos, n, -1), rot90(s.normal, n, -1)));
  });
}

/** Zerlegt "R", "R'", "R2" (auch "R2'") in Seite und Anzahl Vierteldrehungen im Uhrzeigersinn */
export function parseMove(move) {
  const m = /^([URFDLB])(2?)('?)$/.exec(move.trim());
  if (!m) return null;
  const amount = m[2] ? 2 : m[3] ? 3 : 1;
  return { face: m[1], amount };
}

export function formatMove(face, amount) {
  const a = ((amount % 4) + 4) % 4;
  return face + (a === 1 ? '' : a === 2 ? '2' : a === 3 ? "'" : '0');
}

export function applyMove(state, move) {
  const mv = typeof move === 'string' ? parseMove(move) : move;
  if (!mv) return state;
  let s = state;
  for (let k = 0; k < mv.amount; k++) {
    const out = new Array(54);
    const p = QUARTER[mv.face];
    for (let i = 0; i < 54; i++) out[p[i]] = s[i];
    s = out.join('');
  }
  return s;
}

export function applyAlg(state, alg) {
  return alg.split(/\s+/).filter(Boolean).reduce(applyMove, state);
}

export const isSolved = (state) => state === SOLVED;

// ---------- Phasenerkennung (CFOP) ----------

const pieceType = (p) => p.filter((x) => x !== 0).length; // 1 Mitte, 2 Kante, 3 Ecke
const stickerOk = (state, i) => state[i] === STICKERS[i].face;

const PHASE_SETS = {};
for (const f of FACES) {
  const n = NORMALS[f];
  const opp = n.map((x) => -x);
  PHASE_SETS[f] = {
    // Kreuz: alle Felder der Kantensteine in der Schicht der Kreuzseite
    cross: STICKERS.map((s, i) => i).filter((i) => dot(STICKERS[i].pos, n) === 1 && pieceType(STICKERS[i].pos) === 2),
    // F2L: alle Felder der beiden Schichten auf Seite des Kreuzes
    f2l: STICKERS.map((s, i) => i).filter((i) => dot(STICKERS[i].pos, n) >= 0),
    // OLL: alle Felder auf der Gegenseite haben deren Farbe
    oll: STICKERS.map((s, i) => i).filter((i) => dot(STICKERS[i].normal, opp) === 1),
  };
}

/** Liefert je Kreuzseite, welche Phasen im Zustand erfüllt sind */
export function phaseStatus(state) {
  const res = {};
  for (const f of FACES) {
    const s = PHASE_SETS[f];
    const cross = s.cross.every((i) => stickerOk(state, i));
    const f2l = cross && s.f2l.every((i) => stickerOk(state, i));
    const oll = f2l && s.oll.every((i) => stickerOk(state, i));
    res[f] = { cross, f2l, oll };
  }
  return res;
}

// ---------- Umwandlung in cubing.js KPattern ----------

// Reihenfolge und Stickerreihenfolge der Steine in cubing.js (Reid-Notation)
const EDGE_NAMES = ['UF', 'UR', 'UB', 'UL', 'DF', 'DR', 'DB', 'DL', 'FR', 'FL', 'BR', 'BL'];
const CORNER_NAMES = ['UFR', 'URB', 'UBL', 'ULF', 'DRF', 'DFL', 'DLB', 'DBR'];

/** Feldindizes eines Steins in der Reihenfolge der Buchstaben seines Namens */
function slotFacelets(name) {
  const pos = [0, 0, 0];
  for (const ch of name) NORMALS[ch].forEach((v, k) => { if (v) pos[k] = v; });
  return [...name].map((ch) => INDEX.get(key(pos, NORMALS[ch])));
}
const EDGE_SLOTS = EDGE_NAMES.map(slotFacelets);
const CORNER_SLOTS = CORNER_NAMES.map(slotFacelets);

/** Zustand (Kociemba) → Daten für KPattern {EDGES, CORNERS, CENTERS} */
export function faceletsToPatternData(state) {
  const orbit = (slots, names) => {
    const pieces = [];
    const orientation = [];
    for (const slot of slots) {
      const colors = slot.map((i) => state[i]);
      let found = false;
      for (let p = 0; p < names.length && !found; p++) {
        const n = names[p];
        for (let o = 0; o < n.length; o++) {
          // Feld j des Platzes zeigt Sticker (j + o) des Steins
          if (colors.every((c, j) => c === n[(j + o) % n.length])) {
            pieces.push(p);
            orientation.push(o);
            found = true;
            break;
          }
        }
      }
      if (!found) throw new Error('Ungültiger Würfelzustand: ' + colors.join(''));
    }
    return { pieces, orientation };
  };
  return {
    EDGES: orbit(EDGE_SLOTS, EDGE_NAMES),
    CORNERS: orbit(CORNER_SLOTS, CORNER_NAMES),
    CENTERS: { pieces: [0, 1, 2, 3, 4, 5], orientation: [0, 0, 0, 0, 0, 0] },
  };
}

/** Daten eines KPattern → Zustand (Kociemba) */
export function patternDataToFacelets(data) {
  const out = SOLVED.split('');
  const fill = (slots, names, orbit) => slots.forEach((slot, s) => {
    const n = names[orbit.pieces[s]];
    const o = orbit.orientation[s];
    slot.forEach((fi, j) => { out[fi] = n[(j + o) % n.length]; });
  });
  fill(EDGE_SLOTS, EDGE_NAMES, data.EDGES);
  fill(CORNER_SLOTS, CORNER_NAMES, data.CORNERS);
  return out.join('');
}
