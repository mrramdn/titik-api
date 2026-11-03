// The web app manifest (vite-plugin-pwa writes it as manifest.webmanifest), apart from vite.config.ts so a test can read
// it. An installed app says it is a demo, as the page title and the link previews do.
import type { ManifestOptions } from 'vite-plugin-pwa';

export const manifest: Partial<ManifestOptions> = {
  name: 'Titik Api · demo dengan data satelit asli',
  short_name: 'Titik Api',
  description: 'Demo portofolio peringatan titik panas tingkat desa di Sumatera Selatan dan Kalimantan Tengah, dengan data satelit asli NASA FIRMS. Bukan sistem peringatan resmi.',
  lang: 'id',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#161312',
  theme_color: '#161312',
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};
