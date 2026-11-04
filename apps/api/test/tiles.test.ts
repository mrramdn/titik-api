import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TileCache } from '../src/incidents.js';

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
