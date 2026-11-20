/**
 * Lobby für öffentliche Räume – ohne eigenen Server.
 *
 * Die Lobby ist eine feste Peer-ID im selben PeerJS-Netz wie die Räume. Das Gerät, das als Erstes einen
 * öffentlichen Raum öffnet, übernimmt sie; weitere öffentliche Räume melden sich dort an, wer Räume sucht,
 * bekommt dort die Liste. Schließt das Lobby-Gerät, übernimmt automatisch ein anderer öffentlicher Raum.
 *
 * Nachrichten:
 *   announce { room }   Raum-Gastgeber → Lobby (auch für Aktualisierungen: Spielerzahl, Runde)
 *   remove   { code }   Raum-Gastgeber → Lobby
 *   watch    {}         Suchender → Lobby: Liste schicken und aktuell halten
 *   list     { rooms }  Lobby → Suchende
 */
import { peerOptions, normalizeCode } from './room.js';

const LOBBY_ID = 'smartcube-lobby-v1';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fremde Angaben nur geprüft übernehmen */
export function cleanRoom(r) {
  if (!r || typeof r !== 'object') return null;
  const code = normalizeCode(r.code);
  if (code.length !== 5) return null;
  const int = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
  const raw = r.avatar?.type === 'emoji' ? r.avatar.value : r.emoji; // vom Gastgeber (avatar) oder aus der Liste (emoji)
  const emoji = typeof raw === 'string' && raw.length <= 16 ? raw : '';
  return {
    code,
    name: String(r.name || '').slice(0, 40),
    host: String(r.host || '').slice(0, 24),
    emoji,
    players: Math.max(1, int(r.players, 50)),
    max: int(r.max, 50), // 0 = unbegrenzt
    round: int(r.round, 9999),
    created: int(r.created, 4e12),
  };
}

export class Lobby {
  constructor() {
    this.peer = null;
    this.isLobby = false;
    this.conn = null; // Verbindung zur Lobby (wenn nicht selbst Lobby)
    this.rooms = new Map(); // nur als Lobby: code → { room, conn }
    this.watchers = new Set(); // nur als Lobby: Verbindungen der Suchenden
    this.mine = null; // eigener öffentlicher Raum
    this.watching = false;
    this.listeners = new Set();
    this.list = [];
  }

  // ---------------- Öffentlich ----------------

  /** Eigenen Raum öffentlich machen (oder Angaben aktualisieren) */
  async announce(room) {
    this.mine = cleanRoom(room);
    if (!this.mine) return;
    await this.#ensure(true);
    this.#sendMine();
  }

  /** Eigenen Raum aus der Liste nehmen; als Lobby: Lobby abgeben, damit ein anderer übernimmt */
  withdraw() {
    const code = this.mine?.code;
    this.mine = null;
    if (this.isLobby) {
      this.#drop();
      if (this.watching) this.#ensure(false);
    } else if (code && this.conn?.open) this.conn.send({ type: 'remove', code });
  }

  /** Liste öffentlicher Räume beobachten; cb(rooms) bei jeder Änderung. Rückgabe: stop() */
  watch(cb) {
    this.listeners.add(cb);
    this.watching = true;
    cb(this.list);
    const look = () => {
      if (!this.isLobby && !this.conn?.open) this.#ensure(!!this.mine);
    };
    look();
    // Später geöffnete öffentliche Räume finden (falls gerade keine Lobby da war)
    const timer = setInterval(look, 8000);
    return () => {
      clearInterval(timer);
      this.listeners.delete(cb);
      if (!this.listeners.size) this.watching = false;
    };
  }

  // ---------------- intern ----------------

