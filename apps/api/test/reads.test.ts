import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type pg from 'pg';
import { createApp } from '../src/app.js';
import { heavyReads, readLimits, type ReadLimits } from '../src/incidents.js';
import { account, bigVillage, emptyDatabase, testPool, type Account } from './fixtures.js';

const pool = testPool();
let directory: string;
let bpbd: Account;
let village: Awaited<ReturnType<typeof bigVillage>>;
const open: FastifyInstance[] = [];
async function readApp(reads: Partial<ReadLimits> = {}, db: pg.Pool = pool) {
  // No ArcGIS key, whatever the environment holds: these tests never reach Esri.
  const { app } = await createApp({ pool: db, uploadsDir: join(directory, 'uploads'), webDir: join(directory, 'web'), logger: false, imagery: { key: undefined }, reads });
  open.push(app);
  return app;
}
/** A GET from an address; with `demo`, as the demo BPBD account that anyone can open. */
const get = (app: FastifyInstance, url: string, remoteAddress = '127.0.0.1', demo = false) =>
  app.inject({ method: 'GET', url: `/api/v1${url}`, remoteAddress, headers: demo ? { authorization: `Bearer ${bpbd.token}` } : {} });
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => Promise<boolean>, what: string) {
  for (let k = 0; k < 300; k++) {
    if (await check()) return;
    await sleep(10);
  }
  assert.fail(`timed out waiting for ${what}`);
}
/** Holds every query on incidents until the returned function runs: lists and counts wait in the database. */
async function holdIncidents() {
  const client = await pool.connect();
  await client.query('BEGIN');
  await client.query('LOCK TABLE incidents IN ACCESS EXCLUSIVE MODE');
  return async () => { await client.query('COMMIT'); client.release(); };
}
/** Queries of the app on incidents in the database right now, running or waiting for the lock. */
const listQueries = async () => Number((await pool.query(`SELECT count(*) AS n FROM pg_stat_activity
  WHERE datname = current_database() AND pid <> pg_backend_pid() AND state = 'active' AND query LIKE '%FROM incidents i%'`)).rows[0].n);
