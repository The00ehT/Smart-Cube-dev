/**
 * Raum-Ansicht: Teilnehmer mit Live-Würfel und Live-Zeit, Runden-Tabelle, Steuerung für den Gastgeber.
 */
import { L } from '../i18n.js';
import { CubeView } from './cube-view.js';
import { formatTime, formatSolve } from '../stats.js';
import { avatarHtml } from '../profile.js';
import { SOLVED, applyMove, isSolved, parseMove, formatMove } from '../cube/facelets.js';
import { analyzeSolve } from '../cube/analysis.js';
import { liveStage, barHtml, liveCrossFace } from './live-bar.js';
import { cfopTable } from './cfop-table.js';
import { colorChip } from './replay.js';
import { groupAlg } from '../cube/alg-format.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const STATUS = {
  idle: L('wartet', 'waiting'),
  scrambling: L('scrambelt …', 'scrambling …'),
  ready: L('bereit', 'ready'),
  inspecting: L('Inspektion', 'inspecting'),
  running: L('löst …', 'solving …'),
  done: L('fertig', 'done'),
};

export class RoomView {
  constructor(panel, strip, handlers) {
    this.panel = panel;
    this.strip = strip;
    this.h = handlers;
    this.cards = new Map(); // id → { el, cube, phase, startedAt, state }
    panel.innerHTML = `
      <div class="room-head">
        <div>
          <span class="label">${L('Raum', 'Room')}</span>
          <b class="room-code"></b>
          <button type="button" class="room-copy">${L('Einladen', 'Invite')}</button>
        </div>
        <div class="room-ctrl">
          <span class="room-round"></span>
          <button type="button" class="room-next primary" hidden>${L('Neue Runde', 'New round')}</button>
          <label class="toggle room-auto" hidden><input type="checkbox" checked /> ${L('automatisch weiter', 'auto next')}</label>
          <button type="button" class="room-leave danger">${L('Verlassen', 'Leave')}</button>
        </div>
      </div>
      <div class="room-msg small"></div>
      <div class="room-people"></div>
      <div class="table-wrap"><table class="phase-table room-board"></table></div>`;
    panel.querySelector('.room-copy').addEventListener('click', () => this.h.onInvite());
    panel.querySelector('.room-next').addEventListener('click', () => this.h.onNextRound());
    panel.querySelector('.room-leave').addEventListener('click', () => this.h.onLeave());
    panel.querySelector('.room-auto input').addEventListener('change', (e) => this.h.onAutoChange(e.target.checked));
    panel.querySelector('.room-people').addEventListener('click', (e) => {
      const el = e.target.closest('.person:not(.me)');
      if (el) this.openWatch(el.dataset.id);
    });
    // Großes Zuschau-Fenster
    this.watch = document.createElement('dialog');
    this.watch.className = 'big-dialog watch-dialog';
    this.watch.innerHTML = `
      <div class="rp-head">
        <div class="wv-who"><span class="avatar"></span><div><h2 class="wv-name"></h2><div class="small wv-status"></div></div></div>
        <button type="button" class="rp-close" aria-label="${L('Schließen', 'Close')}">✕</button>
      </div>
      <div class="wv-body">
        <div class="wv-cube"></div>
        <div class="wv-side">
          <div class="wv-time">–</div>
          <div class="live-bar wv-bar"></div>
          <div class="wv-stats small"></div>
          <div class="wv-moves"></div>
          <div class="wv-result"></div>
        </div>
      </div>`;
    document.body.append(this.watch);
    this.watch.querySelector('.rp-close').addEventListener('click', () => this.watch.close());
    this.watch.addEventListener('close', () => {
      this.watchId = null;
      this.watchCube?.cube.dispose();
      this.watchCube = null;
    });
    this.#tick();
  }

  show(room) {
    this.room = room;
    this.panel.hidden = false;
    this.panel.querySelector('.room-code').textContent = room.code;
    this.panel.querySelector('.room-next').hidden = !room.isHost;
    this.panel.querySelector('.room-auto').hidden = !room.isHost;
    this.message(room.isHost ? L('Teile den Code oder Link. Starte die erste Runde, sobald alle da sind.', 'Share the code or link. Start the first round once everyone is here.') : L('Verbunden. Warte auf die nächste Runde des Gastgebers.', 'Connected. Waiting for the host’s next round.'));
  }

  hide() {
    this.panel.hidden = true;
    if (this.strip) {
      this.strip.hidden = true;
      this.stripHtml = '';
    }
    for (const c of this.cards.values()) c.el.remove();
    this.cards.clear();
    this.room = null;
  }

  message(text) {
    this.panel.querySelector('.room-msg').textContent = text || '';
  }

