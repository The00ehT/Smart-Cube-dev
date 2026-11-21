/**
 * Solve-Analyse: Was wäre bei diesem Solve besser gegangen?
 *   Cross   – optimales Kreuz (und X-Cross) für das Scramble, auch mit anderen Farben
 *   F2L     – je Paar: welcher Fall, wie kurz der Datenbank-Algorithmus ist, ob ein anderes Paar leichter war
 *           + Vorausschau: anderes Paar / anderer Alg, damit das nächste Paar leichter wird;
 *             beim letzten Paar Kanten oben (EO) und OLL mitdenken
 *   OLL/PLL – direkter Algorithmus gegen die tatsächlichen Züge (erkennt z. B. 2-Look)
 * Alles wird aus Startzustand und Zügen berechnet, funktioniert also für jeden gespeicherten Solve.
 */
import { FACES, SOLVED, applyMove, applyAnyAlg, flattenAlg, translateMoves, mirrorState, mirrorAlg, tokenizeAlg, parseAnyMove, phaseStatus, solvedSlots, F2L_SLOTS, CROSS_DOWN } from './cube/facelets.js';
import { analyzeSolve } from './cube/analysis.js';
import { solveCross, solveXCross } from './cube/cross-solver.js';
import { f2lKey } from './cube/f2l-cases.js';
import { F2L_CASES, dbAlgs } from './cube/alg-db.js';
import { identifyOll, identifyPll, relabelToCenters, recenter, f2lSolved, llOriented } from './cube/ll-cases.js';

const FR = F2L_SLOTS.D.findIndex((s) => [...s.faces].sort().join('') === 'FR');
const FR_BIT = 1 << FR;
const Y = ['', 'y', 'y2', "y'"];
// Lage des Slots aus Sicht der Haltung: d = (Haltung, in der der Slot vorne rechts liegt) − (tatsächliche Haltung)
const POS = ['FR', 'BR', 'BL', 'FL'];
const mod4 = (n) => ((n % 4) + 4) % 4;
/** y-Schritte einer Gyro-Drehung wie "y", "y'", "y2" (x/z zählen hier nicht) */
const ySteps = (name) => tokenizeAlg(name || '').reduce((a, t) => a + (t === 'y' ? 1 : t === "y'" ? -1 : t === 'y2' ? 2 : 0), 0);
const AUF = ['', 'U', 'U2', "U'"];
/**
 * Zug-Kosten für die Auswahl von Vorschlägen: Einsetzer mit F-Zügen sind mit den Fingertricks aufwendiger als
 * R-/U-Zeiten (R U R', Sexy-Move …). Je F-Zug zählen daher 0,6 Züge extra – nur für die Rangfolge,
 * angezeigt und gezählt wird weiter die echte Zugzahl.
 */
export const F_PENALTY = 0.6;
export const fMoves = (alg) => tokenizeAlg(alg).filter((t) => t[0] === 'F').length;
export const moveCost = (len, alg) => len + F_PENALTY * fMoves(alg);

/** Züge ohne Würfeldrehungen (x, y, z zählen nicht) */
export const moveCount = (alg) => tokenizeAlg(alg).filter((t) => !/^[xyz]/.test(t) && parseAnyMove(t)).length;

/** Der Würfel meldet R2 als „R R“: gleichsinnige Doppelzüge zusammenfassen (Umwege wie „R R'“ bleiben sichtbar) */
export function mergeDoubles(list) {
  const out = [];
  for (const m of list) {
    const last = out.at(-1);
    if (last && last === m && !m.includes('2')) out[out.length - 1] = m[0] + '2';
    else out.push(m);
  }
  return out;
}

/** Zustand mit Kreuzfarbe unten (plus Drehung), Farben auf die Mitten bezogen */
const view = (state, face, extra = '') => relabelToCenters(applyAnyAlg(state, `${CROSS_DOWN[face]} ${extra}`));
/** Original-Farbe vorne/rechts in dieser Haltung */
const holdColors = (state, face, extra = '') => {
  const s = applyAnyAlg(state, `${CROSS_DOWN[face]} ${extra}`);
  return { up: s[4], down: s[31], front: s[22], right: s[13], left: s[40], back: s[49] };
};

/** Algs nur aus Seitenzügen (ohne r, M, x/y/z …): genau so am Würfel ausführbar, wie er dasteht.
 *  Doppelte (z. B. „y' R U R'“ = „F U F'“) fallen weg; ungültige werden übersprungen. */
