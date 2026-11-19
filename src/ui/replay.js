/**
 * Rekonstruktion eines Solves: Wiedergabe in Echtzeit (mit den gemessenen Zeiten jedes Zuges),
 * Kreuzfarbe automatisch unten (ohne Gyroskop: der Würfel wird rechnerisch gedreht),
 * mit Gyroskop-Daten auf Wunsch inklusive Würfeldrehungen (x/y/z) und Griffwechseln,
 * Lösung nach Phasen gegliedert, als Link teilbar.
 */
import { L, locale, dec } from '../i18n.js';
import { moveCounts } from '../metrics.js';
import { TwistyPlayer } from 'cubing/twisty';
import { SOLVED, applyAlg, CROSS_DOWN, COLOR_NAMES } from '../cube/facelets.js';
import { viewerEvents } from '../cube/gyro.js';
import { analyzeSolve, PHASE_NAMES } from '../cube/analysis.js';
import { setupAlgFor } from './cube-view.js';
import { formatTime, formatSolve } from '../stats.js';
import { shareUrl } from '../share.js';

const $ = (sel, root) => root.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const colorChip = (f) => `<span class="chip-color c-${f}" title="${COLOR_NAMES[f]}"></span>`;

export class Replay {
  constructor(dialog) {
    this.dlg = dialog;
    this.player = null;
    this.raf = 0;
    this.speed = 1;
    dialog.innerHTML = `
      <div class="rp-head">
        <div>
          <h2 class="rp-title"></h2>
          <div class="small rp-sub"></div>
        </div>
        <button class="rp-close" aria-label="${L('Schließen', 'Close')}">✕</button>
      </div>
      <div class="rp-body">
        <div class="rp-stage">
          <div class="rp-cube"></div>
          <div class="rp-now">
            <span class="rp-clock">0.00</span>
            <span class="rp-phase"></span>
          </div>
          <input type="range" class="rp-seek" min="0" max="1000" value="0" step="1" aria-label="${L('Zeitpunkt', 'Position')}" />
          <div class="rp-controls">
            <button class="rp-start" title="${L('Zum Anfang', 'To start')}" aria-label="${L('Zum Anfang', 'To start')}">⏮</button>
            <button class="rp-prev" title="${L('Ein Zug zurück', 'Back one move')}" aria-label="${L('Ein Zug zurück', 'Back one move')}">◀</button>
            <button class="rp-play primary" aria-label="${L('Abspielen', 'Play')}">▶ ${L('Abspielen', 'Play')}</button>
            <button class="rp-next" title="${L('Ein Zug vor', 'Forward one move')}" aria-label="${L('Ein Zug vor', 'Forward one move')}">▶</button>
            <select class="rp-speed" aria-label="${L('Geschwindigkeit', 'Speed')}">
              <option value="0.25">${dec(0.25, 2)}×</option>
              <option value="0.5">${dec(0.5, 1)}×</option>
              <option value="1" selected>1× ${L('Echtzeit', 'real time')}</option>
              <option value="2">2×</option>
            </select>
          </div>
        </div>
        <div class="rp-side">
          <div class="rp-phases"></div>
          <label class="toggle rp-gyro-toggle" hidden><input type="checkbox" class="rp-gyro" checked /> ${L('Rotations &amp; Regrips zeigen (Gyro)', 'Show rotations &amp; regrips (gyro)')}</label>
          <div class="rp-actions">
            <button class="rp-share primary">${L('Teilen', 'Share')}</button>
            <button class="rp-race ghost" type="button">👻 ${L('Dagegen antreten', 'Race it')}</button>
            <a class="rp-twizzle" target="_blank" rel="noopener">${L('In Twizzle öffnen', 'Open in Twizzle')} ↗</a>
            <span class="rp-msg small"></span>
          </div>
        </div>
      </div>`;
    $('.rp-close', dialog).addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      this.pause();
      this.onClose?.();
    });
    $('.rp-play', dialog).addEventListener('click', () => (this.playing ? this.pause() : this.play()));
    $('.rp-start', dialog).addEventListener('click', () => this.seekMove(0));
    $('.rp-prev', dialog).addEventListener('click', () => this.seekMove(this.k - 1));
    $('.rp-next', dialog).addEventListener('click', () => this.seekMove(this.k + 1));
    $('.rp-speed', dialog).addEventListener('change', (e) => {
      const playing = this.playing;
      this.pause();
      this.speed = Number(e.target.value);
      if (this.player) this.player.tempoScale = Math.max(1.5, 5 * this.speed);
      if (playing) this.play();
    });
    $('.rp-seek', dialog).addEventListener('input', (e) => {
      this.pause();
      this.seekTime(Number(e.target.value));
    });
    $('.rp-phases', dialog).addEventListener('click', (e) => {
      const mv = e.target.closest('[data-k]');
      if (mv) {
        this.pause();
        this.seekMove(Number(mv.dataset.k) + 1);
      }
    });
    $('.rp-share', dialog).addEventListener('click', () => this.share());
    $('.rp-race', dialog).addEventListener('click', () => {
      dialog.close();
      this.onRace?.(this.solve);
    });
    $('.rp-gyro', dialog).addEventListener('change', (e) => {
      this.useGyro = e.target.checked;
      this.pause();
      this.build();
      this.seekMove(0);
      this.onGyroToggle?.(this.useGyro);
    });
    this.useGyro = true;
  }

  /**
   * @param solve { start, moves, times, scramble?, penalty?, date?, device? }
   * @param opts  { title?, shared? }
   */
  async open(solve, opts = {}) {
    this.pause();
    this.solve = solve;
    const a = analyzeSolve(solve.start, solve.moves, solve.times);
    this.analysis = a;
    this.total = solve.times.length ? solve.times[solve.times.length - 1] : 0;
    this.hasGyro = !!solve.gyro;
    if (opts.useGyro !== undefined) this.useGyro = opts.useGyro;

    const d = this.dlg;
    const shown = { time: a.time, penalty: solve.penalty || 0 };
    $('.rp-title', d).textContent = `${opts.title ? opts.title + ': ' : ''}${formatSolve(shown)}`;
    const g = solve.gyro;
    const sub = [
      solve.date ? new Date(solve.date).toLocaleString(locale) : null,
      `${moveCounts(solve.moves).htm} ${L('Züge', 'moves')} · ${a.tps.toFixed(2)} TPS`,
      `Cross ${COLOR_NAMES[a.crossFace]}${a.xcross ? ' · X-Cross' : ''}`,
      g ? `${g.rotations.length} Rotations · ~${g.regrips.length} Regrips` : null,
      solve.estimated ? L('ohne gemessene Zugzeiten (gleichmäßig verteilt)', 'no measured move times (evenly spread)') : null,
    ].filter(Boolean);
    $('.rp-sub', d).innerHTML = sub.map(esc).join(' · ');
    $('.rp-seek', d).max = String(Math.max(1, this.total));
    $('.rp-msg', d).textContent = '';
    $('.rp-share', d).hidden = !!solve.estimated;
    $('.rp-gyro-toggle', d).hidden = !this.hasGyro;
    $('.rp-gyro', d).checked = this.useGyro;
    if (!d.open) d.showModal();

    // Setup: Scramble (falls er zum Startzustand passt), sonst berechnet
    this.baseSetup =
      solve.scramble && applyAlg(SOLVED, solve.scramble) === solve.start ? solve.scramble : await setupAlgFor(solve.start);
    if (!this.player) {
      this.player = new TwistyPlayer({
        puzzle: '3x3x3',
        visualization: 'PG3D',
        experimentalSetupAnchor: 'start',
        background: 'none',
        controlPanel: 'none',
        hintFacelets: 'none',
        tempoScale: Math.max(1.5, 5 * this.speed),
      });
      this.player.classList.add('twisty');
      $('.rp-cube', d).append(this.player);
    }
    this.build();
    this.seekMove(0);
  }

  /** Ereignisliste (Züge aus Sicht des Lösers, ggf. Drehungen und Griffwechsel) neu aufbauen */
  build() {
    const s = this.solve;
    const v0 = CROSS_DOWN[this.analysis.crossFace];
    const gyro = this.hasGyro && this.useGyro ? s.gyro : null;
    // Kreuz unten; mit Gyro zusätzlich die gemessenen Drehungen
    const ev = viewerEvents(s.moves, s.times, { v0, rotations: gyro?.rotations || [] });
    for (const t of gyro?.regrips || []) {
      const at = ev.findIndex((e) => e.t > t);
      ev.splice(at < 0 ? ev.length : at, 0, { kind: 'grip', text: '✋', t });
    }
    this.events = ev;
    // Phase je Ereignis: Drehungen/Griffe gehören zur Phase des nächsten Zuges
    const phaseOfMove = (i) => this.analysis.phases.findIndex((p) => p.moves > 0 && i >= p.start && i <= p.end);
    let next = 6;
    for (let k = ev.length - 1; k >= 0; k--) {
      if (ev[k].kind === 'move') next = phaseOfMove(ev[k].i);
      ev[k].phase = next < 0 ? 6 : next;
    }
    this.setup = `${this.baseSetup} ${v0}`.trim();
    this.player.experimentalSetupAlg = this.setup;
    this.renderPhases();
    $('.rp-twizzle', this.dlg).href = this.twizzleUrl();
  }

  /** Ereignisse für die Anzeige gruppieren: zwei gleiche Vierteldrehungen hintereinander → Doppelzug */
  groups(from, to) {
    const out = [];
    for (let k = from; k <= to; k++) {
      const e = this.events[k];
      const n = this.events[k + 1];
      if (e.kind === 'move' && n && k + 1 <= to && n.kind === 'move' && n.text === e.text && !e.text.endsWith('2')) {
        out.push({ text: e.text[0] + '2', first: k, last: k + 1, kind: 'move' });
        k++;
      } else out.push({ text: e.text, first: k, last: k, kind: e.kind });
    }
    return out;
  }

  phaseRange(pi) {
    const ks = this.events.map((e, k) => (e.phase === pi ? k : -1)).filter((k) => k >= 0);
    return ks.length ? [ks[0], ks[ks.length - 1]] : null;
  }

  /** Lösung als Text mit Phasen-Kommentaren (Notation aus Sicht des Lösers) */
  annotated() {
    return this.analysis.phases
      .map((p, pi) => {
        const r = this.phaseRange(pi);
        if (!r) return null;
        const txt = this.groups(r[0], r[1]).filter((g) => g.kind !== 'grip').map((g) => g.text).join(' ');
        return txt ? `${txt} // ${PHASE_NAMES[p.key]}` : null;
      })
      .filter(Boolean)
      .join('\n');
  }

  twizzleUrl() {
    const q = new URLSearchParams({ 'setup-alg': this.setup, alg: this.annotated(), title: 'Smartcube-Rekonstruktion' });
    return `https://alpha.twizzle.net/edit/?${q}`;
  }

  renderPhases() {
    const a = this.analysis;
    const rows = a.phases.map((p, pi) => {
      const r = this.phaseRange(pi);
      const mv = r
        ? this.groups(r[0], r[1])
            .map((g) => `<span class="rp-mv ${g.kind}" data-k="${g.last}" data-first="${g.first}"${g.kind === 'grip' ? ` title="${L('Regrip (geschätzt)', 'Regrip (estimated)')}"` : ''}>${g.text}</span>`)
            .join(' ')
        : '';
      const rots = r ? this.events.slice(r[0], r[1] + 1).filter((e) => e.kind === 'rot').length : 0;
      const slot = p.slot ? ` ${[...p.slot].map(colorChip).join('')}` : '';
      const skip = p.skip ? ' <span class="tag">Skip</span>' : '';
      const recog = p.recog > 0 ? `<span class="small">Recog ${formatTime(p.recog)}</span>` : '';
      const rotTag = rots ? `<span class="small">${rots} Rot.</span>` : '';
      return `<div class="rp-ph ph-${/^p\d$/.test(p.key) ? 'pair' : p.key}">
        <div class="rp-ph-head"><b>${PHASE_NAMES[p.key]}</b>${slot}${skip}
          <span class="rp-ph-num">${formatTime(p.time)} · ${p.moves} Z.</span>${recog}${rotTag}</div>
        <div class="rp-ph-moves">${mv || '<span class="small">–</span>'}</div>
      </div>`;
    });
    $('.rp-phases', this.dlg).innerHTML = rows.join('');
  }

  /** Anzahl der Ereignisse bis einschließlich Zeitpunkt t */
  eventsAt(t) {
    let k = 0;
    while (k < this.events.length && this.events[k].t <= t) k++;
    return k;
  }

  seekTime(t) {
    this.cursor = Math.max(0, Math.min(t, this.total));
    this.setK(this.eventsAt(this.cursor));
    this.updateUi();
  }

  seekMove(k) {
    k = Math.max(0, Math.min(k, this.events.length));
    this.cursor = k > 0 ? this.events[k - 1].t : 0;
    this.setK(k);
    this.updateUi();
  }

  /** Würfel ohne Animation auf den Stand nach k Zügen setzen */
  setK(k) {
    this.k = k;
    if (!this.player) return;
    this.player.alg = this.events.slice(0, k).filter((e) => e.kind !== 'grip').map((e) => e.text).join(' ');
    this.player.jumpToEnd({ flash: false });
  }

  play() {
    if (!this.player || !this.events.length) return;
    if (this.k >= this.events.length) this.seekMove(0);
    this.playing = true;
    $('.rp-play', this.dlg).textContent = `⏸ ${L('Pause', 'Pause')}`;
    const wall0 = performance.now();
    const t0 = this.cursor;
    const step = () => {
      if (!this.playing) return;
      const t = t0 + (performance.now() - wall0) * this.speed;
      while (this.k < this.events.length && this.events[this.k].t <= t) {
        const e = this.events[this.k];
        if (e.kind !== 'grip') this.player.experimentalAddMove(e.text, { cancel: false });
        this.k++;
      }
      this.cursor = Math.min(t, this.total);
      this.updateUi();
      if (this.k >= this.events.length && t >= this.total) return this.pause();
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  pause() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    const b = this.dlg.querySelector('.rp-play');
    if (b) b.textContent = `▶ ${L('Abspielen', 'Play')}`;
  }

  updateUi() {
    const d = this.dlg;
    $('.rp-clock', d).textContent = formatTime(this.cursor);
    $('.rp-seek', d).value = String(Math.round(this.cursor));
    const last = this.k - 1;
    const e = this.events[last];
    $('.rp-phase', d).textContent = this.k === 0 ? 'Start' : PHASE_NAMES[this.analysis.phases[e.phase].key];
    d.querySelectorAll('.rp-mv.cur, .rp-mv.done').forEach((el) => el.classList.remove('cur', 'done'));
    d.querySelectorAll('.rp-mv').forEach((el) => {
      const k = Number(el.dataset.k);
      const first = Number(el.dataset.first);
      if (k < last) el.classList.add('done');
      else if (last >= first && last <= k) el.classList.add('cur');
    });
    // Aktuellen Zug sichtbar halten – nur innerhalb der Zugliste scrollen, nie die ganze Ansicht
    const cur = d.querySelector('.rp-mv.cur');
    const box = $('.rp-phases', d);
    if (cur && box.scrollHeight > box.clientHeight) {
      const top = cur.offsetTop;
      if (top < box.scrollTop + 8 || top > box.scrollTop + box.clientHeight - 40) box.scrollTop = Math.max(0, top - box.clientHeight / 3);
    }
  }

  async share() {
    const url = shareUrl(this.solve);
    const msg = $('.rp-msg', this.dlg);
    const text = `${L('Mein Solve', 'My solve')}: ${formatSolve({ time: this.analysis.time, penalty: this.solve.penalty || 0 })}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Smartcube-Rekonstruktion', text, url });
        return;
      }
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(url);
      msg.textContent = L('Link kopiert.', 'Link copied.');
    } catch {
      prompt(L('Link zum Teilen:', 'Link to share:'), url);
    }
  }
}
