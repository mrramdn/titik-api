// The pipeline from satellite to alert: fetch FIRMS, keep the covered area, link each detection to its village,
// flag peat and known hot places, group detections into incidents, score them, and put alerts in the inboxes of
// everyone who watches the village. One run at a time (advisory lock), all in one transaction.
import { randomInt } from 'node:crypto';
import type pg from 'pg';
import { createPool } from './db.js';
import { feedActive, feeds, fetchFeed, parseFirmsCsv, snapshotFeed, type FirmsRow } from './firms.js';
import { scoreIncident } from './geo.js';
import { clearTileCache, footprintSql, refreshVerificationSummary } from './incidents.js';
import { migrate } from './migrate.js';
import { loadPeatMask, type PeatMask } from './peat.js';
import { dataDir, loadReference } from './reference.js';
import { clearStatusCache, STOPPED_RUN } from './status.js';

export type Source = 'live' | 'snapshot' | 'fixture';
/** One line per satellite and run. `latest` is the newest detection inside the area, `latestAll` the newest in the whole file. */
export interface FeedReport { satellite: string; rows: number; inArea: number; latest: string | null; latestAll: string | null; error: string | null }
/** `fresh` is false for an alert that already existed: it moves up the inbox and is unread again. */
export interface NewAlert { id: string; userId: string; incidentId: string; fresh: boolean }
export interface IngestResult {
  /** `incidents` gained or lost detections in this run; `alerts` are the ones worth a notification (see ingest). */
  runId: number | null; skipped: boolean; fetched: number; inArea: number; inserted: number; incidents: string[]; alerts: NewAlert[]; feeds: FeedReport[];
  /** A stop cut the run short: it saved nothing, and its row says so (STOPPED_RUN). */
  stopped: boolean;
  /** Milliseconds per step, for the logs. */
  timings?: Record<string, number>;
}
/** `texts` (fixture source) holds one CSV per feed id: N21, N20, N, MODIS. */
export interface IngestOptions {
  source: Source; range?: '24h' | '7d'; texts?: Record<string, string>; peat: PeatMask; fetchImpl?: typeof fetch; now?: Date;
  /**
   * Stops the run, as a deploy does: a download under way is cut off and the feeds after it are not asked for, and a run
   * already saving rolls back. Either way the lock and the database client are let go and the run returns `stopped`.
   */
  signal?: AbortSignal;
}

const LOCK = 4157_2026;
const codeAlphabet = '23456789abcdefghjkmnpqrstuvwxyz';
export const incidentCode = () => Array.from({ length: 7 }, () => codeAlphabet[randomInt(codeAlphabet.length)]).join('');
const VIIRS = `('N21', 'N20', 'N')`;
const MODIS = `('T', 'A')`;
/** Detections of one WIB day ($1, 'YYYY-MM-DD') inside a village, for the table alias given. */
const onDay = (alias: string) => `${alias}.acq_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Jakarta') AND ${alias}.acq_at < (($1::date + 1)::timestamp AT TIME ZONE 'Asia/Jakarta')
  AND ${alias}.village_id IS NOT NULL`;
/** The same day filter as an expression, so a nearest-point search walks the spatial index instead of the day's time index. */
const onDayNear = (alias: string) => `(${alias}.acq_at AT TIME ZONE 'Asia/Jakarta')::date = $1::date AND ${alias}.village_id IS NOT NULL`;
/** Incidents never chain past a 3 km grid cell (Web Mercator metres), so a fire complex splits the same way on every run. */
const cell = (alias: string) => `floor(ST_X(${alias}.geom_3857) / 3000), floor(ST_Y(${alias}.geom_3857) / 3000)`;

async function readFeeds(options: IngestOptions) {
  const range = options.range ?? '24h';
  const now = options.now ?? new Date();
  const reports: FeedReport[] = [];
  const rows: FirmsRow[] = [];
  let fetched = 0;
  for (const feed of feeds) {
    if (!feedActive(feed, now)) continue;
    if (options.signal?.aborted) break;
    try {
      const text = options.source === 'fixture' ? options.texts?.[feed.id] ?? ''
        : options.source === 'snapshot' ? await snapshotFeed(feed, range, dataDir()) : await fetchFeed(feed, range, options.fetchImpl, options.signal);
      const parsed = text ? parseFirmsCsv(text) : { rows: [], total: 0, totals: {}, latest: {} } as ReturnType<typeof parseFirmsCsv>;
      fetched += parsed.total;
      for (const satellite of feed.satellites) {
        const own = parsed.rows.filter(row => row.satellite === satellite);
        rows.push(...own);
        const latest = own.reduce<Date | null>((max, row) => (!max || row.acqAt > max ? row.acqAt : max), null);
        reports.push({ satellite, rows: parsed.totals[satellite] ?? 0, inArea: own.length, latest: latest?.toISOString() ?? null,
          latestAll: parsed.latest[satellite]?.toISOString() ?? null, error: null });
      }
    } catch (error) {
      // A download cut off by a stop is no failure of FIRMS: the run ends here.
      if (options.signal?.aborted) break;
      for (const satellite of feed.satellites) reports.push({ satellite, rows: 0, inArea: 0, latest: null, latestAll: null, error: (error as Error).message });
    }
  }
  return { rows, reports, fetched };
}

