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
body{width:1200px;height:630px;background:#F6F6F4;color:#191614;font-family:Inter;display:grid;grid-template-columns:1fr 430px;position:relative;overflow:hidden}
.copy{padding:72px 0 64px 80px;display:flex;flex-direction:column;justify-content:space-between}
.brand{display:flex;align-items:center;gap:16px;font-size:34px;font-weight:650;letter-spacing:-0.02em}
.brand svg{width:52px;height:52px}
h1{font-size:58px;line-height:1.08;font-weight:650;letter-spacing:-0.03em;max-width:640px}
p{font-size:26px;line-height:1.4;color:#57514B;max-width:620px;margin-top:20px}
.foot{font-size:21px;color:#8A837C;font-variant-numeric:tabular-nums}
.art{background:#161312;display:grid;place-items:center}
.art svg{width:250px;height:250px}
</style><body>
<div class="copy"><div class="brand">${mark}Titik Api</div>
<div><h1>Peringatan titik panas tingkat desa</h1><p>Untuk pengendalian kebakaran hutan dan lahan di Sumatera Selatan dan Kalimantan Tengah.</p></div>
<div class="foot">4.837 desa/kelurahan · NASA FIRMS VIIRS dan MODIS</div></div>
<div class="art">${mark}</div>
</body>`;
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html); await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: resolve(root, 'public/og.png') });
await browser.close();
console.log('og.png written');
