/**
 * Optimales Kreuz und X-Cross (Kreuz unten auf D) für die Solve-Analyse.
 *
 * Steinmodell: jede Kante als Platz·2 + Orientierung (0–23), jede Ecke als Platz·3 + Orientierung.
 * Die Zugtabellen werden aus dem Facelet-Modell abgeleitet (dieselben Plätze wie EDGE_NAMES/CORNER_NAMES).
 *   Kreuz:   vollständige Distanztabelle (24^4 Einträge) → optimale Lösung direkt ablesbar
 *   X-Cross: IDA*-Suche, Abschätzung = max(Kreuz-Distanz, Paar-Distanz)
 */
import { SOLVED, applyMove, faceletsToPatternData } from './facelets.js';

export const MOVES = ['U', "U'", 'U2', 'D', "D'", 'D2', 'R', "R'", 'R2', 'L', "L'", 'L2', 'F', "F'", 'F2', 'B', "B'", 'B2'];
const FACE_OF = MOVES.map((m) => 'UDRLFB'.indexOf(m[0]));
const AXIS = [0, 0, 1, 1, 2, 2];

// Zugtabellen: em[m][v] / cm[m][v] = neuer Wert eines Steins mit Wert v nach Zug m
const em = [];
const cm = [];
for (const m of MOVES) {
  const d = faceletsToPatternData(applyMove(SOLVED, m));
  const e = new Uint8Array(24);
  const c = new Uint8Array(24);
  d.EDGES.pieces.forEach((from, to) => {
    for (let o = 0; o < 2; o++) e[from * 2 + o] = to * 2 + ((o + d.EDGES.orientation[to]) % 2);
  });
  d.CORNERS.pieces.forEach((from, to) => {
    for (let o = 0; o < 3; o++) c[from * 3 + o] = to * 3 + ((o + d.CORNERS.orientation[to]) % 3);
  });
  em.push(e);
  cm.push(c);
}
export const EDGE_MOVE = em;
export const CORNER_MOVE = cm;

const CROSS_EDGES = [4, 5, 6, 7]; // DF DR DB DL
/** Slots mit Kreuz unten: Ecke + Mittelschicht-Kante */
export const SLOTS = [
  { name: 'FR', corner: 4, edge: 8 },
  { name: 'FL', corner: 5, edge: 9 },
  { name: 'BL', corner: 6, edge: 11 },
  { name: 'BR', corner: 7, edge: 10 },
];

/** Steinwerte eines Zustands (Kreuzfarbe muss auf D liegen, Mitten in Standardlage) */
export function pieceValues(state) {
  const d = faceletsToPatternData(state);
  const edge = (p) => {
    const pos = d.EDGES.pieces.indexOf(p);
    return pos * 2 + d.EDGES.orientation[pos];
  };
  const corner = (p) => {
    const pos = d.CORNERS.pieces.indexOf(p);
    return pos * 3 + d.CORNERS.orientation[pos];
  };
  return { cross: CROSS_EDGES.map(edge), corner, edge };
}

const crossIndex = (v) => ((v[0] * 24 + v[1]) * 24 + v[2]) * 24 + v[3];

// ---------- Kreuz-Distanztabelle (einmalig, ~330 000 Einträge) ----------
let crossDist = null;
function crossTable() {
  if (crossDist) return crossDist;
  const size = 24 ** 4;
  crossDist = new Uint8Array(size).fill(255);
  const start = crossIndex(CROSS_EDGES.map((p) => p * 2));
  crossDist[start] = 0;
  let frontier = [start];
  let depth = 0;
  while (frontier.length) {
    const next = [];
    for (const idx of frontier) {
      const v = [Math.floor(idx / 13824), Math.floor(idx / 576) % 24, Math.floor(idx / 24) % 24, idx % 24];
      for (let m = 0; m < 18; m++) {
        const t = em[m];
        const n = crossIndex([t[v[0]], t[v[1]], t[v[2]], t[v[3]]]);
        if (crossDist[n] === 255) {
          crossDist[n] = depth + 1;
          next.push(n);
        }
      }
    }
    frontier = next;
    depth++;
  }
  return crossDist;
}

