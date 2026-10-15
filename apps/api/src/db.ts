import pg from 'pg';

export function createPool(connectionString = process.env.DATABASE_URL) {
  return new pg.Pool(connectionString ? { connectionString, max: 10 } : {
    host: process.env.PGHOST ?? 'localhost',
    port: Number(process.env.PGPORT ?? 5442),
    user: process.env.PGUSER ?? 'titikapi',
    password: process.env.PGPASSWORD ?? 'titikapi',
    database: process.env.PGDATABASE ?? 'titikapi',
    max: 10,
  });
}

export async function transaction<T>(pool: pg.Pool, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
