import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative so the built site works from a subdirectory (GitHub Pages) as
  // well as from a domain root.
  base: './',
  build: {
    target: 'es2022',
    // The wasm2c core is ~850 KB; warning about it on every build is noise.
    chunkSizeWarningLimit: 2048,
  },
  worker: {
    format: 'es',
  },
});
