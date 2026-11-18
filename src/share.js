/**
 * Solves als kurzen Link teilen. Alles steht im Hash der URL (#r=1&…), es gibt keinen Server.
 *   m  Züge, je ein Buchstabe a–r (Seite U R F D L B × Dreh, Doppel, Gegen)
 *   t  Abstände zwischen den Zügen in ms, Basis 36, durch Punkte getrennt
 *   s  Scramble (wenn er vom gelösten Würfel zum Startzustand führt), sonst
 *   f  Startzustand als Facelets
 *   p  Strafe: 2 = +2, d = DNF
 *   d  Datum (ms seit 1970, Basis 36)
 */
import { FACES, SOLVED, applyAlg, parseMove, formatMove } from './cube/facelets.js';

const AMOUNT_IDX = { 1: 0, 2: 1, 3: 2 };
const encMove = (m) => {
  const p = parseMove(m);
  return String.fromCharCode(97 + FACES.indexOf(p.face) * 3 + AMOUNT_IDX[p.amount]);
};
const decMove = (c) => {
  const k = c.charCodeAt(0) - 97;
  if (k < 0 || k >= 18) throw new Error('Ungültiger Zug im Link');
  return formatMove(FACES[Math.floor(k / 3)], [1, 2, 3][k % 3]);
};

export function encodeShare(solve) {
  const q = new URLSearchParams();
  q.set('r', '1');
  q.set('m', solve.moves.map(encMove).join(''));
  q.set('t', solve.times.slice(1).map((x, i) => Math.max(0, x - solve.times[i]).toString(36)).join('.'));
  if (solve.scramble && applyAlg(SOLVED, solve.scramble) === solve.start) q.set('s', solve.scramble);
  else q.set('f', solve.start);
  if (solve.penalty === 'DNF') q.set('p', 'd');
  else if (solve.penalty) q.set('p', '2');
  if (solve.date) q.set('d', new Date(solve.date).getTime().toString(36));
  return q.toString();
}

export function decodeShare(str) {
  const q = new URLSearchParams(str.replace(/^#/, ''));
  if (q.get('r') !== '1') throw new Error('Kein Solve-Link');
  const moves = [...(q.get('m') || '')].map(decMove);
  const deltas = (q.get('t') || '').split('.').filter(Boolean).map((x) => parseInt(x, 36));
  const times = [0];
  for (const d of deltas) times.push(times[times.length - 1] + d);
  if (moves.length && times.length !== moves.length) throw new Error('Link unvollständig');
  const scramble = q.get('s') || '';
  const start = scramble ? applyAlg(SOLVED, scramble) : q.get('f') || '';
  if (!/^[URFDLB]{54}$/.test(start)) throw new Error('Startzustand im Link ungültig');
  const p = q.get('p');
  const d = q.get('d');
  return {
    moves,
    times: moves.length ? times : [],
    scramble,
    start,
    penalty: p === 'd' ? 'DNF' : p === '2' ? 2000 : 0,
    date: d ? new Date(parseInt(d, 36)).toISOString() : null,
  };
}

/** Vollständiger Link zum Teilen */
export function shareUrl(solve) {
  const base = location.href.split('#')[0];
  return `${base}#${encodeShare(solve)}`;
}
