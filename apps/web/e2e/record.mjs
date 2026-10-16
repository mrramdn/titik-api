// Screen recordings of the real app for the pitch film: node e2e/record.mjs <baseUrl> <mediaDir> [clip,clip]
// Each clip is a Playwright video (webm) converted to H.264; the film shows them inside phone and browser frames.
// The clips follow one incident: BPBD assigns it to the demo squad (dasbor), the volunteer sees the task (tugas)
// and files the field check without signal (cek), and the village page shows it (desa).
// Writes demo data (tagged "demo"); run the demo reset afterwards.
import { chromium } from 'playwright-core';
import { mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
const only = process.argv[4] ? new Set(process.argv[4].split(',')) : null;
const media = process.argv[3] ?? '/tmp/titikapi-media';
const work = join(media, '.raw');
await mkdir(work, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium', args: ['--no-sandbox'] });
const desktop = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, recordVideo: { dir: work, size: { width: 1440, height: 900 } } };
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, recordVideo: { dir: work, size: { width: 390, height: 844 } } };
const pilot = 'Ogan Komering Ilir';
const squad = 'Sungai Menang';

async function record(name, options, role, script, position) {
  if (only && !only.has(name)) return;
  const context = await browser.newContext({ ...options, locale: 'id-ID', timezoneId: 'Asia/Jakarta', ...(position ? { geolocation: position, permissions: ['geolocation'] } : {}) });
  await context.addInitScript(() => {
    try { localStorage.setItem('titikapi.lang', 'id'); localStorage.setItem('titikapi.intro', 'seen'); localStorage.setItem('titikapi.legend', 'closed'); } catch { /* ignore */ }
  });
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
const api = async (role, path) => {
  const signIn = await fetch(`${base}/api/v1/auth/demo`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ role, client: 'web' }) });
  const cookie = signIn.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  return (await (await fetch(`${base}/api/v1${path}`, { headers: { cookie } })).json()).data;
};

await record('peta', desktop, null, async (page, context, mark) => {
  await page.goto(`${base}/`); await page.waitForTimeout(5000);
  mark('regency'); await page.selectOption('select.fselect[aria-label="Kabupaten"]', pilot); await page.waitForTimeout(2600);
  mark('layers'); await page.getByRole('button', { name: 'Lapisan', exact: true }).click(); await page.waitForTimeout(700);
  await page.locator('label.maplayer', { hasText: 'Lahan gambut' }).click(); await page.waitForTimeout(1800);
  await page.getByRole('button', { name: 'Lapisan', exact: true }).click(); await page.waitForTimeout(500);
  mark('incident'); await page.locator('button.inc').first().click(); await page.waitForTimeout(4000);
});

// BPBD assigns the top open incident in the pilot regency to the demo squad, then opens the daily recap.
const assignedBefore = new Set((await api('bpbd', '/incidents?hours=72&status=assigned&limit=200')).map(item => item.id));
await record('dasbor', desktop, 'bpbd', async (page, context, mark) => {
  await page.goto(`${base}/dasbor`); await page.waitForTimeout(3000);
  mark('regency'); await page.locator('button.bd-regency', { hasText: pilot }).click(); await page.waitForTimeout(1300);
  mark('assign'); await page.locator('.bd-lane').first().getByRole('button', { name: 'Tugaskan' }).first().click(); await page.waitForTimeout(1100);
  mark('squad'); await page.locator('label.bd-assignee', { hasText: squad }).click(); await page.waitForTimeout(800);
  mark('submit'); await page.locator('dialog.bd-dialog button[type=submit]').click(); await page.waitForTimeout(2200);
  mark('recap'); await page.getByRole('link', { name: 'Rekap harian' }).click(); await page.waitForTimeout(3200);
});
const incident = (await api('bpbd', '/incidents?hours=72&status=assigned&limit=200')).find(item => !assignedBefore.has(item.id))
  ?? (await api('mpa', '/me/assignments')).find(task => task.status === 'ditugaskan')?.incident;
if (!incident) throw new Error('no task for the demo squad; record "dasbor" first');
const [lon, lat] = incident.centroid;

await record('tugas', phone, 'mpa', async (page, context, mark) => {
  await page.goto(`${base}/tugas`); await page.waitForTimeout(3000);
  mark('nearest'); await page.getByRole('button', { name: 'Terdekat', exact: true }).click(); await page.waitForTimeout(2200);
  mark('scroll'); await smoothScroll(page, 640, 1600); await page.waitForTimeout(1600);
  await smoothScroll(page, 1040, 1400); await page.waitForTimeout(1600);
}, { latitude: lat + 0.035, longitude: lon + 0.045, accuracy: 12 });
await record('cek', phone, 'mpa', async (page, context, mark) => {
  await page.goto(`${base}/tugas`); await page.waitForTimeout(1500);
  await page.goto(`${base}/kejadian/${incident.id}/cek`); await page.waitForTimeout(2000);
  await context.setOffline(true); mark('offline'); await page.waitForTimeout(1200);
  mark('status'); await page.locator('label.option', { hasText: 'Asap atau bara' }).click(); await page.waitForTimeout(900);
  await smoothScroll(page, 900, 900); await page.waitForTimeout(400);
  await page.locator('textarea').pressSequentially('Asap tipis di tepi kanal.', { delay: 35 }); await page.waitForTimeout(500);
  mark('submit'); await page.getByRole('button', { name: /Simpan, kirim saat ada sinyal/ }).click(); await page.waitForTimeout(2600);
  await context.setOffline(false); mark('online'); await page.waitForTimeout(2600);
  mark('open incident'); await page.getByRole('link', { name: 'Lihat kejadian' }).click(); await page.waitForTimeout(3000);
}, { latitude: lat - 0.0035, longitude: lon - 0.0028, accuracy: 12 });
await record('desa', desktop, null, async (page, context, mark) => {
  await page.goto(`${base}/desa/${incident.village.id}`); await page.waitForTimeout(5500);
  mark('layers'); await page.getByRole('button', { name: 'Lapisan', exact: true }).click(); await page.waitForTimeout(800);
  mark('off'); await page.locator('label.maplayer', { hasText: 'Peringatan gangguan hutan' }).click(); await page.waitForTimeout(2200);
  mark('on'); await page.locator('label.maplayer', { hasText: 'Peringatan gangguan hutan' }).click(); await page.waitForTimeout(2200);
  await page.getByRole('button', { name: 'Lapisan', exact: true }).click(); await page.waitForTimeout(800);
});
await browser.close();
await rm(work, { recursive: true, force: true });
console.log('incident', incident.id, incident.code, incident.village?.name);
