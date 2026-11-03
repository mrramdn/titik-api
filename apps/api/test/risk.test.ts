import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app.js';
import { fwiClass, fwiClasses, type FwiClass } from '../src/fwi.js';
import { addDays, wibDay } from '../src/geo.js';
import { clearTileCache } from '../src/incidents.js';
import { clearRiskCache, regencyDay, updateWeather, type CoverCell } from '../src/weather.js';
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

test('live fire danger: three days per cell, and per regency the share of its area in each class', async () => {
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
  // Each regency's cells by day from the database: the share of its area each covers and the FWI there.
  const cover = new Map<string, { share: number; fwi: number }[]>();
  for (const row of (await pool.query(`SELECT m.regency, m.share, to_char(w.day, 'YYYY-MM-DD') AS day, w.fwi
      FROM weather_cell_regencies m JOIN weather_daily w ON w.cell_id = m.cell_id WHERE w.day = ANY($1::date[])`, [days])).rows) {
    const key = `${row.regency}/${row.day}`;
    cover.set(key, [...(cover.get(key) ?? []), { share: row.share, fwi: row.fwi }]);
  }
  const rank = (name: FwiClass) => fwiClasses.indexOf(name);
  const atOrAbove = (shares: Record<FwiClass, number>, name: FwiClass) => fwiClasses.slice(rank(name)).reduce((total, c) => total + shares[c], 0);
  for (const regency of data.regencies) {
    assert.ok(regency.peatShare >= 0 && regency.peatShare <= 1);
    assert.equal(regency.center.length, 2);
    assert.deepEqual(regency.days.map((d: any) => d.date), days);
    for (const day of regency.days) {
      const label = `${regency.name} ${day.date}`;
      assert.deepEqual(Object.keys(day).sort(), ['date', 'forecast', 'fwiClass', 'meanFwi', 'partial', 'shares'], label);
      assert.equal(day.forecast, true);
      assert.deepEqual(Object.keys(day.shares), fwiClasses, label);
      const values = Object.values(day.shares) as number[];
      assert.ok(Math.abs(values.reduce((a, b) => a + b, 0) - 1) < 1e-9, `${label}: the shares add up to 1`);
      assert.ok(values.every(v => v >= 0 && Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6), `${label}: thousandths`);
      // The shares follow the areas: the share of each class over the cells that have the day.
      const cells = cover.get(`${regency.name}/${day.date}`)!.filter(cell => cell.share > 0);
      const total = cells.reduce((a, cell) => a + cell.share, 0);
      for (const name of fwiClasses) {
        const area = cells.filter(cell => fwiClass(Math.round(cell.fwi * 10) / 10) === name).reduce((a, cell) => a + cell.share, 0) / total;
        assert.ok(Math.abs(day.shares[name] - area) < 0.001, `${label} ${name}: ${day.shares[name]} vs ${area}`);
      }
      // The largest share decides, the higher class on a tie.
      for (const name of fwiClasses) {
        if (rank(name) < rank(day.fwiClass)) assert.ok(day.shares[name] <= day.shares[day.fwiClass], `${label}: ${name} is not larger`);
        if (rank(name) > rank(day.fwiClass)) assert.ok(day.shares[name] < day.shares[day.fwiClass], `${label}: ${name} is smaller`);
      }
      // A higher class is named from 10% of the area, counting the classes above it.
      if (day.partial) {
        assert.ok(rank(day.partial.fwiClass) > rank(day.fwiClass), label);
        assert.ok(Math.abs(day.partial.share - atOrAbove(day.shares, day.partial.fwiClass)) < 1e-9 && day.partial.share >= 0.1 - 1e-9, label);
        const higher = fwiClasses[rank(day.partial.fwiClass) + 1];
        assert.ok(!higher || atOrAbove(day.shares, higher) < 0.1 - 1e-9, `${label}: no higher class covers 10%`);
      } else {
        const next = fwiClasses[rank(day.fwiClass) + 1];
        assert.ok(!next || atOrAbove(day.shares, next) < 0.1 - 1e-9, `${label}: nothing above covers 10%`);
      }
      const mean = cells.reduce((a, cell) => a + cell.share * cell.fwi, 0) / total;
      assert.ok(Math.abs(day.meanFwi - mean) <= 0.05 + 1e-9, `${label}: mean FWI ${day.meanFwi} vs ${mean}`);
      assert.ok(Math.abs(day.meanFwi * 10 - Math.round(day.meanFwi * 10)) < 1e-6, `${label}: one decimal`);
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
  assert.ok(data.regencies.every((r: any) => r.days.length === 1 && r.days[0].date === day && r.days[0].forecast === false));
  for (const bad of [today, addDays(today, -6), '2026-13-01', 'kemarin']) {
    const response = await app.inject({ method: 'GET', url: `/api/v1/risk?tanggal=${bad}` });
    assert.equal(response.statusCode, 400, bad);
    assert.equal(response.json().error.code, 'INVALID_INPUT');
  }
});

test('a regency covered by two cells with unequal overlap takes the class of its larger part and names the higher part', async () => {
  const tomorrow = addDays(today, 1);
  const pair = (await pool.query(`SELECT regency, array_agg(cell_id ORDER BY share) AS cells, array_agg(share ORDER BY share) AS shares
    FROM weather_cell_regencies GROUP BY regency HAVING count(*) = 2 AND min(share) > 0.1 ORDER BY max(share) - min(share) DESC, regency LIMIT 1`)).rows[0];
  assert.ok(pair, 'a regency over two cells, each covering more than 10% of it');
  const [small, large] = pair.shares as number[];
  assert.ok(small! < large!);
  // The smaller part very high (FWI 20), the larger part low (FWI 0.6). By the worst cell the regency would be very high.
  await pool.query('UPDATE weather_daily SET fwi = 20 WHERE cell_id = $1 AND day = $2', [pair.cells[0], tomorrow]);
  await pool.query('UPDATE weather_daily SET fwi = 0.6 WHERE cell_id = $1 AND day = $2', [pair.cells[1], tomorrow]);
  clearRiskCache();
  const day = (await risk()).regencies.find((r: any) => r.name === pair.regency).days[1];
  const part = small! / (small! + large!);
  assert.equal(day.date, tomorrow);
  assert.equal(day.fwiClass, 'rendah');
  assert.ok(Math.abs(day.shares.sangat_tinggi - part) < 0.001, `${day.shares.sangat_tinggi} vs ${part}`);
  assert.deepEqual(day.shares, { rendah: Math.round((1 - day.shares.sangat_tinggi) * 1000) / 1000, sedang: 0, tinggi: 0, sangat_tinggi: day.shares.sangat_tinggi });
  assert.deepEqual(day.partial, { fwiClass: 'sangat_tinggi', share: day.shares.sangat_tinggi });
  assert.ok(Math.abs(day.meanFwi - (part * 20 + (1 - part) * 0.6)) <= 0.05 + 1e-9, `mean FWI ${day.meanFwi}`);
});

test('a weather run clears the cached fire danger', async () => {
  const before = await risk();
  const later = new Date(Date.parse(before.fetchedAt) + 5000);
  await updateWeather(pool, { fetch: fakeOpenMeteo(today, addDays(today, -5), weather(4), []), now: later, sleep: async () => {} });
  const after = await risk();
  assert.equal(after.fetchedAt, later.toISOString());
  assert.ok(after.cells[0].days[0].noon.tempC > before.cells[0].days[0].noon.tempC, 'the new, warmer weather');
});

// regencyDay on its own, with cells given as [share of the regency's area, FWI].
const under = (...cells: [number, number][]): CoverCell[] => cells.map(([weight, fwi]) => ({ weight, fwi, forecast: true }));
const byArea = (...cells: [number, number][]) => regencyDay('2026-11-04', under(...cells))!;
const sumOf = (shares: Record<FwiClass, number>) => Object.values(shares).reduce((a, b) => a + b, 0);

test('by area: the shares of the classes add up to 1 and the largest share gives the class', () => {
  assert.deepEqual(byArea([0.5, 0.4], [0.3, 4], [0.2, 9]), { date: '2026-11-04', forecast: true, fwiClass: 'rendah',
    shares: { rendah: 0.5, sedang: 0.3, tinggi: 0.2, sangat_tinggi: 0 }, partial: { fwiClass: 'tinggi', share: 0.2 }, meanFwi: 3.2 });
  // Three equal thirds still add up to exactly 1, in thousandths.
  const thirds = byArea([1, 0.4], [1, 4], [1, 20]);
  assert.ok(Math.abs(sumOf(thirds.shares) - 1) < 1e-12);
  assert.deepEqual(Object.values(thirds.shares).map(v => Math.round(v * 1000)).sort((a, b) => a - b), [0, 333, 333, 334]);
  // A larger part at sedang outweighs two smaller parts at the extremes.
  assert.equal(byArea([0.3, 0.4], [0.4, 4], [0.3, 20]).fwiClass, 'sedang');
  // Each cell's class follows its FWI to one decimal, as on the grid: 1.46 is 1.5, sedang.
  assert.equal(byArea([1, 1.46]).fwiClass, 'sedang');
  assert.equal(byArea([1, 1.44]).fwiClass, 'rendah');
});

test('by area: a tie goes to the higher class', () => {
  assert.equal(byArea([0.5, 0.4], [0.5, 10]).fwiClass, 'tinggi');
  assert.equal(byArea([0.5, 0.4], [0.5, 10]).partial, null, 'nothing above tinggi');
  assert.equal(byArea([0.25, 0.4], [0.25, 4], [0.25, 10], [0.25, 20]).fwiClass, 'sangat_tinggi');
  assert.equal(byArea([0.4, 0.4], [0.4, 4], [0.2, 20]).fwiClass, 'sedang');
});

test('by area: a higher class is named from exactly 10% of the regency, counting the classes above it', () => {
  assert.deepEqual(byArea([0.9, 0.4], [0.1, 10]).partial, { fwiClass: 'tinggi', share: 0.1 });
  assert.equal(byArea([0.901, 0.4], [0.099, 10]).partial, null, '9.9% is not named');
  assert.equal(byArea([0.95, 0.4], [0.05, 4]).partial, null);
  // Very high on 8% only, but high or above on 20%: high is named, with 20%.
  assert.deepEqual(byArea([0.8, 0.4], [0.12, 10], [0.08, 20]).partial, { fwiClass: 'tinggi', share: 0.2 });
  // The highest class that reaches 10%.
  assert.deepEqual(byArea([0.6, 0.4], [0.2, 4], [0.2, 20]).partial, { fwiClass: 'sangat_tinggi', share: 0.2 });
  assert.equal(byArea([0.7, 4], [0.3, 0.4]).partial, null, 'only a lower class besides the largest');
  assert.equal(byArea([0.6, 20], [0.4, 0.4]).partial, null, 'nothing above sangat tinggi');
});

test('by area: the mean FWI weighs each cell by the share of the regency it covers', () => {
  // A regency covered by two cells with unequal overlap: 75% at FWI 2, 25% at FWI 10.
  const unequal = byArea([0.75, 2], [0.25, 10]);
  assert.equal(unequal.meanFwi, 4);
  assert.deepEqual(unequal.shares, { rendah: 0, sedang: 0.75, tinggi: 0.25, sangat_tinggi: 0 });
  assert.equal(unequal.fwiClass, 'sedang');
  assert.deepEqual(unequal.partial, { fwiClass: 'tinggi', share: 0.25 });
  // Shares are normalised over the cells that have the day: 0.3 and 0.1 of the regency count as 75% and 25%.
  assert.deepEqual(byArea([0.3, 2], [0.1, 10]), unequal);
  assert.equal(byArea([0.9, 1.04], [0.1, 30]).meanFwi, 3.9, 'one decimal');
});

test('by area: cells without area are left out; no cell, no day; any forecast makes the day a forecast', () => {
  assert.deepEqual(byArea([0, 30], [1, 2]).shares, { rendah: 0, sedang: 1, tinggi: 0, sangat_tinggi: 0 });
  assert.equal(regencyDay('2026-11-04', []), null);
  assert.equal(regencyDay('2026-11-04', under([0, 5])), null);
  const analysis = { weight: 0.5, fwi: 3, forecast: false };
  assert.equal(regencyDay('2026-11-04', [analysis, analysis])!.forecast, false);
  assert.equal(regencyDay('2026-11-04', [analysis, { ...analysis, forecast: true }])!.forecast, true);
});
