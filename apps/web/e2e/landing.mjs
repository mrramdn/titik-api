// Screenshots for the landing page: node e2e/landing.mjs <baseUrl> [rawDir] [name,name]
// Real screens from a server with real data: the map on archive day 2026-10-23 (the busiest day of October 2026), the
// role pages through the shared demo accounts. Reads only: it signs in to demo accounts but files nothing (the field
// check is shown without signal and never sent). Writes WebP files to public/landing/ with sharp from the API's
// dependencies; the raw PNG captures stay in rawDir. The pages with live data are cut below the top bar, whose
// satellite data status says how fresh the server's data is at capture time, not what the screenshot shows.
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
const raw = process.argv[3] ?? '/tmp/titikapi-landing';
const only = process.argv[4] ? new Set(process.argv[4].split(',')) : null;
const out = resolve(import.meta.dirname, '../public/landing');
const sharp = createRequire(resolve(import.meta.dirname, '../../api/package.json'))('sharp');
await mkdir(raw, { recursive: true });
await mkdir(out, { recursive: true });

const day = '2026-10-23';
// Tanjung Atap, Ogan Ilir: a high-priority incident on that day with VIIRS boxes and five villages downwind.
const incidentCode = process.env.INCIDENT ?? 'z7f2q38';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium', args: ['--no-sandbox'] });
const desktop = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const wait = ms => new Promise(done => setTimeout(done, ms));

