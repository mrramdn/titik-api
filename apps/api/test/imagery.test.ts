import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { createApp } from '../src/app.js';
import { migrate } from '../src/migrate.js';
import {
  addressKey, cleanAttribution, cycleStart, envInteger, FALLBACK_ATTRIBUTION, fromApp, imageryDefaults, networkKey, parseTile, privateCacheControl, tileBounds, type ImageryOptions,
} from '../src/imagery.js';
import { signIn, testPool } from './fixtures.js';

const pool = testPool();
let directory: string;
const KEY = 'AAPTxy-test-key/with+signs=0123456789';
const SECRETS = [KEY, encodeURIComponent(KEY), 'AAPTxy-test-key', 'ibasemaps', 'arcgis.com'];
const SERVICE = 'https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer';
const ORIGIN = 'https://titikapi.test';
const DEV = 'http://localhost:5173';
// Tiles over Ogan Komering Ilir (104.75, -3.0) at zoom 10, 11, 12 and 18, Palangka Raya at 14, Jakarta and Jambi
// (outside the two provinces) at 12. Paths are z/y/x.
const OKI = '12/2082/3239';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0xff, 0xd9]);

// The stand-in for Esri: what it answers for tiles and for the service metadata, and every URL it was asked for.
interface Answer { status?: number; type?: string | null; cacheControl?: string | null; body?: Uint8Array | string; headers?: Record<string, string>; fail?: 'network' | 'timeout' }
let answer: Answer = {};
let metadata: { status?: number; body: string } = { body: JSON.stringify({ currentVersion: 11.3, copyrightText: 'Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community' }) };
const calls: string[] = [];
const fakeEsri = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  calls.push(url);
  assert.ok(init?.signal instanceof AbortSignal, 'every request to Esri has a timeout');
  if (answer.fail === 'network') throw new TypeError(`fetch failed for ${url}`, { cause: new Error(`connect ECONNREFUSED ${url}`) });
  if (answer.fail === 'timeout') throw new DOMException(`The operation was aborted due to timeout (${url})`, 'TimeoutError');
  if (new URL(url).searchParams.get('f') === 'json') return new Response(metadata.body, { status: metadata.status ?? 200, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  const headers: Record<string, string> = { ...answer.headers };
  if (answer.type !== null) headers['content-type'] = answer.type ?? 'image/jpeg';
  if (answer.cacheControl !== null) headers['cache-control'] = answer.cacheControl ?? 'max-age=43200';
  return new Response(answer.body ?? JPEG, { status: answer.status ?? 200, headers });
}) as typeof fetch;
const tileCalls = () => calls.filter(url => url.includes('/tile/')).length;
const metadataCalls = () => calls.filter(url => url.includes('?f=json')).length;

const logs: string[] = [];
const logStream = { write: (line: string) => { logs.push(line); } };
const logged = (message: string) => logs.filter(line => (JSON.parse(line) as { msg?: string }).msg?.includes(message));

let clock = Date.parse('2026-11-14T10:00:00Z');
const open: FastifyInstance[] = [];
async function imageryApp(imagery: Partial<ImageryOptions> = {}) {
  const { app } = await createApp({ pool, uploadsDir: join(directory, 'uploads'), webDir: join(directory, 'web'), origins: [ORIGIN, DEV], logStream,
    imagery: { key: KEY, fetch: fakeEsri, now: () => clock, ...imagery } });
  open.push(app);
  return app;
}
async function close(app: FastifyInstance) {
  open.splice(open.indexOf(app), 1);
  await app.close();
}

