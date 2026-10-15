// Renders public/og.png (1200x630 link preview) with the app's own fonts: node e2e/og.mjs
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const root = resolve(import.meta.dirname, '..');
const font = file => `data:font/woff2;base64,${readFileSync(resolve(root, 'node_modules', file)).toString('base64')}`;
const mark = readFileSync(resolve(root, 'public/favicon.svg'), 'utf8');
const html = `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:Inter;font-weight:100 900;src:url(${font('@fontsource-variable/inter/files/inter-latin-wght-normal.woff2')}) format('woff2')}
*{margin:0;box-sizing:border-box}
body{width:1200px;height:630px;background:#161312;color:#F3EFEA;font-family:Inter;display:flex;flex-direction:column;justify-content:space-between;padding:72px 80px;position:relative;overflow:hidden}
.brand{display:flex;align-items:center;gap:20px;font-size:40px;font-weight:600;letter-spacing:-0.01em}
.brand svg{width:64px;height:64px}
h1{font-size:64px;line-height:1.1;font-weight:600;letter-spacing:-0.02em;max-width:820px}
p{font-size:28px;line-height:1.4;color:rgb(243 239 234 / 0.68);max-width:760px;margin-top:20px}
.foot{display:flex;gap:28px;font-size:22px;color:rgb(243 239 234 / 0.48);font-variant-numeric:tabular-nums}
.foot b{color:#FF5A1F;font-weight:600}
.arcs{position:absolute;right:-120px;top:120px;width:560px;height:560px}
</style><body>
<svg class="arcs" viewBox="0 0 28 28" fill="none"><circle cx="14" cy="16.5" r="1.6" fill="#FF5A1F"/><path d="M10.6 13.2a4.8 4.8 0 0 1 6.8 0" stroke="#FF5A1F" stroke-width="0.5" stroke-linecap="round" opacity="0.5"/><path d="M8 10.4a8.5 8.5 0 0 1 12 0" stroke="#FF5A1F" stroke-width="0.5" stroke-linecap="round" opacity="0.3"/><path d="M5.4 7.6a12.2 12.2 0 0 1 17.2 0" stroke="#FF5A1F" stroke-width="0.5" stroke-linecap="round" opacity="0.16"/></svg>
<div class="brand">${mark}Titik Api</div>
<div><h1>Titik panas satelit per desa.</h1><p>Dicek relawan Masyarakat Peduli Api di lapangan, juga tanpa sinyal, lalu dibaca BPBD.</p></div>
<div class="foot"><span><b>●</b> Sumatera Selatan · Kalimantan Tengah</span><span>NASA FIRMS VIIRS 375 m</span></div>
</body>`;
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html); await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: resolve(root, 'public/og.png') });
await browser.close();
console.log('og.png written');
