import { defineConfig } from 'vite';

// Relative base so the build works at any path (GitHub Pages serves it at /EarthRacer/).
export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 1000 },
});
