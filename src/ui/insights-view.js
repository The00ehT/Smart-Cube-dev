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
import { COLOR_NAMES, SOLVED, applyAlg, isSolved, phaseStatus, solvedSlots, relativeState, HtmCounter, translateMoves, tokenizeAlg, CROSS_DOWN } from '../cube/facelets.js';
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
  const xc = r.xcross;
  const ref = xc ? c.xcross : c.optimal; // eigenes X-Cross → mit dem besten X-Cross vergleichen
  const bestOther = c.colors.length > 1 && c.bestColor.face !== r.crossFace && c.bestColor.len < c.optimal.len;
  const colors = c.colors
    .map((x) => `<div class="in-color${x.face === r.crossFace ? ' mine' : ''}${x.len === c.bestColor.len ? ' best' : ''}" title="${COLOR_NAMES[x.face]}">${colorChip(x.face)}<b>${x.len}</b></div>`)
    .join('');
  const tag = c.multi ? `<span class="in-tag good">🔥</span>` : ref ? verdict(c.saved) : '';
  return `<section class="in-sec">
    <h3><i class="key ph-cross"></i>${c.multi ? 'XX-Cross' : xc ? 'X-Cross' : 'Cross'} ${colorChip(r.crossFace)}<span class="small in-h-num">${mv(c.user)}${ref ? ` · ${L('optimal', 'optimal')} ${ref.len}` : ''}</span>${tag}</h3>
    ${cmpAlgs(c.userMoves, ref?.moves ?? '', L('Optimal', 'Optimal'))}
    <div class="in-meta">${frontPicker({ k: 'cross', frontOptions: c.frontOptions, holdK: crossHoldK(r), source: c.source === 'set' ? 'set' : 'assumed' })}${xc && c.xcross ? `<span class="small">${pairIcon(c.xcross.pair, r.crossFace)} → ${L('hinten links', 'back left')}</span>` : ''}${practiceBtn(0)}</div>
    ${!xc && c.xcross?.complete ? `<details class="in-tip in-fold"><summary>💡 ${L(`X-Cross in ${mv(c.xcross.len)} möglich`, `X-cross possible in ${mv(c.xcross.len)}`)}</summary>${pairIcon(c.xcross.pair, r.crossFace)} <b>${[...c.xcross.pair].map((f) => COLOR_NAMES[f]).join('-')}</b> → ${L('hinten links', 'back left')} · ${holdText(c.xcross.hold)}${alg(c.xcross.moves)}</details>` : ''}
    ${c.colors.length > 1 ? `<details class="in-fold in-colors-box"><summary>${L('Kreuz je Farbe', 'Cross per color')}${bestOther ? ` · <b>${COLOR_NAMES[c.bestColor.face]} −${c.optimal.len - c.bestColor.len}</b>` : ''}</summary><div class="in-colors">${colors}</div></details>` : ''}
  </section>`;
}

const POS_SHORT = { FR: L('vorne rechts', 'front right'), FL: L('vorne links', 'front left'), BR: L('hinten rechts', 'back right'), BL: L('hinten links', 'back left') };
/** Wo lag der Slot, und wie wird der Alg ausgeführt? (kurz) */
const posNote = (b, pos) => `${L('Slot', 'Slot')} ${POS_SHORT[pos] || ''}${b.mirrored && !b.rot ? ` · ${L('gespiegelt', 'mirrored')}` : ''}${b.rot ? ` · ${L('mit', 'with')} ${b.rot}` : pos === 'BR' || pos === 'BL' ? ` · ${L('ohne Drehung', 'no rotation')}` : ''}`;
const practiceBtn = (idx) => `<button type="button" class="ghost small-btn in-practice-btn" data-practice="${idx}">🎯 ${L('Üben', 'Practice')}</button>`;

/** Haltung: welche Farbe war vorne? antippbar (ohne Gyroskop selbst einstellen) */
const EDIT = { on: false }; // Haltung bearbeiten (Farbwahl sichtbar) – sonst kompakt
const SCR = { down: false }; // Scramble mit Kreuzfarbe unten (statt Weiß oben, Grün vorne)

