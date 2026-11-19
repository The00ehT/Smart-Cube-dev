/**
 * Algorithmus-Trainer: Die App berechnet vom aktuellen Würfelzustand aus ein Setup, das den gewünschten
 * Fall herstellt (zufälliger Blickwinkel/AUF, verschleiert durch den Löser). Danach misst sie
 * Erkennung (Pause bis zum ersten Zug) und Ausführung (erster Zug bis gelöst).
 * Langsame und neue Fälle kommen öfter dran.
 */
import { L } from '../i18n.js';
import { ScrambleTracker } from '../cube/scramble-tracker.js';
import { applyAnyAlg, CROSS_DOWN, isSolved, relativeState } from '../cube/facelets.js';
import { stateForAlg, bodyCaseState, solvedUpToAuf, f2lSolved, llOriented, CASE_STATE } from '../cube/ll-cases.js';
import { algData, mainAlg, recordTraining, caseName } from '../algs.js';
import { setupAlgFor } from './cube-view.js';
import { caseDiagram } from './ll-diagram.js';
import { formatTime } from '../stats.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export class Trainer {
  /** @param h { state(), crossFace(), connected(), now() } */
  constructor(dlg, h) {
    this.dlg = dlg;
    this.h = h;
    this.active = false;
    dlg.innerHTML = `
      <div class="rp-head">
        <div><h2 class="tr-title">Training</h2><div class="small tr-sub"></div></div>
        <button type="button" class="rp-close" aria-label="${L('Beenden', 'Stop')}">✕</button>
      </div>
      <div class="tr-main">
        <div class="tr-phase label"></div>
        <div class="scramble tr-setup"></div>
        <div class="tr-timer">0.00</div>
        <div class="tr-msg small"></div>
        <div class="tr-result"></div>
        <div class="tr-buttons">
          <button type="button" class="ghost" data-act="skip">${L('Anderer Fall', 'Other case')}</button>
          <button type="button" class="primary" data-act="next" hidden>${L('Weiter', 'Next')}</button>
        </div>
        <label class="toggle small"><input type="checkbox" class="tr-auto" checked /> ${L('automatisch weiter', 'auto next')}</label>
      </div>
      <h3 class="sub-h">${L('Diese Runde', 'This session')}</h3>
      <div class="table-wrap"><table class="phase-table tr-log"></table></div>`;
    dlg.querySelector('.rp-close').onclick = () => dlg.close();
    dlg.addEventListener('close', () => this.stop());
    dlg.querySelector('[data-act=skip]').onclick = () => this.nextCase();
    dlg.querySelector('[data-act=next]').onclick = () => this.nextCase();
    this.tick = this.tick.bind(this);
  }

  start(ids, title) {
    this.ids = ids;
    this.session = [];
    this.active = true;
    this.dlg.querySelector('.tr-title').textContent = `Training · ${title}`;
    this.dlg.querySelector('.tr-sub').textContent = L(`${ids.length} ${ids.length === 1 ? 'Fall' : 'Fälle'} · langsame und neue Fälle kommen öfter`, `${ids.length} ${ids.length === 1 ? 'case' : 'cases'} · slow and new cases come up more often`);
    this.renderLog();
    if (!this.dlg.open) this.dlg.showModal();
    if (!this.h.connected()) {
      this.show(L('Kein Würfel', 'No cube'), '', L('Verbinde zuerst deinen Würfel (oder den virtuellen Würfel) im Timer-Tab.', 'Connect your cube (or the virtual cube) in the Timer tab first.'));
      return;
    }
    this.nextCase();
    requestAnimationFrame(this.tick);
  }

  stop() {
    this.active = false;
    this.phase = null;
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

  async nextCase() {
    if (!this.active) return;
    clearTimeout(this.autoTimer);
    const id = this.pick();
    this.last = id;
    this.caseId = id;
    this.moves = 0;
    this.phase = 'prepare';
    this.show(L('Setup wird berechnet …', 'Computing setup …'), '', '');
    // Der Fall, den dein Haupt-Algorithmus löst
    const viewerCase = stateForAlg(mainAlg(id));
    const target = bodyCaseState(viewerCase, this.h.crossFace());
    try {
      const setup = await setupAlgFor(relativeState(this.h.state(), target));
      if (!this.active || this.caseId !== id) return;
      this.target = target;
      this.tracker = new ScrambleTracker(setup);
      this.phase = this.tracker.done ? 'ready' : 'setup';
      if (this.phase === 'ready') this.readyAt = this.h.now();
      this.renderSetup();
    } catch (err) {
      console.error(err);
      this.show(L('Fehler', 'Error'), '', L('Setup konnte nicht berechnet werden: ', 'Could not compute setup: ') + (err?.message || err));
    }
  }

  show(phase, setupHtml, msg) {
    const d = this.dlg;
    d.querySelector('.tr-phase').textContent = phase;
    d.querySelector('.tr-setup').innerHTML = setupHtml;
    d.querySelector('.tr-msg').textContent = msg;
    d.querySelector('.tr-result').innerHTML = '';
    d.querySelector('[data-act=next]').hidden = true;
    d.querySelector('[data-act=skip]').hidden = false;
    const tm = d.querySelector('.tr-timer');
    tm.className = 'tr-timer';
    tm.textContent = '0.00';
  }

  renderSetup() {
    if (this.phase === 'setup') {
      const html = this.tracker
        .remainingMoves()
        .map((m, i) => `<span class="mv${m.correction ? ' correction' : ''}${i === 0 ? ' next' : ''}">${m.text}</span>`)
        .join('');
      this.show(L('Setup ausführen', 'Apply setup'), html, L('Halte den Würfel wie beim Lösen (Cross unten). Der Fall bleibt bis zum Ende versteckt.', 'Hold the cube like when solving (cross down). The case stays hidden until the end.'));
    } else if (this.phase === 'ready') {
      this.show(L('Erkennen und lösen!', 'Recognize and solve!'), '', L('Die Zeit startet mit deinem ersten Zug.', 'The timer starts with your first move.'));
      this.dlg.querySelector('.tr-timer').classList.add('ready');
    }
  }

  /** Zug vom Würfel; liefert true, wenn der Trainer ihn verarbeitet hat */
  onMove(e, stateAfter) {
    if (!this.active || !this.dlg.open) return false;
    const t = e.localTimestamp ?? this.h.now();
    if (this.phase === 'setup') {
      this.tracker.push(e.move);
      if (this.tracker.done) {
        this.phase = 'ready';
        this.readyAt = t;
      }
      this.renderSetup();
    } else if (this.phase === 'ready') {
      this.phase = 'running';
      this.firstAt = t;
      this.moves = 1;
      this.dlg.querySelector('.tr-phase').textContent = L('Läuft …', 'Running …');
      this.dlg.querySelector('.tr-msg').textContent = '';
      this.dlg.querySelector('.tr-timer').className = 'tr-timer';
      this.checkDone(stateAfter, t);
    } else if (this.phase === 'running') {
      this.moves++;
      this.checkDone(stateAfter, t);
    }
    return true;
  }

  checkDone(state, t) {
    const viewer = applyAnyAlg(state, CROSS_DOWN[this.h.crossFace()]);
    const id = this.caseId;
    const ok = id.startsWith('OLL') ? f2lSolved(viewer) && llOriented(viewer) : id.startsWith('F2L') ? f2lSolved(viewer) : solvedUpToAuf(viewer) || isSolved(state);
    if (ok) {
      const exec = t - this.firstAt;
      const recog = this.firstAt - this.readyAt;
      this.phase = 'done';
      recordTraining(this.caseId, exec, recog);
      this.session.push({ id: this.caseId, exec, recog, moves: this.moves });
      this.showResult(exec, recog);
      this.renderLog();
    } else if (this.moves > 40) {
      this.dlg.querySelector('.tr-msg').textContent = L('Das sieht nicht nach dem Fall aus – „Anderer Fall“ startet neu.', 'That doesn’t look like the case – “Other case” starts over.');
    }
  }

  showResult(exec, recog) {
    const d = this.dlg;
    const id = this.caseId;
    const tm = d.querySelector('.tr-timer');
    tm.textContent = formatTime(exec);
    tm.className = 'tr-timer done';
    d.querySelector('.tr-phase').textContent = L('✓ Gelöst', '✓ Solved');
    const set = id.slice(0, 3);
    const hist = (algData.train[id] || []).slice(-12).map((x) => x.exec);
    d.querySelector('.tr-result').innerHTML = `
      <div class="tr-case">
        ${caseDiagram(id, 64)}
        <div>
          <b>${esc(caseName(id))}</b>
          <div class="small">Recog ${formatTime(recog)} · Exec ${formatTime(exec)} · ${this.moves} ${L('Züge', 'moves')}</div>
          <div class="small">${L('Ø der letzten', 'Ø of last')} ${hist.length}: ${formatTime(avg(hist))}</div>
          <div class="alg-text small">${esc(mainAlg(id))}</div>
        </div>
      </div>`;
    d.querySelector('[data-act=next]').hidden = false;
    d.querySelector('[data-act=skip]').hidden = true;
    if (d.querySelector('.tr-auto').checked) this.autoTimer = setTimeout(() => this.phase === 'done' && this.nextCase(), 1800);
  }

  renderLog() {
    const rows = [...this.session]
      .reverse()
      .slice(0, 15)
      .map((r) => `<tr><td>${esc(caseName(r.id))}</td><td>${formatTime(r.recog)}</td><td>${formatTime(r.exec)}</td></tr>`)
      .join('');
    const mean = avg(this.session.map((r) => r.exec));
    this.dlg.querySelector('.tr-log').innerHTML = this.session.length
      ? `<tr><th>${L('Fall', 'Case')}</th><th>Recog</th><th>Exec</th></tr>${rows}<tr class="sum"><td>Ø (${this.session.length})</td><td>${formatTime(avg(this.session.map((r) => r.recog)))}</td><td>${formatTime(mean)}</td></tr>`
      : `<tr><td class="small">${L('Noch keine Fälle in dieser Runde.', 'No cases yet in this session.')}</td></tr>`;
  }

  tick() {
    if (!this.active) return;
    if (this.phase === 'running') this.dlg.querySelector('.tr-timer').textContent = formatTime(this.h.now() - this.firstAt);
    requestAnimationFrame(this.tick);
  }
}
