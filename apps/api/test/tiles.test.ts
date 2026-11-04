import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app.js';
import { TileCache } from '../src/incidents.js';
import { emptyDatabase, testPool } from './fixtures.js';

const pool = testPool();
let directory: string;
const open: FastifyInstance[] = [];
async function tileApp() {
  // No ArcGIS key, whatever the environment holds: these tests never reach Esri.
  const { app } = await createApp({ pool, uploadsDir: join(directory, 'uploads'), webDir: join(directory, 'web'), logger: false, imagery: { key: undefined } });
  open.push(app);
  return app;
}
const tile = (app: FastifyInstance, path: string, remoteAddress = '127.0.0.1') => app.inject({ method: 'GET', url: `/api/v1/tiles/${path}`, remoteAddress });

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

test('the tile cache drops the least recently used tiles once it holds too many bytes', () => {
  const cache = new TileCache(3 * (1000 + 256));
  const body = () => Buffer.alloc(1000);
  cache.set('a', body(), 60_000); cache.set('b', body(), 60_000); cache.set('c', body(), 60_000);
  assert.ok(cache.get('a'), 'a is used again, b is now the oldest');
  cache.set('d', body(), 60_000);
  assert.equal(cache.get('b'), undefined);
  assert.ok(cache.get('a') && cache.get('c') && cache.get('d'));
  assert.equal(cache.totalBytes, 3 * 1256);
  cache.clear();
  assert.equal(cache.totalBytes, 0);
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
  assert.equal(cache.totalBytes, 2 * (180 + 256));
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
  assert.equal(cache.totalBytes, 2 * 356);
  // d expires behind b and c, which are fresh: it stays until the sweep.
  cache.set('d', body(), 1_000);
  now += 30_000;
  cache.set('e', body(), 3_600_000);
  assert.equal(cache.count, 4, 'b c d e: the last sweep was less than a minute ago');
  now += 30_000;
  cache.set('f', body(), 3_600_000);
  assert.equal(cache.count, 4, 'b c e f: a minute on, the sweep took d');
  assert.equal(cache.totalBytes, 4 * 356);
  assert.ok(cache.get('b') && cache.get('f'));
  now += 3_600_000;
  assert.equal(cache.get('b'), undefined, 'a tile asked for after it expired is gone too');
  assert.equal(cache.count, 3);
});
