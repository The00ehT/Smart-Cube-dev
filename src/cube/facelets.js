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
export const EDGE_NAMES = ['UF', 'UR', 'UB', 'UL', 'DF', 'DR', 'DB', 'DL', 'FR', 'FL', 'BR', 'BL'];
export const CORNER_NAMES = ['UFR', 'URB', 'UBL', 'ULF', 'DRF', 'DFL', 'DLB', 'DBR'];

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

// ---------- Würfeldrehungen (x, y, z) ----------

// x folgt R, y folgt U, z folgt F: Drehung um −90° um die jeweilige Achse
const ROT_AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const faceOfNormal = (n) => FACES.find((f) => NORMALS[f].every((v, k) => v === n[k]));

/**
 * Seitenzuordnung nach einer Würfeldrehung wie "z2" oder "x' y":
 * map[f] = Seite, auf der die bisherige Seite f danach liegt.
 */
export function rotationFaceMap(rotation) {
  const map = Object.fromEntries(FACES.map((f) => [f, f]));
  for (const tok of rotation.split(/\s+/).filter(Boolean)) {
    const m = /^([xyz])(2?)('?)$/.exec(tok);
    if (!m) throw new Error('Unbekannte Drehung: ' + tok);
    const k = m[2] ? 2 : m[3] ? 1 : 3; // in Schritten von +90°; Uhrzeigersinn = −90° = 3 · (+90°)
    for (const f of FACES) map[f] = faceOfNormal(rot90(NORMALS[map[f]], ROT_AXES[m[1]], k));
  }
  return map;
}

/** Drehung, die die Kreuzseite nach unten (D) bringt; Vorderseite bleibt möglichst erhalten */
export const CROSS_DOWN = { D: '', U: 'z2', F: "x'", B: 'x', R: 'z', L: "z'" };

/** Übersetzt Züge in die Sicht nach einer Würfeldrehung */
export function translateMoves(moves, rotation) {
  if (!rotation) return [...moves];
  const map = rotationFaceMap(rotation);
  return moves.map((mv) => map[mv[0]] + mv.slice(1));
}

/** Farbnamen des Standard-Farbschemas (Weiß oben, Grün vorne) */
export const COLOR_NAMES = { U: 'Weiß', R: 'Rot', F: 'Grün', D: 'Gelb', L: 'Orange', B: 'Blau' };

// ---------- F2L-Slots ----------

/**
 * Je Kreuzseite die vier Slots (Ecke + Mittelschicht-Kante).
 * slot.faces = die beiden Seitenfarben, slot.stickers = Feldindizes beider Steine.
 */
export const F2L_SLOTS = {};
for (const f of FACES) {
  const n = NORMALS[f];
  const sides = FACES.filter((s) => dot(NORMALS[s], n) === 0);
  const slots = [];
  for (let a = 0; a < sides.length; a++) for (let b = a + 1; b < sides.length; b++) {
    const na = NORMALS[sides[a]];
    const nb = NORMALS[sides[b]];
    if (dot(na, nb) !== 0) continue; // Gegenseiten bilden keinen Slot
    const edge = na.map((v, k) => v + nb[k]);
    const corner = edge.map((v, k) => v + n[k]);
    const stickers = STICKERS.map((s, i) => i).filter((i) => {
      const p = STICKERS[i].pos;
      return p.every((v, k) => v === edge[k]) || p.every((v, k) => v === corner[k]);
    });
    slots.push({ faces: sides[a] + sides[b], stickers });
  }
  F2L_SLOTS[f] = slots;
}

/** Welche Slots der Kreuzseite f gelöst sind (Bitmaske, Reihenfolge wie F2L_SLOTS[f]) */
export function solvedSlots(state, f) {
  let mask = 0;
  F2L_SLOTS[f].forEach((s, k) => {
    if (s.stickers.every((i) => stickerOk(state, i))) mask |= 1 << k;
  });
  return mask;
}

/** Umkehrung einer Zugfolge ("R U2 F'" → "F U2 R'") */
export function invertAlg(alg) {
  return alg
    .split(/\s+/)
    .filter(Boolean)
    .reverse()
    .map((m) => {
      const p = parseMove(m);
      return p ? formatMove(p.face, 4 - p.amount) : m;
    })
    .join(' ');
}

/**
 * Fasst für die Anzeige zwei gleiche Vierteldrehungen direkt hintereinander zu einem Doppelzug zusammen
 * (Smartcubes melden "F2" als zwei Züge "F F"). Liefert Gruppen { text, first, last } mit Zugindizes.
 */
export function groupMoves(moves, offset = 0) {
  const out = [];
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    if (i + 1 < moves.length && moves[i + 1] === m && !m.endsWith('2')) {
      out.push({ text: m[0] + '2', first: offset + i, last: offset + i + 1 });
      i++;
    } else out.push({ text: m, first: offset + i, last: offset + i });
  }
  return out;
}

