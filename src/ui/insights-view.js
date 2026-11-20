/**
 * Fenster „Analyse“: was bei einem Solve besser gegangen wäre (Daten aus solve-insights.js).
 */
import { solveInsights } from '../solve-insights.js';
import { formatTime, formatSolve } from '../stats.js';
import { metricsOf } from '../metrics.js';
import { L, dec } from '../i18n.js';
import { colorChip } from './replay.js';
import { caseDiagram } from './ll-diagram.js';
import { groupAlg } from '../cube/alg-format.js';
import { COLOR_NAMES } from '../cube/facelets.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const mv = (n) => `${n} ${n === 1 ? L('Zug', 'move') : L('Züge', 'moves')}`;
const alg = (a) => `<div class="in-alg">${esc(groupAlg(a)) || '–'}</div>`;
/** Zwei Zeilen zum Vergleichen: deine Züge und der Vorschlag */
const cmpAlgs = (mine, best, bestLabel) => `<div class="in-pair">
    <div class="in-lbl">${L('Du', 'You')}</div><div class="in-alg mine">${esc(groupAlg(mine)) || '–'}</div>
    <div class="in-lbl">${bestLabel}</div><div class="in-alg">${esc(groupAlg(best)) || '–'}</div>
  </div>`;
const NAMES = { cross: 'Cross', p1: L('Paar 1', 'Pair 1'), p2: L('Paar 2', 'Pair 2'), p3: L('Paar 3', 'Pair 3'), p4: L('Paar 4', 'Pair 4'), oll: 'OLL', pll: 'PLL' };
const pairName = (faces) => `${chips(faces)} ${[...faces].map((f) => COLOR_NAMES[f]).join('-')}`;
const chips = (faces) => [...(faces || '')].map(colorChip).join('');
const holdText = (h, withRight) =>
  h ? `${colorChip(h.down)} ${L('unten', 'down')} · ${colorChip(h.front)} ${L('vorne', 'front')}${withRight ? ` · ${colorChip(h.right)} ${L('rechts', 'right')}` : ''}` : '';

function verdict(saved, extra = '') {
  if (saved <= 1) return `<span class="in-tag good">✓ ${L('effizient', 'efficient')}</span>`;
  return `<span class="in-tag warn">−${mv(saved)} ${L('möglich', 'possible')}</span>${extra}`;
}

function crossSection(r) {
  const c = r.cross;
  const ref = r.xcross && c.xcross ? c.xcross : c.optimal;
  const colors = c.colors
    .map((x) => `<div class="in-color${x.face === r.crossFace ? ' mine' : ''}${x.len === c.bestColor.len ? ' best' : ''}" title="${COLOR_NAMES[x.face]}">${colorChip(x.face)}<b>${x.len}</b></div>`)
    .join('');
  const bestOther = c.bestColor.face !== r.crossFace && c.bestColor.len < c.optimal.len;
  return `<section class="in-sec">
    <h3><i class="key ph-cross"></i>${r.xcross ? 'X-Cross' : 'Cross'} ${colorChip(r.crossFace)}</h3>
    <div class="in-row">
      <div class="in-cmp"><span>${L('Du', 'You')}</span><b>${mv(c.user)}</b></div>
      <div class="in-cmp"><span>${L('Optimal', 'Optimal')}${r.xcross ? ' X-Cross' : ''}</span><b>${mv(ref.len)}</b></div>
      ${c.multi ? `<span class="in-tag good">🔥 ${L('Mehrere Paare direkt mit dem Kreuz', 'Several pairs right with the cross')}</span>` : verdict(c.saved)}
    </div>
    ${cmpAlgs(c.userMoves, ref.moves, r.xcross ? L('Optimal (X-Cross)', 'Optimal (X-cross)') : L('Optimal', 'Optimal'))}
    <div class="small">${L('Haltung', 'Hold')}: ${holdText(r.xcross && c.xcross ? c.xcross.hold : c.optimal.hold)}${r.xcross && c.xcross ? ` · ${L('Paar', 'Pair')} ${pairName(c.xcross.pair)} → ${L('hinten links', 'back left')}` : ''}</div>
    ${!r.xcross && c.xcross?.complete ? `<div class="in-tip">💡 ${L(`X-Cross wäre in ${mv(c.xcross.len)} gegangen: achte auf das Paar`, `An X-cross was possible in ${mv(c.xcross.len)}: look for the pair`)} <b>${pairName(c.xcross.pair)}</b> – ${L('es landet im Slot <b>hinten links</b>, vorne bleibt frei für die nächsten Paare.', 'it goes into the <b>back-left</b> slot, keeping the front free for the next pairs.')}${alg(c.xcross.moves)}<div class="small">${L('Haltung', 'Hold')}: ${holdText(c.xcross.hold)}</div></div>` : ''}
    <div class="in-sub">${L('Optimales Kreuz je Farbe', 'Optimal cross per color')}</div>
    <div class="in-colors">${colors}</div>
    ${bestOther ? `<div class="small">${L(`Mit ${COLOR_NAMES[c.bestColor.face]} wäre das Kreuz ${mv(c.optimal.len - c.bestColor.len)} kürzer gewesen – gut für Color-Neutral-Training.`, `With ${COLOR_NAMES[c.bestColor.face]} the cross would have been ${mv(c.optimal.len - c.bestColor.len)} shorter – nice for color-neutral practice.`)}</div>` : ''}
  </section>`;
}

