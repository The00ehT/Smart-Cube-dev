/**
 * Rekonstruktion eines Solves: Wiedergabe in Echtzeit (mit den gemessenen Zeiten jedes Zuges),
 * Kreuzfarbe automatisch unten (ohne Gyroskop: der Würfel wird rechnerisch gedreht),
 * Lösung nach Phasen gegliedert, als Link teilbar.
 */
import { TwistyPlayer } from 'cubing/twisty';
import { SOLVED, applyAlg, CROSS_DOWN, translateMoves, COLOR_NAMES, groupMoves } from '../cube/facelets.js';
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
        <button class="rp-close" aria-label="Schließen">✕</button>
      </div>
      <div class="rp-body">
        <div class="rp-stage">
          <div class="rp-cube"></div>
          <div class="rp-now">
            <span class="rp-clock">0.00</span>
            <span class="rp-phase"></span>
          </div>
          <input type="range" class="rp-seek" min="0" max="1000" value="0" step="1" aria-label="Zeitpunkt" />
          <div class="rp-controls">
            <button class="rp-start" title="Zum Anfang" aria-label="Zum Anfang">⏮</button>
            <button class="rp-prev" title="Ein Zug zurück" aria-label="Ein Zug zurück">◀</button>
            <button class="rp-play primary" aria-label="Abspielen">▶ Abspielen</button>
            <button class="rp-next" title="Ein Zug vor" aria-label="Ein Zug vor">▶</button>
            <select class="rp-speed" aria-label="Geschwindigkeit">
              <option value="0.25">0,25×</option>
              <option value="0.5">0,5×</option>
              <option value="1" selected>1× Echtzeit</option>
              <option value="2">2×</option>
            </select>
          </div>
        </div>
        <div class="rp-side">
          <div class="rp-phases"></div>
          <div class="rp-actions">
            <button class="rp-share primary">Teilen</button>
            <a class="rp-twizzle" target="_blank" rel="noopener">In Twizzle öffnen ↗</a>
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
    this.rotation = CROSS_DOWN[a.crossFace];
    this.moves = translateMoves(solve.moves, this.rotation);
    this.times = solve.times;
    this.total = this.times.length ? this.times[this.times.length - 1] : 0;
    this.k = 0;
    this.cursor = 0;

    const d = this.dlg;
    const shown = { time: a.time, penalty: solve.penalty || 0 };
    $('.rp-title', d).textContent = `${opts.title ? opts.title + ': ' : ''}${formatSolve(shown)}`;
    const sub = [
      solve.date ? new Date(solve.date).toLocaleString('de-DE') : null,
      `${a.moveCount} Züge · ${a.tps.toFixed(2)} TPS`,
      `Kreuz ${COLOR_NAMES[a.crossFace]}${a.xcross ? ' · X-Cross' : ''}`,
      solve.estimated ? 'ohne gemessene Zugzeiten (gleichmäßig verteilt)' : null,
    ].filter(Boolean);
    $('.rp-sub', d).innerHTML = sub.map(esc).join(' · ');
    $('.rp-seek', d).max = String(Math.max(1, this.total));
    $('.rp-msg', d).textContent = '';
    $('.rp-share', d).hidden = !!solve.estimated;
    this.renderPhases();
    if (!d.open) d.showModal();

    // Setup: Scramble (falls er zum Startzustand passt), sonst berechnet; danach Kreuz nach unten drehen
    const setup =
      solve.scramble && applyAlg(SOLVED, solve.scramble) === solve.start ? solve.scramble : await setupAlgFor(solve.start);
    this.setup = `${setup} ${this.rotation}`.trim();
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
    this.player.experimentalSetupAlg = this.setup;
    this.seekMove(0);
    $('.rp-twizzle', d).href = this.twizzleUrl();
  }

  /** Lösung als Text mit Phasen-Kommentaren (Notation mit Kreuz unten) */
  annotated() {
    return this.analysis.phases
      .filter((p) => p.moves > 0)
      .map((p) => `${groupMoves(this.moves.slice(p.start, p.end + 1)).map((g) => g.text).join(' ')} // ${PHASE_NAMES[p.key]}`)
      .join('\n');
  }

  twizzleUrl() {
    const q = new URLSearchParams({ 'setup-alg': this.setup, alg: this.annotated(), title: 'Smartcube-Rekonstruktion' });
    return `https://alpha.twizzle.net/edit/?${q}`;
  }

  renderPhases() {
    const a = this.analysis;
    const rows = a.phases.map((p) => {
      const mv = groupMoves(this.moves.slice(p.start, p.end + 1), p.start)
        .map((g) => `<span class="rp-mv" data-k="${g.last}" data-first="${g.first}">${g.text}</span>`)
        .join(' ');
      const slot = p.slot ? ` ${[...p.slot].map(colorChip).join('')}` : '';
      const skip = p.skip ? ' <span class="tag">Skip</span>' : '';
      const recog = p.recog > 0 ? `<span class="small">Erk. ${formatTime(p.recog)}</span>` : '';
      return `<div class="rp-ph ph-${/^p\d$/.test(p.key) ? 'pair' : p.key}" data-start="${p.start}">
        <div class="rp-ph-head"><b>${PHASE_NAMES[p.key]}</b>${slot}${skip}
          <span class="rp-ph-num">${formatTime(p.time)} · ${p.moves} Z.</span>${recog}</div>
        <div class="rp-ph-moves">${mv || '<span class="small">–</span>'}</div>
      </div>`;
    });
    $('.rp-phases', this.dlg).innerHTML = rows.join('');
  }

  /** Anzahl der Züge, die zum Zeitpunkt t schon gemacht sind */
  movesAt(t) {
    let k = 0;
    while (k < this.times.length && this.times[k] <= t) k++;
    return k;
  }

  seekTime(t) {
    this.cursor = Math.max(0, Math.min(t, this.total));
    this.setK(this.movesAt(this.cursor));
    this.updateUi();
  }

  seekMove(k) {
    k = Math.max(0, Math.min(k, this.moves.length));
    this.cursor = k > 0 ? this.times[k - 1] : 0;
    this.setK(k);
    this.updateUi();
  }

  /** Würfel ohne Animation auf den Stand nach k Zügen setzen */
  setK(k) {
    this.k = k;
    if (!this.player) return;
    this.player.alg = this.moves.slice(0, k).join(' ');
    this.player.jumpToEnd({ flash: false });
  }

  play() {
    if (!this.player || !this.moves.length) return;
    if (this.k >= this.moves.length) this.seekMove(0);
    this.playing = true;
    $('.rp-play', this.dlg).textContent = '⏸ Pause';
    const wall0 = performance.now();
    const t0 = this.cursor;
    const step = () => {
      if (!this.playing) return;
      const t = t0 + (performance.now() - wall0) * this.speed;
      while (this.k < this.moves.length && this.times[this.k] <= t) {
        this.player.experimentalAddMove(this.moves[this.k], { cancel: false });
        this.k++;
      }
      this.cursor = Math.min(t, this.total);
      this.updateUi();
      if (this.k >= this.moves.length && t >= this.total) return this.pause();
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  pause() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    const b = this.dlg.querySelector('.rp-play');
    if (b) b.textContent = '▶ Abspielen';
  }

  updateUi() {
    const d = this.dlg;
    $('.rp-clock', d).textContent = formatTime(this.cursor);
    $('.rp-seek', d).value = String(Math.round(this.cursor));
    const last = this.k - 1;
    const ph = this.analysis.phases.find((p) => p.moves > 0 && last <= p.end) ?? this.analysis.phases[6];
    $('.rp-phase', d).textContent = this.k === 0 ? 'Start' : PHASE_NAMES[ph.key];
    d.querySelectorAll('.rp-mv.cur, .rp-mv.done').forEach((el) => el.classList.remove('cur', 'done'));
    d.querySelectorAll('.rp-mv').forEach((el) => {
      const k = Number(el.dataset.k);
      const first = Number(el.dataset.first);
      if (k < last) el.classList.add('done');
      else if (last >= first && last <= k) el.classList.add('cur');
    });
    const cur = d.querySelector('.rp-mv.cur');
    if (cur && this.playing) cur.scrollIntoView({ block: 'nearest' });
  }

  async share() {
    const url = shareUrl(this.solve);
    const msg = $('.rp-msg', this.dlg);
    const text = `Mein Solve: ${formatSolve({ time: this.analysis.time, penalty: this.solve.penalty || 0 })}`;
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
      msg.textContent = 'Link kopiert.';
    } catch {
      prompt('Link zum Teilen:', url);
    }
  }
}