const sameOrigin = { 'sec-fetch-site': 'same-origin' };
const tile = (app: FastifyInstance, path: string, headers: Record<string, string> = sameOrigin) => app.inject({ method: 'GET', url: `/api/v1/imagery/${path}`, headers });
const config = async (app: FastifyInstance) => (await app.inject({ method: 'GET', url: '/api/v1/config' })).json().data;
const usage = async () => Object.fromEntries((await pool.query(`SELECT to_char(day, 'YYYY-MM-DD') AS day, tiles FROM imagery_usage ORDER BY day`)).rows.map(row => [row.day, row.tiles]));
async function until(check: () => boolean | Promise<boolean>, what: string) {
  for (let k = 0; k < 200; k++) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail(`timed out waiting for ${what}`);
}
/** No body, nothing to keep, and nothing of Esri's answer. */
function empty(response: LightMyRequestResponse, status: number) {
  assert.equal(response.statusCode, status, response.body);
  assert.equal(response.body, '');
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['set-cookie'], undefined);
  noSecrets(response);
}
function noSecrets(response: LightMyRequestResponse) {
  const text = `${JSON.stringify(response.headers)}\n${response.body}`;
  for (const secret of SECRETS) assert.ok(!text.includes(secret), `the response holds ${secret}`);
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'titikapi-imagery-'));
  await migrate(pool);
});
after(async () => {
  for (const app of [...open]) await app.close();
  await pool.end();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('a tile is named z/y/x in Esri\'s order, and only whole tiles of zoom 11–18 over the two provinces exist', () => {
  assert.deepEqual(parseTile({ z: '12', y: '2082', x: '3239' }), { z: 12, y: 2082, x: 3239 });
  const [west, south, east, north] = tileBounds({ z: 12, y: 2082, x: 3239 });
  assert.ok(west <= 104.75 && east >= 104.75 && south <= -3 && north >= -3, 'the tile holds the point it was computed for');
  // Swapped, the row is near Antarctica and the column in Africa.
  assert.equal(parseTile({ z: '12', y: '3239', x: '2082' }), null);
  assert.deepEqual(parseTile({ z: '11', y: '1041', x: '1619' }), { z: 11, y: 1041, x: 1619 });
  assert.deepEqual(parseTile({ z: '18', y: '133257', x: '207348' }), { z: 18, y: 133257, x: 207348 });
  assert.deepEqual(parseTile({ z: '14', y: '8292', x: '13376' }), { z: 14, y: 8292, x: 13376 }, 'Palangka Raya');
  assert.equal(parseTile({ z: '10', y: '520', x: '809' }), null, 'zoom 10');
  assert.equal(parseTile({ z: '19', y: '266514', x: '414696' }), null, 'zoom 19');
  assert.equal(parseTile({ z: '12', y: '2118', x: '3263' }), null, 'Jakarta');
  assert.equal(parseTile({ z: '12', y: '2059', x: '3226' }), null, 'Jambi');
  for (const [y, x] of [['2082.5', '3239'], ['-1', '3239'], ['2082', 'abc'], ['2082', ''], ['2082', '0x10'], ['2082', '1e3'], ['2082', '4096'], ['4096', '3239']]) {
    assert.equal(parseTile({ z: '12', y, x }), null, `${y}/${x}`);
  }
  assert.equal(parseTile({ z: '12', y: 2082, x: 3239 }), null, 'only the strings of a path');
  assert.equal(parseTile(null), null);
});

test('only pages of this app may ask: Sec-Fetch-Site same-origin, else an allowed Origin or Referer', () => {
  const origins = [ORIGIN, `${DEV}/`];
  assert.equal(fromApp({ 'sec-fetch-site': 'same-origin' }, origins), true);
  for (const site of ['cross-site', 'same-site', 'none', 'same-origin, cross-site']) {
    assert.equal(fromApp({ 'sec-fetch-site': site, referer: `${ORIGIN}/peta` }, origins), false, `${site} wins over the referrer`);
  }
  assert.equal(fromApp({ referer: `${ORIGIN}/peta?z=12` }, origins), true);
  assert.equal(fromApp({ referer: `${ORIGIN}/` }, origins), true);
  assert.equal(fromApp({ origin: DEV }, origins), true, 'a configured origin with a trailing slash');
  assert.equal(fromApp({ origin: ORIGIN, referer: 'https://elsewhere.test/' }, origins), true);
  assert.equal(fromApp({ origin: 'https://elsewhere.test', referer: `${ORIGIN}/peta` }, origins), false, 'the Origin decides when there is one');
  assert.equal(fromApp({}, origins), false);
  for (const referer of [`${ORIGIN}.elsewhere.test/peta`, `${ORIGIN}:8443/peta`, `https://elsewhere.test/?r=${ORIGIN}/`, 'null']) {
    assert.equal(fromApp({ referer }, origins), false, referer);
  }
  assert.equal(fromApp({ origin: 'null' }, origins), false);
});

test('Cache-Control is private for as long as Esri allows, a day at most, and no-store without a lifetime', () => {
  assert.equal(privateCacheControl('max-age=43200'), 'private, max-age=43200');
  assert.equal(privateCacheControl('public, max-age=604800'), 'private, max-age=86400');
  assert.equal(privateCacheControl('Public, Max-Age=86400, must-revalidate'), 'private, max-age=86400');
  assert.equal(privateCacheControl('max-age="600"'), 'private, max-age=600');
  for (const upstream of [null, '', 'public', 'private', 's-maxage=3600', 'max-age=0', 'no-store', 'no-cache', 'max-age=3600, no-cache', 'no-cache="set-cookie", max-age=60', 'max-age=-5', 'max-age=soon']) {
    assert.equal(privateCacheControl(upstream), 'no-store', String(upstream));
  }
});

test('a billing cycle starts on the cycle day, or on the last day of a shorter month', () => {
  assert.equal(cycleStart('2026-11-14', 15), '2026-10-15');
  assert.equal(cycleStart('2026-11-15', 15), '2026-11-15');
  assert.equal(cycleStart('2026-11-01', 1), '2026-11-01');
  assert.equal(cycleStart('2026-01-09', 10), '2025-12-10');
  assert.equal(cycleStart('2026-03-15', 31), '2026-02-28');
  assert.equal(cycleStart('2026-02-28', 31), '2026-02-28');
  assert.equal(cycleStart('2028-02-28', 30), '2028-01-30');
  assert.equal(cycleStart('2028-02-29', 30), '2028-02-29');
  assert.equal(cycleStart('2026-03-31', 31), '2026-03-31');
});

test('caps and the cycle day come from the environment, with defaults; Esri\'s copyrightText becomes plain text', () => {
  assert.deepEqual(pickCaps(imageryDefaults({})), { key: undefined, monthlyCap: 1_000_000, dailyCap: 33_000, addressDailyCap: 5_000, cycleDay: 1, flushMs: 30_000 });
  assert.deepEqual(pickCaps(imageryDefaults({ ARCGIS_API_KEY: 'k', ARCGIS_MONTHLY_TILE_CAP: '500000', ARCGIS_DAILY_TILE_CAP: '0', ARCGIS_ADDRESS_DAILY_TILE_CAP: '1200', ARCGIS_CYCLE_DAY: '23' })),
    { key: 'k', monthlyCap: 500_000, dailyCap: 0, addressDailyCap: 1200, cycleDay: 23, flushMs: 30_000 });
  assert.deepEqual(pickCaps(imageryDefaults({ ARCGIS_API_KEY: '', ARCGIS_MONTHLY_TILE_CAP: 'lots', ARCGIS_DAILY_TILE_CAP: '-1', ARCGIS_ADDRESS_DAILY_TILE_CAP: 'many', ARCGIS_CYCLE_DAY: '32' })),
    { key: undefined, monthlyCap: 1_000_000, dailyCap: 33_000, addressDailyCap: 5_000, cycleDay: 1, flushMs: 30_000 });
  assert.equal(imageryDefaults({}).reserveAddressCap, 300);
  assert.equal(envInteger(' 12 ', 1, 1, 31), 12);
  assert.equal(envInteger('2.5', 1, 1, 31), 1);
  assert.equal(cleanAttribution('Source: Esri, Vantor,\n  Earthstar Geographics, and the GIS User Community'), 'Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community');
  assert.equal(cleanAttribution('Esri <img src=x onerror=alert(1)>Vantor‮'), 'Esri Vantor');
  for (const value of ['', '   ', '<b></b>', 'x'.repeat(301), 42, null, undefined, { text: 'Esri' }]) assert.equal(cleanAttribution(value), null, String(value));
});
const pickCaps = ({ key, monthlyCap, dailyCap, addressDailyCap, cycleDay, flushMs }: ImageryOptions) => ({ key, monthlyCap, dailyCap, addressDailyCap, cycleDay, flushMs });

test('a share is counted per IPv4 address and per IPv6 /64, which one client can fill with addresses', () => {
  assert.equal(addressKey('203.0.113.9'), '203.0.113.9');
  assert.equal(addressKey('::ffff:203.0.113.9'), '203.0.113.9', 'IPv4 on a dual-stack socket');
  for (const ip of ['2001:db8:85a3:1::1', '2001:0db8:85a3:0001:ffff:0:0:2', '2001:DB8:85A3:1:abcd::', '2001:db8:85a3:1::1%eth0']) {
    assert.equal(addressKey(ip), '2001:db8:85a3:1::/64', ip);
  }
  assert.equal(addressKey('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(addressKey('2001:db8:85a3:2::1'), '2001:db8:85a3:2::/64');
  assert.equal(addressKey('64:ff9b::192.0.2.33'), '64:ff9b:0:0::/64', 'an IPv4 tail counts as two groups');
  assert.equal(addressKey('::1'), '0:0:0:0::/64');
  // In the reserve an IPv6 client also counts by its /56: 256 /64s, what one customer often gets.
  assert.equal(networkKey('2001:db8:85a3:1ff::1'), '2001:db8:85a3:100::/56');
  assert.equal(networkKey('2001:db8:85a3:ff:ffff::1'), '2001:db8:85a3:0::/56');
  assert.equal(networkKey('2001:DB8:85A3:ABCD::1%eth0'), '2001:db8:85a3:ab00::/56');
  assert.equal(networkKey('2001:db8::1'), '2001:db8:0:0::/56');
  assert.equal(networkKey('203.0.113.9'), null);
  assert.equal(networkKey('::ffff:203.0.113.9'), null);
  // A request whose client has gone has no address; its key must not throw in the rate limit.
  assert.deepEqual([addressKey(undefined), networkKey(undefined)], ['', null]);
});

test('a tile goes to Esri as z/y/x with the key and comes back as its bytes and type, private, without a cookie', async () => {
  await pool.query('DELETE FROM imagery_usage');
  const app = await imageryApp();
  answer = { type: 'image/jpeg', cacheControl: 'public, max-age=604800', headers: { 'x-esri-trace': 'trace-1', 'set-cookie': 'AGS=1' } };
  calls.length = 0;
  const session = await signIn(pool, 'mpa');
  const response = await tile(app, OKI, { ...sameOrigin, cookie: `titikapi_session=${session}` });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(new Uint8Array(response.rawPayload), JPEG);
  assert.equal(response.headers['content-type'], 'image/jpeg');
  assert.equal(response.headers['cache-control'], 'private, max-age=86400');
  assert.equal(response.headers['set-cookie'], undefined, 'no cookie, though the session would be renewed elsewhere');
  assert.equal(response.headers['x-esri-trace'], undefined, 'no header of Esri\'s');
  assert.equal(response.headers['x-ratelimit-limit'], '600', 'its own limit per address');
  noSecrets(response);
  assert.deepEqual(calls, [`${SERVICE}/tile/12/2082/3239?token=${encodeURIComponent(KEY)}`]);
  // The same session on another route is renewed with a cookie, so the check above means something.
  const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: `titikapi_session=${session}` } });
  assert.ok(me.headers['set-cookie'], 'the session renews on other routes');

  answer = { type: 'Image/PNG; charset=binary', cacheControl: null };
  const png = await tile(app, '14/8292/13376');
  assert.equal(png.statusCode, 200);
  assert.equal(png.headers['content-type'], 'image/png');
  assert.equal(png.headers['cache-control'], 'no-store', 'no lifetime from Esri, nothing kept');
  assert.equal(calls[1], `${SERVICE}/tile/14/8292/13376?token=${encodeURIComponent(KEY)}`);
  // Two visitors asking for the same tile cost two requests: one answer serves one visitor.
  answer = {};
  await Promise.all([tile(app, OKI), tile(app, OKI)]);
  assert.equal(tileCalls(), 4);
  const head = await app.inject({ method: 'HEAD', url: `/api/v1/imagery/${OKI}`, headers: sameOrigin });
  assert.equal(head.statusCode, 404);
  assert.equal(tileCalls(), 4, 'a HEAD request costs nothing');
  await close(app);
  assert.deepEqual(await usage(), { '2026-11-14': 4 });
});

test('another site, a typed address and a request without an origin get 403, and Esri is not asked', async () => {
  const app = await imageryApp();
  answer = {};
  calls.length = 0;
  const refused: Record<string, string>[] = [
    { 'sec-fetch-site': 'cross-site', referer: 'https://elsewhere.test/map' },
    { 'sec-fetch-site': 'same-site' },
    { 'sec-fetch-site': 'none' },
    { 'sec-fetch-site': 'cross-site', referer: `${ORIGIN}/peta` },
    {},
    { referer: `${ORIGIN}.elsewhere.test/` },
    { referer: 'https://elsewhere.test/' },
  ];
  for (const headers of refused) empty(await tile(app, OKI, headers), 403);
  assert.equal(calls.length, 0);
  assert.equal((await tile(app, OKI, { referer: `${ORIGIN}/peta` })).statusCode, 200, 'a browser without Sec-Fetch-Site, from our page');
  assert.equal((await tile(app, OKI, { referer: `${DEV}/peta`, origin: DEV })).statusCode, 200);
  assert.equal(calls.length, 2);
  await close(app);
});

test('tiles outside zoom 11–18 or the two provinces are 404 with no body, and Esri is not asked', async () => {
  const app = await imageryApp();
  answer = {};
  calls.length = 0;
  for (const path of ['10/520/809', '19/266514/414696', '12/2118/3263', '12/2059/3226', '12/3239/2082', '12/2082.5/3239', '12/abc/3239', '12/2082/4096', '012/-1/3239']) {
    empty(await tile(app, path), 404);
  }
  assert.equal(calls.length, 0);
  assert.equal((await tile(app, '11/1041/1619')).statusCode, 200);
  assert.equal((await tile(app, '18/133257/207348')).statusCode, 200);
  await close(app);
});

test('only an image with HTTP 200 is passed on; anything else is 502 with no body and one log line without the key', async () => {
  const app = await imageryApp();
  calls.length = 0;
  const failures: [string, Answer][] = [
    // ibasemaps answers a bad key with HTTP 200 and a text body.
    ['type', { status: 200, type: 'text/plain;charset=utf-8', body: `{"error":{"code":498,"message":"Invalid token ${KEY}","details":["${SERVICE}/tile/12/2082/3239?token=${KEY}"]}}` }],
    ['type', { status: 200, type: 'application/json', body: '{"error":{"code":403}}' }],
    ['type', { status: 200, type: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' }],
    ['type', { status: 200, type: 'image/jpeg<script>' }],
    ['type', { status: 200, type: null }],
    ['status', { status: 404, type: 'image/jpeg' }],
    ['status', { status: 500, type: 'text/html', body: `<p>Error at ${SERVICE}/tile?token=${KEY}</p>`, headers: { 'x-upstream-url': `${SERVICE}?token=${encodeURIComponent(KEY)}` } }],
    ['status', { status: 302, type: 'text/html', headers: { location: `${SERVICE}/elsewhere?token=${encodeURIComponent(KEY)}` } }],
    ['size', { status: 200, type: 'image/jpeg', body: new Uint8Array(2 * 1024 * 1024 + 1) }],
    ['network', { fail: 'network' }],
    ['timeout', { fail: 'timeout' }],
  ];
  for (const [reason, failure] of failures) {
    answer = failure;
    const before = logged('Esri imagery tile failed').length;
    const response = await tile(app, OKI);
    empty(response, 502);
    assert.equal(response.headers['x-upstream-url'], undefined);
    assert.equal(response.headers.location, undefined);
    const lines = logged('Esri imagery tile failed').slice(before);
    assert.equal(lines.length, 1, `one log line for ${reason}`);
    const line = JSON.parse(lines[0]!);
    assert.deepEqual([line.reason, line.z, line.y, line.x], [reason, 12, 2082, 3239]);
    assert.equal(line.status, failure.fail ? null : failure.status);
    assert.equal(line.err, undefined, 'no error object in the log');
  }
  assert.equal(tileCalls(), failures.length, 'every request to Esri counts, failed or not');
  for (const line of logs) for (const secret of SECRETS) assert.ok(!line.includes(secret), `a log line holds ${secret}: ${line}`);
  await close(app);
});

test('without a key the tile route is 404 and GET /config says no HD imagery', async () => {
  for (const key of [undefined, '']) {
    const app = await imageryApp({ key });
    calls.length = 0;
    empty(await tile(app, OKI), 404);
    assert.deepEqual(await config(app), { hdImagery: false, imageryAttribution: null });
    assert.equal(calls.length, 0);
    await close(app);
  }
});

test('GET /config: HD imagery with Esri\'s attribution, looked up at most once a day and counted like a tile', async () => {
  await pool.query('DELETE FROM imagery_usage');
  clock = Date.parse('2026-11-14T10:00:00Z');
  answer = {};
  calls.length = 0;
  metadata = { body: JSON.stringify({ copyrightText: 'Source: Esri, Vantor, Earthstar\n Geographics, and the GIS User Community' }) };
  const app = await imageryApp();
  const first = await config(app);
  assert.equal(first.hdImagery, true);
  assert.equal(typeof first.imageryAttribution, 'string', 'the published text until the lookup answers');
  assert.equal(Object.keys(first).sort().join(), 'hdImagery,imageryAttribution');
  await until(async () => (await config(app)).imageryAttribution !== FALLBACK_ATTRIBUTION, 'the attribution lookup');
  assert.deepEqual(await config(app), { hdImagery: true, imageryAttribution: 'Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community' });
  assert.deepEqual(calls, [`${SERVICE}?f=json&token=${encodeURIComponent(KEY)}`]);
  clock += 23 * 3_600_000;
  await config(app);
  assert.equal(metadataCalls(), 1, 'not again within 24 hours');
  // A failed lookup keeps the text it has, and its log line holds nothing of Esri's answer.
  metadata = { body: JSON.stringify({ error: { code: 498, message: `Invalid token ${KEY}` } }) };
  clock += 3_600_000;
  const failed = logged('Esri imagery attribution not updated').length;
  await config(app);
  await until(() => logged('Esri imagery attribution not updated').length === failed + 1, 'the failed lookup');
  assert.equal(metadataCalls(), 2);
  assert.equal((await config(app)).imageryAttribution, 'Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community');
  for (const line of logs) for (const secret of SECRETS) assert.ok(!line.includes(secret), `a log line holds ${secret}`);
  await close(app);
  assert.deepEqual(await usage(), { '2026-11-14': 1, '2026-11-15': 1 }, 'each lookup counted on its day');
  metadata = { body: JSON.stringify({ copyrightText: 'Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community' }) };
});

test('at the daily cap tiles are 503 before Esri is asked, logged once, and GET /config turns HD imagery off until the next day', async () => {
  await pool.query('DELETE FROM imagery_usage');
  clock = Date.parse('2026-11-14T10:00:00Z');
  const app = await imageryApp({ dailyCap: 3, monthlyCap: 1000 });
  answer = {};
  calls.length = 0;
  const dailyBefore = logged('the daily cap is reached').length;
  for (let k = 0; k < 3; k++) assert.equal((await tile(app, OKI)).statusCode, 200);
  empty(await tile(app, OKI), 503);
  empty(await tile(app, OKI), 503);
  assert.equal(tileCalls(), 3);
  assert.equal(logged('the daily cap is reached').length, dailyBefore + 1, 'logged once a day');
  assert.deepEqual(await config(app), { hdImagery: false, imageryAttribution: null });
  assert.equal(metadataCalls(), 0, 'no attribution lookup over the cap');
  clock = Date.parse('2026-11-15T00:00:05Z');
  assert.equal((await tile(app, OKI)).statusCode, 200, 'a new UTC day');
  assert.equal((await config(app)).hdImagery, true);
  await close(app);
  const counted = await usage();
  assert.equal(counted['2026-11-14'], 3);
  assert.ok(counted['2026-11-15'] === 1 || counted['2026-11-15'] === 2, 'the tile, and the attribution lookup if it ran');
});

test('the monthly cap counts the billing cycle from imagery_usage, and a new cycle starts on the cycle day', async () => {
  await pool.query('DELETE FROM imagery_usage');
  await pool.query(`INSERT INTO imagery_usage (day, tiles) VALUES ('2026-10-14', 50), ('2026-10-15', 3), ('2026-11-01', 4)`);
  clock = Date.parse('2026-11-14T23:59:00Z');
  const app = await imageryApp({ dailyCap: 1000, monthlyCap: 8, cycleDay: 15 });
  answer = {};
  calls.length = 0;
  const monthlyBefore = logged('the monthly cap is reached').length;
  // 3 + 4 since 15 October; the 50 of 14 October belong to the cycle before.
  assert.equal((await tile(app, OKI)).statusCode, 200);
  empty(await tile(app, OKI), 503);
  assert.equal(tileCalls(), 1);
  assert.equal(logged('the monthly cap is reached').length, monthlyBefore + 1);
  assert.equal((await config(app)).hdImagery, false);
  clock = Date.parse('2026-11-15T00:00:30Z');
  assert.equal((await tile(app, OKI)).statusCode, 200, 'the cycle started again on the 15th');
  assert.equal((await config(app)).hdImagery, true);
  await close(app);
  const counted = await usage();
  assert.equal(counted['2026-11-14'], 1);
  assert.equal(counted['2026-10-15'], 3);
});

test('one address takes at most its share of a day: 429 before Esri is asked, logged once, and the next day it starts again', async () => {
  await pool.query('DELETE FROM imagery_usage');
  clock = Date.parse('2026-11-16T10:00:00Z');
  const app = await imageryApp({ dailyCap: 100, addressDailyCap: 2 });
  answer = {};
  calls.length = 0;
  const from = (remoteAddress: string) => app.inject({ method: 'GET', url: `/api/v1/imagery/${OKI}`, headers: sameOrigin, remoteAddress });
  const warnings = () => logged('its daily share is used').length;
  const before = warnings();
  assert.equal((await from('203.0.113.9')).statusCode, 200);
  assert.equal((await from('203.0.113.9')).statusCode, 200);
  const refused = await from('203.0.113.9');
  empty(refused, 429);
  assert.equal(refused.headers['retry-after'], String(14 * 3600), 'until the next UTC day');
  empty(await from('203.0.113.9'), 429);
  assert.equal(warnings(), before + 1, 'logged once a day');
  const warning = logged('its daily share is used').at(-1)!;
  assert.deepEqual([JSON.parse(warning).address, JSON.parse(warning).addressDailyCap], [undefined, 2], 'with the cap, without the address');
  assert.ok(!warning.includes('203.0.113.9'), warning);
  assert.equal(tileCalls(), 2, 'Esri is not asked past the share');
  assert.equal((await from('198.51.100.7')).statusCode, 200, 'another address has a share of its own');
  // An IPv6 client gets one share for its /64.
  assert.equal((await from('2001:db8:85a3:1::1')).statusCode, 200);
  assert.equal((await from('2001:db8:85a3:1:ffff::2')).statusCode, 200);
  empty(await from('2001:db8:85a3:1::abcd'), 429);
  assert.equal((await from('2001:db8:85a3:2::1')).statusCode, 200, 'another /64');
  clock = Date.parse('2026-11-17T00:00:01Z');
  assert.equal((await from('203.0.113.9')).statusCode, 200, 'a new UTC day');
  await close(app);
  assert.deepEqual(await usage(), { '2026-11-16': 6, '2026-11-17': 1 }, 'a refused request costs nothing');
});

test('the last quarter of the day is kept for light users: from 75% on, an address with its 300 tiles today waits, an IPv6 client also by its /56', async () => {
  await pool.query('DELETE FROM imagery_usage');
  clock = Date.parse('2026-11-22T10:00:00Z');
  const app = await imageryApp({ dailyCap: 20, addressDailyCap: 100, reserveAddressCap: 3 });
  answer = {};
  calls.length = 0;
  const from = (remoteAddress: string) => app.inject({ method: 'GET', url: `/api/v1/imagery/${OKI}`, headers: sameOrigin, remoteAddress });
  const warnings = () => logged('75% of the daily cap');
  const before = warnings().length;
  // Before the reserve the /64s of one /56 take tiles as usual, and they count for their /56 too.
  for (const ip of ['2001:db8:abcd:ab01::1', '2001:db8:abcd:ab02::1']) assert.equal((await from(ip)).statusCode, 200, ip);
  // One heavy address takes the day to 75%: 15 of 20.
  for (let k = 0; k < 13; k++) assert.equal((await from('203.0.113.50')).statusCode, 200);
  assert.equal(warnings().length, before + 1, 'logged once');
  assert.equal(JSON.parse(warnings().at(-1)!).address, undefined, 'without an address');
  const heavy = await from('203.0.113.50');
  empty(heavy, 429);
  assert.equal(heavy.headers['retry-after'], String(14 * 3600), 'until the next UTC day');
  // A light address takes its part, then waits too.
  for (let k = 0; k < 3; k++) assert.equal((await from('198.51.100.20')).statusCode, 200);
  empty(await from('198.51.100.20'), 429);
  // The /56 had taken two: one more from a /64 of its own, then even a fresh /64 inside it waits.
  assert.equal((await from('2001:db8:abcd:ab03::1')).statusCode, 200);
  empty(await from('2001:db8:abcd:abff::1'), 429);
  assert.equal((await from('2001:db8:abcd:ac00::1')).statusCode, 200, 'another /56 is a light user of its own');
  assert.equal(tileCalls(), 20, 'Esri is not asked for a refused tile');
  empty(await from('192.0.2.1'), 503);
  assert.equal(warnings().length, before + 1);
  clock = Date.parse('2026-11-23T00:00:05Z');
  assert.equal((await from('203.0.113.50')).statusCode, 200, 'a new UTC day');
  await close(app);
  assert.deepEqual(await usage(), { '2026-11-22': 20, '2026-11-23': 1 });
});

test('a tile the caps stop does not use up the share of its address', async () => {
  await pool.query('DELETE FROM imagery_usage');
  clock = Date.parse('2026-11-18T10:00:00Z');
  const app = await imageryApp({ dailyCap: 2, addressDailyCap: 2 });
  answer = {};
  const from = (remoteAddress: string) => app.inject({ method: 'GET', url: `/api/v1/imagery/${OKI}`, headers: sameOrigin, remoteAddress });
  const shareWarnings = logged('its daily share is used').length;
  assert.equal((await from('203.0.113.9')).statusCode, 200);
  assert.equal((await from('198.51.100.7')).statusCode, 200);
  for (let k = 0; k < 3; k++) empty(await from('198.51.100.7'), 503);
  assert.equal(logged('its daily share is used').length, shareWarnings, 'the cap answered, not the share');
  await close(app);
});

test('the log warns once at 75% of the monthly cap', async () => {
  await pool.query('DELETE FROM imagery_usage');
  clock = Date.parse('2026-11-20T08:00:00Z');
  const app = await imageryApp({ dailyCap: 1000, monthlyCap: 8 });
  answer = {};
  const warnings = () => logged('75% of the monthly cap').length;
  const before = warnings();
  for (let k = 0; k < 5; k++) await tile(app, OKI);
  assert.equal(warnings(), before);
  await tile(app, OKI);
  assert.equal(warnings(), before + 1, 'the sixth of eight');
  await tile(app, OKI);
  await tile(app, OKI);
  assert.equal(warnings(), before + 1);
  await close(app);
});

test('the count is written to imagery_usage every flush interval and when the server closes', async () => {
  await pool.query('DELETE FROM imagery_usage');
  clock = Date.parse('2026-11-21T08:00:00Z');
  const app = await imageryApp({ flushMs: 20 });
  answer = {};
  await tile(app, OKI);
  await tile(app, OKI);
  await until(async () => (await usage())['2026-11-21'] === 2, 'the periodic write');
  await tile(app, OKI);
  await close(app);
  assert.deepEqual(await usage(), { '2026-11-21': 3 });
  // A new process starts from what the table holds.
  const next = await imageryApp({ dailyCap: 4 });
  assert.equal((await tile(next, OKI)).statusCode, 200);
  empty(await tile(next, OKI), 503);
  await close(next);
  assert.deepEqual(await usage(), { '2026-11-21': 4 });
});
