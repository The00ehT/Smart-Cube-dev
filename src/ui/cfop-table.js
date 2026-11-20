/**
 * CFOP-Tabelle: Phase · Zeit · Züge · TPS. F2L, OLL und PLL sind aufklappbar und zeigen erst dort
 * die Recog (F2L je Paar, OLL/PLL den Fall mit Recog und Exec). Ohne JavaScript dank <details>.
 */
import { formatTime } from '../stats.js';
import { L, dec } from '../i18n.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const tps = (moves, time) => (time > 0 && moves != null ? dec((moves / time) * 1000, 1) : '–');
const num = (x) => (x == null ? '–' : Number.isInteger(x) ? String(x) : dec(x, 1));

/**
 * Farbe von Rot (langsamer als Ø) über Gelb (≈ Ø) bis Grün (schneller als Ø).
 * Liefert ein style-/title-Attribut oder '' ohne Vergleichswert.
 */
export function splitTone(time, ref) {
  if (!ref || !(time > 0)) return '';
  const ratio = time / ref;
  const hue = Math.round(Math.max(0, Math.min(130, 55 + (1 - ratio) * 300)));
  const diff = time - ref;
  const sign = diff > 0 ? '+' : '−';
  return ` style="--h:${hue}" data-cmp="1" title="Ø ${formatTime(ref)} · ${sign}${formatTime(Math.abs(diff))}"`;
}

/**
 * @param rows [{ cls, name, extra?, time, moves, recog?, ref?, open?, sub?: [ { name, extra?, time, moves, recog?, ref? } ], note? }]
 *   ref = Vergleichswert (Ø) → Zeit wird rot–grün eingefärbt
 */
export function cfopTable(rows) {
  const cells = (r) => `<span class="ct-t"><span class="ct-tv"${splitTone(r.time, r.ref)}>${r.time == null ? '–' : formatTime(r.time)}</span></span><span class="ct-m">${num(r.moves)}</span><span class="ct-p">${tps(r.moves, r.time)}</span>`;
  // Recog nur beim Aufklappen: bei Paaren in der Zeile, bei F2L/OLL/PLL als erste Zeile im aufgeklappten Teil
  const sub = (s) => `<div class="ct-row ct-sub"><span class="ct-n">${esc(s.name)}${s.extra || ''}${s.recog ? `<small class="ct-rec">Recog ${formatTime(s.recog)}</small>` : ''}</span>${cells(s)}</div>`;
  const recogLine = (r) => (r.recog ? `<div class="ct-note small">Recog ${formatTime(r.recog)} · Exec ${formatTime(Math.max(0, (r.time || 0) - r.recog))}</div>` : '');
  const body = rows
    .map((r) => {
      const head = `<span class="ct-n"><i class="key ${r.cls}"></i>${esc(r.name)}${r.extra || ''}</span>${cells(r)}`;
      if (!r.sub?.length && !r.note && !r.recog) return `<div class="ct-row ct-main">${head}</div>`;
      return `<details class="ct-group" ${r.open ? 'open' : ''}><summary class="ct-row ct-main">${head}</summary>${r.note ? '' : recogLine(r)}${(r.sub || []).map(sub).join('')}${r.note ? `<div class="ct-note small">${r.note}</div>` : ''}</details>`;
    })
    .join('');
  return `<div class="cfop-table">
    <div class="ct-row ct-head"><span class="ct-n">${L('Phase', 'Phase')}</span><span>${L('Zeit', 'Time')}</span><span>${L('Züge', 'Moves')}</span><span>TPS</span></div>
    ${body}
  </div>`;
}
