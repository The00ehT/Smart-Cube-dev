/**
 * Bilder für Würfel-Designs: je Seite ein quadratisches Bild (512 × 512), das in 3 × 3 Teile zerlegt wird.
 * Jeder Teil wandert beim Drehen mit seinem Stein mit – wie bei einem echten Bilderwürfel.
 *
 *   cow     Kuh: vorne ein Kuhgesicht, sonst Kuhflecken (leicht in der Seitenfarbe getönt → lösbar)
 *   neon    Neon/Cyberpunk: dunkle Felder mit leuchtendem Rand
 *   galaxy  Sternenhimmel mit Nebel in der Seitenfarbe
 *   pcb     Platine: Lötstopplack je Seite, Leiterbahnen, Vias, SMD-Bauteile, Chip in der Mitte
 *   custom  eigene Bilder je Seite (fehlende Seiten: einfarbig)
 */
const N = 512;
const C = N / 3;

function canvas() {
  const c = document.createElement('canvas');
  c.width = c.height = N;
  return [c, c.getContext('2d')];
}

// Wiederholbarer Zufall, damit die Flecken bei jedem Laden gleich aussehen
function rng(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

const mix = (hex, to, k) => {
  const a = parseInt(hex.slice(1), 16);
  const b = parseInt(to.slice(1), 16);
  const ch = (x, sh) => (x >> sh) & 255;
  const m = (sh) => Math.round(ch(a, sh) * (1 - k) + ch(b, sh) * k);
  return `rgb(${m(16)},${m(8)},${m(0)})`;
};

function blob(ctx, x, y, r, rnd) {
  ctx.beginPath();
  const n = 9;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (0.7 + rnd() * 0.5);
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr * 0.8;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.quadraticCurveTo(x + Math.cos(a - 0.35) * rr * 1.15, y + Math.sin(a - 0.35) * rr * 0.9, px, py);
  }
  ctx.closePath();
  ctx.fill();
}

