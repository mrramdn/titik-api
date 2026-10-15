import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { requireCondition, choice, object } from './errors.js';
import { cardText, type CardIncident, type Level } from './geo.js';
import type { Database } from './models.js';

/** Incident columns plus its village and coordinates, ready for incidentModel. */
export const incidentSelect = `SELECT i.*, ST_X(i.centroid) AS lon, ST_Y(i.centroid) AS lat,
  v.name AS village_name, v.district AS village_district, v.regency AS village_regency, v.province AS village_province,
  ST_X(v.center) AS village_lon, ST_Y(v.center) AS village_lat
  FROM incidents i LEFT JOIN villages v ON v.id = i.village_id`;

export function cardIncident(row: Record<string, any>): CardIncident {
  return { detectionCount: row.detection_count, centroid: [row.lon, row.lat], onPeat: row.on_peat, lastDetectedAt: row.last_detected_at,
    satellites: row.satellites, bestConfidence: row.best_confidence, level: row.level as Level, nearStatic: row.near_static };
}

export function incidentModel(row: Record<string, any>) {
  const village = row.village_id ? { id: row.village_id, name: row.village_name, district: row.village_district, regency: row.village_regency,
    province: row.village_province, center: [row.village_lon, row.village_lat] as [number, number] } : null;
  return {
    id: row.id, code: row.code, village,
    firstDetectedAt: row.first_detected_at.toISOString(), lastDetectedAt: row.last_detected_at.toISOString(),
    detectionCount: row.detection_count, satellites: row.satellites, maxFrp: row.max_frp === null ? null : Number(row.max_frp),
    bestConfidence: row.best_confidence, onPeat: row.on_peat, nearStatic: row.near_static, centroid: [row.lon, row.lat] as [number, number],
    settlementMeters: row.settlement_m, score: row.score, scoreParts: row.score_parts, level: row.level,
    firstVerifiedAt: row.first_verified_at?.toISOString() ?? null, latestStatus: row.latest_status,
    card: village ? cardText(cardIncident(row), { name: village.name, center: village.center }) : null,
    sharePath: `/k/${row.code}`,
  };
}

export async function getIncident(db: Database, idOrCode: string) {
  const byId = /^[0-9a-f-]{36}$/i.test(idOrCode);
  const result = await db.query(`${incidentSelect} WHERE ${byId ? 'i.id = $1::uuid' : 'i.code = $1'}`, [idOrCode]);
  requireCondition(result.rows[0], 404, 'NOT_FOUND', 'Kejadian tidak ditemukan.');
  return result.rows[0];
}

/** Keeps an incident's verification summary in step with its reports. */
export async function refreshVerificationSummary(db: Database, ids: string[]) {
  if (!ids.length) return;
  await db.query(`UPDATE incidents i SET
      first_verified_at = (SELECT min(observed_at) FROM verifications WHERE incident_id = i.id),
      latest_status = (SELECT status FROM verifications WHERE incident_id = i.id ORDER BY observed_at DESC, received_at DESC LIMIT 1)
    WHERE i.id = ANY($1::uuid[])`, [ids]);
}

const hoursParam = (value: unknown, fallback: number, max: number) => {
  const hours = value === undefined ? fallback : Number(value);
  requireCondition(Number.isInteger(hours) && hours >= 1 && hours <= max, 400, 'INVALID_INPUT', `Rentang jam harus 1–${max}.`);
  return hours;
};
const optionalText = (value: unknown) => (value === undefined || value === '' ? null : String(value).slice(0, 80));

/** Where-clause pieces for the province and regency filters, on a query that joins villages as v. */
export function regionFilter(query: Record<string, unknown>, params: unknown[]) {
  const parts: string[] = [];
  const province = optionalText(query.province), regency = optionalText(query.regency);
  if (province) { params.push(province); parts.push(`v.province = $${params.length}`); }
  if (regency) { params.push(regency); parts.push(`v.regency = $${params.length}`); }
  return parts.length ? ` AND ${parts.join(' AND ')}` : '';
}

