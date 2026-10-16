// Walks every role's pages in both languages and reports console errors and failed requests.
//   node e2e/live-check.mjs <baseUrl> [resolveToIp] [screenshotDir]
// resolveToIp maps the host of baseUrl to an address (for a stale local DNS cache); screenshots are optional.
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
const resolveTo = process.argv[3] && process.argv[3] !== '-' ? process.argv[3] : null;
const shots = process.argv[4] ?? null;
if (shots) await mkdir(shots, { recursive: true });
const host = new URL(base).hostname;
const args = ['--no-sandbox', ...(resolveTo ? [`--host-resolver-rules=MAP ${host} ${resolveTo}`] : [])];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium', args });
const problems = [];
let visited = 0;

const top = await (await fetch(`${base}/api/v1/incidents?hours=72&level=tinggi&limit=5`).catch(() => null))?.json().catch(() => null);
const incident = top?.data?.[0];
if (!incident) console.warn('no recent high-priority incident; incident pages are skipped');

async function context(lang, device) {
  const ctx = await browser.newContext(device === 'phone'
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'id-ID', timezoneId: 'Asia/Jakarta' }
    : { viewport: { width: 1440, height: 900 }, locale: 'id-ID', timezoneId: 'Asia/Jakarta' });
  await ctx.addInitScript(value => { try { localStorage.setItem('titikapi.lang', value); localStorage.setItem('titikapi.intro', 'seen'); } catch { /* ignore */ } }, lang);
  return ctx;
}
async function signIn(ctx, role) {
  const page = await ctx.newPage();
  await page.goto(`${base}/tentang`);
  const status = await page.evaluate(async r => (await fetch('/api/v1/auth/demo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: r, client: 'web' }) })).status, role);
  if (status !== 200) problems.push(`sign-in ${role}: HTTP ${status}`);
  await page.close();
}
async function visit(ctx, label, path, wait = 3500) {
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') problems.push(`${label}: console ${m.text().slice(0, 180)}`); });
  page.on('pageerror', e => problems.push(`${label}: pageerror ${e.message.slice(0, 180)}`));
  page.on('response', r => { if (r.status() >= 400 && r.url().startsWith(base)) problems.push(`${label}: ${r.status()} ${r.url().slice(base.length)}`); });
  const response = await page.goto(`${base}${path}`).catch(error => { problems.push(`${label}: ${error.message}`); return null; });
  await page.waitForTimeout(wait);
  if (response && response.status() >= 400) problems.push(`${label}: page ${response.status()}`);
  const text = await page.evaluate(() => document.body.innerText).catch(() => '');
  if (/undefined|NaN|\{[a-z]+\}/.test(text)) problems.push(`${label}: suspicious text ${text.match(/.{0,30}(undefined|NaN|\{[a-z]+\}).{0,30}/)?.[0]}`);
  if (shots) await page.screenshot({ path: `${shots}/${label.replace(/[^a-z0-9-]+/gi, '_')}.png` });
  visited++;
  await page.close();
}

for (const lang of ['id', 'en']) {
  for (const device of ['desktop', 'phone']) {
    const tag = `${lang}-${device}`;
    const pub = await context(lang, device);
    await visit(pub, `${tag}-peta`, '/', 6000);
    if (incident) await visit(pub, `${tag}-kejadian`, `/kejadian/${incident.id}`, 5000);
    if (incident?.village) await visit(pub, `${tag}-desa`, `/desa/${incident.village.id}`, 5000);
    await visit(pub, `${tag}-tentang`, '/tentang', 1500);
    await pub.close();
    const mpa = await context(lang, device); await signIn(mpa, 'mpa');
    await visit(mpa, `${tag}-tugas`, '/tugas', 4000);
    if (incident) await visit(mpa, `${tag}-cek`, `/kejadian/${incident.id}/cek`, 3000);
    await visit(mpa, `${tag}-desa-saya`, '/desa-saya', 3000);
    await mpa.close();
    const kades = await context(lang, device); await signIn(kades, 'kades');
    await visit(kades, `${tag}-kades`, '/desa-saya', 3000);
    await kades.close();
    const bpbd = await context(lang, device); await signIn(bpbd, 'bpbd');
    await visit(bpbd, `${tag}-dasbor`, '/dasbor', 5000);
    await visit(bpbd, `${tag}-rekap`, '/rekap', 3000);
    await bpbd.close();
  }
}
await browser.close();
console.log(`${visited} pages visited`);
console.log(problems.length ? `PROBLEMS (${problems.length})\n${[...new Set(problems)].join('\n')}` : 'no console errors, no failed requests, no placeholder text');
process.exitCode = problems.length ? 1 : 0;
