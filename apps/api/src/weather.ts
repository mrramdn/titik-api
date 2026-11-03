// Fire weather for the danger map: the Canadian FWI System (fwi.ts) on a 0.5° grid over the two provinces, from the
// weather at 12.00 WIB given by Open-Meteo (https://open-meteo.com/en/docs): hourly temperature_2m,
// relative_humidity_2m, wind_speed_10m (km/h), wind_direction_10m and precipitation, with timezone=Asia/Jakarta.
// An hourly precipitation value is the sum of the preceding hour, so the rain of the 24 hours to 12.00 adds the
// values labelled 13.00 the day before through 12.00, and the rain of a WIB day (00–24) the values labelled 01.00
// through 00.00 of the next day.
//
// The codes carry over from day to day. The first run spins them up from 1 April 2026, in the wet season, from the
// standard start values: the Historical Weather API (ERA5, about five days behind) up to the last hour it has, then
// the Forecast API to today and three days ahead. Later runs fetch the last 10 days again with three days ahead and
// recompute from the stored codes of the day before, so model analysis replaces yesterday's forecast. Requests stay
// well inside Open-Meteo's free tier (10,000 calls a day; more than two weeks of data for one location counts as
// several calls). A request that fails keeps the last values of its cells and is reported in one log line.
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type pg from 'pg';
import { createPool } from './db.js';
import { object } from './errors.js';
import { fwiClass, fwiClasses, fwiDay, startMoisture, type FwiClass, type FwiCodes, type Moisture } from './fwi.js';
import { addDays, wibDay } from './geo.js';
import { archiveDate } from './incidents.js';
import { migrate } from './migrate.js';
import { loadReference } from './reference.js';

export const FORECAST_API = 'https://api.open-meteo.com/v1/forecast';
export const ARCHIVE_API = 'https://archive-api.open-meteo.com/v1/archive';
const HOURLY = ['temperature_2m', 'relative_humidity_2m', 'wind_speed_10m', 'wind_direction_10m', 'precipitation'] as const;
export const CELL_SIZE = 0.5;
/** The first day of the spin-up: early April is still the wet season, so the standard start values fit. */
export const SPIN_UP_START = '2026-04-01';
/** Past days fetched again on every run. */
const REFETCH_DAYS = 10;
const FORECAST_DAYS = 3;
/** The Forecast API serves up to 92 past days; older ones come from the archive. */
const MAX_PAST_DAYS = 92;
/** Locations per request. */
const MAX_LOCATIONS = 50;
/**
 * Open-Meteo counts every two weeks of one location as a call (free tier: 600 a minute, 5,000 an hour, 10,000 a day).
 * Long archive requests are kept light, about 64 calls (4 locations for the whole spin-up), and spaced to about 300
 * calls a minute: heavy ones were slowed down past the timeout.
 */
const ARCHIVE_CALLS_PER_REQUEST = 64;
const ARCHIVE_CALLS_PER_MINUTE = 300;
const FORECAST_PAUSE_MS = 2_000;
const RETRY_WAITS = [5_000, 20_000, 60_000];
const LOCK = 4157_2027;
const userAgent = 'titik-api (fire danger map)';

export interface WeatherOptions {
  /** Injected in the tests, which never reach the network. */
  fetch?: typeof fetch;
  now?: Date;
  spinUpStart?: string;
  /** Pause after a Forecast API request, and after an archive request (ms); by default 2 s and the archive pacing. */
  pauseMs?: number;
  archivePauseMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Where a run with failed requests reports, in one line. */
  log?: (message: string) => void;
}
export interface WeatherResult { skipped: boolean; cells: number; rows: number; requests: number; failed: number; spinUp: number }

interface Cell { id: number; lon: number; lat: number }
interface Hour { temp: number; rh: number; wind: number; from: number; rain: number }
/** Hours of one location, keyed 'YYYY-MM-DDTHH:00' in WIB; only hours with every value. */
type Series = Map<string, Hour>;
interface Start { day: string; moisture: Moisture; dryDays: number }
export interface WeatherRow extends FwiCodes {
  cellId: number; day: string; temp: number; rh: number; wind: number; from: number; rain24h: number; rainDay: number; dryDays: number; forecast: boolean;
}

