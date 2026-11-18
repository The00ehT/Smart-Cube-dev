/**
 * Raum-Ansicht: Teilnehmer mit Live-Würfel und Live-Zeit, Runden-Tabelle, Steuerung für den Gastgeber.
 */
import { CubeView } from './cube-view.js';
import { formatTime, formatSolve } from '../stats.js';
import { avatarHtml } from '../profile.js';
import { SOLVED } from '../cube/facelets.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const STATUS = {
  idle: 'wartet',
  scrambling: 'scrambelt …',
  ready: 'bereit',
  inspecting: 'Inspektion',
  running: 'löst …',
  done: 'fertig',
};

export class RoomView {
  constructor(panel, handlers) {
    this.panel = panel;
    this.h = handlers;
    this.cards = new Map(); // id → { el, cube, phase, startedAt, state }
    panel.innerHTML = `
      <div class="room-head">
        <div>
          <span class="label">Raum</span>
          <b class="room-code"></b>
          <button type="button" class="room-copy">Einladen</button>
        </div>
        <div class="room-ctrl">
          <span class="room-round"></span>
          <button type="button" class="room-next primary" hidden>Neue Runde</button>
          <label class="toggle room-auto" hidden><input type="checkbox" checked /> automatisch weiter</label>
          <button type="button" class="room-leave danger">Verlassen</button>
        </div>
      </div>
      <div class="room-msg small"></div>
      <div class="room-people"></div>
      <div class="table-wrap"><table class="phase-table room-board"></table></div>`;
    panel.querySelector('.room-copy').addEventListener('click', () => this.h.onInvite());
    panel.querySelector('.room-next').addEventListener('click', () => this.h.onNextRound());
    panel.querySelector('.room-leave').addEventListener('click', () => this.h.onLeave());
    panel.querySelector('.room-auto input').addEventListener('change', (e) => this.h.onAutoChange(e.target.checked));
    this.#tick();
  }

  show(room) {
    this.room = room;
    this.panel.hidden = false;
    this.panel.querySelector('.room-code').textContent = room.code;
    this.panel.querySelector('.room-next').hidden = !room.isHost;
    this.panel.querySelector('.room-auto').hidden = !room.isHost;
    this.message(room.isHost ? 'Teile den Code oder Link. Starte die erste Runde, sobald alle da sind.' : 'Verbunden. Warte auf die nächste Runde des Gastgebers.');
  }

  hide() {
    this.panel.hidden = true;
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
        this.cards.delete(id);
      }
    }
    for (const p of roster) {
      let c = this.cards.get(p.id);
      const me = p.id === this.room?.myId;
      if (!c) {
        const el = document.createElement('div');
        el.className = 'person' + (me ? ' me' : '');
        el.innerHTML = `
          <div class="person-head"><span class="avatar"></span><b class="person-name"></b><span class="person-status small"></span></div>
          <div class="person-cube"></div>
          <div class="person-time">–</div>`;
        box.append(el);
        c = { el, cube: null, phase: 'idle', startedAt: 0, last: null };
        // Für die anderen ein kleiner Live-Würfel (eigener Würfel ist ja groß zu sehen)
        if (!me) c.cube = new CubeView(el.querySelector('.person-cube'));
        else el.querySelector('.person-cube').innerHTML = '<div class="person-me small">Du</div>';
        this.cards.set(p.id, c);
      }
      c.el.querySelector('.avatar').innerHTML = avatarHtml({ name: p.name, avatar: p.avatar });
      c.el.querySelector('.person-name').textContent = p.name + (p.host ? ' ★' : '');
      this.#status(c);
    }
    this.renderBoard(this.room?.board || []);
  }

  #status(c) {
    c.el.querySelector('.person-status').textContent = STATUS[c.phase] ?? '';
    c.el.classList.toggle('running', c.phase === 'running');
  }

  /** Live-Daten eines Teilnehmers */
  live(msg) {
    const c = this.cards.get(msg.from);
    if (!c) return;
    if (msg.kind === 'status') {
      c.phase = msg.phase;
      if (msg.phase === 'running') c.startedAt = performance.now() - (msg.elapsed || 0);
      if (msg.phase === 'scrambling' || msg.phase === 'ready') c.el.querySelector('.person-time').textContent = '0.00';
      this.#status(c);
    } else if (msg.kind === 'move') {
      c.cube?.addMove(msg.m);
    } else if (msg.kind === 'state') {
      c.cube?.setState(msg.facelets || SOLVED);
    }
  }

  /** Ergebnis eines Teilnehmers: Zeit in der Karte stehen lassen */
  result(r) {
    const c = this.cards.get(r.from);
    if (!c) return;
    c.phase = 'done';
    c.el.querySelector('.person-time').textContent = formatSolve(r);
    this.#status(c);
  }

  renderBoard(board) {
    const roster = this.room?.roster || [];
    const table = this.panel.querySelector('.room-board');
    const round = board.at(-1);
    this.panel.querySelector('.room-round').textContent = round ? `Runde ${round.n}` : 'Noch keine Runde';
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
    const head = `<tr><th>Runde</th>${roster.map((p) => `<th>${esc(p.name)}</th>`).join('')}</tr>`;
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
    const foot = `<tr class="sum"><td>Siege</td>${roster.map((p) => `<td>${wins[p.id]}</td>`).join('')}</tr>
      <tr class="sum"><td>Ø</td>${roster.map((p) => `<td>${mean(p.id)}</td>`).join('')}</tr>`;
    table.innerHTML = head + rows + foot;
  }

  #tick() {
    const now = performance.now();
    for (const c of this.cards.values()) {
      if (c.phase === 'running') c.el.querySelector('.person-time').textContent = formatTime(now - c.startedAt);
    }
    requestAnimationFrame(() => this.#tick());
  }
}
