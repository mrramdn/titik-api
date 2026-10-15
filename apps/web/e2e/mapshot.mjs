// Map-only images (no app chrome) for the Figma mockups: node e2e/mapshot.mjs <baseUrl> <outDir>
import { chromium } from 'playwright-core';
const base = process.argv[2] ?? 'http://localhost:3000';
const out = process.argv[3] ?? '/tmp';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const hide = '.topbar,.panel,.tabbar,.outbox,.mapcard,.maplibregl-ctrl-top-right,.maplibregl-ctrl-bottom-left,.maplibregl-ctrl-bottom-right{display:none!important}.home{grid-template-columns:1fr!important;height:100vh!important}';
async function shot(name, width, height, path, after) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  await page.goto(`${base}${path}`); await page.addStyleTag({ content: hide });
  await page.waitForTimeout(6500); if (after) await after(page);
  await page.screenshot({ path: `${out}/${name}.png` }); await page.close();
}
await shot('map-overview', 1060, 852, '/');
const top = (await (await fetch(`${base}/api/v1/incidents?hours=24&level=tinggi`)).json()).data[0];
await shot('map-incident', 1060, 852, `/kejadian/${top.id}`, async page => {
  await page.addStyleTag({ content: '.page>*:not(.incident-grid){display:none!important}.incident-grid{grid-template-columns:1fr!important;margin:0!important}.incident-grid>.stack{display:none!important}.map-mid{height:100vh!important;border:0!important;border-radius:0!important}.page{padding:0!important;max-width:none!important}' });
  await page.waitForTimeout(3000);
});
await browser.close();
console.log('ok', top.code);
