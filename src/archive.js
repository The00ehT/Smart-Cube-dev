/**
 * Archiv: ausgewählte Solves (gute Lösungen) mit kompletter Rekonstruktion, unabhängig von der Solve-Liste.
 * Gespeichert unter smartcube.archive.v1 als Liste von { ...solve, solveId, archivedAt, changedAt, note }.
 */
import { load, save } from './storage.js';

const KEY = 'smartcube.archive.v1';
export let archive = load(KEY, []);
const persist = () => save(KEY, archive);

export const isArchived = (solve) => !!solve && archive.some((a) => a.solveId === solve.id);

export function addToArchive(solve, note = '') {
  if (isArchived(solve)) return false;
  const now = new Date().toISOString();
  archive.push({ ...solve, solveId: solve.id, archivedAt: now, changedAt: now, note });
  return persist();
}

export function removeFromArchive(solveId) {
  archive = archive.filter((a) => a.solveId !== solveId);
  persist();
}

export function updateArchived(solveId, patch) {
  const a = archive.find((x) => x.solveId === solveId);
  if (!a) return;
  Object.assign(a, patch, { changedAt: new Date().toISOString() });
  persist();
}

/** Gelöschten Eintrag wiederherstellen (Rückgängig) */
export function restoreArchived(entry) {
  if (!archive.some((a) => a.solveId === entry.solveId)) archive.push(entry);
  persist();
}
