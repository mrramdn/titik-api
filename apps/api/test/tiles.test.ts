import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type pg from 'pg';
import { createApp } from '../src/app.js';
import { TileCache, clearTileCache, tileCacheBytes, tileLimits, type TileLimits } from '../src/incidents.js';
import { account, emptyDatabase, testPool } from './fixtures.js';

const pool = testPool();
let directory: string;
const open: FastifyInstance[] = [];
async function tileApp(tiles: Partial<TileLimits> = {}, db: pg.Pool = pool) {
  // No ArcGIS key, whatever the environment holds: these tests never reach Esri.
  const { app } = await createApp({ pool: db, uploadsDir: join(directory, 'uploads'), webDir: join(directory, 'web'), logger: false, imagery: { key: undefined }, tiles });
  open.push(app);
  return app;
}
const tile = (app: FastifyInstance, path: string, remoteAddress = '127.0.0.1') => app.inject({ method: 'GET', url: `/api/v1/tiles/${path}`, remoteAddress });
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => Promise<boolean>, what: string) {
  for (let k = 0; k < 300; k++) {
    if (await check()) return;
    await sleep(10);
  }
  assert.fail(`timed out waiting for ${what}`);
}

/**
 * Holds every query on a table until the returned function runs: on regencies kabupaten tiles wait in the database, on
 * assignments kejadian tiles do.
 */
