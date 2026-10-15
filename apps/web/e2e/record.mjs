// Screen recordings of the real app for the pitch film: node e2e/record.mjs <baseUrl> <mediaDir>
// Each clip is a Playwright video (webm) converted to H.264; the film shows them inside phone and browser frames.
import { chromium } from 'playwright-core';
import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const base = process.argv[2] ?? 'http://localhost:3000';
const only = process.argv[4] ? new Set(process.argv[4].split(',')) : null;
const media = process.argv[3] ?? '/tmp/titikapi-media';
const work = join(media, '.raw');
await mkdir(work, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium', args: ['--no-sandbox'] });
const desktop = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, recordVideo: { dir: work, size: { width: 1440, height: 900 } } };
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, recordVideo: { dir: work, size: { width: 390, height: 844 } } };

async function record(name, options, role, script, position) {
  if (only && !only.has(name)) return;
  const context = await browser.newContext({ ...options, locale: 'id-ID', timezoneId: 'Asia/Jakarta', ...(position ? { geolocation: position, permissions: ['geolocation'] } : {}) });
  if (role) {
    const login = await context.newPage();
    await login.goto(`${base}/tentang`);
    await login.evaluate(async r => { await fetch('/api/v1/auth/demo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: r, client: 'web' }) }); }, role);
    await login.close();
  }
  const page = await context.newPage();
  // Logs when each step happens in the clip, to time the film's taps and cuts against it.
  const began = Date.now();
  const mark = label => console.log(`  ${name} ${((Date.now() - began) / 1000).toFixed(1)}s ${label}`);
  await script(page, context, mark);
  const video = page.video();
  await context.close();
  const raw = await video.path();
  const out = join(media, `${name}.mp4`);
  const done = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', '30', out], { stdio: 'inherit' });
  if (done.status !== 0) throw new Error(`ffmpeg failed for ${name}`);
  console.log(name, out);
}
const smoothScroll = (page, y, ms) => page.evaluate(([y, ms]) => new Promise(resolve => {
  const start = scrollY, began = performance.now();
  const step = now => { const t = Math.min(1, (now - began) / ms); scrollTo(0, start + (y - start) * (1 - Math.pow(1 - t, 3))); t < 1 ? requestAnimationFrame(step) : resolve(); };
  requestAnimationFrame(step);
}), [y, ms]);

const top = (await (await fetch(`${base}/api/v1/incidents?hours=24&level=tinggi`)).json()).data;
// The field check and village clips stay in the OKI pilot, where the demo volunteer works.
const incident = top.find(item => item.village?.regency === 'Ogan Komering Ilir' && !item.firstVerifiedAt) ?? top.find(item => item.village && !item.firstVerifiedAt) ?? top[0];

await record('peta', desktop, null, async page => {
  await page.goto(`${base}/`); await page.waitForTimeout(5500);
  await page.locator('.map-control', { hasText: 'Lapisan' }).click(); await page.waitForTimeout(700);
  await page.locator('label.layer', { hasText: 'Lahan gambut' }).click(); await page.waitForTimeout(2000);
  await page.locator('.map-control', { hasText: 'Lapisan' }).click(); await page.waitForTimeout(500);
  await page.locator('.inc-row').first().click(); await page.waitForTimeout(3600);
});
await record('kartu', phone, 'mpa', async page => {
  await page.goto(`${base}/peringatan`); await page.waitForTimeout(3000);
  await smoothScroll(page, 560, 1600); await page.waitForTimeout(1800);
  await smoothScroll(page, 980, 1400); await page.waitForTimeout(1500);
});
await record('cek', phone, 'mpa', async (page, context, mark) => {
  await page.goto(`${base}/kejadian/${incident.id}`); await page.waitForTimeout(1500);
  await page.goto(`${base}/kejadian/${incident.id}/cek`); await page.waitForTimeout(2000);
  await context.setOffline(true); mark('offline'); await page.waitForTimeout(1200);
  mark('status'); await page.locator('label.option', { hasText: 'Asap / bara' }).click(); await page.waitForTimeout(900);
  await smoothScroll(page, 700, 900); await page.waitForTimeout(400);
  await page.locator('textarea').pressSequentially('Asap tipis di tepi kanal.', { delay: 35 }); await page.waitForTimeout(500);
  mark('submit'); await page.getByRole('button', { name: /Simpan, kirim saat ada sinyal/ }).click(); await page.waitForTimeout(2600);
  await context.setOffline(false); mark('online'); await page.waitForTimeout(2600);
  mark('open incident'); await page.getByRole('link', { name: 'Lihat kejadian' }).click(); await page.waitForTimeout(3000);
}, { latitude: incident.centroid[1] - 0.0035, longitude: incident.centroid[0] - 0.0028, accuracy: 12 });
await record('dasbor', desktop, 'bpbd', async page => {
  await page.goto(`${base}/dasbor`); await page.waitForTimeout(4500);
  await smoothScroll(page, 380, 1800); await page.waitForTimeout(1500);
  await smoothScroll(page, 900, 1800); await page.waitForTimeout(1500);
});
await record('desa', desktop, null, async page => {
  await page.goto(`${base}/desa/${incident.village.id}`); await page.waitForTimeout(6000);
  await page.locator('.map-control', { hasText: 'Lapisan' }).click(); await page.waitForTimeout(800);
  await page.locator('label.layer', { hasText: 'Alert gangguan hutan' }).click(); await page.waitForTimeout(2200);
  await page.locator('label.layer', { hasText: 'Alert gangguan hutan' }).click(); await page.waitForTimeout(2200);
  await page.locator('.map-control', { hasText: 'Lapisan' }).click(); await page.waitForTimeout(800);
});
await browser.close();
await rm(work, { recursive: true, force: true });
console.log('incident', incident.code, incident.village.name);
