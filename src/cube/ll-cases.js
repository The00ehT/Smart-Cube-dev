/**
 * Fälle der letzten Schicht: 57 OLL und 21 PLL.
 *
 * Erkennung über die Sticker der oberen Schicht (U), nachdem der Würfel so gedreht wurde, dass das Kreuz
 * unten liegt. OLL: welche Sticker die Farbe der oberen Mitte haben (unabhängig vom Blickwinkel).
 * PLL: Farbe jedes Seitenstickers relativ zur Mitte seiner Seite (unabhängig von Blickwinkel und AUF).
 *
 * Die Fälle werden aus Standard-Algorithmen erzeugt (Fall = Umkehrung des Algorithmus auf den gelösten
 * Würfel). Die Tests prüfen, dass alle 57 bzw. 21 Fälle verschieden sind und jeden möglichen Fall abdecken.
 */
import { SOLVED, applyAnyAlg, applyAnyMove, invertAnyAlg, invalidTokens, tokenizeAlg, rotationFaceMap, CROSS_DOWN } from './facelets.js';

export const PLL_ALGS = {
  Aa: "x R' U R' D2 R U' R' D2 R2 x'",
  Ab: "x R2 D2 R U R' D2 R U' R x'",
  E: "x' R U' R' D R U R' D' R U R' D R U' R' D' x",
  F: "R' U' F' R U R' U' R' F R2 U' R' U' R U R' U R",
  Ga: "R2 U R' U R' U' R U' R2 U' D R' U R D'",
  Gb: "R' U' R U D' R2 U R' U R U' R U' R2 D",
  Gc: "R2 U' R U' R U R' U R2 U D' R U' R' D",
  Gd: "R U R' U' D R2 U' R U' R' U R' U R2 D'",
  H: 'M2 U M2 U2 M2 U M2',
  Ja: "x R2 F R F' R U2 r' U r U2 x'",
  Jb: "R U R' F' R U R' U' R' F R2 U' R'",
  Na: "R U R' U R U R' F' R U R' U' R' F R2 U' R' U2 R U' R'",
  Nb: "R' U R U' R' F' U' F R U R' F R' F' R U' R",
  Ra: "R U' R' U' R U R D R' U' R D' R' U2 R'",
  Rb: "R2 F R U R U' R' F' R U2 R' U2 R",
  T: "R U R' U' R' F R2 U' R' U' R U R' F'",
  Ua: "R U' R U R U R U' R' U' R2",
  Ub: "R2 U R U R' U' R' U' R' U R'",
  V: "R' U R' U' y R' F' R2 U' R' U R' F R F",
  Y: "F R U' R' U' R U R' F' R U R' U' R' F R F'",
  Z: "M' U M2 U M2 U M' U2 M2",
};

export const OLL_ALGS = {
  1: "R U2 R2 F R F' U2 R' F R F'",
  2: "F R U R' U' F' f R U R' U' f'",
  3: "f R U R' U' f' U' F R U R' U' F'",
  4: "f R U R' U' f' U F R U R' U' F'",
  5: "r' U2 R U R' U r",
  6: "r U2 R' U' R U' r'",
  7: "r U R' U R U2 r'",
  8: "l' U' L U' L' U2 l",
  9: "R U R' U' R' F R2 U R' U' F'",
  10: "R U R' U R' F R F' R U2 R'",
  11: "r U R' U R' F R F' R U2 r'",
  12: "M' R' U' R U' R' U2 R U' R r'",
  13: "F U R U' R2 F' R U R U' R'",
  14: "R' F R U R' F' R F U' F'",
  15: "l' U' l L' U' L U l' U l",
  16: "r U r' R U R' U' r U' r'",
  17: "F R' F' R2 r' U R U' R' U' M'",
  18: "r U R' U R U2 r2 U' R U' R' U2 r",
  19: "r' R U R U R' U' M' R' F R F'",
  20: "r U R' U' M2 U R U' R' U' M'",
  21: "R U2 R' U' R U R' U' R U' R'",
  22: "R U2 R2 U' R2 U' R2 U2 R",
  23: "R2 D' R U2 R' D R U2 R",
  24: "r U R' U' r' F R F'",
  25: "F' r U R' U' r' F R",
  26: "R U2 R' U' R U' R'",
  27: "R U R' U R U2 R'",
  28: "r U R' U' M U R U' R'",
  29: "R U R' U' R U' R' F' U' F R U R'",
  30: "F R' F R2 U' R' U' R U R' F2",
  31: "R' U' F U R U' R' F' R",
  32: "L U F' U' L' U L F L'",
  33: "R U R' U' R' F R F'",
  34: "R U R2 U' R' F R U R U' F'",
  35: "R U2 R2 F R F' R U2 R'",
  36: "L' U' L U' L' U L U L F' L' F",
  37: "F R' F' R U R U' R'",
  38: "R U R' U R U' R' U' R' F R F'",
  39: "L F' L' U' L U F U' L'",
  40: "R' F R U R' U' F' U R",
  41: "R U R' U R U2 R' F R U R' U' F'",
  42: "R' U' R U' R' U2 R F R U R' U' F'",
  43: "F' U' L' U L F",
  44: "F U R U' R' F'",
  45: "F R U R' U' F'",
  46: "R' U' R' F R F' U R",
  47: "F' L' U' L U L' U' L U F",
  48: "F R U R' U' R U R' U' F'",
  49: "r U' r2 U r2 U r2 U' r",
  50: "r' U r2 U' r2 U' r2 U r'",
  51: "F U R U' R' U R U' R' F'",
  52: "R U R' U R U' B U' B' R'",
  53: "l' U2 L U L' U' L U L' U l",
  54: "r U2 R' U' R U R' U' R U' r'",
  55: "R' F R U R U' R2 F' R2 U' R' U R U R'",
  56: "r' U' r U' R' U R U' R' U R r' U r",
  57: "R U R' U' M' U R U' r'",
};