/** The answer, or a failure after two seconds: without a gate a read would wait on the held table as long as the test. */
const soon = <T>(answer: Promise<T>) => Promise.race([answer, sleep(2_000).then(() => assert.fail('no answer within two seconds'))]);
/** A refused read: kept nowhere, to be asked for again in two seconds. */
function refused(response: LightMyRequestResponse) {
  assert.equal(response.statusCode, 503, response.body);
  assert.equal(response.headers['retry-after'], '2');
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(response.json().error, { code: 'BUSY', message: 'Server sedang sibuk. Coba lagi beberapa detik lagi.' });
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'titikapi-reads-'));
  await emptyDatabase(pool);
  bpbd = await account(pool, 'bpbd', 'demo');
  village = await bigVillage(pool);
});
after(async () => {
  for (const app of open) await app.close();
  await pool.end();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('with heavy reads held, a list past the gate gets 503 at once or when the wait runs out, and /health answers at once', async () => {
  assert.deepEqual(readLimits, { running: 3, waiting: 32, waitMs: 10_000, perAddress: 8 }, 'the limits in production');
  const app = await readApp({ running: 2, waiting: 1, waitMs: 1_000 });
  const release = await holdIncidents();
  const started = Date.now();
  const answers: { response: LightMyRequestResponse; ms: number }[] = [];
  // Five lists from five addresses, as three visitors within the general limit used to send: two run, one waits.
  const asked = Array.from({ length: 5 }, (_, k) => get(app, `/incidents?hours=${[24, 72, 168][k % 3]}&limit=${100 + k}`, `203.0.113.${150 + k}`)
    .then(response => { answers.push({ response, ms: Date.now() - started }); }));
  try {
    await until(async () => answers.length === 2, 'the lists refused at once');
    for (const { response, ms } of answers) {
      refused(response);
      assert.ok(ms < 700, `refused after ${ms} ms`);
    }
    const asking = Date.now();
    const health = await app.inject({ method: 'GET', url: '/api/v1/health' });
    assert.equal(health.statusCode, 200);
    assert.ok(Date.now() - asking < 500, `/health took ${Date.now() - asking} ms`);
    assert.equal(await listQueries(), 2, 'the gate lets two lists run; the pool keeps the rest');
    await until(async () => answers.length === 3, 'the list whose wait ran out');
    refused(answers[2]!.response);
    assert.ok(answers[2]!.ms >= 900, `waited ${answers[2]!.ms} ms`);
  } finally {
    await release();
  }
  await Promise.all(asked);
  assert.deepEqual(answers.slice(3).map(({ response }) => response.statusCode), [200, 200], 'the two held lists finish');
});

test('one address has its places at the read gate: past them a read is 503 at once, while another address still waits its turn', async () => {
  const app = await readApp({ running: 1, waiting: 64, perAddress: 2 });
  const release = await holdIncidents();
  const a = '2001:db8:31:1::1';
  const served = [get(app, '/incidents', a)];
  try {
    await until(async () => (await listQueries()) === 1, 'the first list');
    served.push(get(app, '/summary', '2001:db8:31:1:ffff::2'));
    await sleep(100);
    refused(await soon(get(app, '/regions/summary', '2001:db8:31:1::3')));
    served.push(get(app, '/regions/summary', '2001:db8:31:2::1'), get(app, '/villages', '198.51.100.31'));
    await sleep(100);
  } finally {
    await release();
  }
  assert.deepEqual((await Promise.all(served)).map(response => response.statusCode), [200, 200, 200, 200]);
});

test('every heavy read passes the gate, and the cheap or cached ones do not', async () => {
  const app = await readApp({ running: 1, waiting: 0 });
  // Cached before the gate fills: the archive days and the fire danger map answer from their caches.
  for (const url of ['/archive/days', '/risk']) assert.equal((await get(app, url)).statusCode, 200, url);
  const release = await holdIncidents();
  const first = get(app, '/incidents?hours=168');
  try {
    await until(async () => (await listQueries()) === 1, 'the list holding the gate');
    const heavy = ['/summary', '/regions/summary', '/villages?q=a', `/villages/${village.id}`, '/dashboard?range=7d', '/recap', '/export/groundcheck.csv?range=7d'];
    assert.deepEqual(heavy.map(url => `/api/v1${url.split('?')[0]!.replace(village.id, ':id')}`), heavyReads.slice(1), 'every route of heavyReads is asked for here');
    for (const url of heavy) refused(await soon(get(app, url, '198.51.100.32', true)));
    for (const url of ['/health', '/regions', '/config', '/archive/days', '/risk', '/auth/me']) assert.equal((await soon(get(app, url, '198.51.100.32', true))).statusCode, 200, url);
  } finally {
    await release();
  }
  assert.equal((await first).statusCode, 200);
});

test('a read whose client has gone leaves the gate\'s line at once', async () => {
  const app = await readApp({ running: 1, waiting: 1, waitMs: 5_000 });
  const release = await holdIncidents();
  const first = get(app, '/incidents', '203.0.113.41');
  let next: Promise<LightMyRequestResponse>;
  try {
    await until(async () => (await listQueries()) === 1, 'the first list');
    const client = new AbortController();
    const waiting = app.inject({ method: 'GET', url: '/api/v1/summary', remoteAddress: '203.0.113.42', signal: client.signal }).catch((error: { code?: string }) => error.code);
    await sleep(100);
    refused(await soon(get(app, '/summary', '203.0.113.43')));
    client.abort();
    assert.equal(await waiting, 'ABORT_ERR');
    next = get(app, '/summary', '203.0.113.43');
    await sleep(100);
  } finally {
    await release();
  }
  assert.deepEqual([(await first).statusCode, (await next).statusCode], [200, 200]);
});

test('a recap runs its queries one after another, so it holds one connection like every other heavy read', async () => {
  let running = 0, most = 0;
  const tracking = new Proxy(pool, {
    get(target, name) {
      const value = Reflect.get(target, name, target);
      if (name === 'query') return async (...args: unknown[]) => {
        most = Math.max(most, ++running);
        try { return await value.apply(target, args); } finally { running--; }
      };
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const app = await readApp({}, tracking);
  assert.equal((await get(app, '/recap', '127.0.0.1', true)).statusCode, 200);
  assert.equal(most, 1);
});
