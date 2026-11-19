/**
 * Ausführliche Statistik: Zeiten, Verlauf, Verteilung, Phasen (jedes F2L-Paar einzeln,
 * Erkennung vs. Ausführung), Skips, Lookahead, Kreuzfarben und F2L-Slots.
 * Diagramme sind schlichtes SVG mit Hover-Tooltip.
 */
import { L, dec } from '../i18n.js';
import { formatTime, averageOf, bestAverage } from '../stats.js';
import { detailStats, series } from '../stats-detail.js';
import { PHASE_NAMES } from '../cube/analysis.js';
import { COLOR_NAMES } from '../cube/facelets.js';
import { colorChip } from './replay.js';
import { donut, phaseSegments } from './donut.js';
import { metricsOf } from '../metrics.js';

const RANGES = [
  ['12', 12],
  ['50', 50],
  ['100', 100],
  [L('Alle', 'All'), Infinity],
];
const pct = (x) => (x == null ? '–' : `${Math.round(x * 100)} %`);
const num = (x, d = 1) => dec(x, d);
const t = (x) => (x == null ? '–' : formatTime(x));
const PHASE_CLASS = (key) => (/^p\d$/.test(key) ? 'pair' : key);

export class StatsView {
  /** @param root Container im Statistik-Tab */
  constructor(root) {
    this.dlg = root;
    this.range = 100;
    root.innerHTML = `
      <div class="sv-range" role="group" aria-label="${L('Zeitraum', 'Range')}"></div>
      <div class="sv-body"></div>
      <div class="sv-tip" hidden></div>`;
    const dialog = root;
    dialog.querySelector('.sv-range').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-n]');
      if (!b) return;
      this.range = Number(b.dataset.n);
      this.render();
    });
    this.tip = dialog.querySelector('.sv-tip');
    dialog.addEventListener('pointermove', (e) => this.hover(e));
    dialog.addEventListener('pointerleave', () => (this.tip.hidden = true));
  }

  /** Mit diesen Solves neu zeichnen */
  open(solves) {
    this.all = solves;
    this.render();
  }

  render() {
    const all = this.all;
    this.dlg.querySelector('.sv-range').innerHTML =
      `<span class="label">${L('Zeitraum: letzte', 'Last')}</span>` +
      RANGES.map(
        ([label, n]) => `<button data-n="${n}" class="${n === this.range ? 'on' : ''}" aria-pressed="${n === this.range}">${label}</button>`,
      ).join('');
    const sel = Number.isFinite(this.range) ? all.slice(-this.range) : all;
    const body = this.dlg.querySelector('.sv-body');
    if (!sel.length) {
      body.innerHTML = `<p class="small">${L('Noch keine Solves.', 'No solves yet.')}</p>`;
      return;
    }
    const s = detailStats(sel);
    this.sel = sel;
    const offset = all.length - sel.length;
    body.innerHTML = [
      this.tiles(s, all),
      this.trend(sel, offset),
      this.histogram(s.times),
      this.phaseSection(s),
      this.extras(s),
    ].join('');
  }

  tiles(s, all) {
    const cur = (n) => t(averageOf(all, n));
    const bestAo = (n) => t(bestAverage(all, n));
    const items = [
      ['Solves', String(s.n)],
      [L('Bestzeit', 'Best'), t(s.best)],
      [L('Mittel', 'Mean'), t(s.mean)],
      ['Median', t(s.median)],
      [L('Streuung (σ)', 'Std dev (σ)'), t(s.stdev)],
      [L('Schlechteste', 'Worst'), t(s.worst)],
      ['Ø TPS', num(s.tps, 2)],
      ['+2 / DNF', `${s.plus2} / ${s.dnf}`],
    ];
    const ms = this.sel.map(metricsOf).filter(Boolean);
    if (ms.length) {
      const av = (f) => ms.reduce((x, m) => x + (f(m) ?? 0), 0) / ms.length;
      items.push(['Ø Fluency', String(Math.round(av((m) => m.fluency)))], [L('Ø Züge', 'Ø moves'), num(av((m) => m.htm))], ['Ø Exec TPS', num(av((m) => m.etps), 2)]);
    }
    const aos = [5, 12, 50, 100]
      .map((n) => `<tr><td>Ø ${n}</td><td>${cur(n)}</td><td>${bestAo(n)}</td></tr>`)
      .join('');
    return `<section class="sv-sec">
      <div class="stats sv-tiles">${items.map(([k, v]) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('')}</div>
      <table class="phase-table sv-ao"><tr><th>${L('Schnitt', 'Average')}</th><th>${L('Aktuell', 'Current')}</th><th>${L('Bester', 'Best')}</th></tr>${aos}</table>
      <p class="small">${L(`Durchschnitte immer über alle ${all.length} Solves; alles andere über die gewählten.`, `Averages always over all ${all.length} solves; everything else over the selected ones.`)}</p>
    </section>`;
  }

  /** Verlauf: Einzelzeiten als Punkte, Ø5 und Ø12 als Linien */
  trend(sel, offset) {
    const data = series(this.all).slice(offset);
    const vals = data.flatMap((d) => [d.time, d.ao5, d.ao12]).filter((v) => v != null && Number.isFinite(v));
    if (vals.length < 2) return '';
    const W = 640;
    const H = 220;
    const P = { l: 44, r: 12, t: 12, b: 22 };
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = (hi - lo) * 0.08 || 500;
    const y0 = Math.max(0, lo - pad);
    const y1 = hi + pad;
    const x = (i) => P.l + (data.length === 1 ? 0 : (i / (data.length - 1)) * (W - P.l - P.r));
    const y = (v) => P.t + (1 - (v - y0) / (y1 - y0)) * (H - P.t - P.b);
    const ticks = niceTicks(y0, y1, 4);
    const grid = ticks
      .map((v) => `<line class="grid" x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${P.l - 6}" y="${y(v) + 4}" text-anchor="end">${formatTime(v)}</text>`)
      .join('');
    const line = (key) => {
      let d = '';
      let pen = false;
      data.forEach((p, i) => {
        const v = p[key];
        if (v == null || !Number.isFinite(v)) {
          pen = false;
          return;
        }
        d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
        pen = true;
      });
      return d;
    };
    const dots = data
      .filter((p) => p.time != null)
      .map((p) => `<circle class="dot" cx="${x(p.i - offset).toFixed(1)}" cy="${y(p.time).toFixed(1)}" r="2.5"/>`)
      .join('');
    // Unsichtbare Spalten als Hover-Ziele
    const colW = (W - P.l - P.r) / Math.max(1, data.length - 1);
    const hits = data
      .map((p, i) => {
        const tip = `Solve ${p.i + 1}|${L('Zeit', 'Time')} ${p.time == null ? 'DNF' : formatTime(p.time)}|Ø5 ${t(p.ao5)}|Ø12 ${t(p.ao12)}`;
        return `<rect class="hit" x="${(x(i) - colW / 2).toFixed(1)}" y="${P.t}" width="${Math.max(colW, 4).toFixed(1)}" height="${H - P.t - P.b}" data-tip="${tip}" data-x="${x(i).toFixed(1)}"/>`;
      })
      .join('');
    return `<section class="sv-sec">
      <h3>${L('Verlauf', 'Progress')}</h3>
      <div class="legend"><span><i class="lg-dot"></i>${L('Einzelzeit', 'Single')}</span><span><i class="lg-line s1"></i>Ø 5</span><span><i class="lg-line s2"></i>Ø 12</span></div>
      <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${L('Verlauf der Zeiten', 'Times over time')}">
        ${grid}${dots}
        <path class="ln s1" d="${line('ao5')}"/><path class="ln s2" d="${line('ao12')}"/>
        <line class="cross" y1="${P.t}" y2="${H - P.b}" x1="-10" x2="-10"/>
        ${hits}
      </svg>
    </section>`;
  }

  /** Verteilung der Zeiten (Balken je Sekunde bzw. passender Breite) */
  histogram(times) {
    if (times.length < 3) return '';
    const lo = Math.min(...times);
    const hi = Math.max(...times);
    const span = hi - lo;
    const step = [250, 500, 1000, 2000, 5000, 10000, 30000, 60000].find((s) => span / s <= 16) ?? 60000;
    const start = Math.floor(lo / step) * step;
    const bins = [];
    for (let b = start; b <= hi; b += step) bins.push({ from: b, n: 0 });
    for (const v of times) bins[Math.min(bins.length - 1, Math.floor((v - start) / step))].n++;
    const max = Math.max(...bins.map((b) => b.n));
    const W = 640;
    const H = 160;
    const P = { l: 12, r: 12, t: 16, b: 22 };
    const bw = (W - P.l - P.r) / bins.length;
    const bars = bins
      .map((b, i) => {
        const h = max ? (b.n / max) * (H - P.t - P.b) : 0;
        const x = P.l + i * bw;
        const label = `${formatTime(b.from)} – ${formatTime(b.from + step)}`;
        const top = H - P.b - h;
        return `<path class="bar" d="${roundedTop(x + 1, top, bw - 2, h)}"/>
          ${b.n ? `<text class="axis val" x="${x + bw / 2}" y="${top - 4}" text-anchor="middle">${b.n}</text>` : ''}
          <rect class="hit" x="${x}" y="${P.t}" width="${bw}" height="${H - P.t - P.b}" data-tip="${label}|${b.n} Solves"/>`;
      })
      .join('');
    const every = Math.ceil(bins.length / 8);
    const labels = bins
      .map((b, i) => (i % every ? '' : `<text class="axis" x="${P.l + i * bw}" y="${H - 6}">${formatTime(b.from)}</text>`))
      .join('');
    return `<section class="sv-sec">
      <h3>${L('Verteilung', 'Distribution')}</h3>
      <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${L('Verteilung der Zeiten', 'Time distribution')}">
        <line class="base" x1="${P.l}" x2="${W - P.r}" y1="${H - P.b}" y2="${H - P.b}"/>${bars}${labels}
      </svg>
    </section>`;
  }

  phaseSection(s) {
    if (!s.detailed) {
      return `<section class="sv-sec"><h3>${L('Phasen', 'Phases')}</h3><p class="small">${L('Detaildaten (F2L-Paare, Recog) gibt es für Solves mit Zugzeiten.', 'Detailed data (F2L pairs, recog) is available for solves with move times.')}</p></section>`;
    }
    const ph = Object.fromEntries(s.phases.map((p) => [p.key, p]));
    const avgSum = (k) => ph[k].time || 0;
    const totalAvg = avgSum('cross') + avgSum('f2l') + avgSum('oll') + avgSum('pll');
    const pie = donut(
      phaseSegments({ cross: avgSum('cross'), f2l: avgSum('f2l'), oll: avgSum('oll'), pll: avgSum('pll') }),
      { value: t(totalAvg), label: L('Ø gesamt', 'Ø total') },
      { size: 200 },
    );
    const recogSum = ['p1', 'p2', 'p3', 'p4', 'oll', 'pll'].reduce((a, k) => a + (ph[k].recog || 0), 0);
    const pie2 = donut(
      [
        { label: L('Drehen', 'Turning'), value: Math.max(0, totalAvg - recogSum), cls: 'ph-exec' },
        { label: L('Recog / Pausen', 'Recog / pauses'), value: recogSum, cls: 'ph-recog' },
      ],
      { value: t(recogSum), label: 'Ø Recog' },
      { size: 200, aria: L('Recog und Drehen', 'Recog vs turning') },
    );
    const pairsPie = donut(
      ['p1', 'p2', 'p3', 'p4'].map((k, i) => ({ label: `${L('Paar', 'Pair')} ${i + 1}`, value: ph[k].time || 0, cls: `ph-pair pair-${i + 1}` })),
      { value: t(avgSum('f2l')), label: 'Ø F2L' },
      { size: 200, aria: L('F2L-Paare', 'F2L pairs') },
    );
    const rows = ['cross', 'p1', 'p2', 'p3', 'p4', 'f2l', 'oll', 'pll']
      .map((k) => {
        const p = ph[k];
        const cls = k === 'f2l' ? ' class="sum"' : /^p\d$/.test(k) ? ' class="sub"' : '';
        return `<tr${cls}><td><i class="key ph-${PHASE_CLASS(k)}"></i>${PHASE_NAMES[k]}</td><td>${t(p.time)}</td><td>${k === 'cross' ? '–' : t(p.recog)}</td><td>${t(p.exec)}</td><td>${num(p.moves)}</td><td>${num(p.tps, 2)}</td><td>${t(p.best)}</td><td>${pct(p.share)}</td></tr>`;
      })
      .join('');
    return `<section class="sv-sec">
      <h3>${L('Phasen', 'Phases')} <span class="small">(${L(`${s.detailed} Solves mit Detaildaten`, `${s.detailed} solves with details`)})</span></h3>
      <div class="pies">
        <figure><figcaption>${L('Wofür geht die Zeit drauf?', 'Where does the time go?')}</figcaption>${pie}</figure>
        <figure><figcaption>${L('F2L-Paare', 'F2L pairs')}</figcaption>${pairsPie}</figure>
        <figure><figcaption>${L('Recog vs. Drehen', 'Recog vs. turning')}</figcaption>${pie2}</figure>
      </div>
      <div class="sv-ll">
        <div class="stat big"><div class="v">${t(ph.oll.recog)}</div><div class="k">Ø OLL Recog</div></div>
        <div class="stat big"><div class="v">${t(ph.pll.recog)}</div><div class="k">Ø PLL Recog</div></div>
        <div class="stat big"><div class="v">${t(ph.p1.recog != null ? (ph.p1.recog + ph.p2.recog + ph.p3.recog + ph.p4.recog) / 4 : null)}</div><div class="k">${L('Ø Pause vor F2L-Paar', 'Ø pause before F2L pair')}</div></div>
      </div>
      <div class="table-wrap"><table class="phase-table">
        <tr><th>Phase</th><th>Ø</th><th>Recog</th><th>Exec</th><th>${L('Züge', 'Moves')}</th><th>Exec TPS</th><th>${L('Beste', 'Best')}</th><th>%</th></tr>
        ${rows}
      </table></div>
      <p class="small">${L('Recog = Pause zwischen dem letzten Zug der vorigen Phase und dem ersten Zug dieser Phase (Rotations ohne Gyro zählen mit). Beim Cross ist das die Inspektion und wird nicht gemessen.', 'Recog = pause between the last move of the previous phase and the first move of this phase (rotations without gyro are included). For the cross this is inspection and not measured.')}</p>
    </section>`;
  }

  extras(s) {
    const tiles = [
      ['OLL-Skip', pct(s.ollSkip)],
      ['PLL-Skip', pct(s.pllSkip)],
      ['X-Cross', pct(s.xcross)],
      [L('Pausen ≥ 0,5 s / Solve', 'Pauses ≥ 0.5 s / solve'), num(s.lookahead?.perSolve)],
      [L('Pausenzeit / Solve', 'Pause time / solve'), t(s.lookahead?.timePerSolve)],
    ];
    const g = s.gyro;
    const gyroSec = g
      ? `<section class="sv-sec">
      <h3>Gyro <span class="small">(${L(`${g.n} Solves mit Lagedaten`, `${g.n} solves with orientation data`)})</span></h3>
      <div class="stats">
        <div class="stat"><div class="v">${num(g.rotations)}</div><div class="k">Ø Rotations / Solve</div></div>
        <div class="stat"><div class="v">${num(g.regrips)}</div><div class="k">${L('Ø Regrips / Solve (geschätzt)', 'Ø regrips / solve (est.)')}</div></div>
        ${['cross', 'f2l', 'oll', 'pll'].map((k) => `<div class="stat"><div class="v">${num(g.perPhase[k])}</div><div class="k">Ø Rotations ${PHASE_NAMES[k]}</div></div>`).join('')}
      </div>
      ${g.kinds.length ? `<p class="small">${L('Häufigste Rotations', 'Most common rotations')}: ${g.kinds.slice(0, 6).map(([n, c]) => `<b>${n}</b> ${c}×`).join(' · ')}</p>` : ''}
    </section>`
      : '';
    const faces = Object.entries(s.crossFaces).sort((a, b) => b[1].n - a[1].n);
    const crossRows = faces
      .map(([f, c]) => `<tr><td>${colorChip(f)} ${COLOR_NAMES[f]}</td><td>${c.n}</td><td>${pct(c.n / s.n)}</td><td>${t(c.mean)}</td></tr>`)
      .join('');
    const slotRows = s.slotStats
      .sort((a, b) => a.mean - b.mean)
      .map((x) => `<tr><td>${[...x.slot].map(colorChip).join('')} ${[...x.slot].map((f) => COLOR_NAMES[f]).join('–')}</td><td>${x.n}</td><td>${t(x.mean)}</td></tr>`)
      .join('');
    return `${gyroSec}<section class="sv-sec">
      <h3>Skips &amp; Lookahead</h3>
      <div class="stats">${tiles.map(([k, v]) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('')}</div>
    </section>
    <section class="sv-sec sv-two">
      <div>
        <h3>${L('Cross-Farben', 'Cross colors')}</h3>
        <table class="phase-table"><tr><th>${L('Farbe', 'Color')}</th><th>Solves</th><th>%</th><th>Ø</th></tr>${crossRows || '<tr><td colspan="4">–</td></tr>'}</table>
      </div>
      <div>
        <h3>F2L-Slots</h3>
        <table class="phase-table"><tr><th>Slot</th><th>${L('Paare', 'Pairs')}</th><th>Ø</th></tr>${slotRows || '<tr><td colspan="3">–</td></tr>'}</table>
      </div>
    </section>`;
  }

  hover(e) {
    const el = e.target.closest('[data-tip]');
    const svg = e.target.closest('svg');
    const cross = svg?.querySelector('.cross');
    if (!el) {
      this.tip.hidden = true;
      if (cross) cross.setAttribute('x1', -10), cross.setAttribute('x2', -10);
      return;
    }
    if (cross && el.dataset.x) cross.setAttribute('x1', el.dataset.x), cross.setAttribute('x2', el.dataset.x);
    const [head, ...rest] = el.dataset.tip.split('|');
    this.tip.innerHTML = `<b>${head}</b>${rest.map((r) => `<div>${r}</div>`).join('')}`;
    this.tip.hidden = false;
    const box = this.dlg.getBoundingClientRect();
    const tw = this.tip.offsetWidth;
    let left = e.clientX - box.left + 14;
    if (left + tw > box.width - 8) left = e.clientX - box.left - tw - 14;
    this.tip.style.left = `${Math.max(8, left)}px`;
    this.tip.style.top = `${e.clientY - box.top + 14}px`;
  }
}

function niceTicks(lo, hi, n) {
  const raw = (hi - lo) / n;
  const steps = [100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 15000, 30000, 60000];
  const step = steps.find((s) => s >= raw) ?? 60000;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
  return out;
}

/** Balken mit 4 px gerundeter Oberkante, unten gerade auf der Grundlinie */
function roundedTop(x, y, w, h) {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