/** Gruppen für die Anzeige */
export const OLL_GROUPS = [
  ['Punkt', [1, 2, 3, 4, 17, 18, 19, 20]],
  ['Kreuz (OCLL)', [21, 22, 23, 24, 25, 26, 27]],
  ['Linie', [51, 52, 55, 56]],
  ['T', [33, 45]],
  ['Quadrat', [5, 6]],
  ['Kleines L', [7, 8, 11, 12]],
  ['Großes L / Fisch', [9, 10, 35, 37]],
  ['C', [34, 46]],
  ['W', [36, 38]],
  ['P', [31, 32, 43, 44]],
  ['Blitz', [39, 40]],
  ['Haken / Awkward', [29, 30, 41, 42]],
  ['Großes L', [47, 48, 49, 50, 53, 54]],
  ['Ecken richtig', [28, 57]],
  ['Rest', [13, 14, 15, 16]],
];
export const PLL_GROUPS = [
  ['Nur Kanten', ['Ua', 'Ub', 'H', 'Z']],
  ['Nur Ecken', ['Aa', 'Ab', 'E']],
  ['Nachbar-Tausch', ['T', 'F', 'Ja', 'Jb', 'Ra', 'Rb']],
  ['Diagonal-Tausch', ['V', 'Y', 'Na', 'Nb']],
  ['G-Perms', ['Ga', 'Gb', 'Gc', 'Gd']],
];

// ---------- Schlüssel ----------

// Feldindizes: U-Seite 0–8; obere Reihe der Seiten F (18–20), R (9–11), B (45–47), L (36–38)
const U_FACE = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const SIDES = [
  [18, 19, 20], // F
  [9, 10, 11], // R
  [45, 46, 47], // B
  [36, 37, 38], // L
];
const SIDE_CENTER = [22, 13, 49, 40];

/** OLL: Muster der oberen Farbe, kleinstes über die vier Blickwinkel */
export function ollKey(state) {
  let best = null;
  let s = state;
  for (let k = 0; k < 4; k++) {
    const top = s[4];
    const pat = U_FACE.map((i) => (s[i] === top ? '1' : '0')).join('') + '|' + SIDES.flat().map((i) => (s[i] === top ? '1' : '0')).join('');
    if (best === null || pat < best) best = pat;
    s = applyAnyMove(s, 'U');
  }
  return best;
}

/** PLL: Seitensticker relativ zur Mitte, kleinstes über AUF und Blickwinkel */
export function pllKey(state) {
  let best = null;
  let s = state;
  const centers = (st) => SIDE_CENTER.map((i) => st[i]);
  for (let k = 0; k < 4; k++) {
    const cs = centers(s);
    const off = SIDES.map((row) => row.map((i) => {
      const c = cs.indexOf(s[i]);
      return c < 0 ? 'x' : String(c);
    }));
    // relativ: Abstand Stickerfarbe ↔ Seite, an der er sitzt
    const rel = off.map((row, side) => row.map((c) => (c === 'x' ? 'x' : String((Number(c) - side + 4) % 4))).join(''));
    for (let r = 0; r < 4; r++) {
      const pat = [...rel.slice(r), ...rel.slice(0, r)].join('|');
      if (best === null || pat < best) best = pat;
    }
    s = applyAnyMove(s, 'U');
  }
  return best;
}