  #notify(list) {
    this.list = list;
    for (const cb of this.listeners) cb(list);
  }

  #drop() {
    try {
      this.conn?.close();
      this.peer?.destroy();
    } catch {
      /* egal */
    }
    this.peer = null;
    this.conn = null;
    this.isLobby = false;
    this.rooms.clear();
    this.watchers.clear();
  }

  async #newPeer(id) {
    const { Peer } = await import('peerjs');
    return new Promise((resolve, reject) => {
      const peer = id ? new Peer(id, peerOptions()) : new Peer(peerOptions());
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

  /**
   * Verbindung zur Lobby sicherstellen. claim = true: Ist keine Lobby da, selbst Lobby werden
   * (nur Gastgeber öffentlicher Räume – Suchende ohne Lobby bekommen einfach eine leere Liste).
   */
  async #ensure(claim) {
    if (this.isLobby || this.conn?.open) return;
    if (this.connecting) {
      // Läuft schon ein (Such-)Versuch: abwarten; wer Lobby werden darf, versucht es danach selbst
      await this.connecting;
      if (claim && !this.isLobby && !this.conn?.open) return this.#ensure(true);
      return;
    }
    this.connecting = (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (await this.#connect()) return;
        if (!claim) {
          this.#notify([]);
          return;
        }
        if (await this.#claim()) return;
        await wait(300 + Math.random() * 700);
      }
    })().finally(() => (this.connecting = null));
    return this.connecting;
  }

  /** Als Teilnehmer mit der Lobby verbinden; false, wenn es keine gibt */
  async #connect() {
    try {
      if (!this.peer || this.peer.destroyed || this.isLobby) {
        this.#drop();
        this.peer = await this.#newPeer(null);
      }
      const peer = this.peer;
      const conn = await new Promise((resolve) => {
        const c = peer.connect(LOBBY_ID, { reliable: true });
        const timer = setTimeout(() => resolve(null), 6000);
        const onErr = (err) => {
          if (err?.type === 'peer-unavailable') {
            clearTimeout(timer);
            resolve(null);
          }
        };
        peer.on('error', onErr);
        c.once('open', () => {
          clearTimeout(timer);
          peer.off('error', onErr);
          resolve(c);
        });
      });
      if (!conn) return false;
      this.conn = conn;
      conn.on('data', (msg) => {
        if (msg?.type === 'list' && Array.isArray(msg.rooms)) this.#notify(msg.rooms.map(cleanRoom).filter(Boolean));
      });
      conn.on('close', () => this.#lost(conn));
      if (this.watching) conn.send({ type: 'watch' });
      return true;
    } catch {
      return false;
    }
  }

  /** Selbst Lobby werden; false, wenn jemand schneller war */
  async #claim() {
    try {
      this.#drop();
      this.peer = await this.#newPeer(LOBBY_ID);
    } catch {
      this.peer = null;
      return false;
    }
    this.isLobby = true;
    this.peer.on('connection', (conn) => {
      conn.on('data', (msg) => this.#lobbyReceive(conn, msg));
      conn.on('close', () => {
        this.watchers.delete(conn);
        for (const [code, r] of this.rooms) if (r.conn === conn) this.rooms.delete(code);
        this.#publish();
      });
    });
    this.peer.on('disconnected', () => this.isLobby && this.peer?.reconnect());
    this.#publish();
    return true;
  }

  #lobbyReceive(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'watch') {
      this.watchers.add(conn);
      conn.send({ type: 'list', rooms: this.#current() });
    } else if (msg.type === 'announce') {
      const room = cleanRoom(msg.room);
      if (!room) return;
      // Höchstens 30 Räume, keine fremden Codes überschreiben
      const known = this.rooms.get(room.code);
      if (known && known.conn !== conn) return;
      if (!known && this.rooms.size >= 30) return;
      this.rooms.set(room.code, { room, conn });
      this.#publish();
    } else if (msg.type === 'remove') {
      const known = this.rooms.get(normalizeCode(msg.code));
      if (known?.conn === conn) {
        this.rooms.delete(normalizeCode(msg.code));
        this.#publish();
      }
    }
  }

  #current() {
    const list = [...this.rooms.values()].map((r) => r.room);
    if (this.mine) list.unshift(this.mine);
    return list.sort((a, b) => b.created - a.created);
  }

  #publish() {
    const rooms = this.#current();
    for (const c of this.watchers) if (c.open) c.send({ type: 'list', rooms });
    this.#notify(rooms);
  }

  #sendMine() {
    if (!this.mine) return;
    if (this.isLobby) this.#publish();
    else if (this.conn?.open) this.conn.send({ type: 'announce', room: this.mine });
  }

  /** Lobby weg (geschlossen oder Netz weg): neu verbinden bzw. übernehmen */
  async #lost(conn) {
    if (conn !== this.conn) return;
    this.conn = null;
    if (!this.mine && !this.watching) return;
    await wait(300 + Math.random() * 1200); // nicht alle gleichzeitig
    if (this.conn?.open || this.isLobby) return;
    await this.#ensure(!!this.mine);
    this.#sendMine();
  }
}
