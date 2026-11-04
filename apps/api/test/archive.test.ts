import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app.js';
import { clearTileCache, tileCacheBytes } from '../src/incidents.js';
import { addDays, wibDay } from '../src/geo.js';
import { lonLatToPixel } from '../src/peat.js';
import { emptyDatabase, insertDetection, insertIncident, bigVillage, testPool, tileOf, wibMidnight } from './fixtures.js';
import { readTile } from './mvt.js';

const pool = testPool();
let app: FastifyInstance;
let directory: string;
const today = wibDay();
// The archive day under test, its end (the next WIB midnight) and moments around that end.
const day = addDays(today, -3);
const end = wibMidnight(addDays(day, 1));
const H = 3600_000;
const at = (ms: number) => new Date(end.getTime() + ms);
let village: Awaited<ReturnType<typeof bigVillage>>;
let centre: { lon: number; lat: number };
const tile12 = () => ({ ...tileOf(centre.lon, centre.lat, 12), z: 12 });
const incidents: Record<string, string> = {};

/** The centre of a tile, so fixture points and their footprints stay well inside it. */
function tileCentre(z: number, x: number, y: number) {
  const n = 2 ** z;
  const lon = ((x + 0.5) / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) * 180) / Math.PI;
  return { lon, lat };
}
const get = (url: string) => app.inject({ method: 'GET', url: `/api/v1${url}` });
const json = async (url: string) => { const response = await get(url); assert.equal(response.statusCode, 200, `${url}: ${response.body}`); return response.json().data; };

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'titikapi-archive-'));
  await emptyDatabase(pool);
  village = await bigVillage(pool);
  const t = tileOf(village.lon, village.lat, 12);
  centre = tileCentre(12, t.x, t.y);
  // One incident and one detection at each moment, 300 m apart west to east: the last second of the day, the next
  // midnight, exactly 24 hours before the end and one second earlier, and noon three days before.
  const moments = { edge: at(-1000), next: at(0), start: at(-24 * H), before: at(-24 * H - 1000), old: new Date(wibMidnight(addDays(day, -3)).getTime() + 12 * H) };
  let k = 0;
  for (const [name, time] of Object.entries(moments)) {
    const point = { lon: centre.lon + 0.003 * k++, lat: centre.lat };
    incidents[name] = await insertIncident(pool, { villageId: village.id, first: time, last: time, ...point });
    await insertDetection(pool, { ...point, acqAt: time, villageId: village.id, incidentId: incidents[name] });
  }
  // A MODIS pixel on the day itself, and a detection outside the covered villages (never counted, still on the map).
  await insertDetection(pool, { lon: centre.lon - 0.004, lat: centre.lat - 0.002, acqAt: at(-6 * H), satellite: 'T', scan: 1.2, track: 1.1, villageId: village.id,
    incidentId: incidents.edge });
  await insertDetection(pool, { lon: centre.lon, lat: centre.lat + 0.004, acqAt: at(-5 * H), villageId: null });
  clearTileCache();
  app = (await createApp({ pool, uploadsDir: join(directory, 'uploads'), webDir: join(directory, 'web'), logger: false })).app;
});
after(async () => { if (app) await app.close(); await pool.end(); if (directory) await rm(directory, { recursive: true, force: true }); });

test('an archive day ends at the next WIB midnight: the last second is in, midnight and anything before the window are out', async () => {
  const ids = (rows: { id: string }[]) => rows.map(row => row.id).sort();
  const names = (...keys: string[]) => keys.map(key => incidents[key]!).sort();
  assert.deepEqual(ids(await json(`/incidents?hours=24&tanggal=${day}`)), names('edge', 'start'));
  assert.deepEqual(ids(await json(`/incidents?hours=48&tanggal=${day}`)), names('edge', 'start', 'before'));
  assert.deepEqual(ids(await json(`/incidents?hours=1&tanggal=${day}`)), names('edge'));
  assert.deepEqual(ids(await json(`/incidents?hours=24&tanggal=${addDays(day, 1)}`)), names('next'));
  const summary = await json(`/summary?hours=24&tanggal=${day}`);
  assert.deepEqual([summary.incidents, summary.detections, summary.villages], [2, 3, 1], 'two incidents; three detections inside villages (one MODIS)');
  const regions = await json(`/regions/summary?hours=24&tanggal=${day}`);
  assert.deepEqual(regions.map((r: any) => [r.name, r.incidents]), [[village.regency, 2]]);
  // Live data still counts back from now: every fixture lies within the last week.
  assert.equal((await json('/incidents?hours=168')).length, 5);
  assert.equal((await json('/summary?hours=168')).detections, 6);
});

