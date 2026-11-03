import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app.js';
import { testPool } from './fixtures.js';
import { migrate } from '../src/migrate.js';

const pool = testPool();
let app: FastifyInstance;
let directory: string;
const get = (url: string, remoteAddress = '127.0.0.1') => app.inject({ method: 'GET', url, remoteAddress });

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'titikapi-config-'));
  await migrate(pool);
  // No ArcGIS key, whatever the environment holds: these tests never reach Esri (imagery.test.ts covers it).
  app = (await createApp({ pool, uploadsDir: join(directory, 'uploads'), webDir: join(directory, 'web'), logger: false, imagery: { key: undefined } })).app;
});
after(async () => { if (app) await app.close(); await pool.end(); if (directory) await rm(directory, { recursive: true, force: true }); });

test('the public config says whether HD imagery is on and never holds the ArcGIS key', async () => {
  assert.deepEqual((await get('/api/v1/config')).json(), { data: { hdImagery: false, imageryAttribution: null } });
});

test('responses send the origin, never the path, to other sites', async () => {
  for (const url of ['/api/v1/health', '/api/v1/config', '/api/v1/tiles/desa/3/6/4.mvt', '/tidak-ada']) {
    assert.equal((await get(url)).headers['referrer-policy'], 'strict-origin-when-cross-origin', url);
  }
});

test('map tiles have their own limit of 3000 a minute and do not use up the general one', async () => {
  // A client of its own, so the requests of the other tests do not count.
  const client = '192.0.2.10';
  const tile = '/api/v1/tiles/desa/3/6/4.mvt';
  const first = await get(tile, client);
  assert.equal(first.headers['x-ratelimit-limit'], '3000');
  const general = await get('/api/v1/health', client);
  assert.equal(general.headers['x-ratelimit-limit'], '900');
  const remaining = Number(general.headers['x-ratelimit-remaining']);
  let last = first;
  for (let k = 1; k < 3000; k++) last = await get(tile, client);
  assert.equal(last.statusCode, 200, 'the 3000th tile is served');
  const refused = await get(tile, client);
  assert.equal(refused.statusCode, 429);
  assert.equal(refused.json().error.code, 'RATE_LIMITED');
  const after = await get('/api/v1/health', client);
  assert.equal(after.statusCode, 200, 'lists and forms still answer');
  assert.equal(Number(after.headers['x-ratelimit-remaining']), remaining - 1, 'tiles were not counted in the general limit');
});
