// Walks the landing page and every role's pages in both languages and reports console errors and failed requests;
// then checks that a first visit to the landing page leaves the map's code alone (its own requests and a service
// worker's), that the first app screen installs the service worker with the map (MapLibre's worker included) for use
// without a signal, also once the browser's HTTP cache is gone, that an old map link (/?tanggal=) lands on /peta, that
// ?lihat= opens each shared demo account but never over a session the server has not confirmed and never undoes where
// the visitor went meanwhile, that an unknown address stays as it is, and that the installed app keeps its identity.
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
/** Known and reported, not a regression: printed after the run without failing it. */
const notes = new Set();
let visited = 0;
/** The map's code: the map screen, the incident panel and MapLibre. */
const mapCode = /\/assets\/(MapScreen|IncidentPanel|MapView|maplibre)/;

const top = await (await fetch(`${base}/api/v1/incidents?hours=72&level=tinggi&limit=5`).catch(() => null))?.json().catch(() => null);
const incident = top?.data?.[0];
if (!incident) console.warn('no recent high-priority incident; incident pages are skipped');

/** `serviceWorkers: 'block'` where requests are faked: a service worker would answer them before page.route sees them. */
async function context(lang, device, { serviceWorkers = 'allow' } = {}) {
  const ctx = await browser.newContext({
    ...(device === 'phone'
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { viewport: { width: 1440, height: 900 } }),
    locale: 'id-ID', timezoneId: 'Asia/Jakarta', serviceWorkers,
  });
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
const me = page => page.evaluate(async () => (await (await fetch('/api/v1/auth/me')).json()).data).catch(() => null);
const sleep = ms => new Promise(done => setTimeout(done, ms));

/**
 * Text on the landing page under 4.5:1 against what it sits on (3:1 for large text): each element with text of its
 * own, its colour laid over the first opaque background up the tree. `known`: the app-wide primary button, white on
 * the brand orange (3.1:1), a design decision left to the owner.
 */
const lowContrast = () => {
  const rgba = value => { const [r, g, b, a = 1] = value.match(/[\d.]+/g).map(Number); return [r, g, b, a]; };
  const over = (top, under) => [0, 1, 2].map(i => top[i] * top[3] + under[i] * (1 - top[3]));
  const luminance = rgb => { const c = rgb.map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const background = element => {
    const layers = [];
    for (let node = element; node; node = node.parentElement) {
      const color = rgba(getComputedStyle(node).backgroundColor);
      if (color[3] > 0) layers.push(color);
      if (color[3] >= 1) break;
    }
    return layers.reverse().reduce((under, layer) => over(layer, under), [255, 255, 255]);
  };
  const found = [];
  for (const element of document.querySelectorAll('main#isi *, footer.lp-foot *')) {
    if (![...element.childNodes].some(node => node.nodeType === 3 && node.textContent.trim())) continue;
    const style = getComputedStyle(element);
    if (!element.getClientRects().length || style.visibility === 'hidden' || element.closest('.visually-hidden')) continue;
    const back = background(element), text = over(rgba(style.color), back);
    const [high, low] = [luminance(text), luminance(back)].sort((a, b) => b - a);
    const ratio = (high + 0.05) / (low + 0.05), size = parseFloat(style.fontSize), weight = Number(style.fontWeight);
    const need = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
    if (ratio < need) found.push({ known: element.matches('.btn-primary'), text: `${element.tagName.toLowerCase()}.${[...element.classList].join('.')} "${element.textContent.trim().slice(0, 30)}" ${ratio.toFixed(2)}:1` });
  }
  return found;
};
/** While the top bar says the data stopped updating, the landing page shows no 24-hour counts and no "every 30 minutes". */
const staleLanding = () => {
  if (!document.querySelector('.fresh.stalled')) return null;
  const counts = document.querySelectorAll('.lp-stat-hotspots, .lp-stat-incidents').length;
  const status = document.querySelector('.lp-status')?.textContent ?? '';
  if (counts) return `${counts} 24-hour counts shown while the data is stale`;
  if (/30 (menit|minutes)/.test(status)) return `status line says "${status}" while the data is stale`;
  if (document.querySelector('.lp-numbers') && !document.querySelector('.lp-stalled')) return 'no stale-data line in the live numbers';
  return null;
};

/**
 * `forbid` matches requests neither the page nor its service worker may make; `firstVisit` also asks that no service
 * worker was installed (the landing page leaves that to the first app screen); `landing` adds its own checks.
 */
async function visit(ctx, label, path, wait = 3500, { forbid = null, firstVisit = false, landing = false } = {}) {
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') problems.push(`${label}: console ${m.text().slice(0, 180)}`); });
  page.on('pageerror', e => problems.push(`${label}: pageerror ${e.message.slice(0, 180)}`));
  page.on('response', r => { if (r.status() >= 400 && r.url().startsWith(base)) problems.push(`${label}: ${r.status()} ${r.url().slice(base.length)}`); });
  // On the context, so a service worker's requests count too (page.on('request') never sees them).
  const forbidden = r => { if (forbid.test(r.url())) problems.push(`${label}: ${r.serviceWorker() ? 'service worker' : 'page'} requested ${r.url().replace(base, '')}`); };
  if (forbid) ctx.on('request', forbidden);
  const response = await page.goto(`${base}${path}`).catch(error => { problems.push(`${label}: ${error.message}`); return null; });
  await page.waitForTimeout(wait);
  // Below the fold too: the landing page's screenshots load as they come into view.
  await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise(done => setTimeout(done, 80)); } }).catch(() => {});
  if (response && response.status() >= 400) problems.push(`${label}: page ${response.status()}`);
  const text = await page.evaluate(() => document.body.innerText).catch(() => '');
  if (/undefined|NaN|\{[a-z]+\}/.test(text)) problems.push(`${label}: suspicious text ${text.match(/.{0,30}(undefined|NaN|\{[a-z]+\}).{0,30}/)?.[0]}`);
  if (firstVisit && await page.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration())).catch(() => false)) problems.push(`${label}: a service worker was installed on a first visit`);
  if (landing) {
    for (const found of await page.evaluate(lowContrast)) {
      if (found.known) notes.add(`low contrast on the landing page, app-wide: ${found.text.replace(/ "[^"]*"/, '')}`);
      else problems.push(`${label}: low contrast ${found.text}`);
    }
    const stale = await page.evaluate(staleLanding);
    if (stale) problems.push(`${label}: ${stale}`);
  }
  if (shots) await page.screenshot({ path: `${shots}/${label.replace(/[^a-z0-9-]+/gi, '_')}.png` });
  if (forbid) ctx.off('request', forbidden);
  visited++;
  await page.close();
}

