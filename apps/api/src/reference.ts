// Loads the committed reference files (data/*.geojson) into PostGIS. Each file is loaded again only when its
// content changes, so a restart costs one hash per file.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type pg from 'pg';
import { transaction } from './db.js';

export const dataDir = () => resolve(process.env.DATA_DIR ?? resolve(import.meta.dirname, '../../../data'));

async function load(pool: pg.Pool, name: string, work: (client: pg.PoolClient, features: any[]) => Promise<void>) {
  const raw = await readFile(resolve(dataDir(), name), 'utf8');
  const version = createHash('sha256').update(raw).digest('hex').slice(0, 16);
  const current = await pool.query('SELECT version FROM reference_data WHERE name = $1', [name]);
  if (current.rows[0]?.version === version) return false;
  await transaction(pool, async client => {
    await work(client, JSON.parse(raw).features);
    await client.query(`INSERT INTO reference_data (name, version) VALUES ($1, $2)
      ON CONFLICT (name) DO UPDATE SET version = EXCLUDED.version, loaded_at = now()`, [name, version]);
  });
  return true;
}

export async function loadReference(pool: pg.Pool) {
  await load(pool, 'desa-oki.geojson', async (client, features) => {
    // Villages are only ever added or corrected: detections, incidents and subscriptions point at them.
    for (const feature of features) {
      const p = feature.properties;
      await client.query(`INSERT INTO villages (id, name, district, regency, province, geom, center, center_source, area_ha, peat_share)
        SELECT $1, $2, $3, $4, $5, g, COALESCE(ST_SetSRID(ST_MakePoint($7, $8), 4326), ST_PointOnSurface(g)), $9,
          round((ST_Area(g::geography) / 10000)::numeric, 1), $10
        FROM (SELECT ST_Multi(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($6), 4326))) AS g) s
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, district = EXCLUDED.district, regency = EXCLUDED.regency, province = EXCLUDED.province,
          geom = EXCLUDED.geom, center = EXCLUDED.center, center_source = EXCLUDED.center_source, area_ha = EXCLUDED.area_ha, peat_share = EXCLUDED.peat_share`,
      [p.id, p.name, p.district, p.regency, p.province, JSON.stringify(feature.geometry), p.center?.[0] ?? null, p.center?.[1] ?? null,
        p.center ? 'osm' : 'polygon', p.peat_share]);
    }
  });
  await load(pool, 'permukiman-oki.geojson', async (client, features) => {
    await client.query('DELETE FROM settlements');
    for (const feature of features) {
      await client.query('INSERT INTO settlements (id, name, kind, geom) VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326))',
        [feature.properties.id, feature.properties.name, feature.properties.kind, ...feature.geometry.coordinates]);
    }
  });
  await load(pool, 'industri-oki.geojson', async (client, features) => {
    await client.query("DELETE FROM static_sources WHERE kind = 'industri'");
    for (const feature of features) {
      await client.query("INSERT INTO static_sources (kind, label, geom, radius_m) VALUES ('industri', $1, ST_SetSRID(ST_MakePoint($2, $3), 4326), $4)",
        [feature.properties.label, ...feature.geometry.coordinates, feature.properties.radius_m]);
    }
  });
}