function pairRow(p) {
  const head = `<div class="in-head"><b>${L('Paar', 'Pair')} ${p.k}</b> ${chips(p.slot)}<span class="small">${mv(p.moves)} · ${formatTime(p.time)}</span></div>`;
  if (p.free) return `<div class="in-item">${head}<div class="small">✓ ${L('Schon mit dem Kreuz bzw. einem anderen Paar gelöst', 'Already solved with the cross or another pair')}</div></div>`;
  const b = p.best;
  let body;
  if (!b) body = `<div class="small">${L('Fall nicht eindeutig erkennbar.', 'Case could not be identified.')}</div>`;
  else if (b.stuck) body = `<div class="small">⚠ ${L('Ecke oder Kante steckte in einem anderen Slot – dafür gibt es keinen Standard-Alg (erst herausholen).', 'Corner or edge was stuck in another slot – no standard alg for that (take it out first).')}</div><div class="in-lbl">${L('Du', 'You')}</div><div class="in-alg mine">${esc(groupAlg(p.userMoves))}</div>`;
  else
    body = `<div class="in-case">${caseDiagram(b.id, 46)}<div class="in-case-tx">
        <div class="in-row"><span class="small">${b.id} · ${L('Alg', 'Alg')}: <b>${mv(b.len)}</b></span>${verdict(p.saved)}</div>
        ${cmpAlgs(p.userMoves, b.alg, 'Alg')}
        <div class="small">${holdText(p.hold, true)}</div>
      </div></div>`;
  const easier = p.easier
    ? `<div class="in-tip">💡 ${L('Leichter wäre gewesen', 'Easier would have been')}: ${chips(p.easier.hold.front + p.easier.hold.right)} ${p.easier.id} · ${mv(p.easier.len)}${alg(p.easier.alg)}<div class="small">${holdText(p.easier.hold, true)}</div></div>`
    : '';
  return `<div class="in-item">${head}${body}${easier}</div>`;
}

/** OLL/PLL sind feste Algorithmen: nur Fall, Zeiten und eigene Züge – ohne Verbesserungsvorschlag */
function llRow(name, cls, l) {
  const head = `<div class="in-head"><i class="key ${cls}"></i><b>${name}</b><span class="small">${mv(l.moves)} · ${formatTime(l.time)}${l.recog ? ` · Recog ${formatTime(l.recog)}` : ''}</span></div>`;
  if (l.skip) return `<div class="in-item">${head}<div class="small">🎉 Skip</div></div>`;
  const b = l.best;
  return `<div class="in-item">${head}<div class="in-case">${b ? caseDiagram(b.id, 46) : ''}<div class="in-case-tx">
      <div class="small">${b ? `<b>${esc(b.id.startsWith('PLL') ? `${b.id.slice(4)}-Perm` : b.id)}</b>` : L('Fall nicht eindeutig erkennbar', 'Case not identified')}</div>
      <div class="in-alg mine">${esc(groupAlg(l.userMoves)) || '–'}</div>
    </div></div></div>`;
}

