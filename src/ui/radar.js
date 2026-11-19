/**
 * Netzdiagramm (Radar) als SVG: Stärken 0–100 je Achse, optional ein zweites Profil zum Vergleich.
 */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * @param axes  [{ name, hint }]
 * @param now   [Zahl 0–100 | null] je Achse
 * @param prev  optional: Vergleichswerte
 */
export function radarSvg(axes, now, prev = null, size = 320) {
  const n = axes.length;
  const c = size / 2;
  const R = size / 2 - 58;
  const ang = (i) => -Math.PI / 2 + (i / n) * Math.PI * 2;
  const pt = (i, v) => [c + Math.cos(ang(i)) * R * (v / 100), c + Math.sin(ang(i)) * R * (v / 100)];
  const ring = (v) => axes.map((_, i) => pt(i, v).map((x) => x.toFixed(1)).join(',')).join(' ');
  const grid = [25, 50, 75, 100].map((v) => `<polygon class="rd-grid" points="${ring(v)}"/>`).join('');
  const spokes = axes.map((_, i) => `<line class="rd-grid" x1="${c}" y1="${c}" x2="${pt(i, 100)[0].toFixed(1)}" y2="${pt(i, 100)[1].toFixed(1)}"/>`).join('');
  const poly = (vals, cls) => `<polygon class="${cls}" points="${vals.map((v, i) => pt(i, v ?? 0).map((x) => x.toFixed(1)).join(',')).join(' ')}"/>`;
  const dots = now
    .map((v, i) => {
      const [x, y] = pt(i, v ?? 0);
      return `<circle class="rd-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5"><title>${esc(axes[i].name)}: ${v == null ? '–' : Math.round(v)} / 100</title></circle>`;
    })
    .join('');
  const labels = axes
    .map((a, i) => {
      const [x, y] = pt(i, 128);
      const anchor = Math.abs(x - c) < 8 ? 'middle' : x > c ? 'start' : 'end';
      const v = now[i];
      return `<text class="rd-label" x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}">${esc(a.name)}</text>
        <text class="rd-val" x="${x.toFixed(1)}" y="${(y + 16).toFixed(1)}" text-anchor="${anchor}">${v == null ? '–' : Math.round(v)}</text>`;
    })
    .join('');
  return `<svg class="radar" viewBox="-56 0 ${size + 112} ${size}" role="img" aria-label="Stärkenprofil">
    ${grid}${spokes}${prev ? poly(prev, 'rd-prev') : ''}${poly(now, 'rd-now')}${dots}${labels}</svg>`;
}
