import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fwiDay, startMoisture } from '../src/fwi.js';
import { addDays, wibDay } from '../src/geo.js';
import { computeDays, ensureCells, parseLocations, startWeatherScheduler, updateWeather } from '../src/weather.js';
import { emptyDatabase, fakeOpenMeteo, testPool } from './fixtures.js';

const pool = testPool();
const hourKey = (day: string, hour: number) => `${day}T${String(hour).padStart(2, '0')}:00`;
const near = (actual: number, expected: number, label: string) => assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} vs ${expected}`);

before(async () => { await emptyDatabase(pool); });
after(async () => { await pool.end(); });

test('a day takes the 12.00 values, the rain of the 24 hours to noon, and the rain of the WIB day for the dry spell', () => {
  const d0 = '2026-10-20', d1 = '2026-10-21', d2 = '2026-10-22', d3 = '2026-10-23';
  const rain: Record<string, number> = {
    [hourKey(d0, 12)]: 5, // before the first window: never counted
    [hourKey(d0, 13)]: 0.3, [hourKey(d1, 1)]: 0.2, [hourKey(d1, 12)]: 0.4, // the 24 hours to noon on d1
    [hourKey(d1, 13)]: 2.0, [hourKey(d2, 0)]: 0.5, // after noon on d1: noon of d2; the 00.00 value is the last hour of d1
    [hourKey(d3, 5)]: 0.7,
  };
  const series = new Map<string, { temp: number; rh: number; wind: number; from: number; rain: number }>();
  for (const day of [d0, d1, d2, d3]) {
    for (let hour = 0; hour < 24; hour++) series.set(hourKey(day, hour), { temp: 20 + hour / 2, rh: 90 - hour, wind: hour, from: hour * 10, rain: rain[hourKey(day, hour)] ?? 0 });
  }
  const cell = { id: 1, lon: 114.25, lat: -2.75 };
  const rows = computeDays(cell, series, { day: d0, moisture: startMoisture, dryDays: 5 }, d2);
  assert.deepEqual(rows.map(row => row.day), [d1, d2, d3], 'up to the last day with a noon value (today + 2 would be d4)');
  assert.deepEqual(rows.map(row => [row.temp, row.rh, row.wind, row.from]), [[26, 78, 12, 120], [26, 78, 12, 120], [26, 78, 12, 120]], '12.00, not 11.00 or 13.00');
  assert.deepEqual(rows.map(row => Math.round(row.rain24h * 10) / 10), [0.9, 2.5, 0.7]);
  assert.deepEqual(rows.map(row => Math.round(row.rainDay * 10) / 10), [3.1, 0, 0.7]);
  assert.deepEqual(rows.map(row => row.dryDays), [0, 1, 2], 'd1 had 3.1 mm: the dry spell restarts');
  assert.deepEqual(rows.map(row => row.forecast), [false, true, true]);
  let moisture = startMoisture;
  for (const row of rows) {
    const expected = fwiDay(moisture, { temp: row.temp, rh: row.rh, wind: row.wind, rain: row.rain24h }, cell.lat, 10);
    for (const key of ['ffmc', 'dmc', 'dc', 'isi', 'bui', 'fwi'] as const) near(row[key], expected[key], `${row.day} ${key}`);
    moisture = expected;
  }
  // A missing hour in the rain window stops the chain there.
  series.delete(hourKey(d2, 3));
  assert.deepEqual(computeDays(cell, series, { day: d0, moisture: startMoisture, dryDays: 0 }, d2).map(row => row.day), [d1]);
});

test('one location comes back as an object, several as a list in request order; incomplete hours are left out', () => {
  const location = (temp: number | null) => ({ hourly: { time: ['2026-10-23T12:00'], temperature_2m: [temp], relative_humidity_2m: [60], wind_speed_10m: [8],
    wind_direction_10m: [90], precipitation: [0] } });
  assert.equal(parseLocations(location(30), 1)[0]!.get('2026-10-23T12:00')!.temp, 30);
  const [a, b] = parseLocations([location(31), location(null)], 2);
  assert.equal(a!.get('2026-10-23T12:00')!.temp, 31);
  assert.equal(b!.size, 0);
  assert.throws(() => parseLocations([location(1)], 2));
});

test('an answer keeps the rain of every hour and the rest at 12.00 only; hours that do not follow each other are refused', () => {
  const time = ['2026-10-22', '2026-10-23'].flatMap(day => Array.from({ length: 24 }, (_, hour) => hourKey(day, hour)));
  const column = (f: (k: number) => number | null) => time.map((_, k) => f(k));
  const [series] = parseLocations({ hourly: { time, temperature_2m: column(k => 25 + k / 10), relative_humidity_2m: column(k => 70 - k / 2),
    wind_speed_10m: column(k => (k === 30 ? null : 5.5)), wind_direction_10m: column(k => k * 7), precipitation: column(k => k / 100) } }, 1);
  assert.equal(series!.size, 47, 'every hour but the one without wind');
  assert.deepEqual(series!.get('2026-10-23T12:00'), { temp: 28.6, rh: 52, wind: 5.5, from: 252, rain: 0.36 });
  const morning = series!.get('2026-10-23T05:00')!;
  assert.equal(morning.rain, 0.29);
  assert.ok([morning.temp, morning.rh, morning.wind, morning.from].every(Number.isNaN), 'other hours keep their rain only');
  assert.deepEqual([series!.get('2026-10-23T06:00'), series!.get('2026-10-24T00:00'), series!.get('2026-10-23T12:30')], [undefined, undefined, undefined]);
  assert.equal(series!.lastDay, '2026-10-23');
  const far = { hourly: { time: ['2026-01-01T00:00', '2026-12-31T23:00'], temperature_2m: [1, 1], relative_humidity_2m: [1, 1], wind_speed_10m: [1, 1],
    wind_direction_10m: [1, 1], precipitation: [0, 0] } };
  assert.throws(() => parseLocations(far, 1), /do not follow each other/);
});

const today = wibDay();
const weather = (shift: number) => (source: 'archive' | 'forecast', lat: number, time: string) => {
  const hour = Number(time.slice(11, 13)), day = Number(time.slice(8, 10));
  const temp = 24 + hour / 3 + (source === 'forecast' ? 1 : 0) + shift;
  return [temp, 85 - hour * 2, 6 + (day % 5), (day * 37) % 360, hour === 15 && day % 4 === 0 ? 6 : 0];
};

test('the first run spins up from the archive and the forecast; the next run starts from the stored codes', async () => {
  const cells = await ensureCells(pool);
  assert.ok(cells > 100 && cells < 140, `${cells} cells of 0.5°`);
  const regencies = (await pool.query('SELECT count(DISTINCT regency)::int AS n FROM weather_cell_regencies')).rows[0].n;
  assert.equal(regencies, (await pool.query('SELECT count(*)::int AS n FROM regencies')).rows[0].n, 'every regency has a cell');
  const shares = (await pool.query(`SELECT regency, sum(share) AS total, min(share) AS least, count(*) FILTER (WHERE share IS NULL)::int AS missing
    FROM weather_cell_regencies GROUP BY regency`)).rows;
  for (const row of shares) {
    assert.equal(row.missing, 0, `${row.regency}: every cell has its share`);
    assert.ok(Math.abs(row.total - 1) < 1e-4 && row.least >= 0, `${row.regency}: the shares of its area add up to 1 (${row.total})`);
  }
  const spinUpStart = addDays(today, -20), archiveUntil = addDays(today, -5);
  const urls: string[] = [];
  const waits: number[] = [];
  const first = await updateWeather(pool, { fetch: fakeOpenMeteo(today, archiveUntil, weather(0), urls), spinUpStart, sleep: async ms => { waits.push(ms); } });
  assert.deepEqual([first.skipped, first.cells, first.spinUp, first.failed], [false, cells, cells, 0]);
  const archiveUrls = urls.filter(url => url.includes('archive-api')), forecastUrls = urls.filter(url => url.includes('api.open-meteo.com/v1/forecast'));
  // Light archive requests: two weeks of one location count as one Open-Meteo call, at most 64 per request, about 300 a minute.
  const locations = (url: string) => new URL(url).searchParams.get('latitude')!.split(',').length;
  assert.equal(archiveUrls.reduce((n, url) => n + locations(url), 0), cells, 'every cell once');
  assert.ok(archiveUrls.every(url => locations(url) * (21 / 14) <= 64));
  assert.ok(waits.includes(Math.ceil(((locations(archiveUrls[0]!) * 21) / 14 / 300) * 60_000)) && waits.includes(2000), `paced: ${[...new Set(waits)]}`);
  assert.ok(archiveUrls.every(url => url.includes(`start_date=${addDays(spinUpStart, -1)}`) && url.includes(`end_date=${addDays(today, -1)}`) && url.includes('models=era5')));
  assert.equal(forecastUrls.length, Math.ceil(cells / 50));
  assert.ok(forecastUrls.every(url => url.includes('past_days=10') && url.includes('forecast_days=3') && url.includes('timezone=Asia%2FJakarta')));
  assert.ok(urls.every(url => new URL(url).searchParams.get('latitude')!.split(',').length <= 50));
  assert.equal(first.rows, cells * 23, 'from the spin-up start to today + 2');
  const cell = (await pool.query('SELECT id, lat FROM weather_cells ORDER BY id LIMIT 1')).rows[0];
  const rowsOf = async () => (await pool.query(`SELECT to_char(day, 'YYYY-MM-DD') AS day, temp_c, rh_pct, wind_kmh, rain24h_mm, rain_day_mm, dry_days, ffmc, dmc, dc, isi, bui, fwi, forecast, fetched_at
    FROM weather_daily WHERE cell_id = $1 ORDER BY day`, [cell.id])).rows;
  const one = await rowsOf();
  assert.equal(one[0].day, spinUpStart);
  // ERA5 where it has data, the forecast after: the fixture makes the forecast 1 °C warmer.
  const noon = (day: string, source: 'archive' | 'forecast', shift = 0) => weather(shift)(source, cell.lat, hourKey(day, 12))[0]!;
  near(one.find(row => row.day === archiveUntil).temp_c, noon(archiveUntil, 'archive'), 'archive day');
  near(one.find(row => row.day === addDays(archiveUntil, 1)).temp_c, noon(addDays(archiveUntil, 1), 'forecast'), 'day after the archive');
  assert.deepEqual(one.filter(row => row.forecast).map(row => row.day), [today, addDays(today, 1), addDays(today, 2)]);
  // Each day's codes follow from the day before and its own stored weather, from the start values on.
  let moisture = startMoisture;
  for (const row of one) {
    const expected = fwiDay(moisture, { temp: row.temp_c, rh: row.rh_pct, wind: row.wind_kmh, rain: row.rain24h_mm }, cell.lat, Number(row.day.slice(5, 7)));
    for (const key of ['ffmc', 'dmc', 'dc', 'isi', 'bui', 'fwi'] as const) near(row[key], expected[key], `${row.day} ${key}`);
    moisture = expected;
  }

  // The next day, 2 °C warmer: only the Forecast API, ten days back, recomputed from the stored codes of the day before.
  const tomorrow = addDays(today, 1);
  const later: string[] = [];
  const second = await updateWeather(pool, { fetch: fakeOpenMeteo(tomorrow, archiveUntil, weather(2), later), now: new Date(Date.now() + 86_400_000),
    spinUpStart, sleep: async () => {} });
  assert.equal(second.spinUp, 0);
  assert.ok(later.every(url => url.includes('api.open-meteo.com/v1/forecast') && url.includes('past_days=10')), 'no archive once codes are stored');
  assert.equal(second.rows, cells * 12, 'tomorrow − 9 to tomorrow + 2');
  const two = await rowsOf();
  const kept = one.filter(row => row.day <= addDays(tomorrow, -10));
  assert.deepEqual(two.filter(row => row.day <= addDays(tomorrow, -10)), kept, 'days before the refetched ones are left as they were');
  const base = two.find(row => row.day === addDays(tomorrow, -10)), firstNew = two.find(row => row.day === addDays(tomorrow, -9));
  near(firstNew.temp_c, noon(addDays(tomorrow, -9), 'forecast', 2), 'the new weather');
  const expected = fwiDay({ ffmc: base.ffmc, dmc: base.dmc, dc: base.dc }, { temp: firstNew.temp_c, rh: firstNew.rh_pct, wind: firstNew.wind_kmh, rain: firstNew.rain24h_mm },
    cell.lat, Number(firstNew.day.slice(5, 7)));
  for (const key of ['ffmc', 'dmc', 'dc', 'isi', 'bui', 'fwi'] as const) near(firstNew[key], expected[key], `chained ${key}`);
  assert.equal(firstNew.dry_days, firstNew.rain_day_mm < 1 ? base.dry_days + 1 : 0, 'the dry spell continues from the stored day');
  assert.equal(two.at(-1).day, addDays(tomorrow, 2));
  assert.deepEqual(two.filter(row => row.forecast).map(row => row.day).slice(-3), [tomorrow, addDays(tomorrow, 1), addDays(tomorrow, 2)]);
});

test('dry days continue from the stored day: a rainless fixture counts on', async () => {
  const dry = () => [30, 50, 10, 90, 0];
  const before = (await pool.query(`SELECT dry_days FROM weather_daily w JOIN weather_cells c ON c.id = w.cell_id WHERE w.day = $1 ORDER BY c.id LIMIT 1`, [addDays(today, -10)])).rows[0].dry_days;
  await updateWeather(pool, { fetch: fakeOpenMeteo(today, addDays(today, -5), dry, []), sleep: async () => {} });
  const rows = (await pool.query(`SELECT to_char(day, 'YYYY-MM-DD') AS day, dry_days FROM weather_daily w WHERE w.cell_id = (SELECT min(id) FROM weather_cells)
    AND day > $1 AND day <= $2 ORDER BY day`, [addDays(today, -10), addDays(today, 2)])).rows;
  assert.deepEqual(rows.map(row => row.dry_days), Array.from({ length: 12 }, (_, k) => before + k + 1));
});

test('Open-Meteo errors are retried on 429 and 5xx only; a failed run keeps the last values and logs one line', async () => {
  const snapshot = async () => (await pool.query('SELECT count(*)::int AS n, max(fetched_at) AS at FROM weather_daily')).rows[0];
  const beforeRows = await snapshot();
  let calls = 0;
  const lines: string[] = [];
  const down = (async () => { calls++; return new Response('busy', { status: 503 }); }) as typeof fetch;
  const failed = await updateWeather(pool, { fetch: down, sleep: async () => {}, log: line => lines.push(line) });
  assert.equal(failed.rows, 0);
  assert.equal(failed.failed, failed.requests);
  assert.equal(calls, failed.requests * 4, 'three retries per request');
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /HTTP 503/);
  assert.deepEqual(await snapshot(), beforeRows, 'nothing changed');
  calls = 0;
  const refused = await updateWeather(pool, { fetch: (async () => { calls++; return new Response('bad', { status: 400 }); }) as typeof fetch, sleep: async () => {} });
  assert.equal(calls, refused.requests, 'a 400 is not retried');
  calls = 0;
  const offline = await updateWeather(pool, { fetch: (async () => { calls++; throw new TypeError('fetch failed'); }) as typeof fetch, sleep: async () => {} });
  assert.equal(calls, offline.requests, 'a network error or timeout is not retried either');
  assert.equal(offline.rows, 0);
  // A 429 then an answer: the retry succeeds.
  let first = true;
  const inner = fakeOpenMeteo(today, addDays(today, -5), weather(0), []);
  const busy = (async (input: string | URL | Request) => {
    if (first) { first = false; return new Response('slow down', { status: 429 }); }
    return inner(input);
  }) as typeof fetch;
  const waits: number[] = [];
  const recovered = await updateWeather(pool, { fetch: busy, sleep: async ms => { waits.push(ms); } });
  assert.equal(recovered.failed, 0);
  assert.ok(recovered.rows > 0);
  assert.ok(waits.includes(5000), 'waited before retrying');
});

test('cells mapped before shares were stored get their share on the next run', async () => {
  const mappings = async () => (await pool.query('SELECT cell_id, regency, share FROM weather_cell_regencies ORDER BY cell_id, regency')).rows;
  const before = await mappings();
  await pool.query('UPDATE weather_cell_regencies SET share = NULL WHERE cell_id IN (SELECT id FROM weather_cells ORDER BY id LIMIT 10)');
  assert.ok((await pool.query('SELECT count(*)::int AS n FROM weather_cell_regencies WHERE share IS NULL')).rows[0].n >= 10);
  await ensureCells(pool);
  const after = await mappings();
  assert.equal(after.length, before.length);
  after.forEach((row, index) => near(row.share, before[index].share, `${row.regency} in cell ${row.cell_id}`));
});

test('the weather scheduler is off with an interval of 0', () => {
  const stop = startWeatherScheduler(pool, { info() {}, warn() {}, error() {} } as never, 0);
  assert.equal(typeof stop, 'function');
  stop();
});

// Weather that differs from cell to cell and hour to hour, with decimals and showers, as Open-Meteo answers.
const varied = (source: 'archive' | 'forecast', lat: number, time: string, lon: number) => {
  const hour = Number(time.slice(11, 13)), day = Number(time.slice(8, 10)), place = Math.abs(lon * 7 + lat * 13) % 5;
  return [26.3 + hour / 3.7 + place / 2 + (source === 'forecast' ? 0.4 : 0), 88.5 - hour * 1.9 - place, 4.1 + ((day + Math.round(place)) % 7) * 0.9,
    Math.round(day * 37 + lon * 10) % 360, (hour + day + Math.round(place * 3)) % 11 === 0 ? 2.7 + place : 0];
};
const allRows = async () => (await pool.query(`SELECT cell_id, to_char(day, 'YYYY-MM-DD') AS day, temp_c, rh_pct, wind_kmh, wind_from_deg, rain24h_mm, rain_day_mm,
  dry_days, ffmc, dmc, dc, isi, bui, fwi, forecast, fetched_at FROM weather_daily ORDER BY cell_id, day`)).rows;

test('a spin-up block by block saves the same rows as one block of every cell, and fetches the same archive', async () => {
  // Two months back: 14 locations per archive request, so blocks of 42 cells, and of 14 with a block size of 1.
  const spinUpStart = addDays(today, -60), now = new Date();
  const cells = (await pool.query('SELECT count(*)::int AS n FROM weather_cells')).rows[0].n;
  const spinUp = async (blockSize?: number) => {
    await pool.query('TRUNCATE weather_daily');
    const urls: string[] = [];
    const result = await updateWeather(pool, { fetch: fakeOpenMeteo(today, addDays(today, -5), varied, urls), now, spinUpStart, sleep: async () => {}, blockSize });
    return { result, urls, kinds: urls.map(url => (url.includes('archive-api') ? 'A' : 'F')).join(''), rows: await allRows() };
  };
  const whole = await spinUp(1000), blocks = await spinUp(), small = await spinUp(1);
  assert.deepEqual([whole.result.spinUp, whole.result.failed, whole.result.rows], [cells, 0, cells * 63]);
  assert.equal(whole.rows.length, cells * 63);
  assert.deepEqual(blocks.rows, whole.rows, 'blocks of 42 cells');
  assert.deepEqual(small.rows, whole.rows, 'blocks of 14 cells');
  // The same archive requests in the same order; each block asks for its forecast once its archive is in.
  const archive = (urls: string[]) => urls.filter(url => url.includes('archive-api'));
  assert.equal(archive(whole.urls).length, Math.ceil(cells / 14));
  assert.deepEqual(archive(blocks.urls), archive(whole.urls));
  assert.deepEqual(archive(small.urls), archive(whole.urls));
  assert.equal(whole.kinds, `${'A'.repeat(Math.ceil(cells / 14))}${'F'.repeat(Math.ceil(cells / 50))}`);
  assert.match(blocks.kinds, /^(AAAF)+(A{1,3}F)?$/);
  assert.equal(blocks.kinds.split('F').length - 1, Math.ceil(cells / 42));
  assert.match(small.kinds, /^(AF)+$/);
});
