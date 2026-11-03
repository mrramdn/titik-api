// Shared set-up for the integration tests that write their own rows: a pool on the test database, empty tables and
// direct inserts with exact times and places (FIRMS files only carry minutes).
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createPool } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { loadReference } from '../src/reference.js';
import { lonLatToPixel } from '../src/peat.js';
import { incidentCode } from '../src/ingest.js';

export function testPool() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://titikapi:titikapi@localhost:5442/titikapi_test';
  assert.ok(new URL(url).pathname.endsWith('_test'), 'Integration tests require a dedicated database ending in _test.');
  return createPool(url);
}

/** Migrated, reference data loaded, no satellite data, incidents, accounts or weather. */
export async function emptyDatabase(pool: ReturnType<typeof createPool>) {
  await migrate(pool);
  await loadReference(pool);
  await pool.query('TRUNCATE ingest_runs, detections, incidents, alerts, verifications, subscriptions, push_subscriptions, sessions, assignments RESTART IDENTITY CASCADE');
  await pool.query("DELETE FROM static_sources WHERE kind = 'alarm_palsu'");
  await pool.query('DELETE FROM users');
  const weather = (await pool.query("SELECT to_regclass('weather_daily') AS t")).rows[0].t;
  if (weather) await pool.query('TRUNCATE weather_daily, weather_cell_regencies, weather_cells RESTART IDENTITY');
}

/** 00:00 WIB of a day ("2026-10-23"), as a moment. */
export const wibMidnight = (day: string) => new Date(`${day}T00:00:00+07:00`);

/** The tile (x, y) holding a point at a zoom level. */
export function tileOf(lon: number, lat: number, z: number) {
  const [px, py] = lonLatToPixel(lon, lat, z);
  return { x: Math.floor(px / 256), y: Math.floor(py / 256) };
}

type Pool = ReturnType<typeof createPool>;
export interface DetectionFixture {
  lon: number; lat: number; acqAt: Date; satellite?: string; scan?: number | null; track?: number | null;
  villageId?: string | null; incidentId?: string | null; confidence?: 'low' | 'nominal' | 'high';
}

export async function insertDetection(pool: Pool, d: DetectionFixture) {
  const modis = d.satellite === 'T' || d.satellite === 'A';
  const row = (await pool.query(`INSERT INTO detections (satellite, acq_at, latitude, longitude, geom, geom_m, geom_3857, confidence, confidence_pct, frp, scan, track,
      daynight, village_id, incident_id)
    SELECT $1, $2, $3, $4, g, ST_Transform(g, 32748), ST_Transform(g, 3857), $5, $6, 8.5, $7, $8, 'D', $9, $10
    FROM (SELECT ST_SetSRID(ST_MakePoint($4, $3), 4326) AS g) p RETURNING id`,
  [d.satellite ?? 'N21', d.acqAt, d.lat, d.lon, d.confidence ?? 'nominal', modis ? 60 : null, d.scan === undefined ? (modis ? 1 : 0.4) : d.scan,
    d.track === undefined ? (modis ? 1 : 0.37) : d.track, d.villageId ?? null, d.incidentId ?? null])).rows[0];
  return Number(row.id);
}

export interface IncidentFixture { villageId: string; first: Date; last: Date; lon: number; lat: number; level?: 'tinggi' | 'sedang' | 'rendah'; score?: number }

export async function insertIncident(pool: Pool, i: IncidentFixture) {
  return (await pool.query(`INSERT INTO incidents (code, village_id, first_detected_at, last_detected_at, detection_count, viirs_count, satellites, centroid, centroid_3857,
      level, score, best_confidence)
    SELECT $1, $2, $3, $4, 1, 1, '{N21}', g, ST_Transform(g, 3857), $7, $8, 'nominal' FROM (SELECT ST_SetSRID(ST_MakePoint($5, $6), 4326) AS g) p RETURNING id`,
  [incidentCode(), i.villageId, i.first, i.last, i.lon, i.lat, i.level ?? 'sedang', i.score ?? 40])).rows[0].id as string;
}

/** A signed-in account of the given role; returns its bearer token. */
export async function signIn(pool: Pool, role: 'mpa' | 'kades' | 'bpbd' | 'admin') {
  const token = randomUUID();
  const user = (await pool.query(`INSERT INTO users (name, email, password_hash, role, organization) VALUES ($1, $2, 'x', $3, 'Uji') RETURNING id`,
    [`Akun uji ${role}`, `${role}-${token.slice(0, 8)}@titikapi.test`, role])).rows[0].id;
  await pool.query(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 day')`, [createHash('sha256').update(token).digest('hex'), user]);
  return token;
}

/** A large village and a point well inside it, for rows that must fall in the covered area. */
export async function bigVillage(pool: Pool) {
  const row = (await pool.query(`SELECT id, name, regency, province, ST_X(p) AS lon, ST_Y(p) AS lat FROM (
      SELECT id, name, regency, province, ST_PointOnSurface(geom) AS p FROM villages ORDER BY area_ha DESC LIMIT 1) v`)).rows[0];
  return row as { id: string; name: string; regency: string; province: string; lon: number; lat: number };
}
