import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app.js';
import { fwiClass } from '../src/fwi.js';
import { addDays, wibDay } from '../src/geo.js';
import { clearTileCache } from '../src/incidents.js';
import { updateWeather } from '../src/weather.js';
import { bigVillage, emptyDatabase, fakeOpenMeteo, insertDetection, testPool, wibMidnight } from './fixtures.js';

const pool = testPool();
let app: FastifyInstance;
let directory: string;
const today = wibDay();
const risk = async (query = '') => {
  const response = await app.inject({ method: 'GET', url: `/api/v1/risk${query}` });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().data;
};
// Warmer in the west and on dry afternoons, so cells and regencies differ.
const weather = (shift: number) => (_source: 'archive' | 'forecast', lat: number, time: string) => {
  const hour = Number(time.slice(11, 13)), day = Number(time.slice(8, 10));
  return [26 + hour / 3 + shift + (lat + 3), 80 - hour * 2 - (day % 7), 5 + (day % 9), (day * 41) % 360, day % 6 === 0 && hour === 16 ? 9 : 0];
};

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'titikapi-risk-'));
  await emptyDatabase(pool);
  // One detection five days ago opens the archive from that day.
  const village = await bigVillage(pool);
  await insertDetection(pool, { lon: village.lon, lat: village.lat, acqAt: new Date(wibMidnight(addDays(today, -5)).getTime() + 13 * 3600_000), villageId: village.id });
  clearTileCache();
  app = (await createApp({ pool, uploadsDir: join(directory, 'uploads'), webDir: join(directory, 'web'), logger: false })).app;
});
after(async () => { if (app) await app.close(); await pool.end(); if (directory) await rm(directory, { recursive: true, force: true }); });

test('before any weather run the fire danger is empty, with a null fetch time', async () => {
  assert.deepEqual(await risk(), { asOf: today, archive: false, fetchedAt: null, cellSize: 0.5, cells: [], regencies: [] });
  assert.deepEqual((await risk(`?tanggal=${addDays(today, -2)}`)).cells, []);
});

test('live fire danger: three days per cell, and per regency the overlapping cell with the highest FWI', async () => {
  await updateWeather(pool, { fetch: fakeOpenMeteo(today, addDays(today, -5), weather(0), []), spinUpStart: addDays(today, -12), sleep: async () => {} });
  const data = await risk();
  assert.equal(data.asOf, today);
  assert.equal(data.archive, false);
  assert.ok(Date.parse(data.fetchedAt) > Date.now() - 60_000);
  const cellCount = (await pool.query('SELECT count(*)::int AS n FROM weather_cells')).rows[0].n;
  assert.equal(data.cells.length, cellCount);
  const days = [today, addDays(today, 1), addDays(today, 2)];
  for (const cell of data.cells) {
    assert.deepEqual(cell.days.map((d: any) => d.date), days);
    assert.ok([cell.lon, cell.lat].every(v => Math.abs(((v * 4) % 2 + 2) % 2 - 1) < 1e-9), `centre ${cell.lon},${cell.lat} on x.25 or x.75`);
    for (const day of cell.days) {
      assert.equal(day.forecast, true);
      assert.equal(day.fwiClass, fwiClass(day.codes.fwi), 'the class follows the FWI as returned');
      assert.deepEqual(Object.keys(day.codes).sort(), ['bui', 'dc', 'dmc', 'ffmc', 'fwi', 'isi']);
      assert.deepEqual(Object.keys(day.noon).sort(), ['rain24hMm', 'rhPct', 'tempC', 'windFromDeg', 'windKmh']);
      assert.ok(Number.isInteger(day.dryDays) && day.noon.windFromDeg >= 0 && day.noon.windFromDeg < 360);
    }
  }
  const regencyCount = (await pool.query('SELECT count(*)::int AS n FROM regencies')).rows[0].n;
  assert.equal(data.regencies.length, regencyCount);
  const overlapping = new Map<string, Set<string>>();
  for (const row of (await pool.query('SELECT m.regency, c.lon, c.lat FROM weather_cell_regencies m JOIN weather_cells c ON c.id = m.cell_id')).rows) {
    overlapping.set(row.regency, (overlapping.get(row.regency) ?? new Set()).add(`${row.lon},${row.lat}`));
  }
  const fwiAt = new Map(data.cells.flatMap((cell: any) => cell.days.map((d: any) => [`${cell.lon},${cell.lat},${d.date}`, d.codes.fwi])));
  for (const regency of data.regencies) {
    assert.ok(regency.peatShare >= 0 && regency.peatShare <= 1);
    assert.equal(regency.center.length, 2);
    assert.deepEqual(regency.days.map((d: any) => d.date), days);
    for (const day of regency.days) {
      const mine = overlapping.get(regency.name)!;
      assert.ok(mine.has(`${day.cell[0]},${day.cell[1]}`), `${regency.name}: the cell overlaps the regency`);
      const highest = Math.max(...[...mine].map(key => fwiAt.get(`${key},${day.date}`) as number));
      assert.equal(day.codes.fwi, highest, `${regency.name} ${day.date}: the highest FWI of its cells`);
    }
  }
  const peat = (await pool.query(`SELECT regency, sum(peat_share * area_ha) / sum(area_ha) AS share FROM villages GROUP BY regency ORDER BY share DESC LIMIT 1`)).rows[0];
  assert.ok(Math.abs(data.regencies.find((r: any) => r.name === peat.regency).peatShare - Number(peat.share)) < 0.001, 'area-weighted peat share');
});

test('an archive day shows that day only, from model analysis; dates outside the archive are refused', async () => {
  const day = addDays(today, -3);
  const data = await risk(`?tanggal=${day}`);
  assert.equal(data.asOf, day);
  assert.equal(data.archive, true);
  assert.ok(data.cells.length > 0 && data.cells.every((cell: any) => cell.days.length === 1 && cell.days[0].date === day && cell.days[0].forecast === false));
  assert.ok(data.regencies.every((r: any) => r.days.length === 1 && r.days[0].date === day));
  for (const bad of [today, addDays(today, -6), '2026-13-01', 'kemarin']) {
    const response = await app.inject({ method: 'GET', url: `/api/v1/risk?tanggal=${bad}` });
    assert.equal(response.statusCode, 400, bad);
    assert.equal(response.json().error.code, 'INVALID_INPUT');
  }
});

test('a weather run clears the cached fire danger', async () => {
  const before = await risk();
  const later = new Date(Date.parse(before.fetchedAt) + 5000);
  await updateWeather(pool, { fetch: fakeOpenMeteo(today, addDays(today, -5), weather(4), []), now: later, sleep: async () => {} });
  const after = await risk();
  assert.equal(after.fetchedAt, later.toISOString());
  assert.ok(after.cells[0].days[0].noon.tempC > before.cells[0].days[0].noon.tempC, 'the new, warmer weather');
});
