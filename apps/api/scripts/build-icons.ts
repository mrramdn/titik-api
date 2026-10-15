// Renders the app icons from the favicon artwork. Run: tsx scripts/build-icons.ts
// The link preview image has text, so it is rendered in a browser instead: apps/web/e2e/og.mjs.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

const web = resolve(import.meta.dirname, '../../web/public');
const svg = await readFile(resolve(web, 'favicon.svg'));
for (const size of [192, 512]) await sharp(svg, { density: 1200 }).resize(size, size).png().toFile(resolve(web, `icons/icon-${size}.png`));
// Maskable: the mark sits inside the 80% safe zone on the same dark ground.
const inner = await sharp(svg, { density: 1200 }).resize(340, 340).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#161312' } }).composite([{ input: inner, gravity: 'center' }]).png().toFile(resolve(web, 'icons/icon-maskable-512.png'));
console.log('icons written');
