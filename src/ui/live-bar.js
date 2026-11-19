/**
 * Live-Fortschritt eines Solves: Cross · F2L 1–4 · OLL · PLL (für die eigene Anzeige und zum Zuschauen).
 */
import { L } from '../i18n.js';
import { FACES, isSolved, phaseStatus, solvedSlots } from '../cube/facelets.js';

export const STAGES = ['Cross', 'F2L 1', 'F2L 2', 'F2L 3', 'F2L 4', 'OLL', 'PLL'];
const STAGE_CLASS = ['ph-cross', 'ph-pair', 'ph-pair', 'ph-pair', 'ph-pair', 'ph-oll', 'ph-pll'];
const bits = (m) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);

/** Wie weit ist der Solve? 0 = nichts, 1 = Kreuz, 2–5 = Paare, 6 = OLL, 7 = gelöst */
export function liveStage(state) {
  if (isSolved(state)) return 7;
  const st = phaseStatus(state);
  let best = 0;
  for (const f of FACES) {
    if (!st[f].cross) continue;
    best = Math.max(best, st[f].oll ? 6 : 1 + bits(solvedSlots(state, f)));
  }
  return best;
}

export function barHtml(stage) {
  return `<div class="lb-segs">${STAGES.map((n, i) => `<span class="lb-seg ${STAGE_CLASS[i]}${i < stage ? ' done' : i === stage ? ' cur' : ''}" title="${n}"></span>`).join('')}</div>
    <div class="lb-label">${stage >= 7 ? L('Gelöst', 'Solved') : STAGES[stage]}</div>`;
}

/** Kreuzseite, auf der der Solve gerade am weitesten ist (null vor dem Kreuz) */
export function liveCrossFace(state) {
  if (isSolved(state)) return null;
  const st = phaseStatus(state);
  let best = null;
  let bestVal = 0;
  for (const f of FACES) {
    if (!st[f].cross) continue;
    const v = st[f].oll ? 6 : 1 + bits(solvedSlots(state, f));
    if (v > bestVal) {
      bestVal = v;
      best = f;
    }
  }
  return best;
}
