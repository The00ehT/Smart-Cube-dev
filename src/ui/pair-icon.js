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

export function pairIcon(slot, cross, size = 24) {
  if (!slot || slot.length !== 2) return '';
  const [f, r] = frontRight(slot, cross || 'D');
  const c = (x) => PHYS[x] || '#888';
  // Isometrische Ansicht: Breite 1, Höhe 2 (Kante oben, Ecke unten)
  const front = (y0) => `<polygon points="4,${y0} 13,${y0 + 5} 13,${y0 + 14} 4,${y0 + 9}" fill="${c(f)}"/>`;
  const right = (y0) => `<polygon points="13,${y0 + 5} 22,${y0} 22,${y0 + 9} 13,${y0 + 14}" fill="${c(r)}"/>`;
  return `<svg class="pair-ic" viewBox="0 0 26 34" width="${size}" height="${Math.round(size * 1.3)}" aria-hidden="true">
    <polygon points="4,4 13,-1 22,4 13,9" fill="#1a1d23"/>
    ${front(4)}${right(4)}${front(14)}${right(14)}
    <polygon points="4,23 13,28 22,23 22,26 13,31 4,26" fill="${c(cross || 'D')}"/>
    <path d="M4 4 L13 9 L22 4 M13 9 L13 28 M4 14 L13 19 L22 14" stroke="#1a1d23" stroke-width="1" fill="none"/>
  </svg>`;
}
