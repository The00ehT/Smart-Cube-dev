/**
 * Leichte Scrambles: zufälliger Würfelzustand, bei dem einige Kreuzkanten (und ggf. ein F2L-Paar)
 * schon gelöst sind. Daraus berechnet der Löser von cubing.js die Zugfolge (siehe main.js).
 *
 *   'cross2'  zwei Kreuzkanten gelöst – das Kreuz ist kurz
 *   'xcross'  zwei Kreuzkanten und ein F2L-Paar gelöst – ein X-Cross lässt sich in der Inspektion planen
 */
import { EDGE_NAMES, CORNER_NAMES, faceletsToPatternData, patternDataToFacelets } from './facelets.js';

const sameLetters = (a, b) => a.length === b.length && [...a].every((c) => b.includes(c));
const parity = (p) => {
  let c = 0;
  for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) if (p[i] > p[j]) c++;
  return c % 2;
};
const shuffle = (a, rnd) => {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
};

/** Steine an ihren Platz setzen (Platz s bekommt Stein s mit Orientierung 0) */
function place(orbit, slots) {
  for (const s of slots) {
    const j = orbit.pieces.indexOf(s);
    [orbit.pieces[s], orbit.pieces[j]] = [orbit.pieces[j], orbit.pieces[s]];
    [orbit.orientation[s], orbit.orientation[j]] = [orbit.orientation[j], orbit.orientation[s]];
    orbit.orientation[s] = 0;
  }
}

/** Ist ein Zustand (Daten wie KPattern) ein erreichbarer Würfelzustand? */
export function isValidPattern(d) {
  const eo = d.EDGES.orientation.reduce((a, b) => a + b, 0) % 2;
  const co = d.CORNERS.orientation.reduce((a, b) => a + b, 0) % 3;
  return eo === 0 && co === 0 && parity(d.EDGES.pieces) === parity(d.CORNERS.pieces);
}

/**
 * @param state Zufälliger Zustand (Facelets), z. B. aus einem WCA-Scramble
 * @param face  Kreuzseite (Körpersystem: U = Weiß …)
 * @param level 'cross2' | 'xcross'
 * @returns Zielzustand (Facelets)
 */
export function easyState(state, face, level, rnd = Math.random) {
  const d = faceletsToPatternData(state);
  const crossEdges = EDGE_NAMES.map((n, i) => (n.includes(face) ? i : -1)).filter((i) => i >= 0);
  const fixEdges = shuffle(crossEdges, rnd).slice(0, 2);
  const fixCorners = [];
  if (level === 'xcross') {
    // Ein Slot: Ecke mit der Kreuzseite und die passende Mittelschicht-Kante
    const corners = CORNER_NAMES.map((n, i) => (n.includes(face) ? i : -1)).filter((i) => i >= 0);
    const c = corners[Math.floor(rnd() * corners.length)];
    const sides = [...CORNER_NAMES[c]].filter((ch) => ch !== face).join('');
    fixCorners.push(c);
    fixEdges.push(EDGE_NAMES.findIndex((n) => sameLetters(n, sides)));
  }
  place(d.EDGES, fixEdges);
  place(d.CORNERS, fixCorners);
  // Gültig machen mit freien Steinen
  const freeE = shuffle([...Array(12).keys()].filter((i) => !fixEdges.includes(i)), rnd);
  const freeC = shuffle([...Array(8).keys()].filter((i) => !fixCorners.includes(i)), rnd);
  if (parity(d.EDGES.pieces) !== parity(d.CORNERS.pieces)) {
    const [a, b] = freeE;
    [d.EDGES.pieces[a], d.EDGES.pieces[b]] = [d.EDGES.pieces[b], d.EDGES.pieces[a]];
    [d.EDGES.orientation[a], d.EDGES.orientation[b]] = [d.EDGES.orientation[b], d.EDGES.orientation[a]];
  }
  const eo = d.EDGES.orientation.reduce((x, y) => x + y, 0) % 2;
  if (eo) d.EDGES.orientation[freeE[2]] ^= 1;
  const co = d.CORNERS.orientation.reduce((x, y) => x + y, 0) % 3;
  if (co) d.CORNERS.orientation[freeC[0]] = (d.CORNERS.orientation[freeC[0]] + 3 - co) % 3;
  if (!isValidPattern(d)) throw new Error('Leichter Scramble: ungültiger Zustand');
  return patternDataToFacelets(d);
}
