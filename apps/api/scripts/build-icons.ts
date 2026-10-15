// Renders the app icons and the link preview image from the favicon artwork. Run: tsx scripts/build-icons.ts
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

const web = resolve(import.meta.dirname, '../../web/public');
const svg = await readFile(resolve(web, 'favicon.svg'));
for (const size of [192, 512]) await sharp(svg, { density: 600 }).resize(size, size).png().toFile(resolve(web, `icons/icon-${size}.png`));
const inner = await sharp(svg, { density: 600 }).resize(360, 360).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#1B1612' } }).composite([{ input: inner, gravity: 'center' }]).png().toFile(resolve(web, 'icons/icon-maskable-512.png'));
const og = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#1B1612"/>
  <g opacity="0.35" stroke="#E8501A" fill="none" stroke-width="2">${Array.from({ length: 9 }, (_, i) => `<circle cx="930" cy="315" r="${40 + i * 38}" stroke-dasharray="${4 + i} ${6 + i}"/>`).join('')}</g>
  <circle cx="930" cy="315" r="14" fill="#E8501A"/><circle cx="1010" cy="250" r="7" fill="#FFB23F"/><circle cx="870" cy="410" r="9" fill="#FFB23F"/>
  <text x="80" y="250" font-family="Bricolage Grotesque, DejaVu Sans, sans-serif" font-weight="800" font-size="120" fill="#F5F0E8">Titik Api</text>
  <text x="84" y="330" font-family="DejaVu Sans, sans-serif" font-size="38" fill="#E9DFD2">Titik panas satelit per desa,</text>
  <text x="84" y="380" font-family="DejaVu Sans, sans-serif" font-size="38" fill="#E9DFD2">diverifikasi warga, dibaca BPBD.</text>
  <text x="84" y="520" font-family="DejaVu Sans Mono, monospace" font-size="26" fill="#FFB23F">PILOT · OGAN KOMERING ILIR · NASA FIRMS NOAA-20/21</text>
</svg>`);
await sharp(og).png().toFile(resolve(web, 'og.png'));
console.log('icons written');