// Vector tiles cut by PostGIS (ST_AsMVT). Shapes change only with new reference data; hotspots every ingest.
const tileSql = {
  desa: `SELECT ST_AsMVT(q, 'desa', 4096, 'geom') AS mvt FROM (SELECT id, name, district, regency, peat_share,
      ST_AsMVTGeom(geom_3857, ST_TileEnvelope($1, $2, $3), 4096, 64, true) AS geom
    FROM villages WHERE $1 >= 8 AND geom_3857 && ST_TileEnvelope($1, $2, $3, margin => 0.0156)) q`,
  kabupaten: `SELECT ST_AsMVT(q, 'kabupaten', 4096, 'geom') AS mvt FROM (SELECT name, province, villages,
      ST_AsMVTGeom(ST_SimplifyPreserveTopology(geom_3857, CASE WHEN $1 < 7 THEN 400 WHEN $1 < 9 THEN 120 ELSE 30 END), ST_TileEnvelope($1, $2, $3), 4096, 64, true) AS geom
    FROM regencies WHERE geom_3857 && ST_TileEnvelope($1, $2, $3, margin => 0.0156)) q`,
  kejadian: `SELECT ST_AsMVT(q, 'kejadian', 4096, 'geom') AS mvt FROM (SELECT id::text AS id, level, detection_count AS count, score,
      (first_verified_at IS NOT NULL) AS verified, on_peat AS peat, ST_AsMVTGeom(centroid_3857, ST_TileEnvelope($1, $2, $3), 4096, 64, true) AS geom
    FROM incidents WHERE village_id IS NOT NULL AND last_detected_at > now() - make_interval(hours => $4)
      AND centroid_3857 && ST_TileEnvelope($1, $2, $3, margin => 0.0156) ORDER BY score) q`,
  deteksi: `SELECT ST_AsMVT(q, 'deteksi', 4096, 'geom') AS mvt FROM (SELECT confidence, (village_id IS NOT NULL) AS inside,
      ST_AsMVTGeom(geom_3857, ST_TileEnvelope($1, $2, $3), 4096, 64, true) AS geom
    FROM detections WHERE $1 >= 7 AND acq_at > now() - make_interval(hours => $4) AND geom_3857 && ST_TileEnvelope($1, $2, $3, margin => 0.0156)) q`,
} as const;

