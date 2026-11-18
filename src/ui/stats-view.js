/**
 * Ausführliche Statistik: Zeiten, Verlauf, Verteilung, Phasen (jedes F2L-Paar einzeln,
 * Erkennung vs. Ausführung), Skips, Lookahead, Kreuzfarben und F2L-Slots.
 * Diagramme sind schlichtes SVG mit Hover-Tooltip.
 */
import { formatTime, averageOf, bestAverage } from '../stats.js';
import { detailStats, series } from '../stats-detail.js';
import { PHASE_NAMES } from '../cube/analysis.js';
import { COLOR_NAMES } from '../cube/facelets.js';
import { colorChip } from './replay.js';
import { donut, phaseSegments } from './donut.js';

const RANGES = [
  ['12', 12],
  ['50', 50],
  ['100', 100],
  ['Alle', Infinity],
];
const pct = (x) => (x == null ? '–' : `${Math.round(x * 100)} %`);
const num = (x, d = 1) => (x == null ? '–' : x.toFixed(d).replace('.', ','));
const t = (x) => (x == null ? '–' : formatTime(x));
const PHASE_CLASS = (key) => (/^p\d$/.test(key) ? 'pair' : key);

export class StatsView {
  constructor(dialog) {
    this.dlg = dialog;
    this.range = 100;
    dialog.innerHTML = `
      <div class="rp-head">
        <h2>Statistik</h2>
        <button class="sv-close" aria-label="Schließen">✕</button>
      </div>
      <div class="sv-range" role="group" aria-label="Zeitraum"></div>
      <div class="sv-body"></div>
      <div class="sv-tip" hidden></div>`;
    dialog.querySelector('.sv-close').addEventListener('click', () => dialog.close());
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

  open(solves) {
    this.all = solves;
    this.render();
    if (!this.dlg.open) this.dlg.showModal();
  }

  render() {
    const all = this.all;
    this.dlg.querySelector('.sv-range').innerHTML =
      '<span class="label">Letzte</span>' +
      RANGES.map(
        ([label, n]) => `<button data-n="${n}" class="${n === this.range ? 'on' : ''}" aria-pressed="${n === this.range}">${label}</button>`,
      ).join('');
    const sel = Number.isFinite(this.range) ? all.slice(-this.range) : all;
    const body = this.dlg.querySelector('.sv-body');
    if (!sel.length) {
      body.innerHTML = '<p class="small">Noch keine Solves.</p>';
      return;
    }
    const s = detailStats(sel);
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
      ['Bestzeit', t(s.best)],
      ['Mittel', t(s.mean)],
      ['Median', t(s.median)],
      ['Streuung (σ)', t(s.stdev)],
      ['Schlechteste', t(s.worst)],
      ['Ø Züge', num(s.moves)],
      ['Ø TPS', num(s.tps, 2)],
      ['+2 / DNF', `${s.plus2} / ${s.dnf}`],
    ];
    const aos = [5, 12, 50, 100]
      .map((n) => `<tr><td>Ø ${n}</td><td>${cur(n)}</td><td>${bestAo(n)}</td></tr>`)
      .join('');
    return `<section class="sv-sec">
      <div class="stats sv-tiles">${items.map(([k, v]) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('')}</div>
      <table class="phase-table sv-ao"><tr><th>Durchschnitt</th><th>Aktuell</th><th>Bester</th></tr>${aos}</table>
      <p class="small">Durchschnitte immer über alle ${all.length} Solves; alles andere über die gewählten.</p>
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
        const tip = `Solve ${p.i + 1}|Zeit ${p.time == null ? 'DNF' : formatTime(p.time)}|Ø5 ${t(p.ao5)}|Ø12 ${t(p.ao12)}`;
        return `<rect class="hit" x="${(x(i) - colW / 2).toFixed(1)}" y="${P.t}" width="${Math.max(colW, 4).toFixed(1)}" height="${H - P.t - P.b}" data-tip="${tip}" data-x="${x(i).toFixed(1)}"/>`;
      })
      .join('');
    return `<section class="sv-sec">
      <h3>Verlauf</h3>
      <div class="legend"><span><i class="lg-dot"></i>Einzelzeit</span><span><i class="lg-line s1"></i>Ø 5</span><span><i class="lg-line s2"></i>Ø 12</span></div>
      <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Verlauf der Zeiten">
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
      <h3>Verteilung</h3>
      <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Verteilung der Zeiten">
        <line class="base" x1="${P.l}" x2="${W - P.r}" y1="${H - P.b}" y2="${H - P.b}"/>${bars}${labels}
      </svg>
    </section>`;
  }

  phaseSection(s) {
    if (!s.detailed) {
      return `<section class="sv-sec"><h3>Phasen</h3><p class="small">Detaildaten (F2L-Paare, Erkennungszeiten) gibt es für Solves ab diesem Update.</p></section>`;
    }
    const ph = Object.fromEntries(s.phases.map((p) => [p.key, p]));
    const avgSum = (k) => ph[k].time || 0;
    const totalAvg = avgSum('cross') + avgSum('f2l') + avgSum('oll') + avgSum('pll');
    const pie = donut(
      phaseSegments({ cross: avgSum('cross'), f2l: avgSum('f2l'), oll: avgSum('oll'), pll: avgSum('pll') }),
      { value: t(totalAvg), label: 'Ø gesamt' },
      { size: 200 },
    );
    const recogSum = ['p1', 'p2', 'p3', 'p4', 'oll', 'pll'].reduce((a, k) => a + (ph[k].recog || 0), 0);
    const pie2 = donut(
      [
        { label: 'Drehen', value: Math.max(0, totalAvg - recogSum), cls: 'ph-exec' },
        { label: 'Erkennen / Pausen', value: recogSum, cls: 'ph-recog' },
      ],
      { value: t(recogSum), label: 'Ø Erkennung' },
      { size: 200, aria: 'Erkennen und Drehen' },
    );
    const pairsPie = donut(
      ['p1', 'p2', 'p3', 'p4'].map((k, i) => ({ label: `Paar ${i + 1}`, value: ph[k].time || 0, cls: `ph-pair pair-${i + 1}` })),
      { value: t(avgSum('f2l')), label: 'Ø F2L' },
      { size: 200, aria: 'F2L-Paare' },
    );
    const rows = ['cross', 'p1', 'p2', 'p3', 'p4', 'f2l', 'oll', 'pll']
      .map((k) => {
        const p = ph[k];
        const cls = k === 'f2l' ? ' class="sum"' : /^p\d$/.test(k) ? ' class="sub"' : '';
        return `<tr${cls}><td><i class="key ph-${PHASE_CLASS(k)}"></i>${PHASE_NAMES[k]}</td><td>${t(p.time)}</td><td>${k === 'cross' ? '–' : t(p.recog)}</td><td>${t(p.exec)}</td><td>${num(p.moves)}</td><td>${num(p.tps, 2)}</td><td>${t(p.best)}</td><td>${pct(p.share)}</td></tr>`;
      })
      .join('');
    return `<section class="sv-sec">
      <h3>Phasen <span class="small">(${s.detailed} Solves mit Detaildaten)</span></h3>
      <div class="pies">
        <figure><figcaption>Wofür geht die Zeit drauf?</figcaption>${pie}</figure>
        <figure><figcaption>F2L-Paare</figcaption>${pairsPie}</figure>
        <figure><figcaption>Erkennen vs. Drehen</figcaption>${pie2}</figure>
      </div>
      <div class="sv-ll">
        <div class="stat big"><div class="v">${t(ph.oll.recog)}</div><div class="k">Ø Erkennung OLL</div></div>
        <div class="stat big"><div class="v">${t(ph.pll.recog)}</div><div class="k">Ø Erkennung PLL</div></div>
        <div class="stat big"><div class="v">${t(ph.p1.recog != null ? (ph.p1.recog + ph.p2.recog + ph.p3.recog + ph.p4.recog) / 4 : null)}</div><div class="k">Ø Pause vor F2L-Paar</div></div>
      </div>
      <div class="table-wrap"><table class="phase-table">
        <tr><th>Phase</th><th>Ø Zeit</th><th>Erkennung</th><th>Ausführung</th><th>Ø Züge</th><th>TPS Ausf.</th><th>Beste</th><th>Anteil</th></tr>
        ${rows}
      </table></div>
      <p class="small">Erkennung = Pause zwischen dem letzten Zug der vorigen Phase und dem ersten Zug dieser Phase (Würfeldrehungen ohne Gyro zählen mit hinein). Beim Kreuz ist das die Inspektion und wird nicht gemessen.</p>
    </section>`;
  }

  extras(s) {
    const tiles = [
      ['OLL-Skip', pct(s.ollSkip)],
      ['PLL-Skip', pct(s.pllSkip)],
      ['X-Cross', pct(s.xcross)],
      ['Pausen ≥ 0,5 s / Solve', num(s.lookahead?.perSolve)],
      ['Pausenzeit / Solve', t(s.lookahead?.timePerSolve)],
    ];
    const faces = Object.entries(s.crossFaces).sort((a, b) => b[1].n - a[1].n);
    const crossRows = faces
      .map(([f, c]) => `<tr><td>${colorChip(f)} ${COLOR_NAMES[f]}</td><td>${c.n}</td><td>${pct(c.n / s.n)}</td><td>${t(c.mean)}</td></tr>`)
      .join('');
    const slotRows = s.slotStats
      .sort((a, b) => a.mean - b.mean)
      .map((x) => `<tr><td>${[...x.slot].map(colorChip).join('')} ${[...x.slot].map((f) => COLOR_NAMES[f]).join('–')}</td><td>${x.n}</td><td>${t(x.mean)}</td></tr>`)
      .join('');
    return `<section class="sv-sec">
      <h3>Skips &amp; Lookahead</h3>
      <div class="stats">${tiles.map(([k, v]) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('')}</div>
    </section>
    <section class="sv-sec sv-two">
      <div>
        <h3>Kreuzfarben</h3>
        <table class="phase-table"><tr><th>Farbe</th><th>Solves</th><th>Anteil</th><th>Ø Zeit</th></tr>${crossRows || '<tr><td colspan="4">–</td></tr>'}</table>
      </div>
      <div>
        <h3>F2L-Slots</h3>
        <table class="phase-table"><tr><th>Slot</th><th>Paare</th><th>Ø Zeit</th></tr>${slotRows || '<tr><td colspan="3">–</td></tr>'}</table>
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
    this.tip.style.top = `${e.clientY - box.top + this.dlg.scrollTop + 14}px`;
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
