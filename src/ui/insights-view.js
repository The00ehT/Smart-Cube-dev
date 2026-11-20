/**
 * Fenster „Analyse“: was bei einem Solve besser gegangen wäre (Daten aus solve-insights.js).
 */
import { pairIcon } from './pair-icon.js';
import { solveInsights } from '../solve-insights.js';
import { formatTime, formatSolve } from '../stats.js';
import { metricsOf } from '../metrics.js';
import { L, dec } from '../i18n.js';
import { colorChip } from './replay.js';
import { caseDiagram, f2lDiagram, PHYS } from './ll-diagram.js';
import { groupAlg } from '../cube/alg-format.js';
import { COLOR_NAMES, SOLVED, applyAlg, isSolved, phaseStatus, solvedSlots, relativeState, HtmCounter } from '../cube/facelets.js';
import { ScrambleTracker } from '../cube/scramble-tracker.js';
import { setupAlgFor } from './cube-view.js';

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
    <div class="in-meta">${frontPicker({ k: 'cross', frontOptions: c.frontOptions, holdK: r.xcross && c.xcross && c.source !== 'set' ? ['', 'y', 'y2', "y'"].indexOf(c.xcross.r) : c.holdK, source: c.source === 'set' ? 'set' : 'assumed' })}${r.xcross && c.xcross ? `<span class="small">${L('Paar', 'Pair')} ${pairIcon(c.xcross.pair, r.crossFace)} → ${L('hinten links', 'back left')}</span>` : ''}${practiceBtn(0)}</div>
    ${!r.xcross && c.xcross?.complete ? `<details class="in-tip in-fold"><summary>💡 ${L(`X-Cross wäre in ${mv(c.xcross.len)} gegangen`, `An X-cross was possible in ${mv(c.xcross.len)}`)}</summary>${L('Achte auf das Paar', 'Look for the pair')} ${pairIcon(c.xcross.pair, r.crossFace)} <b>${[...c.xcross.pair].map((f) => COLOR_NAMES[f]).join('-')}</b> – ${L('es landet im Slot <b>hinten links</b>, vorne bleibt frei für die nächsten Paare.', 'it goes into the <b>back-left</b> slot, keeping the front free for the next pairs.')}${alg(c.xcross.moves)}<div class="small">${L('Haltung', 'Hold')}: ${holdText(c.xcross.hold)}</div></details>` : ''}
    <details class="in-fold in-colors-box"><summary>${L('Optimales Kreuz je Farbe', 'Optimal cross per color')}${bestOther ? ` · <b>${COLOR_NAMES[c.bestColor.face]} −${c.optimal.len - c.bestColor.len}</b>` : ''}</summary>
      <div class="in-colors">${colors}</div>
      ${bestOther ? `<div class="small">${L(`Mit ${COLOR_NAMES[c.bestColor.face]} wäre das Kreuz ${mv(c.optimal.len - c.bestColor.len)} kürzer gewesen – gut für Color-Neutral-Training.`, `With ${COLOR_NAMES[c.bestColor.face]} the cross would have been ${mv(c.optimal.len - c.bestColor.len)} shorter – nice for color-neutral practice.`)}</div>` : ''}
    </details>
  </section>`;
}

const POS_NAME = {
  FR: L('Slot vorne rechts', 'front-right slot'),
  FL: L('Slot vorne links – gespiegelter Alg, keine Drehung nötig', 'front-left slot – mirrored alg, no rotation needed'),
  BR: L('Slot hinten rechts', 'back-right slot'),
  BL: L('Slot hinten links', 'back-left slot'),
};
const posNote = (b, pos) => `${POS_NAME[pos] || ''}${pos === 'BR' || pos === 'BL' ? (b.rot ? ` – ${L('hier ist eine kurze Drehung', 'a quick rotation')} (${b.rot}) ${L('okay', 'is fine here')}` : ` – ${L('geht ohne Drehung', 'works without rotation')}`) : ''}`;
const POS_SHORT = { FR: L('vorne rechts', 'front right'), FL: L('vorne links', 'front left'), BR: L('hinten rechts', 'back right'), BL: L('hinten links', 'back left') };
const practiceBtn = (idx) => `<button type="button" class="ghost small-btn in-practice-btn" data-practice="${idx}">🎯 ${L('Üben ab hier', 'Practice from here')}</button>`;

/** Haltung: welche Farbe war vorne? antippbar (ohne Gyroskop selbst einstellen) */
const EDIT = { on: false }; // Haltung bearbeiten (Farbwahl sichtbar) – sonst kompakt
function frontPicker(p) {
  if (!EDIT.on) return `<span class="in-front-compact">${colorChip(p.frontOptions[p.holdK])} ${L('vorne', 'front')}</span>`;
  const src = p.source === 'set' ? L('von dir eingestellt', 'set by you') : p.source === 'gyro' ? L('aus dem Gyroskop', 'from the gyroscope') : L('angenommen – tippe an, welche Farbe vorne war', 'assumed – tap the color that was in front');
  return `<div class="in-front"><span class="in-lbl">${L('Vorne', 'Front')}</span>${p.frontOptions
    .map((f, k) => `<button type="button" class="in-fc${k === p.holdK ? ' on' : ''}" data-pair="${p.k}" data-front="${k}" title="${COLOR_NAMES[f]}">${colorChip(f)}</button>`)
    .join('')}<span class="small">${src}</span></div>`;
}

/** F2L-Bild in echten Farben aus der Haltung des Lösers, das Paar an seiner Stelle */
function pairDiagram(p) {
  const d = p.dia;
  if (!d) return '';
  const h = d.hold;
  const palette = { U: PHYS[h.up], D: PHYS[h.down], F: PHYS[h.front], R: PHYS[h.right], L: PHYS[h.left], B: PHYS[h.back] };
  return f2lDiagram(d.state, 52, { pair: d.pair, palette });
}

function pairRow(p, r) {
  const tag = p.free ? `<span class="in-tag good">✓ ${L('mit dem Kreuz', 'with the cross')}</span>` : p.best && !p.best.stuck ? verdict(p.saved) : p.best?.stuck ? '<span class="in-tag warn">⚠</span>' : '';
  const flag = p.rotation?.unnecessary ? `<span class="in-tag warn">↻</span>` : '';
  const look = p.lookahead || p.eo?.better || p.eo?.allEdges ? `<span class="in-tag">🔭</span>` : '';
  const head = `<summary class="in-head"><b>${L('Paar', 'Pair')} ${p.k}</b> ${pairIcon(p.slot, r.crossFace)}<span class="small">${mv(p.moves)} · ${formatTime(p.time)}</span>${tag}${flag}${look}</summary>`;
  if (p.free) return `<details class="in-item in-collapse">${head}<div class="small">✓ ${L('Schon mit dem Kreuz bzw. einem anderen Paar gelöst', 'Already solved with the cross or another pair')}</div></details>`;
  const open = p.saved > 1 || p.rotation?.unnecessary || p.best?.stuck;
  const b = p.best;
  let body;
  if (!b) body = `<div class="small">${L('Fall nicht eindeutig erkennbar.', 'Case could not be identified.')}</div>`;
  else if (b.stuck) body = `<div class="small">⚠ ${L('Ecke oder Kante steckte in einem anderen Slot – dafür gibt es keinen Standard-Alg (erst herausholen).', 'Corner or edge was stuck in another slot – no standard alg for that (take it out first).')}</div><div class="in-lbl">${L('Du', 'You')}</div><div class="in-alg mine">${esc(groupAlg(p.userMoves))}</div>`;
  else
    body = `<div class="in-case">${pairDiagram(p) || caseDiagram(b.id, 46)}<div class="in-case-tx">
        <div class="in-row"><span class="small">${b.id} · ${L('Alg', 'Alg')}: <b>${mv(b.len)}</b></span>${verdict(p.saved)}</div>
        ${cmpAlgs(p.userMoves, b.alg, 'Alg')}
        <div class="small">${posNote(b, p.pos)}</div>
      </div></div>`;
  let rot = '';
  if (p.rotation) {
    const w = p.rotation.without;
    rot = p.rotation.unnecessary
      ? `<div class="in-tip warn">↻ ${L('Drehung', 'Rotation')} <b>${p.rotation.name}</b> ${L('vor diesem Paar war unnötig', 'before this pair was unnecessary')}: ${L('mit', 'with')} ${colorChip(p.rotation.fromFront)} ${L('vorne lag der Slot', 'in front the slot was')} ${POS_SHORT[w.pos]} – ${L('ohne Drehung', 'without rotating')}:${alg(w.alg)}</div>`
      : `<div class="small">↻ ${L('Drehung', 'Rotation')} ${p.rotation.name} – ${L('okay, der Slot lag hinten und ohne Drehung wäre es unhandlich gewesen', 'fine, the slot was in the back and awkward without rotating')}.</div>`;
  }
  const easier = p.easier
    ? `<div class="in-tip">💡 ${L('Leichter wäre gewesen', 'Easier would have been')}: ${pairIcon(p.easier.hold.front + p.easier.hold.right, r.crossFace)} ${p.easier.id} · ${mv(p.easier.len)}${alg(p.easier.alg)}<div class="small">${colorChip(p.easier.hold.front)} ${L('vorne', 'front')}</div></div>`
    : '';
  return `<details class="in-item in-collapse"${open ? ' open' : ''}>${head}<div class="in-meta">${frontPicker(p)}${practiceBtn(p.k)}</div>${rot}${body}${easier}${lookTip(p, r)}${eoTip(p)}</details>`;
}

const handNote = (x) => `${colorChip(x.hold.front)} ${L('vorne', 'front')}${x.mirrored ? ` · ${L('linke Hand', 'left hand')}` : ''}`;
const nextText = (n) => (n === 0 ? L('danach ist F2L fertig', 'then F2L is done') : L(`nächstes Paar nur ${mv(n)}`, `next pair only ${mv(n)}`));

/** Vorausschau: anderes Paar zuerst oder anderer Alg, damit das nächste Paar leichter wird */
function lookTip(p, r) {
  const a = p.lookahead;
  if (!a) return '';
  const title = a.sameSlot
    ? L('Anderer Alg für dieses Paar macht das nächste leichter', 'A different alg for this pair makes the next one easier')
    : `${L('Besser zuerst dieses Paar', 'Better do this pair first')} ${pairIcon(a.pairHold.front + a.pairHold.right, r.crossFace)}`;
  return `<div class="in-tip">🔭 <b>${title}</b>${alg(a.alg)}
    <div class="small">${a.id} · ${mv(a.len)} → ${nextText(a.next)} · ${L('zusammen', 'together')} <b>${a.total}</b> ${L('statt', 'instead of')} ${a.baseTotal} ${L('Züge', 'moves')} · ${handNote(a)}</div>
    <div class="small">${L('Kürzester Alg', 'Shortest alg')} ${esc(groupAlg(a.baseAlg))} (${a.baseLen}) → ${L('nächstes Paar', 'next pair')} ${a.baseNext}</div></div>`;
}

const ollText = (o) => (!o ? '–' : o.skip ? L('OLL-Skip', 'OLL skip') : `OLL ${o.n ?? '?'} (${mv(o.len)})`);
/** Letztes Paar: Kanten der letzten Schicht (EO) und OLL gleich mitdenken */
function eoTip(p) {
  const e = p.eo;
  if (!e) return '';
  const m = e.mine;
  let html = m ? `<div class="small in-eo">🧭 ${L('Nach deinem letzten Paar', 'After your last pair')}: ${L('Kanten oben', 'Top edges')} <b>${m.eo}/4</b> ${L('richtig', 'oriented')} · ${ollText(m)}</div>` : '';
  if (e.better)
    html += `<div class="in-tip">🔭 <b>${L('Letztes Paar mit Blick auf OLL', 'Last pair with OLL in mind')}</b>${alg(e.better.alg)}
      <div class="small">${mv(e.better.len)} → ${L('Kanten oben', 'top edges')} ${e.better.oll.eo}/4 · ${ollText(e.better.oll)} · ${L('zusammen', 'together')} <b>${e.better.total}</b> ${L('statt', 'instead of')} ${e.better.baseTotal} ${L('Züge', 'moves')} · ${handNote(e.better)}</div></div>`;
  if (e.allEdges)
    html += `<div class="in-tip">🧭 <b>${L('Alle Kanten oben richtig (EO)', 'All top edges oriented (EO)')}</b>${alg(e.allEdges.alg)}
      <div class="small">${mv(e.allEdges.len)} → ${ollText(e.allEdges.oll)} · ${L('zusammen', 'together')} ${e.allEdges.total} ${L('statt', 'instead of')} ${e.allEdges.baseTotal} ${L('Züge', 'moves')} · ${L('Kreuz oben – leichtere OLL-Fälle', 'cross on top – easier OLL cases')} · ${handNote(e.allEdges)}</div></div>`;
  return html;
}

/** OLL/PLL sind feste Algorithmen: nur Fall, Zeiten und eigene Züge – ohne Verbesserungsvorschlag */
function llRow(name, cls, l) {
  const b = l.best;
  const caseName = b ? (b.id.startsWith('PLL') ? `${b.id.slice(4)}-Perm` : b.id) : '';
  const head = `<summary class="in-head"><i class="key ${cls}"></i><b>${name}</b>${l.skip ? '<span class="in-tag good">Skip</span>' : caseName ? `<span class="small">${esc(caseName)}</span>` : ''}<span class="small">${mv(l.moves)} · ${formatTime(l.time)}</span></summary>`;
  if (l.skip) return `<details class="in-item in-collapse">${head}<div class="small">🎉 Skip</div></details>`;
  return `<details class="in-item in-collapse">${head}<div class="in-case">${b ? caseDiagram(b.id, 46) : ''}<div class="in-case-tx">
      <div class="small">${b ? `<b>${esc(caseName)}</b>` : L('Fall nicht eindeutig erkennbar', 'Case not identified')}${l.recog ? ` · Recog ${formatTime(l.recog)} · Exec ${formatTime(Math.max(0, l.time - l.recog))}` : ''}</div>
      <div class="in-alg mine">${esc(groupAlg(l.userMoves)) || '–'}</div>
    </div></div><div class="in-actions">${practiceBtn(name === 'OLL' ? 5 : 6)}</div></details>`;
}

/** Rotations im F2L: Anzahl, davon unnötig – bzw. Hinweis, „vorne“ einzustellen */
function rotSummary(r) {
  const anyAssumed = r.pairs.some((p) => !p.free && p.source === 'assumed');
  const ro = r.rotations;
  if (ro.count) return `<div class="in-rot${ro.unnecessary ? ' warn' : ''}">↻ ${ro.count} ${ro.count === 1 ? L('Rotation', 'rotation') : L('Rotations', 'rotations')}${ro.unnecessary ? ` · <b>${ro.unnecessary} ${L('davon unnötig', 'unnecessary')}</b>` : ''}</div>`;
  if (anyAssumed) return `<div class="small in-rot-hint">${L('Ohne Gyroskop: Über „✎ Haltung einstellen“ angeben, welche Farbe vorne war – dann bewertet die Analyse deine Rotations.', 'Without gyroscope: use “✎ Set hold” to say which color was in front – then the analysis rates your rotations.')}</div>`;
  return `<div class="small">✓ ${L('Keine Rotations im F2L', 'No rotations during F2L')}</div>`;
}

const PHASE_TITLE = (i) => (i === 0 ? 'Cross' : i <= 4 ? `${L('Paar', 'Pair')} ${i}` : i === 5 ? 'OLL' : 'PLL');
const popcount = (m) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);

export class InsightsView {
  /** @param deps { extraAlgs(id), state(), now(), persist(), onClose() } */
  constructor(dlg, deps = {}) {
    this.dlg = dlg;
    this.deps = deps;
    this.practice = null;
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg || e.target.closest('[data-act=close]')) return dlg.close();
      const fb = e.target.closest('[data-front]');
      if (fb) return this.setFront(fb.dataset.pair === 'cross' ? 'cross' : Number(fb.dataset.pair), Number(fb.dataset.front));
      const pb = e.target.closest('[data-practice]');
      if (pb) return this.startPractice(Number(pb.dataset.practice));
      if (e.target.closest('[data-act=practice-stop]')) return this.stopPractice();
      if (e.target.closest('[data-act=edit-hold]')) {
        EDIT.on = !EDIT.on;
        try {
          localStorage.setItem('smartcube.editHold', EDIT.on ? '1' : '');
        } catch {
          /* egal */
        }
        const top = this.dlg.scrollTop;
        this.render(this.solve);
        this.dlg.scrollTop = top;
        return;
      }
      if (e.target.closest('[data-act=practice-again]')) return this.startPractice(this.practice?.idx ?? 0);
    });
    dlg.addEventListener('close', () => {
      const was = !!this.practice;
      this.stopPractice();
      if (was) this.deps.onClose?.();
    });
  }

  get practicing() {
    return !!this.practice && this.dlg.open;
  }

  /** Haltung eines Paares ändern (ohne Gyroskop) → neu bewerten, am Solve speichern */
  setFront(pair, k) {
    const solve = this.solve;
    this.fronts = { ...this.fronts, [pair]: k };
    solve.fronts = this.fronts;
    this.deps.persist?.();
    const top = this.dlg.scrollTop;
    this.render(solve);
    this.dlg.scrollTop = top;
  }

  // ---------------- Üben ab hier ----------------

  /** Würfel vom jetzigen Zustand zum Stand vor der Phase bringen, dann die Phase nochmal lösen */
  async startPractice(idx) {
    const r = this.result;
    if (!r) return;
    const target = r.phaseStates[idx];
    const cur = this.deps.state();
    const box = this.dlg.querySelector('.in-practice');
    box.hidden = false;
    box.innerHTML = `<b>🎯 ${L('Üben', 'Practice')}: ${PHASE_TITLE(idx)}</b><div class="small">${L('Setup wird berechnet …', 'Computing setup …')}</div>`;
    this.dlg.scrollTop = 0;
    let setup;
    // Cross: das Original-Scramble, wenn der Würfel gelöst ist
    if (idx === 0 && this.solve.scramble && isSolved(cur) && applyAlg(SOLVED, this.solve.scramble) === target) setup = this.solve.scramble;
    else setup = await setupAlgFor(relativeState(cur, target));
    this.practice = { idx, target, tracker: new ScrambleTracker(setup), phase: 'setup', moves: 0, htm: new HtmCounter(), original: idx === 0 ? r.cross.user : idx <= 4 ? r.pairs[idx - 1].moves : idx === 5 ? r.oll.moves : r.pll.moves };
    if (this.practice.tracker.done) this.practice.phase = 'go';
    this.renderPractice();
  }

  stopPractice() {
    clearTimeout(this.rescrambleTimer);
    this.practice = null;
    const box = this.dlg.querySelector('.in-practice');
    if (box) box.hidden = true;
  }

  renderPractice() {
    const pr = this.practice;
    const box = this.dlg.querySelector('.in-practice');
    if (!pr || !box) return;
    const title = `<div class="in-pr-head"><b>🎯 ${L('Üben', 'Practice')}: ${PHASE_TITLE(pr.idx)}</b><button type="button" class="ghost small-btn" data-act="practice-stop">${L('Beenden', 'Stop')}</button></div>`;
    if (pr.phase === 'setup') {
      const moves = pr.tracker.remainingMoves().map((m, i) => `<span class="mv${m.correction ? ' correction' : ''}${i === 0 ? ' next' : ''}">${m.text}</span>`).join('');
      box.innerHTML = `${title}<div class="small">${pr.idx === 0 ? L('Scramble ausführen (Weiß oben, Grün vorne):', 'Apply the scramble (white top, green front):') : L('Bring deinen Würfel zu diesem Stand im Solve (Weiß oben, Grün vorne):', 'Bring your cube to this point of the solve (white top, green front):')}</div><div class="scramble in-pr-moves">${moves}</div>${pr.note ? `<div class="small scr-note">↺ ${pr.note}</div>` : ''}`;
    } else if (pr.phase === 'go') {
      box.innerHTML = `${title}<div class="in-pr-go">✓ ${L('Stand erreicht – jetzt', 'Position reached – now solve')} <b>${PHASE_TITLE(pr.idx)}</b> ${L('lösen. Die Zeit startet mit dem ersten Zug.', '. The timer starts with your first move.')}</div>
        <div class="in-pr-time">${pr.startAt != null ? formatTime(this.deps.now() - pr.startAt) : '0.00'}</div><div class="small">${pr.moves ? mv(pr.moves) : ''}</div>`;
    } else {
      const better = pr.moves < pr.original;
      box.innerHTML = `${title}<div class="in-pr-go">✓ ${PHASE_TITLE(pr.idx)} ${L('geschafft', 'done')}: <b>${mv(pr.moves)}</b> ${L('in', 'in')} <b>${formatTime(pr.time)}</b></div>
        <div class="small">${L('Im Solve', 'In the solve')}: ${mv(pr.original)} ${better ? `· 🎉 ${L('besser als im Solve', 'better than in the solve')}` : ''}</div>
        <button type="button" class="primary small-btn" data-act="practice-again">↻ ${L('Nochmal', 'Again')}</button>`;
    }
  }

  /** Ist die Phase im aktuellen Zustand fertig? */
  phaseDone(state) {
    const r = this.result;
    const f = r.crossFace;
    const st = phaseStatus(state)[f];
    const i = this.practice.idx;
    if (i === 0) return st.cross && (!r.xcross || popcount(solvedSlots(state, f)) >= 1);
    if (i <= 4) return st.cross && popcount(solvedSlots(state, f)) >= i;
    if (i === 5) return st.oll;
    return isSolved(state);
  }

  /** Zug vom Würfel während „Üben ab hier“; true = verarbeitet */
  onMove(e) {
    const pr = this.practice;
    if (!pr || !this.dlg.open) return false;
    const t = e.localTimestamp ?? this.deps.now();
    const state = this.deps.state();
    if (pr.phase === 'setup') {
      pr.tracker.push(e.move);
      if (pr.tracker.done || state === pr.target) {
        pr.phase = 'go';
        pr.note = '';
      } else if (pr.tracker.corrections > 0) this.scheduleRescramble();
    } else if (pr.phase === 'go') {
      if (pr.startAt == null) pr.startAt = t;
      pr.moves = pr.htm.push(e.move); // R2 = 1 Zug
      if (this.phaseDone(state)) {
        pr.phase = 'done';
        pr.time = t - pr.startAt;
      } else if (!this.ticking) this.tick();
    }
    this.renderPractice();
    return true;
  }

  /** Bei Fehlern im Setup: kürzester Weg zum Ziel, wenn das weniger Züge sind */
  scheduleRescramble() {
    clearTimeout(this.rescrambleTimer);
    const pr = this.practice;
    const n0 = pr.tracker.remaining.length;
    this.rescrambleTimer = setTimeout(async () => {
      if (this.practice !== pr || pr.phase !== 'setup') return;
      const alg = await setupAlgFor(relativeState(this.deps.state(), pr.target));
      if (this.practice !== pr || pr.phase !== 'setup' || pr.tracker.remaining.length !== n0) return;
      const n = alg.split(/\s+/).filter(Boolean).length;
      if (n < n0 && pr.tracker.replace(alg)) {
        pr.note = L(`Angepasst – ${n0 - n} Züge gespart`, `Adjusted – ${n0 - n} moves saved`);
        this.renderPractice();
      }
    }, 450);
  }

  tick() {
    const pr = this.practice;
    this.ticking = !!pr && pr.phase === 'go' && pr.startAt != null && this.dlg.open;
    if (!this.ticking) return;
    const el = this.dlg.querySelector('.in-pr-time');
    if (el) el.textContent = formatTime(this.deps.now() - pr.startAt);
    requestAnimationFrame(() => this.tick());
  }

  open(solve) {
    this.solve = solve;
    try {
      EDIT.on = localStorage.getItem('smartcube.editHold') === '1';
    } catch {
      EDIT.on = false;
    }
    this.fronts = { ...(solve.fronts || {}) };
    this.stopPractice();
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
      r = solveInsights(solve, { extraAlgs: this.deps.extraAlgs, fronts: this.fronts });
      this.result = r;
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
      <div class="in-practice" hidden></div>
      ${summary}
      <div class="in-toolbar"><button type="button" class="ghost small-btn${EDIT.on ? ' on' : ''}" data-act="edit-hold">${EDIT.on ? `✓ ${L('Haltung fertig', 'Hold done')}` : `✎ ${L('Haltung (vorne) einstellen', 'Set hold (front)')}`}</button></div>
      <section class="in-sec in-scr"><h3>Scramble</h3><div class="in-alg">${esc(r.scramble) || L('(eigenes Scramble)', '(own scramble)')}</div></section>
      ${crossSection(r)}
      <section class="in-sec"><h3><i class="key ph-pair"></i>F2L</h3>${rotSummary(r)}${r.pairs.map((p) => pairRow(p, r)).join('')}</section>
      <section class="in-sec"><h3><i class="key ph-oll"></i>${L('Letzte Schicht', 'Last layer')}</h3>${llRow('OLL', 'ph-oll', r.oll)}${llRow('PLL', 'ph-pll', r.pll)}</section>
      <section class="in-sec"><h3>${L('Deine Lösung', 'Your solution')}</h3>
        <div class="small">${L('Mit Kreuz unten', 'With cross down')} (${holdText(r.cross.optimal.hold)})</div>
        <div class="in-sol">${r.solution.map((p) => `<div class="in-lbl">${NAMES[p.key] || p.key}</div><div class="in-alg mine">${esc(groupAlg(p.moves))}</div>`).join('')}</div>
      </section>
      <p class="small in-note">${L('Vergleich mit dem optimalen Kreuz/X-Cross und den kürzesten geprüften F2L-Algorithmen (Datenbank und deine eigenen). OLL/PLL sind feste Algorithmen und zählen nicht zur Ersparnis. Alle Züge mit Kreuz unten, gehalten wie angegeben.', 'Compared with the optimal cross/X-cross and the shortest verified F2L algorithms (database and your own). OLL/PLL are fixed algorithms and don’t count towards savings. All moves with the cross down, held as shown.')}</p>`;
  }
}