interface Group {
  /** Lowest detection id in the group: a stable order for ties. */
  order: number;
  detections: string[];
  /** Each detection's incident before this run. */
  current: (string | null)[];
  /** Existing incidents this group may keep, with how many of their detections it holds. */
  counts: Map<string, number>;
}
interface RunState { claimed: Set<string>; deleted: Set<string>; touched: Set<string> }

function groupRows(rows: { id: string; incident: string | null; key: string; counts?: boolean }[]) {
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const group = groups.get(row.key) ?? { order: Number(row.id), detections: [], current: [], counts: new Map<string, number>() };
    group.order = Math.min(group.order, Number(row.id));
    group.detections.push(row.id);
    group.current.push(row.incident);
    if (row.incident && row.counts !== false) group.counts.set(row.incident, (group.counts.get(row.incident) ?? 0) + 1);
    groups.set(row.key, group);
  }
  return [...groups.values()].sort((a, b) => a.order - b.order);
}

/** New incidents, one per group, each starting from the group's first detection. Codes are unique; a clash is retried. */
async function createIncidents(client: pg.PoolClient, firstDetections: string[]) {
  const ids: string[] = new Array(firstDetections.length);
  let pending = firstDetections.map((_, index) => index);
  while (pending.length) {
    const codes = new Set<string>();
    while (codes.size < pending.length) codes.add(incidentCode());
    const list = [...codes];
    const rows = (await client.query(`INSERT INTO incidents (code, village_id, first_detected_at, last_detected_at)
        SELECT u.code, d.village_id, d.acq_at, d.acq_at FROM unnest($1::bigint[], $2::text[]) AS u(id, code) JOIN detections d ON d.id = u.id
      ON CONFLICT (code) DO NOTHING RETURNING id, code`, [pending.map(index => firstDetections[index]), list])).rows;
    const byCode = new Map(rows.map(row => [row.code as string, row.id as string]));
    pending = pending.filter((index, k) => { const id = byCode.get(list[k]!); if (id) ids[index] = id; return !id; });
  }
  return ids;
}

/**
 * Folds incidents into the one that keeps its id: reports, alerts and tasks move with them; the oldest open task of each
 * scope stays open (a demo task never cancels a real one).
 */
async function mergeInto(client: pg.PoolClient, keep: string, merged: string[]) {
  await client.query('UPDATE verifications SET incident_id = $1 WHERE incident_id = ANY($2::uuid[])', [keep, merged]);
  await client.query(`INSERT INTO alerts (user_id, incident_id, village_id, created_at, updated_at, read_at, shared_at)
      SELECT DISTINCT ON (user_id) user_id, $1, village_id, created_at, updated_at, read_at, shared_at FROM alerts
      WHERE incident_id = ANY($2::uuid[]) ORDER BY user_id, created_at
    ON CONFLICT (user_id, incident_id) DO NOTHING`, [keep, merged]);
  await client.query(`UPDATE assignments a SET status = 'dibatalkan', closed_at = now(), updated_at = now()
    FROM (SELECT id, row_number() OVER (PARTITION BY is_demo ORDER BY created_at, id) AS n FROM assignments
      WHERE incident_id = ANY($1::uuid[]) AND status IN ('ditugaskan', 'menuju')) o
    WHERE a.id = o.id AND o.n > 1`, [[keep, ...merged]]);
  await client.query('UPDATE assignments SET incident_id = $1 WHERE incident_id = ANY($2::uuid[])', [keep, merged]);
  await client.query('DELETE FROM incidents WHERE id = ANY($1::uuid[])', [merged]);
  await refreshVerificationSummary(client, [keep]);
}

/**
 * Gives every group one incident. An existing incident stays with the group that holds most of its detections;
 * a group that holds most of several keeps the oldest, which absorbs the others. A group that holds most of none
 * (new detections, or the smaller part of a split) gets a new incident. Incidents claimed or deleted earlier in
 * the run are never reused.
 */
