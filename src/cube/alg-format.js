/**
 * Algorithmen lesbarer machen: typische Fingertrick-Gruppen in Klammern,
 * z. B. "R U R' U' R' F R F'" → "(R U R' U') (R' F R F')", Sune → "(R U R') U (R U2 R')".
 *   4 Züge  A B A' B'  (Sexy Move, Sledgehammer, …)
 *   3 Züge  A B A'     (Trigger wie R U R', R U2 R', F R F')
 * Nur zur Anzeige – Algorithmen mit eigenen Klammern bleiben unverändert.
 */
const MOVE = /^([URFDLBurfdlbMES]w?)(2'?|'|)$/;

function parse(tok) {
  const m = MOVE.exec(tok);
  if (!m) return null;
  return { face: m[1], amount: m[2] === "'" ? 3 : m[2].startsWith('2') ? 2 : 1 };
}
// r und R gelten als gleiche Seite: "r U R' U'" ist derselbe Griff wie "R U R' U'"
const side = (a) => a.face[0].toUpperCase();
const inverse = (a, b) => a && b && side(a) === side(b) && (a.amount + b.amount) % 4 === 0;
const quarter = (a) => a && a.amount !== 2;
// Gruppen beginnen mit einer Seitendrehung (R, L, F, B …), nicht mit U/D-Anpassungen
const opener = (a) => quarter(a) && !'UDE'.includes(side(a));
const differ = (a, b) => a && b && a.face[0].toUpperCase() !== b.face[0].toUpperCase();

export function groupAlg(alg) {
  const text = String(alg || '').replace(/’|´|`/g, "'").trim();
  if (!text || /[()[\]]/.test(text)) return text;
  const toks = text.split(/\s+/);
  const mv = toks.map(parse);
  const out = [];
  let i = 0;
  while (i < toks.length) {
    const [a, b, c, d] = mv.slice(i, i + 4);
    if (opener(a) && quarter(b) && differ(a, b) && inverse(a, c) && inverse(b, d)) {
      out.push(`(${toks.slice(i, i + 4).join(' ')})`);
      i += 4;
    } else if (opener(a) && b && differ(a, b) && inverse(a, c)) {
      out.push(`(${toks.slice(i, i + 3).join(' ')})`);
      i += 3;
    } else {
      out.push(toks[i]);
      i += 1;
    }
  }
  return out.join(' ');
}
