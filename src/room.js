/**
 * Online-Räume über WebRTC (PeerJS). Kein eigener Server: Der PeerJS-Vermittlungsserver stellt nur die
 * Verbindung her, danach gehen die Daten direkt zwischen den Geräten.
 *
 * Aufbau als Stern: Der Gastgeber (Raum-Code = seine Peer-ID) ist mit allen verbunden, verteilt Scrambles,
 * sammelt Ergebnisse und leitet Live-Daten (Züge, Status) an alle anderen weiter.
 *
 * Nachrichten { type, … }:
 *   hello   { name, avatar }                         Teilnehmer → Gastgeber
 *   welcome { you, roster, board }                   Gastgeber → neuer Teilnehmer
 *   roster  { roster }                               Teilnehmerliste
 *   board   { board }                                Runden mit Scrambles und Ergebnissen
 *   round   { n, scramble }                          neue Runde
 *   live    { from, kind: 'status'|'move'|'state', … } Live-Daten zum Zuschauen
 *   result  { from, n, time, penalty, moveCount, tps } Ergebnis einer Runde
 *   full    { max }                                  Gastgeber → Teilnehmer: Raum ist voll
 *   skin    { from, skin }                           Aussehen des eigenen Würfels (einzeln, damit die Liste klein bleibt)
 */
import { L } from './i18n.js';
const PREFIX = 'smartcube-raum-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const HOST = 'host';

export const roomCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
export const normalizeCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);

/** Optional eigener PeerJS-Server per URL, z. B. ?peer=localhost:9000 (für Tests) */
export function peerOptions() {
  const o = new URLSearchParams(location.search).get('peer');
  if (!o) return { debug: 1 };
  const [host, port] = o.split(':');
  return { debug: 1, host, port: Number(port) || 9000, path: '/', secure: location.protocol === 'https:' && host !== 'localhost' };
}

export class Room {
  /**
   * @param me      { name, avatar }
   * @param handler (event) => void   Ereignisse: roster, board, round, live, result, closed, error, open
   */
  constructor(me, handler) {
    this.me = me;
    this.emit = handler;
    this.peer = null;
    this.conns = new Map(); // Gastgeber: Teilnehmer-ID → Verbindung
    this.hostConn = null; // Teilnehmer: Verbindung zum Gastgeber
    this.roster = [];
    this.board = [];
    this.isHost = false;
    this.myId = null;
    this.code = null;
    this.closed = false;
    this.maxPlayers = 0; // 0 = unbegrenzt
    this.skins = {}; // Teilnehmer-ID → Würfel-Aussehen
  }

  /** Eigenes Würfel-Aussehen an alle (auch später erneut, wenn es sich ändert) */
  setSkin(skin) {
    this.mySkin = sanitizeSkin(skin);
    if (!this.myId || !this.mySkin) return;
    const msg = { type: 'skin', from: this.myId, skin: this.mySkin };
    if (this.isHost) {
      this.skins[HOST] = this.mySkin;
      this.#broadcast(msg);
    } else if (this.hostConn?.open) this.hostConn.send(msg);
  }

