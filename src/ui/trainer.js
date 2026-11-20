/**
 * Algorithmus-Trainer (OLL, PLL, F2L, eigene Algorithmen) – auch „Endlos-PLL“.
 *
 * Kein Setup-Scramble: Der Fall wird angezeigt (3D und Draufsicht), man führt einfach den
 * Algorithmus aus. Wie der echte Würfel gehalten wird oder aussieht, ist egal – erkannt wird
 * über die Züge in allen 24 Haltungen und mit jedem AUF (siehe cube/alg-detect.js).
 * Gemessen: Recog (bis zum ersten Zug) und Exec (erster Zug bis fertig).
 * Langsame und neue Fälle kommen öfter dran.
 */
import { L } from '../i18n.js';
import { applyAnyAlg, rotationFaceMap, CROSS_DOWN, HtmCounter } from '../cube/facelets.js';
import { CASE_STATE, stateForAlg, solvedUpToAuf, f2lSolved, llOriented } from '../cube/ll-cases.js';
import { displayState } from '../cube/f2l-cases.js';
import { AlgDetector } from '../cube/alg-detect.js';
import { algData, mainAlg, recordTraining, caseName, trainingBest, orientedCase } from '../algs.js';
import { groupAlg } from '../cube/alg-format.js';
import { llDiagram, f2lDiagram } from './ll-diagram.js';
import { CubeView } from './cube-view.js';
import { formatTime } from '../stats.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pickOne = (a) => a[Math.floor(Math.random() * a.length)];
const AUF = ['', 'U', 'U2', "U'"];
const VIEW = ['', 'y', 'y2', "y'"];
const PREF = 'smartcube.trainer';

/** Wann ist ein Fall fertig? (Zustand mit Kreuz unten) */
const DONE = {
  OLL: (s) => f2lSolved(s) && llOriented(s),
  PLL: solvedUpToAuf,
  F2L: f2lSolved,
};

export class Trainer {
  /** @param h { now(), connected(), crossFace(), onClose() } */
  constructor(dlg, h) {
    this.dlg = dlg;
    this.h = h;
    this.active = false;
    let pref = {};
    try {
      pref = JSON.parse(localStorage.getItem(PREF) || '{}');
    } catch {
      /* egal */
    }
    this.showName = pref.showName ?? false;
    this.prefOrient = pref.prefOrient ?? false; // OLL/PLL in bevorzugter Ausrichtung statt zufällig
    dlg.innerHTML = `
      <div class="rp-head">
        <div><h2 class="tr-title">Training</h2>
          <div class="small">${L('Führe den gezeigten Fall aus – wie du den Würfel hältst und wie er gerade aussieht, ist egal.', 'Perform the case shown – how you hold the cube and its current state don’t matter.')}</div></div>
        <button type="button" class="rp-close" aria-label="${L('Beenden', 'Stop')}">✕</button>
      </div>
      <div class="pd-main">
        <div class="pd-cube"></div>
        <div class="pd-side">
          <div class="pd-top"><div class="pd-dia"></div><button type="button" class="pd-name"></button></div>
          <div class="pd-time">0.00</div>
          <div class="pd-msg small"></div>
          <div class="pd-buttons">
            <button type="button" class="ghost" data-act="hint">💡 ${L('Alg zeigen', 'Show alg')}</button>
            <button type="button" class="ghost" data-act="skip">⏭ ${L('Überspringen', 'Skip')}</button>
          </div>
          <label class="toggle small"><input type="checkbox" class="pd-names" /> ${L('Namen gleich anzeigen', 'Show names right away')}</label>
          <label class="toggle small pd-orient-row"><input type="checkbox" class="pd-orient" /> ${L('Bevorzugte Ausrichtung (OLL/PLL)', 'Preferred orientation (OLL/PLL)')}</label>
        </div>
      </div>
      <div class="pd-stats"></div>
      <div class="table-wrap"><table class="phase-table tr-log"></table></div>
      <button type="button" class="primary pd-back">← ${L('Zurück', 'Back')}</button>`;
    const q = (s) => dlg.querySelector(s);
    q('.rp-close').onclick = () => dlg.close();
    q('.pd-back').onclick = () => dlg.close();
    dlg.addEventListener('close', () => this.stop());
    q('[data-act=skip]').onclick = () => this.next();
    q('[data-act=hint]').onclick = () => {
      // In bevorzugter Ausrichtung: nötigen AUF davor zeigen
      const pre = this.oriented?.preAuf ? `<span class="pd-auf">${this.oriented.preAuf}</span> ` : '';
      q('.pd-msg').innerHTML = `${pre}<span class="pd-alg">${esc(groupAlg(mainAlg(this.id)))}</span>`;
      this.revealed = true;
      this.renderName();
    };
    q('.pd-name').onclick = () => {
      this.revealed = true;
      this.renderName();
    };
    const savePref = () => {
      try {
        localStorage.setItem(PREF, JSON.stringify({ showName: this.showName, prefOrient: this.prefOrient }));
      } catch {
        /* egal */
      }
    };
    const names = q('.pd-names');
    names.checked = this.showName;
    names.onchange = () => {
      this.showName = names.checked;
      savePref();
      this.renderName();
    };
    const orient = q('.pd-orient');
    orient.checked = this.prefOrient;
    orient.onchange = () => {
      this.prefOrient = orient.checked;
      savePref();
      if (this.active && !this.firstAt && !this.done) this.next(this.id); // aktuellen Fall gleich neu zeigen
    };
    this.tick = this.tick.bind(this);
  }

