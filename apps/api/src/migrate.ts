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

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const pool = createPool();
  try { await migrate(pool); await loadReference(pool); console.log('Database migrations and reference data complete.'); }
  finally { await pool.end(); }
}
