// A deploy stops the server while a FIRMS ingest may be under way. The ingest lets go of its lock and its database
// client within a second, so the server closes before Docker kills it, and its run is closed as stopped: neither left
// looking as if it still ran nor counted as a success.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app.js';
import { feedActive, feeds, feedUrl } from '../src/firms.js';
import { ingest } from '../src/ingest.js';
import { startScheduler } from '../src/scheduler.js';
import { STOPPED_RUN } from '../src/status.js';
import { bigVillage, emptyDatabase, insertDetection, insertIncident, testPool } from './fixtures.js';

const pool = testPool();
let app: FastifyInstance;
let directory: string;
let village: Awaited<ReturnType<typeof bigVillage>>;
const peat = { isPeat: () => false };
// A FIRMS row inside the big village, at the start of the minute an hour ago.
const acquired = new Date(Math.floor((Date.now() - 3600_000) / 60_000) * 60_000);
const header = 'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight';
const csv = (satellite: string) => `${header}\n${village.lat.toFixed(5)},${village.lon.toFixed(5)},340.1,0.4,0.37,${acquired.toISOString().slice(0, 10)},`
  + `${acquired.toISOString().slice(11, 13)}${acquired.toISOString().slice(14, 16)},${satellite},nominal,2.0NRT,295.2,6.5,D`;
const lines: string[] = [];
const log = { info: (_: unknown, message: string) => lines.push(message), warn() {}, error: (_: unknown, message: string) => lines.push(message) } as never;

/** Whether another run could take the ingest lock now (it is taken and given back at once). */
async function lockFree() {
  const probe = await pool.connect();
  try {
    const ok = (await probe.query('SELECT pg_try_advisory_lock(41572026) AS ok')).rows[0].ok as boolean;
    if (ok) await probe.query('SELECT pg_advisory_unlock(41572026)');
    return ok;
  } finally { probe.release(); }
}
const lastRun = async () => (await pool.query('SELECT id, finished_at, error, feeds, inserted FROM ingest_runs ORDER BY id DESC LIMIT 1')).rows[0];
const detections = async () => (await pool.query('SELECT count(*)::int AS n FROM detections')).rows[0].n as number;
const until = async (what: string, ok: () => Promise<boolean> | boolean) => {
  for (let tries = 0; !(await ok()); tries++) { assert.ok(tries < 250, what); await new Promise(resolve => setTimeout(resolve, 20)); }
};

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'titikapi-shutdown-'));
  await emptyDatabase(pool);
  village = await bigVillage(pool);
  app = (await createApp({ pool, uploadsDir: join(directory, 'uploads'), webDir: join(directory, 'web'), logger: false, imagery: { key: undefined } })).app;
});
after(async () => { if (app) await app.close(); await pool.end(); if (directory) await rm(directory, { recursive: true, force: true }); });

test('a stop during a FIRMS download returns within a second, saves nothing, lets go of the lock and its client, and closes the run as stopped', async () => {
  const success = (await pool.query(`INSERT INTO ingest_runs (source, started_at, finished_at) VALUES ('live', now() - interval '11 minutes', now() - interval '10 minutes')
    RETURNING id, finished_at`)).rows[0];
  // NOAA-21 answers at once; NOAA-20 is held, as a slow FIRMS holds it, until the request is cut off.
  const asked: string[] = [];
  let held = false;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    asked.push(String(input));
    if (String(input) === feedUrl(feeds[0]!, '24h')) return new Response(csv('N21'));
    held = true;
    return new Promise<Response>((_, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true }));
  }) as typeof fetch;
  const stop = startScheduler(pool, log, 30, { fetchImpl, firstRunMs: 0 });
  await until('the second download is under way', () => held);
  const stopping = Date.now();
  await stop();
  assert.ok(Date.now() - stopping < 1000, `returned ${Date.now() - stopping} ms after the stop`);
  assert.deepEqual(asked, [feedUrl(feeds[0]!, '24h'), feedUrl(feeds[1]!, '24h')], 'the feeds after it are not asked for');
  assert.ok(feeds.filter(feed => feedActive(feed)).length > 2);
  assert.ok(await lockFree(), 'the lock is free');
  assert.equal(pool.totalCount, pool.idleCount, 'the client is back in the pool');
  assert.equal(await detections(), 0, 'the row NOAA-21 delivered is not saved');
  const run = await lastRun();
  assert.ok(run.finished_at, 'the run is closed');
  assert.equal(run.error, STOPPED_RUN);
  assert.deepEqual(run.feeds.map((feed: { satellite: string; inArea: number }) => [feed.satellite, feed.inArea]), [['N21', 1]]);
  assert.ok(lines.includes('FIRMS ingest stopped'));
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM ingest_runs WHERE finished_at IS NULL')).rows[0].n, 0);

  // The status leaves the stopped run out: the last check and the last success are the run before it.
  const status = (await app.inject({ method: 'GET', url: '/api/v1/ingest/status' })).json().data;
  assert.deepEqual([status.runId, status.lastRun, status.nextRunAt], [Number(success.id), { finishedAt: success.finished_at.toISOString(), ok: true, error: null }, null]);
  assert.ok(!status.runs.some((item: { id: number }) => item.id === Number(run.id)));
  const health = await app.inject({ method: 'GET', url: '/api/v1/health/data' });
  assert.deepEqual([health.statusCode, health.json().data.lastSuccessAt], [200, success.finished_at.toISOString()]);
  const again = Date.now();
  await stop();
  assert.ok(Date.now() - again < 100, 'a second stop returns at once');
});