  /** Teilnehmerkarten an die Liste anpassen */
  renderRoster(roster) {
    const box = this.panel.querySelector('.room-people');
    const ids = new Set(roster.map((p) => p.id));
    for (const [id, c] of this.cards) {
      if (!ids.has(id)) {
        c.el.remove();
        c.cube?.cube.dispose();
        this.cards.delete(id);
        if (this.watchId === id) this.watch.close();
      }
    }
    for (const p of roster) {
      let c = this.cards.get(p.id);
      const me = p.id === this.room?.myId;
      if (!c) {
        const el = document.createElement('div');
        el.className = 'person' + (me ? ' me' : '');
        el.dataset.id = p.id;
        el.innerHTML = `
          <div class="person-head"><span class="avatar"></span><b class="person-name"></b><span class="person-status small"></span></div>
          <div class="person-cube"></div>
          <div class="person-time">–</div>
          ${me ? '' : `<div class="person-watch small">👁 ${L('Zuschauen', 'Watch')}</div>`}`;
        box.append(el);
        c = { el, cube: null, phase: 'idle', startedAt: 0, last: null, state: SOLVED, moves: [], times: [], start: null, recent: [] };
        // Für die anderen ein kleiner Live-Würfel (eigener Würfel ist ja groß zu sehen)
        if (!me) c.cube = new CubeView(el.querySelector('.person-cube'));
        else el.querySelector('.person-cube').innerHTML = `<div class="person-me small">${L('Du', 'You')}</div>`;
        this.cards.set(p.id, c);
      }
      c.el.querySelector('.avatar').innerHTML = avatarHtml({ name: p.name, avatar: p.avatar });
      c.el.querySelector('.person-name').textContent = p.name + (p.host ? ' ★' : '');
      c.name = p.name;
      c.avatar = p.avatar;
      this.#status(c);
    }
    this.renderBoard(this.room?.board || []);
  }