/** SQL: the share of regency `r`'s area that cell `c` covers, from geodesic areas (0 when the two only touch). */
const COVER_SHARE = 'COALESCE(ST_Area(ST_CollectionExtract(ST_Intersection(c.geom, r.geom), 3)::geography) / NULLIF(ST_Area(r.geom::geography), 0), 0)';

/**
 * The grid: every 0.5° cell (edges on whole and half degrees) that overlaps a regency, which regencies it overlaps,
 * and the share of each regency's area it covers (a regency's shares add up to 1). Built once from the regencies; an
 * empty table is built again. Mappings without a share (made before shares were stored) get one.
 */
export async function ensureCells(db: pg.Pool | pg.PoolClient) {
  const count = async () => (await db.query('SELECT count(*)::integer AS n FROM weather_cells')).rows[0].n as number;
  if (!(await count())) {
    await db.query(`INSERT INTO weather_cells (lon, lat, geom)
        SELECT DISTINCT ON (g.i, g.j) (g.i + 0.5) * $1, (g.j + 0.5) * $1, g.geom FROM regencies r, ST_SquareGrid($1, r.geom) g WHERE ST_Intersects(g.geom, r.geom)
      ON CONFLICT (lon, lat) DO NOTHING`, [CELL_SIZE]);
    await db.query(`INSERT INTO weather_cell_regencies (cell_id, regency, share)
        SELECT c.id, r.name, ${COVER_SHARE} FROM weather_cells c JOIN regencies r ON ST_Intersects(c.geom, r.geom)
      ON CONFLICT DO NOTHING`);
  }
  await db.query(`UPDATE weather_cell_regencies m SET share = ${COVER_SHARE} FROM weather_cells c, regencies r
    WHERE m.share IS NULL AND c.id = m.cell_id AND r.name = m.regency`);
  return count();
}

const hourKey = (day: string, hour: number) => `${day}T${String(hour).padStart(2, '0')}:00`;
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** Open-Meteo answers a list for several locations and a single object for one. */
export function parseLocations(body: unknown, count: number): Series[] {
  const list = Array.isArray(body) ? body : [body];
  if (list.length !== count) throw new Error(`Open-Meteo answered ${list.length} locations for ${count}`);
  return list.map(item => {
    const hourly = (item as { hourly?: Record<string, unknown[]> } | null)?.hourly;
    const series: Series = new Map();
    if (!hourly || !Array.isArray(hourly.time)) throw new Error('Open-Meteo answered without hourly data');
    hourly.time.forEach((time, index) => {
      const values = HOURLY.map(name => hourly[name]?.[index]);
      if (typeof time === 'string' && values.every(value => typeof value === 'number' && Number.isFinite(value))) {
        const [temp, rh, wind, from, rain] = values as number[];
        series.set(time, { temp: temp!, rh: rh!, wind: wind!, from: from!, rain: rain! });
      }
    });
    return series;
  });
}

/**
 * One GET with a 20 s timeout and up to three retries, with growing waits, on 429 and 5xx. A timeout or a network
 * error is not retried: the same heavy request would only count again; the next run asks once more.
 */
async function getJson(url: string, fetchImpl: typeof fetch, sleep: (ms: number) => Promise<void>) {
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetchImpl(url, { signal: AbortSignal.timeout(20_000), headers: { 'user-agent': userAgent } });
    } catch (error) {
      throw new Error(`Open-Meteo ${(error as Error).message}`);
    }
    if (response.ok) return response.json() as Promise<unknown>;
    const retry = response.status === 429 || response.status >= 500;
    if (!retry || attempt >= RETRY_WAITS.length) throw new Error(`Open-Meteo HTTP ${response.status}`);
    await sleep(RETRY_WAITS[attempt]!);
  }
}

