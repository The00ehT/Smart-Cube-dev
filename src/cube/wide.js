/**
 * Wide Moves (r, l, u, d, f, b) und Slice-Moves (M, E, S) erkennen.
 *
 * Smartcubes melden nur Drehungen der sechs Außenseiten. Eine Wide-Move ist aber „Seite gegenüber + ganzer
 * Würfel gedreht“, z. B. r = L x. Mit Gyro-Daten lässt sich das erkennen: eine Würfeldrehung um die Achse
 * zusammen mit dem Zug der Gegenseite (zeitlich nah) ergibt genau die Wide-Move:
 *   r = L x     l = R x'    u = D y     d = U y'    f = B z     b = F z'
 * Slice-Moves ohne Gyro: M = R L' (x'), E = U D' (y'), S = F' B (z) – zwei gegenläufige Züge der
 * Gegenseiten praktisch gleichzeitig. Diese werden nur beschriftet (Anzeige), nicht ersetzt,
 * weil der Würfel sie als zwei Außenzüge zählt und die Wiedergabe sonst die Mitte verschieben würde.
 *
 * Ereignisse wie in replay.js: { kind: 'move'|'rot'|'grip', text, t (ms), i? (Zugindex), ... }
 */

/** Zug der Gegenseite + gleichzeitige Drehung → Wide-Move (Notation aus Sicht des Lösers) */
const WIDE = {
  'L|x': 'r', "L'|x'": "r'",
  'R|x\'': 'l', "R'|x": "l'",
  'D|y': 'u', "D'|y'": "u'",
  'U|y\'': 'd', "U'|y": "d'",
  'B|z': 'f', "B'|z'": "f'",
  'F|z\'': 'b', "F'|z": "b'",
};
/** Drehung (halb) aufteilen: x2 = zwei gleiche Vierteldrehungen */
const HALF = { x2: 'x', y2: 'y', z2: 'z' };

/** Gegenläufige Außenzüge (praktisch gleichzeitig) → Slice-Move */
const SLICE = {
  "R|L'": 'M', "L'|R": 'M', "R'|L": "M'", "L|R'": "M'",
  "U|D'": 'E', "D'|U": 'E', "U'|D": "E'", "D|U'": "E'",
  "F'|B": 'S', "B|F'": 'S', "F|B'": "S'", "B'|F": "S'",
};

export const WIDE_WINDOW_MS = 250;
export const SLICE_WINDOW_MS = 120;

/**
 * Würfeldrehungen (Gyro) mit dem Zug der Gegenseite zur Wide-Move zusammenfassen. Gibt eine neue Liste zurück;
 * die Wide-Move ersetzt Zug und Drehung (gleiche Wirkung, daher auch für die Wiedergabe richtig).
 */
export function mergeWide(events, window = WIDE_WINDOW_MS) {
  const out = events.map((e) => ({ ...e }));
  const dead = new Set();
  const free = (j) => !dead.has(j) && out[j].kind === 'move' && !out[j].wide;
  /** nächster freier Zug mit diesem Text im Zeitfenster um t */
  const nearest = (text, t, skipAfter) => {
    let best = -1;
    let bd = Infinity;
    for (let j = 0; j < out.length; j++) {
      if (!free(j) || out[j].text !== text || skipAfter.includes(j)) continue;
      const d = Math.abs(out[j].t - t);
      if (d <= window && d < bd) {
        bd = d;
        best = j;
      }
    }
    return best;
  };
  for (let r = 0; r < out.length; r++) {
    const rot = out[r];
    if (rot.kind !== 'rot' || dead.has(r)) continue;
    const single = HALF[rot.text] ? [HALF[rot.text], HALF[rot.text]] : [rot.text];
    const used = [];
    const picks = [];
    for (const name of single) {
      // Kandidaten: Gegenseite (Wide-Move) – nur Einträge, deren Drehung diesem Namen entspricht
      const cands = Object.entries(WIDE).filter(([k]) => k.split('|')[1] === name);
      let best = null;
      for (const [k, wide] of cands) {
        const j = nearest(k.split('|')[0], rot.t, used);
        if (j >= 0 && (!best || Math.abs(out[j].t - rot.t) < Math.abs(out[best.j].t - rot.t))) best = { j, wide };
      }
      if (!best) break;
      used.push(best.j);
      picks.push(best);
    }
    if (picks.length !== single.length) continue;
    // Mehrere Vierteldrehungen derselben Wide-Move (x2): alle müssen gleich sein
    if (picks.some((p) => p.wide !== picks[0].wide)) continue;
    for (const p of picks) {
      out[p.j].text = p.wide;
      out[p.j].wide = true;
      out[p.j].merged = rot.text;
    }
    dead.add(r);
  }
  return out.filter((_, j) => !dead.has(j));
}

/**
 * Zwei gegenläufige Außenzüge kurz hintereinander als Slice-Move beschriften:
 * der erste Zug bekommt `label` und `span: 1`, der zweite wird mit `hide` ausgeblendet.
 * (Text und Wiedergabe bleiben unverändert.)
 */
export function markSlices(events, window = SLICE_WINDOW_MS) {
  const out = events.map((e) => ({ ...e }));
  for (let j = 0; j + 1 < out.length; j++) {
    const a = out[j];
    const b = out[j + 1];
    if (a.kind !== 'move' || b.kind !== 'move' || a.wide || b.wide || a.label || b.hide) continue;
    if (Math.abs(b.t - a.t) > window) continue;
    const label = SLICE[`${a.text}|${b.text}`];
    if (!label) continue;
    a.label = label;
    a.span = 1;
    b.hide = true;
    j++;
  }
  return out;
}

/** Wide-Moves und Slice-Moves in einer fertigen Ereignisliste erkennen. `gyro`: Drehungen wurden gemessen. */
export function detectWide(events, { gyro = false } = {}) {
  let ev = events;
  if (gyro) ev = mergeWide(ev);
  return markSlices(ev);
}

/** Anzahl erkannter Wide-/Slice-Moves (zum Anzeigen) */
export const wideCount = (events) => events.filter((e) => e.wide || e.label).length;