  #status(c) {
    c.el.querySelector('.person-status').textContent = STATUS[c.phase] ?? '';
    c.el.classList.toggle('running', c.phase === 'running');
    if (this.watchId && this.cards.get(this.watchId) === c) this.#watchStatus(c);
  }

  /** Live-Daten eines Teilnehmers */
  live(msg) {
    const c = this.cards.get(msg.from);
    if (!c) return;
    const watched = this.watchId === msg.from;
    if (msg.kind === 'status') {
      c.phase = msg.phase;
      if (msg.phase === 'running') c.startedAt = performance.now() - (msg.elapsed || 0);
      if (msg.phase === 'scrambling' || msg.phase === 'ready' || msg.phase === 'inspecting') {
        c.el.querySelector('.person-time').textContent = '0.00';
        c.result = null;
        if (msg.phase !== 'scrambling') c.moves = [];
      }
      if (msg.facelets && msg.facelets !== c.state && !(msg.phase === 'running' && c.moves.length)) this.#setState(c, msg.facelets);
      this.#status(c);
      if (watched) this.#watchResult(c);
    } else if (msg.kind === 'move') {
      const before = c.state;
      c.state = applyMove(c.state, msg.m);
      c.cube?.addMove(msg.m);
      if (watched) this.watchCube?.addMove(msg.m);
      c.recent.push(msg.m);
      if (c.recent.length > 40) c.recent.shift();
      if (msg.t === 0 || (msg.t != null && !c.moves.length)) {
        c.start = before;
        c.moves = [];
        c.times = [];
        c.result = null;
        if (msg.t === 0 && c.phase !== 'running') {
          c.phase = 'running';
          c.startedAt = performance.now();
          this.#status(c);
        }
      }
      if (msg.t != null) {
        c.moves.push(msg.m);
        c.times.push(msg.t);
      }
      if (watched) this.#watchMoves(c);
    } else if (msg.kind === 'state') {
      this.#setState(c, msg.facelets || SOLVED);
    } else if (msg.kind === 'view') {
      const [x, y, z, w] = msg.q || [];
      if (w == null) return;
      c.view = { x, y, z, w };
      if (c.cube) c.cube.target = c.view;
      if (watched && this.watchCube) this.watchCube.target = c.view;
    }
  }

  /** Ergebnis eines Teilnehmers: Zeit in der Karte stehen lassen */
  result(r) {
    const c = this.cards.get(r.from);
    if (!c) return;
    c.phase = 'done';
    c.result = r;
    c.el.querySelector('.person-time').textContent = formatSolve(r);
    this.#status(c);
    if (this.watchId === r.from) this.#watchResult(c);
  }

  #setState(c, facelets) {
    c.state = facelets;
    c.cube?.setState(facelets);
    if (this.watchId && this.cards.get(this.watchId) === c) this.watchCube?.setState(facelets);
  }

  // ---------------- Zuschauen ----------------

  openWatch(id) {
    const c = this.cards.get(id);
    if (!c || id === this.room?.myId) return;
    this.watchId = id;
    const w = this.watch;
    w.querySelector('.avatar').innerHTML = avatarHtml({ name: c.name, avatar: c.avatar });
    w.querySelector('.wv-name').textContent = c.name || '';
    if (!w.open) w.showModal();
    this.watchCube?.cube.dispose();
    this.watchCube = new CubeView(w.querySelector('.wv-cube'));
    this.watchCube.setState(c.state);
    if (c.view) this.watchCube.target = c.view;
    this.#watchStatus(c);
    this.#watchMoves(c);
    this.#watchResult(c);
  }

  #watchStatus(c) {
    this.watch.querySelector('.wv-status').textContent = STATUS[c.phase] ?? '';
    this.watch.classList.toggle('running', c.phase === 'running');
  }

  #watchMoves(c) {
    const w = this.watch;
    const n = c.moves.length;
    const t = c.times.at(-1) || 0;
    // Vierteldrehungen derselben Seite zusammenfassen (R R → R2), wie man sie liest
    const merged = [];
    for (const m of c.recent) {
      const p = parseMove(m);
      const last = merged.at(-1);
      if (p && last && last.face === p.face) {
        last.amount = (last.amount + p.amount) % 4;
        if (!last.amount) merged.pop();
      } else if (p) merged.push({ ...p });
    }
    const list = merged.slice(-14).map((x) => formatMove(x.face, x.amount));
    w.querySelector('.wv-moves').innerHTML = list.length
      ? `<div class="label">${L('Letzte Züge', 'Last moves')}</div><div class="wv-mv">${list.map((m, i) => `<span class="${i === list.length - 1 ? 'new' : ''}">${esc(m)}</span>`).join('')}</div>`
      : '';
    w.querySelector('.wv-stats').textContent = n ? `${n} ${L('Züge', 'moves')} · ${t > 0 ? ((n / t) * 1000).toFixed(1) : '–'} TPS` : '';
  }

  /** Nach dem Solve: Zeit und CFOP-Splits aus den mitgeschickten Zügen */
  #watchResult(c) {
    const box = this.watch.querySelector('.wv-result');
    if (c.phase !== 'done' || !c.result) {
      box.innerHTML = '';
      return;
    }
    let html = `<div class="wv-final">${formatSolve(c.result)}</div>`;
    if (c.start && c.moves.length && isSolved(c.moves.reduce(applyMove, c.start))) {
      try {
        const a = analyzeSolve(c.start, c.moves, c.times);
        const ph = a.phases;
        const pairs = ph.slice(1, 5);
        const sum = (k) => pairs.reduce((x, p) => x + (p[k] || 0), 0);
        html += cfopTable([
          { cls: 'ph-cross', name: 'Cross', extra: ` ${colorChip(a.crossFace)}${a.xcross ? ' <span class="tag">X</span>' : ''}`, time: ph[0].time, moves: ph[0].moves },
          { cls: 'ph-pair', name: 'F2L', time: sum('time'), moves: sum('moves'), recog: sum('recog'), sub: pairs.map((p, i) => ({ name: `${L('Paar', 'Pair')} ${i + 1}`, time: p.time, moves: p.moves, recog: p.recog })) },
          { cls: 'ph-oll', name: 'OLL', extra: ph[5].skip ? ' <span class="tag">Skip</span>' : a.ll?.oll ? ` <span class="small">${a.ll.oll}</span>` : '', time: ph[5].time, moves: ph[5].moves, recog: ph[5].recog },
          { cls: 'ph-pll', name: 'PLL', extra: ph[6].skip ? ' <span class="tag">Skip</span>' : a.ll?.pll ? ` <span class="small">${esc(a.ll.pll)}</span>` : '', time: ph[6].time, moves: ph[6].moves, recog: ph[6].recog },
        ]);
        html += `<details class="wv-sol"><summary>${L('Lösung', 'Solution')} (${c.moves.length} ${L('Züge', 'moves')})</summary><div class="in-alg">${esc(groupAlg(c.moves.join(' ')))}</div></details>`;
      } catch (err) {
        console.warn(err);
      }
    }
    box.innerHTML = html;
  }

  renderBoard(board) {
    const roster = this.room?.roster || [];
    const table = this.panel.querySelector('.room-board');
    const round = board.at(-1);
    this.panel.querySelector('.room-round').textContent = round ? `${L('Runde', 'Round')} ${round.n}` : L('Noch keine Runde', 'No round yet');
    if (!board.length || !roster.length) {
      table.innerHTML = '';
      return;
    }
    const eff = (r) => (!r ? null : r.penalty === 'DNF' ? Infinity : r.time + (r.penalty || 0));
    const wins = Object.fromEntries(roster.map((p) => [p.id, 0]));
    for (const b of board) {
      const ts = roster.map((p) => [p.id, eff(b.results[p.id])]).filter(([, t]) => t != null && Number.isFinite(t));
      if (ts.length < 2) continue;
      const best = Math.min(...ts.map(([, t]) => t));
      for (const [id, t] of ts) if (t === best) wins[id]++;
    }
    const head = `<tr><th>${L('Runde', 'Round')}</th>${roster.map((p) => `<th>${esc(p.name)}</th>`).join('')}</tr>`;
    const rows = [...board]
      .reverse()
      .slice(0, 12)
      .map((b) => {
        const ts = roster.map((p) => eff(b.results[p.id])).filter((t) => t != null);
        const best = ts.length ? Math.min(...ts) : null;
        return `<tr><td>${b.n}</td>${roster
          .map((p) => {
            const r = b.results[p.id];
            if (!r) return '<td class="small">–</td>';
            const win = ts.length > 1 && eff(r) === best && Number.isFinite(best);
            return `<td class="${win ? 'win' : ''}">${win ? '🏆 ' : ''}${formatSolve(r)}</td>`;
          })
          .join('')}</tr>`;
      })
      .join('');
    const mean = (id) => {
      const t = board.map((b) => eff(b.results[id])).filter((x) => x != null && Number.isFinite(x));
      return t.length ? formatTime(t.reduce((a, b) => a + b, 0) / t.length) : '–';
    };
    const foot = `<tr class="sum"><td>${L('Siege', 'Wins')}</td>${roster.map((p) => `<td>${wins[p.id]}</td>`).join('')}</tr>
      <tr class="sum"><td>Ø</td>${roster.map((p) => `<td>${mean(p.id)}</td>`).join('')}</tr>`;
    table.innerHTML = head + rows + foot;
  }

  #tick() {
    const now = performance.now();
    for (const c of this.cards.values()) {
      if (c.phase === 'running') c.el.querySelector('.person-time').textContent = formatTime(now - c.startedAt);
    }
    const wc = this.watchId && this.cards.get(this.watchId);
    if (wc && this.watch.open) {
      const time = wc.phase === 'running' ? formatTime(now - wc.startedAt) : wc.phase === 'done' && wc.result ? formatSolve(wc.result) : wc.phase === 'inspecting' || wc.phase === 'ready' ? '0.00' : '–';
      const tEl = this.watch.querySelector('.wv-time');
      if (tEl.textContent !== time) tEl.textContent = time;
      const stage = wc.phase === 'running' || wc.phase === 'done' ? liveStage(wc.state) : 0;
      const bar = wc.phase === 'running' || wc.phase === 'done' ? barHtml(stage) : '';
      if (bar !== this.watchBar) {
        this.watch.querySelector('.wv-bar').innerHTML = bar;
        this.watchBar = bar;
      }
      // Ohne Gyro-Daten: Kreuzfarbe nach unten drehen, sobald das Kreuz steht
      if (!wc.view && this.watchCube) this.watchCube.setDownFace(wc.phase === 'running' ? liveCrossFace(wc.state) : null);
    }
    this.#renderStrip();
    requestAnimationFrame(() => this.#tick());
  }

  /** Kurzleiste im Timer-Tab: die anderen mit Status bzw. Zeit */
  #renderStrip() {
    if (!this.room || !this.strip) return;
    const others = (this.room.roster || []).filter((p) => p.id !== this.room.myId);
    const round = this.room.board?.at(-1);
    const parts = others.map((p) => {
      const c = this.cards.get(p.id);
      const t = c ? c.el.querySelector('.person-time').textContent : '–';
      const st = c?.phase === 'running' ? t : c?.phase === 'done' ? t : STATUS[c?.phase] ?? '';
      return `<span class="rs-p${c?.phase === 'running' ? ' live' : ''}" data-watch="${esc(p.id)}"><span class="avatar">${avatarHtml({ name: p.name, avatar: p.avatar })}</span>${esc(p.name)} <b>${esc(st)}</b></span>`;
    });
    const html = `<span class="rs-code">${L('Raum', 'Room')} ${esc(this.room.code)}${round ? ` · ${L('Runde', 'Round')} ${round.n}` : ''}</span>${parts.join('') || `<span class="small">${L('Warte auf Mitspieler …', 'Waiting for players …')}</span>`}<span class="rs-go">›</span>`;
    if (html !== this.stripHtml) {
      this.strip.innerHTML = html;
      this.stripHtml = html;
    }
    this.strip.hidden = false;
  }
}
