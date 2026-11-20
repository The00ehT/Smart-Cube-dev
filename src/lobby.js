/**
 * Lobby für öffentliche Räume – ohne eigenen Server.
 *
 * Die Lobby läuft auf festen Peer-IDs im selben PeerJS-Netz wie die Räume. Das Gerät, das als Erstes einen
 * öffentlichen Raum öffnet, übernimmt eine davon; weitere öffentliche Räume melden sich dort an, wer Räume
 * sucht, bekommt dort die Liste. Schließt das Lobby-Gerät, übernimmt automatisch ein anderer Raum.
 *
 * Robust gegen „hängende“ IDs: Es gibt mehrere Lobby-Plätze. Ist einer belegt, aber antwortet nicht (z. B. ein
 * Handy mit der App im Hintergrund), wird der nächste genommen. Suchende fragen alle Plätze und führen die
 * Listen zusammen – so geht kein Raum verloren, auch wenn kurzzeitig zwei Lobbys laufen.
 *
 * Nachrichten:
 *   announce { room }   Raum-Gastgeber → Lobby (auch für Aktualisierungen: Spielerzahl, Runde)
 *   remove   { code }   Raum-Gastgeber → Lobby
 *   watch    {}         Suchender → Lobby: Liste schicken und aktuell halten
 *   list     { rooms }  Lobby → Suchende
 */
import { peerOptions, normalizeCode } from './room.js';

const SLOTS = ['smartcube-lobby-v2-a', 'smartcube-lobby-v2-b', 'smartcube-lobby-v2-c'];
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

