/**
 * Algorithmen des Nutzers: eigene Algorithmen je OLL/PLL-Fall, freie eigene Algorithmen und Trainingszeiten.
 *
 * Gespeichert unter smartcube.algs.v1:
 *   cases:  { 'PLL T': { algs: ['…'], main: 0 } }   (ohne Eintrag gilt der Standard-Algorithmus)
 *   custom: [{ id, name, alg }]
 *   train:  { 'PLL T': [{ exec, recog, date }] }    (die letzten 50 je Fall)
 *   orient: { 'PLL T': { '<alg>': 0–3 } }            bevorzugte Ausrichtung je Algorithmus (U-Drehungen auf
 *           den Fall, so wie der Alg ihn löst); ohne Eintrag automatisch (Headlights links, U-Perm-Block hinten)
 */
import { L } from './i18n.js';
import { load, save } from './storage.js';
import { OLL_ALGS, PLL_ALGS, stateForAlg, autoOrient, CASE_STATE } from './cube/ll-cases.js';
import { applyAnyAlg } from './cube/facelets.js';
import { F2L_CASES, f2lDefault } from './cube/alg-db.js';

const KEY = 'smartcube.algs.v1';
export const algData = { cases: {}, custom: [], train: {}, best: {}, ...load(KEY, {}) };
algData.best ??= {};
algData.orient ??= {};
export const saveAlgs = () => save(KEY, algData);

export const caseIds = (set) =>
  set === 'PLL'
    ? Object.keys(PLL_ALGS).map((n) => `PLL ${n}`)
    : set === 'OLL'
      ? Object.keys(OLL_ALGS).map((n) => `OLL ${n}`)
      : set === 'F2L'
        ? F2L_CASES.map((c) => c.id)
        : algData.custom.map((c) => `Eigene ${c.id}`);

export function defaultAlg(id) {
  const [set, n] = id.split(' ');
  if (set === 'F2L') return f2lDefault(n);
  return set === 'PLL' ? PLL_ALGS[n] : set === 'OLL' ? OLL_ALGS[n] : algData.custom.find((c) => String(c.id) === n)?.alg;
}

/** Alle Algorithmen eines Falls (eigene, sonst Standard) und der Hauptalgorithmus */
export function algsOf(id) {
  if (id.startsWith('Eigene')) {
    const a = defaultAlg(id);
    return { algs: a ? [a] : [], main: 0, own: true };
  }
  const c = algData.cases[id];
  if (c?.algs?.length) return { algs: c.algs, main: Math.min(c.main || 0, c.algs.length - 1), own: true };
  return { algs: [defaultAlg(id)], main: 0, own: false };
}
export const mainAlg = (id) => {
  const a = algsOf(id);
  return a.algs[a.main];
};

export function addAlg(id, alg) {
  const c = (algData.cases[id] ??= { algs: [], main: 0 });
  if (!c.algs.length) c.algs.push(defaultAlg(id)); // Standard behalten, neuer wird Haupt-Algorithmus
  const norm = (x) => x.replace(/[()]/g, ' ').split(/\s+/).filter(Boolean).join(' ');
  const i = c.algs.findIndex((x) => norm(x) === norm(alg));
  if (i >= 0) c.main = i; // schon vorhanden: nur als Haupt-Algorithmus wählen
  else {
    c.algs.push(alg);
    c.main = c.algs.length - 1;
  }
  saveAlgs();
}
export function removeAlg(id, i) {
  const c = algData.cases[id];
  if (!c) return;
  c.algs.splice(i, 1);
  c.main = Math.min(c.main, Math.max(0, c.algs.length - 1));
  if (!c.algs.length) delete algData.cases[id];
  saveAlgs();
}
export function setMain(id, i) {
  const c = (algData.cases[id] ??= { algs: [defaultAlg(id)], main: 0 });
  c.main = i;
  saveAlgs();
}

