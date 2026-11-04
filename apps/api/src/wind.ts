// The wind at an incident from Open-Meteo (hourly wind_speed_10m in km/h and wind_direction_10m, where the wind comes
// from), and the villages its smoke may drift toward. Now when the incident was last detected within 24 hours, else
// at the hour of its last detection: the Forecast API serves the last 92 days, the Historical Weather API older ones.
// The panel asks while it opens, so the weather service gets 1.5 seconds; without an answer the wind is left out, and
// an answer that comes later is kept for the next request.
//
// The fire danger run uses the server's Open-Meteo allowance too (600 calls a minute, 5,000 an hour and 10,000 a day
// per IP), so a visitor walking through incidents must not use it up. The route has its own limit per address, the
// process sends at most 60 wind calls a minute and 2,000 a UTC day, a failed lookup is not tried again for 10 minutes,
// and an HTTP 429 stops every wind lookup for 15. An older incident's hour comes with the whole UTC day of its 0.1° cell
// in one call, kept a day as past hours do not change: walking through the archive costs one call per cell and day.
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { object, requireCondition } from './errors.js';
import { addressKey, utcDay } from './imagery.js';
import { ARCHIVE_API, FORECAST_API } from './weather.js';

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const TIMEOUT_MS = 1_500;
/** A failed lookup is not tried again for this long; after an HTTP 429 no lookup is made for longer. */
const FAILED_MS = 10 * MINUTE;
const PAUSE_MS = 15 * MINUTE;
/** Winds kept at most; past it the oldest go first. */
export const MAX_WINDS = 5_000;
/** Under 5 km/h the air is calm and smoke does not travel far in one direction. */
const CALM_KMH = 5;
/** Villages within 5 km whose centre lies within 30° either side of where the wind blows. */
const REACH_M = 5_000;
const HALF_SECTOR = 30;

/** True when `bearing` lies within `half` degrees of `toward`, across north (350° and 10° are 20° apart). */
export const inSector = (bearing: number, toward: number, half = HALF_SECTOR) => Math.abs(((((bearing - toward + 540) % 360) + 360) % 360) - 180) <= half;

export interface WindOptions {
  /** Injected in the tests, which never reach the network. */
  fetch: typeof fetch;
  /** Calls to Open-Meteo for winds per minute and per UTC day, across the process; past either the wind is left out. */
  perMinute: number;
  perDay: number;
  now: () => number;
}
export const windDefaults = (): WindOptions => ({ fetch, perMinute: 60, perDay: 2_000, now: Date.now });

/** Entries kept until they expire, at most `max`: past it the oldest go first. */
export class ExpiringMap<V> {
  private entries = new Map<string, { expires: number; value: V }>();
  constructor(private readonly max: number) {}
  get(key: string, now: number) {
    const entry = this.entries.get(key);
    if (entry && entry.expires <= now) { this.entries.delete(key); return undefined; }
    return entry;
  }
  set(key: string, value: V, expires: number) {
    this.entries.delete(key);
    this.entries.set(key, { expires, value });
    for (const oldest of this.entries.keys()) {
      if (this.entries.size <= this.max) break;
      this.entries.delete(oldest);
    }
  }
  clear() { this.entries.clear(); }
  get size() { return this.entries.size; }
}

interface WindValue { speedKmh: number; fromDeg: number }
/** The winds of a cell by UTC hour ('2026-11-03T05:00'): one hour, or a whole day. */
type Series = Map<string, WindValue>;
/** Winds fetched, by cell and hour (kept an hour) or by cell and day (kept a day); null for a failed lookup (10 minutes). */
const cache = new ExpiringMap<Series | null>(MAX_WINDS);
const pending = new Map<string, Promise<Series | null>>();
/** Calls to Open-Meteo in the last minute and on the current UTC day, and the day whose budget ran out (logged once). */
const sent = { recent: [] as number[], day: '', today: 0, warned: '' };
/** No lookup until then: Open-Meteo answered 429. */
let pausedUntil = -Infinity;
/** Counts the clears: a lookup that was in flight during one changes nothing after it. */
let generation = 0;
/** Forgets the winds and failures, the calls counted, a pause, and what the lookups in flight would bring. */
export const clearWindCache = () => {
  cache.clear(); pending.clear();
  Object.assign(sent, { recent: [], day: '', today: 0, warned: '' });
  pausedUntil = -Infinity;
  generation++;
};

/** One call to Open-Meteo: the hours it answered with both values, or why it failed (an HTTP status, else null). */
async function fetchSeries(url: string, fetchImpl: typeof fetch): Promise<{ series: Series } | { status: number | null }> {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(20_000), headers: { 'user-agent': 'titik-api (incident wind)' } });
    if (!response.ok) {
      response.body?.cancel().catch(() => {});
      return { status: response.status };
    }
    const hourly = ((await response.json()) as { hourly?: Record<string, unknown> } | null)?.hourly;
    const [times, speeds, froms] = [hourly?.time, hourly?.wind_speed_10m, hourly?.wind_direction_10m];
    const series: Series = new Map();
    if (Array.isArray(times) && Array.isArray(speeds) && Array.isArray(froms)) {
      times.forEach((time, k) => {
        const speed = speeds[k], from = froms[k];
        if (typeof time === 'string' && typeof speed === 'number' && typeof from === 'number') series.set(time, { speedKmh: speed, fromDeg: from });
      });
    }
    // An answer without a single usable hour fails too.
    return series.size ? { series } : { status: response.status };
  } catch {
    // A timeout, a network error, or a body that is not JSON.
    return { status: null };
  }
}