  /** Training starten: Fälle (IDs wie 'PLL T', 'OLL 27', 'F2L 5', 'Eigene 3') und Titel */
  start(ids, title) {
    this.ids = ids.filter((id) => this.caseState(id));
    if (!this.ids.length) return;
    this.session = [];
    this.last = null;
    this.active = true;
    this.dlg.querySelector('.tr-title').textContent = title;
    if (!this.dlg.open) this.dlg.showModal();
    if (!this.cube) this.cube = new CubeView(this.dlg.querySelector('.pd-cube'));
    this.renderStats();
    this.next();
    requestAnimationFrame(this.tick);
    if (!this.h.connected()) this.dlg.querySelector('.pd-msg').textContent = L('Verbinde zuerst deinen Würfel (oder den virtuellen) im Timer-Tab.', 'Connect your cube (or the virtual one) in the Timer tab first.');
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    clearTimeout(this.nextTimer);
    this.h.onClose?.();
  }

  /** Fall-Zustand (Kreuz unten, aus Sicht des Lösers) */
  caseState(id) {
    if (CASE_STATE[id]) return CASE_STATE[id];
    const alg = mainAlg(id);
    try {
      return alg ? stateForAlg(alg) : null;
    } catch {
      return null; // ungültiger eigener Algorithmus: Fall auslassen statt das Training abzubrechen
    }
  }

  /** Gewichtete Auswahl: ungeübte und langsame Fälle öfter, nicht zweimal derselbe hintereinander */
  pick() {
    const all = this.ids.map((id) => avg((algData.train[id] || []).slice(-8).map((x) => x.exec)));
    const known = all.filter((x) => x != null);
    const ref = avg(known) || 1;
    const weights = this.ids.map((id, i) => {
      if (this.ids.length > 1 && id === this.last) return 0;
      const a = all[i];
      return a == null ? 3 : 0.5 + (a / ref) ** 2;
    });
    let r = Math.random() * weights.reduce((x, y) => x + y, 0);
    for (let i = 0; i < weights.length; i++) if ((r -= weights[i]) <= 0) return this.ids[i];
    return this.ids[0];
  }

  next(sameId) {
    clearTimeout(this.nextTimer);
    this.id = sameId || this.pick();
    this.last = this.id;
    const set = this.id.slice(0, 3);
    let base = this.caseState(this.id);
    let shown;
    this.oriented = null;
    const ll = set === 'OLL' || set === 'PLL';
    this.dlg.querySelector('.pd-orient-row').hidden = !this.ids.some((id) => /^(OLL|PLL) /.test(id));
    if (ll && this.prefOrient && (this.oriented = orientedCase(this.id))) {
      // Bevorzugte Ausrichtung: Muster oben liegt immer gleich (z. B. Headlights links);
      // zufälliger Blickwinkel nur für die Farben – y mit U-Gegendrehung lässt das Muster an seinem Platz
      base = this.oriented.state;
      const v = Math.floor(Math.random() * 4);
      shown = applyAnyAlg(base, `${['', "U'", 'U2', 'U'][v]} ${VIEW[v]}`);
    } else {
      // Zufälliger AUF; bei OLL/PLL auch zufälliger Blickwinkel (F2L bleibt im Slot vorne rechts)
      shown = applyAnyAlg(base, pickOne(AUF));
      if (ll) shown = applyAnyAlg(shown, pickOne(VIEW));
    }
    if (set === 'F2L') shown = displayState(shown);
    this.detector = new AlgDetector(base, DONE[set] || solvedUpToAuf);
    this.htm = new HtmCounter(); // angezeigte Züge: R2 = 1 Zug
    this.shownAt = this.h.now();
    this.firstAt = null;
    this.done = false;
    this.revealed = this.showName;
    this.cube.setState(this.physical(shown));
    const q = (s) => this.dlg.querySelector(s);
    q('.pd-dia').innerHTML = set === 'PLL' ? llDiagram(shown, 'pll', 96) : set === 'OLL' ? llDiagram(shown, 'oll', 96) : set === 'F2L' ? f2lDiagram(shown, 96) : '';
    q('.pd-time').textContent = '0.00';
    q('.pd-time').className = 'pd-time';
    q('.pd-msg').textContent = '';
    this.renderName();
  }

