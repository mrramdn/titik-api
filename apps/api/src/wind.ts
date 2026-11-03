// The wind at an incident from Open-Meteo (hourly wind_speed_10m in km/h and wind_direction_10m, where the wind comes
// from), and the villages its smoke may drift toward. Now when the incident was last detected within 24 hours, else
// at the hour of its last detection: the Forecast API serves the last 92 days, the Historical Weather API older ones.
// The panel asks while it opens, so the weather service gets 1.5 seconds; without an answer the wind is left out, and
// an answer that comes later is kept for the next request.
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { object, requireCondition } from './errors.js';
import { ARCHIVE_API, FORECAST_API } from './weather.js';

const HOUR = 3_600_000;
const TIMEOUT_MS = 1_500;
/** Under 5 km/h the air is calm and smoke does not travel far in one direction. */
const CALM_KMH = 5;
/** Villages within 5 km whose centre lies within 30° either side of where the wind blows. */
const REACH_M = 5_000;
const HALF_SECTOR = 30;

/** True when `bearing` lies within `half` degrees of `toward`, across north (350° and 10° are 20° apart). */
export const inSector = (bearing: number, toward: number, half = HALF_SECTOR) => Math.abs(((((bearing - toward + 540) % 360) + 360) % 360) - 180) <= half;

interface WindValue { speedKmh: number; fromDeg: number }
const cache = new Map<string, { at: number; value: WindValue }>();
const pending = new Map<string, Promise<WindValue | null>>();
/** Forgets the winds fetched (one per 0.1° cell and hour, kept an hour). */
export const clearWindCache = () => { cache.clear(); pending.clear(); };

async function fetchWind(url: string, stamp: string, fetchImpl: typeof fetch): Promise<WindValue | null> {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(20_000), headers: { 'user-agent': 'titik-api (incident wind)' } });
    if (!response.ok) return null;
    const hourly = ((await response.json()) as { hourly?: { time?: string[]; wind_speed_10m?: unknown[]; wind_direction_10m?: unknown[] } }).hourly;
    const index = hourly?.time?.indexOf(stamp) ?? -1;
    const speed = hourly?.wind_speed_10m?.[index], from = hourly?.wind_direction_10m?.[index];
    return index < 0 || typeof speed !== 'number' || typeof from !== 'number' ? null : { speedKmh: speed, fromDeg: from };
  } catch {
    return null;
  }
}

/**
 * The wind at the centre of a 0.1° cell at a whole UTC hour; null when Open-Meteo does not answer within 1.5 s. A
 * slow answer (a cold connection) still lands in the cache, so the next request has it; one request per cell and hour.
 */
async function windAt(lon: number, lat: number, hour: Date, fetchImpl: typeof fetch): Promise<WindValue | null> {
  const stamp = hour.toISOString().slice(0, 16);
  const key = `${lon.toFixed(1)},${lat.toFixed(1)},${stamp}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < HOUR) return hit.value;
  let job = pending.get(key);
  if (!job) {
    const where = `latitude=${lat.toFixed(1)}&longitude=${lon.toFixed(1)}&hourly=wind_speed_10m,wind_direction_10m&timezone=GMT`;
    const url = Date.now() - hour.getTime() < 90 * 24 * HOUR
      ? `${FORECAST_API}?${where}&start_hour=${stamp}&end_hour=${stamp}`
      : `${ARCHIVE_API}?${where}&start_date=${stamp.slice(0, 10)}&end_date=${stamp.slice(0, 10)}`;
    job = fetchWind(url, stamp, fetchImpl).then(value => {
      if (value) {
        if (cache.size >= 5000) cache.clear();
        cache.set(key, { at: Date.now(), value });
      }
      return value;
    }).finally(() => { if (pending.get(key) === job) pending.delete(key); });
    pending.set(key, job);
  }
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), TIMEOUT_MS); });
  try { return await Promise.race([job, late]); }
  finally { clearTimeout(timer); }
}

export function installWind(app: FastifyInstance, pool: pg.Pool, fetchImpl?: typeof fetch) {
  app.get('/api/v1/incidents/:id/wind', async request => {
    const id = String(object(request.params).id);
    const byId = /^[0-9a-f-]{36}$/i.test(id);
    const incident = (await pool.query(`SELECT id, village_id, last_detected_at, ST_X(centroid) AS lon, ST_Y(centroid) AS lat FROM incidents
      WHERE ${byId ? 'id = $1::uuid' : 'code = $1'}`, [id])).rows[0];
    requireCondition(incident, 404, 'NOT_FOUND', 'Kejadian tidak ditemukan. Muat ulang daftar kejadian.');
    if (incident.lon === null) return { data: null };
    const now = Date.now();
    const mode = now - incident.last_detected_at.getTime() <= 24 * HOUR ? 'now' : 'detected';
    const hour = new Date(Math.floor((mode === 'now' ? now : incident.last_detected_at.getTime()) / HOUR) * HOUR);
    const wind = await windAt(Math.round(incident.lon * 10) / 10, Math.round(incident.lat * 10) / 10, hour, fetchImpl ?? fetch);
    if (!wind) return { data: null };
    const fromDeg = Math.round(wind.fromDeg) % 360;
    const towardDeg = (fromDeg + 180) % 360;
    const calm = wind.speedKmh < CALM_KMH;
    // Other villages whose polygon is within 5 km of the incident, with the bearing of their centre from the incident.
    const near = calm ? [] : (await pool.query(`SELECT v.id, v.name, ST_Distance(p.g::geography, v.geom::geography) AS m,
        degrees(ST_Azimuth(p.g::geography, v.center::geography)) AS az
      FROM (SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326) AS g) p
      JOIN villages v ON v.geom && ST_Expand(p.g, 0.05) AND ST_DWithin(v.geom::geography, p.g::geography, $3)
      WHERE v.id IS DISTINCT FROM $4`, [incident.lon, incident.lat, REACH_M, incident.village_id])).rows;
    const villages = near.filter(row => row.az !== null && inSector(row.az, towardDeg)).sort((a, b) => a.m - b.m || a.name.localeCompare(b.name)).slice(0, 5)
      .map(row => ({ id: row.id as string, name: row.name as string, distanceM: Math.round(row.m), bearingDeg: Math.round(row.az) % 360 }));
    return { data: { mode, at: hour.toISOString(), speedKmh: Math.round(wind.speedKmh * 10) / 10, fromDeg, towardDeg, calm, villages } };
  });
}