const coordinates = (cells: Cell[]) => `latitude=${cells.map(cell => cell.lat).join(',')}&longitude=${cells.map(cell => cell.lon).join(',')}`;
export const forecastUrl = (cells: Cell[], pastDays: number) =>
  `${FORECAST_API}?${coordinates(cells)}&hourly=${HOURLY.join(',')}&timezone=Asia%2FJakarta&past_days=${pastDays}&forecast_days=${FORECAST_DAYS}`;
export const archiveUrl = (cells: Cell[], start: string, end: string) =>
  `${ARCHIVE_API}?${coordinates(cells)}&hourly=${HOURLY.join(',')}&timezone=Asia%2FJakarta&start_date=${start}&end_date=${end}&models=era5`;

/**
 * The days after `start` up to the last forecast day, from merged hours: noon values, the rain of the 24 hours to
 * noon, the rain of the WIB day for the dry spell, and the codes chained from the day before. Stops at the first day
 * without its noon hour or a full rain window. The last day's rain lacks its final hour, which lies past the forecast.
 */
export function computeDays(cell: Cell, series: Series, start: Start, today: string): WeatherRow[] {
  const rows: WeatherRow[] = [];
  const last = addDays(today, FORECAST_DAYS - 1);
  let moisture = start.moisture, dryDays = start.dryDays;
  for (let day = addDays(start.day, 1); day <= last; day = addDays(day, 1)) {
    const before = addDays(day, -1), after = addDays(day, 1);
    const noon = series.get(hourKey(day, 12));
    const window = Array.from({ length: 24 }, (_, k) => series.get(k < 11 ? hourKey(before, 13 + k) : hourKey(day, k - 11)));
    if (!noon || window.some(hour => !hour)) break;
    const rain24h = sum(window.map(hour => Math.max(0, hour!.rain)));
    const rainDay = sum(Array.from({ length: 24 }, (_, k) => series.get(k < 23 ? hourKey(day, k + 1) : hourKey(after, 0))).map(hour => Math.max(0, hour?.rain ?? 0)));
    dryDays = rainDay < 1 ? dryDays + 1 : 0;
    const weather = { temp: noon.temp, rh: Math.min(100, Math.max(0, noon.rh)), wind: Math.max(0, noon.wind), rain: rain24h };
    const codes = fwiDay(moisture, weather, cell.lat, Number(day.slice(5, 7)));
    rows.push({ cellId: cell.id, day, temp: weather.temp, rh: weather.rh, wind: weather.wind, from: noon.from, rain24h, rainDay, dryDays, ...codes, forecast: day >= today });
    moisture = codes;
  }
  return rows;
}

/** Hour by hour: the archive (ERA5) where it has every value, else the Forecast API. */
function merge(archive: Series | undefined, forecast: Series | undefined): Series {
  const merged: Series = new Map(forecast ?? []);
  for (const [time, hour] of archive ?? []) merged.set(time, hour);
  return merged;
}

async function save(client: pg.PoolClient, rows: WeatherRow[], fetchedAt: Date) {
  for (let start = 0; start < rows.length; start += 5000) {
    const batch = rows.slice(start, start + 5000);
    const values = (key: keyof WeatherRow) => batch.map(row => row[key]);
    await client.query(`INSERT INTO weather_daily (cell_id, day, temp_c, rh_pct, wind_kmh, wind_from_deg, rain24h_mm, rain_day_mm, dry_days, ffmc, dmc, dc, isi, bui, fwi,
        forecast, fetched_at)
      SELECT u.*, $17::timestamptz FROM unnest($1::integer[], $2::date[], $3::float8[], $4::float8[], $5::float8[], $6::float8[], $7::float8[], $8::float8[], $9::integer[],
        $10::float8[], $11::float8[], $12::float8[], $13::float8[], $14::float8[], $15::float8[], $16::boolean[]) AS u
      ON CONFLICT (cell_id, day) DO UPDATE SET temp_c = EXCLUDED.temp_c, rh_pct = EXCLUDED.rh_pct, wind_kmh = EXCLUDED.wind_kmh,
        wind_from_deg = EXCLUDED.wind_from_deg, rain24h_mm = EXCLUDED.rain24h_mm, rain_day_mm = EXCLUDED.rain_day_mm, dry_days = EXCLUDED.dry_days,
        ffmc = EXCLUDED.ffmc, dmc = EXCLUDED.dmc, dc = EXCLUDED.dc, isi = EXCLUDED.isi, bui = EXCLUDED.bui, fwi = EXCLUDED.fwi,
        forecast = EXCLUDED.forecast, fetched_at = EXCLUDED.fetched_at`,
    [values('cellId'), values('day'), values('temp'), values('rh'), values('wind'), values('from'), values('rain24h'), values('rainDay'), values('dryDays'),
      values('ffmc'), values('dmc'), values('dc'), values('isi'), values('bui'), values('fwi'), values('forecast'), fetchedAt]);
  }
}

