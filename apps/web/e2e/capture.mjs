// Screens for the deck, proposal and video: node e2e/capture.mjs <baseUrl> <outDir>
// Follows one incident through the whole flow with the demo accounts: BPBD assigns it to the demo squad, the
// volunteer opens the task, files the field check without signal, and the report lands once the signal returns.
// Writes demo data (tagged "demo"); run the demo reset afterwards.
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
const out = process.argv[3] ?? '/tmp/titikapi-screens';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium', args: ['--no-sandbox'] });
const desktop = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const pilot = 'Ogan Komering Ilir';
const squad = 'Sungai Menang';

async function session(options, role, { position = { latitude: -3.02, longitude: 105.62 }, legend = true } = {}) {
  const context = await browser.newContext({ ...options, geolocation: { accuracy: 12, ...position }, permissions: ['geolocation'], locale: 'id-ID', timezoneId: 'Asia/Jakarta' });
  await context.addInitScript(open => {
    try {
      localStorage.setItem('titikapi.lang', 'id');
      localStorage.setItem('titikapi.intro', 'seen');
      if (!open) localStorage.setItem('titikapi.legend', 'closed');
    } catch { /* ignore */ }
  }, legend);
  const page = await context.newPage();
  if (role) {
    await page.goto(`${base}/tentang`);
    await page.evaluate(async r => { await fetch('/api/v1/auth/demo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: r, client: 'web' }) }); }, role);
  }
  return { context, page };
}
const api = (page, path) => page.evaluate(async p => (await (await fetch(`/api/v1${p}`)).json()).data, path);
const shot = (page, name) => page.screenshot({ path: `${out}/${name}.png` });

// Map: the overview, the pilot regency over peat, and the same view on the daily satellite image.
{ const { context, page } = await session(desktop);
  await page.goto(`${base}/`); await page.waitForTimeout(6000);
  await shot(page, '01-peta');
  await page.selectOption('select.fselect[aria-label="Kabupaten"]', pilot); await page.waitForTimeout(3000);
  await page.getByRole('button', { name: 'Lapisan', exact: true }).click(); await page.waitForTimeout(400);
  await page.locator('label.maplayer', { hasText: 'Lahan gambut' }).click(); await page.waitForTimeout(3500);
  await shot(page, '02-peta-gambut');
  await context.close(); }
{ const { context, page } = await session(desktop, null, { legend: false });
  await page.goto(`${base}/`); await page.waitForTimeout(3000);
  await page.selectOption('select.fselect[aria-label="Kabupaten"]', pilot); await page.waitForTimeout(2500);
  await page.getByRole('button', { name: 'Tampilan satelit' }).click(); await page.waitForTimeout(7000);
  await shot(page, '13-satelit');
  await context.close(); }

// BPBD assigns the top open incident in the pilot regency to the demo squad.
let incident;
{ const { context, page } = await session(desktop, 'bpbd');
  await page.goto(`${base}/dasbor`); await page.waitForTimeout(5000);
  await page.locator('button.bd-regency', { hasText: pilot }).click(); await page.waitForTimeout(2500);
  const before = new Set((await api(page, '/incidents?hours=72&status=assigned&limit=200')).map(item => item.id));
  await page.locator('.bd-lane').first().getByRole('button', { name: 'Tugaskan' }).first().click(); await page.waitForTimeout(1500);
  await page.locator('label.bd-assignee', { hasText: squad }).click(); await page.waitForTimeout(300);
  await page.locator('dialog.bd-dialog textarea').fill('Cek sisi timur kanal, laporkan arah asap.');
  await shot(page, '11-penugasan');
  await page.locator('dialog.bd-dialog button[type=submit]').click(); await page.waitForTimeout(2500);
  incident = (await api(page, '/incidents?hours=72&status=assigned&limit=200')).find(item => !before.has(item.id));
  await context.close(); }
if (!incident) throw new Error('the assignment did not land');
console.log('assigned', incident.code, incident.village?.name);

// The volunteer's task page: the new task on top, then the village alerts. The squad stands about 6 km away.
{ const [lon, lat] = incident.centroid;
  const { context, page } = await session(phone, 'mpa', { position: { latitude: lat + 0.035, longitude: lon + 0.045 } });
  await page.goto(`${base}/tugas`); await page.waitForTimeout(4000);
  await shot(page, '10-tugas-ponsel');
  await page.evaluate(() => { const head = document.getElementById('v-alerts'); if (head) window.scrollTo(0, head.getBoundingClientRect().top + window.scrollY - 72); });
  await page.waitForTimeout(600);
  await shot(page, '03-kartu-ponsel');
  await context.close(); }
{ const { context, page } = await session(desktop, 'mpa');
  await page.goto(`${base}/kejadian/${incident.id}`); await page.waitForTimeout(5000);
  await shot(page, '04-kejadian');
  await context.close(); }

// The field check without signal, then the report after the signal returns.
{ const [lon, lat] = incident.centroid;
  const { context, page } = await session(phone, 'mpa', { position: { latitude: lat - 0.004, longitude: lon - 0.003 } });
  await page.goto(`${base}/tugas`); await page.waitForTimeout(3500);
  await page.goto(`${base}/kejadian/${incident.id}/cek`); await page.waitForTimeout(3000);
  await context.setOffline(true); await page.waitForTimeout(800);
  await page.locator('label.option', { hasText: 'Asap atau bara' }).click();
  await shot(page, '05-cek-offline');
  await page.locator('textarea').fill('Asap tipis dari tepi kanal, tidak ada nyala.');
  await page.getByRole('button', { name: /Simpan, kirim saat ada sinyal/ }).click(); await page.waitForTimeout(1500);
  await shot(page, '06-tersimpan-offline');
  await context.setOffline(false); await page.waitForTimeout(20000);
  await page.goto(`${base}/kejadian/${incident.id}`); await page.waitForTimeout(6000);
  await shot(page, '07-terkirim');
  await context.close(); }

if (incident.village) {
  const { context, page } = await session(desktop);
  await page.goto(`${base}/desa/${incident.village.id}`); await page.waitForTimeout(6000);
  await shot(page, '09-desa-alih-fungsi');
  await context.close();
}

// BPBD after the check: the lanes and the daily recap.
{ const { context, page } = await session(desktop, 'bpbd');
  await page.goto(`${base}/dasbor`); await page.waitForTimeout(5000);
  await shot(page, '08-dasbor');
  await page.goto(`${base}/rekap`); await page.waitForTimeout(4000);
  await shot(page, '12-rekap');
  await context.close(); }
await browser.close();
console.log('captured', incident.code);
