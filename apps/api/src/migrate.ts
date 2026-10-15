import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { createPool, transaction } from './db.js';
import { loadReference } from './reference.js';

export async function migrate(pool: pg.Pool) {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const directory = fileURLToPath(new URL('../migrations/', import.meta.url));
  for (const name of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
    if ((await pool.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name])).rowCount) continue;
    const sql = await readFile(`${directory}/${name}`, 'utf8');
    await transaction(pool, async client => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
    });
  }
}

// A fresh PostGIS container restarts once after creating its database, so the first connections can fail.
const transient = (error: unknown) => {
  const { code, message } = error as { code?: string; message?: string };
  return ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', '57P03'].includes(code ?? '') || /Connection terminated|starting up|shutting down/.test(message ?? '');
};

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const pool = createPool();
  try {
    for (let attempt = 1; ; attempt++) {
      try { await migrate(pool); await loadReference(pool); break; }
      catch (error) {
        if (attempt >= 40 || !transient(error)) throw error;
        console.log(`Database not ready (${(error as Error).message}); retrying.`);
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }
    console.log('Database migrations and reference data complete.');
  } finally { await pool.end(); }
}