/**
 * Fetches the weather and recomputes the FWI codes of every cell, from the stored codes of the day before the first
 * day fetched again (or from the start values on the first run). One run at a time (advisory lock).
 */
export async function updateWeather(pool: pg.Pool, options: WeatherOptions = {}): Promise<WeatherResult> {
  const fetchImpl = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const now = options.now ?? new Date();
  const today = wibDay(now);
  const client = await pool.connect();
  const result: WeatherResult = { skipped: false, cells: 0, rows: 0, requests: 0, failed: 0, spinUp: 0 };
  try {
    if (!(await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK])).rows[0].ok) return { ...result, skipped: true };
    try {
      await ensureCells(client);
      const cells = (await client.query('SELECT id, lon, lat FROM weather_cells ORDER BY id')).rows as Cell[];
      result.cells = cells.length;
      // The stored codes to start from: the latest day, or the day before the refetched days when that is later.
      const stored = new Map<number, Start>((await client.query(`SELECT w.cell_id, to_char(w.day, 'YYYY-MM-DD') AS day, w.ffmc, w.dmc, w.dc, w.dry_days
        FROM (SELECT cell_id, least(max(day), $1::date) AS day FROM weather_daily GROUP BY cell_id) s
        JOIN weather_daily w ON w.cell_id = s.cell_id AND w.day = s.day`, [addDays(today, -REFETCH_DAYS)])).rows
        .map((row): [number, Start] => [row.cell_id, { day: row.day, moisture: { ffmc: row.ffmc, dmc: row.dmc, dc: row.dc }, dryDays: row.dry_days }]));
      const spinUpFrom = addDays(options.spinUpStart ?? SPIN_UP_START, -1);
      const starts = new Map(cells.map(cell => [cell.id, stored.get(cell.id) ?? { day: spinUpFrom, moisture: startMoisture, dryDays: 0 }]));
      result.spinUp = cells.filter(cell => !stored.has(cell.id)).length;
      // Cells that start on the same day share requests. The archive serves what the Forecast API no longer has.
      const groups = new Map<string, Cell[]>();
      for (const cell of cells) {
        const start = starts.get(cell.id)!;
        const archive = !stored.has(cell.id) || start.day < addDays(today, -MAX_PAST_DAYS);
        const key = `${start.day}|${archive}`;
        groups.set(key, [...(groups.get(key) ?? []), cell]);
      }
      const series = new Map<number, Series>();
      const failures: string[] = [];
      // Each request waits out the pause the one before it asked for.
      let pause = 0;
      const request = async (url: string, chunk: Cell[], pauseAfter: number) => {
        if (pause) await sleep(pause);
        pause = pauseAfter;
        result.requests++;
        try { return parseLocations(await getJson(url, fetchImpl, sleep), chunk.length); }
        catch (error) { result.failed++; failures.push((error as Error).message); return null; }
      };
      for (const [key, group] of groups) {
        const [startDay, archive] = [key.split('|')[0]!, key.endsWith('true')];
        const archived = new Map<number, Series>();
        let pastDays = Math.min(MAX_PAST_DAYS, Math.max(REFETCH_DAYS, Math.round((Date.parse(today) - Date.parse(startDay)) / 86_400_000)));
        if (archive) {
          const days = Math.round((Date.parse(today) - Date.parse(startDay)) / 86_400_000);
          const weight = Math.max(1, days / 14);
          const size = Math.max(1, Math.min(MAX_LOCATIONS, Math.floor(ARCHIVE_CALLS_PER_REQUEST / weight)));
          const archivePause = options.archivePauseMs ?? Math.ceil(((size * weight) / ARCHIVE_CALLS_PER_MINUTE) * 60_000);
          let lastDay: string | null = null;
          for (let k = 0; k < group.length; k += size) {
            const chunk = group.slice(k, k + size);
            const answer = await request(archiveUrl(chunk, startDay, addDays(today, -1)), chunk, archivePause);
            answer?.forEach((hours, index) => {
              archived.set(chunk[index]!.id, hours);
              const latest = [...hours.keys()].at(-1)?.slice(0, 10);
              if (latest && (!lastDay || latest < lastDay)) lastDay = latest;
            });
          }
          // The Forecast API covers from the last day the archive has for every cell of the group (92 days at most).
          pastDays = lastDay ? Math.min(MAX_PAST_DAYS, Math.max(REFETCH_DAYS, Math.round((Date.parse(today) - Date.parse(lastDay)) / 86_400_000))) : MAX_PAST_DAYS;
        }
        for (let k = 0; k < group.length; k += MAX_LOCATIONS) {
          const chunk = group.slice(k, k + MAX_LOCATIONS);
          const answer = await request(forecastUrl(chunk, pastDays), chunk, options.pauseMs ?? FORECAST_PAUSE_MS);
          chunk.forEach((cell, index) => {
            if (answer || archived.has(cell.id)) series.set(cell.id, merge(archived.get(cell.id), answer?.[index]));
          });
        }
      }
      const rows = cells.flatMap(cell => (series.has(cell.id) ? computeDays(cell, series.get(cell.id)!, starts.get(cell.id)!, today) : []));
      if (rows.length) {
        await client.query('BEGIN');
        try { await save(client, rows, now); await client.query('COMMIT'); }
        catch (error) { await client.query('ROLLBACK'); throw error; }
        clearRiskCache();
      }
      result.rows = rows.length;
      if (failures.length) {
        options.log?.(`Open-Meteo: ${result.failed} of ${result.requests} weather requests failed (${[...new Set(failures)].join('; ')}); their cells keep the last values.`);
      }
      return result;
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK]).catch(() => {});
    }
  } finally {
    client.release();
  }
}

