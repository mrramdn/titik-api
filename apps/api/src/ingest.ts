// The pipeline from satellite to alert: fetch FIRMS, keep the pilot area, link each detection to its village,
// flag peat and known hot places, group detections into incidents, score them, and put cards in the inboxes of
// everyone who watches the village. One run at a time (advisory lock), all in one transaction.
import { randomInt } from 'node:crypto';
import type pg from 'pg';
import { createPool } from './db.js';
import { feeds, fetchFeed, parseFirmsCsv, snapshotFeed, type FirmsRow } from './firms.js';
import { scoreIncident } from './geo.js';
import { migrate } from './migrate.js';
import { loadPeatMask, type PeatMask } from './peat.js';
import { dataDir, loadReference } from './reference.js';

export type Source = 'live' | 'snapshot' | 'fixture';
export interface FeedReport { satellite: string; rows: number; inArea: number; latest: string | null; error: string | null }
export interface NewAlert { id: string; userId: string; incidentId: string }
export interface IngestResult { runId: number | null; skipped: boolean; fetched: number; inArea: number; inserted: number; incidents: string[]; alerts: NewAlert[]; feeds: FeedReport[] }
export interface IngestOptions { source: Source; range?: '24h' | '7d'; texts?: Record<string, string>; peat: PeatMask; fetchImpl?: typeof fetch }

const LOCK = 4157_2026;
const codeAlphabet = '23456789abcdefghjkmnpqrstuvwxyz';
export const incidentCode = () => Array.from({ length: 7 }, () => codeAlphabet[randomInt(codeAlphabet.length)]).join('');

async function readFeeds(options: IngestOptions) {
  const range = options.range ?? '24h';
  const reports: FeedReport[] = [];
  const rows: FirmsRow[] = [];
  let fetched = 0;
  for (const feed of feeds) {
    try {
      const text = options.source === 'fixture' ? options.texts?.[feed.satellite] ?? ''
        : options.source === 'snapshot' ? await snapshotFeed(feed, range, dataDir()) : await fetchFeed(feed, range, options.fetchImpl);
      if (!text) { reports.push({ satellite: feed.satellite, rows: 0, inArea: 0, latest: null, error: null }); continue; }
      const parsed = parseFirmsCsv(text);
      const own = parsed.rows.filter(row => row.satellite === feed.satellite);
      fetched += parsed.total;
      rows.push(...own);
      const latest = own.reduce<Date | null>((max, row) => (!max || row.acqAt > max ? row.acqAt : max), null);
      reports.push({ satellite: feed.satellite, rows: parsed.total, inArea: own.length, latest: latest?.toISOString() ?? null, error: null });
    } catch (error) {
      reports.push({ satellite: feed.satellite, rows: 0, inArea: 0, latest: null, error: (error as Error).message });
    }
  }
  return { rows, reports, fetched };
}

/**
 * Groups detections into incidents: single-linkage clusters of points within 750 m of each other on the same
 * day (Western Indonesian Time), found with ST_ClusterDBSCAN on Web Mercator coordinates (within 0.3% of true
 * distance at these latitudes, for both provinces). Only the days that received new detections are
 * clustered again. Adding points can only join clusters, so an existing incident keeps its id; when new points
 * connect two incidents, the older one absorbs the other together with its reports and cards. A peat fire that
 * smoulders for a week therefore becomes one card per day instead of one incident that grows for kilometres.
 */
