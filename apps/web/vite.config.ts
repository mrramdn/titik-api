import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { manifest } from './src/manifest.ts';

const api = process.env.API_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: false,
      // mjs: MapLibre's worker script (assets/maplibre-gl-worker-*.mjs). Without it the map pane stays blank offline once
      // the browser's HTTP cache has dropped that file.
      injectManifest: { globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2,webmanifest}'], maximumFileSizeToCacheInBytes: 4 * 1024 * 1024 },
      manifest,
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    proxy: { '/api': api, '/uploads': api, '/k/': api },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 1600 },
});