/** Ist die untere und mittlere Schicht gelöst (bei Kreuz unten)? */
export function f2lSolved(state) {
  for (let i = 9; i < 54; i++) {
    const face = Math.floor(i / 9);
    if (face === 0) continue;
    const row = Math.floor((i % 9) / 3);
    // obere Reihe der Seiten gehört zur letzten Schicht
    if (face !== 3 && row === 0) continue;
    if (state[i] !== state[face * 9 + 4]) return false;
  }
  return true;
}
export const llOriented = (s) => U_FACE.every((i) => s[i] === s[4]);

// ---------- Tabellen ----------

const ROTS = ['', 'x', 'x2', "x'", 'y', 'y2', "y'", 'z', "z'", 'x y', 'x y2', "x y'", "x' y", "x' y2", "x' y'", 'z y', 'z y2', "z y'", "z' y", "z' y2", "z' y'", 'x2 y', 'x2 y2', "x2 y'"];
/**
 * Fall-Zustand eines Algorithmus: der Zustand mit Mitten in Standardlage, den der Algorithmus löst.
 * Enthält der Algorithmus Würfeldrehungen, wird deren Summe vorne ausgeglichen (der Löser hält den Würfel normal).
 */
function caseState(alg) {
  const inv = invertAnyAlg(alg);
  for (const q of ROTS) {
    const s = applyAnyAlg(q ? applyAnyAlg(SOLVED, q) : SOLVED, inv);
    if (s[4] === 'U' && s[13] === 'R' && s[22] === 'F') return s;
  }
  return recenter(applyAnyAlg(SOLVED, inv));
}
/** Drehung so, dass die Mitten wieder in Standardlage liegen (nach Algorithmen mit x/y/z/M) */
export function recenter(state) {
  for (const r of ROTS) {
    const s = r ? applyAnyAlg(state, r) : state;
    if (s[4] === 'U' && s[13] === 'R' && s[22] === 'F') return s;
  }
  return state;
}

export const OLL_CASES = {}; // Schlüssel → Nummer
export const PLL_CASES = {}; // Schlüssel → Name
export const CASE_STATE = {}; // 'OLL 27' / 'PLL T' → Zustand (Kreuz unten)
for (const [n, alg] of Object.entries(OLL_ALGS)) {
  const s = caseState(alg);
  OLL_CASES[ollKey(s)] = Number(n);
  CASE_STATE['OLL ' + n] = s;
}
for (const [n, alg] of Object.entries(PLL_ALGS)) {
  const s = caseState(alg);
  PLL_CASES[pllKey(s)] = n;
  CASE_STATE['PLL ' + n] = s;
}
const OLL_SOLVED = ollKey(SOLVED);
const PLL_SOLVED = pllKey(SOLVED);

/** OLL-Fall eines Zustands mit Kreuz unten: Nummer, 0 = Skip, null = unbekannt */
export function identifyOll(state) {
  const k = ollKey(state);
  if (k === OLL_SOLVED) return 0;
  return OLL_CASES[k] ?? null;
}
/** PLL-Fall: Name, 'Skip' oder null */
export function identifyPll(state) {
  const k = pllKey(state);
  if (k === PLL_SOLVED) return 'Skip';
  return PLL_CASES[k] ?? null;
}

// ---------- Wahrscheinlichkeiten (durch Abzählen aller Zustände der letzten Schicht) ----------

function permutations(a) {
  if (a.length <= 1) return [a];
  return a.flatMap((x, i) => permutations([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p]));
}
const parity = (p) => {
  let c = 0;
  for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) if (p[i] > p[j]) c++;
  return c % 2;
};