for (const lang of ['id', 'en']) {
  for (const device of ['desktop', 'phone']) {
    const tag = `${lang}-${device}`;
    const pub = await context(lang, device);
    // The landing page downloads neither the map screen nor MapLibre (pages/LazyMapScreen.tsx, map/LazyMapView.tsx),
    // and on a first visit installs no service worker, whose install would download them (swRoutes.ts).
    await visit(pub, `${tag}-beranda`, '/', 3000, { forbid: mapCode, firstVisit: true, landing: true });
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

/** Runs `steps(page, ctx)` in a fresh browser; it returns a problem, or null. */
async function check(label, steps, options = {}) {
  const ctx = await context('id', 'desktop', options);
  const page = await ctx.newPage();
  page.on('pageerror', e => problems.push(`${label}: pageerror ${e.message.slice(0, 180)}`));
  const problem = await steps(page, ctx).catch(error => error.message);
  if (problem) problems.push(`${label}: ${problem}`);
  visited++;
  await ctx.close();
}
/**
 * Opens `path` in a fresh browser and reports where it ends, who is signed in then and how many history entries the
 * visit added (1 when a redirect replaces the entry).
 */
const opens = (label, path, verdict) => check(label, async page => {
  const before = await page.evaluate(() => history.length);
  await page.goto(`${base}${path}`);
  await page.waitForTimeout(4000);
  return verdict(new URL(page.url()), await me(page), await page.evaluate(() => history.length) - before);
});

// An old map link: the map at /peta, the same day, no extra history entry.
await opens('lama-tanggal', '/?tanggal=2026-10-23', (url, _me, added) =>
  url.pathname !== '/peta' ? `ended on ${url.pathname}${url.search}` : added > 1 ? `${added} history entries` : null);
// ?lihat= opens that shared demo account on the page asked for, then leaves the address.
for (const [role, path] of [['mpa', '/tugas'], ['kades', '/desa-saya'], ['bpbd', '/dasbor']]) {
  await opens(`lihat-${role}`, `${path}?lihat=${role}`, (url, user) =>
    url.pathname !== path || url.searchParams.has('lihat') ? `ended on ${url.pathname}${url.search}`
      : user?.role !== role || !user?.demo ? `signed in as ${user ? `${user.role}${user.demo ? ' (demo)' : ''}` : 'nobody'}` : null);
}

// ?lihat= while the session check fails: the browser may hold a real account's cookie (here a real account kept from an
// earlier visit), which a demo sign-in would replace. Nothing is signed in; the parameter still goes.
for (const status of [500, 502, 429]) {
  await check(`lihat-cek-gagal-${status}`, async (page, ctx) => {
    const account = { id: '00000000-0000-4000-8000-000000000001', name: 'Petugas BPBD', email: 'petugas@bpbd.test', role: 'bpbd', organization: 'BPBD', demo: false };
    await ctx.addInitScript(user => { try { localStorage.setItem('titikapi.user', user); } catch { /* ignore */ } }, JSON.stringify(account));
    await ctx.route('**/api/v1/auth/me', route => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: { code: 'ERROR', message: 'gagal' } }) }));
    const demo = [];
    ctx.on('request', r => { if (r.url().includes('/api/v1/auth/demo')) demo.push(r.method()); });
    await page.goto(`${base}/dasbor?lihat=bpbd`);
    await page.waitForTimeout(3500);
    const url = new URL(page.url());
    return demo.length ? `POST /auth/demo sent (${demo.length}) after /auth/me answered ${status}`
      : url.searchParams.has('lihat') ? `?lihat= left in ${url.pathname}${url.search}` : null;
  }, { serviceWorkers: 'block' });
}