async function settle(client: pg.PoolClient, groups: Group[], state: RunState) {
  const owner = new Map<string, Group>();
  for (const group of groups) {
    for (const [incident, n] of group.counts) {
      if (state.claimed.has(incident) || state.deleted.has(incident)) continue;
      const best = owner.get(incident);
      const bestN = best?.counts.get(incident) ?? 0;
      if (!best || n > bestN || (n === bestN && group.order < best.order)) owner.set(incident, group);
    }
  }
  const ages = owner.size ? (await client.query('SELECT id FROM incidents WHERE id = ANY($1::uuid[]) ORDER BY first_detected_at, id', [[...owner.keys()]])).rows : [];
  const rank = new Map(ages.map((row, index) => [row.id as string, index]));
  const owned = new Map<Group, string[]>();
  for (const [incident, group] of owner) if (rank.has(incident)) owned.set(group, [...(owned.get(group) ?? []), incident]);
  const keepOf = new Map<Group, string>();
  const fresh: Group[] = [];
  for (const group of groups) {
    const mine = (owned.get(group) ?? []).sort((a, b) => rank.get(a)! - rank.get(b)!);
    if (!mine.length) { fresh.push(group); continue; }
    const [keep, ...merged] = mine as [string, ...string[]];
    keepOf.set(group, keep);
    state.claimed.add(keep);
    if (merged.length) {
      await mergeInto(client, keep, merged);
      for (const id of merged) { state.deleted.add(id); state.touched.delete(id); }
      state.touched.add(keep);
    }
  }
  if (fresh.length) {
    const created = await createIncidents(client, fresh.map(group => group.detections[0]!));
    fresh.forEach((group, index) => { keepOf.set(group, created[index]!); state.claimed.add(created[index]!); });
  }
  const moveIds: string[] = [], moveTo: string[] = [];
  for (const [group, keep] of keepOf) {
    group.detections.forEach((id, index) => {
      const before = group.current[index];
      if (before === keep) return;
      moveIds.push(id); moveTo.push(keep);
      state.touched.add(keep);
      if (before && !state.deleted.has(before)) state.touched.add(before);
    });
  }
  for (let start = 0; start < moveIds.length; start += 5000) {
    await client.query('UPDATE detections d SET incident_id = u.incident FROM unnest($1::bigint[], $2::uuid[]) AS u(id, incident) WHERE d.id = u.id',
      [moveIds.slice(start, start + 5000), moveTo.slice(start, start + 5000)]);
  }
}

/**
 * Groups one WIB day of detections into incidents, in three steps.
 * 1. VIIRS (375 m): single-linkage clusters of points within 750 m of each other (ST_ClusterDBSCAN on Web Mercator
 *    metres, within 0.3% of true distance at these latitudes), never across a 3 km grid cell. The cell keeps a
 *    burning landscape from chaining into one incident tens of kilometres wide, and it splits the same way on
 *    every run, so ids, reports and tasks stay put.
 * 2. MODIS (1 km) joins the VIIRS group of the nearest VIIRS point within its own footprint (half the pixel size,
 *    at most 1.5 km) plus 375 m. It can bring a MODIS-only incident into that group, never a second VIIRS one.
 * 3. MODIS left over clusters on its own (1.5 km, same cells) into MODIS-only incidents.
 * Adding points can only join clusters, so an existing incident keeps its id; when incidents meet, the oldest
 * absorbs the others with their reports, alerts and tasks. A peat fire that smoulders for a week becomes one
 * incident per day instead of one that grows for kilometres.
 */
async function clusterDay(client: pg.PoolClient, day: string, state: RunState) {
  const viirs = (await client.query(`SELECT d.id::text AS id, d.incident_id::text AS incident,
      concat_ws(':', ${cell('d')}, ST_ClusterDBSCAN(d.geom_3857, eps := 750, minpoints := 1) OVER (PARTITION BY ${cell('d')})) AS key
    FROM detections d WHERE ${onDay('d')} AND d.satellite IN ${VIIRS}`, [day])).rows as { id: string; incident: string | null; key: string }[];
  const viirsIncidents = new Set(viirs.map(row => row.incident).filter(Boolean));
  const keyOf = new Map(viirs.map(row => [row.id, row.key]));
  const modis = (await client.query(`SELECT m.id::text AS id, m.incident_id::text AS incident, near.id::text AS viirs
    FROM detections m LEFT JOIN LATERAL (
      SELECT d.id FROM detections d WHERE ${onDayNear('d')} AND d.satellite IN ${VIIRS}
        AND ST_DWithin(d.geom_3857, m.geom_3857, least(500 * greatest(COALESCE(m.scan, 1), COALESCE(m.track, 1)), 1500) + 375)
      ORDER BY d.geom_3857 <-> m.geom_3857, d.id LIMIT 1) near ON true
    WHERE ${onDay('m')} AND m.satellite IN ${MODIS}`, [day])).rows as { id: string; incident: string | null; viirs: string | null }[];
  const attached = modis.filter(row => row.viirs).map(row => ({ id: row.id, incident: row.incident, key: keyOf.get(row.viirs!)!,
    // A MODIS point brings its incident along only when that incident has no VIIRS points of its own.
    counts: !row.incident || !viirsIncidents.has(row.incident) }));
  if (viirs.length) await settle(client, groupRows([...viirs, ...attached]), state);
  const leftover = modis.filter(row => !row.viirs).map(row => row.id);
  if (!leftover.length) return;
  const alone = (await client.query(`SELECT d.id::text AS id, d.incident_id::text AS incident,
      concat_ws(':', ${cell('d')}, ST_ClusterDBSCAN(d.geom_3857, eps := 1500, minpoints := 1) OVER (PARTITION BY ${cell('d')})) AS key
    FROM detections d WHERE d.id = ANY($1::bigint[])`, [leftover])).rows as { id: string; incident: string | null; key: string }[];
  await settle(client, groupRows(alone), state);
}

