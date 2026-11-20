/**
 * Raum-Ansicht: Teilnehmer mit Live-Würfel und Live-Zeit, Runden-Tabelle, Steuerung für den Gastgeber.
 */
import { L } from '../i18n.js';
import { CubeView } from './cube-view.js';
import { formatTime, formatSolve } from '../stats.js';
import { avatarHtml } from '../profile.js';
import { SOLVED, applyMove, isSolved, parseMove, formatMove, countHtm } from '../cube/facelets.js';
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
      <div class="room-cmp"></div>
      <div class="table-wrap"><table class="phase-table room-board"></table></div>`;
    panel.querySelector('.room-copy').addEventListener('click', () => this.h.onInvite());
    panel.querySelector('.room-next').addEventListener('click', () => this.h.onNextRound());
    panel.querySelector('.room-leave').addEventListener('click', () => this.h.onLeave());
    panel.querySelector('.room-auto input').addEventListener('change', (e) => this.h.onAutoChange(e.target.checked));
    document.getElementById('room-minis')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-watch]');
      if (b) this.openWatch(b.dataset.watch);
    });
    panel.querySelector('.room-people').addEventListener('click', (e) => {
      const card = e.target.closest('.person');
      if (!card) return;
      // Avatar/Name → Verlauf dieser Person; sonst (bei den anderen) zuschauen
      if (e.target.closest('.person-head') || card.classList.contains('me')) this.openHistory(card.dataset.id);
      else this.openWatch(card.dataset.id);
    });
    panel.querySelector('.room-board').addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-round]');
      if (tr) this.openRound(Number(tr.dataset.round));
    });
    // Fenster für Verlauf einer Person und frühere Runden
    this.info = document.createElement('dialog');
    this.info.className = 'big-dialog room-info';
    document.body.append(this.info);
    this.info.addEventListener('click', (e) => {
      if (e.target === this.info || e.target.closest('[data-act=close]')) return this.info.close();
      const r = e.target.closest('[data-round]');
      if (r) return this.openRound(Number(r.dataset.round));
      const pp = e.target.closest('[data-person]');
      if (pp) return this.openHistory(pp.dataset.person);
      const rp = e.target.closest('[data-replay]');
      if (rp) {
        const [id, n] = rp.dataset.replay.split('|');
        const c = this.cards.get(id);
        const rec = c?.rounds?.[n];
        if (rec) this.h.onReplay?.({ ...rec, name: c.name }, `${c.name} · ${L('Runde', 'Round')} ${n}`);
      }
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
      </div>
      <button type="button" class="primary wv-back">← ${L('Zurück zu meinem Würfel', 'Back to my cube')}</button>
      <div class="small wv-hint">${L('Sobald du selbst drehst, geht es automatisch zurück.', 'As soon as you turn your own cube, it goes back automatically.')}</div>`;
    document.body.append(this.watch);
    this.watch.querySelector('.rp-close').addEventListener('click', () => this.watch.close());
    this.watch.querySelector('.wv-back').addEventListener('click', () => this.watch.close());
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
    const size = room.maxPlayers ? ` ${L(`Plätze: ${room.maxPlayers}.`, `Seats: ${room.maxPlayers}.`)}` : '';
    this.message((room.isHost ? L('Teile den Code oder Link. Starte die erste Runde, sobald alle da sind.', 'Share the code or link. Start the first round once everyone is here.') : L('Verbunden. Warte auf die nächste Runde des Gastgebers.', 'Connected. Waiting for the host’s next round.')) + size);
  }

  hide() {
    this.panel.hidden = true;
    if (this.strip) {
      this.strip.hidden = true;
      this.stripHtml = '';
    }
    for (const c of this.cards.values()) {
      c.el.remove();
      c.cube?.cube.dispose();
      c.mini?.cube.dispose();
      c.miniEl?.remove();
    }
    this.cards.clear();
    const minis = document.getElementById('room-minis');
    if (minis) minis.hidden = true;
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
        c.mini?.cube.dispose();
        c.miniEl?.remove();
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
          <div class="person-head" title="${L('Verlauf ansehen', 'View history')}"><span class="avatar"></span><b class="person-name"></b><span class="person-status small"></span></div>
          <div class="person-cube"></div>
          <div class="person-time">–</div>
          ${me ? '' : `<div class="person-watch small">👁 ${L('Zuschauen', 'Watch')}</div>`}`;
        // Eigene Karte zuerst
        if (me) box.prepend(el);
        else box.append(el);
        c = { el, cube: null, phase: 'idle', startedAt: 0, last: null, state: SOLVED, moves: [], times: [], start: null, recent: [], me };
        // Live-Würfel für alle – auch für dich selbst
        c.cube = new CubeView(el.querySelector('.person-cube'));
        // Im Timer-Tab: kleine Live-Würfel der anderen unter dem eigenen großen Würfel
        const minis = document.getElementById('room-minis');
        if (!me && minis) {
          c.miniEl = document.createElement('button');
          c.miniEl.type = 'button';
          c.miniEl.className = 'rm-p';
          c.miniEl.dataset.watch = p.id;
          c.miniEl.innerHTML = `<div class="rm-cube"></div><div class="rm-info"><span class="rm-name"></span><b class="rm-time">–</b></div>`;
          minis.append(c.miniEl);
          minis.hidden = false;
          c.mini = new CubeView(c.miniEl.querySelector('.rm-cube'));
        }
        this.cards.set(p.id, c);
      }
      c.el.querySelector('.avatar').innerHTML = avatarHtml({ name: p.name, avatar: p.avatar });
      c.el.querySelector('.person-name').textContent = (me ? `${p.name} (${L('du', 'you')})` : p.name) + (p.host ? ' ★' : '');
      if (c.miniEl) c.miniEl.querySelector('.rm-name').textContent = p.name;
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
      if (msg.phase === 'done') this.#record(c);
      this.#status(c);
      if (watched) this.#watchResult(c);
    } else if (msg.kind === 'move') {
      const before = c.state;
      c.state = applyMove(c.state, msg.m);
      for (const v of [c.cube, c.mini]) v?.addMove(msg.m);
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
      for (const v of [c.cube, c.mini]) if (v) v.target = c.view;
      if (watched && this.watchCube) this.watchCube.target = c.view;
    }
  }

  /** Eigene Daten in der eigenen Karte zeigen (gleiches Format wie von den anderen) */
  self(kind, data) {
    if (this.room?.myId) this.live({ kind, ...data, from: this.room.myId });
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

  /** Mitgeschnittene Züge eines fertigen Solves für die Wiederholung speichern (je Runde) */
  #record(c) {
    const n = this.room?.board?.at(-1)?.n;
    if (!n || !c.start || !c.moves.length) return;
    if (!isSolved(c.moves.reduce(applyMove, c.start))) return;
    c.rounds ??= {};
    c.rounds[n] = { start: c.start, moves: [...c.moves], times: [...c.times] };
  }

  // ---------------- Verlauf und frühere Runden ----------------

  /** Verlauf einer Person: alle Runden mit Cross, F2L, OLL, PLL, Züge, TPS */
  openHistory(id) {
    const p = (this.room?.roster || []).find((x) => x.id === id);
    if (!p) return;
    const board = this.room.board || [];
    const eff = (r) => (r.penalty === 'DNF' ? Infinity : r.time + (r.penalty || 0));
    const rounds = board.filter((b) => b.results?.[id]);
    const t = (x) => (x == null ? '–' : formatTime(x));
    const me = id === this.room.myId;
    const avg = (f) => {
      const xs = rounds.map((b) => f(b.results[id])).filter((x) => x != null && Number.isFinite(x));
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    };
    const sp = (k) => (r) => r.splits?.[k]?.[0];
    const rows = [...rounds]
      .reverse()
      .map((b) => {
        const r = b.results[id];
        const c = this.cards.get(id);
        return `<tr data-round="${b.n}"><td>${b.n}</td><td><b>${formatSolve(r)}</b></td><td>${t(sp('cross')(r))}${r.splits?.x ? ' <span class="tag">X</span>' : ''}</td><td>${t(sp('f2l')(r))}</td><td>${t(sp('oll')(r))}</td><td>${t(sp('pll')(r))}</td><td>${r.moveCount ?? '–'}</td><td>${r.tps ? r.tps.toFixed(2) : '–'}${c?.rounds?.[b.n] ? ' ▶' : ''}</td></tr>`;
      })
      .join('');
    const valid = rounds.map((b) => eff(b.results[id])).filter(Number.isFinite);
    const tile = (v, k) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`;
    this.info.innerHTML = `<div class="rp-head"><div class="wv-who"><span class="avatar">${avatarHtml({ name: p.name, avatar: p.avatar })}</span><div><h2>${esc(p.name)}${me ? ` (${L('du', 'you')})` : ''}</h2><div class="small">${L('Verlauf in diesem Raum', 'History in this room')} · ${rounds.length} ${L('Runden', 'rounds')}</div></div></div>
        <button type="button" class="rp-close" data-act="close" aria-label="${L('Schließen', 'Close')}">✕</button></div>
      ${rounds.length
        ? `<div class="stats">
            ${tile(valid.length ? formatTime(Math.min(...valid)) : '–', L('Beste', 'Best'))}
            ${tile(t(avg((r) => eff(r))), 'Ø')}
            ${tile(t(avg(sp('cross'))), 'Ø Cross')}
            ${tile(t(avg(sp('f2l'))), 'Ø F2L')}
            ${tile(t(avg(sp('oll'))), 'Ø OLL')}
            ${tile(t(avg(sp('pll'))), 'Ø PLL')}
          </div>
          <div class="table-wrap"><table class="phase-table rh-table"><tr><th>${L('Runde', 'Round')}</th><th>${L('Zeit', 'Time')}</th><th>Cross</th><th>F2L</th><th>OLL</th><th>PLL</th><th>${L('Züge', 'Moves')}</th><th>TPS</th></tr>${rows}</table></div>
          <p class="small">${L('Runde antippen für den Vergleich und die Wiederholung (▶).', 'Tap a round for the comparison and replay (▶).')}</p>`
        : `<p class="small">${L('Noch keine Runde abgeschlossen.', 'No round finished yet.')}</p>`}`;
    if (!this.info.open) this.info.showModal();
  }

  /** Frühere Runde: Vergleich, Scramble, Wiederholungen */
  openRound(n) {
    const round = (this.room?.board || []).find((b) => b.n === n);
    if (!round) return;
    const roster = this.room.roster || [];
    const replays = roster
      .filter((p) => this.cards.get(p.id)?.rounds?.[n])
      .map((p) => `<button type="button" class="ghost small-btn" data-replay="${esc(p.id)}|${n}">▶ ${esc(p.id === this.room.myId ? L('Du', 'You') : p.name)}</button>`)
      .join('');
    this.info.innerHTML = `<div class="rp-head"><div><h2>${L('Runde', 'Round')} ${n}</h2><div class="small">${L('Vergleich und Wiederholung', 'Comparison and replay')}</div></div>
        <button type="button" class="rp-close" data-act="close" aria-label="${L('Schließen', 'Close')}">✕</button></div>
      ${compareHtml(round, roster, this.room.myId)}
      <div class="label rr-l">Scramble</div><div class="alg">${esc(round.scramble || '–')}</div>
      ${replays ? `<div class="label rr-l">${L('Ansehen', 'Watch again')}</div><div class="rr-replays">${replays}</div>` : `<p class="small">${L('Für diese Runde wurden keine Züge mitgeschnitten (z. B. später beigetreten).', 'No moves were recorded for this round (e.g. joined later).')}</p>`}
      <div class="rr-people small">${L('Verlauf ansehen', 'View history')}: ${roster.map((p) => `<button type="button" class="link-btn" data-person="${esc(p.id)}">${esc(p.name)}</button>`).join(' ')}</div>`;
    if (!this.info.open) this.info.showModal();
  }

  #setState(c, facelets) {
    c.state = facelets;
    for (const v of [c.cube, c.mini]) v?.setState(facelets);
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
    const n = countHtm(c.moves); // R2 = 1 Zug
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
        html += `<details class="wv-sol"><summary>${L('Lösung', 'Solution')} (${countHtm(c.moves)} ${L('Züge', 'moves')})</summary><div class="in-alg">${esc(groupAlg(c.moves.join(' ')))}</div></details>`;
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
    // Immer der Vergleich der aktuellen (bzw. letzten) Runde
    // Letzte Runde mit Ergebnissen (eine gerade gestartete, leere Runde verdrängt den Vergleich nicht)
    const shown = [...board].reverse().find((b) => Object.keys(b.results || {}).length) || round;
    this.panel.querySelector('.room-cmp').innerHTML = shown && roster.length ? compareHtml(shown, roster, this.room?.myId) : '';
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
        return `<tr data-round="${b.n}" title="${L('Runde ansehen', 'View round')}"><td>${b.n} ›</td>${roster
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
      if (c.miniEl) {
        const t = c.phase === 'running' ? formatTime(now - c.startedAt) : c.phase === 'done' && c.result ? formatSolve(c.result) : STATUS[c.phase] ?? '';
        const el = c.miniEl.querySelector('.rm-time');
        if (el.textContent !== t) el.textContent = t;
        c.miniEl.classList.toggle('live', c.phase === 'running');
      }
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
    // Strom sparen: flüssig nur, wenn jemand löst oder zugeschaut wird; ohne Raum fast gar nicht
    const busy = this.room && (this.watch.open || [...this.cards.values()].some((c) => c.phase === 'running'));
    if (busy) requestAnimationFrame(() => this.#tick());
    else setTimeout(() => this.#tick(), this.room ? 250 : 1000);
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

/**
 * Vergleich einer Runde: alle Teilnehmer nebeneinander – Zeit, Cross, F2L, OLL, PLL, Züge, TPS.
 * Bester Wert je Zeile grün, bei den anderen der Abstand dazu.
 */
export function compareHtml(round, roster, myId) {
  if (!round) return '';
  const people = [...roster].sort((a, b) => (a.id === myId ? -1 : b.id === myId ? 1 : 0));
  const res = (p) => round.results?.[p.id];
  const eff = (r) => (!r ? null : r.penalty === 'DNF' ? Infinity : r.time + (r.penalty || 0));
  const done = people.filter((p) => res(p));
  const t = (x) => (x == null ? '–' : formatTime(x));
  const rows = [
    { k: L('Zeit', 'Time'), v: (r) => eff(r), f: (r) => formatSolve(r), main: true },
    { k: 'Cross', v: (r) => r.splits?.cross?.[0], f: (r) => t(r.splits?.cross?.[0]) + (r.splits?.x ? ' <span class="tag">X</span>' : ''), cls: 'ph-cross' },
    { k: 'F2L', v: (r) => r.splits?.f2l?.[0], f: (r) => t(r.splits?.f2l?.[0]), cls: 'ph-pair' },
    { k: 'OLL', v: (r) => r.splits?.oll?.[0], f: (r) => t(r.splits?.oll?.[0]), cls: 'ph-oll' },
    { k: 'PLL', v: (r) => r.splits?.pll?.[0], f: (r) => t(r.splits?.pll?.[0]), cls: 'ph-pll' },
    { k: L('Züge', 'Moves'), v: (r) => r.moveCount, f: (r) => String(r.moveCount ?? '–'), num: true },
    { k: 'TPS', v: (r) => (r.tps == null ? null : -r.tps), f: (r) => (r.tps == null ? '–' : r.tps.toFixed(2)), num: true },
  ];
  const head = `<tr><th></th>${people
    .map((p) => `<th><span class="avatar">${avatarHtml({ name: p.name, avatar: p.avatar })}</span><span class="rc-name">${p.id === myId ? L('Du', 'You') : esc(p.name)}</span></th>`)
    .join('')}</tr>`;
  const body = rows
    .map((row) => {
      const vals = people.map((p) => (res(p) ? row.v(res(p)) : null));
      const finite = vals.filter((v) => v != null && Number.isFinite(v));
      const best = finite.length > 1 ? Math.min(...finite) : null;
      const cells = people
        .map((p, i) => {
          const r = res(p);
          if (!r) return `<td class="small rc-wait">${L('löst …', 'solving …')}</td>`;
          const v = vals[i];
          const win = best != null && v === best;
          const diff = best != null && v != null && Number.isFinite(v) && !win ? (row.num ? `<small>${row.k === 'TPS' ? '' : '+' + (v - best)}</small>` : `<small>+${formatTime(v - best)}</small>`) : '';
          return `<td class="${win ? 'win' : ''}">${row.f(r)}${diff}</td>`;
        })
        .join('');
      return `<tr class="${row.main ? 'rc-main' : ''}"><td class="rc-k">${row.cls ? `<i class="key ${row.cls}"></i>` : ''}${row.k}</td>${cells}</tr>`;
    })
    .join('');
  // Fazit
  let verdict = '';
  const times = done.map((p) => [p, eff(res(p))]).filter(([, v]) => Number.isFinite(v));
  if (done.length < people.length) verdict = L(`Warte auf ${people.length - done.length} …`, `Waiting for ${people.length - done.length} …`);
  else if (times.length) {
    const [winner, wt] = times.reduce((a, b) => (b[1] < a[1] ? b : a));
    const second = times.filter(([p]) => p !== winner).map(([, v]) => v);
    const gap = second.length ? Math.min(...second) - wt : null;
    const me = winner.id === myId;
    verdict = `🏆 ${me ? L('Du gewinnst', 'You win') : `${esc(winner.name)} ${L('gewinnt', 'wins')}`}${gap != null && gap > 0 ? ` ${L('mit', 'by')} ${formatTime(gap)}` : ''}`;
    // Wo war ich besser?
    const mine = res(people.find((p) => p.id === myId) || {});
    if (mine?.splits && people.length > 1) {
      const others = people.filter((p) => p.id !== myId && res(p)?.splits);
      const better = ['cross', 'f2l', 'oll', 'pll'].filter((k) => others.length && others.every((p) => res(p).splits[k][0] > mine.splits[k][0]));
      const names = { cross: 'Cross', f2l: 'F2L', oll: 'OLL', pll: 'PLL' };
      if (better.length) verdict += ` · ${L('Du warst schneller bei', 'You were faster at')} ${better.map((k) => names[k]).join(', ')}`;
    }
  }
  return `<div class="room-compare">
    <div class="rc-head"><b>${L('Vergleich', 'Comparison')} · ${L('Runde', 'Round')} ${round.n}</b><span class="small rc-verdict">${verdict}</span></div>
    <div class="table-wrap"><table class="rc-table">${head}${body}</table></div>
  </div>`;
}
