import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app.js';
import { addDays } from '../src/geo.js';
import { utcDay } from '../src/imagery.js';
import { clearWindCache, ExpiringMap, inSector, MAX_WINDS, windDefaults, type WindOptions } from '../src/wind.js';
import { emptyDatabase, insertIncident, testPool } from './fixtures.js';

const pool = testPool();
let app: FastifyInstance;
let directory: string;
const HOUR = 3_600_000;
// The answer the stand-in for Open-Meteo gives (a speed, or one for each hour asked), the URLs it was asked, and whether
// it hangs or how it fails.
let answer: { speed: number | ((time: string) => number); from: number } = { speed: 12, from: 170 };
let mode: 'ok' | 'hang' | 'error' | 'slow' | '429' | 'network' | 'timeout' | 'body' = 'ok';
const urls: string[] = [];
const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  urls.push(url.toString());
  if (mode === 'hang') {
    return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
  }
  if (mode === 'error') return new Response('down', { status: 500 });
  if (mode === '429') return new Response('{"error":true,"reason":"Too many requests"}', { status: 429 });
  if (mode === 'network') throw new TypeError('fetch failed');
  if (mode === 'timeout') throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  if (mode === 'slow') await new Promise(resolve => setTimeout(resolve, 1800));
  const hour = url.searchParams.get('start_hour');
  const time = hour ? [hour] : Array.from({ length: 24 }, (_, k) => `${url.searchParams.get('start_date')}T${String(k).padStart(2, '0')}:00`);
  // An unusable body: the hours without values.
  const speed = (stamp: string) => (mode === 'body' ? null : typeof answer.speed === 'function' ? answer.speed(stamp) : answer.speed);
  return new Response(JSON.stringify({ hourly: { time, wind_speed_10m: time.map(speed), wind_direction_10m: time.map(() => (mode === 'body' ? null : answer.from)) } }),
    { headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

let place: { lon: number; lat: number; villageId: string };
const ids: Record<string, string> = {};
/** Live incidents, each in a 0.1° cell of its own. */
const cells: string[] = [];
const windOf = async (target: FastifyInstance, id: string, remoteAddress = '127.0.0.1') => {
  const response = await target.inject({ method: 'GET', url: `/api/v1/incidents/${id}/wind`, remoteAddress });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().data;
};
const wind = (id: string) => windOf(app, id);
/** Another app with its own route limit and wind budget or clock. */
const opened: FastifyInstance[] = [];
async function windApp(options: Partial<Omit<WindOptions, 'fetch'>> = {}) {
  const created = (await createApp({ pool, uploadsDir: join(directory, 'uploads'), webDir: join(directory, 'web'), logger: false, weatherFetch: fakeFetch, wind: options })).app;
  opened.push(created);
  return created;
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'titikapi-wind-'));
  await emptyDatabase(pool);
  // A small village in a dense area: the centre of its polygon, with neighbours all around within 5 km.
  const row = (await pool.query(`SELECT id, ST_X(ST_PointOnSurface(geom)) AS lon, ST_Y(ST_PointOnSurface(geom)) AS lat FROM villages ORDER BY area_ha LIMIT 1 OFFSET 40`)).rows[0];
  place = { lon: row.lon, lat: row.lat, villageId: row.id };
  const now = Date.now();
  for (const [name, hoursAgo] of [['recent', 2], ['older', 72], ['oldest', 100 * 24]] as const) {
    const time = new Date(now - hoursAgo * HOUR);
    ids[name] = await insertIncident(pool, { villageId: place.villageId, first: time, last: time, ...place });
  }
  for (let k = 1; k <= 6; k++) {
    const time = new Date(now - 2 * HOUR);
    cells.push(await insertIncident(pool, { villageId: place.villageId, first: time, last: time, lon: place.lon + 0.2 * k, lat: place.lat }));
  }
  app = (await createApp({ pool, uploadsDir: join(directory, 'uploads'), webDir: join(directory, 'web'), logger: false, weatherFetch: fakeFetch })).app;
});
after(async () => {
  for (const created of [app, ...opened]) if (created) await created.close();
  await pool.end();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('the smoke sector wraps around north: toward 350°, a village at 10° is in and one at 300° is out', () => {
  assert.equal(inSector(10, 350), true);
  assert.equal(inSector(300, 350), false);
  assert.equal(inSector(320, 350), true, 'the edge counts');
  assert.equal(inSector(319, 350), false);
  assert.equal(inSector(20, 350), true);
  assert.equal(inSector(21, 350), false);
  assert.equal(inSector(359, 10), true);
  assert.equal(inSector(180, 0), false);
});

test('wind now: speed, where it comes from and goes, and up to five other villages in the 60° sector, nearest first', async () => {
  const neighbours = (await pool.query(`SELECT v.id, v.name, ST_Distance(p.g::geography, v.geom::geography) AS m, degrees(ST_Azimuth(p.g::geography, v.center::geography)) AS az
    FROM (SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326) AS g) p JOIN villages v ON ST_DWithin(v.geom::geography, p.g::geography, 5000) WHERE v.id <> $3`,
  [place.lon, place.lat, place.villageId])).rows;
  assert.ok(neighbours.length >= 6, `${neighbours.length} villages within 5 km`);
  let found = 0;
  for (const from of [170, 0, 90, 250]) {
    clearWindCache();
    answer = { speed: 12.34, from };
    const data = await wind(ids.recent!);
    const toward = (from + 180) % 360;
    assert.deepEqual([data.mode, data.speedKmh, data.fromDeg, data.towardDeg, data.calm], ['now', 12.3, from, toward, false]);
    assert.equal(data.at, new Date(Math.floor(Date.now() / HOUR) * HOUR).toISOString(), 'the current hour');
    const expected = neighbours.filter(n => Math.abs(((n.az - toward + 540) % 360) - 180) <= 30).sort((a, b) => a.m - b.m).slice(0, 5)
      .map(n => ({ id: n.id, name: n.name, distanceM: Math.round(n.m), bearingDeg: Math.round(n.az) % 360 }));
    assert.deepEqual(data.villages, expected, `from ${from}`);
    found += data.villages.length;
    assert.ok(data.villages.every((v: any) => v.id !== place.villageId && v.distanceM <= 5000));
  }
  assert.ok(found >= 2, `villages found in the four sectors: ${found}`);
});

test('calm air leaves the villages out; an older incident takes the wind at the hour of its last detection', async () => {
  clearWindCache();
  answer = { speed: 3, from: 45 };
  const calm = await wind(ids.recent!);
  assert.deepEqual([calm.calm, calm.villages], [true, []]);
  urls.length = 0;
  answer = { speed: 9, from: 200 };
  const older = await wind(ids.older!);
  const last = (await pool.query('SELECT last_detected_at FROM incidents WHERE id = $1', [ids.older])).rows[0].last_detected_at as Date;
  const hour = new Date(Math.floor(last.getTime() / HOUR) * HOUR).toISOString();
  assert.deepEqual([older.mode, older.at], ['detected', hour]);
  assert.match(urls[0]!, /api\.open-meteo\.com\/v1\/forecast/);
  const asked = new URL(urls[0]!).searchParams;
  assert.deepEqual([asked.get('start_date'), asked.get('end_date'), asked.get('start_hour')], [hour.slice(0, 10), hour.slice(0, 10), null], 'its whole UTC day');
  assert.equal(asked.get('latitude'), place.lat.toFixed(1), 'the 0.1° cell');
  await wind(ids.oldest!);
  assert.match(urls[1]!, /archive-api\.open-meteo\.com\/v1\/archive\?.*start_date=/, 'beyond the Forecast API: the archive');
  // One request per cell and day.
  await wind(ids.older!);
  assert.equal(urls.length, 2);
});

test('no answer within 1.5 s or an error leaves the wind out instead of failing; a late answer serves the next request', async () => {
  clearWindCache();
  mode = 'hang';
  const started = Date.now();
  assert.equal(await wind(ids.recent!), null);
  const waited = Date.now() - started;
  assert.ok(waited >= 1400 && waited < 4000, `${waited} ms`);
  clearWindCache();
  mode = 'error';
  const failing = Date.now();
  assert.equal(await wind(ids.recent!), null);
  assert.ok(Date.now() - failing < 1000, 'an error answers at once');
  // A slow first answer (a cold connection): left out at 1.5 s, then kept, so the next request has it without asking again.
  clearWindCache();
  mode = 'slow';
  answer = { speed: 7, from: 120 };
  urls.length = 0;
  assert.equal(await wind(ids.recent!), null);
  await new Promise(resolve => setTimeout(resolve, 600));
  mode = 'ok';
  const kept = await wind(ids.recent!);
  assert.deepEqual([kept?.speedKmh, kept?.fromDeg, urls.length], [7, 120, 1]);
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/incidents/00000000-0000-4000-8000-000000000000/wind' })).statusCode, 404);
});

test('the wind route has its own limit of 30 a minute per address, an IPv6 client counted by its /64', async () => {
  const limited = await windApp();
  clearWindCache();
  mode = 'ok';
  answer = { speed: 12, from: 170 };
  urls.length = 0;
  const ask = (ip: string) => limited.inject({ method: 'GET', url: `/api/v1/incidents/${ids.older}/wind`, remoteAddress: ip });
  const first = await ask('2001:db8:3:3::1');
  assert.deepEqual([first.statusCode, first.headers['x-ratelimit-limit']], [200, '30']);
  for (let k = 2; k <= 30; k++) assert.equal((await ask(`2001:db8:3:3::${k.toString(16)}`)).statusCode, 200);
  const refused = await ask('2001:db8:3:3:ffff::1');
  assert.equal(refused.statusCode, 429, 'the 31st from the same /64');
  assert.equal(refused.json().error.code, 'RATE_LIMITED');
  assert.equal((await ask('2001:db8:3:4::1')).statusCode, 200, 'another /64');
  assert.equal(urls.length, 1, 'one call for the cell and day, whoever asks');
});

test('the process sends at most 60 wind calls a minute and 2,000 a UTC day; past either the wind is left out without a call', async () => {
  assert.deepEqual([windDefaults().perMinute, windDefaults().perDay], [60, 2_000]);
  let clock = Date.now();
  const budgeted = await windApp({ perMinute: 3, perDay: 5, now: () => clock });
  clearWindCache();
  mode = 'ok';
  answer = { speed: 12, from: 170 };
  urls.length = 0;
  const found = async (k: number) => (await windOf(budgeted, cells[k]!)) !== null;
  assert.deepEqual([await found(0), await found(1), await found(2)], [true, true, true]);
  assert.equal(await found(3), false, 'a fourth call this minute');
  assert.equal(await found(0), true, 'a wind already fetched costs nothing');
  assert.equal(urls.length, 3);
  clock += 61_000;
  assert.deepEqual([await found(3), await found(4)], [true, true]);
  clock += 61_000;
  assert.equal(await found(5), false, 'a sixth call today');
  assert.equal(urls.length, 5);
  clock = Date.parse(`${utcDay(clock + 24 * HOUR)}T00:30:00Z`);
  assert.equal(await found(5), true, 'a new UTC day');
  assert.equal(urls.length, 6);
});

test('a failed lookup is not tried again for 10 minutes: an error status, a timeout, a network error or an unusable body', async () => {
  let clock = Date.now();
  const failing = await windApp({ now: () => clock });
  for (const failure of ['error', 'timeout', 'network', 'body'] as const) {
    clearWindCache();
    answer = { speed: 12, from: 170 };
    urls.length = 0;
    mode = failure;
    assert.equal(await windOf(failing, ids.older!), null, failure);
    mode = 'ok';
    assert.equal(await windOf(failing, ids.older!), null, `${failure}: remembered`);
    clock += 9 * 60_000;
    assert.equal(await windOf(failing, ids.older!), null, `${failure}: still remembered`);
    assert.equal(urls.length, 1, `${failure}: one call in 9 minutes`);
    clock += 61_000;
    assert.equal((await windOf(failing, ids.older!))?.speedKmh, 12, `${failure}: asked again after 10 minutes`);
    assert.equal(urls.length, 2);
  }
});

test('an HTTP 429 from Open-Meteo pauses every wind lookup for 15 minutes', async () => {
  let clock = Date.now();
  const paused = await windApp({ now: () => clock });
  clearWindCache();
  answer = { speed: 12, from: 170 };
  urls.length = 0;
  mode = '429';
  assert.equal(await windOf(paused, ids.older!), null);
  mode = 'ok';
  assert.equal(await windOf(paused, ids.oldest!), null, 'another day of the cell');
  assert.equal(await windOf(paused, cells[0]!), null, 'another cell, live');
  clock += 14 * 60_000;
  assert.equal(await windOf(paused, ids.oldest!), null);
  assert.equal(urls.length, 1, 'no call during the pause');
  clock += 61_000;
  assert.equal((await windOf(paused, ids.oldest!))?.speedKmh, 12, 'asked again after 15 minutes');
  assert.equal(urls.length, 2);
});

test('an older incident\'s wind comes with the whole UTC day of its cell, one call kept a day; a live one is one call per hour', async () => {
  let clock = Date.now();
  const days = await windApp({ now: () => clock });
  clearWindCache();
  mode = 'ok';
  // The speed tells which hour of the answer was taken.
  answer = { speed: time => 10 + Number(time.slice(11, 13)), from: 90 };
  urls.length = 0;
  // Live: the current hour only; the next hour is another call.
  const live = await windOf(days, cells[1]!);
  const hour = new Date(Math.floor(clock / HOUR) * HOUR).toISOString();
  assert.deepEqual([live.mode, live.at, live.speedKmh], ['now', hour, 10 + Number(hour.slice(11, 13))]);
  const asked = new URL(urls[0]!).searchParams;
  assert.deepEqual([asked.get('start_hour'), asked.get('end_hour'), asked.get('start_date')], [hour.slice(0, 16), hour.slice(0, 16), null]);
  await windOf(days, cells[1]!);
  assert.equal(urls.length, 1);
  clock += HOUR;
  await windOf(days, cells[1]!);
  assert.equal(urls.length, 2, 'the next hour');
  // Two incidents in one cell on one UTC day, hours apart, and one on the day after.
  const day = utcDay(clock - 5 * 24 * HOUR), next = addDays(day, 1);
  const at = (date: string, h: number) => new Date(`${date}T${String(h).padStart(2, '0')}:20:00Z`);
  const archived: string[] = [];
  for (const [date, h] of [[day, 3], [day, 15], [next, 3]] as const) {
    archived.push(await insertIncident(pool, { villageId: place.villageId, first: at(date, h), last: at(date, h), ...place }));
  }
  urls.length = 0;
  const first = await windOf(days, archived[0]!);
  assert.deepEqual([first.mode, first.at, first.speedKmh], ['detected', `${day}T03:00:00.000Z`, 13]);
  const url = new URL(urls[0]!);
  assert.equal(`${url.origin}${url.pathname}`, 'https://api.open-meteo.com/v1/forecast');
  assert.deepEqual([url.searchParams.get('start_date'), url.searchParams.get('end_date'), url.searchParams.get('start_hour')], [day, day, null]);
  assert.equal((await windOf(days, archived[1]!)).speedKmh, 25, 'the same day: its hour from the same call');
  assert.equal(urls.length, 1);
  await windOf(days, archived[2]!);
  assert.equal(urls.length, 2, 'the next day: one more call');
  clock += 23 * HOUR;
  await windOf(days, archived[0]!);
  assert.equal(urls.length, 2, 'kept a day');
  clock += 2 * HOUR;
  await windOf(days, archived[0]!);
  assert.equal(urls.length, 3, 'asked again after a day');
});

test('past 5,000 winds the oldest go first, instead of all of them', () => {
  assert.equal(MAX_WINDS, 5_000);
  const kept = new ExpiringMap<number>(3);
  for (const [k, key] of ['a', 'b', 'c', 'd'].entries()) kept.set(key, k, 1_000);
  assert.equal(kept.size, 3);
  assert.equal(kept.get('a', 0), undefined, 'the oldest went');
  assert.deepEqual(['b', 'c', 'd'].map(key => kept.get(key, 0)?.value), [1, 2, 3]);
  assert.equal(kept.get('b', 1_000), undefined, 'gone once it expired');
  assert.equal(kept.size, 2);
});
