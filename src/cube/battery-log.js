/**
 * Akku-Verlauf des Würfels: Messungen mit dem aktiven Gyro-Modus, Verbrauch je Modus, Diagramm.
 * Zweck: prüfen, ob „Eco“ den Würfel-Akku wirklich schont.
 *
 * Eintrag: { t (ms, Unix), l (Akku %), m ('P' Performance | 'E' Eco | '-' unbekannt) }
 */

export const MAX_SAMPLES = 1500;
/** Lücken ab dieser Länge gelten als „nicht verbunden“ (kein Verbrauch rechnen, Linie unterbrechen) */
export const GAP_MS = 20 * 60 * 1000;
/** Gleicher Wert wird trotzdem alle paar Minuten festgehalten, damit Zeitverlauf sichtbar bleibt */
const KEEP_EVERY_MS = 10 * 60 * 1000;

export const modeCode = (mode) => (mode === 'performance' ? 'P' : mode === 'eco' ? 'E' : '-');

/**
 * Messung anhängen (verändert `log`). Gespeichert wird bei Änderung von Akku oder Modus,
 * sonst höchstens alle 10 Minuten.
 * @returns true, wenn etwas hinzukam
 */
export function addSample(log, t, level, mode) {
  if (level == null || Number.isNaN(level)) return false;
  const l = Math.max(0, Math.min(100, Math.round(level)));
  const m = modeCode(mode);
  const last = log[log.length - 1];
  if (last && last.l === l && last.m === m && t - last.t < KEEP_EVERY_MS) return false;
  if (last && t < last.t) return false; // Uhr zurückgestellt: ignorieren
  log.push({ t, l, m });
  if (log.length > MAX_SAMPLES) log.splice(0, log.length - MAX_SAMPLES);
  return true;
}

/**
 * Verbrauch je Modus in Prozentpunkten pro Stunde.
 * Gewertet werden nur benachbarte Messungen im selben Modus ohne große Lücke; steigt der Akku
 * (Laden), zählt das Paar nicht. Ergebnis je Modus: { ratePerHour, hours, drop, fullHours } oder null,
 * wenn weniger als 20 Minuten Messzeit vorliegen. `fullHours` = geschätzte Laufzeit von 100 % auf 0.
 */
export function drainByMode(log) {
  const acc = { P: { ms: 0, drop: 0 }, E: { ms: 0, drop: 0 } };
  for (let i = 1; i < log.length; i++) {
    const a = log[i - 1];
    const b = log[i];
    if (a.m !== b.m || !acc[a.m]) continue;
    const dt = b.t - a.t;
    if (dt <= 0 || dt > GAP_MS) continue;
    if (b.l > a.l) continue; // Laden
    acc[a.m].ms += dt;
    acc[a.m].drop += a.l - b.l;
  }
  const out = {};
  for (const [k, v] of Object.entries(acc)) {
    const hours = v.ms / 3600000;
    if (v.ms < 20 * 60 * 1000) {
      out[k] = null;
      continue;
    }
    const ratePerHour = v.drop / hours;
    out[k] = { ratePerHour, hours, drop: v.drop, fullHours: ratePerHour > 0 ? 100 / ratePerHour : null };
  }
  return out;
}

/** CSV zum Weiterverarbeiten (Zeit als ISO, Akku %, Modus) */
export function toCsv(log) {
  const name = { P: 'performance', E: 'eco', '-': 'unknown' };
  return ['time,battery_percent,mode', ...log.map((s) => `${new Date(s.t).toISOString()},${s.l},${name[s.m] || 'unknown'}`)].join('\n');
}

/**
 * Diagramm als SVG-Text: Akku (%) über die Zeit der letzten `hours` Stunden, Hintergrundbänder je Modus.
 * Linie wird bei Lücken unterbrochen. Gibt '' zurück, wenn zu wenige Daten da sind.
 * @param labels { perf, eco, unknown } Beschriftungen der Legende
 */
export function batteryChartSvg(log, { hours = 24, now = Date.now(), width = 520, height = 190, labels = {}, locale = 'de-DE' } = {}) {
  const from = now - hours * 3600000;
  const pts = log.filter((s) => s.t >= from);
  if (pts.length < 2) return '';
  const t0 = pts[0].t;
  const t1 = Math.max(pts[pts.length - 1].t, t0 + 60000);
  const padL = 34;
  const padR = 8;
  const padT = 8;
  const padB = 24;
  const W = width - padL - padR;
  const H = height - padT - padB;
  const x = (t) => padL + ((t - t0) / (t1 - t0)) * W;
  const y = (l) => padT + (1 - l / 100) * H;
  const fmt = (n) => n.toFixed(1);

  // Bänder: von Messung zu Messung im Modus der früheren, nur ohne Lücke
  const bandColor = { P: 'var(--ph-oll)', E: 'var(--good)', '-': 'var(--muted)' };
  let bands = '';
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].t - pts[i - 1].t > GAP_MS) continue;
    bands += `<rect x="${fmt(x(pts[i - 1].t))}" y="${padT}" width="${fmt(Math.max(0.5, x(pts[i].t) - x(pts[i - 1].t)))}" height="${H}" fill="${bandColor[pts[i - 1].m] || bandColor['-']}" opacity="0.16"/>`;
  }

  // Linie je zusammenhängendem Stück
  let lines = '';
  let seg = [pts[0]];
  const flush = () => {
    if (seg.length === 1) lines += `<circle cx="${fmt(x(seg[0].t))}" cy="${fmt(y(seg[0].l))}" r="2" fill="var(--accent)"/>`;
    else lines += `<polyline points="${seg.map((s) => `${fmt(x(s.t))},${fmt(y(s.l))}`).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  };
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].t - pts[i - 1].t > GAP_MS) {
      flush();
      seg = [];
    }
    seg.push(pts[i]);
  }
  flush();

  const grid = [0, 25, 50, 75, 100]
    .map((v) => `<line x1="${padL}" x2="${width - padR}" y1="${fmt(y(v))}" y2="${fmt(y(v))}" stroke="var(--chart-grid)"/><text x="${padL - 5}" y="${fmt(y(v) + 4)}" text-anchor="end" font-size="10" fill="var(--chart-ink)">${v}</text>`)
    .join('');
  const time = (t) => new Date(t).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const axis = `<text x="${padL}" y="${height - 6}" font-size="10" fill="var(--chart-ink)">${time(t0)}</text><text x="${width - padR}" y="${height - 6}" text-anchor="end" font-size="10" fill="var(--chart-ink)">${time(t1)}</text>`;
  const legend = [
    ['P', labels.perf || 'Performance'],
    ['E', labels.eco || 'Eco'],
  ]
    .map(([k, txt], i) => `<g transform="translate(${padL + 70 + i * 100},${height - 15})"><rect width="10" height="10" fill="${bandColor[k]}" opacity="0.5"/><text x="14" y="9" font-size="10" fill="var(--chart-ink)">${txt}</text></g>`)
    .join('');
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${labels.aria || 'Akku-Verlauf'}">${bands}${grid}${lines}${axis}${legend}</svg>`;
}
