// Screenshots of the main screens for a visual check: node e2e/shots.mjs <baseUrl> <outDir>
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const base = process.argv[2] ?? 'http://localhost:3000';
const out = process.argv[3] ?? '/tmp/titikapi-shots';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium', args: ['--no-sandbox'] });
const errors = [];
async function shoot(name, path, { width = 1440, height = 900, role, mobile = false, wait = 2500, action } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile,
    geolocation: { latitude: -2.95, longitude: 105.85 }, permissions: ['geolocation'] });
  const page = await context.newPage();
  page.on('console', message => { if (message.type() === 'error') errors.push(`${name}: ${message.text()}`); });
  page.on('pageerror', error => errors.push(`${name}: ${error.message}`));
  if (role) {
    await page.goto(`${base}/masuk`);
    await page.evaluate(async r => { await fetch('/api/v1/auth/demo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: r, client: 'web' }) }); }, role);
  }
  await page.goto(`${base}${path}`);
  await page.waitForTimeout(wait);
  if (action) await action(page);
  // The map screen fills the window; the other pages, the landing page among them, are taken whole.
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: !path.startsWith('/peta') });
  await context.close();
}
// The landing page's screenshots load as they come into view: scroll through it first. Then a window as tall as the
// page, since a full-page capture in headless Chromium leaves the images blank.
const wholePage = async page => {
  await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise(done => setTimeout(done, 120)); } window.scrollTo(0, 0); });
  await page.setViewportSize({ width: page.viewportSize().width, height: await page.evaluate(() => document.documentElement.scrollHeight) });
  await page.waitForTimeout(1200);
};
await shoot('landing-desktop', '/', { wait: 3000, action: wholePage });
await shoot('landing-mobile', '/', { width: 390, height: 844, mobile: true, wait: 3000, action: wholePage });
await shoot('map-desktop', '/peta', { wait: 5000 });
await shoot('map-mobile', '/peta', { width: 390, height: 844, mobile: true, wait: 5000 });
await shoot('alerts-mobile', '/peringatan', { width: 390, height: 844, mobile: true, role: 'mpa' });
await shoot('alerts-desktop', '/peringatan', { role: 'mpa' });
await shoot('dashboard', '/dasbor', { role: 'bpbd', wait: 4000 });
await shoot('login', '/masuk');
await shoot('about', '/tentang');
const incident = await (await fetch(`${base}/api/v1/incidents?hours=72&level=tinggi`)).json();
const id = incident.data[0]?.id;
if (id) {
  await shoot('incident', `/kejadian/${id}`, { wait: 4000 });
  await shoot('verify-mobile', `/kejadian/${id}/cek`, { width: 390, height: 844, mobile: true, role: 'mpa', wait: 3000 });
  const villageId = incident.data[0].village.id;
  await shoot('village', `/desa/${villageId}`, { wait: 4000 });
}
await browser.close();
console.log(errors.length ? errors.join('\n') : 'no console errors');