export function installWind(app: FastifyInstance, pool: pg.Pool, options: Partial<WindOptions> = {}) {
  const settings: WindOptions = { ...windDefaults(), ...options };

  /** Counts a call to Open-Meteo, or refuses it past the minute's or the day's budget (the day's logged once). */
  function takeCall(now: number) {
    const day = utcDay(now);
    if (sent.day !== day) Object.assign(sent, { day, today: 0 });
    sent.recent = sent.recent.filter(at => at > now - MINUTE);
    if (sent.today >= settings.perDay) {
      if (sent.warned !== day) {
        sent.warned = day;
        app.log.warn({ perDay: settings.perDay }, 'Open-Meteo wind lookups stopped until the next UTC day: their daily budget is used');
      }
      return false;
    }
    if (sent.recent.length >= settings.perMinute) return false;
    sent.recent.push(now);
    sent.today++;
    return true;
  }

  /**
   * The wind at the centre of a 0.1° cell at a whole UTC hour, or null: the lookup failed or was not allowed, or Open-Meteo
   * did not answer within 1.5 s (a slow answer still lands in the cache for the next request). A live hour costs one call
   * kept an hour; an older one comes with its whole UTC day, one call kept a day.
   */
  async function windAt(lon: number, lat: number, hour: Date, live: boolean): Promise<WindValue | null> {
    const now = settings.now();
    const stamp = hour.toISOString().slice(0, 16), day = stamp.slice(0, 10);
    const cell = `${lon.toFixed(1)},${lat.toFixed(1)}`;
    const key = live ? `${cell},${stamp}` : `${cell},${day}`;
    const hit = cache.get(key, now);
    if (hit) return hit.value?.get(stamp) ?? null;
    let job = pending.get(key);
    if (!job) {
      if (now < pausedUntil || !takeCall(now)) return null;
      const where = `latitude=${lat.toFixed(1)}&longitude=${lon.toFixed(1)}&hourly=wind_speed_10m,wind_direction_10m&timezone=GMT`;
      const url = live ? `${FORECAST_API}?${where}&start_hour=${stamp}&end_hour=${stamp}`
        : `${now - Date.parse(`${day}T00:00:00Z`) < 90 * DAY ? FORECAST_API : ARCHIVE_API}?${where}&start_date=${day}&end_date=${day}`;
      const started = generation;
      job = fetchSeries(url, settings.fetch).then(result => {
        const series = 'series' in result ? result.series : null;
        if (started !== generation) return series;
        const done = settings.now();
        if (!('series' in result) && result.status === 429 && done >= pausedUntil) {
          pausedUntil = done + PAUSE_MS;
          app.log.warn({ minutes: PAUSE_MS / MINUTE }, 'Open-Meteo answered 429: wind lookups pause');
        }
        cache.set(key, series, done + (!series ? FAILED_MS : live ? HOUR : DAY));
        return series;
      }).finally(() => { if (pending.get(key) === job) pending.delete(key); });
      pending.set(key, job);
    }
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), TIMEOUT_MS); });
    try { return (await Promise.race([job, late]))?.get(stamp) ?? null; }
    finally { clearTimeout(timer); }
  }

  // Its own limit per address, an IPv6 client counted by its /64: the panel asks once as it opens.
  app.get('/api/v1/incidents/:id/wind', { config: { rateLimit: { max: 30, timeWindow: '1 minute', keyGenerator: request => addressKey(request.ip) } } }, async request => {
    const id = String(object(request.params).id);
    const byId = /^[0-9a-f-]{36}$/i.test(id);
    const incident = (await pool.query(`SELECT id, village_id, last_detected_at, ST_X(centroid) AS lon, ST_Y(centroid) AS lat FROM incidents
      WHERE ${byId ? 'id = $1::uuid' : 'code = $1'}`, [id])).rows[0];
    requireCondition(incident, 404, 'NOT_FOUND', 'Kejadian tidak ditemukan. Muat ulang daftar kejadian.');
    if (incident.lon === null) return { data: null };
    const now = settings.now();
    const live = now - incident.last_detected_at.getTime() <= 24 * HOUR;
    const hour = new Date(Math.floor((live ? now : incident.last_detected_at.getTime()) / HOUR) * HOUR);
    const wind = await windAt(Math.round(incident.lon * 10) / 10, Math.round(incident.lat * 10) / 10, hour, live);
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
    return { data: { mode: live ? 'now' : 'detected', at: hour.toISOString(), speedKmh: Math.round(wind.speedKmh * 10) / 10, fromDeg, towardDeg, calm, villages } };
  });
}
