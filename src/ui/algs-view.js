/**
 * Algorithmen-Tab: OLL/PLL-Fälle mit Häufigkeit, Zeiten und Erkennung aus den eigenen Solves,
 * eigene Algorithmen (eintippen oder am Würfel ausführen) und Start des Trainers.
 */
import { CASE_STATE, OLL_GROUPS, PLL_GROUPS, caseProbabilities, checkAlg } from '../cube/ll-cases.js';
import { rotationFaceMap, CROSS_DOWN, COLOR_NAMES, groupMoves, tokenizeAlg } from '../cube/facelets.js';
import { algData, algsOf, mainAlg, addAlg, removeAlg, setMain, addCustom, updateCustom, removeCustom, caseName } from '../algs.js';
import { llStats } from '../case-stats.js';
import { llDiagram } from './ll-diagram.js';
import { formatTime } from '../stats.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const pct = (x, d = 1) => (x == null ? '–' : `${(x * 100).toFixed(d).replace('.', ',')} %`);
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
    this.set = 'PLL';
    this.sort = 'std';
    this.recording = null; // { moves: [] } während „Am Würfel ausführen“
    root.innerHTML = `
      <div class="tab-head">
        <h2>Algorithmen</h2>
        <button type="button" class="primary" data-act="train">▶ Trainieren</button>
      </div>
      <div class="seg-control algs-set" role="tablist">
        <button type="button" data-set="PLL">PLL</button>
        <button type="button" data-set="OLL">OLL</button>
        <button type="button" data-set="Eigene">Eigene</button>
      </div>
      <div class="card algs-summary"></div>
      <div class="algs-tools">
        <label class="small">Sortieren
          <select class="algs-sort">
            <option value="std">Standard</option>
            <option value="freq">Am häufigsten</option>
            <option value="slow">Am langsamsten</option>
            <option value="recog">Längste Erkennung</option>
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
    const groups = this.set === 'PLL' ? PLL_GROUPS : OLL_GROUPS;
    return groups.flatMap(([, list]) => list.map((n) => `${this.set} ${n}`));
  }

  trainSet() {
    const ids = this.ids();
    if (!ids.length) return this.openCustom(null);
    this.h.train(ids, this.set === 'Eigene' ? 'Eigene Algorithmen' : this.set);
  }

  render() {
    const stats = llStats(this.h.solves());
    this.stats = stats;
    const probs = caseProbabilities();
    this.root.querySelectorAll('[data-set]').forEach((b) => b.classList.toggle('on', b.dataset.set === this.set));
    this.root.querySelector('.algs-tools').hidden = this.set === 'Eigene';

    // Zusammenfassung
    const sum = this.root.querySelector('.algs-summary');
    if (this.set === 'Eigene') {
      sum.innerHTML = `<p class="small">Hier speicherst du Algorithmen, die zu keinem OLL/PLL-Fall gehören (z. B. F2L-Fälle, Tricks).
        Du kannst sie eintippen oder einfach am Würfel ausführen.</p>`;
    } else {
      const tot = stats.total[this.set];
      const max = this.set === 'PLL' ? 21 : 57;
      sum.innerHTML = tot.n
        ? `<div class="stats">
            <div class="stat"><div class="v">${t(tot.mean)}</div><div class="k">Ø ${this.set} gesamt</div></div>
            <div class="stat"><div class="v">${t(tot.recog)}</div><div class="k">davon Erkennung</div></div>
            <div class="stat"><div class="v">${t(tot.exec)}</div><div class="k">davon Ausführung</div></div>
            <div class="stat"><div class="v">${tot.seen} / ${max}</div><div class="k">Fälle schon gehabt</div></div>
            <div class="stat"><div class="v">${pct(tot.n ? tot.skip / tot.n : null)}</div><div class="k">Skips (erwartet ${pct(this.set === 'PLL' ? probs.pll.Skip : probs.oll[0])})</div></div>
          </div>
          <p class="small">Aus ${tot.n} Solves mit erkanntem ${this.set}-Fall. Erkennung = Pause vor dem ersten Zug der Phase.</p>`
        : `<p class="small">Sobald du Solves machst, erkennt die App automatisch, welcher ${this.set}-Fall drankam, und zeigt hier
            Häufigkeit, Ø-Zeit und Erkennungszeit je Fall.</p>`;
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
              <div class="cc-alg">${esc(c.alg)}</div>
              <div class="cc-stats small">${tr.length ? `Training Ø ${t(avg(tr.slice(-12).map((x) => x.exec)))}` : 'noch nicht trainiert'}</div>
            </button>`;
          })
          .join('') + `<button type="button" class="case-card add" data-act="new-custom">＋ Neuer Algorithmus</button>`;
      return;
    }
    let ids = this.ids();
    const st = (id) => stats[this.set][id];
    if (this.sort === 'freq') ids = [...ids].sort((a, b) => (st(b)?.n || 0) - (st(a)?.n || 0));
    if (this.sort === 'slow') ids = [...ids].sort((a, b) => (st(b)?.mean ?? -1) - (st(a)?.mean ?? -1));
    if (this.sort === 'recog') ids = [...ids].sort((a, b) => (st(b)?.recog ?? -1) - (st(a)?.recog ?? -1));
    const groups = this.set === 'PLL' ? PLL_GROUPS : OLL_GROUPS;
    const card = (id) => {
      const s = st(id);
      const p = this.set === 'PLL' ? probs.pll[id.slice(4)] : probs.oll[Number(id.slice(4))];
      const own = algsOf(id).own;
      return `<button type="button" class="case-card" data-case="${id}">
        ${llDiagram(CASE_STATE[id], this.set === 'OLL' ? 'oll' : 'pll', 64)}
        <div class="cc-body">
          <div class="cc-name">${esc(caseName(id))}${own ? ' <span class="tag">eigener</span>' : ''}</div>
          <div class="cc-stats">${s ? `<b>${t(s.mean)}</b> · Erk. ${t(s.recog)}` : '<span class="small">noch nicht gehabt</span>'}</div>
          <div class="cc-freq small">${s ? `${s.n}× · ${pct(s.share)} ` : ''}<span title="Wahrscheinlichkeit">(erw. ${pct(p)})</span></div>
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
    const p = set === 'PLL' ? probs.pll[id.slice(4)] : probs.oll[Number(id.slice(4))];
    const tr = algData.train[id] || [];
    const { algs, main } = algsOf(id);
    this.dlg.innerHTML = `
      <div class="rp-head">
        <div class="case-head">
          ${llDiagram(CASE_STATE[id], set === 'OLL' ? 'oll' : 'pll', 96)}
          <div><h2>${esc(caseName(id))}</h2>
            <div class="small">Wahrscheinlichkeit ${pct(p)}${s ? ` · bei dir ${pct(s.share)} (${s.n}×)` : ''}</div></div>
        </div>
        <button type="button" class="rp-close" data-act="close" aria-label="Schließen">✕</button>
      </div>
      <div class="stats case-stats">
        <div class="stat"><div class="v">${t(s?.mean)}</div><div class="k">Ø in Solves</div></div>
        <div class="stat"><div class="v">${t(s?.recog)}</div><div class="k">Ø Erkennung</div></div>
        <div class="stat"><div class="v">${t(s?.exec)}</div><div class="k">Ø Ausführung</div></div>
        <div class="stat"><div class="v">${t(avg(tr.slice(-12).map((x) => x.exec)))}</div><div class="k">Ø Training (${tr.length}×)</div></div>
      </div>
      <h3 class="sub-h">Deine Algorithmen</h3>
      <div class="alg-list">
        ${algs
          .map(
            (a, i) => `<label class="alg-row${i === main ? ' main' : ''}">
              <input type="radio" name="main-alg" value="${i}" ${i === main ? 'checked' : ''} />
              <span class="alg-text">${esc(a)}</span>
              ${algs.length > 1 ? `<button type="button" class="ghost small-btn" data-del="${i}" aria-label="Löschen">✕</button>` : ''}
            </label>`,
          )
          .join('')}
      </div>
      <p class="small">Der markierte Algorithmus wird im Training gezeigt.</p>
      <div class="alg-editor-slot">${this.editorHtml()}</div>
      <menu>
        <button type="button" data-act="add" ${this.editing ? 'hidden' : ''}>＋ Algorithmus hinzufügen</button>
        <button type="button" class="primary" data-act="train-one">▶ Diesen Fall trainieren</button>
      </menu>`;
    this.bindCase();
  }

  bindCase() {
    const d = this.dlg;
    d.querySelector('[data-act=close]').onclick = () => d.close();
    d.querySelectorAll('input[name=main-alg]').forEach((r) => (r.onchange = () => {
      setMain(this.caseId, Number(r.value));
      this.renderCase();
    }));
    d.querySelectorAll('[data-del]').forEach((b) => (b.onclick = (e) => {
      e.preventDefault();
      removeAlg(this.caseId, Number(b.dataset.del));
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
        <div class="rp-head"><h2>${id ? 'Algorithmus bearbeiten' : 'Neuer Algorithmus'}</h2>
          <button type="button" class="rp-close" data-act="close" aria-label="Schließen">✕</button></div>
        <label class="select-row">Name
          <input type="text" class="alg-name" maxlength="40" placeholder="z. B. F2L 12, Sune …" value="${esc(this.editing.name)}" />
        </label>
        ${id ? `<p class="small">Training: ${tr.length}× · Ø ${t(avg(tr.slice(-12).map((x) => x.exec)))}</p>` : ''}
        <div class="alg-editor-slot">${this.editorHtml(true)}</div>
        <menu>
          ${id ? '<button type="button" class="danger" data-act="del">Löschen</button><button type="button" data-act="train-one">▶ Trainieren</button>' : ''}
        </menu>`;
      const d = this.dlg;
      d.querySelector('[data-act=close]').onclick = () => d.close();
      d.querySelector('.alg-name').oninput = (e) => (this.editing.name = e.target.value);
      d.querySelector('[data-act=del]')?.addEventListener('click', () => {
        if (!confirm('Diesen Algorithmus löschen?')) return;
        removeCustom(id);
        d.close();
      });
      d.querySelector('[data-act=train-one]')?.addEventListener('click', () => {
        d.close();
        this.h.train([id], caseName(id));
      });
      this.bindEditor(render, (alg) => {
        if (id) updateCustom(id, this.editing.name.trim() || 'Eigener Algorithmus', alg);
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
    return `Halte den Würfel mit <b>${COLOR_NAMES[at('U')]}</b> oben und <b>${COLOR_NAMES[at('F')]}</b> vorne (Kreuzfarbe ${COLOR_NAMES[cf]} unten).`;
  }

  editorHtml(always = false) {
    const ed = this.editing;
    if (!ed) return '';
    const rec = ed.mode === 'record';
    const text = rec ? groupMoves(this.recording?.moves || []).map((g) => g.text).join(' ') : ed.text;
    const check = this.check(text);
    return `<div class="alg-editor">
      <div class="seg-control">
        <button type="button" data-mode="type" class="${rec ? '' : 'on'}">Eintippen</button>
        <button type="button" data-mode="record" class="${rec ? 'on' : ''}">Am Würfel ausführen</button>
      </div>
      ${
        rec
          ? `<div class="rec-box">
              ${this.h.connected() ? `<p class="small">${this.holdHint()} Führe den Algorithmus jetzt aus – jeder Zug wird mitgeschrieben.</p>` : '<p class="error">Verbinde zuerst deinen Würfel (Timer-Tab).</p>'}
              <div class="rec-moves">${esc(text) || '<span class="small">Warte auf Züge …</span>'}</div>
              <button type="button" class="ghost" data-act="rec-reset">Neu beginnen</button>
            </div>`
          : `<textarea class="alg-input" rows="2" spellcheck="false" autocapitalize="off" placeholder="z. B. R U R' U' R' F R2 U' R' U' R U R' F'">${esc(ed.text)}</textarea>
             <p class="small">Erlaubt: R U F L D B, weite Züge (r, Rw), M E S, x y z, Klammern.</p>`
      }
      <div class="alg-check ${check.cls}">${check.msg}</div>
      <menu>
        <button type="button" data-act="ed-cancel">${always ? 'Abbrechen' : 'Verwerfen'}</button>
        <button type="button" class="primary" data-act="ed-save" ${check.ok ? '' : 'disabled'}>Speichern</button>
      </menu>
    </div>`;
  }

  check(text) {
    if (!tokenizeAlg(text).length) return { ok: false, cls: '', msg: '' };
    const r = checkAlg(this.caseId && !this.caseId.startsWith('Eigene') ? this.caseId : '', text);
    if (!r.ok) return { ok: false, cls: 'bad', msg: r.error };
    if (this.caseId && !this.caseId.startsWith('Eigene')) {
      return r.solves
        ? { ok: true, cls: 'good', msg: '✓ Löst diesen Fall.' }
        : { ok: true, cls: 'warn', msg: '⚠ Löst diesen Fall nicht (falsche Haltung oder anderer Fall?). Speichern geht trotzdem.' };
    }
    return { ok: true, cls: 'good', msg: `✓ ${tokenizeAlg(text).length} Züge` };
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
