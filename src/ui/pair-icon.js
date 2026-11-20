/**
 * F2L-Paar als kleiner 3D-Block (Ecke unten, Kante darüber – wie im Slot):
 * vorne und rechts die beiden Seitenfarben, unten die Kreuzfarbe.
 */
import { SOLVED, applyAnyAlg, CROSS_DOWN } from '../cube/facelets.js';
import { PHYS } from './ll-diagram.js';

const Y = ['', 'y', 'y2', "y'"];

/** Welche der beiden Seitenfarben ist vorne, welche rechts, wenn der Slot vorne rechts liegt? */
function frontRight(slot, cross) {
  const [a, b] = [...slot];
  for (const r of Y) {
    const s = applyAnyAlg(SOLVED, `${CROSS_DOWN[cross] || ''} ${r}`);
    const f = s[22];
    const rt = s[13];
    if ((f === a && rt === b) || (f === b && rt === a)) return [f, rt];
  }
  return [a, b];
}

/**
 * Liegender 2×1-Block: links die Kante, rechts die Ecke. Vorne und oben die beiden Paarfarben,
 * rechts an der Ecke die Kreuzfarbe – so sieht man keine schwarzen (stickerlosen) Flächen.
 */
export function pairIcon(slot, cross, size = 26) {
  if (!slot || slot.length !== 2) return '';
  const [f, r] = frontRight(slot, cross || 'D');
  const col = (x) => PHYS[x] || '#888';
  const S = 7;
  const P = ([x, y, z]) => [((x - z) * 0.866 * S + 9).toFixed(1), ((-y + (x + z) * 0.5) * S + 10).toFixed(1)];
  const quad = (pts, fill) => {
    // leicht nach innen versetzt: Fugen zwischen den Feldern
    const m = pts.reduce((a, p) => a.map((v, k) => v + p[k] / 4), [0, 0, 0]);
    const q = pts.map((p) => p.map((v, k) => m[k] + (v - m[k]) * 0.88));
    return `<polygon points="${q.map((p) => P(p).join(',')).join(' ')}" fill="${fill}" stroke="rgb(0 0 0 / 0.35)" stroke-width="0.5"/>`;
  };
  const cells = [];
  for (const x0 of [0, 1]) {
    cells.push(quad([[x0, 1, 0], [x0 + 1, 1, 0], [x0 + 1, 1, 1], [x0, 1, 1]], col(r))); // oben
    cells.push(quad([[x0, 1, 1], [x0 + 1, 1, 1], [x0 + 1, 0, 1], [x0, 0, 1]], col(f))); // vorne
  }
  cells.push(quad([[2, 1, 1], [2, 1, 0], [2, 0, 0], [2, 0, 1]], col(cross || 'D'))); // rechts: Kreuzfarbe der Ecke
  return `<svg class="pair-ic" viewBox="0 0 26 22" width="${size}" height="${Math.round(size * 0.85)}" aria-hidden="true">${cells.join('')}</svg>`;
}
