import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app.js';
import { ingest, refreshIncidents, refreshRecent } from '../src/ingest.js';
import { addDays, wibDay } from '../src/geo.js';
import { bigVillage, emptyDatabase, insertDetection, insertIncident, signIn, testPool, wibMidnight } from './fixtures.js';

const pool = testPool();
let app: FastifyInstance;
let directory: string;
let bpbd: string;
const day = addDays(wibDay(), -2);
const T = new Date(wibMidnight(day).getTime() + 10 * 3600_000);
const minutes = (n: number) => new Date(T.getTime() + n * 60_000);
const R = 6378137;
let base: { x: number; y: number; lat: number };
let village: Awaited<ReturnType<typeof bigVillage>>;
/** A point `dx`, `dy` Web Mercator metres from the base point. */
const at = (dx: number, dy = 0) => {
  const x = base.x + dx, y = base.y + dy;
  return { lon: (x / R) * (180 / Math.PI), lat: (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI) };
};
const ha = (m2: number) => Math.round(m2 / 1000) / 10;
const area = async (id: string) => {
  const value = (await pool.query('SELECT indicated_area_ha FROM incidents WHERE id = $1', [id])).rows[0].indicated_area_ha;
  return value === null ? null : Number(value);
};
const incidents: Record<string, string> = {};
// Each incident sits on its own row, 3 km north of the one before.
let row = 0;

async function incident(name: string, detections: { dx: number; minute: number; satellite?: string; scan?: number | null; track?: number | null }[]) {
  const dy = 3000 * row++;
  incidents[name] = await insertIncident(pool, { villageId: village.id, first: T, last: T, ...at(0, dy) });
  for (const d of detections) {
    await insertDetection(pool, { ...at(d.dx, dy), acqAt: minutes(d.minute), satellite: d.satellite ?? 'N21', scan: d.scan === undefined ? 0.4 : d.scan,
      track: d.track === undefined ? 0.4 : d.track, villageId: village.id, incidentId: incidents[name] });
  }
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'titikapi-area-'));
  await emptyDatabase(pool);
  village = await bigVillage(pool);
  const x = (village.lon * Math.PI / 180) * R, y = R * Math.log(Math.tan(Math.PI / 4 + (village.lat * Math.PI / 180) / 2));
  base = { x, y, lat: village.lat };
  // A: one NOAA-21 pass of three overlapping 400 m pixels 300 m apart, then a NOAA-20 pass of one pixel.
  await incident('A', [{ dx: 0, minute: 0 }, { dx: 300, minute: 0 }, { dx: 600, minute: 1 }, { dx: 0, minute: 120, satellite: 'N20' }]);
  // B: NOAA-21 at 0 and 25 minutes (one pass; the pixels overlap by half), then 35 minutes later a new pass 1 km east.
  await incident('B', [{ dx: 0, minute: 0 }, { dx: 200, minute: 25 }, { dx: 1000, minute: 60 }]);
  // C: only MODIS (1.2 × 1.1 km). D: VIIRS and MODIS: the area comes from VIIRS alone. E: pixel sizes missing.
  await incident('C', [{ dx: 0, minute: 0, satellite: 'T', scan: 1.2, track: 1.1 }]);
  await incident('D', [{ dx: 0, minute: 0 }, { dx: 300, minute: 40, satellite: 'A', scan: 1, track: 1 }]);
  await incident('E', [{ dx: 0, minute: 0, scan: null, track: null }, { dx: 0, minute: 1, satellite: 'T', scan: null, track: null }]);
  await incident('F', [{ dx: 0, minute: 0, satellite: 'A', scan: null, track: null }]);
  // G has no detections, so no area; H is on another day and has none either.
  incidents.G = await insertIncident(pool, { villageId: village.id, first: T, last: T, ...at(0) });
  incidents.H = await insertIncident(pool, { villageId: village.id, first: new Date(T.getTime() - 86_400_000), last: new Date(T.getTime() - 86_400_000), ...at(0) });
  await refreshIncidents(pool, Object.values(incidents));
  bpbd = await signIn(pool, 'bpbd');
  app = (await createApp({ pool, uploadsDir: join(directory, 'uploads'), webDir: join(directory, 'web'), logger: false })).app;
});
after(async () => { if (app) await app.close(); await pool.end(); if (directory) await rm(directory, { recursive: true, force: true }); });