/** The WIB days that received detections inside a village, oldest first; a 7-day backfill runs one day at a time. */
async function clusterDays(client: pg.PoolClient, newIds: string[], state: RunState) {
  const days = (await client.query(`SELECT DISTINCT to_char((acq_at AT TIME ZONE 'Asia/Jakarta')::date, 'YYYY-MM-DD') AS day
    FROM detections WHERE id = ANY($1::bigint[]) AND village_id IS NOT NULL ORDER BY day`, [newIds])).rows.map(row => row.day as string);
  for (const day of days) await clusterDay(client, day, state);
  return days;
}

/** Ids of every incident detected on the given WIB days. */
async function incidentsOnDays(client: pg.PoolClient | pg.Pool, days: string[]) {
  if (!days.length) return [];
  return (await client.query(`SELECT id FROM incidents
    WHERE to_char((first_detected_at AT TIME ZONE 'Asia/Jakarta')::date, 'YYYY-MM-DD') = ANY($1::text[])`, [days])).rows.map(row => row.id as string);
}

/**
 * Recomputes what an incident is made of, then its score and indicated hot area. Counts and times use every
 * detection; location (centroid, village, peat, nearest settlement), confidence, FRP and area use the VIIRS points
 * when there are any, else MODIS.
 */
export async function refreshIncidents(client: pg.PoolClient | pg.Pool, ids: string[]) {
  for (let start = 0; start < ids.length; start += 2000) await refreshBatch(client, ids.slice(start, start + 2000));
}

