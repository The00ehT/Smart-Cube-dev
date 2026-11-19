/**
 * Datenbank alternativer Algorithmen (PLL, OLL, F2L).
 * PLL/OLL: bekannte Alternativen aus gängigen Algorithmen-Listen. F2L: siehe f2l-data.js.
 * Beim Laden wird jeder Algorithmus geprüft – nur Algorithmen, die genau ihren Fall lösen, bleiben drin.
 */
import { PLL_ALGS, OLL_ALGS, CASE_STATE, identifyPll, identifyOll, stateForAlg } from './ll-cases.js';
import { F2L_DB } from './f2l-data.js';
import { f2lStateForAlg, f2lGroup, F2L_GROUP_ORDER } from './f2l-cases.js';

const PLL_ALT = {
  Aa: ["x L2 D2 L' U' L D2 L' U L' x'", "R' F R' B2 R F' R' B2 R2"],
  Ab: ["R B' R F2 R' B R F2 R2"],
  E: ["R2 U R' U' y R U R' U' R U R' U' R U R' y' R U' R2"],
  F: ["R' U2 R' d' R' F' R2 U' R' U R' F R U' F"],
  Ga: ["R2 u R' U R' U' R u' R2 F' U F"],
  Gb: ["F' U' F R2 u R' U R U' R u' R2"],
  Gc: ["R2 u' R U' R U R' u R2 f R' f'"],
  Gd: ["f R f' R2 u' R U' R' U R' u R2"],
  H: ["M2 U' M2 U2 M2 U' M2", "R2 U2 R U2 R2 U2 R2 U2 R U2 R2"],
  Ja: ["L' U' L F L' U' L U L F' L2 U L", "R' U L' U2 R U' R' U2 R L"],
  Jb: ["R U2 R' U' R U2 L' U R' U' L"],
  Na: ["F' R U R' U' R' F R2 F U' R' U' R U F' R'"],
  Nb: ["r' D' F r U' r' F' D r2 U r' U' r' F r F'"],
  Ra: ["R U R' F' R U2 R' U2 R' F R U R U2 R'", "L U2 L' U2 L F' L' U' L U L F L2"],
  Rb: ["R' U2 R U2 R' F R U R' U' R' F' R2"],
  T: ["R U R' U' R' F R2 U' R' U F' L' U L"],
  Ua: ["M2 U M U2 M' U M2", "R2 U' R' U' R U R U R U' R"],
  Ub: ["M2 U' M U2 M' U' M2", "R' U R' U' R' U' R' U R U R2"],
  V: ["R' U R U' R' f' U' R U2 R' U' R U' R' f R"],
  Y: ["F R' F R2 U' R' U' R U R' F' R U R' U' F'"],
  Z: ["M2 U M2 U M' U2 M2 U2 M'", "R' U' R U' R U R U' R' U R U R2 U' R'"],
};

const OLL_ALT = {
  21: ["R U R' U R U' R' U R U2 R'"],
  22: ["f R U R' U' f' F R U R' U' F'"],
  23: ["R2 D R' U2 R D' R' U2 R'"],
  24: ["L F R' F' L' F R F'"],
  25: ["R' F R B' R' F' R B"],
  26: ["L' U' L U' L' U2 L"],
  27: ["L' U2 L U L' U L"],
  33: ["F R U' R' U R U R' F'"],
  37: ["F R U' R' U' R U R' F'"],
  44: ["f R U R' U' f'"],
  43: ["f' L' U' L U f"],
  51: ["f R U R' U' R U R' U' f'"],
  28: ["M' U M U2 M' U M"],
  2: ["r U r' U2 r U2 R' U2 R U' r'"],
};

function verified(list, check) {
  const ok = [];
  const bad = [];
  for (const a of list) (check(a) ? ok : bad).push(a);
  return { ok, bad };
}

/** Alternativen je Fall-ID ('PLL T', 'OLL 27', 'F2L 5') */
export const ALT_ALGS = {};
export const REJECTED = [];
for (const [n, list] of Object.entries(PLL_ALT)) {
  const { ok, bad } = verified(list, (a) => identifyPll(stateForAlg(a)) === n);
  ALT_ALGS[`PLL ${n}`] = ok;
  REJECTED.push(...bad.map((a) => `PLL ${n}: ${a}`));
}
for (const [n, list] of Object.entries(OLL_ALT)) {
  const { ok, bad } = verified(list, (a) => identifyOll(stateForAlg(a)) === Number(n));
  ALT_ALGS[`OLL ${n}`] = ok;
  REJECTED.push(...bad.map((a) => `OLL ${n}: ${a}`));
}

// F2L: Fälle 1–41 in der Reihenfolge der Gruppen
export const F2L_CASES = [];
{
  const sorted = [...F2L_DB].sort((a, b) => F2L_GROUP_ORDER.indexOf(f2lGroup(a.key)) - F2L_GROUP_ORDER.indexOf(f2lGroup(b.key)));
  sorted.forEach((c, i) => {
    const id = `F2L ${i + 1}`;
    const state = f2lStateForAlg(c.algs[0]);
    CASE_STATE[id] = state;
    ALT_ALGS[id] = c.algs.slice(1);
    F2L_CASES.push({ id, key: c.key, group: f2lGroup(c.key), alg: c.algs[0] });
  });
}
export const F2L_GROUPS = F2L_GROUP_ORDER.map((g) => [g, F2L_CASES.filter((c) => c.group === g).map((c) => c.id.slice(4))]);
export const f2lDefault = (n) => F2L_CASES[Number(n) - 1]?.alg;

/** Datenbank-Alternativen inkl. Standard-Algorithmus */
export function dbAlgs(id) {
  const [set, n] = id.split(' ');
  const main = set === 'PLL' ? PLL_ALGS[n] : set === 'OLL' ? OLL_ALGS[n] : set === 'F2L' ? f2lDefault(n) : null;
  return [main, ...(ALT_ALGS[id] || [])].filter(Boolean);
}