export function installIncidents(app: FastifyInstance, pool: pg.Pool) {
  const tiles = new Map<string, { at: number; body: Buffer }>();
  app.get('/api/v1/tiles/:layer/:z/:x/:y', async (request, reply) => {
    const params = object(request.params);
    const layer = choice(params.layer, ['desa', 'kabupaten', 'kejadian', 'deteksi'] as const, 'Lapisan');
    const z = Number(params.z), x = Number(params.x), y = Number(String(params.y).replace(/\.mvt$/, ''));
    requireCondition([z, x, y].every(Number.isInteger) && z >= 0 && z <= 16 && x >= 0 && y >= 0 && x < 2 ** z && y < 2 ** z, 400, 'INVALID_INPUT', 'Ubin tidak valid.');
    const live = layer === 'kejadian' || layer === 'deteksi';
    const hours = live ? hoursParam(object(request.query ?? {}).hours, 24, 168) : 0;
    const ttl = live ? 120_000 : 3_600_000;
    const key = `${layer}/${z}/${x}/${y}/${hours}`;
    let entry = tiles.get(key);
    if (!entry || Date.now() - entry.at > ttl) {
      const row = (await pool.query(tileSql[layer], live ? [z, x, y, hours] : [z, x, y])).rows[0];
      entry = { at: Date.now(), body: row?.mvt ?? Buffer.alloc(0) };
      if (tiles.size > 4000) tiles.clear();
      tiles.set(key, entry);
    }
    reply.header('Content-Type', 'application/vnd.mapbox-vector-tile').header('Cache-Control', `public, max-age=${ttl / 1000}`);
    return entry.body;
  });

  app.get('/api/v1/regions', async () => {
    const rows = (await pool.query(`SELECT r.name, r.province, r.villages, ST_XMin(r.geom) AS w, ST_YMin(r.geom) AS s, ST_XMax(r.geom) AS e, ST_YMax(r.geom) AS n
      FROM regencies r ORDER BY r.province, r.name`)).rows;
    const provinces = new Map<string, { name: string; villages: number; bbox: number[]; regencies: { name: string; villages: number; bbox: number[] }[] }>();
    for (const row of rows) {
      const p = provinces.get(row.province) ?? { name: row.province as string, villages: 0, bbox: [180, 90, -180, -90], regencies: [] as { name: string; villages: number; bbox: number[] }[] };
      p.villages += row.villages;
      p.bbox = [Math.min(p.bbox[0]!, row.w), Math.min(p.bbox[1]!, row.s), Math.max(p.bbox[2]!, row.e), Math.max(p.bbox[3]!, row.n)];
      p.regencies.push({ name: row.name, villages: row.villages, bbox: [row.w, row.s, row.e, row.n] });
      provinces.set(row.province, p);
    }
    return { data: [...provinces.values()] };
  });

  app.get('/api/v1/summary', async request => {
    const query = object(request.query ?? {});
    const hours = hoursParam(query.hours, 24, 168);
    const params: unknown[] = [hours];
    const where = regionFilter(query, params);
    const incidents = (await pool.query(`SELECT count(*)::integer AS incidents,
        count(*) FILTER (WHERE i.level = 'tinggi' AND i.first_verified_at IS NULL)::integer AS high_open,
        count(*) FILTER (WHERE i.first_verified_at IS NOT NULL)::integer AS verified,
        count(DISTINCT i.village_id)::integer AS villages
      FROM incidents i JOIN villages v ON v.id = i.village_id WHERE i.last_detected_at > now() - make_interval(hours => $1)${where}`, params)).rows[0];
    const detections = (await pool.query(`SELECT count(*)::integer AS n FROM detections d JOIN villages v ON v.id = d.village_id
      WHERE d.acq_at > now() - make_interval(hours => $1)${where}`, params)).rows[0];
    return { data: { hours, incidents: incidents.incidents, highOpen: incidents.high_open, verified: incidents.verified, villages: incidents.villages, detections: detections.n } };
  });

  app.get('/api/v1/villages', async request => {
    const query = object(request.query ?? {});
    const q = optionalText(query.q);
    const params: unknown[] = [];
    let where = regionFilter(query, params);
    if (q) { params.push(`%${q}%`); where += ` AND (v.name ILIKE $${params.length} OR v.district ILIKE $${params.length} OR v.regency ILIKE $${params.length})`; }
    const result = await pool.query(`SELECT v.id, v.name, v.district, v.regency, v.province, v.peat_share, v.area_ha, ST_X(v.center) AS lon, ST_Y(v.center) AS lat,
        count(i.id) FILTER (WHERE i.last_detected_at > now() - interval '24 hours')::integer AS incidents_24h,
        count(i.id) FILTER (WHERE i.last_detected_at > now() - interval '7 days')::integer AS incidents_7d,
        count(i.id) FILTER (WHERE i.last_detected_at > now() - interval '24 hours' AND i.level = 'tinggi' AND i.first_verified_at IS NULL)::integer AS open_high
      FROM villages v LEFT JOIN incidents i ON i.village_id = v.id WHERE true${where}
      GROUP BY v.id ORDER BY ${q ? 'v.name' : 'incidents_7d DESC, v.name'} LIMIT 60`, params);
    return { data: result.rows.map(row => ({ id: row.id, name: row.name, district: row.district, regency: row.regency, province: row.province,
      peatShare: Number(row.peat_share), areaHa: Number(row.area_ha), center: [row.lon, row.lat], incidents24h: row.incidents_24h, incidents7d: row.incidents_7d, openHigh: row.open_high })) };
  });

  app.get('/api/v1/villages/:id', async request => {
    const id = String(object(request.params).id);
    const village = (await pool.query(`SELECT id, name, district, regency, province, peat_share, area_ha, center_source, ST_X(center) AS lon, ST_Y(center) AS lat,
      ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.0001), 5)::json AS geometry FROM villages WHERE id = $1`, [id])).rows[0];
    requireCondition(village, 404, 'NOT_FOUND', 'Desa tidak ditemukan.');
    const incidents = await pool.query(`${incidentSelect} WHERE i.village_id = $1 AND i.last_detected_at > now() - interval '7 days' ORDER BY i.last_detected_at DESC LIMIT 100`, [id]);
    const daily = await pool.query(`SELECT to_char(day, 'YYYY-MM-DD') AS day, count(d.id)::integer AS detections
      FROM generate_series((now() AT TIME ZONE 'Asia/Jakarta')::date - 6, (now() AT TIME ZONE 'Asia/Jakarta')::date, interval '1 day') AS day
      LEFT JOIN detections d ON d.village_id = $1 AND (d.acq_at AT TIME ZONE 'Asia/Jakarta')::date = day::date
      GROUP BY day ORDER BY day`, [id]);
    return { data: { id: village.id, name: village.name, district: village.district, regency: village.regency, province: village.province,
      peatShare: Number(village.peat_share), areaHa: Number(village.area_ha), center: [village.lon, village.lat], centerSource: village.center_source,
      geometry: village.geometry, incidents: incidents.rows.map(incidentModel), daily: daily.rows } };
  });

  app.get('/api/v1/incidents', async request => {
    const query = object(request.query ?? {});
    const hours = hoursParam(query.hours, 72, 168);
    const params: unknown[] = [hours];
    let where = regionFilter(query, params);
    if (query.level !== undefined) { params.push(choice(query.level, ['tinggi', 'sedang', 'rendah'] as const, 'Level')); where += ` AND i.level = $${params.length}`; }
    if (query.village !== undefined) { params.push(String(query.village)); where += ` AND i.village_id = $${params.length}`; }
    const limit = query.limit === undefined ? 100 : Math.min(300, Math.max(1, Number(query.limit) || 100));
    const result = await pool.query(`${incidentSelect} WHERE i.village_id IS NOT NULL AND i.last_detected_at > now() - make_interval(hours => $1)${where}
      ORDER BY (i.first_verified_at IS NULL AND i.level = 'tinggi') DESC, i.score DESC, i.last_detected_at DESC LIMIT ${limit}`, params);
    return { data: result.rows.map(incidentModel) };
  });

  app.get('/api/v1/incidents/:id', async request => {
    const row = await getIncident(pool, String(object(request.params).id));
    const signedIn = Boolean(request.user);
    const detections = await pool.query(`SELECT id, satellite, acq_at, latitude, longitude, confidence, frp, bright_ti4, daynight, on_peat, near_static
      FROM detections WHERE incident_id = $1 ORDER BY acq_at, id`, [row.id]);
    // The public sees what was found and when; who checked it, their notes and photos are for signed-in teams.
    const verifications = await pool.query(`SELECT v.id, v.status, v.false_alarm_kind, v.observed_at, v.received_at, v.distance_m, v.is_demo,
        v.note, v.photo_url, v.photo_thumb_url, u.name AS reporter, u.role AS reporter_role
      FROM verifications v JOIN users u ON u.id = v.user_id WHERE v.incident_id = $1 ORDER BY v.observed_at DESC`, [row.id]);
    return { data: { ...incidentModel(row),
      detections: detections.rows.map(d => ({ id: Number(d.id), satellite: d.satellite, acqAt: d.acq_at.toISOString(), latitude: d.latitude, longitude: d.longitude,
        confidence: d.confidence, frp: d.frp === null ? null : Number(d.frp), brightTi4: d.bright_ti4 === null ? null : Number(d.bright_ti4), daynight: d.daynight,
        onPeat: d.on_peat, nearStatic: d.near_static })),
      verifications: verifications.rows.map(v => ({ id: v.id, status: v.status, falseAlarmKind: v.false_alarm_kind, observedAt: v.observed_at.toISOString(),
        receivedAt: v.received_at.toISOString(), distanceMeters: v.distance_m, demo: v.is_demo,
        ...(signedIn ? { note: v.note, photoUrl: v.photo_url, photoThumbUrl: v.photo_thumb_url, reporter: v.reporter } : {}) })) } };
  });

  app.get('/api/v1/ingest/status', async () => {
    const runs = await pool.query(`SELECT id, started_at, finished_at, source, feeds, fetched, in_area, inserted, incidents_touched, error
      FROM ingest_runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 5`);
    const latest = await pool.query(`SELECT satellite, max(acq_at) AS latest, count(*) FILTER (WHERE acq_at > now() - interval '24 hours')::integer AS last_24h
      FROM detections GROUP BY satellite ORDER BY satellite`);
    return { data: {
      runs: runs.rows.map(run => ({ id: Number(run.id), startedAt: run.started_at.toISOString(), finishedAt: run.finished_at.toISOString(), source: run.source,
        feeds: run.feeds, fetched: run.fetched, inArea: run.in_area, inserted: run.inserted, incidentsTouched: run.incidents_touched, error: run.error })),
      satellites: latest.rows.map(row => ({ satellite: row.satellite, latestAcquisition: row.latest.toISOString(), last24h: row.last_24h })),
      intervalMinutes: Number(process.env.INGEST_INTERVAL_MINUTES ?? 30),
    } };
  });
}