function cowFace(face, color) {
  const [c, x] = canvas();
  const rnd = rng(face.charCodeAt(0) * 97 + 13);
  x.fillStyle = mix(color, '#ffffff', 0.72);
  x.fillRect(0, 0, N, N);
  x.fillStyle = '#1d1b1a';
  for (let i = 0; i < 7; i++) blob(x, rnd() * N, rnd() * N, 40 + rnd() * 55, rnd);
  if (face !== 'F') return c;
  // Kuhgesicht vorne
  x.fillStyle = mix(color, '#ffffff', 0.72);
  x.fillRect(0, 0, N, N);
  const cx = N / 2;
  // Ohren und Hörner
  x.fillStyle = '#f4e3c3';
  for (const s of [-1, 1]) {
    x.beginPath();
    x.ellipse(cx + s * 170, 120, 22, 52, s * 0.6, 0, Math.PI * 2);
    x.fill();
  }
  x.fillStyle = '#ffffff';
  x.strokeStyle = '#1d1b1a';
  x.lineWidth = 8;
  for (const s of [-1, 1]) {
    x.beginPath();
    x.ellipse(cx + s * 165, 190, 70, 38, s * -0.35, 0, Math.PI * 2);
    x.fill();
    x.stroke();
  }
  // Kopf
  x.beginPath();
  x.ellipse(cx, 260, 150, 175, 0, 0, Math.PI * 2);
  x.fillStyle = '#ffffff';
  x.fill();
  x.stroke();
  x.save();
  x.clip();
  x.fillStyle = '#1d1b1a';
  blob(x, cx - 105, 170, 70, rnd);
  blob(x, cx + 120, 250, 55, rnd);
  x.restore();
  // Augen
  for (const s of [-1, 1]) {
    x.fillStyle = '#1d1b1a';
    x.beginPath();
    x.ellipse(cx + s * 62, 225, 24, 30, 0, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = '#ffffff';
    x.beginPath();
    x.arc(cx + s * 62 + 8, 214, 9, 0, Math.PI * 2);
    x.fill();
  }
  // Schnauze
  x.fillStyle = '#ffb3c1';
  x.beginPath();
  x.ellipse(cx, 355, 118, 72, 0, 0, Math.PI * 2);
  x.fill();
  x.stroke();
  x.fillStyle = '#9b4a5a';
  for (const s of [-1, 1]) {
    x.beginPath();
    x.ellipse(cx + s * 45, 345, 15, 22, s * 0.3, 0, Math.PI * 2);
    x.fill();
  }
  x.strokeStyle = '#9b4a5a';
  x.lineWidth = 7;
  x.beginPath();
  x.arc(cx, 375, 38, 0.15 * Math.PI, 0.85 * Math.PI);
  x.stroke();
  // Wangen
  x.fillStyle = 'rgba(255,120,150,0.35)';
  for (const s of [-1, 1]) {
    x.beginPath();
    x.arc(cx + s * 112, 290, 22, 0, Math.PI * 2);
    x.fill();
  }
  return c;
}

const NEON = { U: '#f2f2ff', D: '#ffe600', F: '#00ff9c', B: '#00b3ff', R: '#ff2a6d', L: '#ff8c00' };
function neonFace(face) {
  const [c, x] = canvas();
  x.fillStyle = '#07070d';
  x.fillRect(0, 0, N, N);
  const col = NEON[face];
  for (let r = 0; r < 3; r++) {
    for (let k = 0; k < 3; k++) {
      const px = k * C + 14;
      const py = r * C + 14;
      const w = C - 28;
      const g = x.createLinearGradient(px, py, px + w, py + w);
      g.addColorStop(0, mix(col, '#07070d', 0.82));
      g.addColorStop(1, mix(col, '#07070d', 0.93));
      x.fillStyle = g;
      x.beginPath();
      x.roundRect(px, py, w, w, 22);
      x.fill();
      x.shadowColor = col;
      x.shadowBlur = 26;
      x.strokeStyle = col;
      x.lineWidth = 7;
      x.stroke();
      x.shadowBlur = 0;
      // kleine Schaltkreis-Details
      x.strokeStyle = mix(col, '#07070d', 0.45);
      x.lineWidth = 3;
      x.beginPath();
      x.moveTo(px + 22, py + w - 26);
      x.lineTo(px + w / 2, py + w - 26);
      x.lineTo(px + w / 2 + 16, py + w - 42);
      x.stroke();
      x.fillStyle = col;
      x.beginPath();
      x.arc(px + w / 2 + 16, py + w - 42, 5, 0, Math.PI * 2);
      x.fill();
    }
  }
  return c;
}

function galaxyFace(face, color) {
  const [c, x] = canvas();
  const rnd = rng(face.charCodeAt(0) * 31 + 7);
  // Grundton: dunkle Seitenfarbe, damit die Seiten unterscheidbar bleiben
  const bg = x.createLinearGradient(0, 0, N, N);
  bg.addColorStop(0, mix(color, '#05060f', 0.55));
  bg.addColorStop(1, mix(color, '#05060f', 0.8));
  x.fillStyle = bg;
  x.fillRect(0, 0, N, N);
  // Nebel: weiche Wolken in der Seitenfarbe
  for (let i = 0; i < 6; i++) {
    const cx = rnd() * N;
    const cy = rnd() * N;
    const r = 120 + rnd() * 180;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, mix(color, '#ffffff', 0.25));
    g.addColorStop(0.4, mix(color, '#05060f', 0.15));
    g.addColorStop(1, 'rgba(5,6,15,0)');
    x.globalAlpha = 0.45;
    x.fillStyle = g;
    x.fillRect(0, 0, N, N);
  }
  x.globalAlpha = 1;
  // Sterne
  for (let i = 0; i < 260; i++) {
    const big = rnd() > 0.93;
    const r = big ? rnd() * 2.4 + 1.6 : rnd() * 1.3 + 0.4;
    const sx = rnd() * N;
    const sy = rnd() * N;
    x.fillStyle = `rgba(255,255,255,${0.55 + rnd() * 0.45})`;
    x.beginPath();
    x.arc(sx, sy, r, 0, Math.PI * 2);
    x.fill();
    if (big) {
      x.strokeStyle = 'rgba(255,255,255,0.5)';
      x.lineWidth = 1.2;
      x.beginPath();
      x.moveTo(sx - r * 4, sy);
      x.lineTo(sx + r * 4, sy);
      x.moveTo(sx, sy - r * 4);
      x.lineTo(sx, sy + r * 4);
      x.stroke();
    }
  }
  return c;
}

// ---------- Platine (PCB) ----------

// Lötstopplack je Seite (echte Platinenfarben), Bestückungsdruck hell auf dunklem Lack, dunkel auf hellem
const PCB = {
  U: { mask: '#e9e9e4', silk: '#1b1b1b' },
  D: { mask: '#e2c11a', silk: '#1b1b1b' },
  F: { mask: '#1d7a3c', silk: '#f4f4f0' },
  B: { mask: '#1c4e9c', silk: '#f4f4f0' },
  R: { mask: '#b01f2a', silk: '#f4f4f0' },
  L: { mask: '#d8661b', silk: '#1b1b1b' },
};
const GOLD = '#d9b04a';
const GOLD_HI = '#f2d27a';

