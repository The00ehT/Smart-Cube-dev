/**
 * Archiv-Ansicht: Tabelle mit Zeit, Scramble, Zügen, TPS, Fällen und Datum; sortierbar nach Zeit oder
 * Änderungsdatum. Ein Tipp auf eine Zeile öffnet die Rekonstruktion.
 */
import { L, locale } from '../i18n.js';
import { archive, removeFromArchive, updateArchived, restoreArchived } from '../archive.js';
import { undoable } from './toast.js';
import { formatSolve, effectiveTime, DNF } from '../stats.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmtDate = (iso) => new Date(iso).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: '2-digit' });

export class ArchiveView {
  /** @param h { open(entry) } */
  constructor(root, h) {
    this.root = root;
    this.h = h;
    this.sort = { key: 'changed', dir: -1 };
    root.addEventListener('click', (e) => {
      const th = e.target.closest('th[data-sort]');
      if (th) {
        const k = th.dataset.sort;
        this.sort = this.sort.key === k ? { key: k, dir: -this.sort.dir } : { key: k, dir: k === 'time' ? 1 : -1 };
        return this.render();
      }
      const note = e.target.closest('[data-note]');
      if (note) {
        e.stopPropagation();
        const a = archive.find((x) => String(x.solveId) === note.dataset.note);
        const text = prompt(L('Notiz zu diesem Solve:', 'Note for this solve:'), a?.note || '');
        if (text !== null) updateArchived(a.solveId, { note: text.slice(0, 200) });
        return this.render();
      }
      const del = e.target.closest('[data-del]');
      if (del) {
        e.stopPropagation();
        const entry = archive.find((x) => String(x.solveId) === del.dataset.del);
        undoable(L('Aus dem Archiv entfernt', 'Removed from archive'), () => removeFromArchive(entry.solveId), () => {
          restoreArchived(entry);
          this.render();
        });
        return this.render();
      }
      const row = e.target.closest('tr[data-id]');
      if (row) this.h.open(archive.find((x) => String(x.solveId) === row.dataset.id));
    });
  }

  render() {
    if (!archive.length) {
      this.root.innerHTML = `<div class="empty-state">
        <div class="empty-icon">★</div>
        <b>${L('Noch nichts archiviert', 'Nothing archived yet')}</b>
        <p class="small">${L('Nach jedem Solve kannst du unter der Zeit auf „☆ Rekonstruktion archivieren“ tippen. Die Rekonstruktion bleibt dann dauerhaft hier – auch wenn du die Solve-Liste löschst.', 'After every solve, tap “☆ Save reconstruction” below the time. It stays here for good – even if you clear your solve list.')}</p></div>`;
      return;
    }
    const { key, dir } = this.sort;
    const val = (a) => (key === 'time' ? (effectiveTime(a) === DNF ? Infinity : effectiveTime(a)) : new Date(a.changedAt).getTime());
    const list = [...archive].sort((a, b) => (val(a) - val(b)) * dir);
    const arrow = (k) => (key === k ? (dir > 0 ? ' ▲' : ' ▼') : '');
    const rows = list
      .map((a) => {
        const ll = a.ll ? [a.ll.oll ? `OLL ${a.ll.oll}` : a.ll.oll === 0 ? 'OLL-Skip' : '', a.ll.pll ? (a.ll.pll === 'Skip' ? 'PLL-Skip' : a.ll.pll) : ''].filter(Boolean).join(' · ') : '';
        return `<tr data-id="${a.solveId}">
          <td class="ar-time">${formatSolve(a)}</td>
          <td class="ar-scr">${esc(a.scramble || L('(eigenes Scramble)', '(own scramble)'))}${a.note ? `<div class="ar-note">„${esc(a.note)}“</div>` : ''}</td>
          <td>${a.metrics?.htm ?? a.moveCount ?? '–'}</td>
          <td>${(a.tps ?? 0).toFixed(2)}</td>
          <td class="small">${esc(ll)}</td>
          <td class="small">${fmtDate(a.changedAt)}</td>
          <td class="ar-act"><button type="button" class="ghost small-btn" data-note="${a.solveId}" title="${L('Notiz', 'Note')}">✎</button><button type="button" class="ghost small-btn" data-del="${a.solveId}" title="${L('Entfernen', 'Remove')}">✕</button></td>
        </tr>`;
      })
      .join('');
    this.root.innerHTML = `<div class="table-wrap"><table class="phase-table archive-table">
      <tr>
        <th data-sort="time" class="sortable">${L('Zeit', 'Time')}${arrow('time')}</th>
        <th>Scramble</th><th>${L('Züge', 'Moves')}</th><th>TPS</th><th>${L('Fälle', 'Cases')}</th>
        <th data-sort="changed" class="sortable">${L('Geändert', 'Modified')}${arrow('changed')}</th><th></th>
      </tr>${rows}</table></div>
      <p class="small">${L(`${archive.length} archiviert · Tippe auf „Zeit“ oder „Geändert“ zum Sortieren, auf eine Zeile für die Rekonstruktion.`, `${archive.length} archived · Tap “Time” or “Modified” to sort, a row to open the reconstruction.`)}</p>`;
  }
}