const risk = new Map<string, { at: number; body: unknown }>();
/** Forgets the fire danger answers, so the next request shows the weather just saved. */
export const clearRiskCache = () => risk.clear();
const round1 = (value: number) => Math.round(value * 10) / 10;

/** A cell's day as the API returns it. The class follows the FWI as returned (one decimal), so the two always agree. */
function riskDay(row: Record<string, any>) {
  const codes = { ffmc: round1(row.ffmc), dmc: round1(row.dmc), dc: round1(row.dc), isi: round1(row.isi), bui: round1(row.bui), fwi: round1(row.fwi) };
  return { date: row.day as string, forecast: row.forecast as boolean, fwiClass: fwiClass(codes.fwi), codes,
    noon: { tempC: round1(row.temp_c), rhPct: Math.round(row.rh_pct), windKmh: round1(row.wind_kmh), windFromDeg: Math.round(row.wind_from_deg) % 360,
      rain24hMm: round1(row.rain24h_mm) },
    dryDays: row.dry_days as number };
}

/** One cell under a regency on one day: the share of the regency's area it covers, its FWI, and whether that is a forecast. */
export interface CoverCell { weight: number; fwi: number; forecast: boolean }
export interface RegencyRiskDay {
  date: string; forecast: boolean; fwiClass: FwiClass; shares: Record<FwiClass, number>;
  partial: { fwiClass: FwiClass; share: number } | null; meanFwi: number;
}
/**
 * `partial` names the highest class above the largest one that, together with the classes above it, covers at least
 * 10% of the regency (in thousandths): the same test the dashboard card uses for tinggi or above.
 */