async function clusterDays(client: pg.PoolClient, newIds: string[], touched: Set<string>) {
  const groups = (await client.query(`WITH days AS (
        SELECT DISTINCT (acq_at AT TIME ZONE 'Asia/Jakarta')::date AS day FROM detections WHERE id = ANY($1::bigint[]) AND village_id IS NOT NULL),
      points AS (
        SELECT d.id, d.incident_id, days.day, d.geom_3857 FROM days
        JOIN detections d ON d.acq_at >= (days.day::timestamp AT TIME ZONE 'Asia/Jakarta') AND d.acq_at < ((days.day + 1)::timestamp AT TIME ZONE 'Asia/Jakarta')
        WHERE d.village_id IS NOT NULL),
      clustered AS (
        SELECT id, incident_id, day, ST_ClusterDBSCAN(geom_3857, eps := 750, minpoints := 1) OVER (PARTITION BY day) AS cluster FROM points)
    SELECT c.day, c.cluster, array_agg(c.id ORDER BY c.id)::text[] AS detections,
      array_remove(array_agg(DISTINCT c.incident_id), NULL)::text[] AS incidents,
      bool_or(c.incident_id IS NULL) AS has_new
    FROM clustered c GROUP BY c.day, c.cluster`, [newIds])).rows as { detections: string[]; incidents: string[]; has_new: boolean }[];
  for (const group of groups) {
    if (!group.has_new && group.incidents.length <= 1) continue;
    let keep: string;
    if (!group.incidents.length) {
      keep = (await client.query(`INSERT INTO incidents (code, village_id, first_detected_at, last_detected_at)
        SELECT $2, village_id, acq_at, acq_at FROM detections WHERE id = $1 RETURNING id`, [group.detections[0], incidentCode()])).rows[0].id;
    } else {
      const ordered = await client.query('SELECT id FROM incidents WHERE id = ANY($1::uuid[]) ORDER BY first_detected_at, id', [group.incidents]);
      keep = ordered.rows[0].id;
      const merged = ordered.rows.slice(1).map(row => row.id as string);
      if (merged.length) {
        await client.query('UPDATE verifications SET incident_id = $1 WHERE incident_id = ANY($2::uuid[])', [keep, merged]);
        await client.query(`INSERT INTO alerts (user_id, incident_id, village_id, created_at, updated_at, read_at, shared_at)
            SELECT DISTINCT ON (user_id) user_id, $1, village_id, created_at, updated_at, read_at, shared_at FROM alerts
            WHERE incident_id = ANY($2::uuid[]) ORDER BY user_id, created_at
          ON CONFLICT (user_id, incident_id) DO NOTHING`, [keep, merged]);
        await client.query('UPDATE detections SET incident_id = $1 WHERE incident_id = ANY($2::uuid[])', [keep, merged]);
        await client.query('DELETE FROM incidents WHERE id = ANY($1::uuid[])', [merged]);
        for (const id of merged) touched.delete(id);
      }
    }
    await client.query('UPDATE detections SET incident_id = $1 WHERE id = ANY($2::bigint[]) AND incident_id IS DISTINCT FROM $1', [keep, group.detections]);
    touched.add(keep);
  }
}

/** Recomputes what an incident is made of, then its score. */
export async function refreshIncidents(client: pg.PoolClient | pg.Pool, ids: string[]) {
  if (!ids.length) return;
  const rows = (await client.query(`WITH a AS (
      SELECT incident_id, min(acq_at) AS first, max(acq_at) AS last, count(*)::integer AS n, max(frp) AS max_frp,
        (array_agg(confidence ORDER BY CASE confidence WHEN 'high' THEN 0 WHEN 'nominal' THEN 1 ELSE 2 END))[1] AS best,
        bool_or(on_peat) AS peat, bool_or(near_static) AS near_static, ST_Centroid(ST_Collect(geom)) AS c,
        array_agg(DISTINCT satellite) AS sats, mode() WITHIN GROUP (ORDER BY village_id) AS village
      FROM detections WHERE incident_id = ANY($1::uuid[]) GROUP BY incident_id)
    UPDATE incidents i SET first_detected_at = a.first, last_detected_at = a.last, detection_count = a.n, max_frp = a.max_frp,
      best_confidence = a.best, on_peat = a.peat, near_static = a.near_static, centroid = a.c, centroid_3857 = ST_Transform(a.c, 3857), satellites = a.sats,
      village_id = COALESCE(a.village, i.village_id), updated_at = now(),
      settlement_m = (SELECT round(ST_Distance(s.geom::geography, a.c::geography))::integer FROM settlements s ORDER BY s.geom <-> a.c LIMIT 1)
    FROM a WHERE i.id = a.incident_id
    RETURNING i.id, i.best_confidence, i.max_frp, i.detection_count, i.on_peat, i.settlement_m, i.near_static`, [ids])).rows;
  const scored = rows.map(row => ({ id: row.id, ...scoreIncident({ bestConfidence: row.best_confidence, maxFrp: row.max_frp === null ? null : Number(row.max_frp),
    detectionCount: row.detection_count, onPeat: row.on_peat, settlementMeters: row.settlement_m, nearStatic: row.near_static }) }));
  await client.query(`UPDATE incidents i SET score = u.score, level = u.level, score_parts = u.parts
    FROM unnest($1::uuid[], $2::integer[], $3::text[], $4::jsonb[]) AS u(id, score, level, parts) WHERE i.id = u.id`,
  [scored.map(s => s.id), scored.map(s => s.score), scored.map(s => s.level), scored.map(s => JSON.stringify(s.parts))]);
}