async function refreshBatch(client: pg.PoolClient | pg.Pool, ids: string[]) {
  if (!ids.length) return;
  // One pass over the detections: every location figure is aggregated twice, VIIRS (v_) and MODIS (m_), and the VIIRS
  // one wins when there is any. No join between aggregates: right after an ingest the planner's row estimates are stale,
  // and a nested loop over them takes minutes. The nearest settlement and named place come from the KNN index.
  const rows = (await client.query(`WITH s AS (
      SELECT d.incident_id, count(*)::integer AS n, count(*) FILTER (WHERE NOT d.modis)::integer AS viirs, count(*) FILTER (WHERE d.modis)::integer AS modis,
        min(d.acq_at) AS first, max(d.acq_at) AS last, array_agg(DISTINCT d.satellite) AS sats,
        max(d.frp) FILTER (WHERE NOT d.modis) AS v_frp, max(d.frp) FILTER (WHERE d.modis) AS m_frp,
        min(d.rank) FILTER (WHERE NOT d.modis) AS v_rank, min(d.rank) FILTER (WHERE d.modis) AS m_rank,
        bool_or(d.on_peat) FILTER (WHERE NOT d.modis) AS v_peat, bool_or(d.on_peat) FILTER (WHERE d.modis) AS m_peat,
        bool_or(d.near_static) FILTER (WHERE NOT d.modis) AS v_static, bool_or(d.near_static) FILTER (WHERE d.modis) AS m_static,
        ST_Centroid(ST_Collect(d.geom) FILTER (WHERE NOT d.modis)) AS v_c, ST_Centroid(ST_Collect(d.geom) FILTER (WHERE d.modis)) AS m_c,
        mode() WITHIN GROUP (ORDER BY d.village_id) FILTER (WHERE NOT d.modis) AS v_village,
        mode() WITHIN GROUP (ORDER BY d.village_id) FILTER (WHERE d.modis) AS m_village,
        max(round(500 * sqrt(COALESCE(d.scan, 1) ^ 2 + COALESCE(d.track, 1) ^ 2))) FILTER (WHERE d.modis)::integer AS uncertainty
      FROM (SELECT incident_id, satellite IN ${MODIS} AS modis, satellite, acq_at, frp, on_peat, near_static, geom, village_id, scan, track,
          CASE confidence WHEN 'high' THEN 1 WHEN 'nominal' THEN 2 ELSE 3 END AS rank
        FROM detections WHERE incident_id = ANY($1::uuid[])) d
      GROUP BY d.incident_id),
    b AS (
      SELECT incident_id, n, viirs, modis, first, last, sats, viirs = 0 AS modis_only,
        CASE WHEN viirs > 0 THEN v_frp ELSE m_frp END AS max_frp,
        (ARRAY['high', 'nominal', 'low'])[CASE WHEN viirs > 0 THEN v_rank ELSE m_rank END] AS best,
        CASE WHEN viirs > 0 THEN v_peat ELSE m_peat END AS peat, CASE WHEN viirs > 0 THEN v_static ELSE m_static END AS near_static,
        CASE WHEN viirs > 0 THEN v_c ELSE m_c END AS c, CASE WHEN viirs > 0 THEN v_village ELSE m_village END AS village,
        CASE WHEN viirs = 0 THEN uncertainty END AS uncertainty
      FROM s)
    UPDATE incidents i SET first_detected_at = b.first, last_detected_at = b.last, detection_count = b.n, viirs_count = b.viirs, modis_count = b.modis,
      modis_only = b.modis_only, location_uncertainty_m = b.uncertainty, max_frp = b.max_frp, best_confidence = b.best, on_peat = b.peat,
      near_static = b.near_static, centroid = b.c, centroid_3857 = ST_Transform(b.c, 3857), satellites = b.sats,
      village_id = COALESCE(b.village, i.village_id), updated_at = now(), settlement_m = near.m,
      place_name = place.name, place_kind = place.kind, place_m = place.m, place_bearing = place.bearing
    FROM b
      LEFT JOIN LATERAL (SELECT round(ST_Distance(st.geom::geography, b.c::geography))::integer AS m FROM settlements st ORDER BY st.geom <-> b.c LIMIT 1) near ON true
      LEFT JOIN LATERAL (SELECT st.name, st.kind, round(ST_Distance(st.geom::geography, b.c::geography))::integer AS m,
          COALESCE(round(degrees(ST_Azimuth(st.geom::geography, b.c::geography)))::integer % 360, 0) AS bearing
        FROM settlements st WHERE st.kind <> 'neighbourhood' ORDER BY st.geom <-> b.c LIMIT 1) place ON true
    WHERE i.id = b.incident_id
    RETURNING i.id, i.best_confidence, i.max_frp, i.viirs_count, i.modis_count, i.on_peat, i.settlement_m, i.near_static`, [ids])).rows;
  const scored = rows.map(row => ({ id: row.id, ...scoreIncident({ bestConfidence: row.best_confidence, maxFrp: row.max_frp === null ? null : Number(row.max_frp),
    viirsCount: row.viirs_count, modisCount: row.modis_count, onPeat: row.on_peat, settlementMeters: row.settlement_m, nearStatic: row.near_static }) }));
  await client.query(`UPDATE incidents i SET score = u.score, level = u.level, score_parts = u.parts
    FROM unnest($1::uuid[], $2::integer[], $3::text[], $4::jsonb[]) AS u(id, score, level, parts) WHERE i.id = u.id`,
  [scored.map(s => s.id), scored.map(s => s.score), scored.map(s => s.level), scored.map(s => JSON.stringify(s.parts))]);
  await refreshIndicatedArea(client, ids);
}

/**
 * The indicated hot area of each incident: its detections split into passes (one satellite, each detection at most
 * 30 minutes after the one before, as in the incident history), the pixel footprints of a pass merged, and the
 * largest pass kept. Footprints come from VIIRS when it saw the incident, else from MODIS (coarse, 1 km pixels).
 * Areas are measured on the Mercator grid and scaled by cos²(latitude) to square metres on the ground.
 */
async function refreshIndicatedArea(client: pg.PoolClient | pg.Pool, ids: string[]) {
  await client.query(`UPDATE incidents i SET indicated_area_ha = a.ha
    FROM (
      SELECT incident_id, round((max(m2) / 10000)::numeric, 1) AS ha FROM (
        SELECT incident_id, ST_Area(ST_Union(${footprintSql('p')})) * cos(radians(avg(latitude))) ^ 2 AS m2
        FROM (
          SELECT incident_id, satellite, latitude, scan, track, geom_3857,
            count(*) FILTER (WHERE starts) OVER (PARTITION BY incident_id, satellite ORDER BY acq_at, id) AS pass
          FROM (
            SELECT id, incident_id, satellite, acq_at, latitude, scan, track, geom_3857,
              COALESCE(acq_at - lag(acq_at) OVER (PARTITION BY incident_id, satellite ORDER BY acq_at, id) > interval '30 minutes', true) AS starts,
              bool_or(satellite NOT IN ${MODIS}) OVER (PARTITION BY incident_id) AS has_viirs
            FROM detections WHERE incident_id = ANY($1::uuid[])) d
          WHERE CASE WHEN has_viirs THEN satellite NOT IN ${MODIS} ELSE satellite IN ${MODIS} END) p
        GROUP BY incident_id, satellite, pass) s
      GROUP BY incident_id) a
    WHERE i.id = a.incident_id`, [ids]);
}