const flatCache = new Map();
function flatAlgs(list) {
  const out = [];
  for (const a of list) {
    if (!flatCache.has(a)) {
      let f = null;
      try {
        f = flattenAlg(a);
      } catch {
        f = null;
      }
      flatCache.set(a, f);
    }
    const f = flatCache.get(a);
    if (f && !out.includes(f)) out.push(f);
  }
  return out;
}

/** Bester Datenbank-Algorithmus für den FR-Slot (mit AUF vorab), sonst null */
export function bestPair(s, extraAlgs = () => []) {
  if (solvedSlots(s, 'D') & FR_BIT) return null;
  const key = f2lKey(s);
  const c = F2L_CASES.find((x) => x.key === key);
  if (!c) return { stuck: true };
  const keep = solvedSlots(s, 'D');
  let best = null;
  for (const alg of flatAlgs([...dbAlgs(c.id), ...extraAlgs(c.id)])) {
    for (const auf of AUF) {
      const after = recenter(applyAnyAlg(s, `${auf} ${alg}`));
      const mask = solvedSlots(after, 'D');
      if (!phaseStatus(after).D.cross || !(mask & FR_BIT) || (mask & keep) !== keep) continue;
      const len = moveCount(alg) + (auf ? 1 : 0);
      const full = `${auf} ${alg}`.trim();
      const cost = moveCost(len, full);
      if (!best || cost < best.cost) best = { id: c.id, alg: full, len, cost };
      break;
    }
  }
  return best ?? { id: c.id, stuck: true };
}

/** Alle Datenbank-Varianten, die den FR-Slot lösen (je Alg die erste passende AUF): [{ id, alg, len, after }] */
export function pairVariants(s, extraAlgs) {
  const keep = solvedSlots(s, 'D');
  if (keep & FR_BIT) return [];
  const c = F2L_CASES.find((x) => x.key === f2lKey(s));
  if (!c) return [];
  const out = [];
  const seen = new Set();
  for (const alg of flatAlgs([...dbAlgs(c.id), ...extraAlgs(c.id)])) {
    for (const auf of AUF) {
      const full = `${auf} ${alg}`.trim();
      if (seen.has(full)) break;
      const after = recenter(applyAnyAlg(s, full));
      const mask = solvedSlots(after, 'D');
      if (!phaseStatus(after).D.cross || !(mask & FR_BIT) || (mask & keep) !== keep) continue;
      seen.add(full);
      const len = moveCount(alg) + (auf ? 1 : 0);
      out.push({ id: c.id, alg: full, len, cost: moveCost(len, full), after });
      break;
    }
  }
  return out;
}
const yView = (s, r) => (r ? relabelToCenters(applyAnyAlg(s, r)) : s);
/** Varianten für den Slot vorne rechts von sv – direkt (rechte Hand) und gespiegelt von vorne links (linke Hand).
 *  k = y-Schritte gegenüber sv für die Haltung, in der der Alg gilt. */
function slotVariants(sv, extraAlgs) {
  const out = pairVariants(sv, extraAlgs).map((v) => ({ ...v, dk: 0, mirrored: false }));
  const left = yView(sv, 'y'); // Slot liegt jetzt vorne links
  for (const v of pairVariants(mirrorState(left), extraAlgs)) {
    const a = mirrorAlg(v.alg);
    out.push({ id: v.id, alg: a, len: v.len, cost: moveCost(v.len, a), after: recenter(applyAnyAlg(left, a)), dk: 1, mirrored: true });
  }
  return out;
}
/** Kürzestes nächstes Paar (Datenbank, beide Hände, jede Haltung); 0 = F2L fertig */
function nextPairLen(s, extraAlgs, cache) {
  if (cache.has(s)) return cache.get(s);
  let best = Infinity;
  let open = false;
  for (const r of Y) {
    const v = yView(s, r);
    if (solvedSlots(v, 'D') & FR_BIT) continue;
    open = true;
    for (const t of [v, mirrorState(yView(v, "y"))]) {
      const b = bestPair(t, extraAlgs);
      if (b && !b.stuck && b.len < best) best = b.len;
    }
  }
  const res = open ? best : 0;
  cache.set(s, res);
  return res;
}
/** Kanten der letzten Schicht richtig orientiert (U-Farbe oben): 0, 2 oder 4 */
const eoCount = (s) => [1, 3, 5, 7].filter((i) => s[i] === s[4]).length;
const OPP = { U: 'D', D: 'U', R: 'L', L: 'R', F: 'B', B: 'F' };
/** Dasselbe direkt am Würfel gezählt (ohne Umrechnung in die Haltung): Seite gegenüber dem Kreuz */
const eoPhysical = (state, cross) => {
  const f = FACES.indexOf(OPP[cross]) * 9;
  return [1, 3, 5, 7].filter((i) => state[f + i] === state[f + 4]).length;
};
/** Gelöste Slots (Bitmaske → Menge) */
const slotsIn = (s) => {
  const m = solvedSlots(s, 'D');
  return new Set([0, 1, 2, 3].filter((i) => m & (1 << i)));
};

