/**
 * Algorithmen des Nutzers: eigene Algorithmen je OLL/PLL-Fall, freie eigene Algorithmen und Trainingszeiten.
 *
 * Gespeichert unter smartcube.algs.v1:
 *   cases:  { 'PLL T': { algs: ['…'], main: 0 } }   (ohne Eintrag gilt der Standard-Algorithmus)
 *   custom: [{ id, name, alg }]
 *   train:  { 'PLL T': [{ exec, recog, date }] }    (die letzten 50 je Fall)
 */
import { load, save } from './storage.js';
import { OLL_ALGS, PLL_ALGS } from './cube/ll-cases.js';

const KEY = 'smartcube.algs.v1';
export const algData = { cases: {}, custom: [], train: {}, ...load(KEY, {}) };
export const saveAlgs = () => save(KEY, algData);

export const caseIds = (set) =>
  set === 'PLL' ? Object.keys(PLL_ALGS).map((n) => `PLL ${n}`) : set === 'OLL' ? Object.keys(OLL_ALGS).map((n) => `OLL ${n}`) : algData.custom.map((c) => `Eigene ${c.id}`);

export function defaultAlg(id) {
  const [set, n] = id.split(' ');
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
  algData.custom.push({ id, name: name || 'Eigener Algorithmus', alg });
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
  if (id.startsWith('Eigene')) return algData.custom.find((x) => `Eigene ${x.id}` === id)?.name ?? 'Eigener Algorithmus';
  return id.replace('PLL ', '') + (id.startsWith('PLL') ? '-Perm' : '').replace('OLL ', 'OLL ');
};

export function recordTraining(id, exec, recog) {
  const list = (algData.train[id] ??= []);
  list.push({ exec: Math.round(exec), recog: Math.round(recog), date: Date.now() });
  if (list.length > 50) list.shift();
  saveAlgs();
}