export class InsightsView {
  constructor(dlg, deps = {}) {
    this.dlg = dlg;
    this.deps = deps;
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg || e.target.closest('[data-act=close]')) dlg.close();
    });
  }

  open(solve) {
    this.dlg.innerHTML = `<div class="rp-head"><div><h2>${L('Analyse', 'Analysis')}</h2><div class="small">${formatSolve(solve)}</div></div>
      <button type="button" class="rp-close" data-act="close" aria-label="${L('Schließen', 'Close')}">✕</button></div>
      <p class="small">${L('Wird berechnet …', 'Calculating …')}</p>`;
    if (!this.dlg.open) this.dlg.showModal();
    // kurz warten, damit das Fenster sofort erscheint (die Suche kann einen Moment dauern)
    setTimeout(() => this.render(solve), 30);
  }

  render(solve) {
    let r;
    try {
      r = solveInsights(solve, { extraAlgs: this.deps.extraAlgs });
    } catch (err) {
      console.error(err);
      this.dlg.querySelector('p').textContent = L('Für diesen Solve ist keine Analyse möglich.', 'No analysis possible for this solve.');
      return;
    }
    const m = metricsOf(solve);
    const etps = m?.etps || solve.tps || 0;
    const secs = etps > 0 ? (r.saved / etps) * 1000 : null;
    const total = solve.moveCount ?? solve.solution.split(' ').length;
    const summary =
      r.saved > 1
        ? `<div class="in-summary"><b>${L('Mögliche Ersparnis', 'Possible savings')}: ~${mv(r.saved)}</b>${secs ? ` <span>≈ ${dec(secs / 1000, 1)} s ${L('bei deinem Tempo', 'at your pace')}</span>` : ''}
            <div class="small">${L(`${total} → ${total - r.saved} Züge, wenn jede Phase den kürzesten bekannten Weg nimmt.`, `${total} → ${total - r.saved} moves if every phase takes the shortest known way.`)}</div></div>`
        : `<div class="in-summary good"><b>✓ ${L('Sehr effizient gelöst', 'Very efficient solve')}</b><div class="small">${L('Kaum Einsparpotenzial bei den Zügen.', 'Hardly any moves to save.')}</div></div>`;
    this.dlg.innerHTML = `<div class="rp-head"><div><h2>${L('Analyse', 'Analysis')}</h2><div class="small">${formatSolve(solve)} · ${mv(total)}</div></div>
      <button type="button" class="rp-close" data-act="close" aria-label="${L('Schließen', 'Close')}">✕</button></div>
      ${summary}
      <section class="in-sec in-scr"><h3>Scramble</h3><div class="in-alg">${esc(r.scramble) || L('(eigenes Scramble)', '(own scramble)')}</div></section>
      ${crossSection(r)}
      <section class="in-sec"><h3><i class="key ph-pair"></i>F2L</h3>${r.pairs.map(pairRow).join('')}</section>
      <section class="in-sec"><h3><i class="key ph-oll"></i>${L('Letzte Schicht', 'Last layer')}</h3>${llRow('OLL', 'ph-oll', r.oll)}${llRow('PLL', 'ph-pll', r.pll)}</section>
      <section class="in-sec"><h3>${L('Deine Lösung', 'Your solution')}</h3>
        <div class="small">${L('Mit Kreuz unten', 'With cross down')} (${holdText(r.cross.optimal.hold)})</div>
        <div class="in-sol">${r.solution.map((p) => `<div class="in-lbl">${NAMES[p.key] || p.key}</div><div class="in-alg mine">${esc(groupAlg(p.moves))}</div>`).join('')}</div>
      </section>
      <p class="small in-note">${L('Vergleich mit dem optimalen Kreuz/X-Cross und den kürzesten geprüften F2L-Algorithmen (Datenbank und deine eigenen). OLL/PLL sind feste Algorithmen und zählen nicht zur Ersparnis. Alle Züge mit Kreuz unten, gehalten wie angegeben.', 'Compared with the optimal cross/X-cross and the shortest verified F2L algorithms (database and your own). OLL/PLL are fixed algorithms and don’t count towards savings. All moves with the cross down, held as shown.')}</p>`;
  }
}