export function addCustom(name, alg) {
  const id = Date.now();
  algData.custom.push({ id, name: name || L('Eigener Algorithmus', 'Custom algorithm'), alg });
  saveAlgs();
  return `Eigene ${id}`;
}
export function updateCustom(id, name, alg) {
  const c = algData.custom.find((x) => `Eigene ${x.id}` === id);
  if (!c) return;
  if (name !== undefined) c.name = name;
  if (alg !== undefined) c.alg = alg;
  saveAlgs();
}
export function removeCustom(id) {
  algData.custom = algData.custom.filter((x) => `Eigene ${x.id}` !== id);
  delete algData.train[id];
  saveAlgs();
}
export const caseName = (id) => {
  if (id.startsWith('Eigene')) return algData.custom.find((x) => `Eigene ${x.id}` === id)?.name ?? L('Eigener Algorithmus', 'Custom algorithm');
  if (id.startsWith('F2L')) return `${L('F2L-Fall', 'F2L case')} ${id.slice(4)}`;
  return id.replace('PLL ', '') + (id.startsWith('PLL') ? '-Perm' : '');
};

/** Bestzeit (Exec) im Training, über alle Zeiten – auch wenn die Liste nur die letzten 50 hält */
export function trainingBest(id) {
  const list = algData.train[id] || [];
  const fromList = list.length ? Math.min(...list.map((x) => x.exec)) : null;
  const stored = algData.best[id] ?? null;
  return stored == null ? fromList : fromList == null ? stored : Math.min(stored, fromList);
}

/** Speichert eine Trainingszeit; true = neue Bestzeit für diesen Fall */
export function recordTraining(id, exec, recog) {
  const prev = trainingBest(id);
  const isPb = prev == null || exec < prev;
  if (isPb) algData.best[id] = Math.round(exec);
  const list = (algData.train[id] ??= []);
  list.push({ exec: Math.round(exec), recog: Math.round(recog), date: Date.now() });
  if (list.length > 50) list.shift();
  saveAlgs();
  return isPb && prev != null;
}

// ---------------- Bevorzugte Ausrichtung (OLL/PLL) ----------------

const ORIENT_AUF = ['', 'U', 'U2', "U'"];
const normAlg = (x) => String(x || '').replace(/[()]/g, ' ').split(/\s+/).filter(Boolean).join(' ');

/** Fall-Zustand so, wie der Algorithmus ihn direkt löst (Kreuz unten) */
export function algState(id, alg = mainAlg(id)) {
  try {
    return alg ? stateForAlg(alg) : CASE_STATE[id] || null;
  } catch {
    return CASE_STATE[id] || null;
  }
}

/** Bevorzugte Ausrichtung des Algs: { k (0–3 U-Drehungen auf den Fall), auto } */
export function orientOf(id, alg = mainAlg(id)) {
  const set = id.slice(0, 3);
  const own = algData.orient[id]?.[normAlg(alg)];
  if (own != null) return { k: own, auto: false };
  const s = algState(id, alg);
  return { k: s && (set === 'OLL' || set === 'PLL') ? autoOrient(s, set, id) : 0, auto: true };
}

/** Ausrichtung für einen Alg festlegen (null = wieder automatisch) */
export function setOrient(id, alg, k) {
  const m = (algData.orient[id] ??= {});
  if (k == null) delete m[normAlg(alg)];
  else m[normAlg(alg)] = ((k % 4) + 4) % 4;
  saveAlgs();
}

/** Fall in bevorzugter Ausrichtung und der AUF, der vor dem Alg nötig ist */
export function orientedCase(id, alg = mainAlg(id)) {
  const base = algState(id, alg);
  if (!base) return null;
  const { k, auto } = orientOf(id, alg);
  return { state: applyAnyAlg(base, ORIENT_AUF[k]), k, auto, preAuf: ['', "U'", 'U2', 'U'][k] };
}