async function open(options, role, { legend = false } = {}) {
  const context = await browser.newContext({ ...options, locale: 'id-ID', timezoneId: 'Asia/Jakarta', geolocation: { latitude: -3.02, longitude: 105.62, accuracy: 12 }, permissions: ['geolocation'] });
  await context.addInitScript(open => {
    try {
      localStorage.setItem('titikapi.lang', 'id');
      localStorage.setItem('titikapi.intro', 'seen');
      localStorage.setItem('titikapi.province', '');
      if (!open) localStorage.setItem('titikapi.legend', 'closed');
    } catch { /* ignore */ }
  }, legend);
  const page = await context.newPage();
  if (role) {
    await page.goto(`${base}/tentang`);
    const status = await page.evaluate(async r => (await fetch('/api/v1/auth/demo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: r, client: 'web' }) })).status, role);
    if (status !== 200) throw new Error(`demo sign-in ${role}: HTTP ${status}`);
  }
  return { context, page };
}
const box = async (page, selector) => {
  const found = await page.locator(selector).first().boundingBox();
  if (!found) throw new Error(`not on the page: ${selector}`);
  return found;
};
/**
 * Saves the raw capture and its WebP at `width` x `height`: cut to fill from the top, or with `background` the whole
 * capture centred on that colour (a part of the sidebar on the sidebar's own background).
 */
async function save(name, png, width, height, quality = 74, background = null) {
  await writeFile(`${raw}/${name}.png`, png);
  const fit = background ? { fit: 'contain', background } : { fit: 'cover', position: 'top' };
  const webp = await sharp(png).resize(width, height, fit).webp({ quality, effort: 6 }).toBuffer();
  await writeFile(`${out}/${name}.webp`, webp);
  console.log(`${name}.webp ${width}x${height} ${(webp.length / 1024).toFixed(1)} KB`);
  return webp.length;
}
const want = name => !only || only.has(name);
const api = (page, path) => page.evaluate(async p => (await (await fetch(`/api/v1${p}`)).json()).data, path);

// The map screen on the busiest day, Pulang Pisau: the incident list ranked by priority and the incidents on the map.
if (want('peta')) {
  const { context, page } = await open(desktop, null);
  await page.goto(`${base}/peta?tanggal=${day}`); await wait(2500);
  await page.selectOption('select.fselect[aria-label="Kabupaten"]', process.env.REGENCY ?? 'Pulang Pisau'); await wait(6500);
  const png = await page.screenshot();
  await save('peta', png, 1600, 1000, 68);
  await save('peta-800', png, 800, 500, 70);
  await context.close();
}

// One incident on that day: the panel down to the priority score and its reasons, and the map close enough for pixel
// boxes. The window is tall enough for the whole score.
const sidebar = '#161312';
if (want('kejadian') || want('fitur-piksel') || want('fitur-angin') || want('fitur-luas')) {
  const { context, page } = await open({ ...desktop, viewport: { width: 1440, height: 1180 } }, null);
  await page.goto(`${base}/peta?tanggal=${day}`); await wait(1500);
  await page.goto(`${base}/k/${incidentCode}?tanggal=${day}`); await wait(8000);
  if (want('kejadian')) {
    const png = await page.screenshot();
    await save('kejadian', png, 1600, 1311);
    await save('kejadian-800', png, 800, 656, 72);
  }
  // The sidebar parts without the sidebar's right border and the section's bottom line.
  if (want('fitur-angin')) {
    const wind = await box(page, '.ip-wind');
    await save('fitur-angin', await page.screenshot({ clip: { x: 0, y: wind.y, width: 379, height: wind.height - 1 } }), 720, 480, 74, sidebar);
  }
  if (want('fitur-luas')) {
    const facts = await box(page, '.ip-facts');
    await save('fitur-luas', await page.screenshot({ clip: { x: 0, y: facts.y - 18, width: 379, height: facts.height + 34 } }), 720, 480, 74, sidebar);
  }
  if (want('fitur-piksel')) {
    // Two steps closer than the panel opens (zoom 12), with the map's own zoom button.
    await page.locator('.maplibregl-ctrl-zoom-in').click(); await wait(900);
    await page.locator('.maplibregl-ctrl-zoom-in').click(); await wait(900);
    await page.mouse.move(40, 40); await wait(4500);
    const map = await box(page, '.map-pane');
    const cx = map.x + map.width / 2, cy = map.y + map.height / 2;
    await save('fitur-piksel', await page.screenshot({ clip: { x: cx - 330, y: cy - 220, width: 660, height: 440 } }), 720, 480);
  }
  await context.close();
}

// The archive picker: a bar per day, the busiest day chosen.
if (want('fitur-arsip')) {
  const { context, page } = await open(desktop, null);
  await page.goto(`${base}/peta?tanggal=${day}`); await wait(5000);
  const pick = await box(page, '.archive-pick');
  await save('fitur-arsip', await page.screenshot({ clip: { x: 0, y: pick.y - 2, width: 379, height: pick.height + 4 } }), 720, 480, 74, sidebar);
  await context.close();
}

// Fire danger on that day: the FWI grid over both provinces.
if (want('fitur-bahaya')) {
  const { context, page } = await open(desktop, null);
  await page.goto(`${base}/peta?tanggal=${day}`); await wait(4000);
  await page.getByRole('button', { name: 'Lapisan', exact: true }).click(); await wait(500);
  await page.locator('label.maplayer', { hasText: 'Bahaya kebakaran' }).click(); await wait(800);
  await page.getByRole('button', { name: 'Lapisan', exact: true }).click(); await wait(5000);
  const map = await box(page, '.map-pane');
  await save('fitur-bahaya', await page.screenshot({ clip: { x: map.x, y: map.y, width: Math.min(map.width, map.height * 1.5), height: Math.min(map.height, map.width / 1.5) } }), 720, 480);
  await context.close();
}

// The roles. Live pages are cut below the top bar (see the note at the top).
const top = 48;
/** The demo squad's open task, to stand the phone about 6 km from it (and close by for the field check). */
const openTask = async page => {
  const task = (await api(page, '/me/assignments'))?.find(item => item.status === 'ditugaskan' || item.status === 'menuju');
  if (!task) throw new Error('the demo squad has no open task');
  return task;
};
if (want('peran-mpa')) {
  const { context, page } = await open(phone, 'mpa');
  const [lon, lat] = (await openTask(page)).incident.centroid;
  await context.setGeolocation({ latitude: lat + 0.035, longitude: lon + 0.045, accuracy: 12 });
  await page.goto(`${base}/tugas`); await wait(5000);
  await save('peran-mpa', await page.screenshot({ clip: { x: 0, y: top, width: 390, height: 731 } }), 480, 900);
  await context.close();
}
if (want('peran-kades')) {
  const { context, page } = await open(phone, 'kades');
  await page.goto(`${base}/desa-saya`); await wait(5000);
  await save('peran-kades', await page.screenshot({ clip: { x: 0, y: top, width: 390, height: 731 } }), 480, 900);
  await context.close();
}
if (want('peran-bpbd')) {
  const { context, page } = await open({ ...desktop, viewport: { width: 1440, height: 948 } }, 'bpbd');
  await page.goto(`${base}/dasbor?range=7d`); await wait(7000);
  await save('peran-bpbd', await page.screenshot({ clip: { x: 0, y: top, width: 1440, height: 900 } }), 1000, 625);
  await context.close();
}
if (want('peran-publik')) {
  const { context, page } = await open(phone, null);
  await page.goto(`${base}/peta?tanggal=${day}`); await wait(7000);
  await save('peran-publik', await page.screenshot({ clip: { x: 0, y: 0, width: 390, height: 731 } }), 480, 900);
  await context.close();
}

// The field check without signal, on the demo squad's task: shown, never sent. A short window keeps the "no signal"
// bar under the app bar and the sticky "save, send when there is signal" button in one frame.
if (want('fitur-offline')) {
  const { context, page } = await open({ ...phone, viewport: { width: 390, height: 260 } }, 'mpa');
  const task = await openTask(page);
  const [lon, lat] = task.incident.centroid;
  await context.setGeolocation({ latitude: lat - 0.004, longitude: lon - 0.003, accuracy: 12 });
  await page.goto(`${base}/tugas`); await wait(2500);
  await page.goto(`${base}/kejadian/${task.incident.id}/cek`); await wait(3500);
  await context.setOffline(true); await wait(1000);
  await page.locator('label.option', { hasText: 'Asap atau bara' }).click(); await wait(400);
  await page.evaluate(() => window.scrollTo(0, 0)); await wait(500);
  await save('fitur-offline', await page.screenshot(), 720, 480);
  await context.close();
}

await browser.close();