/**
 * Cards for everyone who watches the incident's village or a village within their chosen radius. Low-priority
 * incidents stay on the map without a card, so volunteers are not buried; one that rises to medium gets its card then.
 */
export async function alertSubscribers(client: pg.PoolClient | pg.Pool, ids: string[], recentHours = 24): Promise<NewAlert[]> {
  if (!ids.length) return [];
  const result = await client.query(`INSERT INTO alerts (user_id, incident_id, village_id)
      SELECT DISTINCT ON (s.user_id, i.id) s.user_id, i.id, s.village_id
      FROM incidents i JOIN subscriptions s ON true JOIN villages v ON v.id = s.village_id
      WHERE i.id = ANY($1::uuid[]) AND i.last_detected_at > now() - make_interval(hours => $2) AND i.level IN ('tinggi', 'sedang')
        AND (i.village_id = s.village_id OR (s.radius_km > 0 AND ST_DWithin(v.geom::geography, i.centroid::geography, s.radius_km * 1000)))
      ORDER BY s.user_id, i.id, (i.village_id = s.village_id) DESC, ST_Distance(v.center, i.centroid)
    ON CONFLICT (user_id, incident_id) DO UPDATE SET updated_at = now(), read_at = NULL
    RETURNING id, user_id, incident_id`, [ids, recentHours]);
  return result.rows.map(row => ({ id: row.id, userId: row.user_id, incidentId: row.incident_id }));
}

