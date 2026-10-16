// Renders the app icons from the logo artwork. Run: tsx scripts/build-icons.ts
// The link preview image has text, so it is rendered in a browser instead: apps/web/e2e/og.mjs.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

const web = resolve(import.meta.dirname, '../../web/public');
const tile = await readFile(resolve(web, 'icon-tile.svg'));
const mark = await readFile(resolve(web, 'favicon.svg'));
for (const size of [192, 512]) await sharp(tile, { density: 1200 }).resize(size, size).png().toFile(resolve(web, `icons/icon-${size}.png`));
// Maskable: the mark inside the 80% safe zone on a full-bleed dark ground.
const inner = await sharp(mark, { density: 1600 }).resize(300, 300).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#161312' } }).composite([{ input: inner, gravity: 'center' }]).png().toFile(resolve(web, 'icons/icon-maskable-512.png'));
console.log('icons written');
