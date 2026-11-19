/**
 * Bilder für Würfel-Designs: je Seite ein quadratisches Bild (512 × 512), das in 3 × 3 Teile zerlegt wird.
 * Jeder Teil wandert beim Drehen mit seinem Stein mit – wie bei einem echten Bilderwürfel.
 *
 *   cow     Kuh: vorne ein Kuhgesicht, sonst Kuhflecken (leicht in der Seitenfarbe getönt → lösbar)
 *   neon    Neon/Cyberpunk: dunkle Felder mit leuchtendem Rand
 *   galaxy  Sternenhimmel mit Nebel in der Seitenfarbe
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
