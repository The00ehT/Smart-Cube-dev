/**
 * Archiv-Ansicht: Tabelle mit Zeit, Scramble, Zügen, TPS, Fällen und Datum; sortierbar nach Zeit oder
 * Änderungsdatum. Ein Tipp auf eine Zeile öffnet die Rekonstruktion.
 */
import { archive, removeFromArchive, updateArchived } from '../archive.js';
import { formatSolve, effectiveTime, DNF } from '../stats.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmtDate = (iso) => new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });

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
        const text = prompt('Notiz zu diesem Solve:', a?.note || '');
        if (text !== null) updateArchived(a.solveId, { note: text.slice(0, 200) });
        return this.render();
      }
      const del = e.target.closest('[data-del]');
      if (del) {
        e.stopPropagation();
        if (confirm('Aus dem Archiv entfernen?')) removeFromArchive(Number(del.dataset.del));
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
        <b>Noch nichts archiviert</b>
        <p class="small">Nach jedem Solve kannst du unter der Zeit auf „☆ Archivieren“ tippen. Die Rekonstruktion bleibt dann
          dauerhaft hier – auch wenn du die Solve-Liste löschst.</p></div>`;
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
          <td class="ar-scr">${esc(a.scramble || '(eigenes Scramble)')}${a.note ? `<div class="ar-note">„${esc(a.note)}“</div>` : ''}</td>
          <td>${a.moveCount ?? '–'}</td>
          <td>${(a.tps ?? 0).toFixed(2)}</td>
          <td class="small">${esc(ll)}</td>
          <td class="small">${fmtDate(a.changedAt)}</td>
          <td class="ar-act"><button type="button" class="ghost small-btn" data-note="${a.solveId}" title="Notiz">✎</button><button type="button" class="ghost small-btn" data-del="${a.solveId}" title="Entfernen">✕</button></td>
        </tr>`;
      })
      .join('');
    this.root.innerHTML = `<div class="table-wrap"><table class="phase-table archive-table">
      <tr>
        <th data-sort="time" class="sortable">Zeit${arrow('time')}</th>
        <th>Scramble</th><th>Züge</th><th>TPS</th><th>Fälle</th>
        <th data-sort="changed" class="sortable">Geändert${arrow('changed')}</th><th></th>
      </tr>${rows}</table></div>
      <p class="small">${archive.length} archivierte ${archive.length === 1 ? 'Lösung' : 'Lösungen'} · Tippe auf „Zeit“ oder „Geändert“ zum Sortieren, auf eine Zeile für die Rekonstruktion.</p>`;
  }
}