async function hold(table: 'regencies' | 'assignments') {
  const client = await pool.connect();
  await client.query('BEGIN');
  await client.query(`LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE`);
  return async () => { await client.query('COMMIT'); client.release(); };
}
const holdRegencies = () => hold('regencies');
/** The test pool, counting the tile queries the app sends through it. */
function countingPool() {
  const counted = { queries: 0 };
  const db = new Proxy(pool, {
    get(target, name) {
      const value = Reflect.get(target, name, target);
      if (name === 'query') return (...args: unknown[]) => { if (String(args[0]).includes('ST_AsMVT')) counted.queries++; return value.apply(target, args); };
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { db, counted };
}
/** Tile queries in the database right now, running or waiting for the lock. */
const tileQueries = async () => Number((await pool.query(`SELECT count(*) AS n FROM pg_stat_activity
  WHERE datname = current_database() AND pid <> pg_backend_pid() AND state = 'active' AND query LIKE '%ST\\_AsMVT(q%'`)).rows[0].n);
/** A refused tile: kept nowhere, to be asked for again in two seconds. */
function refused(response: LightMyRequestResponse, status: number, code: string) {
  assert.equal(response.statusCode, status, response.body);
  assert.equal(response.headers['retry-after'], '2');
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.json().error.code, code);
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'titikapi-tiles-'));
  await emptyDatabase(pool);
});
after(async () => {
  for (const app of open) await app.close();
  await pool.end();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('hotspot tiles come for the windows the map offers, 24, 72 or 168 hours; any other is 400', async () => {
  const app = await tileApp();
  for (const layer of ['kejadian', 'deteksi']) {
    for (const hours of ['24', '72', '168']) assert.equal((await tile(app, `${layer}/9/408/264.mvt?hours=${hours}`)).statusCode, 200, `${layer} ${hours}`);
    assert.equal((await tile(app, `${layer}/9/408/264.mvt`)).statusCode, 200, `${layer} without hours: a day`);
    for (const hours of ['137', '48', '1', '169', '0', '24.0001', 'abc']) {
      const refused = await tile(app, `${layer}/9/408/264.mvt?hours=${hours}`);
      assert.equal(refused.statusCode, 400, `${layer} ${hours}`);
      assert.deepEqual(refused.json().error, { code: 'INVALID_INPUT', message: 'Rentang waktu peta harus 24, 72, atau 168 jam. Muat ulang peta.' });
    }
  }
  assert.equal((await tile(app, 'desa/9/408/264.mvt?hours=137')).statusCode, 200, 'shapes take no window');
});

test('with tile queries held, misses past the gate get 503 at once or when the wait runs out, nothing is kept, and /health answers at once', async () => {
  assert.deepEqual(tileLimits, { running: 4, waiting: 64, waitMs: 10_000, perAddress: 12, queuedPerAddress: 100, queued: 200 }, 'the limits in production');
  const app = await tileApp({ running: 2, waiting: 3, waitMs: 1_000 });
  clearTileCache();
  const release = await holdRegencies();
  // Twelve different tiles at once, more than the pool's ten connections: two run, three wait, seven are refused.
  const started = Date.now();
  const answers: { x: number; response: LightMyRequestResponse; ms: number }[] = [];
  const asked = Array.from({ length: 12 }, (_, k) => tile(app, `kabupaten/5/${10 + k}/15.mvt`)
    .then(response => { answers.push({ x: 10 + k, response, ms: Date.now() - started }); }));
  try {
    await until(async () => answers.length === 7, 'the tiles refused at once');
    for (const { response, ms } of answers) {
      refused(response, 503, 'BUSY');
      assert.ok(ms < 700, `refused after ${ms} ms, before the wait could run out`);
    }
    const asking = Date.now();
    const health = await app.inject({ method: 'GET', url: '/api/v1/health' });
    assert.deepEqual([health.statusCode, health.json().data.status], [200, 'ok']);
    assert.ok(Date.now() - asking < 500, `/health took ${Date.now() - asking} ms`);
    assert.equal(await tileQueries(), 2, 'the gate lets two queries run; the pool keeps the rest');
    await until(async () => answers.length === 10, 'the tiles whose wait ran out');
    for (const { response, ms } of answers.slice(7)) {
      refused(response, 503, 'BUSY');
      assert.ok(ms >= 900, `waited ${ms} ms`);
    }
    assert.equal(tileCacheBytes(), 0, 'nothing is kept');
  } finally {
    await release();
  }
  await Promise.all(asked);
  assert.deepEqual(answers.slice(10).map(({ response }) => response.statusCode), [200, 200], 'the two held queries finish');
  for (const { x } of answers.slice(0, 10)) assert.equal((await tile(app, `kabupaten/5/${x}/15.mvt`)).statusCode, 200, 'cut once the gate is free');
});

test('one address has its places at the gate; its further tiles wait their turn, past its line they get 429; an IPv6 client counts by its /64', async () => {
  const app = await tileApp({ running: 1, waiting: 64, waitMs: 5_000, perAddress: 2, queuedPerAddress: 1 });
  clearTileCache();
  const release = await holdRegencies();
  const from = (x: number, ip: string) => tile(app, `kabupaten/5/${x}/15.mvt`, ip);
  const served = [from(20, '2001:db8:7:7::1')];
  try {
    await until(async () => (await tileQueries()) === 1, 'the first tile query');
    // The second place of the /64, waiting at the gate; then one tile waiting for a place, as many as its line holds.
    served.push(from(21, '2001:db8:7:7::2'), from(22, '2001:db8:7:7:ffff::3'));
    await sleep(100);
    refused(await from(23, '2001:db8:7:7::4'), 429, 'RATE_LIMITED');
    // Another /64 and an IPv4 address have places of their own.
    served.push(from(24, '2001:db8:7:8::1'), from(25, '198.51.100.4'));
    await sleep(100);
    assert.equal(await tileQueries(), 1, 'the gate lets one query run');
  } finally {
    await release();
  }
  assert.deepEqual((await Promise.all(served)).map(response => response.statusCode), [200, 200, 200, 200, 200]);
});

test('the line for places is shared by every address up to its size, and a tile still waiting at the deadline gets 503', async () => {
  const app = await tileApp({ running: 1, waiting: 64, waitMs: 400, perAddress: 1, queuedPerAddress: 5, queued: 1 });
  clearTileCache();
  const release = await holdRegencies();
  const first = tile(app, 'kabupaten/5/20/15.mvt', '203.0.113.1');
  try {
    await until(async () => (await tileQueries()) === 1, 'the first tile query');
    // The first address's next tile takes the one place in the line; the second address's first waits at the gate.
    const inLine = tile(app, 'kabupaten/5/21/15.mvt', '203.0.113.1');
    const atGate = tile(app, 'kabupaten/5/22/15.mvt', '203.0.113.2');
    await sleep(100);
    refused(await tile(app, 'kabupaten/5/23/15.mvt', '203.0.113.2'), 429, 'RATE_LIMITED');
    refused(await inLine, 503, 'BUSY');
    refused(await atGate, 503, 'BUSY');
  } finally {
    await release();
  }
  assert.equal((await first).statusCode, 200);
});

test('one tile asked for many times at once runs one query', async () => {
  const { db, counted } = countingPool();
  const app = await tileApp({}, db);
  clearTileCache();
  const release = await holdRegencies();
  // More than one address's places: the rest wait their turn and then find the tile in the cache.
  const asked = Array.from({ length: 20 }, () => tile(app, 'kabupaten/5/25/15.mvt'));
  try {
    await until(async () => (await tileQueries()) === 1, 'the tile query');
    await sleep(100);
    assert.equal(await tileQueries(), 1);
  } finally {
    await release();
  }
  const answers = await Promise.all(asked);
  assert.ok(answers.every(response => response.statusCode === 200));
  assert.ok(answers.every(response => response.rawPayload.equals(answers[0]!.rawPayload)));
  assert.equal(counted.queries, 1);
});

test('a clear of the demo tiles during a public tile\'s query leaves that query shared and its tile kept', async () => {
  const { db, counted } = countingPool();
  const app = await tileApp({}, db);
  clearTileCache();
  const release = await holdRegencies();
  const path = 'kabupaten/5/26/15.mvt';
  const first = tile(app, path);
  let second: Promise<LightMyRequestResponse>;
  try {
    await until(async () => (await tileQueries()) === 1, 'the tile query');
    // A demo account's check or task, as anyone can make one.
    clearTileCache('demo');
    second = tile(app, path, '198.51.100.5');
    await sleep(200);
    assert.equal(await tileQueries(), 1, 'the second request waits for the query already running');
  } finally {
    await release();
  }
  assert.deepEqual([(await first).statusCode, (await second).statusCode], [200, 200]);
  assert.equal((await tile(app, path)).statusCode, 200);
  assert.equal(counted.queries, 1, 'one query, and its tile was kept');
});

test('a clear during a tile\'s query, of all tiles or of the demo ones for a demo tile: later requests run their own, and only theirs is kept', async () => {
  const { db, counted } = countingPool();
  const app = await tileApp({}, db);
  const demo = await account(pool, 'mpa', 'demo');
  // A demo session's own view of checks and tasks; its query reads assignments.
  const demoTile = (path: string) => app.inject({ method: 'GET', url: `/api/v1/tiles/${path}?lihat=demo`, remoteAddress: '203.0.113.30',
    headers: { authorization: `Bearer ${demo.token}` } });
  const cases = [
    { label: 'a demo tile, demo clear', table: 'assignments', ask: () => demoTile('kejadian/9/408/264.mvt'), clear: () => clearTileCache('demo') },
    { label: 'a demo tile, full clear', table: 'assignments', ask: () => demoTile('kejadian/9/409/264.mvt'), clear: () => clearTileCache() },
    { label: 'a public tile, full clear', table: 'regencies', ask: () => tile(app, 'kabupaten/5/27/15.mvt'), clear: () => clearTileCache() },
  ] as const;
  for (const { label, table, ask, clear } of cases) {
    clearTileCache();
    counted.queries = 0;
    const release = await hold(table);
    const first = ask();
    let second: Promise<LightMyRequestResponse>;
    try {
      await until(async () => (await tileQueries()) === 1, `${label}: the first query`);
      clear();
      second = ask();
      await until(async () => (await tileQueries()) === 2, `${label}: the second request runs its own query`);
    } finally {
      await release();
    }
    assert.deepEqual([(await first).statusCode, (await second).statusCode], [200, 200], label);
    assert.equal((await ask()).statusCode, 200);
    assert.equal(counted.queries, 2, `${label}: the tile cut after the clear was kept, the one before it was not`);
  }
});

test('the tile limit of 3000 a minute counts an IPv6 client by its /64', async () => {
  const app = await tileApp();
  const remaining = async (ip: string) => Number((await tile(app, 'desa/3/6/4.mvt', ip)).headers['x-ratelimit-remaining']);
  assert.equal(await remaining('2001:db8:9:9::1'), 2999);
  assert.equal(await remaining('2001:db8:9:9:abcd::2'), 2998, 'another address in the same /64');
  assert.equal(await remaining('2001:db8:9:a::1'), 2999, 'another /64');
  assert.equal(await remaining('203.0.113.9'), 2999);
});

test('the tile cache drops the least recently used tiles once it holds too many bytes, each counted with the 416 bytes its entry holds', () => {
  // 416: what an entry held besides its body on Node 26, the cache at its limit and dropping its oldest.
  const cache = new TileCache(3 * (1000 + 416));
  const body = () => Buffer.alloc(1000);
  cache.set('a', body(), 60_000); cache.set('b', body(), 60_000); cache.set('c', body(), 60_000);
  assert.ok(cache.get('a'), 'a is used again, b is now the oldest');
  cache.set('d', body(), 60_000);
  assert.equal(cache.get('b'), undefined);
  assert.ok(cache.get('a') && cache.get('c') && cache.get('d'));
  assert.equal(cache.totalBytes, 3 * 1416);
  cache.clear();
  assert.equal(cache.totalBytes, 0);
  cache.set('empty', Buffer.alloc(0), 60_000);
  assert.equal(cache.totalBytes, 416, 'an empty tile costs its entry');
});

test('a cached tile owns memory of its own size, so a small one keeps no slab of the shared buffer pool alive', () => {
  const cache = new TileCache(1024 * 1024);
  // What pg hands over for a bytea: Buffer.from(hex), for a small tile a slice of Node's shared pool; and a slice of a
  // 64 KiB slab made by hand, whatever the pool does in this Node.
  const decoded = Buffer.from('1a2b3c'.repeat(60), 'hex');
  const slice = Buffer.from(new ArrayBuffer(65_536), 4_096, 180).fill(7);
  for (const [key, body] of [['decoded', decoded], ['slice', slice]] as const) {
    cache.set(key, body, 60_000);
    const kept = cache.get(key)!;
    assert.deepEqual([kept.byteOffset, kept.buffer.byteLength, kept.length], [0, 180, 180], key);
    assert.ok(kept.equals(body), `${key} keeps its bytes`);
  }
  assert.equal(cache.totalBytes, 2 * (180 + 416));
  // A body that owns all of its memory is kept as it is, an empty tile too.
  const whole = Buffer.allocUnsafeSlow(300).fill(1);
  cache.set('whole', whole, 60_000);
  assert.equal(cache.get('whole'), whole);
  cache.set('empty', Buffer.alloc(0), 60_000);
  assert.equal(cache.get('empty')?.length, 0);
});

test('expired tiles leave without being asked for: at the least recently used end on every set, behind fresher ones at a sweep once a minute', () => {
  let now = 1_000_000;
  const cache = new TileCache(1024 * 1024, () => now);
  const body = () => Buffer.alloc(100);
  cache.set('a', body(), 1_000);
  cache.set('b', body(), 3_600_000);
  now += 2_000;
  cache.set('c', body(), 3_600_000);
  assert.equal(cache.count, 2, 'a expired at the least recently used end and went with the next set');
  assert.equal(cache.totalBytes, 2 * 516);
  // d expires behind b and c, which are fresh: it stays until the sweep.
  cache.set('d', body(), 1_000);
  now += 30_000;
  cache.set('e', body(), 3_600_000);
  assert.equal(cache.count, 4, 'b c d e: the last sweep was less than a minute ago');
  now += 30_000;
  cache.set('f', body(), 3_600_000);
  assert.equal(cache.count, 4, 'b c e f: a minute on, the sweep took d');
  assert.equal(cache.totalBytes, 4 * 516);
  assert.ok(cache.get('b') && cache.get('f'));
  now += 3_600_000;
  assert.equal(cache.get('b'), undefined, 'a tile asked for after it expired is gone too');
  assert.equal(cache.count, 3);
});
