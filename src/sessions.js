/**
 * Sessions / Bereiche für die Statistik.
 *   main     „Standard“ – normale Scrambles
 *   eigene   z. B. „OH“, „Blind“ … (selbst angelegt; Scrambles wie Standard)
 *   cross2   Solves im Modus „Leichtes Cross“ – zählen automatisch getrennt
 *   xcross   Solves im Modus „X-Cross“ – zählen automatisch getrennt
 *   all      Ansicht: alles zusammen
 */
import { L } from './i18n.js';

export const scopeOf = (s) => (s.scrambleType === 'cross2' || s.scrambleType === 'xcross' ? s.scrambleType : s.session || 'main');

export function scopeName(id, sessions = []) {
  if (id === 'main') return L('Standard', 'Standard');
  if (id === 'cross2') return L('Leichtes Cross', 'Easy cross');
  if (id === 'xcross') return 'X-Cross';
  if (id === 'all') return L('Alle zusammen', 'All together');
  return sessions.find((s) => s.id === id)?.name || L('Session', 'Session');
}

/** Alle Bereiche zur Auswahl (mit Anzahl Solves) */
export function scopeList(solves, sessions = []) {
  const count = (id) => (id === 'all' ? solves.length : solves.filter((s) => scopeOf(s) === id).length);
  return [
    { id: 'main', kind: 'session' },
    ...sessions.map((s) => ({ id: s.id, kind: 'session', own: true })),
    { id: 'cross2', kind: 'mode' },
    { id: 'xcross', kind: 'mode' },
    { id: 'all', kind: 'all' },
  ].map((x) => ({ ...x, name: scopeName(x.id, sessions), n: count(x.id) }));
}

export const filterScope = (solves, id) => (id === 'all' ? solves : solves.filter((s) => scopeOf(s) === id));