test('a stop while the run saves cuts the statement under way short and rolls back, within a second', async () => {
  // An incident with one NOAA-21 detection; the run brings a NOAA-20 detection at the same place and minute, which joins
  // that incident. A row lock on the incident holds the run once it moves the detection there, as a slow statement would.
  const incident = await insertIncident(pool, { villageId: village.id, first: acquired, last: acquired, lon: village.lon, lat: village.lat });
  await insertDetection(pool, { lon: Number(village.lon.toFixed(5)), lat: Number(village.lat.toFixed(5)), acqAt: acquired, villageId: village.id, incidentId: incident });
  const before = await detections();
  const holder = await pool.connect();
  const stopping = new AbortController();
  let running: Promise<Awaited<ReturnType<typeof ingest>>> | undefined;
  try {
    await holder.query('BEGIN');
    await holder.query('SELECT id FROM incidents WHERE id = $1 FOR UPDATE', [incident]);
    running = ingest(pool, { source: 'fixture', texts: { N20: csv('N20') }, peat, signal: stopping.signal });
    await until('the run waits for the incident', async () => (await pool.query(`SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`)).rows[0].n === 1);
    const asked = Date.now();
    stopping.abort();
    const result = await Promise.race([running, new Promise<null>(resolve => setTimeout(() => resolve(null), 2000))]);
    assert.ok(result, 'the run returned');
    assert.ok(Date.now() - asked < 1000, `returned ${Date.now() - asked} ms after the stop`);
    assert.deepEqual([result.stopped, result.skipped, result.inserted, result.alerts.length], [true, false, 0, 0]);
    assert.ok(await lockFree(), 'the lock is free');
  } finally {
    await holder.query('ROLLBACK');
    holder.release();
    await running;
  }
  assert.equal(await detections(), before, 'the NOAA-20 detection is rolled back');
  assert.equal((await pool.query('SELECT detection_count FROM incidents WHERE id = $1', [incident])).rows[0].detection_count, 1);
  const run = await lastRun();
  assert.deepEqual([Boolean(run.finished_at), run.error, run.inserted], [true, STOPPED_RUN, 0]);
  assert.equal(pool.totalCount, pool.idleCount, 'every client is back in the pool');
});

test('a run left open by a process that was killed is closed as stopped by the next run', async () => {
  const orphan = (await pool.query(`INSERT INTO ingest_runs (source, started_at) VALUES ('live', now() - interval '2 hours') RETURNING id`)).rows[0].id;
  const result = await ingest(pool, { source: 'fixture', texts: {}, peat });
  assert.deepEqual([result.skipped, result.stopped], [false, false]);
  const row = (await pool.query('SELECT finished_at, error FROM ingest_runs WHERE id = $1', [orphan])).rows[0];
  assert.deepEqual([Boolean(row.finished_at), row.error], [true, STOPPED_RUN]);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM ingest_runs WHERE finished_at IS NULL')).rows[0].n, 0);
  assert.equal((await lastRun()).error, null, 'the run itself succeeded');
});
