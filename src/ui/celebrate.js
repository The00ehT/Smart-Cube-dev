/**
 * Rekord-Momente: Konfetti, kurzer Klang und eine Teilen-Karte als Bild.
 */
import { L, locale } from '../i18n.js';
import { formatTime, formatSolve } from '../stats.js';
import { phasesOf, hasDetail } from '../solve-data.js';

// ---------------- Konfetti ----------------

export function confetti(duration = 2200) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.createElement('canvas');
  c.className = 'confetti';
  document.body.append(c);
  const dpr = Math.min(2, devicePixelRatio || 1);
  const resize = () => {
    c.width = innerWidth * dpr;
    c.height = innerHeight * dpr;
  };
  resize();
  const ctx = c.getContext('2d');
  const colors = ['#2a78d6', '#1baf7a', '#eb6834', '#6250d6', '#ffd500', '#e5484d'];
  const parts = Array.from({ length: 160 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 120,
    y: innerHeight * 0.35,
    vx: (Math.random() - 0.5) * 11,
    vy: -Math.random() * 13 - 4,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.4,
    w: 6 + Math.random() * 6,
    h: 4 + Math.random() * 4,
    c: colors[Math.floor(Math.random() * colors.length)],
  }));
  const t0 = performance.now();
  const frame = (t) => {
    const k = (t - t0) / duration;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.35;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - Math.max(0, k - 0.6) / 0.4);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (k < 1) requestAnimationFrame(frame);
    else c.remove();
  };
  requestAnimationFrame(frame);
}

// ---------------- Klang ----------------

let audio = null;
/** Kurzer, freundlicher Dreiklang (ohne Audiodatei) */
export function chime() {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    const now = audio.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0, now + i * 0.08);
      g.gain.linearRampToValueAtTime(0.18, now + i * 0.08 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.6);
      o.connect(g).connect(audio.destination);
      o.start(now + i * 0.08);
      o.stop(now + i * 0.08 + 0.65);
    });
  } catch {
    /* kein Audio */
  }
}

// ---------------- Teilen-Karte ----------------

const PH_COLORS = { cross: '#3987e5', f2l: '#1baf7a', oll: '#eb6834', pll: '#9085e9' };
const PH_NAMES = { cross: 'Cross', f2l: 'F2L', oll: 'OLL', pll: 'PLL' };

async function loadImage(src) {
  return new Promise((res) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => res(null);
    i.src = src;
  });
}

/**
 * Zeichnet die Karte (1080 × 1350) und liefert ein PNG-Blob.
 * @param solve   gespeicherter Solve
 * @param profile { name, avatar }
 * @param badge   z. B. „Neue Bestzeit!“ (optional)
 */