function pcbFace(face) {
  const [c, x] = canvas();
  const { mask, silk } = PCB[face];
  const rnd = rng(face.charCodeAt(0) * 131 + 17);
  const G = 16; // Raster
  const snap = (v) => Math.round(v / G) * G;
  // Lack mit leichter Struktur
  x.fillStyle = mask;
  x.fillRect(0, 0, N, N);
  for (let i = 0; i < 1400; i++) {
    x.fillStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '0,0,0'},${0.03 + rnd() * 0.03})`;
    x.fillRect(rnd() * N, rnd() * N, 2, 2);
  }
  // Kupfer unter dem Lack: auf dunklem Lack heller, auf hellem Lack dunkler
  const light = silk !== '#f4f4f0';
  const trace = light ? mix(mask, '#000000', 0.16) : mix(mask, '#ffffff', 0.28);
  const traceDark = light ? mix(mask, '#000000', 0.3) : mix(mask, '#000000', 0.18);

  // Leiterbahnen: Rasterwege mit 45°-Knicken, enden in Vias
  const vias = [];
  for (let t = 0; t < 26; t++) {
    let px = snap(rnd() * N);
    let py = snap(rnd() * N);
    const pts = [[px, py]];
    let dir = Math.floor(rnd() * 4);
    for (let seg = 0; seg < 3 + Math.floor(rnd() * 4); seg++) {
      const len = G * (2 + Math.floor(rnd() * 8));
      const dx = [1, 0, -1, 0][dir];
      const dy = [0, 1, 0, -1][dir];
      // 45°-Übergang
      if (seg > 0) {
        const diag = G;
        px += dx * diag + (pts.length > 1 ? 0 : 0);
        py += dy * diag;
        pts.push([px, py]);
      }
      px += dx * len;
      py += dy * len;
      pts.push([px, py]);
      dir = (dir + (rnd() < 0.5 ? 1 : 3)) % 4;
    }
    const w = rnd() < 0.25 ? 9 : 5;
    x.lineCap = 'round';
    x.lineJoin = 'round';
    x.strokeStyle = traceDark;
    x.lineWidth = w + 3;
    x.beginPath();
    pts.forEach(([a, b], i) => (i ? x.lineTo(a, b) : x.moveTo(a, b)));
    x.stroke();
    x.strokeStyle = trace;
    x.lineWidth = w;
    x.stroke();
    vias.push(pts[0], pts[pts.length - 1]);
  }
  // Vias: Goldring mit Bohrung
  for (const [vx, vy] of vias) {
    x.fillStyle = GOLD;
    x.beginPath();
    x.arc(vx, vy, 8, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = GOLD_HI;
    x.beginPath();
    x.arc(vx - 2, vy - 2, 4, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = '#2a2a2a';
    x.beginPath();
    x.arc(vx, vy, 3.5, 0, Math.PI * 2);
    x.fill();
  }
  // Bauteile: SMD-Widerstände/Kondensatoren mit Bestückungsdruck
  x.font = 'bold 15px ui-monospace, Menlo, Consolas, monospace';
  x.textBaseline = 'middle';
  for (let k = 0; k < 14; k++) {
    const cx = 40 + rnd() * (N - 80);
    const cy = 40 + rnd() * (N - 80);
    if (Math.hypot(cx - N / 2, cy - N / 2) < 110) continue; // Platz für den Chip
    const vert = rnd() < 0.5;
    const isCap = rnd() < 0.4;
    const pw = 12;
    const ph = 14;
    const gap = 18;
    x.save();
    x.translate(cx, cy);
    if (vert) x.rotate(Math.PI / 2);
    // Bestückungsrahmen
    x.strokeStyle = silk;
    x.lineWidth = 2;
    x.strokeRect(-gap - pw - 4, -ph / 2 - 4, 2 * (gap + pw + 4), ph + 8);
    // Pads
    for (const s of [-1, 1]) {
      x.fillStyle = GOLD;
      x.fillRect(s * gap - (s < 0 ? pw : 0), -ph / 2, pw, ph);
      x.fillStyle = GOLD_HI;
      x.fillRect(s * gap - (s < 0 ? pw : 0) + 2, -ph / 2 + 2, pw - 6, 3);
    }
    // Bauteilkörper
    x.fillStyle = isCap ? '#b9875a' : '#1e1e1e';
    x.fillRect(-gap + 2, -ph / 2 + 1, 2 * gap - 4, ph - 2);
    if (!isCap) {
      x.fillStyle = '#f4f4f0';
      x.font = 'bold 9px ui-monospace, Menlo, monospace';
      x.textAlign = 'center';
      x.fillText(String(Math.floor(rnd() * 900 + 100)), 0, 1);
    }
    x.restore();
    // Beschriftung
    x.fillStyle = silk;
    x.font = 'bold 15px ui-monospace, Menlo, Consolas, monospace';
    x.textAlign = 'left';
    x.fillText(`${isCap ? 'C' : 'R'}${Math.floor(rnd() * 40 + 1)}`, cx + (vert ? 16 : -24), cy + (vert ? 0 : -24));
  }
  // Chip (QFP) mitten auf der Seite
  const s = 112;
  const cx0 = N / 2 - s / 2;
  const cy0 = N / 2 - s / 2;
  x.fillStyle = GOLD;
  for (let i = 0; i < 10; i++) {
    const o = 12 + i * ((s - 24) / 9);
    x.fillRect(cx0 + o - 3, cy0 - 18, 6, 18);
    x.fillRect(cx0 + o - 3, cy0 + s, 6, 18);
    x.fillRect(cx0 - 18, cy0 + o - 3, 18, 6);
    x.fillRect(cx0 + s, cy0 + o - 3, 18, 6);
  }
  const body = x.createLinearGradient(cx0, cy0, cx0 + s, cy0 + s);
  body.addColorStop(0, '#2b2b2e');
  body.addColorStop(1, '#141416');
  x.fillStyle = body;
  x.beginPath();
  x.roundRect(cx0, cy0, s, s, 6);
  x.fill();
  x.fillStyle = '#3a3a3e';
  x.beginPath();
  x.arc(cx0 + 16, cy0 + 16, 6, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = '#c9c9c9';
  x.textAlign = 'center';
  x.font = 'bold 18px ui-monospace, Menlo, Consolas, monospace';
  x.fillText('SC-333', N / 2, N / 2 - 8);
  x.font = '13px ui-monospace, Menlo, Consolas, monospace';
  x.fillText(`${face}-2026`, N / 2, N / 2 + 16);
  // Bestückungsdruck um den Chip und Platinenname
  x.strokeStyle = silk;
  x.lineWidth = 2;
  x.strokeRect(cx0 - 26, cy0 - 26, s + 52, s + 52);
  x.fillStyle = silk;
  x.textAlign = 'left';
  x.font = 'bold 15px ui-monospace, Menlo, Consolas, monospace';
  x.fillText('U1', cx0 - 24, cy0 - 38);
  return c;
}

function plainFace(color) {
  const [c, x] = canvas();
  x.fillStyle = color;
  x.fillRect(0, 0, N, N);
  return c;
}

function loadImage(src) {
  return new Promise((resolve) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => resolve(null);
    i.src = src;
  });
}

/** Bild als Seite: quadratisch zugeschnitten */
async function imageFace(src, color) {
  const [c, x] = canvas();
  x.fillStyle = color;
  x.fillRect(0, 0, N, N);
  const img = src && (await loadImage(src));
  if (img) {
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    x.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, N, N);
  }
  return c;
}

/**
 * Bilder aller sechs Seiten für ein Design.
 * @param theme  'cow' | 'neon' | 'galaxy' | 'custom' | 'colors'
 * @param colors Farbschema { U: '#…', … }
 * @param opts   { images: { U: dataUrl, … }, logo: dataUrl }
 * @returns Promise<{ U: canvas, … }>
 */
export async function faceImages(theme, colors, opts = {}) {
  const out = {};
  for (const f of ['U', 'R', 'F', 'D', 'L', 'B']) {
    if (theme === 'cow') out[f] = cowFace(f, colors[f]);
    else if (theme === 'neon') out[f] = neonFace(f);
    else if (theme === 'galaxy') out[f] = galaxyFace(f, colors[f]);
    else if (theme === 'pcb') out[f] = pcbFace(f);
    else if (theme === 'custom') out[f] = await imageFace(opts.images?.[f], colors[f]);
    else out[f] = plainFace(colors[f]);
  }
  // Logo auf das weiße Mittelstück (U)
  if (opts.logo) {
    const img = await loadImage(opts.logo);
    if (img) {
      const x = out.U.getContext('2d');
      const s = C * 0.7;
      const k = Math.min(s / img.naturalWidth, s / img.naturalHeight);
      const w = img.naturalWidth * k;
      const h = img.naturalHeight * k;
      x.drawImage(img, N / 2 - w / 2, N / 2 - h / 2, w, h);
    }
  }
  return out;
}

export const NEON_COLORS = NEON;
