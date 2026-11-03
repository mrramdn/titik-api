import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app.js';
import { clearWindCache, inSector } from '../src/wind.js';
import { emptyDatabase, insertIncident, testPool } from './fixtures.js';

const pool = testPool();
let app: FastifyInstance;
let directory: string;
const HOUR = 3_600_000;
// The answer the stand-in for Open-Meteo gives, the URLs it was asked, and whether it hangs or fails.
let answer = { speed: 12, from: 170 };
let mode: 'ok' | 'hang' | 'error' = 'ok';
const urls: string[] = [];
const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  urls.push(url.toString());
  if (mode === 'hang') {
    return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
  }
  if (mode === 'error') return new Response('down', { status: 500 });
  const hour = url.searchParams.get('start_hour');
  const time = hour ? [hour] : Array.from({ length: 24 }, (_, k) => `${url.searchParams.get('start_date')}T${String(k).padStart(2, '0')}:00`);
  return new Response(JSON.stringify({ hourly: { time, wind_speed_10m: time.map(() => answer.speed), wind_direction_10m: time.map(() => answer.from) } }),
    { headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

let place: { lon: number; lat: number; villageId: string };
const ids: Record<string, string> = {};
const wind = async (id: string) => {
  const response = await app.inject({ method: 'GET', url: `/api/v1/incidents/${id}/wind` });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().data;
};

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
  app = (await createApp({ pool, uploadsDir: join(directory, 'uploads'), webDir: join(directory, 'web'), logger: false, weatherFetch: fakeFetch })).app;
});
after(async () => { if (app) await app.close(); await pool.end(); if (directory) await rm(directory, { recursive: true, force: true }); });

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
  assert.equal(new URL(urls[0]!).searchParams.get('start_hour'), hour.slice(0, 16));
  assert.equal(new URL(urls[0]!).searchParams.get('latitude'), place.lat.toFixed(1), 'the 0.1° cell');
  await wind(ids.oldest!);
  assert.match(urls[1]!, /archive-api\.open-meteo\.com\/v1\/archive\?.*start_date=/, 'beyond the Forecast API: the archive');
  // One request per cell and hour within an hour.
  await wind(ids.older!);
  assert.equal(urls.length, 2);
});

test('no answer within 1.5 s or an error leaves the wind out instead of failing', async () => {
  clearWindCache();
  mode = 'hang';
  const started = Date.now();
  assert.equal(await wind(ids.recent!), null);
  const waited = Date.now() - started;
  assert.ok(waited >= 1400 && waited < 4000, `${waited} ms`);
  mode = 'error';
  assert.equal(await wind(ids.recent!), null);
  mode = 'ok';
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/incidents/00000000-0000-4000-8000-000000000000/wind' })).statusCode, 404);
});
