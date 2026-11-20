/**
 * Großer Speicher für Solves und Archiv: IndexedDB (statt localStorage, das auf ~5 MB begrenzt ist).
 *
 *   loadBig(key, fallback)  liest den Wert; beim ersten Mal werden alte Daten aus localStorage übernommen
 *                           (danach dort gelöscht, damit dort wieder Platz ist)
 *   saveBig(key, value)     schreibt im Hintergrund; schnelle Folgeaufrufe werden zusammengefasst,
 *                           die Reihenfolge bleibt erhalten
 *
 * Ohne IndexedDB (z. B. privates Fenster mancher Browser) wird weiter localStorage benutzt.
 */
import { load, save } from './storage.js';

const DB_NAME = 'smartcube';
const STORE = 'kv';
let dbPromise = null;
export let bigStorage = 'indexeddb'; // oder 'localstorage', falls IndexedDB nicht geht

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no indexedDB'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  });
  return dbPromise;
}

const tx = (mode, fn) =>
  openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(req?.result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error('abort'));
      }),
  );

/** Wert lesen (mit einmaliger Übernahme aus localStorage) */
export async function loadBig(key, fallback) {
  try {
    const v = await Promise.race([tx('readonly', (s) => s.get(key)), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))]);
    if (v !== undefined) {
      // Übernahme war erfolgreich – Reste in localStorage aufräumen
      if (localStorage.getItem(key) != null) localStorage.removeItem(key);
      return v;
    }
    const old = load(key, undefined);
    if (old === undefined) return fallback;
    await tx('readwrite', (s) => s.put(old, key));
    const check = await tx('readonly', (s) => s.get(key));
    if (Array.isArray(old) ? check?.length === old.length : check !== undefined) localStorage.removeItem(key);
    return old;
  } catch {
    bigStorage = 'localstorage';
    return load(key, fallback);
  }
}

const pending = new Map(); // key → letzter Wert, der noch geschrieben werden muss
let writing = null;
const listeners = new Set();
/** Wird nach jedem Schreiben aufgerufen: (ok, key) */
export const onBigSaved = (fn) => listeners.add(fn);

/** Im Hintergrund speichern; true = angenommen (Fehler meldet onBigSaved) */
export function saveBig(key, value) {
  if (bigStorage === 'localstorage') {
    const ok = save(key, value);
    for (const fn of listeners) fn(ok, key);
    return ok;
  }
  pending.set(key, value);
  if (!writing) writing = flush();
  return true;
}

async function flush() {
  while (pending.size) {
    const [key, value] = pending.entries().next().value;
    pending.delete(key);
    let ok = true;
    try {
      await tx('readwrite', (s) => s.put(value, key));
    } catch {
      ok = save(key, value); // Notlösung
    }
    for (const fn of listeners) fn(ok, key);
  }
  writing = null;
}

/** Warten, bis alles geschrieben ist (z. B. vor dem Neuladen nach einem Import) */
export const flushBig = () => writing || Promise.resolve();