async function newPeer(id) {
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

export class Lobby {
  constructor() {
    this.client = null; // eigener Peer (zufällige ID) für Verbindungen zu Lobbys
    this.links = new Map(); // Platz → Verbindung zu einer fremden Lobby
    this.lists = new Map(); // Platz → Räume, die diese Lobby meldet
    this.host = null; // selbst Lobby: { slot, peer, rooms: Map code → { room, conn }, watchers: Set }
    this.home = null; // Platz, bei dem der eigene Raum angemeldet ist
    this.mine = null; // eigener öffentlicher Raum
    this.watching = false;
    this.listeners = new Set();
    this.list = [];
    this.status = 'idle'; // idle | searching | ok | none
  }

  // ---------------- Öffentlich ----------------

  /** Eigenen Raum öffentlich machen (oder Angaben aktualisieren) */
  async announce(room) {
    this.mine = cleanRoom(room);
    if (!this.mine) return;
    if (!this.home || !(this.home === this.host?.slot || this.links.get(this.home)?.open)) this.home = await this.#findHome();
    this.#sendMine();
  }

  /** Eigenen Raum aus der Liste nehmen; als Lobby: Lobby abgeben, damit ein anderer übernimmt */
  withdraw() {
    const code = this.mine?.code;
    this.mine = null;
    if (this.host) this.#dropHost();
    else if (code && this.home && this.links.get(this.home)?.open) this.links.get(this.home).send({ type: 'remove', code });
    this.home = null;
    this.#merge();
  }

  /** Liste öffentlicher Räume beobachten; cb(rooms, status) bei jeder Änderung. Rückgabe: stop() */
  watch(cb) {
    this.listeners.add(cb);
    this.watching = true;
    cb(this.list, this.status);
    this.#linkAll();
    // Später geöffnete öffentliche Räume finden (falls gerade keine Lobby da war)
    const timer = setInterval(() => this.#linkAll(), 8000);
    return () => {
      clearInterval(timer);
      this.listeners.delete(cb);
      if (!this.listeners.size) this.watching = false;
    };
  }

  // ---------------- intern ----------------

  #merge() {
    const byCode = new Map();
    const add = (r) => r && !byCode.has(r.code) && byCode.set(r.code, r);
    if (this.mine) add(this.mine);
    if (this.host) for (const r of this.host.rooms.values()) add(r.room);
    for (const list of this.lists.values()) list.forEach(add);
    this.list = [...byCode.values()].sort((a, b) => b.created - a.created);
    for (const cb of this.listeners) cb(this.list, this.status);
  }

  async #clientPeer() {
    if (this.client && !this.client.destroyed && !this.client.disconnected) return this.client;
    try {
      this.client?.destroy();
    } catch {
      /* egal */
    }
    this.client = await newPeer(null);
    return this.client;
  }

  /** Mit der Lobby auf einem Platz verbinden; null, wenn dort keine (antwortende) Lobby ist */
  async #link(slot) {
    if (this.host?.slot === slot) return null;
    const open = this.links.get(slot);
    if (open?.open) return open;
    let peer;
    try {
      peer = await this.#clientPeer();
    } catch {
      return null;
    }
    const conn = await new Promise((resolve) => {
      const c = peer.connect(slot, { reliable: true });
      const done = (v) => {
        clearTimeout(timer);
        peer.off('error', onErr);
        resolve(v);
      };
      const timer = setTimeout(() => done(null), 4500);
      const onErr = (err) => {
        if (err?.type === 'peer-unavailable' && String(err.message || '').includes(slot)) done(null);
      };
      peer.on('error', onErr);
      c.once('open', () => done(c));
    });
    if (!conn) return null;
    this.links.set(slot, conn);
    conn.on('data', (msg) => {
      if (msg?.type === 'list' && Array.isArray(msg.rooms)) {
        this.lists.set(slot, msg.rooms.map(cleanRoom).filter(Boolean));
        this.#merge();
      }
    });
    conn.on('close', () => this.#lost(slot, conn));
    conn.send({ type: 'watch' });
    return conn;
  }

  /** Suchen: alle Plätze fragen (gleichzeitig) */
  async #linkAll() {
    if (this.linking) return;
    this.linking = true;
    if (!this.list.length) this.status = 'searching';
    const res = await Promise.all(SLOTS.map((s) => this.#link(s)));
    this.linking = false;
    this.status = res.some(Boolean) || this.host ? 'ok' : 'none';
    this.#merge();
  }

  /** Platz für den eigenen Raum: erste antwortende Lobby, sonst ersten freien Platz übernehmen */
  async #findHome() {
    if (this.host) return this.host.slot;
    for (let round = 0; round < 2; round++) {
      for (const slot of SLOTS) {
        if (await this.#link(slot)) return slot;
        if (await this.#claim(slot)) return slot;
      }
      await wait(500 + Math.random() * 1000);
    }
    return null;
  }

  /** Selbst Lobby auf diesem Platz werden; false, wenn er belegt ist */
  async #claim(slot) {
    let peer;
    try {
      peer = await newPeer(slot);
    } catch {
      return false;
    }
    this.host = { slot, peer, rooms: new Map(), watchers: new Set() };
    peer.on('connection', (conn) => {
      conn.on('data', (msg) => this.#lobbyReceive(conn, msg));
      conn.on('close', () => {
        if (!this.host) return;
        this.host.watchers.delete(conn);
        for (const [code, r] of this.host.rooms) if (r.conn === conn) this.host.rooms.delete(code);
        this.#publish();
      });
    });
    peer.on('disconnected', () => this.host?.peer === peer && peer.reconnect());
    this.status = 'ok';
    this.#publish();
    return true;
  }

  #dropHost() {
    try {
      this.host?.peer.destroy();
    } catch {
      /* egal */
    }
    this.host = null;
  }

  #lobbyReceive(conn, msg) {
    const h = this.host;
    if (!h || !msg || typeof msg !== 'object') return;
    if (msg.type === 'watch') {
      h.watchers.add(conn);
      conn.send({ type: 'list', rooms: this.#hostedList() });
    } else if (msg.type === 'announce') {
      const room = cleanRoom(msg.room);
      if (!room) return;
      // Höchstens 30 Räume, keine fremden Codes überschreiben
      const known = h.rooms.get(room.code);
      if (known && known.conn !== conn) return;
      if (!known && h.rooms.size >= 30) return;
      h.rooms.set(room.code, { room, conn });
      this.#publish();
    } else if (msg.type === 'remove') {
      const code = normalizeCode(msg.code);
      if (h.rooms.get(code)?.conn === conn) {
        h.rooms.delete(code);
        this.#publish();
      }
    }
  }

  #hostedList() {
    const list = [...this.host.rooms.values()].map((r) => r.room);
    if (this.mine && this.home === this.host.slot) list.unshift(this.mine);
    return list;
  }

  #publish() {
    if (this.host) {
      const rooms = this.#hostedList();
      for (const c of this.host.watchers) if (c.open) c.send({ type: 'list', rooms });
    }
    this.#merge();
  }

  #sendMine() {
    if (!this.mine || !this.home) return;
    if (this.home === this.host?.slot) this.#publish();
    else this.links.get(this.home)?.open && this.links.get(this.home).send({ type: 'announce', room: this.mine });
    this.#merge();
  }

  /** Lobby weg (geschlossen oder Netz weg): eigenen Raum neu anmelden, Liste neu holen */
  async #lost(slot, conn) {
    if (this.links.get(slot) !== conn) return;
    this.links.delete(slot);
    this.lists.delete(slot);
    this.#merge();
    await wait(400 + Math.random() * 1200); // nicht alle gleichzeitig
    if (this.mine && this.home === slot) {
      this.home = await this.#findHome();
      this.#sendMine();
    }
    if (this.watching) this.#linkAll();
  }
}
