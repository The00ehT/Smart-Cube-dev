/**
 * Coach: kurze, konkrete Hinweise aus den eigenen Daten, jeweils mit passender Aktion.
 * Bewertet wird immer relativ zu dir selbst bzw. zu einer typischen CFOP-Aufteilung.
 */
import { hasDetail, phasesOf } from './solve-data.js';
import { llStats } from './case-stats.js';
import { weakCases } from './weakness.js';
import { pauses } from './cube/analysis.js';
import { averageOf, formatTime } from './stats.js';

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (x) => `${Math.round(x * 100)} %`;
// Typische Aufteilung schneller CFOP-Löser (grob)
const TYPICAL = { cross: 0.13, f2l: 0.5, oll: 0.16, pll: 0.21 };
const NAMES = { cross: 'Kreuz', f2l: 'F2L', oll: 'OLL', pll: 'PLL' };

/**
 * @returns [{ icon, title, text, action?: { label, kind, arg } }] – wichtigster Hinweis zuerst
 *   kind: 'weak' | 'train-set' | 'easy-scramble' | 'xcross'
 */
export function coachInsights(solves) {
  const det = solves.filter(hasDetail).slice(-50);
  const out = [];
  if (det.length < 5) {
    return [{ icon: '👋', title: 'Lass uns starten', text: `Nach 5 Solves mit deinem Smartcube findet der Coach heraus, wo du am meisten Zeit gewinnen kannst (noch ${5 - det.length}).` }];
  }

  // 1) Phase mit dem größten Anteil über dem Üblichen
  const ph = { cross: [], f2l: [], oll: [], pll: [] };
  for (const s of det) {
    const [c, f, o, p] = phasesOf(s, { mergeF2l: true });
    const tot = s.time || 1;
    ph.cross.push(c.time / tot);
    ph.f2l.push(f.time / tot);
    ph.oll.push(o.time / tot);
    ph.pll.push(p.time / tot);
  }
  const share = Object.fromEntries(Object.entries(ph).map(([k, v]) => [k, avg(v)]));
  const worst = Object.keys(TYPICAL).sort((a, b) => share[b] - TYPICAL[b] - (share[a] - TYPICAL[a]))[0];
  const over = share[worst] - TYPICAL[worst];
  if (over > 0.04) {
    const action =
      worst === 'cross'
        ? { label: 'Leichte Scrambles', kind: 'easy-scramble' }
        : worst === 'f2l'
          ? { label: 'F2L trainieren', kind: 'train-set', arg: 'F2L' }
          : { label: `${NAMES[worst]} trainieren`, kind: 'train-set', arg: worst.toUpperCase() };
    out.push({
      icon: '📊',
      title: `${NAMES[worst]} ist dein größter Hebel`,
      text: `${NAMES[worst]} braucht ${pct(share[worst])} deiner Zeit – typisch sind etwa ${pct(TYPICAL[worst])}.`,
      action,
      weight: over * 10,
    });
  }

  // 2) Erkennung bei OLL / PLL
  const st = llStats(det);
  for (const set of ['OLL', 'PLL']) {
    const t = st.total[set];
    if (!t.n || !t.recog || !t.mean) continue;
    const ratio = t.recog / t.mean;
    if (t.recog > 450 && ratio > 0.3) {
      out.push({
        icon: '👀',
        title: `${set}-Erkennung kostet Zeit`,
        text: `Vor jeder ${set} wartest du im Schnitt ${formatTime(t.recog)} – ${pct(ratio)} der ganzen ${set}-Phase. Erkennungstraining hilft hier am schnellsten.`,
        action: { label: `${set} trainieren`, kind: 'train-set', arg: set },
        weight: ratio * 3 + t.recog / 1000,
      });
    }
  }

  // 3) Lookahead: Pausen
  const ps = det.map((s) => pauses(s.times, 500));
  const perSolve = avg(ps.map((p) => p.count));
  const pauseTime = avg(ps.map((p) => p.sum));
  if (perSolve >= 3) {
    out.push({
      icon: '🐢',
      title: 'Weniger Pausen, mehr Fluss',
      text: `Du stoppst ${perSolve.toFixed(1).replace('.', ',')}× pro Solve für mindestens 0,5 s (zusammen ${formatTime(pauseTime)}). Dreh in F2L bewusst langsamer und such dabei schon das nächste Paar.`,
      weight: pauseTime / 1500,
    });
  }

  // 4) Kreuz ineffizient
  const crossMoves = avg(det.map((s) => s.phases[0].moves));
  if (crossMoves > 9) {
    out.push({
      icon: '✚',
      title: 'Kreuz effizienter planen',
      text: `Dein Kreuz braucht im Schnitt ${crossMoves.toFixed(1).replace('.', ',')} Züge – mit Planung in der Inspektion gehen meist 6–8.`,
      action: { label: 'Leichte Scrambles', kind: 'easy-scramble' },
      weight: (crossMoves - 8) / 2,
    });
  }

  // 5) Viele Würfeldrehungen (nur mit Gyro)
  const gy = det.filter((s) => s.gyro);
  if (gy.length >= 5) {
    const rot = avg(gy.map((s) => s.gyro.rotations.length));
    if (rot > 4) {
      out.push({
        icon: '🔄',
        title: 'Weniger drehen',
        text: `Im Schnitt drehst du den Würfel ${rot.toFixed(1).replace('.', ',')}× pro Solve. Viele F2L-Fälle gehen auch ohne Drehung – schau dir die Alternativen in der F2L-Datenbank an.`,
        action: { label: 'F2L ansehen', kind: 'train-set', arg: 'F2L' },
        weight: rot / 5,
      });
    }
  }

  // 6) Langsamste Fälle
  const weak = weakCases(solves, 3);
  if (weak.length) {
    out.push({
      icon: '🎯',
      title: 'Deine langsamsten Fälle',
      text: weak.map((w) => w.name).join(', ') + ' – ein paar Minuten gezieltes Training bringen hier viel.',
      action: { label: 'Schwächen üben', kind: 'weak' },
      weight: 1.2,
    });
  }

  // 7) Fortschritt (Motivation)
  if (solves.length >= 24) {
    const now = averageOf(solves, 12);
    const before = averageOf(solves.slice(0, -12), 12);
    if (now && before && Number.isFinite(now) && Number.isFinite(before) && before - now > 100) {
      out.push({
        icon: '🚀',
        title: 'Du wirst schneller!',
        text: `Dein Ø12 ist ${formatTime(before - now)} besser als vor 12 Solves (${formatTime(now)} statt ${formatTime(before)}).`,
        weight: 0.5,
      });
    }
  }

  return out.sort((a, b) => (b.weight || 0) - (a.weight || 0));
}