// ---------- Erweiterte Notation: weite Züge, Mittelschichten, Drehungen ----------

/**
 * Permutationen für alle Zugarten (Uhrzeigersinn aus Sicht der namensgebenden Seite):
 *   U R F D L B   eine Schicht
 *   Uw … / u …    zwei Schichten
 *   M (wie L), E (wie D), S (wie F)   Mittelschicht
 *   x (wie R), y (wie U), z (wie F)   ganzer Würfel
 */
const ANY = {};
{
  const make = (axisFace, select) => {
    const n = NORMALS[axisFace];
    return STICKERS.map((s, i) => {
      if (!select(dot(s.pos, n))) return i;
      return INDEX.get(key(rot90(s.pos, n, -1), rot90(s.normal, n, -1)));
    });
  };
  for (const f of FACES) {
    ANY[f] = make(f, (d) => d === 1);
    ANY[f + 'w'] = make(f, (d) => d >= 0);
  }
  ANY.M = make('L', (d) => d === 0);
  ANY.E = make('D', (d) => d === 0);
  ANY.S = make('F', (d) => d === 0);
  ANY.x = make('R', () => true);
  ANY.y = make('U', () => true);
  ANY.z = make('F', () => true);
}

/** Zerlegt einen beliebigen Zug ("Rw2", "r'", "M2", "y'") → { base, amount } oder null */
export function parseAnyMove(tok) {
  const m = /^([URFDLB]w|[URFDLB]|[urfdlb]|[MES]|[xyz])(2?)('?)$/.exec(tok.trim());
  if (!m) return null;
  let base = m[1];
  if (/^[urfdlb]$/.test(base)) base = base.toUpperCase() + 'w';
  const amount = m[2] ? 2 : m[3] ? 3 : 1;
  return { base, amount };
}

/** Zerlegt einen Algorithmus-Text in Züge (Klammern, Kommas und Zeilenumbrüche werden ignoriert) */
export function tokenizeAlg(alg) {
  return String(alg || '')
    .replace(/\/\/.*$/gm, ' ')
    .replace(/[()[\],]/g, ' ')
    .replace(/’|´|`/g, "'")
    .split(/\s+/)
    .filter(Boolean);
}

/** Prüft einen Algorithmus-Text; liefert die ungültigen Teile */
export function invalidTokens(alg) {
  return tokenizeAlg(alg).filter((t) => !parseAnyMove(t));
}

export function applyAnyMove(state, tok) {
  const mv = typeof tok === 'string' ? parseAnyMove(tok) : tok;
  if (!mv) throw new Error('Unbekannter Zug: ' + tok);
  const p = ANY[mv.base];
  let s = state;
  for (let k = 0; k < mv.amount; k++) {
    const out = new Array(54);
    for (let i = 0; i < 54; i++) out[p[i]] = s[i];
    s = out.join('');
  }
  return s;
}

export function applyAnyAlg(state, alg) {
  return tokenizeAlg(alg).reduce(applyAnyMove, state);
}

/** Umkehrung mit beliebiger Notation */
export function invertAnyAlg(alg) {
  return tokenizeAlg(alg)
    .reverse()
    .map((t) => {
      const p = parseAnyMove(t);
      if (!p) return t;
      const name = t.replace(/[2']/g, '');
      return name + (p.amount === 2 ? '2' : p.amount === 1 ? "'" : '');
    })
    .join(' ');
}

// ---------- Relativer Zustand ----------

// Für jedes Feld: die Felder desselben Steins (zum Wiedererkennen eines Stickers an seinen Farben)
const PIECE_OF = STICKERS.map((s) => STICKERS.map((t, j) => (t.pos.every((v, k) => v === s.pos[k]) ? j : -1)).filter((j) => j >= 0));
const stickerId = (state, i) => PIECE_OF[i].map((j) => state[j]).sort().join('') + ':' + state[i];
const HOME = new Map(STICKERS.map((_, i) => [stickerId(SOLVED, i), i]));
/** Für jede Position: Ausgangsposition des Stickers, der dort liegt */
const sigma = (state) => STICKERS.map((_, i) => HOME.get(stickerId(state, i)));

/**
 * Zustand, den eine Zugfolge X vom gelösten Würfel aus erzeugt, wenn X den Würfel von `from` nach `to` bringt.
 * Damit lässt sich ein Setup vom aktuellen Zustand aus berechnen (setupAlgFor(relativeState(…))).
 */
export function relativeState(from, to) {
  const sf = sigma(from);
  const st = sigma(to);
  const inv = new Array(54);
  sf.forEach((h, i) => (inv[h] = i));
  return st.map((h) => SOLVED[inv[h]]).join('');
}
