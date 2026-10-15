import type pg from 'pg';
import { createPool } from './db.js';
import { demoAccounts, demoPassword, resetDemo } from './demo.js';
import { ingestWithFallback } from './ingest.js';
import { migrate } from './migrate.js';
import { loadPeatMask } from './peat.js';
import { loadReference } from './reference.js';

/**
 * Prepares an empty database for the demo: reference data, a week of FIRMS history (or the committed snapshot
 * when FIRMS cannot be reached), then the demo accounts. A database that already has them is left as it is.
 */
export async function seed(pool: pg.Pool) {
  await loadReference(pool);
  if (!(await pool.query('SELECT 1 FROM detections LIMIT 1')).rowCount) await ingestWithFallback(pool, await loadPeatMask(), '7d');
  const present = await pool.query('SELECT 1 FROM users WHERE id = ANY($1::uuid[]) LIMIT 1', [demoAccounts.map(account => account.id)]);
  if (present.rowCount) return false;
  await resetDemo(pool);
  return true;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const pool = createPool();
  try {
    await migrate(pool);
    console.log(await seed(pool)
      ? `Demo accounts ready (mpa|kades|bpbd@titikapi.test). Password: ${demoPassword}`
      : 'The demo is already in this database and was left as it is. To start it over: pnpm db:reset-demo');
  } finally { await pool.end(); }
}