const PARTIAL_MIN = 100;

/**
 * A regency's fire danger on one day, by area. `shares`: the share of its area in each class, over the cells that
 * have the day (normalised to add up to 1), in thousandths by largest remainder so they add up exactly. Each cell's
 * class follows its FWI to one decimal, as on the grid. `fwiClass`: the class with the largest share, the higher one
 * on a tie. `partial`: the highest class above it that, with the classes above it, covers at least 10% of the regency,
 * and that combined share; null when there is none. `meanFwi`: the area-weighted mean FWI, one decimal. `forecast` when any of the cells' values is a
 * forecast. Null when no cell covering it has the day.
 */
export function regencyDay(date: string, cells: CoverCell[]): RegencyRiskDay | null {
  const covered = cells.filter(cell => cell.weight > 0 && Number.isFinite(cell.fwi));
  const total = sum(covered.map(cell => cell.weight));
  if (!(total > 0)) return null;
  const weights = fwiClasses.map(() => 0);
  for (const cell of covered) weights[fwiClasses.indexOf(fwiClass(round1(cell.fwi)))]! += cell.weight;
  const exact = weights.map(weight => (1000 * weight) / total);
  const units = exact.map(value => Math.floor(value));
  // The thousandths left over go to the largest remainders, the higher class first on a tie.
  const order = fwiClasses.map((_, index) => index).sort((a, b) => (exact[b]! - units[b]!) - (exact[a]! - units[a]!) || b - a);
  for (let k = 0, left = 1000 - sum(units); k < left; k++) units[order[k % order.length]!]! += 1;
  let top = 0;
  units.forEach((value, index) => { if (value >= units[top]!) top = index; });
  let partial: RegencyRiskDay['partial'] = null;
  for (let index = fwiClasses.length - 1; index > top && !partial; index--) {
    const atOrAbove = sum(units.slice(index));
    if (atOrAbove >= PARTIAL_MIN) partial = { fwiClass: fwiClasses[index]!, share: atOrAbove / 1000 };
  }
  return {
    date, forecast: covered.some(cell => cell.forecast), fwiClass: fwiClasses[top]!,
    shares: Object.fromEntries(fwiClasses.map((name, index) => [name, units[index]! / 1000])) as Record<FwiClass, number>,
    partial, meanFwi: round1(sum(covered.map(cell => cell.weight * cell.fwi)) / total),
  };
}

/**
 * Fire danger per cell and per regency: live, today and the two days after (WIB); with `tanggal`, that archive day
 * only. A regency's day is told by area (regencyDay), from the share of its area each overlapping cell covers.
 * `peatShare` is the share of the regency's village area on peat. Answers are kept 10 minutes per day and dropped
 * after every weather run.
 */
