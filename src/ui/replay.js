/**
 * Rekonstruktion eines Solves: Wiedergabe in Echtzeit (mit den gemessenen Zeiten jedes Zuges),
 * Kreuzfarbe automatisch unten (ohne Gyroskop: der Würfel wird rechnerisch gedreht),
 * mit Gyroskop-Daten auf Wunsch inklusive Würfeldrehungen (x/y/z) und Griffwechseln,
 * Lösung nach Phasen gegliedert, als Link teilbar.
 */
import { pairIcon } from './pair-icon.js';
import { L, locale, dec } from '../i18n.js';
import { moveCounts } from '../metrics.js';
import { TwistyPlayer } from 'cubing/twisty';
import { SOLVED, applyAlg, applyAnyAlg, CROSS_DOWN, COLOR_NAMES } from '../cube/facelets.js';
const YR = ['', 'y', 'y2', "y'"];
const mod4 = (n) => ((n % 4) + 4) % 4;
/** Schlüssel der Haltung je Phase: Kreuz, Paar 1–4, OLL, PLL (Position = Phasenindex) */
const HOLD_KEYS = ['cross', '1', '2', '3', '4', 'oll', 'pll'];
/** Drehung von Hand in der Phase: erst y, dann y', dann y2, dann wieder keine */
const ROT_CYCLE = ['', 'y', "y'", 'y2'];
import { viewerEvents } from '../cube/gyro.js';
import { detectWide, wideCount } from '../cube/wide.js';
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
          <div class="rp-front"></div>
          <div class="rp-phases"></div>
          <label class="toggle rp-gyro-toggle" hidden><input type="checkbox" class="rp-gyro" checked /> ${L('Rotations &amp; Regrips zeigen (Gyro)', 'Show rotations &amp; regrips (gyro)')}</label>
          <label class="toggle rp-wide-toggle"><input type="checkbox" class="rp-wide" checked /> ${L('Wide Moves &amp; Slices erkennen', 'Detect wide moves &amp; slices')} <span class="small rp-wide-count"></span></label>
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
      // Haltung bearbeiten: Tipp auf einen Zug setzt davor eine Würfeldrehung (auch mitten in einem Paar)
      if (mv && this.editHold && this.holdByPhase && mv.dataset.mi != null) return this.cycleRot(Number(mv.dataset.mi));
      if (mv) {
        this.pause();
        this.seekMove(Number(mv.dataset.k) + 1);
      }
    });
    $('.rp-share', dialog).addEventListener('click', () => this.share());
    // Haltung je Phase (Kreuz und jedes Paar): welche Farbe vorne – gilt für Ansicht, Notation und den Teilen-Link.
    // Gleiche Werte wie in der Analyse (solve.fronts: { cross, 1, 2, 3, 4 }).
    $('.rp-front', dialog).addEventListener('click', (e) => {
      if (!e.target.closest('[data-act=edit-hold]')) return;
      this.editHold = !this.editHold;
      this.renderFront();
      this.renderPhases();
    });
    $('.rp-phases', dialog).addEventListener('click', (e) => {
      const b = e.target.closest('[data-rfront]');
      if (!b || !this.solve) return;
      e.stopPropagation();
      const [key, k] = b.dataset.rfront.split('|');
      const f = { ...this.fronts() };
      f[key] = Number(k);
      // Paare, die noch nicht eingestellt sind, behalten die Haltung davor (keine Drehung)
      this.solve.fronts = f;
      this.solve.front = f.cross || 0;
      this.pause();
      const mi = this.events?.[Math.max(0, (this.k || 0) - 1)]?.i; // gleichen Zug wieder anzeigen
      this.build();
      const at = mi == null ? 0 : this.events.findIndex((ev) => ev.kind === 'move' && ev.i === mi) + 1;
      this.seekMove(Math.max(0, at));
      this.onFronts?.(this.solve, f);
    });
    $('.rp-race', dialog).addEventListener('click', () => {
      dialog.close();
      this.onRace?.(this.solve);
    });
    $('.rp-gyro', dialog).addEventListener('change', (e) => {
      this.useGyro = e.target.checked;
      this.pause();
      this.renderFront();
      this.build();
      this.seekMove(0);
      this.onGyroToggle?.(this.useGyro);
    });
    this.useGyro = true;
    // Wide Moves (r, u …) und Slices (M, E, S) erkennen: Voreinstellung an, gemerkt in diesem Browser
    try {
      this.wideOn = localStorage.getItem('smartcube.replayWide') !== '0';
    } catch {
      this.wideOn = true;
    }
    $('.rp-wide', dialog).checked = this.wideOn;
    $('.rp-wide', dialog).addEventListener('change', (e) => {
      this.wideOn = e.target.checked;
      try {
        localStorage.setItem('smartcube.replayWide', this.wideOn ? '1' : '0');
      } catch {
        /* egal */
      }
      this.pause();
      const mi = this.events?.[Math.max(0, (this.k || 0) - 1)]?.i;
      this.build();
      const at = mi == null ? 0 : this.events.findIndex((ev) => ev.kind === 'move' && ev.i === mi) + 1;
      this.seekMove(Math.max(0, at));
    });
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
      `${moveCounts(solve.moves).htm} ${L('Züge', 'moves')} · ${a.time > 0 ? ((moveCounts(solve.moves).htm / a.time) * 1000).toFixed(2) : '–'} TPS`,
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
    this.renderFront();
    this.seekMove(0);
  }

  /** Haltungen je Phase: { cross, 1..4 } (alte Links/Solves: nur „front“ fürs Kreuz) */
  fronts() {
    const f = { ...(this.solve.fronts || {}) };
    if (f.cross == null && this.solve.front) f.cross = this.solve.front;
    return f;
  }

  /** Farbe vorne bei Haltung k (Kreuz unten) */
  frontColor(k) {
    return applyAnyAlg(SOLVED, `${CROSS_DOWN[this.analysis.crossFace]} ${YR[k]}`)[22];
  }

  /** Haltung je Phase gilt nur ohne Gyro-Drehungen (mit Gyro sind die echten Drehungen bekannt) */
  get holdByPhase() {
    return !(this.hasGyro && this.useGyro);
  }

  /** Knopf „Haltung einstellen“ (Auswahl je Phase ein-/ausblenden) */
  renderFront() {
    const box = $('.rp-front', this.dlg);
    box.hidden = !this.holdByPhase;
    box.innerHTML = `<button type="button" class="ghost small-btn" data-act="edit-hold">${this.editHold ? `✓ ${L('Haltung fertig', 'Hold done')}` : `✎ ${L('Haltung (vorne) je Phase einstellen', 'Set hold (front) per phase')}`}</button>${
      this.editHold ? `<span class="small">${L('Farbe wählen = vorne in dieser Phase. Tipp auf einen Zug = Drehung davor (y → y′ → y2 → keine), z. B. mitten im Paar.', 'Pick a color = front in this phase. Tap a move = rotation before it (y → y′ → y2 → none), e.g. in the middle of a pair.')}</span>` : ''
    }`;
  }

  /** Haltungen der Phasen als Liste [Kreuz, Paar 1..4, OLL, PLL] – nicht eingestellte Phasen übernehmen die vorige */
  holds() {
    const f = this.fronts();
    const out = [mod4(f.cross || 0)];
    for (let k = 1; k < HOLD_KEYS.length; k++) out.push(f[HOLD_KEYS[k]] != null ? mod4(f[HOLD_KEYS[k]]) : out[k - 1]);
    return out;
  }

  /** Von Hand eingetragene Drehungen: [{ i (Zugindex), t, name }] – gelten nur ohne Gyro-Daten */
  manualRots() {
    return Object.entries(this.solve.rots || {})
      .map(([i, name]) => ({ i: Number(i), t: this.solve.times[Number(i)] ?? 0, name }))
      .filter((r) => r.i > 0 && YR.includes(r.name) && r.name);
  }

  /** Drehung vor dem Zug i umschalten (keine → y → y' → y2 → keine); der erste Zug einer Phase gehört zur Haltung */
  cycleRot(i) {
    const ph = this.analysis.phases.find((p) => p.moves && i >= p.start && i <= p.end);
    if (!ph || i === ph.start) {
      $('.rp-msg', this.dlg).textContent = L('Vor dem ersten Zug einer Phase stellst du die Haltung (Farbe vorne) ein.', 'Before the first move of a phase, set the hold (front color).');
      return;
    }
    $('.rp-msg', this.dlg).textContent = '';
    const rots = { ...(this.solve.rots || {}) };
    const next = ROT_CYCLE[(ROT_CYCLE.indexOf(rots[i] || '') + 1) % ROT_CYCLE.length];
    if (next) rots[i] = next;
    else delete rots[i];
    this.solve.rots = Object.keys(rots).length ? rots : undefined;
    this.pause();
    const mi = this.events?.[Math.max(0, (this.k || 0) - 1)]?.i;
    this.build();
    const at = mi == null ? 0 : this.events.findIndex((ev) => ev.kind === 'move' && ev.i === mi) + 1;
    this.seekMove(Math.max(0, at));
    this.onFronts?.(this.solve, this.fronts());
  }

  /** Ereignisliste (Züge aus Sicht des Lösers, ggf. Drehungen und Griffwechsel) neu aufbauen */
  build() {
    const s = this.solve;
    const holds = this.holds();
    const v0 = `${CROSS_DOWN[this.analysis.crossFace]} ${YR[holds[0]]}`.trim();
    const gyro = this.hasGyro && this.useGyro ? s.gyro : null;
    // Ohne Gyro: eingestellte Haltung je Paar als y-Drehung vor dem ersten Zug des Paares
    const rotations = gyro?.rotations ? [...gyro.rotations] : [];
    if (!gyro) {
      const manual = this.manualRots();
      rotations.push(...manual);
      // Haltung am Ende einer Phase = Haltung am Anfang + Drehungen mittendrin
      const midSteps = (p) => manual.filter((r) => r.i > p.start && r.i <= p.end).reduce((a, r) => a + YR.indexOf(r.name), 0);
      let cur = mod4(holds[0] + (this.analysis.phases[0]?.moves ? midSteps(this.analysis.phases[0]) : 0));
      for (let k = 1; k < HOLD_KEYS.length; k++) {
        const p = this.analysis.phases[k];
        if (!p?.moves) continue;
        const steps = mod4(holds[k] - cur);
        if (steps) rotations.push({ t: s.times[p.start] ?? 0, name: YR[steps] });
        cur = mod4(holds[k] + midSteps(p));
      }
    }
    // Kreuz unten; mit Gyro zusätzlich die gemessenen Drehungen
    let ev = viewerEvents(s.moves, s.times, { v0, rotations });
    // Wide Moves (Gegenseite + gleichzeitige Würfeldrehung, nur mit Gyro) und Slices (R L′ = M …) erkennen
    if (this.wideOn) ev = detectWide(ev, { gyro: !!gyro });
    $('.rp-wide-count', this.dlg).textContent = this.wideOn && wideCount(ev) ? `· ${wideCount(ev)} ${L('erkannt', 'found')}` : '';
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

  /**
   * Ereignisse für die Anzeige gruppieren: zwei gleiche Vierteldrehungen hintereinander → Doppelzug.
   * Erkannte Slices (label/hide) erscheinen als ein Zug; `literal` nutzt immer die echten Züge (für den Export).
   */
  groups(from, to, literal = false) {
    const out = [];
    const lab = (e) => (literal ? e.text : e.label ?? e.text);
    const endOf = (k) => (literal ? k : k + (this.events[k].span || 0));
    for (let k = from; k <= to; k++) {
      const e = this.events[k];
      if (!literal && e.hide) continue;
      const last = endOf(k);
      let nk = last + 1;
      while (!literal && nk <= to && this.events[nk]?.hide) nk++;
      const n = this.events[nk];
      if (e.kind === 'move' && n && nk <= to && n.kind === 'move' && lab(n) === lab(e) && !lab(e).endsWith('2')) {
        const nLast = endOf(nk);
        out.push({ text: lab(e)[0] + '2', first: k, last: nLast, kind: 'move' });
        k = nLast;
      } else {
        out.push({ text: lab(e), first: k, last, kind: e.kind });
        k = last;
      }
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
        // Export mit den echten Zügen (Slices als zwei Außenzüge), Wide Moves sind exakt gleichwertig
        const txt = this.groups(r[0], r[1], true).filter((g) => g.kind !== 'grip').map((g) => g.text).join(' ');
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
    const holdsNow = this.holds();
    const rows = a.phases.map((p, pi) => {
      const r = this.phaseRange(pi);
      const mv = r
        ? this.groups(r[0], r[1])
            .map((g) => `<span class="rp-mv ${g.kind}${this.events[g.first].wide || this.events[g.first].label ? ' wide' : ''}${this.editHold && this.holdByPhase && g.kind === 'move' ? ' editable' : ''}" data-k="${g.last}" data-first="${g.first}"${g.kind === 'move' && this.events[g.first].i != null ? ` data-mi="${this.events[g.first].i}"` : ''}${g.kind === 'grip' ? ` title="${L('Regrip (geschätzt)', 'Regrip (estimated)')}"` : this.events[g.first].wide ? ` title="${L('Wide Move erkannt: Gegenseite + Würfeldrehung', 'Wide move detected: opposite face + cube rotation')}"` : this.events[g.first].label ? ` title="${L('Slice erkannt: zwei gegenläufige Außenzüge', 'Slice detected: two opposite outer turns')}"` : ''}>${g.text}</span>`)
            .join(' ')
        : '';
      const rots = r ? this.events.slice(r[0], r[1] + 1).filter((e) => e.kind === 'rot').length : 0;
      const slot = p.slot ? ` ${pairIcon(p.slot, this.analysis?.crossFace)}` : '';
      // Haltung (vorne) fürs Kreuz und jedes Paar mit Zügen
      let hold = '';
      if (this.holdByPhase && pi < HOLD_KEYS.length && (pi === 0 || p.moves)) {
        const key = HOLD_KEYS[pi];
        const cur = holdsNow[pi];
        hold = this.editHold
          ? `<span class="rp-hold">${YR.map((_, i) => `<button type="button" class="in-fc${i === cur ? ' on' : ''}" data-rfront="${key}|${i}" title="${COLOR_NAMES[this.frontColor(i)]}">${colorChip(this.frontColor(i))}</button>`).join('')}</span>`
          : `<span class="rp-hold small" title="${L('vorne', 'front')}">${colorChip(this.frontColor(cur))}</span>`;
      }
      const skip = p.skip ? ' <span class="tag">Skip</span>' : '';
      const recog = p.recog > 0 ? `<span class="small">Recog ${formatTime(p.recog)}</span>` : '';
      const rotTag = rots ? `<span class="small">${rots} Rot.</span>` : '';
      return `<div class="rp-ph ph-${/^p\d$/.test(p.key) ? 'pair' : p.key}">
        <div class="rp-ph-head"><b>${PHASE_NAMES[p.key]}</b>${slot}${skip}${hold}
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