// Moving on while a ?lihat= sign-in is under way: the address stays where the visitor went. Coming back to the entry
// takes the parameter out then.
const slowDemo = async ctx => ctx.route('**/api/v1/auth/demo', async route => { await sleep(3500); await route.continue(); });
await check('lihat-pindah-tautan', async (page, ctx) => {
  await slowDemo(ctx);
  await page.goto(`${base}/dasbor?lihat=bpbd`);
  await page.getByText('Membuka akun demo BPBD/Daops').waitFor({ timeout: 3000 });
  await page.locator('.topnav').getByRole('link', { name: 'Tentang' }).click();
  await page.waitForTimeout(5000);
  let url = new URL(page.url());
  if (url.pathname !== '/tentang') return `after the sign-in returned: ${url.pathname}${url.search}, not /tentang`;
  await page.goBack();
  await page.waitForTimeout(2500);
  url = new URL(page.url());
  if (url.pathname !== '/dasbor' || url.searchParams.has('lihat')) return `back on the link's entry: ${url.pathname}${url.search}`;
  const user = await me(page);
  return user?.role === 'bpbd' && user.demo ? null : `signed in as ${user ? user.role : 'nobody'}`;
}, { serviceWorkers: 'block' });
await check('lihat-pindah-kembali', async (page, ctx) => {
  await slowDemo(ctx);
  await page.goto(`${base}/`);
  await page.waitForTimeout(1500);
  await page.getByRole('link', { name: 'Coba sebagai BPBD' }).first().click();
  await page.getByText('Membuka akun demo BPBD/Daops').waitFor({ timeout: 3000 });
  await page.goBack();
  await page.waitForTimeout(5000);
  const url = new URL(page.url());
  return url.pathname === '/' && !url.search ? null : `after Back and the sign-in: ${url.pathname}${url.search}, not /`;
}, { serviceWorkers: 'block' });

// An address the app does not know: said there, never rewritten.
await check('tidak-ada', async page => {
  await page.goto(`${base}/layar-baru?tanggal=2026-10-23`);
  await page.waitForTimeout(2500);
  const url = new URL(page.url());
  if (url.pathname !== '/layar-baru' || url.search !== '?tanggal=2026-10-23') return `rewritten to ${url.pathname}${url.search}`;
  const title = await page.locator('h1').first().textContent().catch(() => '');
  return title === 'Halaman tidak ditemukan' ? null : `h1 "${title}"`;
});