export function installRisk(app: FastifyInstance, pool: pg.Pool) {
  app.get('/api/v1/risk', async request => {
    const tanggal = await archiveDate(pool, object(request.query ?? {}).tanggal);
    const asOf = tanggal ?? wibDay();
    const key = `${asOf}/${tanggal ? 'archive' : 'live'}`;
    const cached = risk.get(key);
    if (cached && Date.now() - cached.at < 600_000) return cached.body;
    const days = tanggal ? [tanggal] : [asOf, addDays(asOf, 1), addDays(asOf, 2)];
    const rows = (await pool.query(`SELECT c.id, c.lon, c.lat, to_char(w.day, 'YYYY-MM-DD') AS day, w.temp_c, w.rh_pct, w.wind_kmh, w.wind_from_deg, w.rain24h_mm,
        w.dry_days, w.ffmc, w.dmc, w.dc, w.isi, w.bui, w.fwi, w.forecast, w.fetched_at
      FROM weather_daily w JOIN weather_cells c ON c.id = w.cell_id WHERE w.day = ANY($1::date[]) ORDER BY c.lat DESC, c.lon, w.day`, [days])).rows;
    type CellDays = { lon: number; lat: number; days: ReturnType<typeof riskDay>[] };
    const cells = new Map<number, CellDays>();
    // Each cell's row of a day, keyed "cell id/day".
    const cellDays = new Map<string, Record<string, any>>();
    let fetchedAt: Date | null = null;
    for (const row of rows) {
      const cell: CellDays = cells.get(row.id) ?? { lon: row.lon, lat: row.lat, days: [] };
      cell.days.push(riskDay(row));
      cells.set(row.id, cell);
      cellDays.set(`${row.id}/${row.day}`, row);
      if (!fetchedAt || row.fetched_at > fetchedAt) fetchedAt = row.fetched_at;
    }
    const regencies = rows.length ? (await pool.query(`SELECT r.name, r.province, ST_X(r.center) AS lon, ST_Y(r.center) AS lat, COALESCE(p.share, 0) AS peat,
        COALESCE(m.cells, '{}') AS cells, COALESCE(m.shares, '{}') AS shares
      FROM regencies r
      LEFT JOIN (SELECT regency, sum(peat_share * area_ha) / NULLIF(sum(area_ha), 0) AS share FROM villages GROUP BY regency) p ON p.regency = r.name
      LEFT JOIN (SELECT regency, array_agg(cell_id ORDER BY cell_id) AS cells, array_agg(share ORDER BY cell_id) AS shares
        FROM weather_cell_regencies WHERE share > 0 GROUP BY regency) m ON m.regency = r.name
      ORDER BY r.province, r.name`)).rows.map(regency => ({
      name: regency.name as string, province: regency.province as string, center: [regency.lon, regency.lat] as [number, number],
      peatShare: Math.round(Number(regency.peat) * 1000) / 1000,
      days: days.flatMap(day => {
        const cover = (regency.cells as number[]).flatMap((id, index): CoverCell[] => {
          const row = cellDays.get(`${id}/${day}`);
          return row ? [{ weight: Number(regency.shares[index]), fwi: row.fwi as number, forecast: row.forecast as boolean }] : [];
        });
        const result = regencyDay(day, cover);
        return result ? [result] : [];
      }),
    })) : [];
    const body = { data: { asOf, archive: Boolean(tanggal), fetchedAt: (fetchedAt as Date | null)?.toISOString() ?? null, cellSize: CELL_SIZE,
      cells: [...cells.values()].map(cell => ({ lon: cell.lon, lat: cell.lat, days: cell.days })), regencies } };
    risk.set(key, { at: Date.now(), body });
    return body;
  });
}

/**
 * Updates the weather inside the API process every WEATHER_INTERVAL_MINUTES (180 by default; 0 switches it off),
 * the first time 30 seconds after start. A failure is logged and never stops the process. Returns a stop function.
 */
export function startWeatherScheduler(pool: pg.Pool, log: FastifyBaseLogger, minutes = Number(process.env.WEATHER_INTERVAL_MINUTES ?? 180)) {
  if (!minutes || minutes <= 0) return () => {};
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  const tick = async () => {
    try {
      const result = await updateWeather(pool, { log: message => log.warn(message) });
      if (!result.skipped) log.info(result, 'Weather update finished');
    } catch (error) {
      log.error({ err: error }, 'Weather update failed');
    }
    if (!stopped) timer = setTimeout(tick, minutes * 60_000);
  };
  timer = setTimeout(tick, 30_000);
  return () => { stopped = true; clearTimeout(timer); };
}

// node dist/weather.js update fetches the weather now and recomputes the fire danger codes.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const pool = createPool();
  try {
    if (process.argv[2] !== 'update') {
      console.log('Usage: node dist/weather.js update');
      process.exitCode = 1;
    } else {
      await migrate(pool);
      await loadReference(pool);
      console.log(JSON.stringify(await updateWeather(pool, { log: message => console.warn(message) })));
    }
  } finally { await pool.end(); }
}