/**
 * Rescores every incident detected in the last `days` WIB days and recomputes its indicated area, for example after
 * the scoring rules change. It holds the ingest lock while it works: it waits for an ingest that is running (`onWait`
 * hears of it) rather than give up, and an ingest that starts meanwhile is skipped, as when two ingests meet.
 */
export async function refreshRecent(pool: pg.Pool, days = 8, onWait?: () => void) {
  const client = await pool.connect();
  try {
    if (!(await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK])).rows[0].ok) {
      onWait?.();
      await client.query('SELECT pg_advisory_lock($1)', [LOCK]);
    }
    try {
      const ids = (await client.query(`SELECT id FROM incidents WHERE first_detected_at > now() - make_interval(days => $1)`, [days])).rows.map(row => row.id as string);
      await refreshIncidents(client, ids);
      clearTileCache();
      clearStatusCache();
      return ids.length;
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK]).catch(() => {});
    }
  } finally {
    client.release();
  }
}

/**
 * Clusters the last `days` WIB days again from their detections, for example once after the clustering rules change
 * (incidents chained by older versions split at the grid cells), then rescores them. The largest part of an incident
 * keeps its id, reports and task. Watchers get alerts for the new parts; nothing is pushed. Null when an ingest runs.
 */
export async function recluster(pool: pg.Pool, days = 8) {
  const client = await pool.connect();
  try {
    if (!(await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK])).rows[0].ok) return null;
    try {
      await client.query('BEGIN');
      const list = (await client.query(`SELECT to_char(day, 'YYYY-MM-DD') AS day FROM generate_series((now() AT TIME ZONE 'Asia/Jakarta')::date - ($1::integer - 1),
        (now() AT TIME ZONE 'Asia/Jakarta')::date, interval '1 day') AS day`, [days])).rows.map(row => row.day as string);
      const state: RunState = { claimed: new Set(), deleted: new Set(), touched: new Set() };
      for (const day of list) await clusterDay(client, day, state);
      const changed = [...state.touched].filter(id => !state.deleted.has(id));
      const rescore = [...new Set([...changed, ...await incidentsOnDays(client, list)])];
      await refreshIncidents(client, rescore);
      await alertSubscribers(client, changed);
      await client.query('COMMIT');
      clearTileCache();
      clearStatusCache();
      return { days: list.length, changed: changed.length, merged: state.deleted.size, rescored: rescore.length };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK]).catch(() => {});
    client.release();
  }
}

/**
 * Alerts for everyone who watches the incident's village or a village within their chosen radius (only `userIds`
 * when given). Low-priority incidents stay on the map without an alert, so volunteers are not buried; one that rises
 * to medium gets its alert then. An alert that already exists moves up the inbox and is unread again.
 */
export async function alertSubscribers(client: pg.PoolClient | pg.Pool, ids: string[], options: { userIds?: string[]; recentHours?: number } = {}): Promise<NewAlert[]> {
  if (!ids.length || options.userIds?.length === 0) return [];
  const params: unknown[] = [ids, options.recentHours ?? 24];
  if (options.userIds) params.push(options.userIds);
  const result = await client.query(`INSERT INTO alerts (user_id, incident_id, village_id)
      SELECT DISTINCT ON (s.user_id, i.id) s.user_id, i.id, s.village_id
      FROM incidents i JOIN subscriptions s ON true JOIN villages v ON v.id = s.village_id
      WHERE i.id = ANY($1::uuid[]) AND i.last_detected_at > now() - make_interval(hours => $2) AND i.level IN ('tinggi', 'sedang')
        AND (i.village_id = s.village_id OR (s.radius_km > 0 AND ST_DWithin(v.geom::geography, i.centroid::geography, s.radius_km * 1000)))
        ${options.userIds ? 'AND s.user_id = ANY($3::uuid[])' : ''}
      ORDER BY s.user_id, i.id, (i.village_id = s.village_id) DESC, ST_Distance(v.center, i.centroid)
    ON CONFLICT (user_id, incident_id) DO UPDATE SET updated_at = now(), read_at = NULL
    RETURNING id, user_id, incident_id, (xmax = 0) AS fresh`, params);
  return result.rows.map(row => ({ id: row.id, userId: row.user_id, incidentId: row.incident_id, fresh: row.fresh }));
}

const highOnes = async (client: pg.PoolClient, ids: string[]) =>
  new Set((await client.query(`SELECT id FROM incidents WHERE id = ANY($1::uuid[]) AND level = 'tinggi'`, [ids])).rows.map(row => row.id as string));

/** Ends an ingest whose signal asked it to stop. */
class Stopped extends Error {}

