import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';

/**
 * Offline-Fähigkeit: erzeugt beim Build einen Service Worker (sw.js), der alle Dateien der App speichert.
 * Die Seite selbst wird zuerst aus dem Netz geladen (Updates kommen an), offline aus dem Speicher.
 */
function offline() {
  const extra = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
  return {
    name: 'smartcube-offline',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = [...extra, ...Object.keys(bundle).filter((f) => !f.endsWith('.map') && f !== 'index.html')];
      const version = createHash('sha1').update(files.join('|')).digest('hex').slice(0, 10);
      const source = `// Erzeugt beim Build (vite.config.js) – nicht von Hand ändern.
const CACHE = 'smartcube-${version}';
const FILES = ${JSON.stringify(files)};
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('smartcube-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('message', (e) => {
  if (e.data === 'status') caches.open(CACHE).then(async (c) => e.source.postMessage({ type: 'status', version: '${version}', cached: (await c.keys()).length, total: FILES.length }));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // fremde Server (z. B. Online-Räume) nie aus dem Speicher
  if (req.mode === 'navigate') {
    // Seite: zuerst Netz (Updates), sonst gespeicherte Version
    e.respondWith(fetch(req).catch(() => caches.match('index.html', { ignoreSearch: true, ignoreVary: true }).then((r) => r || caches.match('./'))));
    return;
  }
  e.respondWith(
    caches.match(req, { ignoreSearch: true, ignoreVary: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
      return res;
    })),
  );
});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

// base './' → läuft aus jedem Unterordner (z. B. GitHub Pages unter /smartcube/)
export default defineConfig({
  base: './',
  plugins: [offline()],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    // Vites Preload-Helfer nutzt document und würde im Such-Worker abstürzen
    modulePreload: false,
    rollupOptions: {
      output: {
        // Der Such-Worker von cubing.js lädt dessen gemeinsamen Code nach. Liegt der im
        // Haupt-Chunk, liefe die App-Logik (mit document) im Worker mit und er stürzt ab.
        // Deshalb: statischer cubing.js-Code in einen eigenen Chunk, nachladbare Teile bleiben getrennt.
        manualChunks(id) {
          const m = /node_modules\/cubing\/dist\/lib\/cubing\/(.*)$/.exec(id);
          if (m && (!m[1].startsWith('chunks/') || m[1].startsWith('chunks/chunk-'))) return 'cubing';
        },
      },
    },
  },
});