/** Haltung beim Kreuz (welche Farbe vorne, 0–3) – dieselbe wie in der Cross-Zeile angezeigt */
function crossHoldK(r) {
  const c = r.cross;
  return r.xcross && c.xcross && c.source !== 'set' ? Math.max(0, ['', 'y', 'y2', "y'"].indexOf(c.xcross.r)) : c.holdK || 0;
}

/** Scramble – wahlweise umgeschrieben für die Haltung „Kreuz unten“ (wie beim Lösen gehalten) */
function scrambleSection(r) {
  if (!r.scramble) return `<details class="in-sec in-scr in-fold"><summary><b>Scramble</b></summary><div class="in-alg">${L('(eigenes Scramble)', '(own scramble)')}</div></details>`;
  const k = crossHoldK(r);
  const rot = `${CROSS_DOWN[r.crossFace]} ${['', 'y', 'y2', "y'"][k]}`.trim();
  const shown = SCR.down && rot ? translateMoves(tokenizeAlg(r.scramble), rot).join(' ') : r.scramble;
  const hold = SCR.down ? `${colorChip(r.crossFace)} ${L('unten', 'down')} · ${colorChip(r.cross.frontOptions[k])} ${L('vorne', 'front')}` : `${colorChip('U')} ${L('oben', 'up')} · ${colorChip('F')} ${L('vorne', 'front')}`;
  return `<details class="in-sec in-scr in-fold"${SCR.down ? ' open' : ''}><summary><b>Scramble</b> <span class="small">${hold}</span></summary>
    <div class="in-alg">${esc(shown)}</div>
    <div class="in-scr-opts"><button type="button" class="ghost small-btn${SCR.down ? ' on' : ''}" data-act="scr-down">${SCR.down ? `↺ ${L('Standard (Weiß oben)', 'Standard (white up)')}` : `⬇ ${L('Mit Kreuzfarbe unten', 'With cross color down')}`}</button></div>
  </details>`;
}
function frontPicker(p) {
  const src = p.source === 'set' ? '' : p.source === 'gyro' ? ' · Gyro' : ` · ${L('angenommen', 'assumed')}`;
  if (!EDIT.on) return `<span class="in-front-compact">${colorChip(p.frontOptions[p.holdK])} ${L('vorne', 'front')}<span class="small">${src}</span></span>`;
  return `<div class="in-front"><span class="in-lbl">${L('Vorne', 'Front')}</span>${p.frontOptions
    .map((f, k) => `<button type="button" class="in-fc${k === p.holdK ? ' on' : ''}" data-pair="${p.k}" data-front="${k}" title="${COLOR_NAMES[f]}">${colorChip(f)}</button>`)
    .join('')}</div>`;
}

/** F2L-Bild in echten Farben aus der Haltung des Lösers, das Paar an seiner Stelle */
function pairDiagram(p) {
  const d = p.dia;
  if (!d) return '';
  const h = d.hold;
  const palette = { U: PHYS[h.up], D: PHYS[h.down], F: PHYS[h.front], R: PHYS[h.right], L: PHYS[h.left], B: PHYS[h.back] };
  return f2lDiagram(d.state, 52, { pair: d.pair, palette });
}

/** Ein Tipp: Titel, Alg, eine kurze Zeile */
const tip = (icon, title, a, line, warn) => `<div class="in-tip${warn ? ' warn' : ''}">${icon} <b>${title}</b>${a ? alg(a) : ''}${line ? `<div class="small">${line}</div>` : ''}</div>`;
const sum = (a, b) => `${a} + ${b} = <b>${a + b}</b>`;

