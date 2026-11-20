/**
 * Algorithmen-Tab: OLL/PLL-Fälle mit Häufigkeit, Zeiten und Erkennung aus den eigenen Solves,
 * eigene Algorithmen (eintippen oder am Würfel ausführen) und Start des Trainers.
 */
import { groupAlg } from '../cube/alg-format.js';
import { L, pctText } from '../i18n.js';
import { OLL_GROUPS, PLL_GROUPS, caseProbabilities, checkAlg } from '../cube/ll-cases.js';
import { rotationFaceMap, CROSS_DOWN, COLOR_NAMES, groupMoves, tokenizeAlg, mirrorAlg, applyAnyAlg } from '../cube/facelets.js';
import { algData, algsOf, mainAlg, addAlg, removeAlg, setMain, addCustom, updateCustom, removeCustom, caseName, saveAlgs, trainingBest, algState, orientOf, setOrient } from '../algs.js';
import { undoable } from './toast.js';
import { llStats } from '../case-stats.js';
import { caseDiagram, llDiagram } from './ll-diagram.js';
import { F2L_GROUPS, dbAlgs } from '../cube/alg-db.js';
import { weakCases } from '../weakness.js';
import { formatTime } from '../stats.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const pct = (x, d = 1) => pctText(x, d);
const t = (x) => (x == null ? '–' : formatTime(x));
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export class AlgsView {
  /**
   * @param root  Container im Tab
   * @param dlg   <dialog> für einen Fall
   * @param h     { solves(), crossFace(), connected(), train(ids, title) }
   */
  constructor(root, dlg, h) {
    this.root = root;
    this.dlg = dlg;
    this.h = h;
    this.set = 'F2L';
    this.sort = 'std';
    this.recording = null; // { moves: [] } während „Am Würfel ausführen“
    root.innerHTML = `
      <div class="tab-head">
        <h2>${L('Algorithmen', 'Algorithms')}</h2>
        <div class="tab-actions">
          <button type="button" class="ghost" data-act="weak">🎯 ${L('Schwächen üben', 'Train weaknesses')}</button>
          <button type="button" class="primary" data-act="train">▶ ${L('Trainieren', 'Train')}</button>
        </div>
      </div>
      <div class="seg-control algs-set" role="tablist">
        <button type="button" data-set="F2L">F2L</button>
        <button type="button" data-set="OLL">OLL</button>
        <button type="button" data-set="PLL">PLL</button>
        <button type="button" data-set="Eigene">${L('Eigene', 'Custom')}</button>
      </div>
      <div class="card weak-card" hidden></div>
      <div class="card algs-summary"></div>
      <div class="algs-tools">
        <label class="small">${L('Sortieren', 'Sort')}
          <select class="algs-sort">
            <option value="std">Standard</option>
            <option value="freq">${L('Am häufigsten', 'Most frequent')}</option>
            <option value="slow">${L('Am langsamsten', 'Slowest')}</option>
            <option value="recog">${L('Längster Recog', 'Longest recog')}</option>
          </select>
        </label>
      </div>
      <div class="case-grid"></div>`;
    root.addEventListener('click', (e) => {
      const set = e.target.closest('[data-set]')?.dataset.set;
      if (set) {
        this.set = set;
        this.render();
        return;
      }
      if (e.target.closest('[data-act=train]')) return this.trainSet();
      if (e.target.closest('[data-act=weak]')) return this.trainWeak();
      if (e.target.closest('[data-act=new-custom]')) return this.openCustom(null);
      const card = e.target.closest('[data-case]');
      if (card) this.openCase(card.dataset.case);
    });
    root.querySelector('.algs-sort').addEventListener('change', (e) => {
      this.sort = e.target.value;
      this.render();
    });
    dlg.addEventListener('close', () => {
      this.recording = null;
      this.render();
    });
  }

  ids() {
    if (this.set === 'Eigene') return algData.custom.map((c) => `Eigene ${c.id}`);
    const groups = this.set === 'PLL' ? PLL_GROUPS : this.set === 'F2L' ? F2L_GROUPS : OLL_GROUPS;
    return groups.flatMap(([, list]) => list.map((n) => `${this.set} ${n}`));
  }

  /** Schwächste Fälle trainieren (aus Solves und Training) */
  trainWeak() {
    const weak = weakCases(this.h.solves());
    const card = this.root.querySelector('.weak-card');
    card.hidden = false;
    if (!weak.length) {
      card.innerHTML = `<p class="small">${L('Noch zu wenig Daten für eine Schwächen-Analyse. Mach ein paar Solves oder trainiere ein Set – dann findet die App deine langsamsten Fälle.', 'Not enough data yet. Do a few solves or train a set – then the app finds your slowest cases.')}</p>`;
      return;
    }
    card.innerHTML = `<h3 class="sub-h">${L('Deine Schwächen', 'Your weak spots')}</h3>
      <ol class="weak-list">${weak.map((w) => `<li>${caseDiagram(w.id, 40)}<div><b>${esc(w.name)}</b><div class="small">${esc(w.reason)}</div></div></li>`).join('')}</ol>`;
    this.h.train(weak.map((w) => w.id), L('Schwächen', 'Weak spots'));
  }

  trainSet() {
    const ids = this.ids();
    if (!ids.length) return this.openCustom(null);
    this.h.train(ids, this.set === 'Eigene' ? L('Eigene Algorithmen', 'Custom algorithms') : this.set);
  }

  render() {
    const stats = llStats(this.h.solves());
    this.stats = stats;
    const probs = caseProbabilities();
    this.root.querySelectorAll('[data-set]').forEach((b) => b.classList.toggle('on', b.dataset.set === this.set));
    this.root.querySelector('.algs-tools').hidden = this.set === 'Eigene' || this.set === 'F2L';

    // Zusammenfassung
    const sum = this.root.querySelector('.algs-summary');
    if (this.set === 'Eigene') {
      sum.innerHTML = `<p class="small">${L('Hier speicherst du Algorithmen, die zu keinem Fall der Datenbank gehören (z. B. Tricks, Spezialfälle). Du kannst sie eintippen oder einfach am Würfel ausführen.', 'Store algorithms here that don’t belong to a database case (tricks, special cases). Type them or simply perform them on the cube.')}</p>`;
    } else if (this.set === 'F2L') {
      const trained = this.ids().filter((id) => algData.train[id]?.length).length;
      sum.innerHTML = `<p class="small">${L('Alle 41 F2L-Fälle für den Slot vorne rechts, je mit bis zu vier geprüften Algorithmen (kurz und ergonomisch). Jeder Fall zeigt auch die Varianten für die anderen Slots.', 'All 41 F2L cases for the front-right slot, each with up to four verified algorithms (short and ergonomic). Every case also shows the variants for the other slots.')} ${trained ? `${L('Trainiert', 'Trained')}: ${trained} / 41.` : ''}</p>`;
    } else {
      const tot = stats.total[this.set];
      const max = this.set === 'PLL' ? 21 : 57;
      sum.innerHTML = tot.n
        ? `<div class="stats">
            <div class="stat"><div class="v">${t(tot.mean)}</div><div class="k">Ø ${this.set}</div></div>
            <div class="stat"><div class="v">${t(tot.recog)}</div><div class="k">Recog</div></div>
            <div class="stat"><div class="v">${t(tot.exec)}</div><div class="k">Exec</div></div>
            <div class="stat"><div class="v">${tot.seen} / ${max}</div><div class="k">${L('Fälle gesehen', 'Cases seen')}</div></div>
            <div class="stat"><div class="v">${pct(tot.n ? tot.skip / tot.n : null)}</div><div class="k">Skips</div></div>
          </div>
          <p class="small emoji-help">${L(`Aus ${tot.n} Solves mit erkanntem ${this.set}-Fall. ⏱ = Ø-Zeit · 🏆 = Bestzeit · Recog = Pause vor dem ersten Zug der Phase.`, `From ${tot.n} solves with a recognized ${this.set} case. ⏱ = average · 🏆 = best · Recog = pause before the first move of the phase.`)}</p>`
        : `<p class="small">${L(`Sobald du Solves machst, erkennt die App automatisch, welcher ${this.set}-Fall drankam, und zeigt hier Häufigkeit, Ø-Zeit und Recog je Fall.`, `Once you solve, the app automatically detects which ${this.set} case came up and shows frequency, average time and recog per case.`)}</p>`;
    }

    // Karten
    const grid = this.root.querySelector('.case-grid');
    if (this.set === 'Eigene') {
      grid.innerHTML =
        algData.custom
          .map((c) => {
            const id = `Eigene ${c.id}`;
            const tr = algData.train[id] || [];
            return `<button type="button" class="case-card custom" data-case="${id}">
              <div class="cc-name">${esc(c.name)}</div>
              <div class="cc-alg">${esc(groupAlg(c.alg))}</div>
              <div class="cc-stats small">${tr.length ? `Training Ø ${t(avg(tr.slice(-12).map((x) => x.exec)))} · PB ${t(trainingBest(id))}` : L('noch nicht trainiert', 'not trained yet')}</div>
            </button>`;
          })
          .join('') + `<button type="button" class="case-card add" data-act="new-custom">＋ ${L('Neuer Algorithmus', 'New algorithm')}</button>`;
      return;
    }
    let ids = this.ids();
    const st = (id) => stats[this.set]?.[id];
    if (this.sort === 'freq') ids = [...ids].sort((a, b) => (st(b)?.n || 0) - (st(a)?.n || 0));
    if (this.sort === 'slow') ids = [...ids].sort((a, b) => (st(b)?.mean ?? -1) - (st(a)?.mean ?? -1));
    if (this.sort === 'recog') ids = [...ids].sort((a, b) => (st(b)?.recog ?? -1) - (st(a)?.recog ?? -1));
    const groups = this.set === 'PLL' ? PLL_GROUPS : this.set === 'F2L' ? F2L_GROUPS : OLL_GROUPS;
    const card = (id) => {
      const s = st(id);
      const own = algsOf(id).own;
      if (this.set === 'F2L') {
        const tr = algData.train[id] || [];
        return `<button type="button" class="case-card" data-case="${id}">
          ${caseDiagram(id, 64)}
          <div class="cc-body">
            <div class="cc-name">${esc(caseName(id))}${own ? ` <span class="tag">${L('eigener', 'own')}</span>` : ''}</div>
            <div class="cc-alg">${esc(groupAlg(mainAlg(id)))}</div>
            <div class="cc-freq small">${tr.length ? `Training Ø ${t(avg(tr.slice(-8).map((x) => x.exec)))} · PB ${t(trainingBest(id))}` : `${dbAlgs(id).length} ${L('Algorithmen', 'algorithms')}`}</div>
          </div>
        </button>`;
      }
      // Nur das Wichtigste: Ø-Zeit und Bestzeit (Häufigkeit/Wahrscheinlichkeit stehen im Fall-Fenster)
      return `<button type="button" class="case-card" data-case="${id}">
        ${caseDiagram(id, 64)}
        <div class="cc-body">
          <div class="cc-name">${esc(caseName(id))}${own ? ` <span class="tag">${L('eigener', 'own')}</span>` : ''}</div>
          <div class="cc-stats" title="${L('Ø-Zeit', 'Average')}">⏱ <b>${s ? t(s.mean) : '–'}</b></div>
          <div class="cc-stats cc-pb" title="${L('Bestzeit', 'Best')}">🏆 ${s ? t(s.best) : '–'}</div>
        </div>
      </button>`;
    };
    grid.innerHTML =
      this.sort === 'std'
        ? groups.map(([name, list]) => `<h3 class="case-group">${name}</h3>${list.map((n) => card(`${this.set} ${n}`)).join('')}`).join('')
        : ids.map(card).join('');
  }

  // ---------------- Fall-Dialog ----------------

  openCase(id) {
    if (id.startsWith('Eigene')) return this.openCustom(id);
    this.caseId = id;
    this.editing = null;
    this.renderCase();
    if (!this.dlg.open) this.dlg.showModal();
  }

  renderCase() {
    const id = this.caseId;
    const set = id.slice(0, 3);
    const s = this.stats?.[set]?.[id];
    const probs = caseProbabilities();
    const p = set === 'PLL' ? probs.pll[id.slice(4)] : set === 'OLL' ? probs.oll[Number(id.slice(4))] : null;
    const tr = algData.train[id] || [];
    const { algs, main } = algsOf(id);
    this.dlg.innerHTML = `
      <div class="rp-head">
        <div class="case-head">
          ${caseDiagram(id, 96)}
          <div><h2>${esc(caseName(id))}</h2>
            <div class="small">${p != null ? `${L('Wahrscheinlichkeit', 'Probability')} ${pct(p)}${s ? ` · ${L('bei dir', 'yours')} ${pct(s.share)} (${s.n}×)` : ''}` : L('Slot vorne rechts · Cross unten', 'Front-right slot · cross down')}</div></div>
        </div>
        <button type="button" class="rp-close" data-act="close" aria-label="${L('Schließen', 'Close')}">✕</button>
      </div>
      <div class="stats case-stats">
        <div class="stat"><div class="v">${t(s?.mean)}</div><div class="k">${L('Ø in Solves', 'Ø in solves')}</div></div>
        <div class="stat"><div class="v">${t(s?.recog)}</div><div class="k">Ø Recog</div></div>
        <div class="stat"><div class="v">${t(s?.exec)}</div><div class="k">Ø Exec</div></div>
        <div class="stat"><div class="v">${t(avg(tr.slice(-12).map((x) => x.exec)))}</div><div class="k">Ø Training (${tr.length}×)</div></div>
        <div class="stat pb"><div class="v">${t(s?.best)}</div><div class="k">${L('PB in Solves', 'PB in solves')}</div></div>
        <div class="stat pb"><div class="v">${t(trainingBest(id))}</div><div class="k">${L('PB Training', 'PB training')}</div></div>
      </div>
      <h3 class="sub-h">${L('Deine Algorithmen', 'Your algorithms')}</h3>
      <div class="alg-list">
        ${algs
          .map(
            (a, i) => `<label class="alg-row${i === main ? ' main' : ''}">
              <input type="radio" name="main-alg" value="${i}" ${i === main ? 'checked' : ''} />
              <span class="alg-text">${esc(groupAlg(a))}</span>
              ${algs.length > 1 ? `<button type="button" class="ghost small-btn" data-del="${i}" aria-label="${L('Löschen', 'Delete')}">✕</button>` : ''}
            </label>`,
          )
          .join('')}
      </div>
      <p class="small">${L('Der markierte Algorithmus wird im Training gezeigt.', 'The selected algorithm is shown in training.')}</p>
      ${this.orientHtml(id)}
      ${this.altHtml(id, algs)}
      <div class="alg-editor-slot">${this.editorHtml()}</div>
      <menu>
        <button type="button" data-act="add" ${this.editing ? 'hidden' : ''}>＋ ${L('Algorithmus hinzufügen', 'Add algorithm')}</button>
        <button type="button" class="primary" data-act="train-one">▶ ${L('Diesen Fall trainieren', 'Train this case')}</button>
      </menu>`;
    this.bindCase();
  }

  /** Bevorzugte Ausrichtung des markierten Algs (für Training und Endlos-OLL/-PLL mit „Bevorzugte Ausrichtung“) */
  orientHtml(id) {
    const set = id.slice(0, 3);
    if (set !== 'OLL' && set !== 'PLL') return '';
    const alg = mainAlg(id);
    const base = algState(id, alg);
    if (!base) return '';
    const { k, auto } = orientOf(id, alg);
    const PRE = ['', "U'", 'U2', 'U'];
    const opts = ['', 'U', 'U2', "U'"]
      .map((u, i) => `<button type="button" class="orient-opt${i === k ? ' on' : ''}" data-orient="${i}" aria-pressed="${i === k}">
          ${llDiagram(applyAnyAlg(base, u), set === 'OLL' ? 'oll' : 'pll', 56)}
          <span class="small">${PRE[i] ? `${PRE[i]} ${L('vorher', 'first')}` : L('direkt', 'direct')}</span></button>`)
      .join('');
    return `<h3 class="sub-h">${L('Bevorzugte Ausrichtung', 'Preferred orientation')}</h3>
      <div class="orient-row">${opts}</div>
      <p class="small">${auto ? L('Automatisch: Headlights links, U-Perm-Block hinten.', 'Automatic: headlights left, U-perm block at the back.') : `${L('Von dir gewählt', 'Chosen by you')} · <button type="button" class="link-btn" data-orient="auto">${L('automatisch', 'automatic')}</button>`} ${L('Gilt für den markierten Alg im Training mit „Bevorzugte Ausrichtung“.', 'Applies to the selected alg in training with “Preferred orientation”.')}</p>`;
  }

  /** Alternativen aus der Datenbank (und für F2L die Slot-Varianten) */
  altHtml(id, mine) {
    const norm = (x) => tokenizeAlg(x).join(' ');
    const have = new Set(mine.map(norm));
    const alts = dbAlgs(id).filter((a) => !have.has(norm(a)));
    const rows = alts
      .map((a) => `<div class="alt-row"><span class="alg-text">${esc(groupAlg(a))}</span><span class="small">${tokenizeAlg(a).length} ${L('Z.', 'mv')}</span>
        <button type="button" class="ghost small-btn" data-take="${esc(a)}">＋ ${L('Übernehmen', 'Use')}</button></div>`)
      .join('');
    let slots = '';
    if (id.startsWith('F2L')) {
      const m = mainAlg(id);
      const variants = [
        [L('Vorne links (gespiegelt)', 'Front left (mirrored)'), mirrorAlg(m)],
        [L('Hinten rechts', 'Back right'), `y ${m}`],
        [L('Hinten links', 'Back left'), `y' ${mirrorAlg(m)}`],
      ];
      slots = `<h3 class="sub-h">${L('Andere Slots', 'Other slots')}</h3>
        <div class="alt-list">${variants.map(([n, a]) => `<div class="alt-row"><span class="small slot-name">${n}</span><span class="alg-text">${esc(groupAlg(a))}</span></div>`).join('')}</div>`;
    }
    return (alts.length ? `<h3 class="sub-h">${L('Alternativen aus der Datenbank', 'Alternatives from the database')}</h3><div class="alt-list">${rows}</div>` : '') + slots;
  }

  bindCase() {
    const d = this.dlg;
    d.querySelectorAll('[data-orient]').forEach((b) => (b.onclick = () => {
      const v = b.dataset.orient;
      setOrient(this.caseId, mainAlg(this.caseId), v === 'auto' ? null : Number(v));
      const top = d.scrollTop;
      this.renderCase();
      d.scrollTop = top;
    }));
    d.querySelectorAll('[data-take]').forEach((b) => (b.onclick = () => {
      addAlg(this.caseId, b.dataset.take);
      this.renderCase();
    }));
    d.querySelector('[data-act=close]').onclick = () => d.close();
    d.querySelectorAll('input[name=main-alg]').forEach((r) => (r.onchange = () => {
      setMain(this.caseId, Number(r.value));
      this.renderCase();
    }));
    d.querySelectorAll('[data-del]').forEach((b) => (b.onclick = (e) => {
      e.preventDefault();
      const id = this.caseId;
      const before = JSON.stringify(algData.cases[id] || null);
      undoable(L('Algorithmus gelöscht', 'Algorithm deleted'), () => removeAlg(id, Number(b.dataset.del)), () => {
        const c = JSON.parse(before);
        if (c) algData.cases[id] = c;
        saveAlgs();
        if (this.dlg.open && this.caseId === id) this.renderCase();
      });
      this.renderCase();
    }));
    const add = d.querySelector('[data-act=add]');
    if (add) add.onclick = () => {
      this.editing = { mode: 'type', text: '' };
      this.renderCase();
    };
    d.querySelector('[data-act=train-one]').onclick = () => {
      d.close();
      this.h.train([this.caseId], caseName(this.caseId));
    };
    this.bindEditor(() => this.renderCase(), (alg) => {
      addAlg(this.caseId, alg);
      this.editing = null;
      this.renderCase();
    });
  }

  // ---------------- Eigener Algorithmus ----------------

  openCustom(id) {
    this.caseId = id;
    const c = id ? algData.custom.find((x) => `Eigene ${x.id}` === id) : null;
    this.editing = { mode: 'type', text: c?.alg || '', name: c?.name || '' };
    const tr = id ? algData.train[id] || [] : [];
    const render = () => {
      this.dlg.innerHTML = `
        <div class="rp-head"><h2>${id ? L('Algorithmus bearbeiten', 'Edit algorithm') : L('Neuer Algorithmus', 'New algorithm')}</h2>
          <button type="button" class="rp-close" data-act="close" aria-label="${L('Schließen', 'Close')}">✕</button></div>
        <label class="select-row">Name
          <input type="text" class="alg-name" maxlength="40" placeholder="${L('z. B. Sune, Trick …', 'e.g. Sune, trick …')}" value="${esc(this.editing.name)}" />
        </label>
        ${id ? `<p class="small">Training: ${tr.length}× · Ø ${t(avg(tr.slice(-12).map((x) => x.exec)))} · PB ${t(trainingBest(id))}</p>` : ''}
        <div class="alg-editor-slot">${this.editorHtml(true)}</div>
        <menu>
          ${id ? `<button type="button" class="danger" data-act="del">${L('Löschen', 'Delete')}</button><button type="button" data-act="train-one">▶ ${L('Trainieren', 'Train')}</button>` : ''}
        </menu>`;
      const d = this.dlg;
      d.querySelector('[data-act=close]').onclick = () => d.close();
      d.querySelector('.alg-name').oninput = (e) => (this.editing.name = e.target.value);
      d.querySelector('[data-act=del]')?.addEventListener('click', () => {
        const backup = algData.custom.find((x) => `Eigene ${x.id}` === id);
        const train = algData.train[id];
        undoable(L(`„${backup.name}“ gelöscht`, `“${backup.name}” deleted`), () => removeCustom(id), () => {
          algData.custom.push(backup);
          if (train) algData.train[id] = train;
          saveAlgs();
          this.render();
        });
        d.close();
      });
      d.querySelector('[data-act=train-one]')?.addEventListener('click', () => {
        d.close();
        this.h.train([id], caseName(id));
      });
      this.bindEditor(render, (alg) => {
        if (id) updateCustom(id, this.editing.name.trim() || L('Eigener Algorithmus', 'Custom algorithm'), alg);
        else this.caseId = addCustom(this.editing.name.trim(), alg);
        d.close();
      });
    };
    render();
    if (!this.dlg.open) this.dlg.showModal();
  }

  // ---------------- Editor: eintippen oder am Würfel ausführen ----------------

  holdHint() {
    const cf = this.h.crossFace();
    const map = rotationFaceMap(CROSS_DOWN[cf]);
    const at = (v) => Object.keys(map).find((b) => map[b] === v);
    return L(`Halte den Würfel mit <b>${COLOR_NAMES[at('U')]}</b> oben und <b>${COLOR_NAMES[at('F')]}</b> vorne (Cross ${COLOR_NAMES[cf]} unten).`, `Hold the cube <b>${COLOR_NAMES[at('U')]}</b> up and <b>${COLOR_NAMES[at('F')]}</b> front (${COLOR_NAMES[cf]} cross down).`);
  }

  editorHtml(always = false) {
    const ed = this.editing;
    if (!ed) return '';
    const rec = ed.mode === 'record';
    const text = rec ? groupMoves(this.recording?.moves || []).map((g) => g.text).join(' ') : ed.text;
    const check = this.check(text);
    return `<div class="alg-editor">
      <div class="seg-control">
        <button type="button" data-mode="type" class="${rec ? '' : 'on'}">${L('Eintippen', 'Type')}</button>
        <button type="button" data-mode="record" class="${rec ? 'on' : ''}">${L('Am Würfel ausführen', 'Perform on cube')}</button>
      </div>
      ${
        rec
          ? `<div class="rec-box">
              ${this.h.connected() ? `<p class="small">${this.holdHint()} ${L('Führe den Algorithmus jetzt aus – jeder Zug wird mitgeschrieben.', 'Perform the algorithm now – every move is recorded.')}</p>` : `<p class="error">${L('Verbinde zuerst deinen Würfel (Timer-Tab).', 'Connect your cube first (Timer tab).')}</p>`}
              <div class="rec-moves">${esc(text) || `<span class="small">${L('Warte auf Züge …', 'Waiting for moves …')}</span>`}</div>
              <button type="button" class="ghost" data-act="rec-reset">${L('Neu beginnen', 'Start over')}</button>
            </div>`
          : `<textarea class="alg-input" rows="2" spellcheck="false" autocapitalize="off" placeholder="z. B. R U R' U' R' F R2 U' R' U' R U R' F'">${esc(ed.text)}</textarea>
             <p class="small">${L('Erlaubt: R U F L D B, weite Züge (r, Rw), M E S, x y z, Klammern.', 'Allowed: R U F L D B, wide moves (r, Rw), M E S, x y z, brackets.')}</p>`
      }
      <div class="alg-check ${check.cls}">${check.msg}</div>
      <menu>
        <button type="button" data-act="ed-cancel">${always ? L('Abbrechen', 'Cancel') : L('Verwerfen', 'Discard')}</button>
        <button type="button" class="primary" data-act="ed-save" ${check.ok ? '' : 'disabled'}>${L('Speichern', 'Save')}</button>
      </menu>
    </div>`;
  }

  check(text) {
    if (!tokenizeAlg(text).length) return { ok: false, cls: '', msg: '' };
    const r = checkAlg(this.caseId && !this.caseId.startsWith('Eigene') ? this.caseId : '', text);
    if (!r.ok) return { ok: false, cls: 'bad', msg: r.error };
    if (this.caseId && !this.caseId.startsWith('Eigene')) {
      return r.solves
        ? { ok: true, cls: 'good', msg: L('✓ Löst diesen Fall.', '✓ Solves this case.') }
        : { ok: true, cls: 'warn', msg: L('⚠ Löst diesen Fall nicht (falsche Haltung oder anderer Fall?). Speichern geht trotzdem.', '⚠ Doesn’t solve this case (wrong grip or other case?). You can still save it.') };
    }
    return { ok: true, cls: 'good', msg: `✓ ${tokenizeAlg(text).length} ${L('Züge', 'moves')}` };
  }

  bindEditor(rerender, onSave) {
    const d = this.dlg;
    const ed = this.editing;
    if (!ed) return;
    d.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => {
      ed.mode = b.dataset.mode;
      this.recording = ed.mode === 'record' ? { moves: [] } : null;
      rerender();
    }));
    const input = d.querySelector('.alg-input');
    if (input) {
      input.oninput = () => {
        ed.text = input.value;
        const c = this.check(ed.text);
        const box = d.querySelector('.alg-check');
        box.className = `alg-check ${c.cls}`;
        box.textContent = c.msg;
        d.querySelector('[data-act=ed-save]').disabled = !c.ok;
      };
    }
    d.querySelector('[data-act=rec-reset]')?.addEventListener('click', () => {
      this.recording = { moves: [] };
      rerender();
    });
    d.querySelector('[data-act=ed-cancel]').onclick = () => {
      this.recording = null;
      if (this.caseId?.startsWith('Eigene') || !this.caseId) return d.close();
      this.editing = null;
      rerender();
    };
    d.querySelector('[data-act=ed-save]').onclick = () => {
      const text = ed.mode === 'record' ? groupMoves(this.recording?.moves || []).map((g) => g.text).join(' ') : ed.text.trim();
      this.recording = null;
      onSave(tokenizeAlg(text).join(' '));
    };
  }

  /** Zug vom Würfel während „Am Würfel ausführen“ (Körperseite → Sicht des Lösers) */
  recordMove(move) {
    if (!this.recording) return false;
    const map = rotationFaceMap(CROSS_DOWN[this.h.crossFace()]);
    this.recording.moves.push(map[move[0]] + move.slice(1));
    const box = this.dlg.querySelector('.rec-moves');
    const text = groupMoves(this.recording.moves).map((g) => g.text).join(' ');
    if (box) box.textContent = text;
    const c = this.check(text);
    const chk = this.dlg.querySelector('.alg-check');
    if (chk) {
      chk.className = `alg-check ${c.cls}`;
      chk.textContent = c.msg;
    }
    const save = this.dlg.querySelector('[data-act=ed-save]');
    if (save) save.disabled = !c.ok;
    return true;
  }
}

export { mainAlg };
