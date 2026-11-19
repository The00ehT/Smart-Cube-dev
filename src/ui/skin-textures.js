/**
 * Bilder für Würfel-Designs: je Seite ein quadratisches Bild (512 × 512), das in 3 × 3 Teile zerlegt wird.
 * Jeder Teil wandert beim Drehen mit seinem Stein mit – wie bei einem echten Bilderwürfel.
 *
 *   custom  eigene Bilder je Seite (fehlende Seiten: einfarbig)
 *   colors  einfarbig (nur nötig, wenn ein Logo aufs Mittelstück soll)
 */
const N = 512;
const C = N / 3;

function canvas() {
  const c = document.createElement('canvas');
  c.width = c.height = N;
  return [c, c.getContext('2d')];
}

// Wiederholbarer Zufall, damit die Flecken bei jedem Laden gleich aussehen
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
 * @param theme  'custom' | 'colors'
 * @param colors Farbschema { U: '#…', … }
 * @param opts   { images: { U: dataUrl, … }, logo: dataUrl }
 * @returns Promise<{ U: canvas, … }>
 */
export async function faceImages(theme, colors, opts = {}) {
  const out = {};
  for (const f of ['U', 'R', 'F', 'D', 'L', 'B']) {
    if (theme === 'custom') out[f] = await imageFace(opts.images?.[f], colors[f]);
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