export async function ingest(pool: pg.Pool, options: IngestOptions): Promise<IngestResult> {
  const client = await pool.connect();
  try {
    if (!(await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK])).rows[0].ok) {
      return { runId: null, skipped: true, fetched: 0, inArea: 0, inserted: 0, incidents: [], alerts: [], feeds: [] };
    }
    const run = await client.query('INSERT INTO ingest_runs (source) VALUES ($1) RETURNING id', [options.source]);
    const runId = Number(run.rows[0].id);
    const { rows, reports, fetched } = await readFeeds(options);
    try {
      await client.query('BEGIN');
      const insertedIds: string[] = [];
      for (let start = 0; start < rows.length; start += 2000) {
        const batch = rows.slice(start, start + 2000);
        const inserted = await client.query(`INSERT INTO detections (satellite, acq_at, latitude, longitude, geom, geom_m, geom_3857, confidence, frp, bright_ti4, bright_ti5, scan, track, daynight, on_peat)
            SELECT s, a, la, lo, ST_SetSRID(ST_MakePoint(lo, la), 4326), ST_Transform(ST_SetSRID(ST_MakePoint(lo, la), 4326), 32748), ST_Transform(ST_SetSRID(ST_MakePoint(lo, la), 4326), 3857), c, f, t4, t5, sc, tr, dn, p
            FROM unnest($1::text[], $2::timestamptz[], $3::float8[], $4::float8[], $5::text[], $6::numeric[], $7::numeric[], $8::numeric[], $9::numeric[], $10::numeric[], $11::text[], $12::boolean[])
              AS u(s, a, la, lo, c, f, t4, t5, sc, tr, dn, p)
          ON CONFLICT (satellite, acq_at, latitude, longitude) DO NOTHING RETURNING id`,
        [batch.map(r => r.satellite), batch.map(r => r.acqAt), batch.map(r => r.latitude), batch.map(r => r.longitude), batch.map(r => r.confidence),
          batch.map(r => r.frp), batch.map(r => r.brightTi4), batch.map(r => r.brightTi5), batch.map(r => r.scan), batch.map(r => r.track),
          batch.map(r => r.daynight), batch.map(r => options.peat.isPeat(r.longitude, r.latitude))]);
        insertedIds.push(...inserted.rows.map(row => String(row.id)));
      }
      const touched = new Set<string>();
      // Fresh statistics, or the planner may scan instead of using the spatial index for every detection below.
      if (insertedIds.length > 200) await client.query('ANALYZE detections');
      if (insertedIds.length) {
        await client.query('UPDATE detections d SET village_id = v.id FROM villages v WHERE d.id = ANY($1::bigint[]) AND ST_Contains(v.geom, d.geom)', [insertedIds]);
        await client.query(`UPDATE detections d SET near_static = true WHERE d.id = ANY($1::bigint[]) AND EXISTS (SELECT 1 FROM static_sources s
            WHERE (s.expires_at IS NULL OR s.expires_at > d.acq_at) AND ST_DWithin(s.geom, d.geom, s.radius_m / 90000.0)
              AND ST_DWithin(s.geom::geography, d.geom::geography, s.radius_m))`, [insertedIds]);
        // Only detections inside the pilot villages become incidents; the rest stay on the map as context.
        await clusterDays(client, insertedIds, touched);
      }
      const incidents = [...touched];
      await refreshIncidents(client, incidents);
      const alerts = await alertSubscribers(client, incidents);
      await client.query(`UPDATE ingest_runs SET finished_at = now(), feeds = $2, fetched = $3, in_area = $4, inserted = $5, incidents_touched = $6,
        error = $7 WHERE id = $1`, [runId, JSON.stringify(reports), fetched, rows.length, insertedIds.length, incidents.length,
        reports.every(report => report.error) ? 'Semua sumber FIRMS gagal diambil.' : null]);
      await client.query('COMMIT');
      return { runId, skipped: false, fetched, inArea: rows.length, inserted: insertedIds.length, incidents, alerts, feeds: reports };
    } catch (error) {
      await client.query('ROLLBACK');
      await client.query('UPDATE ingest_runs SET finished_at = now(), feeds = $2, error = $3 WHERE id = $1', [runId, JSON.stringify(reports), (error as Error).message]);
      throw error;
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK]).catch(() => {});
    client.release();
  }
}

/** A live pull; when FIRMS cannot be reached and the database is still empty, the committed snapshot instead. */
export async function ingestWithFallback(pool: pg.Pool, peat: PeatMask, range: '24h' | '7d' = '24h') {
  const live = await ingest(pool, { source: 'live', range, peat });
  if (live.skipped || live.feeds.some(feed => !feed.error)) return live;
  const empty = !(await pool.query('SELECT 1 FROM detections LIMIT 1')).rowCount;
  return empty ? ingest(pool, { source: 'snapshot', range: '7d', peat }) : live;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const pool = createPool();
  try {
    await migrate(pool);
    await loadReference(pool);
    const source = (process.argv[2] ?? 'live') as Source;
    const range = (process.argv[3] ?? '24h') as '24h' | '7d';
    const result = await ingest(pool, { source, range, peat: await loadPeatMask() });
    console.log(JSON.stringify({ ...result, incidents: result.incidents.length, alerts: result.alerts.length }, null, 2));
  } finally { await pool.end(); }
}
