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
