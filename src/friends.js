/**
 * Freunde – ohne eigenen Server, direkt von Gerät zu Gerät (PeerJS wie bei den Räumen).
 *
 * Jedes Gerät hat einen festen Freundescode (8 Zeichen) und ist darunter erreichbar, solange die App offen ist.
 * Freund hinzufügen = Verbindung zu seinem Code: Beide schicken sich ihre „Profilkarte“
 * (Name, Avatar, PB, Ø5/Ø12, letzte 10 Solves). Wer angefragt wird, nimmt den anderen automatisch auch auf.
 * Die zuletzt geholte Karte wird gespeichert – so ist das Profil auch sichtbar, wenn der Freund offline ist.
 *
 * Nachrichten: get { card } → card { card }
 */
import { load, save } from './storage.js';
import { peerOptions, sanitizeAvatar, sanitizeCode } from './room.js';

const KEY = 'smartcube.friends.v1';
const CODE_KEY = 'smartcube.friendCode';
const PREFIX = 'smartcube-freund-';
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const normalizeFriendCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
export const formatFriendCode = (c) => `${c.slice(0, 4)}-${c.slice(4)}`;

let code = load(CODE_KEY, null);
if (!sanitizeCode(code)) {
  code = Array.from({ length: 8 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('');
  save(CODE_KEY, code);
}
export const myFriendCode = code;

/** [{ code, name, avatar, card, at, added }] */
export const friends = load(KEY, []).filter((f) => sanitizeCode(f?.code));
export const saveFriends = () => save(KEY, friends);
export const isFriend = (c) => friends.some((f) => f.code === c);
export const friendOf = (c) => friends.find((f) => f.code === c);

let getCard = () => null;
let onChange = () => {};
let peer = null; // unter dem eigenen Code erreichbar
let starting = null;

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
/** Fremde Karte prüfen (kommt von einem anderen Gerät) */
function sanitizeCard(c) {
  if (!c || typeof c !== 'object' || !sanitizeCode(c.code)) return null;
  const pb = c.pb && typeof c.pb === 'object' ? { time: num(c.pb.time), penalty: num(c.pb.penalty) || 0, date: num(c.pb.date) } : null;
  return {
    code: c.code,
    name: String(c.name || '?').slice(0, 24),
    avatar: sanitizeAvatar(c.avatar),
    pb: pb?.time != null ? pb : null,
    ao5: num(c.ao5),
    ao12: num(c.ao12),
    count: num(c.count) || 0,
    last: (Array.isArray(c.last) ? c.last : []).slice(0, 10).map((s) => ({
      time: num(s?.time),
      penalty: s?.penalty === 'DNF' ? 'DNF' : num(s?.penalty) || 0,
      date: num(s?.date),
      moves: num(s?.moves),
      tps: num(s?.tps),
    })),
  };
}

/** Karte eines Freundes übernehmen; unbekannt → neu aufnehmen (gegenseitig) */
function remember(raw) {
  const card = sanitizeCard(raw);
  if (!card || card.code === myFriendCode) return null;
  let f = friendOf(card.code);
  const isNew = !f;
  if (!f) friends.push((f = { code: card.code, added: Date.now() }));
  Object.assign(f, { name: card.name, avatar: card.avatar, card, at: Date.now() });
  saveFriends();
  onChange(isNew ? 'added' : 'updated', f);
  return f;
}

async function newPeer(id) {
  const { Peer } = await import('peerjs');
  return new Promise((resolve, reject) => {
    const p = id ? new Peer(id, peerOptions()) : new Peer(peerOptions());
    const fail = (err) => {
      p.destroy();
      reject(err);
    };
    p.once('open', () => {
      p.off('error', fail);
      resolve(p);
    });
    p.once('error', fail);
  });
}

/** Unter dem eigenen Code erreichbar werden (antwortet auf Anfragen von Freunden) */
export function startFriends(cardFn, changed) {
  getCard = cardFn;
  onChange = changed || onChange;
  return ensurePeer().catch(() => null);
}

async function ensurePeer() {
  if (peer && !peer.destroyed) {
    if (peer.disconnected) peer.reconnect();
    return peer;
  }
  if (starting) return starting;
  starting = (async () => {
    try {
      peer = await newPeer(PREFIX + myFriendCode);
    } catch (err) {
      // Code schon belegt (App in einem zweiten Tab offen): nur ausgehend, mit zufälliger ID
      if (err?.type !== 'unavailable-id') throw err;
      peer = await newPeer();
      peer.outgoingOnly = true;
    }
    peer.on('connection', (conn) => {
      conn.on('data', (msg) => {
        if (msg?.type !== 'get') return;
        remember(msg.card);
        conn.send({ type: 'card', card: getCard() });
        setTimeout(() => conn.close(), 3000);
      });
      conn.on('error', () => conn.close());
    });
    peer.on('disconnected', () => !peer.destroyed && setTimeout(() => peer.reconnect(), 2000));
    peer.on('error', () => {});
    return peer;
  })().finally(() => (starting = null));
  return starting;
}

/**
 * Karte eines Freundes holen (fügt ihn hinzu, falls neu). Wirft „offline“, wenn er nicht erreichbar ist.
 * @returns Freund-Eintrag
 */
export async function fetchFriend(c) {
  const target = normalizeFriendCode(c);
  if (!sanitizeCode(target)) throw new Error('code');
  if (target === myFriendCode) throw new Error('self');
  const p = await ensurePeer();
  return new Promise((resolve, reject) => {
    const conn = p.connect(PREFIX + target, { reliable: true });
    const done = (fn, v) => {
      clearTimeout(timer);
      p.off('error', onErr);
      try {
        conn.close();
      } catch {
        /* egal */
      }
      fn(v);
    };
    const timer = setTimeout(() => done(reject, new Error('offline')), 10000);
    const onErr = (err) => err?.type === 'peer-unavailable' && String(err.message || '').includes(target) && done(reject, new Error('offline'));
    p.on('error', onErr);
    conn.on('open', () => conn.send({ type: 'get', card: getCard() }));
    conn.on('data', (msg) => {
      if (msg?.type !== 'card') return;
      const f = remember(msg.card);
      if (f) done(resolve, f);
      else done(reject, new Error('card'));
    });
  });
}

export function removeFriend(c) {
  const i = friends.findIndex((f) => f.code === c);
  if (i >= 0) friends.splice(i, 1);
  saveFriends();
  onChange('removed', null);
}