  async #newPeer(id) {
    const { Peer } = await import('peerjs');
    return new Promise((resolve, reject) => {
      const peer = new Peer(id, peerOptions());
      const fail = (err) => {
        peer.destroy();
        reject(err);
      };
      peer.once('open', () => {
        peer.off('error', fail);
        resolve(peer);
      });
      peer.once('error', fail);
    });
  }

  // ---------------- Gastgeber ----------------

  /** @param opts { maxPlayers } – 0 = unbegrenzt */
  async create(opts = {}) {
    this.maxPlayers = Math.max(0, Math.min(50, Math.round(opts.maxPlayers || 0)));
    for (let attempt = 0; attempt < 4; attempt++) {
      const code = roomCode();
      try {
        this.peer = await this.#newPeer(PREFIX + code);
        this.code = code;
        break;
      } catch (err) {
        if (err?.type !== 'unavailable-id') throw err;
      }
    }
    if (!this.peer) throw new Error(L('Kein freier Raum-Code gefunden', 'No free room code found'));
    this.isHost = true;
    this.myId = HOST;
    this.roster = [{ id: HOST, name: this.me.name, avatar: this.me.avatar, fc: this.me.fc, host: true }];
    if (this.mySkin) this.skins[HOST] = this.mySkin;
    this.peer.on('connection', (conn) => this.#accept(conn));
    this.peer.on('error', (err) => this.emit({ type: 'error', error: err }));
    this.peer.on('disconnected', () => !this.closed && this.peer.reconnect());
    this.emit({ type: 'open' });
    this.#publishRoster();
    return this.code;
  }

  #accept(conn) {
    const id = conn.peer;
    conn.on('data', (msg) => this.#hostReceive(id, conn, msg));
    conn.on('close', () => {
      this.conns.delete(id);
      this.roster = this.roster.filter((p) => p.id !== id);
      this.#publishRoster();
    });
    conn.on('error', () => conn.close());
  }

  #hostReceive(id, conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'hello') {
      // Raum voll? (Gastgeber zählt mit)
      if (this.maxPlayers && !this.conns.has(id) && this.roster.length >= this.maxPlayers) {
        conn.send({ type: 'full', max: this.maxPlayers });
        setTimeout(() => conn.close(), 400);
        return;
      }
      this.conns.set(id, conn);
      const p = { id, name: String(msg.name || L('Gast', 'Guest')).slice(0, 24), avatar: sanitizeAvatar(msg.avatar), fc: sanitizeCode(msg.fc) };
      this.roster = [...this.roster.filter((x) => x.id !== id), p];
      conn.send({ type: 'welcome', you: id, roster: this.roster, board: this.board, max: this.maxPlayers });
      for (const [from, skin] of Object.entries(this.skins)) if (from !== id) conn.send({ type: 'skin', from, skin });
      this.#publishRoster();
      return;
    }
    if (!this.conns.has(id)) return;
    if (msg.type === 'skin') {
      const skin = sanitizeSkin(msg.skin);
      if (!skin) return;
      this.skins[id] = skin;
      const out = { type: 'skin', from: id, skin };
      this.#broadcast(out, id);
      this.emit(out);
      return;
    }
    if (msg.type === 'live') {
      const out = { ...msg, from: id };
      this.#broadcast(out, id);
      this.emit(out);
    } else if (msg.type === 'result') {
      this.#recordResult({ ...msg, from: id });
    }
  }

  #broadcast(msg, except) {
    for (const [id, c] of this.conns) if (id !== except && c.open) c.send(msg);
  }

  #publishRoster() {
    this.#broadcast({ type: 'roster', roster: this.roster });
    this.emit({ type: 'roster', roster: this.roster });
  }

  #publishBoard() {
    this.#broadcast({ type: 'board', board: this.board });
    this.emit({ type: 'board', board: this.board });
  }

  #recordResult(r) {
    const round = this.board.find((b) => b.n === r.n);
    if (!round) return;
    round.results[r.from] = { time: r.time, penalty: r.penalty, moveCount: r.moveCount, tps: r.tps, splits: cleanSplits(r.splits) };
    this.#publishBoard();
    this.emit({ type: 'result', ...r });
  }

  /** Gastgeber: neue Runde mit diesem Scramble */
  startRound(scramble) {
    if (!this.isHost) return;
    const n = (this.board.at(-1)?.n ?? 0) + 1;
    this.board.push({ n, scramble, results: {} });
    if (this.board.length > 50) this.board.shift();
    const msg = { type: 'round', n, scramble };
    this.#broadcast(msg);
    this.#publishBoard();
    this.emit(msg);
  }

  /** Haben alle aktuell Anwesenden die Runde beendet? */
  roundComplete() {
    const round = this.board.at(-1);
    return !!round && this.roster.length > 0 && this.roster.every((p) => round.results[p.id]);
  }

  // ---------------- Teilnehmer ----------------

  async join(code) {
    this.code = normalizeCode(code);
    if (this.code.length !== 5) throw new Error(L('Der Raum-Code hat 5 Zeichen.', 'The room code has 5 characters.'));
    this.peer = await this.#newPeer();
    this.peer.on('error', (err) => this.emit({ type: 'error', error: err }));
    await new Promise((resolve, reject) => {
      const conn = this.peer.connect(PREFIX + this.code, { reliable: true });
      const timer = setTimeout(() => reject(new Error(L('Raum nicht gefunden oder nicht erreichbar.', 'Room not found or not reachable.'))), 12000);
      this.peer.once('error', (err) => {
        clearTimeout(timer);
        reject(err?.type === 'peer-unavailable' ? new Error(L('Raum nicht gefunden.', 'Room not found.')) : err);
      });
      conn.on('open', () => {
        this.hostConn = conn;
        conn.send({ type: 'hello', name: this.me.name, avatar: this.me.avatar, fc: this.me.fc });
      });
      // Erst „drin“, wenn der Gastgeber uns angenommen hat (welcome) – oder abgelehnt (voll)
      this.joinWait = {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      };
      conn.on('data', (msg) => this.#clientReceive(msg));
      conn.on('close', () => (this.joinWait ? this.joinWait.reject(new Error(L('Verbindung zum Raum getrennt.', 'Connection to the room closed.'))) : this.#closedByHost()));
      conn.on('error', () => (this.joinWait ? this.joinWait.reject(new Error(L('Verbindung zum Raum fehlgeschlagen.', 'Connection to the room failed.'))) : this.#closedByHost()));
    });
    this.joinWait = null;
    this.emit({ type: 'open' });
  }

  #clientReceive(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'full':
        this.closed = true;
        this.joinWait?.reject(new Error(L(`Der Raum ist voll (max. ${Number(msg.max) || '?'} Spieler).`, `The room is full (max. ${Number(msg.max) || '?'} players).`)));
        this.joinWait = null;
        break;
      case 'welcome':
        this.myId = msg.you;
        this.maxPlayers = Math.max(0, Math.min(50, Number(msg.max) || 0));
        this.joinWait?.resolve();
        this.roster = msg.roster;
        this.board = msg.board;
        this.emit({ type: 'roster', roster: this.roster });
        this.emit({ type: 'board', board: this.board });
        if (this.board.length) this.emit({ type: 'round', ...this.board.at(-1), late: true });
        if (this.mySkin) this.hostConn?.send({ type: 'skin', from: this.myId, skin: this.mySkin });
        break;
      case 'skin': {
        const skin = sanitizeSkin(msg.skin);
        if (skin && typeof msg.from === 'string') {
          this.skins[msg.from] = skin;
          this.emit({ type: 'skin', from: msg.from, skin });
        }
        break;
      }
      case 'roster':
        this.roster = msg.roster;
        this.emit(msg);
        break;
      case 'board':
        this.board = msg.board;
        this.emit(msg);
        break;
      case 'round':
      case 'live':
        this.emit(msg);
        break;
    }
  }

  #closedByHost() {
    if (this.closed) return;
    this.closed = true;
    this.emit({ type: 'closed', reason: L('Der Gastgeber hat den Raum verlassen.', 'The host has left the room.') });
    this.peer?.destroy();
  }

  // ---------------- Für beide ----------------

  /** Live-Daten verschicken: status { phase }, move { m }, state { facelets } */
  live(kind, data) {
    const msg = { type: 'live', kind, ...data, from: this.myId };
    if (this.isHost) this.#broadcast(msg);
    else if (this.hostConn?.open) this.hostConn.send(msg);
  }

  result(n, solve) {
    const r = { type: 'result', n, time: solve.time, penalty: solve.penalty, moveCount: solve.moveCount, tps: solve.tps, splits: splitsOf(solve) };
    if (this.isHost) this.#recordResult({ ...r, from: HOST });
    else if (this.hostConn?.open) this.hostConn.send(r);
  }

  leave() {
    this.closed = true;
    try {
      this.hostConn?.close();
      for (const c of this.conns.values()) c.close();
      this.peer?.destroy();
    } catch {
      /* schon zu */
    }
  }
}

/** Nur Emojis oder kleine Bilder (Daten-URL) annehmen */
export function sanitizeAvatar(a) {
  if (!a || typeof a !== 'object') return null;
  if (a.type === 'emoji' && typeof a.value === 'string' && a.value.length <= 16) return a;
  if (a.type === 'image' && typeof a.value === 'string' && a.value.startsWith('data:image/') && a.value.length < 60000) return a;
  return null;
}

const SKIN_OPT = { style: ['gan', 'classic', 'tiles', 'stickerless'], body: ['black', 'gray', 'white'], finish: ['gloss', 'matte'], theme: ['colors', 'custom'] };
const okImg = (v, max) => typeof v === 'string' && v.startsWith('data:image/') && v.length < max;
/** Würfel-Aussehen prüfen: nur bekannte Werte, Bilder nur als Daten-URL und begrenzt groß */
export function sanitizeSkin(sk) {
  if (!sk || typeof sk !== 'object') return null;
  const out = {};
  for (const [k, list] of Object.entries(SKIN_OPT)) if (list.includes(sk[k])) out[k] = sk[k];
  if (out.theme === 'custom' && sk.images && typeof sk.images === 'object') {
    const imgs = {};
    let total = 0;
    for (const f of 'URFDLB') {
      const v = sk.images[f];
      if (okImg(v, 150000) && (total += v.length) < 700000) imgs[f] = v;
    }
    out.images = imgs;
  }
  if (okImg(sk.logo, 150000)) out.logo = sk.logo;
  return out;
}

/** Freundescode (8 Zeichen) prüfen */
export const sanitizeCode = (c) => (typeof c === 'string' && /^[A-Z0-9]{8}$/.test(c) ? c : null);

/** Phasen eines Solves für den Vergleich im Raum: Cross · F2L · OLL · PLL (Zeit und Züge) */
function splitsOf(solve) {
  const ph = solve.phases;
  if (!ph || ph.length < 7) return null;
  const sum = (k) => ph.slice(1, 5).reduce((a, p) => a + (p[k] || 0), 0);
  return {
    cross: [ph[0].time, ph[0].moves],
    f2l: [sum('time'), sum('moves')],
    oll: [ph[5].time, ph[5].moves],
    pll: [ph[6].time, ph[6].moves],
    x: !!solve.xcross,
  };
}
/** Fremde Daten nur als Zahlen übernehmen */
function cleanSplits(s) {
  if (!s || typeof s !== 'object') return null;
  const pair = (v) => (Array.isArray(v) && v.length === 2 && v.every((n) => Number.isFinite(n) && n >= 0 && n < 3.6e6) ? [Math.round(v[0]), Math.round(v[1])] : null);
  const out = { cross: pair(s.cross), f2l: pair(s.f2l), oll: pair(s.oll), pll: pair(s.pll), x: s.x === true };
  return out.cross && out.f2l && out.oll && out.pll ? out : null;
}
