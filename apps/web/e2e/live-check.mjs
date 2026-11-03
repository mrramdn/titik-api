// Walks the landing page and every role's pages in both languages and reports console errors and failed requests;
// then checks that the landing page leaves the map's code alone, that an old map link (/?tanggal=) lands on /peta and
// that ?lihat= opens each shared demo account.
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
/** `forbid` matches requests the page must not make. */
async function visit(ctx, label, path, wait = 3500, forbid = null) {
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') problems.push(`${label}: console ${m.text().slice(0, 180)}`); });
  page.on('pageerror', e => problems.push(`${label}: pageerror ${e.message.slice(0, 180)}`));
  page.on('response', r => { if (r.status() >= 400 && r.url().startsWith(base)) problems.push(`${label}: ${r.status()} ${r.url().slice(base.length)}`); });
  if (forbid) page.on('request', r => { if (forbid.test(r.url())) problems.push(`${label}: requested ${r.url().replace(base, '')}`); });
  const response = await page.goto(`${base}${path}`).catch(error => { problems.push(`${label}: ${error.message}`); return null; });
  await page.waitForTimeout(wait);
  // Below the fold too: the landing page's screenshots load as they come into view.
  await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise(done => setTimeout(done, 80)); } }).catch(() => {});
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
    // The landing page downloads neither the map screen nor MapLibre (pages/LazyMapScreen.tsx, map/LazyMapView.tsx).
    await visit(pub, `${tag}-beranda`, '/', 3000, /\/assets\/(MapScreen|IncidentPanel|MapView|maplibre)/);
    await visit(pub, `${tag}-peta`, '/peta', 6000);
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

/**
 * Opens `path` in a fresh browser and reports where it ends, who is signed in then and how many history entries the
 * visit added (1 when a redirect replaces the entry).
 */
async function opens(label, path, check) {
  const ctx = await context('id', 'desktop');
  const page = await ctx.newPage();
  page.on('pageerror', e => problems.push(`${label}: pageerror ${e.message.slice(0, 180)}`));
  const before = await page.evaluate(() => history.length);
  await page.goto(`${base}${path}`).catch(error => problems.push(`${label}: ${error.message}`));
  await page.waitForTimeout(4000);
  const me = await page.evaluate(async () => (await (await fetch('/api/v1/auth/me')).json()).data).catch(() => null);
  const problem = check(new URL(page.url()), me, await page.evaluate(() => history.length) - before);
  if (problem) problems.push(`${label}: ${problem}`);
  visited++;
  await ctx.close();
}
// An old map link: the map at /peta, the same day, no extra history entry.
await opens('lama-tanggal', '/?tanggal=2026-10-23', (url, _me, added) =>
  url.pathname !== '/peta' ? `ended on ${url.pathname}${url.search}` : added > 1 ? `${added} history entries` : null);
// ?lihat= opens that shared demo account on the page asked for, then leaves the address.
for (const [role, path] of [['mpa', '/tugas'], ['kades', '/desa-saya'], ['bpbd', '/dasbor']]) {
  await opens(`lihat-${role}`, `${path}?lihat=${role}`, (url, me) =>
    url.pathname !== path || url.searchParams.has('lihat') ? `ended on ${url.pathname}${url.search}`
      : me?.role !== role || !me?.demo ? `signed in as ${me ? `${me.role}${me.demo ? ' (demo)' : ''}` : 'nobody'}` : null);
}

await browser.close();
console.log(`${visited} pages visited`);
console.log(problems.length ? `PROBLEMS (${problems.length})\n${[...new Set(problems)].join('\n')}` : 'no console errors, no failed requests, no placeholder text');
process.exitCode = problems.length ? 1 : 0;
