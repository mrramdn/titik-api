import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { requireCondition, choice, object } from './errors.js';
import { cardText, type CardIncident, type Level } from './geo.js';
import type { Database } from './models.js';

/** Incident columns plus its village and coordinates, ready for incidentModel. */
export const incidentSelect = `SELECT i.*, ST_X(i.centroid) AS lon, ST_Y(i.centroid) AS lat,
  v.name AS village_name, v.district AS village_district, ST_X(v.center) AS village_lon, ST_Y(v.center) AS village_lat
  FROM incidents i LEFT JOIN villages v ON v.id = i.village_id`;

export function cardIncident(row: Record<string, any>): CardIncident {
  return { detectionCount: row.detection_count, centroid: [row.lon, row.lat], onPeat: row.on_peat, lastDetectedAt: row.last_detected_at,
    satellites: row.satellites, bestConfidence: row.best_confidence, level: row.level as Level, nearStatic: row.near_static };
}

export function incidentModel(row: Record<string, any>) {
  const village = row.village_id ? { id: row.village_id, name: row.village_name, district: row.village_district, center: [row.village_lon, row.village_lat] as [number, number] } : null;
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

export function installIncidents(app: FastifyInstance, pool: pg.Pool) {
  let villageShapes: string | null = null;
  app.get('/api/v1/villages.geojson', async (_request, reply) => {
    villageShapes ??= JSON.stringify((await pool.query(`SELECT json_build_object('type','FeatureCollection','features', COALESCE(json_agg(json_build_object(
        'type','Feature','id', id,'properties', json_build_object('id', id, 'name', name, 'district', district, 'peatShare', peat_share),
        'geometry', ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.0002), 5)::json) ORDER BY id), '[]'::json)) AS fc FROM villages`)).rows[0].fc);
    reply.header('Cache-Control', 'public, max-age=3600').type('application/json');
    return villageShapes;
  });

  app.get('/api/v1/villages', async () => {
    const result = await pool.query(`SELECT v.id, v.name, v.district, v.peat_share, v.area_ha, ST_X(v.center) AS lon, ST_Y(v.center) AS lat,
        count(i.id) FILTER (WHERE i.last_detected_at > now() - interval '24 hours')::integer AS incidents_24h,
        count(i.id) FILTER (WHERE i.last_detected_at > now() - interval '7 days')::integer AS incidents_7d,
        count(i.id) FILTER (WHERE i.last_detected_at > now() - interval '24 hours' AND i.level = 'tinggi' AND i.first_verified_at IS NULL)::integer AS open_high
      FROM villages v LEFT JOIN incidents i ON i.village_id = v.id GROUP BY v.id ORDER BY v.district, v.name`);
    return { data: result.rows.map(row => ({ id: row.id, name: row.name, district: row.district, peatShare: Number(row.peat_share), areaHa: Number(row.area_ha),
      center: [row.lon, row.lat], incidents24h: row.incidents_24h, incidents7d: row.incidents_7d, openHigh: row.open_high })) };
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

  app.get('/api/v1/detections', async request => {
    const query = object(request.query ?? {});
    const hours = hoursParam(query.hours, 24, 168);
    const result = await pool.query(`SELECT json_build_object('type','FeatureCollection','features', COALESCE(json_agg(json_build_object('type','Feature',
        'geometry', json_build_object('type','Point','coordinates', json_build_array(round(longitude::numeric, 5), round(latitude::numeric, 5))),
        'properties', json_build_object('satellite', satellite, 'acqAt', acq_at, 'confidence', confidence, 'frp', frp, 'onPeat', on_peat,
          'nearStatic', near_static, 'villageId', village_id, 'incidentId', incident_id, 'daynight', daynight)) ORDER BY acq_at), '[]'::json)) AS fc
      FROM detections WHERE acq_at > now() - make_interval(hours => $1)`, [hours]);
    return { data: result.rows[0].fc };
  });

  app.get('/api/v1/incidents', async request => {
    const query = object(request.query ?? {});
    const hours = hoursParam(query.hours, 72, 168);
    const level = query.level === undefined ? null : choice(query.level, ['tinggi', 'sedang', 'rendah'] as const, 'Level');
    const village = query.village === undefined ? null : String(query.village);
    const result = await pool.query(`${incidentSelect} WHERE i.last_detected_at > now() - make_interval(hours => $1)
      AND ($2::text IS NULL OR i.level = $2) AND ($3::text IS NULL OR i.village_id = $3)
      ORDER BY (i.first_verified_at IS NULL AND i.level = 'tinggi') DESC, i.score DESC, i.last_detected_at DESC LIMIT 300`, [hours, level, village]);
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