// ---------- Paar-Distanz je Slot (Ecke + Kante, ohne Rücksicht aufs Kreuz) ----------
const pairDist = {};
function pairTable(slot) {
  if (pairDist[slot.name]) return pairDist[slot.name];
  const t = new Uint8Array(576).fill(255);
  const start = slot.corner * 3 * 24 + slot.edge * 2;
  t[start] = 0;
  let frontier = [start];
  let depth = 0;
  while (frontier.length) {
    const next = [];
    for (const idx of frontier) {
      const c = Math.floor(idx / 24);
      const e = idx % 24;
      for (let m = 0; m < 18; m++) {
        const n = cm[m][c] * 24 + em[m][e];
        if (t[n] === 255) {
          t[n] = depth + 1;
          next.push(n);
        }
      }
    }
    frontier = next;
    depth++;
  }
  return (pairDist[slot.name] = t);
}

// Zug m nach Zug last sinnvoll? (keine gleiche Seite, Gegenseiten nur in fester Reihenfolge)
const allowed = (last, m) => {
  if (last < 0) return true;
  const a = FACE_OF[last];
  const b = FACE_OF[m];
  if (a === b) return false;
  return !(AXIS[a] === AXIS[b] && a > b);
};

/** Optimales Kreuz (auf D) für einen Zustand – { moves: [...], length } */
export function solveCross(state) {
  const dist = crossTable();
  let v = pieceValues(state).cross;
  const moves = [];
  let d = dist[crossIndex(v)];
  while (d > 0) {
    for (let m = 0; m < 18; m++) {
      const n = v.map((x) => em[m][x]);
      if (dist[crossIndex(n)] === d - 1) {
        moves.push(MOVES[m]);
        v = n;
        d--;
        break;
      }
    }
  }
  return { moves, length: moves.length };
}

/**
 * Optimales X-Cross (Kreuz + ein Paar) über alle vier Slots.
 * @param maxNodes Abbruchgrenze, damit die Seite nicht hängt (null = nicht gefunden)
 */
export function solveXCross(state, { maxDepth = 11, maxNodes = 3e6, slots = null } = {}) {
  const dist = crossTable();
  const pv = pieceValues(state);
  let best = null;
  let nodes = 0;
  for (const slot of slots ? SLOTS.filter((s) => slots.includes(s.name)) : SLOTS) {
    const pt = pairTable(slot);
    const c0 = pv.corner(slot.corner);
    const e0 = pv.edge(slot.edge);
    const path = [];
    const h = (cv, c, e) => Math.max(dist[crossIndex(cv)], pt[c * 24 + e]);
    const limit = best ? best.length - 1 : maxDepth;
    let found = null;
    const dfs = (cv, c, e, g, bound, last) => {
      const f = h(cv, c, e);
      if (f === 0) return true;
      if (g + f > bound) return false;
      if (++nodes > maxNodes) return false;
      for (let m = 0; m < 18; m++) {
        if (!allowed(last, m)) continue;
        const t = em[m];
        path.push(MOVES[m]);
        if (dfs([t[cv[0]], t[cv[1]], t[cv[2]], t[cv[3]]], cm[m][c], t[e], g + 1, bound, m)) return true;
        path.pop();
      }
      return false;
    };
    for (let bound = h(pv.cross, c0, e0); bound <= limit && nodes <= maxNodes; bound++) {
      if (dfs(pv.cross, c0, e0, 0, bound, -1)) {
        found = [...path];
        break;
      }
    }
    if (found && (!best || found.length < best.length)) best = { moves: found, length: found.length, slot: slot.name };
  }
  return best ? { ...best, complete: nodes <= maxNodes } : null;
}
