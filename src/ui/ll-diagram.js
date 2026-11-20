/**
 * Draufsicht auf die letzte Schicht (5 × 5 Felder: obere Seite 3 × 3 und die oberen Reihen der Seiten).
 * Zustand mit Kreuz unten (obere Mitte = Farbe der letzten Schicht).
 *   mode 'oll': obere Farbe gelb, alles andere grau
 *   mode 'pll': echte Farben (Gelb oben, Grün vorne)
 */
const COLORS = { U: '#ffd500', F: '#1fa64a', R: '#ff8a00', B: '#1e5bd6', L: '#d92b2b', D: '#ffffff' };
const TOP = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
];
const BACK = [47, 46, 45];
const FRONT = [18, 19, 20];
const RIGHT = [11, 10, 9];
const LEFT = [36, 37, 38];

export function llDiagram(state, mode = 'pll', size = 72) {
  const top = state[4];
  const fill = (i) => (mode === 'oll' ? (state[i] === top ? COLORS.U : 'var(--ll-gray)') : COLORS[state[i]] ?? '#888');
  const u = 10;
  const rects = [];
  const r = (x, y, w, h, i) => rects.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.6" fill="${fill(i)}"/>`);
  // Oben 3 × 3 (Mitte bei x/y 7…37)
  TOP.forEach((row, ry) => row.forEach((i, cx) => r(7 + cx * u, 7 + ry * u, u - 1, u - 1, i)));
  BACK.forEach((i, k) => r(7 + k * u, 1, u - 1, 5, i));
  FRONT.forEach((i, k) => r(7 + k * u, 38, u - 1, 5, i));
  LEFT.forEach((i, k) => r(1, 7 + k * u, 5, u - 1, i));
  RIGHT.forEach((i, k) => r(38, 7 + k * u, 5, u - 1, i));
  return `<svg class="ll-dia" viewBox="0 0 44 44" width="${size}" height="${size}" aria-hidden="true">${rects.join('')}</svg>`;
}

/**
 * F2L-Fall als kleine 3D-Ansicht (oben, vorne, rechts). Farbig sind nur die Mitten und das Paar
 * (Ecke und Kante des Slots vorne rechts), alles andere grau.
 */
const PAIR_CORNER = 'DFR';
const PAIR_EDGE = 'FR';
// Felder je Seite (Kociemba): U 0–8, R 9–17, F 18–26
const FACE_PTS = {
  U: (r, c) => [[c - 1.5, 1.5, r - 1.5], [c - 0.5, 1.5, r - 1.5], [c - 0.5, 1.5, r - 0.5], [c - 1.5, 1.5, r - 0.5]],
  F: (r, c) => [[c - 1.5, 1.5 - r, 1.5], [c - 0.5, 1.5 - r, 1.5], [c - 0.5, 0.5 - r, 1.5], [c - 1.5, 0.5 - r, 1.5]],
  R: (r, c) => [[1.5, 1.5 - r, 1.5 - c], [1.5, 1.5 - r, 0.5 - c], [1.5, 0.5 - r, 0.5 - c], [1.5, 0.5 - r, 1.5 - c]],
};
const FACE_OFF = { U: 0, R: 9, F: 18 };
const proj = ([x, y, z]) => [(x - z) * 0.866 * 10 + 30, (-y + (x + z) * 0.5) * 10 + 30];

/** Steine des Zustands: Feldindex → Farben aller Felder dieses Steins */
import { STICKERS } from '../cube/facelets.js';
const PIECE = STICKERS.map((s) => STICKERS.map((t, j) => (t.pos.every((v, k) => v === s.pos[k]) ? j : -1)).filter((j) => j >= 0));

/** Echte Würfelfarben (Weiß oben, Grün vorne) */
export const PHYS = { U: '#f2f2f2', R: '#d92b2b', F: '#1fa64a', D: '#ffd500', L: '#ff8a00', B: '#1e5bd6' };

/**
 * @param opts.pair    Slot des hervorgehobenen Paars aus Sicht des Bildes ('FR', 'FL', 'BR', 'BL'; Standard FR)
 * @param opts.palette Farbe je (mitten-bezogenem) Buchstaben – z. B. echte Farben in der Haltung des Lösers
 */
export function f2lDiagram(state, size = 72, opts = {}) {
  const COLORS_ = opts.palette || COLORS;
  const pairCorner = [...('D' + (opts.pair || 'FR'))].sort().join('');
  const pairEdge = [...(opts.pair || 'FR')].sort().join('');
  const polys = [];
  for (const f of ['U', 'F', 'R']) {
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const i = FACE_OFF[f] + r * 3 + c;
        const colors = PIECE[i].map((j) => state[j]).sort().join('');
        const center = r === 1 && c === 1;
        const inPair = colors === pairCorner || colors === pairEdge;
        const fill = center || inPair ? COLORS_[state[i]] : 'var(--ll-gray)';
        const pts = FACE_PTS[f](r, c);
        // leicht nach innen versetzt, damit Fugen sichtbar sind
        const mid = pts.reduce((a, p) => a.map((v, k) => v + p[k] / 4), [0, 0, 0]);
        const inset = pts.map((p) => p.map((v, k) => mid[k] + (v - mid[k]) * 0.86));
        polys.push(`<polygon points="${inset.map((p) => proj(p).map((v) => v.toFixed(1)).join(',')).join(' ')}" fill="${fill}"/>`);
      }
    }
  }
  return `<svg class="ll-dia f2l-dia" viewBox="0 0 60 64" width="${size}" height="${size}" aria-hidden="true"><polygon points="${[[-1.5, 1.5, -1.5], [1.5, 1.5, -1.5], [1.5, 1.5, 1.5], [1.5, -1.5, 1.5], [-1.5, -1.5, 1.5], [-1.5, 1.5, 1.5]].map((p) => proj(p).join(',')).join(' ')}" fill="#1a1d23"/>${polys.join('')}</svg>`;
}

/** Passende Grafik für eine Fall-ID */
import { CASE_STATE } from '../cube/ll-cases.js';
import { displayState } from '../cube/f2l-cases.js';
export function caseDiagram(id, size = 64) {
  const s = CASE_STATE[id];
  if (!s) return '';
  if (id.startsWith('F2L')) return f2lDiagram(displayState(s), size);
  return llDiagram(s, id.startsWith('OLL') ? 'oll' : 'pll', size);
}