/** Bester Algorithmus für OLL/PLL im Zustand s (Kreuz unten); done prüft das Ergebnis */
function bestLl(id, s, done, extraAlgs) {
  let best = null;
  for (const alg of flatAlgs([...dbAlgs(id), ...extraAlgs(id)])) {
    for (const auf of AUF) {
      let after = recenter(applyAnyAlg(s, `${auf} ${alg}`));
      let post = '';
      if (!done(after)) continue;
      // PLL: am Ende noch die letzte Schicht drehen?
      if (id.startsWith('PLL') && after !== SOLVED) post = AUF.find((u) => u && applyAnyAlg(after, u) === SOLVED) || '';
      const len = moveCount(alg) + (auf ? 1 : 0) + (post ? 1 : 0);
      if (!best || len < best.len) best = { id, alg: [auf, alg, post].filter(Boolean).join(' '), len };
      break;
    }
  }
  return best;
}

/**
 * @param solve gespeicherter Solve mit start, solution, times
 * @param opts.extraAlgs(id) eigene Algorithmen des Nutzers zusätzlich prüfen
 */
export function solveInsights(solve, opts = {}) {
  const extraAlgs = opts.extraAlgs || (() => []);
  const moves = solve.solution.split(' ').filter(Boolean);
  // Eigene Züge einer Phase in der Haltung der Analyse (Kreuz unten, ggf. y-Drehung)
  let face0 = null;
  const userAlg = (p, r) => (p.moves ? mergeDoubles(translateMoves(moves.slice(p.start, p.end + 1), `${CROSS_DOWN[face0]} ${r}`.trim())).join(' ') : '');
  const a = analyzeSolve(solve.start, moves, solve.times);
  const face = a.crossFace;
  face0 = face;
  const states = [solve.start];
  for (const m of moves) states.push(applyMove(states[states.length - 1], m));
  const ph = a.phases;
  const out = { crossFace: face, xcross: a.xcross, phases: ph };

  // ---------- Cross ----------
  const start = solve.start;
  const colors = FACES.map((f) => {
    const c = solveCross(view(start, f));
    return { face: f, len: c.length, moves: c.moves.join(' '), hold: holdColors(start, f) };
  });
  // Haltung beim Cross (welche Farbe vorne) – einstellbar wie bei den Paaren
  const ck = opts.fronts?.cross != null ? mod4(opts.fronts.cross) : null;
  let mine = colors.find((c) => c.face === face);
  if (ck != null) {
    const c = solveCross(view(start, face, Y[ck]));
    mine = { ...mine, moves: c.moves.join(' '), len: c.length, hold: holdColors(start, face, Y[ck]) };
  }
  // X-Cross: Paar immer in den Slot hinten links (vorne bleibt frei für die nächsten Paare).
  // Dafür die Haltung (y-Drehung) wählen, in der das günstigste Paar hinten links liegt –
  // oder die eingestellte Haltung nehmen.
  let x = null;
  // Hat der Nutzer selbst ein X-Cross gemacht, zählt jeder Slot (alle Haltungen) – sonst wäre „optimal“ evtl. länger als seins
  const xHolds = ck != null && !a.xcross ? [Y[ck]] : Y;
  try {
    for (const r of xHolds) {
      const cand = solveXCross(view(start, face, r), { slots: ['BL'], maxDepth: x ? x.length - 1 : 11 });
      if (cand && (!x || cand.length < x.length)) x = { ...cand, r, hold: holdColors(start, face, r) };
    }
  } catch {
    x = null;
  }
  out.cross = {
    user: ph[0].moves,
    optimal: mine,
    xcross: x && { len: x.length, moves: x.moves.join(' '), complete: x.complete, hold: x.hold, pair: x.hold.left + x.hold.back, r: x.r },
    userMoves: userAlg(ph[0], ck != null ? Y[ck] : ''),
    frontOptions: Y.map((r) => holdColors(start, face, r).front),
    holdK: ck ?? 0,
    source: ck != null ? 'set' : 'assumed',
    colors,
    bestColor: colors.reduce((p, c) => (c.len < p.len ? c : p)),
  };
  // Eingestellte Kreuzfarben: nur diese vergleichen (eine Farbe → kein Farbvergleich, er wäre nur Rauschen)
  const mineSet = (opts.crossColors || []).filter((f) => FACES.includes(f));
  if (mineSet.length) {
    const own = colors.filter((c) => mineSet.includes(c.face) || c.face === face);
    out.cross.colors = own.length > 1 ? own : [];
    out.cross.bestColor = own.reduce((p, c) => (c.len < p.len ? c : p));
  }
  // Bei X-Cross mit X-Cross vergleichen, sonst mit dem Kreuz.
  // Wurden mit dem Kreuz gleich mehrere Paare fertig (XX-Cross …), gibt es keinen fairen Vergleich.
  out.cross.multi = ph[1].moves === 0 && ph[2].moves === 0;
  // X-Cross ohne gefundene Referenz (Suche abgebrochen): keine Ersparnis behaupten
  const crossRef = a.xcross ? x?.length : mine.len;
  out.cross.saved = out.cross.multi || crossRef == null ? 0 : Math.max(0, ph[0].moves - crossRef);

  // ---------- F2L ----------
  // Haltung je Paar (welche Farbe vorne): selbst eingestellt, sonst aus dem Gyroskop (gemessene y-Drehungen),
  // sonst angenommen „Slot vorne rechts“. Daraus: Slot-Lage, Alg ohne Drehung, Bewertung der Rotations.
  const fronts = opts.fronts || {};
  // Drehungen des Würfels: gemessen (Gyro) oder von Hand in der Rekonstruktion eingetragen (solve.rots: { Zugindex: 'y' })
  // – auch mitten in einem Paar. Nur y-Schritte ändern die Haltung („vorne“).
  const gyroRots = solve.gyro?.rotations || null;
  const manualRots = Object.entries(solve.rots || {})
    .map(([i, name]) => ({ i: Number(i), t: solve.times[Number(i)] ?? 0, name }))
    .filter((r) => r.i > 0 && ySteps(r.name) !== 0)
    .sort((a, b) => a.t - b.t);
  const rotList = gyroRots || (manualRots.length ? manualRots : null);
  const rotsIn = (t0, t1) => (rotList ? rotList.filter((r) => r.t > t0 && r.t <= t1) : []);
  const stepsBetween = (t0, t1) => rotsIn(t0, t1).reduce((a, r) => a + ySteps(r.name), 0);
  /** Eigene Züge einer Phase; bei Drehungen mittendrin wechselt die Haltung ab dem Zug danach */
  const userAlgHold = (p, hk) => {
    if (!p.moves) return '';
    const mids = rotsIn(solve.times[p.start] ?? 0, solve.times[p.end] ?? 0);
    if (!mids.length) return userAlg(p, Y[hk]);
    let cur = hk;
    let from = p.start;
    const parts = [];
    for (const r of mids) {
      // erster Zug ab der Drehung (Handeintrag: genau dieser Zug)
      let j = r.i ?? solve.times.findIndex((t, idx) => idx > from && t >= r.t);
      if (j == null || j < 0 || j <= from || j > p.end) continue;
      parts.push(mergeDoubles(translateMoves(moves.slice(from, j), `${CROSS_DOWN[face0]} ${Y[cur]}`.trim())).join(' '));
      parts.push(r.name);
      cur = mod4(cur + ySteps(r.name));
      from = j;
    }
    parts.push(mergeDoubles(translateMoves(moves.slice(from, p.end + 1), `${CROSS_DOWN[face0]} ${Y[cur]}`.trim())).join(' '));
    return parts.filter(Boolean).join(' ');
  };
  /** Vorschlag für das Paar aus Haltung k (Slot liegt dort an POS[d]) */
  const inHold = (before, k, rt) => {
    const pos = POS[mod4(rt - k)];
    let b;
    let rot = '';
    if (pos === 'FR') b = bestPair(view(before, face, Y[k]), extraAlgs);
    else if (pos === 'FL') {
      b = bestPair(mirrorState(view(before, face, Y[k])), extraAlgs);
      if (b && !b.stuck) b = { ...b, alg: mirrorAlg(b.alg), mirrored: true };
    } else {
      // Hinten ohne Drehung: der gegenüberliegende vordere Slot (hinten rechts ↔ vorne links) um y2 übersetzt,
      // z. B. U' R' U' R. Gut ausführbar, solange keine B-Züge entstehen – sonst lieber kurz drehen.
      const opp = view(before, face, Y[mod4(k + 2)]);
      let a = pos === 'BR' ? bestPair(mirrorState(opp), extraAlgs) : bestPair(opp, extraAlgs);
      if (a && !a.stuck && pos === 'BR') a = { ...a, alg: mirrorAlg(a.alg) };
      const toks = a && !a.stuck ? tokenizeAlg(a.alg) : null;
      const plain = toks && toks.every((t) => /^[URFDLB][2']?$/.test(t));
      const noRot = plain ? translateMoves(toks, 'y2') : null;
      if (noRot && !noRot.some((t) => t[0] === 'B')) b = { ...a, alg: noRot.join(' '), back: true };
      else if (pos === 'BR') {
        rot = 'y'; // y bringt den Slot nach vorne rechts
        b = bestPair(view(before, face, Y[mod4(k + 1)]), extraAlgs);
      } else {
        rot = "y'"; // y' bringt den Slot nach vorne links → gespiegelt
        b = bestPair(mirrorState(view(before, face, Y[mod4(k + 3)])), extraAlgs);
        if (b && !b.stuck) b = { ...b, alg: mirrorAlg(b.alg), mirrored: true };
      }
    }
    if (b && !b.stuck && rot) b = { ...b, alg: `${rot} ${b.alg}` };
    return b ? { ...b, pos, rot } : null;
  };
  out.pairs = [];
  out.rotations = { count: 0, unnecessary: 0, mid: 0, known: !!rotList };
  // Haltung am Ende der letzten Phase mit Zügen (nach Drehungen mittendrin) und deren Zeit
  let prevK = null;
  let prevT = 0;
  for (let k = 1; k <= 4; k++) {
    const p = ph[k];
    const entry = { k, slot: p.slot, moves: p.moves, time: p.time };
    out.pairs.push(entry);
    if (p.moves === 0) {
      entry.free = true; // im Kreuz (X-Cross) oder zusammen mit einem anderen Paar gelöst
      continue;
    }
    const before = states[p.start];
    const after = states[p.end + 1];
    const options = Y.map((r) => ({ r, s0: view(before, face, r), s1: view(after, face, r), hold: holdColors(before, face, r) }));
    const ti = options.findIndex((o) => !(solvedSlots(o.s0, 'D') & FR_BIT) && solvedSlots(o.s1, 'D') & FR_BIT);
    const rt = ti < 0 ? 0 : ti;
    const tStart = solve.times[p.start] ?? 0;
    // Haltung bestimmen
    let hk;
    let source;
    if (fronts[k] != null) {
      hk = mod4(fronts[k]);
      source = 'set';
    } else if (rotList && prevK != null) {
      hk = mod4(prevK + stepsBetween(prevT, tStart));
      source = gyroRots ? 'gyro' : 'set';
    } else {
      hk = rt;
      source = gyroRots ? 'gyro' : 'assumed';
    }
    entry.holdK = hk;
    entry.source = source;
    entry.frontOptions = options.map((o) => o.hold.front);
    entry.front = options[hk].hold.front;
    entry.hold = options[hk].hold;
    const sug = inHold(before, hk, rt);
    entry.best = sug && !sug.stuck ? sug : sug?.stuck ? { stuck: true, id: sug.id } : null;
    entry.pos = POS[mod4(rt - hk)];
    // Bild des Falls aus deiner Haltung: Stand vor dem Paar, das Paar an seiner echten Stelle
    entry.dia = { state: options[hk].s0, pair: entry.pos, hold: options[hk].hold };
    entry.userMoves = userAlgHold(p, hk);
    // Drehungen mitten im Paar (der Slot wird z. B. nach dem Zug gedreht, um besser einzusetzen)
    const tEnd = solve.times[p.end] ?? tStart;
    const mids = rotsIn(tStart, tEnd);
    if (mids.length) {
      entry.midRot = mids.map((r) => r.name);
      out.rotations.mid += mids.length;
    }
    // Drehung vor diesem Paar? (nur bewerten, wenn die Haltungen bekannt sind)
    if (prevK != null && (rotList || fronts[k] != null)) {
      const steps = mod4(hk - prevK);
      if (steps) {
        out.rotations.count++;
        const without = inHold(before, prevK, rt);
        entry.rotation = { name: Y[steps], fromFront: options[prevK].hold.front, without: without && !without.stuck ? without : null };
        // Unnötig, wenn der Slot von der alten Haltung aus vorne lag (vorne rechts/links geht ohne Drehung)
        if (without && !without.stuck && !without.rot) {
          entry.rotation.unnecessary = true;
          out.rotations.unnecessary++;
        }
      }
    }
    prevK = mod4(hk + stepsBetween(tStart, tEnd));
    prevT = tEnd;
    // Leichteres Paar zu diesem Zeitpunkt? (Vergleich je Fall von vorne rechts aus)
    const evals = options.map((o) => ({ ...o, best: bestPair(o.s0, extraAlgs) }));
    const mineEval = evals[rt];
    const others = evals.filter((o) => o !== mineEval && o.best && !o.best.stuck);
    const easiest = others.reduce((b, o) => (!b || o.best.cost < b.best.cost ? o : b), null);
    const myLen = entry.best && !entry.best.stuck ? entry.best.len : Infinity;
    if (easiest && easiest.best.len + 2 <= Math.min(myLen, p.moves)) entry.easier = { ...easiest.best, hold: easiest.hold };
    entry.saved = entry.best && !entry.best.stuck ? Math.max(0, p.moves - entry.best.len) : 0;

    // ---- Vorausschau: anderes Paar / anderer Alg, damit das nächste Paar (bzw. OLL) leichter wird ----
    const lastPair = f2lSolved(view(after, face));
    const cands = [];
    for (let j = 0; j < 4; j++) {
      if (lastPair && j !== rt) continue; // beim letzten Paar gibt es keine Wahl des Slots
      for (const v of slotVariants(options[j].s0, extraAlgs)) cands.push({ ...v, slotK: j, k: mod4(j + v.dk) });
    }
    const pickBase = (list, score) => list.filter((c) => c.slotK === rt).sort((a, b) => a.cost - b.cost || score(a) - score(b))[0];
    const holdInfo = (c) => ({ hold: holdColors(before, face, Y[c.k]), pairHold: options[c.slotK].hold });
    if (!lastPair && cands.length) {
      const cache = new Map();
      for (const c of cands) {
        c.next = nextPairLen(c.after, extraAlgs, cache);
        c.total = c.len + c.next;
      }
      const base = pickBase(cands, (c) => c.total);
      for (const c of cands) c.score = c.total + F_PENALTY * fMoves(c.alg);
      const best = cands.filter((c) => Number.isFinite(c.total)).sort((a, b) => a.score - b.score || (b.slotK === rt) - (a.slotK === rt) || a.len - b.len)[0];
      if (base && best && Number.isFinite(base.total) && base.total - best.total >= 2) {
        entry.lookahead = {
          sameSlot: best.slotK === rt,
          id: best.id,
          alg: best.alg,
          len: best.len,
          next: best.next,
          total: best.total,
          baseAlg: base.alg,
          baseLen: base.len,
          baseNext: base.next,
          baseTotal: base.total,
          mirrored: best.mirrored,
          ...holdInfo(best),
        };
        if (!entry.lookahead.sameSlot) entry.easier = null; // die Vorausschau ersetzt den einfachen Vergleich
      }
    }
    // ---- Letztes Paar: Kanten oben (EO) und OLL gleich mitdenken ----
    if (lastPair) {
      const ollOf = (s) => {
        if (!f2lSolved(s)) return null;
        if (llOriented(s)) return { n: null, len: 0, eo: 4, skip: true };
        const n = identifyOll(s);
        const b = n ? bestLl(`OLL ${n}`, s, (t) => f2lSolved(t) && llOriented(t), extraAlgs) : null;
        return { n, len: b ? b.len : Infinity, eo: eoCount(s), skip: false };
      };
      const mineOll = ollOf(view(after, face));
      const scored = cands.map((c) => ({ ...c, oll: ollOf(c.after) })).filter((c) => c.oll && Number.isFinite(c.oll.len));
      for (const c of scored) {
        c.total = c.len + c.oll.len;
        c.score = c.total + F_PENALTY * fMoves(c.alg);
      }
      const base = pickBase(scored, (c) => c.score);
      const best = [...scored].sort((a, b) => a.score - b.score || b.oll.eo - a.oll.eo || a.len - b.len)[0];
      const bestEo = [...scored].sort((a, b) => b.oll.eo - a.oll.eo || a.total - b.total)[0];
      entry.eo = { last: true, mine: mineOll };
      if (base && best && base.total - best.total >= 2) entry.eo.better = { id: best.id, alg: best.alg, len: best.len, oll: best.oll, total: best.total, baseTotal: base.total, baseOll: base.oll, baseAlg: base.alg, mirrored: best.mirrored, ...holdInfo(best) };
      // Alle Kanten richtig ohne (viel) Mehraufwand?
      if (bestEo && base && bestEo.oll.eo === 4 && base.oll.eo < 4 && bestEo !== best && bestEo.total <= base.total + 1)
        entry.eo.allEdges = { id: bestEo.id, alg: bestEo.alg, len: bestEo.len, oll: bestEo.oll, total: bestEo.total, baseTotal: base.total, mirrored: bestEo.mirrored, ...holdInfo(bestEo) };
    }

    // ---- Gegenprobe: jeden Vorschlag vom echten Stand aus in der angezeigten Haltung ausführen ----
    // Stimmt das Ergebnis nicht mit der Ankündigung überein, wird der Vorschlag weggelassen statt falsch angezeigt.
    const kOf = (hold) => options.findIndex((o) => o.hold.front === hold.front);
    const run = (k, alg) => (k < 0 ? null : recenter(applyAnyAlg(options[k].s0, alg)));
    const solvesPair = (k, alg) => {
      const s0 = options[k]?.s0;
      const s1 = run(k, alg);
      if (!s0 || !s1 || !phaseStatus(s1).D.cross) return false;
      const a0 = slotsIn(s0);
      const a1 = slotsIn(s1);
      return a1.size > a0.size && [...a0].every((x) => a1.has(x));
    };
    if (entry.best && !entry.best.stuck && !solvesPair(hk, entry.best.alg)) {
      entry.best = null;
      entry.saved = 0;
    }
    if (entry.easier && !solvesPair(kOf(entry.easier.hold), entry.easier.alg)) entry.easier = null;
    if (entry.lookahead) {
      const la = entry.lookahead;
      const k = kOf(la.hold);
      const s1 = solvesPair(k, la.alg) ? run(k, la.alg) : null;
      if (!s1 || nextPairLen(s1, extraAlgs, new Map()) !== la.next) entry.lookahead = null;
    }
    if (entry.eo) {
      for (const key of ['better', 'allEdges']) {
        const x = entry.eo[key];
        if (!x) continue;
        const s1 = run(kOf(x.hold), x.alg);
        const ok = s1 && f2lSolved(s1) && eoCount(s1) === x.oll.eo && (x.oll.skip ? llOriented(s1) : identifyOll(s1) === x.oll.n);
        if (!ok) delete entry.eo[key];
      }
      // Deine eigene Kanten-Zahl: zweite, unabhängige Zählung direkt am Würfel (Seite gegenüber dem Kreuz, Mitten fest)
      const real = eoPhysical(after, face);
      if (entry.eo.mine && entry.eo.mine.eo !== real) entry.eo.mine = { ...entry.eo.mine, eo: real, n: null, len: Infinity };
    }
  }

  // ---------- OLL / PLL ----------
  const llAt = (i) => view(states[i], face);
  const oll = ph[5];
  const pll = ph[6];
  out.oll = { moves: oll.moves, time: oll.time, recog: oll.recog, skip: oll.skip, userMoves: userAlg(oll, '') };
  out.pll = { moves: pll.moves, time: pll.time, recog: pll.recog, skip: pll.skip, userMoves: userAlg(pll, '') };
  // Haltung (vorne) bei OLL/PLL: selbst eingestellt, sonst aus den Drehungen (Gyro/Rekonstruktion), sonst unten geschätzt
  for (const [key, l, p] of [['oll', out.oll, oll], ['pll', out.pll, pll]]) {
    if (!p.moves) continue;
    const tStart = solve.times[p.start] ?? 0;
    const tEnd = solve.times[p.end] ?? tStart;
    l.frontOptions = Y.map((r) => holdColors(states[p.start], face, r).front);
    let hk = null;
    if (fronts[key] != null) {
      hk = mod4(fronts[key]);
      l.source = 'set';
    } else if (rotList && prevK != null) {
      hk = mod4(prevK + stepsBetween(prevT, tStart));
      l.source = gyroRots ? 'gyro' : 'set';
    }
    if (hk == null) continue;
    l.holdK = hk;
    l.view = Y[hk];
    l.userMoves = userAlgHold(p, hk);
    const mids = rotsIn(tStart, tEnd);
    if (mids.length) l.midRot = mids.map((r) => r.name);
    prevK = mod4(hk + stepsBetween(tStart, tEnd));
    prevT = tEnd;
  }
  if (!oll.skip) {
    const s = llAt(oll.start);
    const n = f2lSolved(s) ? identifyOll(s) : null;
    if (n) out.oll.best = bestLl(`OLL ${n}`, s, (t) => f2lSolved(t) && llOriented(t), extraAlgs);
  }
  if (!pll.skip) {
    const s = llAt(pll.start);
    const n = f2lSolved(s) && llOriented(s) ? identifyPll(s) : null;
    if (n && n !== 'Skip') out.pll.best = bestLl(`PLL ${n}`, s, (t) => f2lSolved(t) && llOriented(t) && identifyPll(t) === 'Skip', extraAlgs);
  }
  // Plausibel ausrichten: Von welcher Seite wurde OLL/PLL gemacht? Ohne Gyro unbekannt – nimm den Blickwinkel,
  // in dem deine Züge am besten zu deinen Algorithmen (Algorithmen-Tab) bzw. der Datenbank passen.
  // (Sonst stünde z. B. B … da, obwohl dein Alg mit R anfängt.)
  const plainToks = (a) => tokenizeAlg(a).filter((t) => !/^[xyz]/.test(t));
  const lcs = (a, b) => {
    const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    return dp[a.length][b.length];
  };
  for (const [l, p] of [[out.oll, oll], [out.pll, pll]]) {
    if (l.skip || !l.best?.id || !p.moves || l.source) continue; // Haltung schon bekannt (eingestellt oder gemessen)
    const refs = [...extraAlgs(l.best.id), ...dbAlgs(l.best.id)].map(plainToks);
    let bestScore = -Infinity;
    for (const r of Y) {
      const mine = userAlg(p, r);
      const toks = mine.split(' ').filter(Boolean);
      const match = Math.max(0, ...refs.map((ref) => lcs(toks, ref)));
      const awkward = toks.filter((t) => t[0] === 'B' || t[0] === 'D').length; // B/D sind unüblich am Anfang/in LL-Algs
      const score = match * 10 - awkward;
      if (score > bestScore) {
        bestScore = score;
        l.userMoves = mine;
        l.view = r;
      }
    }
  }
  for (const [l, p] of [[out.oll, oll], [out.pll, pll]]) {
    if (l.frontOptions && !l.source) {
      l.source = 'assumed';
      l.holdK = Math.max(0, Y.indexOf(l.view || ''));
    }
    // Bild des echten Zustands zu Beginn der Phase, so wie du ihn gehalten hast
    if (l.frontOptions && !l.skip) l.dia = { state: view(states[p.start], face, Y[l.holdK ?? 0]), hold: holdColors(states[p.start], face, Y[l.holdK ?? 0]) };
    l.saved = l.best ? Math.max(0, l.moves - l.best.len) : 0;
    l.twoLook = !!l.best && l.moves >= l.best.len + 4 && l.moves >= l.best.len * 1.35; // vermutlich 2-Look oder Umweg
  }

  // OLL/PLL sind feste Algorithmen – zählen nicht zur möglichen Ersparnis
  out.saved = out.cross.saved + out.pairs.reduce((s, p) => s + (p.saved || 0), 0);
  // Ganze Lösung je Phase in der Haltung „Kreuz unten“
  out.scramble = solve.scramble || '';
  // Für „Üben ab hier“: Zustand zu Beginn jeder Phase (im System des Würfels)
  out.phaseStates = ph.map((p) => states[p.start]);
  out.solution = ph.map((p) => ({ key: p.key, moves: userAlg(p, '') })).filter((p) => p.moves);
  return out;
}