let probCache = null;
/** { oll: { [nr]: p, 0: p }, pll: { [name]: p, Skip: p } } */
export function caseProbabilities() {
  if (probCache) return probCache;
  const oll = {};
  const ollStates = new Map();
  // Exakte Zählung über alle 216 Orientierungsmuster der letzten Schicht
  const edgeU = [7, 5, 1, 3]; // UF, UR, UB, UL (U-Sticker)
  const edgeS = [19, 10, 46, 37];
  const cornU = [8, 2, 0, 6]; // UFR, URB, UBL, ULF
  const cornS = [[20, 9], [11, 45], [47, 36], [38, 18]]; // je (im Uhrzeigersinn, gegen)
  for (let eo = 0; eo < 8; eo++) {
    const eBits = [eo & 1, (eo >> 1) & 1, (eo >> 2) & 1];
    eBits.push((eBits[0] + eBits[1] + eBits[2]) % 2);
    for (let co = 0; co < 27; co++) {
      const c = [co % 3, Math.floor(co / 3) % 3, Math.floor(co / 9) % 3];
      c.push((6 - c[0] - c[1] - c[2]) % 3);
      const s = SOLVED.split('');
      // obere Farbe 'U', andere Felder neutral 'X'
      for (let i = 0; i < 4; i++) {
        s[edgeU[i]] = eBits[i] ? 'X' : 'U';
        s[edgeS[i]] = eBits[i] ? 'U' : 'X';
        s[cornU[i]] = c[i] === 0 ? 'U' : 'X';
        s[cornS[i][0]] = c[i] === 1 ? 'U' : 'X';
        s[cornS[i][1]] = c[i] === 2 ? 'U' : 'X';
      }
      const k = ollKey(s.join(''));
      ollStates.set(k, (ollStates.get(k) || 0) + 1);
    }
  }
  for (const [k, n] of ollStates) {
    const id = k === OLL_SOLVED ? 0 : OLL_CASES[k];
    if (id !== undefined) oll[id] = (oll[id] || 0) + n / 216;
  }
  // PLL: alle Permutationen der Ecken und Kanten mit gleicher Parität, je 4 AUF
  const pll = {};
  const edges = permutations([0, 1, 2, 3]);
  const corners = permutations([0, 1, 2, 3]);
  let total = 0;
  // Farben der Seiten: F R B L; Kante i hat Seitenfarbe i; Ecke i (UFR, URB, UBL, ULF) hat (i, i+1)
  const col = ['F', 'R', 'B', 'L'];
  for (const ep of edges) for (const cp of corners) {
    if (parity(ep) !== parity(cp)) continue;
    const s = SOLVED.split('');
    for (let i = 0; i < 4; i++) {
      s[edgeS[i]] = col[ep[i]];
      s[cornS[i][0]] = col[cp[i]];
      s[cornS[i][1]] = col[(cp[i] + 1) % 4];
    }
    const k = pllKey(s.join(''));
    const id = k === PLL_SOLVED ? 'Skip' : PLL_CASES[k];
    total++;
    if (id !== undefined) pll[id] = (pll[id] || 0) + 1;
  }
  for (const k of Object.keys(pll)) pll[k] /= total;
  probCache = { oll, pll };
  return probCache;
}

/** Fall-Zustand (Kreuz unten, Mitten in Standardlage) für einen beliebigen Algorithmus */
export const stateForAlg = (alg) => caseState(alg);

/** Gelöst bis auf eine Drehung der oberen Schicht? */
export const solvedUpToAuf = (s) => f2lSolved(s) && llOriented(s) && identifyPll(s) === 'Skip';

/**
 * Prüft einen Algorithmus für einen Fall ('OLL 27', 'PLL T'):
 * { ok, error?, solves } – solves = löst den Fall (OLL: orientiert, PLL: gelöst bis auf AUF)
 */
export function checkAlg(id, alg) {
  const bad = invalidTokens(alg);
  if (bad.length) return { ok: false, error: `Unbekannte Züge: ${bad.join(' ')}` };
  if (!tokenizeAlg(alg).length) return { ok: false, error: 'Leer' };
  const start = CASE_STATE[id];
  if (!start) return { ok: true, solves: true };
  // Der Löser darf die obere Schicht vorher passend drehen (AUF)
  const solves = ['', 'U', 'U2', "U'"].some((auf) => {
    const end = recenter(applyAnyAlg(applyAnyAlg(start, auf), alg));
    return id.startsWith('OLL') ? f2lSolved(end) && llOriented(end) : id.startsWith('F2L') ? f2lSolved(end) : solvedUpToAuf(end);
  });
  return { ok: true, solves };
}

/** Farben so umbenennen, dass jede Mitte wieder den Buchstaben ihrer Seite trägt */
export function relabelToCenters(s) {
  const faces = 'URFDLB';
  const map = {};
  for (let f = 0; f < 6; f++) map[s[f * 9 + 4]] = faces[f];
  return [...s].map((c) => map[c]).join('');
}

/**
 * Ziel-Zustand im Körpersystem des Würfels für einen Fall, wie ihn der Löser mit Kreuzseite `crossFace`
 * (unten) sieht – mit zufälligem AUF und Blickwinkel.
 */
export function bodyCaseState(viewerCase, crossFace, rnd = Math.random) {
  const turns = ['', 'U', 'U2', "U'"];
  let s = applyAnyAlg(viewerCase, turns[Math.floor(rnd() * 4)]);
  s = relabelToCenters(applyAnyAlg(s, turns[Math.floor(rnd() * 4)].replace('U', 'y')));
  const rot = CROSS_DOWN[crossFace];
  const map = rotationFaceMap(rot); // Körperseite → Seite aus Sicht des Lösers
  const inv = {};
  for (const [b, v] of Object.entries(map)) inv[v] = b;
  const relabeled = [...s].map((c) => inv[c]).join('');
  return rot ? applyAnyAlg(relabeled, invertAnyAlg(rot)) : relabeled;
}