export async function ingest(pool: pg.Pool, options: IngestOptions): Promise<IngestResult> {
  const { signal } = options;
  const none: IngestResult = { runId: null, skipped: false, stopped: false, fetched: 0, inArea: 0, inserted: 0, incidents: [], alerts: [], feeds: [] };
  if (signal?.aborted) return { ...none, stopped: true };
  const client = await pool.connect();
  try {
    const lock = (await client.query('SELECT pg_try_advisory_lock($1) AS ok, pg_backend_pid() AS pid', [LOCK])).rows[0];
    if (!lock.ok) return { ...none, skipped: true };
    // A run is under way only while it holds the lock, so a row still open now was left by a process that was killed
    // before it could close it (by Docker after a slow stop, or out of memory): it is closed as stopped, at the time it
    // is found.
    await client.query('UPDATE ingest_runs SET finished_at = now(), error = $1 WHERE finished_at IS NULL', [STOPPED_RUN]);
    const run = await client.query('INSERT INTO ingest_runs (source) VALUES ($1) RETURNING id', [options.source]);
    const runId = Number(run.rows[0].id);
    const timings: Record<string, number> = {};
    let mark = performance.now();
    const lap = (step: string) => { const now = performance.now(); timings[step] = Math.round(now - mark); mark = now; };
    const { rows, reports, fetched } = await readFeeds(options);
    lap('fetch');
    // A stopped run saves nothing, and its row is closed as stopped rather than left looking as if it still ran.
    const stopped = async (): Promise<IngestResult> => {
      await client.query('UPDATE ingest_runs SET finished_at = now(), feeds = $2, error = $3 WHERE id = $1', [runId, JSON.stringify(reports), STOPPED_RUN]);
      return { ...none, runId, stopped: true, fetched, inArea: rows.length, feeds: reports, timings };
    };
    if (signal?.aborted) return await stopped();
    // From here a stop cancels the statement under way, and any that starts before the run notices, then the run rolls
    // back: in a fire season a run inserts thousands of detections and one statement can take 10 s, longer than a deploy
    // waits. The run waits for every cancel to reach the server before it rolls back, so none can cut short a statement
    // after that, nor one of whoever has the client next.
    let cancels = Promise.resolve();
    let again: NodeJS.Timeout | undefined;
    const cancel = () => { cancels = cancels.then(() => pool.query('SELECT pg_cancel_backend($1)', [lock.pid])).then(() => {}, () => {}); };
    const onStop = () => { cancel(); again = setInterval(cancel, 250); };
    const quiet = async () => { signal?.removeEventListener('abort', onStop); clearInterval(again); await cancels; };
    const check = () => { if (signal?.aborted) throw new Stopped(); };
    signal?.addEventListener('abort', onStop, { once: true });
    try {
      await client.query('BEGIN');
      const insertedIds: string[] = [];
      for (let start = 0; start < rows.length; start += 2000) {
        check();
        const batch = rows.slice(start, start + 2000);
        const inserted = await client.query(`INSERT INTO detections (satellite, acq_at, latitude, longitude, geom, geom_m, geom_3857, confidence, confidence_pct, frp,
              bright_ti4, bright_ti5, scan, track, daynight, on_peat)
            SELECT s, a, la, lo, ST_SetSRID(ST_MakePoint(lo, la), 4326), ST_Transform(ST_SetSRID(ST_MakePoint(lo, la), 4326), 32748),
              ST_Transform(ST_SetSRID(ST_MakePoint(lo, la), 4326), 3857), c, cp, f, t4, t5, sc, tr, dn, p
            FROM unnest($1::text[], $2::timestamptz[], $3::float8[], $4::float8[], $5::text[], $6::smallint[], $7::numeric[], $8::numeric[], $9::numeric[],
              $10::numeric[], $11::numeric[], $12::text[], $13::boolean[])
              AS u(s, a, la, lo, c, cp, f, t4, t5, sc, tr, dn, p)
          ON CONFLICT (satellite, acq_at, latitude, longitude) DO NOTHING RETURNING id`,
        [batch.map(r => r.satellite), batch.map(r => r.acqAt), batch.map(r => r.latitude), batch.map(r => r.longitude), batch.map(r => r.confidence),
          batch.map(r => r.confidencePct), batch.map(r => r.frp), batch.map(r => r.brightTi4), batch.map(r => r.brightTi5), batch.map(r => r.scan),
          batch.map(r => r.track), batch.map(r => r.daynight), batch.map(r => options.peat.isPeat(r.longitude, r.latitude))]);
        insertedIds.push(...inserted.rows.map(row => String(row.id)));
      }
      lap('insert');
      check();
      const state: RunState = { claimed: new Set(), deleted: new Set(), touched: new Set() };
      let days: string[] = [];
      // Fresh statistics, or the planner may scan instead of using the spatial index for every detection below.
      if (insertedIds.length > 200) await client.query('ANALYZE detections');
      if (insertedIds.length) {
        await client.query('UPDATE detections d SET village_id = v.id FROM villages v WHERE d.id = ANY($1::bigint[]) AND ST_Contains(v.geom, d.geom)', [insertedIds]);
        // The widest radius as a fixed reach in degrees (1° is more than 90 km here), so the spatial index finds the candidates.
        const reach = Number((await client.query('SELECT COALESCE(max(radius_m), 0) AS m FROM static_sources')).rows[0].m) / 90000;
        await client.query(`UPDATE detections d SET near_static = true WHERE d.id = ANY($1::bigint[]) AND EXISTS (SELECT 1 FROM static_sources s
            WHERE ST_DWithin(s.geom, d.geom, $2::float8) AND (s.expires_at IS NULL OR s.expires_at > d.acq_at)
              AND ST_DWithin(s.geom::geography, d.geom::geography, s.radius_m))`, [insertedIds, reach]);
        lap('villages');
        check();
        // Only detections inside the covered villages become incidents; the rest stay on the map as context.
        days = await clusterDays(client, insertedIds, state);
        lap('cluster');
        check();
      }
      const incidents = [...state.touched].filter(id => !state.deleted.has(id));
      // A 7-day pull rescores every incident of the days it touched, so a change of rules reaches all of them.
      const rescore = options.range === '7d' ? [...new Set([...incidents, ...await incidentsOnDays(client, days)])] : incidents;
      const wasHigh = await highOnes(client, incidents);
      await refreshIncidents(client, rescore);
      lap('refresh');
      check();
      // Every incident that gained detections moves up its watchers' inboxes. A notification goes out only for a new
      // alert or for an incident that has just become high priority, so a fire seen on every pass does not ring each time.
      const nowHigh = await highOnes(client, incidents);
      const alerts = (await alertSubscribers(client, incidents)).filter(alert => alert.fresh || (nowHigh.has(alert.incidentId) && !wasHigh.has(alert.incidentId)));
      lap('alerts');
      await client.query(`UPDATE ingest_runs SET finished_at = now(), feeds = $2, fetched = $3, in_area = $4, inserted = $5, incidents_touched = $6,
        error = $7 WHERE id = $1`, [runId, JSON.stringify(reports), fetched, rows.length, insertedIds.length, rescore.length,
        reports.length && reports.every(report => report.error) ? 'Semua sumber FIRMS gagal diambil. Data terakhir tetap tampil.' : null]);
      // Once COMMIT is on its way the run finishes; a stop after this waits for it.
      await quiet();
      check();
      await client.query('COMMIT');
      if (insertedIds.length) clearTileCache();
      clearStatusCache();
      return { runId, skipped: false, stopped: false, fetched, inArea: rows.length, inserted: insertedIds.length, incidents, alerts, feeds: reports, timings };
    } catch (error) {
      const wasStopped = error instanceof Stopped || Boolean(signal?.aborted);
      await quiet();
      await client.query('ROLLBACK');
      if (wasStopped) return await stopped();
      await client.query('UPDATE ingest_runs SET finished_at = now(), feeds = $2, error = $3 WHERE id = $1', [runId, JSON.stringify(reports), (error as Error).message]);
      clearStatusCache();
      throw error;
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK]).catch(() => {});
    client.release();
  }
}