export async function shareCard(solve, profile, badge = '') {
  const W = 1080;
  const H = 1350;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d');
  const font = (w, s) => `${w} ${s}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  // Hintergrund
  const g = x.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#101521');
  g.addColorStop(1, '#1d2a4a');
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  // dezente Würfel-Kacheln
  x.globalAlpha = 0.06;
  const tile = ['#e5484d', '#ffffff', '#30a46c', '#f5d90a', '#0091ff', '#f76b15'];
  for (let i = 0; i < 9; i++) {
    x.fillStyle = tile[i % 6];
    x.beginPath();
    x.roundRect(760 + (i % 3) * 100, 60 + Math.floor(i / 3) * 100, 88, 88, 18);
    x.fill();
  }
  x.globalAlpha = 1;
  // Avatar + Name
  const ax = 90;
  const ay = 110;
  x.fillStyle = '#ffffff22';
  x.beginPath();
  x.arc(ax + 50, ay + 50, 56, 0, Math.PI * 2);
  x.fill();
  if (profile?.avatar?.type === 'image') {
    const img = await loadImage(profile.avatar.value);
    if (img) {
      x.save();
      x.beginPath();
      x.arc(ax + 50, ay + 50, 50, 0, Math.PI * 2);
      x.clip();
      x.drawImage(img, ax, ay, 100, 100);
      x.restore();
    }
  } else {
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillStyle = '#ffffff';
    const initials = (profile?.name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
    if (profile?.avatar?.type === 'emoji' || !initials) {
      x.font = font(400, 60);
      x.fillText(profile?.avatar?.type === 'emoji' ? profile.avatar.value : '🧊', ax + 50, ay + 54);
    } else {
      x.font = font(800, 46);
      x.fillStyle = '#8cb4ff';
      x.fillText(initials, ax + 50, ay + 52);
    }
  }
  x.textAlign = 'left';
  x.textBaseline = 'alphabetic';
  x.fillStyle = '#ffffff';
  x.font = font(700, 46);
  x.fillText(profile?.name || 'Smartcube', ax + 130, ay + 46);
  x.fillStyle = '#ffffffaa';
  x.font = font(400, 30);
  x.fillText(new Date(solve.date).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }), ax + 130, ay + 92);
  // Abzeichen
  let y = 330;
  if (badge) {
    x.font = font(700, 34);
    const bw = x.measureText(badge).width + 56;
    x.fillStyle = '#ffd500';
    x.beginPath();
    x.roundRect(90, y - 50, bw, 68, 34);
    x.fill();
    x.fillStyle = '#1a1a1a';
    x.fillText(badge, 118, y - 4);
    y += 40;
  }
  // Zeit
  x.fillStyle = '#ffffff';
  x.font = font(800, 230);
  x.fillText(formatSolve(solve), 80, y + 210);
  x.fillStyle = '#ffffffb3';
  x.font = font(500, 36);
  x.fillText(`${solve.metrics?.htm ?? solve.moveCount ?? '–'} ${L('Züge', 'moves')}  ·  ${(solve.tps ?? 0).toFixed(2)} TPS`, 92, y + 280);
  // Phasen als Ring
  if (hasDetail(solve)) {
    const [cr, f2, ol, pl] = phasesOf(solve, { mergeF2l: true });
    const segs = [
      ['cross', cr.time],
      ['f2l', f2.time],
      ['oll', ol.time],
      ['pll', pl.time],
    ];
    const total = segs.reduce((a, [, v]) => a + v, 0) || 1;
    const cx = 300;
    const cy = 1020;
    let a = -Math.PI / 2;
    for (const [k, v] of segs) {
      const da = (v / total) * Math.PI * 2;
      if (da <= 0) continue;
      x.strokeStyle = PH_COLORS[k];
      x.lineWidth = 70;
      x.beginPath();
      x.arc(cx, cy, 160, a + 0.02, a + da - 0.02);
      x.stroke();
      a += da;
    }
    x.fillStyle = '#ffffff';
    x.textAlign = 'center';
    x.font = font(700, 48);
    x.fillText(formatTime(solve.time), cx, cy + 16);
    x.textAlign = 'left';
    let ly = 900;
    for (const [k, v] of segs) {
      x.fillStyle = PH_COLORS[k];
      x.beginPath();
      x.roundRect(560, ly - 30, 34, 34, 8);
      x.fill();
      x.fillStyle = '#ffffff';
      x.font = font(600, 40);
      x.fillText(PH_NAMES[k], 616, ly);
      x.textAlign = 'right';
      x.fillText(formatTime(v), 990, ly);
      x.textAlign = 'left';
      ly += 76;
    }
  }
  // Fußzeile
  x.fillStyle = '#ffffff80';
  x.font = font(600, 30);
  x.fillText('Smartcube Timer', 90, H - 70);
  return new Promise((res) => c.toBlob(res, 'image/png'));
}

/** Karte erzeugen und teilen (oder herunterladen) */
export async function shareSolveImage(solve, profile, badge) {
  const blob = await shareCard(solve, profile, badge);
  const file = new File([blob], `solve-${formatTime(solve.time).replace(/[:.]/g, '-')}.png`, { type: 'image/png' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: L('Mein Solve', 'My solve') });
      return 'shared';
    }
  } catch (e) {
    if (e?.name === 'AbortError') return 'aborted';
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return 'downloaded';
}