test('a date that is not in the archive is refused: today, the future, before the first day, or not a date', async () => {
  const first = addDays(day, -3);
  for (const bad of [today, addDays(today, 1), addDays(first, -1), '2026-02-31', '23-10-2026', 'kemarin', '2026-10-1']) {
    for (const path of ['/incidents?hours=24', '/summary?hours=24', '/regions/summary?hours=24', '/tiles/kejadian/12/0/0.mvt?hours=24', '/tiles/deteksi/12/0/0.mvt?hours=24']) {
      const response = await get(`${path}&tanggal=${bad}`);
      assert.equal(response.statusCode, 400, `${path} ${bad}`);
      assert.equal(response.json().error.code, 'INVALID_INPUT');
    }
  }
  assert.match((await get(`/incidents?tanggal=${addDays(first, -1)}`)).json().error.message, new RegExp(`${first} sampai ${addDays(today, -1)}`));
  assert.equal((await get('/incidents?tanggal=2026-02-31')).json().error.message, 'Tanggal tidak valid. Tulis tanggal sebagai TTTT-BB-HH.');
  assert.equal((await get(`/incidents?tanggal=${first}`)).statusCode, 200, 'the first day is in');
  assert.equal((await get(`/incidents?tanggal=${addDays(today, -1)}`)).statusCode, 200, 'yesterday is in');
});

test('archive days run from the first detection to yesterday, zero days included', async () => {
  const archive = await json('/archive/days');
  assert.equal(archive.first, addDays(day, -3));
  assert.equal(archive.last, addDays(today, -1));
  const dates = archive.days.map((d: any) => d.date);
  assert.deepEqual(dates, Array.from({ length: 6 }, (_, k) => addDays(archive.first, k)), 'every day, oldest first');
  const counts = Object.fromEntries(archive.days.map((d: any) => [d.date, [d.detections, d.incidents]]));
  assert.deepEqual(counts, {
    [addDays(day, -3)]: [1, 1], [addDays(day, -2)]: [0, 0], [addDays(day, -1)]: [1, 1], [day]: [3, 2], [addDays(day, 1)]: [1, 1], [addDays(day, 2)]: [0, 0],
  }, 'the detection outside the villages is not counted');
});

test('hotspot tiles follow the archive day; archive tiles are cached for an hour, live ones for two minutes', async () => {
  const { z, x, y } = tile12();
  const archive = await get(`/tiles/kejadian/${z}/${x}/${y}.mvt?hours=24&tanggal=${day}`);
  assert.equal(archive.statusCode, 200);
  assert.equal(archive.headers['cache-control'], 'public, max-age=3600');
  const [kejadian] = readTile(archive.rawPayload);
  assert.equal(kejadian!.name, 'kejadian');
  assert.deepEqual(kejadian!.features.map(f => f.properties.id).sort(), [incidents.edge, incidents.start].sort());
  const live = await get(`/tiles/kejadian/${z}/${x}/${y}.mvt?hours=168`);
  assert.equal(live.headers['cache-control'], 'public, max-age=120');
  assert.equal(readTile(live.rawPayload)[0]!.features.length, 5, 'the same tile without a date shows the live week');
  const deteksi = readTile((await get(`/tiles/deteksi/${z}/${x}/${y}.mvt?hours=24&tanggal=${day}`)).rawPayload).find(layer => layer.name === 'deteksi')!;
  // `age` is hours before the end of the day; the outside detection is drawn but marked.
  assert.deepEqual(deteksi.features.map(f => [f.properties.sensor, f.properties.age, f.properties.inside]).sort(),
    [['MODIS', 6, true], ['VIIRS', 0, true], ['VIIRS', 24, true], ['VIIRS', 5, false]].sort());
  assert.equal((await get(`/tiles/desa/${z}/${x}/${y}.mvt?tanggal=bukan-tanggal`)).statusCode, 200, 'shapes ignore the date');
  assert.ok(tileCacheBytes() > 0);
  clearTileCache();
  assert.equal(tileCacheBytes(), 0);
});