test('the indicated area is the largest single pass: overlapping pixels count once, passes never add up', async () => {
  const cos = (dy: number) => Math.cos((at(0, dy).lat * Math.PI) / 180);
  // A pixel of 0.4 × 0.4 km covers 16 ha. Pass 1 of A spans 600 m plus one pixel on the Mercator grid.
  assert.equal(await area(incidents.A!), ha((600 * cos(0) + 400) * 400));
  assert.ok(Math.abs((await area(incidents.A!))! - 40) < 0.1, 'about 40 ha, not 3 × 16 + 16');
  // B: the 25-minute gap keeps one pass (union 200 m + one pixel wide); the 35-minute gap starts a new one of 16 ha.
  assert.equal(await area(incidents.B!), ha((200 * cos(3000) + 400) * 400));
  assert.equal(await area(incidents.C!), 132, 'MODIS only: 1.2 × 1.1 km');
  assert.equal(await area(incidents.D!), 16, 'MODIS is left out when VIIRS saw the incident');
  assert.equal(await area(incidents.E!), 14.1, 'VIIRS without pixel size: 375 m');
  assert.equal(await area(incidents.F!), 100, 'MODIS without pixel size: 1 km');
  assert.equal(await area(incidents.G!), null);
  const detail = (await app.inject({ method: 'GET', url: `/api/v1/incidents/${incidents.A}` })).json().data;
  assert.equal(detail.indicatedAreaHa, await area(incidents.A!));
  const list = (await app.inject({ method: 'GET', url: `/api/v1/incidents?hours=24&tanggal=${day}` })).json().data as any[];
  assert.equal(list.find(item => item.id === incidents.G).indicatedAreaHa, null);
  assert.equal(typeof list.find(item => item.id === incidents.C).indicatedAreaHa, 'number');
});

test('the daily recap and the CSV export leave the indicated areas out: added up they would read as burned area', async () => {
  const response = await app.inject({ method: 'GET', url: `/api/v1/recap?date=${day}`, headers: { authorization: `Bearer ${bpbd}` } });
  assert.equal(response.statusCode, 200, response.body);
  const recap = response.json().data;
  assert.equal(recap.totals.incidents, 7, 'A to G');
  assert.deepEqual(recap.regencies.map((r: any) => [r.name, r.incidents]), [[village.regency, 7]]);
  assert.ok(!('indicatedAreaHa' in recap.totals));
  assert.ok(recap.regencies.every((r: any) => !('indicatedAreaHa' in r)));
  assert.doesNotMatch(response.body, /indicatedArea/);
  const csv = await app.inject({ method: 'GET', url: '/api/v1/export/groundcheck.csv?range=7d', headers: { authorization: `Bearer ${bpbd}` } });
  assert.equal(csv.statusCode, 200);
  const header = csv.body.replace('﻿', '').split('\r\n')[0]!;
  assert.doesNotMatch(header, /luas|area|ha\b/, 'the export follows the groundcheck form; an area there would read as burned area');
});

test('a rescore of recent days (the backfill after a deploy) waits for a running ingest and holds the ingest lock while it works', async () => {
  const INGEST_LOCK = 41572026;
  // The ingest lock in this database: how many sessions hold it and how many wait for it.
  const lock = async () => (await pool.query(`SELECT count(*) FILTER (WHERE granted)::int AS held, count(*) FILTER (WHERE NOT granted)::int AS waiting
    FROM pg_locks WHERE locktype = 'advisory' AND objid = $1 AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`, [INGEST_LOCK])).rows[0];
  const until = async (what: string, ok: () => Promise<boolean>) => {
    for (let tries = 0; !(await ok()); tries++) { assert.ok(tries < 250, what); await new Promise(resolve => setTimeout(resolve, 20)); }
  };
  const peat = { isPeat: () => false };
  const ingestRun = await pool.connect(), rowHolder = await pool.connect();
  try {
    await ingestRun.query('SELECT pg_advisory_lock($1)', [INGEST_LOCK]);
    let waited = false, done = false;
    const rescoring = refreshRecent(pool, 8, () => { waited = true; }).then(count => { done = true; return count; });
    await until('the rescore waits for the ingest lock', async () => (await lock()).waiting === 1);
    assert.deepEqual([waited, done], [true, false], 'it waits instead of giving up');
    // A row lock on one of its incidents holds the rescore at its first update once it has the lock.
    await rowHolder.query('BEGIN');
    await rowHolder.query('SELECT id FROM incidents WHERE id = $1 FOR UPDATE', [incidents.A]);
    await ingestRun.query('SELECT pg_advisory_unlock($1)', [INGEST_LOCK]);
    await until('the rescore takes the ingest lock', async () => { const now = await lock(); return now.held === 1 && now.waiting === 0; });
    assert.equal((await ingest(pool, { source: 'fixture', texts: {}, peat })).skipped, true, 'an ingest that starts meanwhile is skipped');
    assert.equal(done, false);
    await rowHolder.query('ROLLBACK');
    assert.equal(await rescoring, 8, 'A to H: detected within the last 8 days');
    assert.deepEqual(await lock(), { held: 0, waiting: 0 }, 'and lets go of the lock');
  } finally {
    ingestRun.release();
    rowHolder.release();
  }
  assert.equal(await area(incidents.A!), ha((600 * Math.cos((at(0).lat * Math.PI) / 180) + 400) * 400), 'the areas are worked out the same again');
});
