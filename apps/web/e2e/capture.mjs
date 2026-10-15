// Screens for the deck, proposal and video: node e2e/capture.mjs <baseUrl> <outDir>
// Signs in with the demo accounts; the offline shot uses the browser's network emulation.
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const base = process.argv[2] ?? 'http://localhost:3000';
const out = process.argv[3] ?? '/tmp/titikapi-screens';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium', args: ['--no-sandbox'] });
const desktop = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

async function session(options, role, position = { latitude: -3.02, longitude: 105.62 }) {
  const context = await browser.newContext({ ...options, geolocation: position, permissions: ['geolocation'], locale: 'id-ID', timezoneId: 'Asia/Jakarta' });
  const page = await context.newPage();
  if (role) {
    await page.goto(`${base}/tentang`);
    await page.evaluate(async r => { await fetch('/api/v1/auth/demo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: r, client: 'web' }) }); }, role);
  }
  return { context, page };
}
const top = await (await fetch(`${base}/api/v1/incidents?hours=72&level=tinggi`)).json();
const incident = top.data.find(item => item.village && !item.firstVerifiedAt) ?? top.data[0];

{ const { context, page } = await session(desktop);
  await page.goto(`${base}/`); await page.waitForTimeout(6000);
  await page.screenshot({ path: `${out}/01-peta.png` });
  await page.getByText('Lahan gambut', { exact: false }).first().click(); await page.waitForTimeout(3500);
  await page.screenshot({ path: `${out}/02-peta-gambut.png` });
  await context.close(); }
{ const { context, page } = await session(phone, 'mpa');
  await page.goto(`${base}/peringatan`); await page.waitForTimeout(3000);
  await page.screenshot({ path: `${out}/03-kartu-ponsel.png` });
  await context.close(); }
if (incident) {
  { const { context, page } = await session(desktop, 'mpa');
    await page.goto(`${base}/kejadian/${incident.id}`); await page.waitForTimeout(4500);
    await page.screenshot({ path: `${out}/04-kejadian.png` });
    await context.close(); }
  { const lat = incident.centroid[1] - 0.004, lon = incident.centroid[0] - 0.003;
    const { context, page } = await session(phone, 'mpa', { latitude: lat, longitude: lon });
    await page.goto(`${base}/kejadian/${incident.id}`); await page.waitForTimeout(2500);
    await page.goto(`${base}/kejadian/${incident.id}/cek`); await page.waitForTimeout(2500);
    await context.setOffline(true); await page.waitForTimeout(800);
    await page.locator('label.status-asap_bara').click();
    await page.screenshot({ path: `${out}/05-cek-offline.png` });
    await page.locator('textarea').fill('Contoh: asap tipis dari tepi kanal.');
    await page.getByRole('button', { name: /Simpan, kirim saat ada sinyal/ }).click(); await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}/06-tersimpan-offline.png` });
    await context.setOffline(false); await page.waitForTimeout(23000);
    await page.goto(`${base}/kejadian/${incident.id}`); await page.waitForTimeout(3000);
    await page.screenshot({ path: `${out}/07-terkirim.png` });
    await context.close(); }
  { const { context, page } = await session(desktop);
    await page.goto(`${base}/desa/${incident.village.id}`); await page.waitForTimeout(6000);
    await page.screenshot({ path: `${out}/09-desa-alih-fungsi.png` });
    await context.close(); }
}
{ const { context, page } = await session(desktop, 'bpbd');
  await page.goto(`${base}/dasbor`); await page.waitForTimeout(5000);
  await page.screenshot({ path: `${out}/08-dasbor.png` });
  await context.close(); }
await browser.close();
console.log('captured', incident?.code);