  /** Fall-Zustände sind aus Sicht des Lösers beschriftet – für den 3D-Würfel echte Farben (Kreuzfarbe unten) */
  physical(state) {
    const map = rotationFaceMap(CROSS_DOWN[this.h.crossFace?.() || 'U']);
    const inv = {};
    for (const [body, pos] of Object.entries(map)) inv[pos] = body;
    return [...state].map((c) => inv[c]).join('');
  }

  renderName() {
    const b = this.dlg.querySelector('.pd-name');
    const show = this.revealed || this.showName || this.done;
    b.textContent = show ? caseName(this.id) : L('Welcher Fall? (antippen)', 'Which case? (tap)');
    b.classList.toggle('hidden-name', !show);
  }

  /** Zug vom Würfel; true = verarbeitet */
  onMove(e) {
    if (!this.active || !this.dlg.open) return false;
    if (this.done) return true; // Nachdreh-AUF nach dem Erkennen ignorieren
    const t = e.localTimestamp ?? this.h.now();
    if (this.firstAt == null) this.firstAt = t;
    this.htm.push(e.move);
    if (this.detector.push(e.move)) this.finish(t);
    else if (this.detector.moves === 40) this.dlg.querySelector('.pd-msg').textContent = L('Verdreht? „Überspringen“ holt den nächsten Fall.', 'Messed up? “Skip” gets the next case.');
    return true;
  }

  finish(t) {
    this.done = true;
    const exec = Math.max(0, t - this.firstAt);
    const recog = Math.max(0, this.firstAt - this.shownAt);
    const pb = recordTraining(this.id, exec, recog);
    this.session.push({ id: this.id, exec, recog, pb, moves: this.htm.n });
    const q = (s) => this.dlg.querySelector(s);
    q('.pd-time').textContent = formatTime(exec);
    q('.pd-time').className = 'pd-time done';
    q('.pd-msg').innerHTML = `✓ <b>${esc(caseName(this.id))}</b> · Recog ${formatTime(recog)} · ${this.htm.n} ${L('Züge', 'moves')}${pb ? ` · <span class="tag pb-tag">🏆 PB</span>` : ''}`;
    this.renderName();
    this.renderStats();
    this.nextTimer = setTimeout(() => this.active && this.next(), 1000);
  }

  renderStats() {
    const s = this.session;
    const box = this.dlg.querySelector('.pd-stats');
    const log = this.dlg.querySelector('.tr-log');
    if (!s.length) {
      box.innerHTML = `<p class="small">${L('Noch nichts gelöst – leg los!', 'Nothing solved yet – go!')}</p>`;
      log.innerHTML = '';
      return;
    }
    const ex = s.map((x) => x.exec);
    const tile = (v, k) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`;
    box.innerHTML = `<div class="stats">
        ${tile(s.length, L('Gelöst', 'Solved'))}
        ${tile(formatTime(avg(ex)), 'Ø Exec')}
        ${tile(formatTime(avg(s.map((x) => x.recog))), 'Ø Recog')}
        ${tile(formatTime(Math.min(...ex)), L('Beste', 'Best'))}
      </div>`;
    // Je Fall dieser Runde: Anzahl, Ø, Bestzeit (alle Zeiten)
    const by = new Map();
    for (const x of s) by.set(x.id, [...(by.get(x.id) || []), x]);
    log.innerHTML =
      `<tr><th>${L('Fall', 'Case')}</th><th>×</th><th>Ø Recog</th><th>Ø Exec</th><th>PB</th></tr>` +
      [...by.entries()]
        .sort((a, b) => avg(b[1].map((x) => x.exec)) - avg(a[1].map((x) => x.exec)))
        .map(([id, xs]) => `<tr${xs.some((x) => x.pb) ? ' class="pb-row"' : ''}><td>${esc(caseName(id))}</td><td>${xs.length}</td><td>${formatTime(avg(xs.map((x) => x.recog)))}</td><td>${formatTime(avg(xs.map((x) => x.exec)))}</td><td>${formatTime(trainingBest(id))}</td></tr>`)
        .join('');
  }

  tick() {
    if (!this.active) return;
    if (this.firstAt != null && !this.done) this.dlg.querySelector('.pd-time').textContent = formatTime(this.h.now() - this.firstAt);
    requestAnimationFrame(this.tick);
  }
}