function pairRow(p, r) {
  const tag = p.free ? `<span class="in-tag good">✓ ${L('mit Kreuz', 'with cross')}</span>` : p.best && !p.best.stuck ? verdict(p.saved) : p.best?.stuck ? '<span class="in-tag warn">⚠</span>' : '';
  const flag = p.rotation?.unnecessary ? `<span class="in-tag warn">↻</span>` : '';
  const look = p.lookahead || p.eo?.better || p.eo?.allEdges ? `<span class="in-tag">🔭</span>` : '';
  const head = `<summary class="in-head"><b>${L('Paar', 'Pair')} ${p.k}</b> ${pairIcon(p.slot, r.crossFace)}${p.free ? '' : `<span class="small">${mv(p.moves)} · ${formatTime(p.time)}</span>`}${tag}${flag}${look}</summary>`;
  if (p.free) return `<details class="in-item in-collapse">${head}<div class="small">✓ ${L('Mit dem Kreuz oder einem anderen Paar gelöst.', 'Solved with the cross or another pair.')}</div></details>`;
  const open = p.saved > 1 || p.rotation?.unnecessary || p.best?.stuck;
  const b = p.best;
  let body;
  if (!b) body = `<div class="small">${L('Fall nicht erkannt.', 'Case not recognized.')}</div>`;
  else if (b.stuck) body = `<div class="small">⚠ ${L('Teil steckte in einem anderen Slot – kein Standard-Alg.', 'Piece was stuck in another slot – no standard alg.')}</div><div class="in-alg mine">${esc(groupAlg(p.userMoves))}</div>`;
  else
    body = `<div class="in-case">${pairDiagram(p) || caseDiagram(b.id, 46)}<div class="in-case-tx">
        ${cmpAlgs(p.userMoves, b.alg, `Alg · ${b.len}`)}
        <div class="small">${b.id} · ${posNote(b, p.pos)}</div>
      </div></div>`;
  let rot = '';
  if (p.rotation) {
    const w = p.rotation.without;
    rot = p.rotation.unnecessary
      ? tip('↻', `${p.rotation.name} ${L('unnötig', 'unnecessary')}`, w.alg, `${L('Ohne Drehung', 'Without rotating')} · ${colorChip(p.rotation.fromFront)} ${L('vorne', 'front')} · Slot ${POS_SHORT[w.pos]}`, true)
      : `<div class="small">↻ ${p.rotation.name} – ${L('ok, Slot lag hinten', 'fine, slot was in the back')}</div>`;
  }
  // Vorschläge: höchstens einer zum Paar selbst (leichteres Paar ODER Vorausschau), dazu EO beim letzten Paar
  const sug = p.lookahead ? lookTip(p, r) : p.easier ? tip('💡', `${L('Leichter', 'Easier')}: ${pairIcon(p.easier.hold.front + p.easier.hold.right, r.crossFace)} ${p.easier.id}`, p.easier.alg, `${mv(p.easier.len)} · ${colorChip(p.easier.hold.front)} ${L('vorne', 'front')}`) : '';
  return `<details class="in-item in-collapse"${open ? ' open' : ''}>${head}<div class="in-meta">${frontPicker(p)}${practiceBtn(p.k)}</div>${rot}${body}${sug}${eoTip(p)}</details>`;
}

const handNote = (x) => `${colorChip(x.hold.front)} ${L('vorne', 'front')}${x.mirrored ? ` · ${L('links', 'left')}` : ''}`;

/** Vorausschau: anderes Paar zuerst oder anderer Alg, damit das nächste Paar leichter wird */
function lookTip(p, r) {
  const a = p.lookahead;
  const title = a.sameSlot
    ? L('Anderer Alg → nächstes Paar leichter', 'Other alg → next pair easier')
    : `${L('Erst dieses Paar', 'Do this pair first')} ${pairIcon(a.pairHold.front + a.pairHold.right, r.crossFace)}`;
  return tip('🔭', title, a.alg, `${L('Paar + nächstes', 'Pair + next')}: ${sum(a.len, a.next)} ${L('statt', 'vs')} ${a.baseLen} + ${a.baseNext} · ${handNote(a)}`);
}

const ollText = (o) => (!o ? '–' : o.skip ? 'OLL-Skip' : `OLL ${o.n ?? '?'} · ${mv(o.len)}`);
/** Letztes Paar: Kanten der letzten Schicht (EO) und OLL gleich mitdenken */
function eoTip(p) {
  const e = p.eo;
  if (!e) return '';
  const m = e.mine;
  let html = m ? `<div class="small in-eo">🧭 ${L('In deinem Solve nach diesem Paar', 'In your solve after this pair')}: ${L('Kanten oben', 'top edges')} <b>${m.eo}/4</b> ${L('richtig', 'oriented')}${m.n || m.skip ? ` · ${ollText(m)}` : ''}</div>` : '';
  if (e.better) html += tip('🔭', L('Mit Blick auf OLL', 'With OLL in mind'), e.better.alg, `${L('Mit diesem Alg', 'With this alg')}: ${L('Kanten oben', 'top edges')} ${e.better.oll.eo}/4 · ${L('Paar + OLL', 'Pair + OLL')}: ${sum(e.better.len, e.better.oll.len)} ${L('statt', 'vs')} ${e.better.baseTotal} · ${ollText(e.better.oll)} · ${handNote(e.better)}`);
  if (e.allEdges) html += tip('🧭', L('So wären alle Kanten oben richtig', 'This would orient all top edges'), e.allEdges.alg, `${L('Paar + OLL', 'Pair + OLL')}: ${sum(e.allEdges.len, e.allEdges.oll.len)} ${L('statt', 'vs')} ${e.allEdges.baseTotal} · ${ollText(e.allEdges.oll)} · ${handNote(e.allEdges)}`);
  return html;
}

