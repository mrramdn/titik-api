import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app.js';
import { migrate } from '../src/migrate.js';
import { testPool } from './fixtures.js';

const pool = testPool();
let app: FastifyInstance;
let directory: string;
const get = (url: string) => app.inject({ method: 'GET', url });
/** An ingest run that finished `minutes` ago (and started a minute before). */
async function run(source: 'live' | 'snapshot' | 'fixture', minutes: number, error: string | null = null) {
  const row = (await pool.query(`INSERT INTO ingest_runs (source, started_at, finished_at, error)
    VALUES ($1, now() - make_interval(mins => $2::integer + 1), now() - make_interval(mins => $2::integer), $3) RETURNING id, finished_at`, [source, minutes, error])).rows[0];
  return { id: Number(row.id), finishedAt: (row.finished_at as Date).toISOString() };
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'titikapi-freshness-'));
  await migrate(pool);
  await pool.query('TRUNCATE ingest_runs RESTART IDENTITY');
  app = (await createApp({ pool, uploadsDir: join(directory, 'uploads'), webDir: join(directory, 'web'), logger: false, imagery: { key: undefined } })).app;
});
after(async () => { if (app) await app.close(); await pool.end(); if (directory) await rm(directory, { recursive: true, force: true }); });

test('data health is stale until a live ingest run succeeds, then ok for 90 minutes', async () => {
  const none = await get('/api/v1/health/data');
  assert.equal(none.statusCode, 503);
  assert.deepEqual(none.json(), { data: { status: 'stale', lastSuccessAt: null, minutesAgo: null } });
  assert.equal(none.headers['cache-control'], 'no-store');

  const success = await run('live', 30);
  // Later runs that failed, or that did not read the live feeds, leave the last success where it was.
  await run('live', 10, 'Semua sumber FIRMS gagal diambil. Data terakhir tetap tampil.');
  await run('snapshot', 5);
  await run('fixture', 1);
  const fresh = await get('/api/v1/health/data');
  assert.equal(fresh.statusCode, 200);
  assert.deepEqual(fresh.json(), { data: { status: 'ok', lastSuccessAt: success.finishedAt, minutesAgo: 30 } });
  assert.equal(fresh.headers['cache-control'], 'no-store');

  await pool.query("UPDATE ingest_runs SET finished_at = now() - interval '89 minutes 50 seconds' WHERE id = $1", [success.id]);
  assert.equal((await get('/api/v1/health/data')).json().data.minutesAgo, 89);
  assert.equal((await get('/api/v1/health/data')).statusCode, 200, 'under 90 minutes is still ok');

  await pool.query("UPDATE ingest_runs SET finished_at = now() - interval '90 minutes' WHERE id = $1", [success.id]);
  const stale = await get('/api/v1/health/data');
  assert.equal(stale.statusCode, 503);
  assert.equal(stale.json().data.status, 'stale');
  assert.equal(stale.json().data.minutesAgo, 90);
  assert.ok(stale.json().data.lastSuccessAt);
});

test('liveness stays as it was, and the ingest status gives the same last success', async () => {
  const health = await get('/api/v1/health');
  assert.equal(health.statusCode, 200, 'stale data does not make the server unhealthy');
  assert.deepEqual(health.json(), { data: { status: 'ok' } });
  const status = (await get('/api/v1/ingest/status')).json().data;
  const data = (await get('/api/v1/health/data')).json().data;
  assert.equal(status.lastSuccessAt, data.lastSuccessAt);
  assert.equal(status.lastRun.ok, true, 'the newest run (a fixture) succeeded, yet it is not a live success');
  assert.notEqual(status.lastRun.finishedAt, status.lastSuccessAt);
});
