/**
 * Erzeugt src/cube/f2l-data.js: je F2L-Fall (Slot FR) die besten Algorithmen.
 * Quellen: bekannte Algorithmen aus gängigen F2L-Listen + systematische Suche über F2L-Bausteine.
 * Jeder Algorithmus wird geprüft (löst genau einen FR-Fall, Kreuz und andere Slots bleiben gelöst).
 * Aufruf: node scripts/gen-f2l.mjs
 */
import { writeFileSync } from 'node:fs';
import { SOLVED, applyAnyAlg, invertAnyAlg, tokenizeAlg, parseAnyMove } from '../src/cube/facelets.js';
import { f2lStateForAlg, f2lKey } from '../src/cube/f2l-cases.js';

const KNOWN = [
  "U R U' R'", "U' F' U F", "F' U' F", "R U R'", 
  "U' R U R' U2 R U' R'", "U F' U' F U2 F' U F", "U' R U2 R' U2 R U' R'", "U F' U2 F U2 F' U F",
  "d R' U2 R U2 R' U R", "U' R U' R' U F' U' F", "U' R U R' U R U R'", "U' R U2 R' U F' U' F",
  "R U' R' U R U' R' U2 R U' R'", "U F' U F U' F' U' F", "U' R U' R' U R U R'",
  "R U' R' U2 F' U' F", "R U2 R' U' R U R'", "F' U2 F U F' U' F", "U R U2 R' U R U' R'",
  "U' F' U2 F U' F' U F", "U2 R U R' U R U' R'", "U2 F' U' F U' F' U F", "U R U' R' U' R U' R' U R U' R'",
  "F U R U' R' F' R U' R'", "U' R' F R F' R U R'", "U R U' R' U' F' U F", "R U' R' U R U' R'", "F' U F U' F' U F",
  "R U R' U' R U R'", "U' R' F R F' R U' R'", "U R U' R' U R U' R' U R U' R'", "U' R U' R' U2 R U' R'",
  "U R U R' U2 R U R'", "U' R U R' U F' U' F", "U F' U' F U' R U R'", "R2 U2 F R2 F' U2 R' U R'",
  "R U' R' U' R U R' U2 R U' R'", "R U' R' U R U2 R' U R U' R'", "R U' R' U' R U R' U' R U2 R'",
  "R U R' U2 R U' R' U R U R'", "R U' R' d R' U' R", "R U2 R' U R U' R'", "U2 R2 U2 R' U' R U' R2",
  "U R U' R' U R U R'", "U' R U R' U' R U R'", "R' F R F' U R U' R'",
  "U R U2 R' U' R U R'", "U' F' U' F U F' U' F", "R U R' U' R U R' U' R U R'", "U2 R U' R' U' R U R'",
  "U F' U F U F' U2 F", "U' R U' R' U R U R'", "R U2 R' U2 R U' R'", "U2 R U2 R' U R U' R'",
  "R' U' R' U' R' U R U R", "U R U' R' F R' F' R", "R U' R' U F' U F",
  "R' F R F' R U' R' U R U' R' U2 R U' R'", "R U R' U' R U' R' U2 F' U' F", "U F' U' F U' F' U' F",
];

// F2L-Bausteine: lassen Kreuz und die anderen Slots intakt
const MACROS = ['U', "U'", 'U2', "R U R'", "R U' R'", "R U2 R'", "F' U F", "F' U' F", "F' U2 F", "R' F R F'", "F R' F' R"];

/** Gleiche Seiten zusammenfassen, Drehungen der oberen Schicht am Ende weglassen */
function simplify(alg) {
  const out = [];
  for (const t of tokenizeAlg(alg)) {
    const p = parseAnyMove(t);
    const last = out[out.length - 1];
    if (last && last.base === p.base) {
      last.amount = (last.amount + p.amount) % 4;
      if (!last.amount) out.pop();
    } else out.push({ ...p });
  }
  while (out.length && out[out.length - 1].base === 'U') out.pop();
  const name = (b) => (b.endsWith('w') ? b : b);
  return out.map((m) => name(m.base) + (m.amount === 2 ? '2' : m.amount === 3 ? "'" : '')).join(' ');
}

const cost = (alg) => {
  const t = tokenizeAlg(alg);
  const rot = t.filter((x) => /^[xyzd]/.test(x)).length;
  const f = t.filter((x) => /^F/.test(x)).length;
  return t.length * 10 + rot * 6 + f * 4;
};

const byKey = new Map();
function offer(alg, source) {
  const a = simplify(alg);
  if (!a) return;
  const s = f2lStateForAlg(a);
  if (!s) return;
  const key = f2lKey(s);
  const list = byKey.get(key) ?? [];
  // Varianten, die sich nur im AUF am Anfang unterscheiden, zählen als derselbe Algorithmus
  const core = a.replace(/^(U2?'? )+/, '');
  const c = cost(a) - (source === 'known' ? 3 : 0);
  const same = list.find((x) => x.core === core);
  if (!same) list.push({ alg: a, core, cost: c });
  else if (c < same.cost) Object.assign(same, { alg: a, cost: c });
  byKey.set(key, list);
}

let rejected = 0;
for (const a of KNOWN) {
  const before = [...byKey.values()].reduce((n, l) => n + l.length, 0);
  offer(a, 'known');
  if ([...byKey.values()].reduce((n, l) => n + l.length, 0) === before) {
    rejected++;
    console.log('verworfen (kein reiner FR-Fall oder doppelt):', a);
  }
}

// Systematische Suche: Folgen von Bausteinen bis Tiefe 5
const t0 = Date.now();
function dfs(seq, depth) {
  if (seq.length) offer(seq.join(' '), 'search');
  if (depth === 0) return;
  for (const m of MACROS) {
    const prev = seq[seq.length - 1];
    if (prev && prev[0] === 'U' && m[0] === 'U') continue;
    seq.push(m);
    dfs(seq, depth - 1);
    seq.pop();
  }
}
dfs([], 5);
console.log('Suche:', Date.now() - t0, 'ms');

const groups = [...byKey.entries()].map(([key, list]) => {
  const sorted = list.sort((a, b) => a.cost - b.cost);
  const bestLen = tokenizeAlg(sorted[0].alg).length;
  // Alternativen nur, wenn sie höchstens 3 Züge länger sind als der beste
  const keep = sorted.filter((x, i) => i === 0 || tokenizeAlg(x.alg).length <= bestLen + 3);
  return { key, algs: keep.slice(0, 4).map((x) => x.alg) };
});
console.log('Fälle gefunden:', groups.length, '| verworfene bekannte:', rejected);
groups.sort((a, b) => tokenizeAlg(a.algs[0]).length - tokenizeAlg(b.algs[0]).length);
writeFileSync(
  new URL('../src/cube/f2l-data.js', import.meta.url),
  `// Erzeugt mit scripts/gen-f2l.mjs – nicht von Hand ändern.\n// Je F2L-Fall (Slot vorne rechts) bis zu vier geprüfte Algorithmen, der erste ist der empfohlene.\nexport const F2L_DB = ${JSON.stringify(groups, null, 1)};\n`,
);
void SOLVED; void applyAnyAlg; void invertAnyAlg;