/** OLL/PLL: Fall, Zeiten und eigene Züge (feste Algorithmen, keine Ersparnis) */
function llRow(name, cls, l) {
  const b = l.best;
  const caseName = b ? (b.id.startsWith('PLL') ? `${b.id.slice(4)}-Perm` : b.id) : '';
  const twoLook = l.twoLook ? `<span class="in-tag warn" title="${L(`Direkter Alg: ${b.len} Züge`, `Direct alg: ${b.len} moves`)}">2-Look?</span>` : '';
  const head = `<summary class="in-head"><i class="key ${cls}"></i><b>${name}</b>${l.skip ? '<span class="in-tag good">Skip</span>' : caseName ? `<span class="small">${esc(caseName)}</span>` : ''}<span class="small">${mv(l.moves)} · ${formatTime(l.time)}</span>${twoLook}</summary>`;
  if (l.skip) return `<details class="in-item in-collapse">${head}<div class="small">🎉 Skip</div></details>`;
  return `<details class="in-item in-collapse">${head}<div class="in-case">${b ? caseDiagram(b.id, 46) : ''}<div class="in-case-tx">
      <div class="in-alg mine">${esc(groupAlg(l.userMoves)) || '–'}</div>
      <div class="small">${b ? '' : L('Fall nicht erkannt · ', 'Case not recognized · ')}${l.recog ? `Recog ${formatTime(l.recog)} · Exec ${formatTime(Math.max(0, l.time - l.recog))}` : ''}${l.twoLook ? ` · ${L(`direkt: ${mv(b.len)}`, `direct: ${mv(b.len)}`)}` : ''}</div>
    </div></div><div class="in-actions">${practiceBtn(name === 'OLL' ? 5 : 6)}</div></details>`;
}