test('from zoom 11 the detection tile carries each pixel footprint in a second layer', async () => {
  const { x, y } = tile12();
  const z12 = readTile((await get(`/tiles/deteksi/12/${x}/${y}.mvt?hours=24&tanggal=${day}`)).rawPayload);
  assert.deepEqual(z12.map(layer => layer.name), ['deteksi', 'piksel']);
  const [deteksi, piksel] = z12 as [typeof z12[0], typeof z12[0]];
  assert.equal(piksel.features.length, deteksi.features.length);
  assert.deepEqual(piksel.features.map(f => [f.properties.sensor, f.properties.age]).sort(), deteksi.features.map(f => [f.properties.sensor, f.properties.age]).sort());
  // Box sizes in tile units: scan × track km, stretched by 1/cos(latitude) on the Mercator grid (4096 units per tile).
  const unit = (2 * Math.PI * 6378137) / 2 ** 12 / 4096;
  const stretch = 1 / Math.cos((centre.lat * Math.PI) / 180);
  const size = (feature: (typeof piksel.features)[0]) => [feature.bbox![2] - feature.bbox![0], feature.bbox![3] - feature.bbox![1]];
  const viirs = piksel.features.find(f => f.properties.sensor === 'VIIRS' && f.properties.age === 0)!;
  const modis = piksel.features.find(f => f.properties.sensor === 'MODIS')!;
  for (const [feature, scan, track] of [[viirs, 0.4, 0.37], [modis, 1.2, 1.1]] as const) {
    const [w, h] = size(feature);
    assert.ok(Math.abs(w! - (scan * 1000 * stretch) / unit) <= 1.5, `width ${w}`);
    assert.ok(Math.abs(h! - (track * 1000 * stretch) / unit) <= 1.5, `height ${h}`);
  }
  // Below zoom 11 only the points.
  const t10 = tileOf(centre.lon, centre.lat, 10);
  const z10 = readTile((await get(`/tiles/deteksi/10/${t10.x}/${t10.y}.mvt?hours=24&tanggal=${day}`)).rawPayload);
  assert.deepEqual(z10.map(layer => layer.name), ['deteksi']);
  // A footprint reaches into the next tile even when its point lies outside it: the MODIS box is 1.2 km wide, a
  // zoom 16 tile 611 m, and the neighbour on the nearer side starts at most 306 m from the point.
  const m = { lon: centre.lon - 0.004, lat: centre.lat - 0.002 };
  const [px, py] = lonLatToPixel(m.lon, m.lat, 16);
  const fraction = px / 256 - Math.floor(px / 256);
  const neighbour = { x: Math.floor(px / 256) + (fraction > 0.5 ? 1 : -1), y: Math.floor(py / 256) };
  const next = readTile((await get(`/tiles/deteksi/16/${neighbour.x}/${neighbour.y}.mvt?hours=24&tanggal=${day}`)).rawPayload);
  assert.ok(next.find(layer => layer.name === 'piksel')?.features.some(f => f.properties.sensor === 'MODIS'), 'the MODIS box is drawn in the neighbour tile');
  const gap = Math.min(fraction, 1 - fraction) * 611;
  if (gap > 15) assert.ok(!next.find(layer => layer.name === 'deteksi')?.features.some(f => f.properties.sensor === 'MODIS'), 'its point is not');
});