/** A live pull; when FIRMS cannot be reached and the database is still empty, the committed snapshot instead. */
export async function ingestWithFallback(pool: pg.Pool, peat: PeatMask, range: '24h' | '7d' = '24h', options: Pick<IngestOptions, 'signal' | 'fetchImpl'> = {}) {
  const live = await ingest(pool, { source: 'live', range, peat, ...options });
  if (live.skipped || live.stopped || live.feeds.some(feed => !feed.error)) return live;
  const empty = !(await pool.query('SELECT 1 FROM detections LIMIT 1')).rowCount;
  return empty ? ingest(pool, { source: 'snapshot', range: '7d', peat, signal: options.signal }) : live;
}

// pnpm ingest [live|snapshot] [24h|7d] pulls FIRMS; pnpm ingest refresh [days] rescores recent incidents;
// pnpm ingest recluster [days] groups recent days again and rescores them.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const pool = createPool();
  try {
    await migrate(pool);
    await loadReference(pool);
    if (process.argv[2] === 'refresh') {
      const rescored = await refreshRecent(pool, Number(process.argv[3] ?? 8), () => console.log('An ingest is running. Rescoring starts when it has finished.'));
      console.log(`Rescored ${rescored} incidents.`);
    } else if (process.argv[2] === 'recluster') {
      const result = await recluster(pool, Number(process.argv[3] ?? 8));
      console.log(result ? JSON.stringify(result) : 'An ingest is running. Run this again when it has finished.');
    } else {
      const source = (process.argv[2] ?? 'live') as Source;
      const range = (process.argv[3] ?? '24h') as '24h' | '7d';
      const result = await ingest(pool, { source, range, peat: await loadPeatMask() });
      console.log(JSON.stringify({ ...result, incidents: result.incidents.length, alerts: result.alerts.length }, null, 2));
    }
  } finally { await pool.end(); }
}