/** Rotations im F2L: Anzahl, davon unnötig – bzw. Hinweis, „vorne“ einzustellen */
function rotSummary(r) {
  const anyAssumed = r.pairs.some((p) => !p.free && p.source === 'assumed');
  const ro = r.rotations;
  if (ro.count) return `<div class="in-rot${ro.unnecessary ? ' warn' : ''}">↻ ${ro.count} Rotation${ro.count === 1 ? '' : 's'}${ro.unnecessary ? ` · <b>${ro.unnecessary} ${L('unnötig', 'unnecessary')}</b>` : ''}</div>`;
  if (anyAssumed) return `<div class="small in-rot-hint">${L('Rotations bewerten: „✎ Haltung“ einstellen.', 'Rate rotations: set “✎ Hold”.')}</div>`;
  return `<div class="small">✓ ${L('Keine Rotations', 'No rotations')}</div>`;
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
      if (e.target.closest('[data-act=scr-down]')) {
        SCR.down = !SCR.down;
        try {
          localStorage.setItem('smartcube.scrCrossDown', SCR.down ? '1' : '');
        } catch {
          /* egal */
        }
        const top = this.dlg.scrollTop;
        this.render(this.solve);
        this.dlg.scrollTop = top;
        return;
      }
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
      // Erst „los“, wenn der Würfel wirklich genau im Stand vor der Phase ist (nicht nur die Setup-Züge abgehakt) –
      // sonst stimmen z. B. die Kanten oben nicht mit der Analyse überein
      if (state === pr.target) {
        pr.phase = 'go';
        pr.note = '';
      } else if (pr.tracker.done) this.resetup(L('Stand weicht ab (Zug nicht erkannt?) – neues Setup', 'State differs (missed move?) – new setup'));
      else if (pr.tracker.corrections > 0) this.scheduleRescramble();
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

  /** Setup neu vom jetzigen Stand des Würfels aus berechnen */
  async resetup(note) {
    const pr = this.practice;
    if (!pr || pr.busy) return;
    pr.busy = true;
    const alg = await setupAlgFor(relativeState(this.deps.state(), pr.target));
    pr.busy = false;
    if (this.practice !== pr || pr.phase !== 'setup') return;
    pr.tracker = new ScrambleTracker(alg);
    pr.note = note;
    if (pr.tracker.done || this.deps.state() === pr.target) pr.phase = 'go';
    this.renderPractice();
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
    this.renderedFor = null; // frisch geöffnet: Standard-Aufklappen
    try {
      EDIT.on = localStorage.getItem('smartcube.editHold') === '1';
      SCR.down = localStorage.getItem('smartcube.scrCrossDown') === '1';
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
    // Beim Neuaufbau (Farbe vorne ändern, Haltung, Scramble-Ansicht …) bleiben aufgeklappte Bereiche offen
    const prevOpen = this.renderedFor === solve ? [...this.dlg.querySelectorAll('details')].map((d) => d.open) : null;
    let r;
    try {
      r = solveInsights(solve, { extraAlgs: this.deps.extraAlgs, crossColors: this.deps.crossColors?.() || [], fronts: this.fronts });
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
        ? `<div class="in-summary"><b>~${mv(r.saved)} ${L('sparbar', 'to save')}</b>${secs ? ` <span>≈ ${dec(secs / 1000, 1)} s</span>` : ''}<div class="small">${total} → ${total - r.saved} ${L('Züge mit den kürzesten Wegen (Cross + F2L)', 'moves with the shortest ways (cross + F2L)')}</div></div>`
        : `<div class="in-summary good"><b>✓ ${L('Sehr effizient', 'Very efficient')}</b></div>`;
    this.dlg.innerHTML = `<div class="rp-head"><div><h2>${L('Analyse', 'Analysis')}</h2><div class="small">${formatSolve(solve)} · ${mv(total)}</div></div>
      <button type="button" class="rp-close" data-act="close" aria-label="${L('Schließen', 'Close')}">✕</button></div>
      <div class="in-practice" hidden></div>
      ${summary}
      <div class="in-toolbar"><button type="button" class="ghost small-btn${EDIT.on ? ' on' : ''}" data-act="edit-hold">${EDIT.on ? `✓ ${L('Fertig', 'Done')}` : `✎ ${L('Haltung', 'Hold')}`}</button></div>
      ${scrambleSection(r)}
      ${crossSection(r)}
      <section class="in-sec"><h3><i class="key ph-pair"></i>F2L</h3>${rotSummary(r)}${r.pairs.map((p) => pairRow(p, r)).join('')}</section>
      <section class="in-sec"><h3><i class="key ph-oll"></i>${L('Letzte Schicht', 'Last layer')}</h3>${llRow('OLL', 'ph-oll', r.oll)}${llRow('PLL', 'ph-pll', r.pll)}</section>
      <details class="in-sec in-fold"><summary><b>${L('Ganze Lösung', 'Full solution')}</b> <span class="small">${holdText(r.cross.optimal.hold)}</span></summary>
        <div class="in-sol">${r.solution.map((p) => `<div class="in-lbl">${NAMES[p.key] || p.key}</div><div class="in-alg mine">${esc(groupAlg(p.moves))}</div>`).join('')}</div>
      </details>
      <p class="small in-note emoji-help">${L('Legende: ✓ effizient · −n möglich = Züge sparbar · ↻ Rotation · 🔭 Vorausschau · 🧭 Kanten oben (EO) · Vergleich mit optimalem Kreuz und kürzesten F2L-Algs (Datenbank + eigene).', 'Legend: ✓ efficient · −n possible = moves to save · ↻ rotation · 🔭 lookahead · 🧭 top edges (EO) · compared with optimal cross and shortest F2L algs (database + own).')}</p>`;
    this.renderedFor = solve;
    if (prevOpen?.length) {
      const ds = [...this.dlg.querySelectorAll('details')];
      if (ds.length === prevOpen.length) ds.forEach((d, i) => (d.open = prevOpen[i]));
    }
  }
}
