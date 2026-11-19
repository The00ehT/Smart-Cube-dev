/**
 * Endlos-PLL: Auf dem Bildschirm erscheint eine PLL nach der anderen, man führt sie einfach aus.
 * Der echte Würfel muss weder im passenden Zustand sein noch richtig gehalten werden –
 * erkannt wird über die Züge (siehe cube/alg-detect.js).
 * Gemessen: Recog (bis zum ersten Zug) und Exec (erster Zug bis fertig); zählt fürs Algorithmen-Training.
 */
import { L } from '../i18n.js';
import { applyAnyAlg, rotationFaceMap, CROSS_DOWN } from '../cube/facelets.js';
import { CASE_STATE, PLL_ALGS } from '../cube/ll-cases.js';
import { AlgDetector } from '../cube/alg-detect.js';
import { recordTraining, caseName, mainAlg, trainingBest } from '../algs.js';
import { groupAlg } from '../cube/alg-format.js';
import { llDiagram } from './ll-diagram.js';
import { CubeView } from './cube-view.js';
import { formatTime } from '../stats.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const ALL = Object.keys(PLL_ALGS).map((n) => `PLL ${n}`);
const AUF = ['', 'U', 'U2', "U'"];
const VIEW = ['', 'y', 'y2', "y'"];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const PREF = 'smartcube.plldrill';

export class PllDrill {
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
    dlg.innerHTML = `
      <div class="rp-head">
        <div><h2>∞ ${L('Endlos-PLL', 'Endless PLL')}</h2>
          <div class="small">${L('Führe die gezeigte PLL aus – wie du den Würfel hältst und wie er gerade aussieht, ist egal.', 'Perform the PLL shown – how you hold the cube and its current state don’t matter.')}</div></div>
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
        </div>
      </div>
      <div class="pd-stats"></div>
      <button type="button" class="primary pd-back">← ${L('Zurück zum Timer', 'Back to timer')}</button>`;
    const q = (s) => dlg.querySelector(s);
    q('.rp-close').onclick = () => dlg.close();
    q('.pd-back').onclick = () => dlg.close();
    dlg.addEventListener('close', () => this.stop());
    q('[data-act=skip]').onclick = () => this.next();
    q('[data-act=hint]').onclick = () => {
      q('.pd-msg').innerHTML = `<span class="pd-alg">${esc(groupAlg(mainAlg(this.id)))}</span>`;
      this.revealed = true;
      this.renderName();
    };
    q('.pd-name').onclick = () => {
      this.revealed = true;
      this.renderName();
    };
    const names = q('.pd-names');
    names.checked = this.showName;
    names.onchange = () => {
      this.showName = names.checked;
      try {
        localStorage.setItem(PREF, JSON.stringify({ showName: this.showName }));
      } catch {
        /* egal */
      }
      this.renderName();
    };
    this.tick = this.tick.bind(this);
  }

  start() {
    this.active = true;
    this.session = [];
    this.last = null;
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

  /** Nächster Fall: zufällig, nicht zweimal derselbe hintereinander; zufälliger AUF und Blickwinkel */
  next() {
    clearTimeout(this.nextTimer);
    const ids = ALL.filter((id) => id !== this.last);
    this.id = pick(ids);
    this.last = this.id;
    const base = CASE_STATE[this.id];
    this.shown = applyAnyAlg(applyAnyAlg(base, pick(AUF)), pick(VIEW));
    this.detector = new AlgDetector(base);
    this.shownAt = this.h.now();
    this.firstAt = null;
    this.done = false;
    this.revealed = this.showName;
    this.cube.setState(this.physical(this.shown));
    const q = (s) => this.dlg.querySelector(s);
    q('.pd-dia').innerHTML = llDiagram(this.shown, 'pll', 96);
    q('.pd-time').textContent = '0.00';
    q('.pd-time').className = 'pd-time';
    q('.pd-msg').textContent = '';
    this.renderName();
  }

  /**
   * Fall-Zustände sind aus Sicht des Lösers beschriftet (U = Farbe der letzten Schicht).
   * Für den 3D-Würfel echte Farben: Kreuzfarbe unten, z. B. Weiß unten → Gelb oben.
   */
  physical(state) {
    const map = rotationFaceMap(CROSS_DOWN[this.h.crossFace?.() || 'U']);
    const inv = {};
    for (const [body, pos] of Object.entries(map)) inv[pos] = body;
    return [...state].map((c) => inv[c]).join('');
  }

  renderName() {
    const b = this.dlg.querySelector('.pd-name');
    const show = this.revealed || this.showName || this.done;
    b.textContent = show ? caseName(this.id) : L('Welche PLL? (antippen)', 'Which PLL? (tap)');
    b.classList.toggle('hidden-name', !show);
  }

  /** Zug vom Würfel; true = verarbeitet */
  onMove(e) {
    if (!this.active || !this.dlg.open) return false;
    if (this.done) return true; // Nachdreh-AUF nach dem Erkennen ignorieren
    const t = e.localTimestamp ?? this.h.now();
    if (this.firstAt == null) this.firstAt = t;
    if (this.detector.push(e.move)) this.finish(t);
    else if (this.detector.moves === 40) this.dlg.querySelector('.pd-msg').textContent = L('Verdreht? „Überspringen“ holt den nächsten Fall.', 'Messed up? “Skip” gets the next case.');
    return true;
  }

  finish(t) {
    this.done = true;
    const exec = Math.max(0, t - this.firstAt);
    const recog = Math.max(0, this.firstAt - this.shownAt);
    const pb = recordTraining(this.id, exec, recog);
    this.session.push({ id: this.id, exec, recog, pb });
    const q = (s) => this.dlg.querySelector(s);
    q('.pd-time').textContent = formatTime(exec);
    q('.pd-time').className = 'pd-time done';
    q('.pd-msg').innerHTML = `✓ <b>${esc(caseName(this.id))}</b> · Recog ${formatTime(recog)}${pb ? ` · <span class="tag pb-tag">🏆 PB</span>` : ''}`;
    this.renderName();
    this.renderStats();
    this.nextTimer = setTimeout(() => this.active && this.next(), 900);
  }

  renderStats() {
    const s = this.session;
    const box = this.dlg.querySelector('.pd-stats');
    if (!s.length) {
      box.innerHTML = `<p class="small">${L('Noch nichts gelöst – leg los!', 'Nothing solved yet – go!')}</p>`;
      return;
    }
    const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const ex = s.map((x) => x.exec);
    const tile = (v, k) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`;
    box.innerHTML = `<div class="stats">
        ${tile(s.length, L('Gelöst', 'Solved'))}
        ${tile(formatTime(mean(ex)), 'Ø Exec')}
        ${tile(formatTime(mean(s.map((x) => x.recog))), 'Ø Recog')}
        ${tile(formatTime(Math.min(...ex)), L('Beste', 'Best'))}
      </div>
      <div class="pd-log">${s
        .slice(-14)
        .reverse()
        .map((x) => `<span class="${x.pb ? 'pb' : ''}" title="PB ${formatTime(trainingBest(x.id))}"><b>${esc(x.id.slice(4))}</b> ${formatTime(x.exec)}</span>`)
        .join('')}</div>`;
  }

  tick() {
    if (!this.active) return;
    if (this.firstAt != null && !this.done) this.dlg.querySelector('.pd-time').textContent = formatTime(this.h.now() - this.firstAt);
    requestAnimationFrame(this.tick);
  }
}