// The service worker: none on a first visit to the landing page, then the first app screen installs it with the map's
// code precached (MapLibre's worker script too), and the map screen opens without a signal and without the HTTP cache.
await check('service-worker', async (page, ctx) => {
  const requests = { landing: [], worker: 0 };
  let step = 'landing';
  ctx.on('request', r => {
    if (step === 'landing' && mapCode.test(r.url())) requests.landing.push(`${r.serviceWorker() ? 'service worker' : 'page'} ${r.url().replace(base, '')}`);
    if (step === 'map' && r.serviceWorker()) requests.worker++;
  });
  await page.goto(`${base}/`);
  await page.waitForTimeout(4000);
  if (requests.landing.length) return `the landing page fetched ${requests.landing.join(', ')}`;
  if (await page.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration()))) return 'a service worker was installed on the landing page';
  step = 'map';
  await page.getByRole('link', { name: 'Buka peta' }).first().click();
  await page.waitForURL(`${base}/peta`);
  const ready = await page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise(done => setTimeout(() => done(false), 30_000))]));
  if (!ready) return 'no service worker 30 s after opening the map';
  // The check sees the worker's own requests (its install), so a clean landing page above is not a blind spot.
  if (!requests.worker) return 'no request from the service worker was seen while it installed';
  const precached = await page.evaluate(async () => {
    const name = (await caches.keys()).find(key => key.startsWith('workbox-precache'));
    return name ? (await (await caches.open(name)).keys()).map(request => new URL(request.url).pathname) : [];
  });
  // MapLibre's worker script too: without it the map pane stays blank offline.
  for (const file of ['MapView-*.js', 'MapScreen-*.js', 'IncidentPanel-*.js', 'maplibre-gl-worker-*.mjs']) {
    const [start, end] = file.split('*');
    if (!precached.some(path => path.startsWith(`/assets/${start}`) && path.endsWith(end))) return `${file} not precached`;
  }
  await page.waitForTimeout(1500);
  // Without the browser's HTTP cache as well, which still holds what the visit above fetched (MapLibre's worker among
  // it) and which a phone low on storage drops first: the map screen must open from the precache alone.
  await (await ctx.newCDPSession(page)).send('Network.clearBrowserCache');
  const workerFailed = [];
  page.on('requestfailed', r => { if (/\/assets\/maplibre-gl-worker-/.test(r.url())) workerFailed.push(r.failure()?.errorText ?? 'failed'); });
  await ctx.setOffline(true);
  await page.goto(`${base}/peta`).catch(() => {});
  await page.waitForTimeout(4000);
  const offline = await page.evaluate(() => ({ screen: Boolean(document.querySelector('.mapscreen .sidebar')), failed: document.querySelector('.load-failed')?.textContent ?? '' }));
  await ctx.setOffline(false);
  if (workerFailed.length) return `MapLibre's worker did not load without a signal (${workerFailed[0]})`;
  return offline.screen && !/Halaman ini tidak bisa dimuat/.test(offline.failed) ? null : `the map screen without a signal: ${offline.failed || 'not there'}`;
});

// The installed app: the same identity as the installs made while the map was at / (manifest id), opening on /peta.
await check('manifest', async page => {
  await page.goto(`${base}/tentang`);
  const manifest = await page.evaluate(async () => (await fetch('/manifest.webmanifest')).json());
  if (manifest.id !== '/' || manifest.start_url !== '/peta') return `id ${manifest.id}, start_url ${manifest.start_url}`;
  const cdp = await page.context().newCDPSession(page);
  const { appId } = await cdp.send('Page.getAppId');
  return appId === `${base}/` ? null : `app id ${appId}`;
});

await browser.close();
console.log(`${visited} pages visited`);
if (notes.size) console.log(`NOTES (known, not counted)\n${[...notes].join('\n')}`);
console.log(problems.length ? `PROBLEMS (${problems.length})\n${[...new Set(problems)].join('\n')}` : 'no console errors, no failed requests, no placeholder text');
process.exitCode = problems.length ? 1 : 0;
