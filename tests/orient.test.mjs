/** Bevorzugte Ausrichtung: AUF davor + Alg löst den angezeigten Fall; Headlights links, U-Perm-Block hinten */
import assert from 'node:assert/strict';
import { applyAnyAlg } from '../src/cube/facelets.js';
import { OLL_ALGS, PLL_ALGS, f2lSolved, llOriented, solvedUpToAuf } from '../src/cube/ll-cases.js';
import { orientedCase, mainAlg } from '../src/algs.js';

let n = 0;
for (const [set, algs] of [['OLL', OLL_ALGS], ['PLL', PLL_ALGS]]) {
  for (const k of Object.keys(algs)) {
    const id = `${set} ${k}`;
    const o = orientedCase(id);
    const end = applyAnyAlg(o.state, `${o.preAuf} ${mainAlg(id)}`);
    assert.ok(set === 'OLL' ? f2lSolved(end) && llOriented(end) : solvedUpToAuf(end), `${id}: AUF + Alg löst den Fall`);
    const s = o.state;
    if (/^PLL U[ab]$/.test(id)) assert.ok(s[45] === s[46] && s[46] === s[47], `${id}: Block hinten`);
    if (/^PLL (T|Aa|Ab|Ja|Jb|Ra|Rb|Ga|Gb|Gc|Gd)$/.test(id) && [0, 1, 2, 3].some((i) => true)) {
      const headsSomewhere = [9, 18, 36, 45].some((f) => s[f] === s[f + 2] && s[f + 1] !== s[f]);
      if (headsSomewhere) assert.ok(s[36] === s[38] && s[37] !== s[36], `${id}: Headlights links`);
    }
    n++;
  }
}
console.log(`orient: ${n} Fälle geprüft – alle Tests bestanden`);
