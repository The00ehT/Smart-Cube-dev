import { defineConfig } from 'vite';

// base './' → läuft aus jedem Unterordner (z. B. GitHub Pages unter /smartcube/)
export default defineConfig({
  base: './',
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
