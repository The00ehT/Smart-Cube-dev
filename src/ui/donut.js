/**
 * Kuchendiagramm (Ring) als SVG-Text: Anteile der Phasen an der Gesamtzeit.
 * Segmente mit 2 px Abstand, Werte stehen zusätzlich in der Legende (nie nur über die Farbe).
 */
import { L } from '../i18n.js';
import { formatTime } from '../stats.js';

const TAU = Math.PI * 2;

function arc(cx, cy, r0, r1, a0, a1) {
  const p = (r, a) => `${(cx + r * Math.sin(a)).toFixed(2)},${(cy - r * Math.cos(a)).toFixed(2)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${p(r1, a0)}A${r1},${r1} 0 ${large} 1 ${p(r1, a1)}L${p(r0, a1)}A${r0},${r0} 0 ${large} 0 ${p(r0, a0)}Z`;
}

/**
 * @param segs   [{ label, value (ms), cls (CSS-Klasse für die Farbe), sub? }]
 * @param center { value, label } Text in der Mitte
 * @param opts   { size, legend: true }
 */
export function donut(segs, center = {}, opts = {}) {
  const size = opts.size ?? 180;
  const total = segs.reduce((a, s) => a + Math.max(0, s.value || 0), 0);
  const c = size / 2;
  const r1 = c - 2;
  const r0 = r1 * 0.62;
  let a = 0;
  const paths = total
    ? segs
        .filter((s) => s.value > 0)
        .map((s) => {
          const da = (s.value / total) * TAU;
          // Vollkreis bei nur einem Segment: zwei Hälften
          const d = da >= TAU - 1e-6 ? arc(c, c, r0, r1, 0, Math.PI) + arc(c, c, r0, r1, Math.PI, TAU - 1e-4) : arc(c, c, r0, r1, a, a + da);
          const pct = Math.round((s.value / total) * 100);
          const tip = `${s.label}|${formatTime(s.value)} · ${pct} %${s.sub ? '|' + s.sub : ''}`;
          a += da;
          return `<path class="seg ${s.cls}" d="${d}" data-tip="${tip}"><title>${s.label}: ${formatTime(s.value)} (${pct} %)</title></path>`;
        })
        .join('')
    : `<circle cx="${c}" cy="${c}" r="${(r0 + r1) / 2}" fill="none" stroke="var(--chip)" stroke-width="${r1 - r0}"/>`;
  const mid = center.value
    ? `<text class="d-val" x="${c}" y="${c + 2}" text-anchor="middle">${center.value}</text>
       <text class="d-lab" x="${c}" y="${c + 20}" text-anchor="middle">${center.label ?? ''}</text>`
    : '';
  const svg = `<svg class="donut" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${opts.aria ?? L('Anteile der Phasen', 'Phase split')}">${paths}${mid}</svg>`;
  if (opts.legend === false) return svg;
  const legend = segs
    .map((s) => {
      const pct = total ? Math.round(((s.value || 0) / total) * 100) : 0;
      return `<li><i class="key ${s.cls}"></i><span class="d-name">${s.label}</span><span class="d-time">${formatTime(s.value)}</span><span class="d-pct">${pct} %</span></li>`;
    })
    .join('');
  return `<div class="donut-wrap">${svg}<ul class="donut-legend">${legend}</ul></div>`;
}

/** Segmente Kreuz/F2L/OLL/PLL aus gemittelten oder einzelnen Phasen {cross, f2l, oll, pll} */
export function phaseSegments(p) {
  return [
    { label: 'Cross', value: p.cross, cls: 'ph-cross' },
    { label: 'F2L', value: p.f2l, cls: 'ph-pair' },
    { label: 'OLL', value: p.oll, cls: 'ph-oll' },
    { label: 'PLL', value: p.pll, cls: 'ph-pll' },
  ];
}
