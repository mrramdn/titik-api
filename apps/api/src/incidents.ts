import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { requireCondition, choice, object } from './errors.js';
import { addDays, cardText, isCalendarDate, wibDay, type CardIncident, type Level } from './geo.js';
import type { Database, User } from './models.js';

const OPEN = `('ditugaskan', 'menuju')`;

/**
 * What a request sees of field checks and tasks. The demo accounts are shared by every visitor, so what they do stays in
 * a demo scope: visitors and real accounts see real field checks and tasks only ('real'), a demo session sees the real
 * ones and the demo ones together ('demo'). The scope follows the session; the kejadian tile asks for the demo scope with
 * &lihat=demo, which counts only for a demo session.
 */
export type Scope = 'real' | 'demo';
export const scopeOf = (request: FastifyRequest): Scope => (request.user?.demo ? 'demo' : 'real');

/** Who reads a response: the signed-in account, or nothing for a visitor. */
export type Viewer = Pick<User, 'demo'> | null | undefined;
/**
 * Whether the viewer reads the private part of a field check or task (its note, photo, and who filed or assigned it).
 * Signed-in teams do and visitors do not. A demo session is open to anyone, so it does for demo rows only, which other
 * visitors typed on the shared accounts: a real volunteer's notes, photos and name stay with real accounts.
 */
export const seesPrivate = (viewer: Viewer, demoRow: boolean) => Boolean(viewer) && (!viewer!.demo || demoRow);

/** SQL for a scope: the incident's field check summary as the scope sees it, and the condition on rows that carry is_demo. */
export function scopeSql(scope: Scope) {
  const demo = scope === 'demo';
  return {
    /** When the incident `alias` was first checked in the field. */
    firstVerified: (alias = 'i') => `${alias}.${demo ? 'first_verified_any_at' : 'first_verified_at'}`,
    /** The status of its latest field check. */
    latestStatus: (alias = 'i') => `${alias}.${demo ? 'latest_status_any' : 'latest_status'}`,
    /** For verifications and assignments: ` AND NOT alias.is_demo` in the real scope, nothing for a demo session. */
    rows: (alias: string) => (demo ? '' : ` AND NOT ${alias}.is_demo`),
  };
}

/**
 * A detection's pixel footprint as SQL: an axis-aligned box around its Web Mercator point, `scan` × `track` km
 * (the pixel size FIRMS gives along scan and track; VIIRS 0.375 km and MODIS 1 km when missing), widened by
 * 1/cos(latitude) as Mercator stretches distances. An approximation: real pixels turn slightly with the orbit.
 */
export function footprintSql(alias: string) {
  const size = (column: string) => `COALESCE(${alias}.${column}, CASE WHEN ${alias}.satellite IN ('T', 'A') THEN 1.0 ELSE 0.375 END) * 500 / cos(radians(${alias}.latitude))`;
  return `ST_MakeEnvelope(ST_X(${alias}.geom_3857) - ${size('scan')}, ST_Y(${alias}.geom_3857) - ${size('track')},
    ST_X(${alias}.geom_3857) + ${size('scan')}, ST_Y(${alias}.geom_3857) + ${size('track')}, 3857)`;
}

/**
 * The time window of a list, summary or tile as SQL, sharing one shape between live data and the archive. Live: the
 * last `hours` hours before now. Archive (`tanggal`, a WIB day): the `hours` hours before the end of that day, so 24
 * is that day and 72 that day and the two before. Pushes its parameters; `end` is the end of the window as SQL.
 */
export function timeWindow(params: unknown[], hours: number, tanggal: string | null) {
  params.push(hours);
  const span = `make_interval(hours => $${params.length})`;
  if (!tanggal) return { end: 'now()', within: (column: string) => `${column} > now() - ${span}` };
  params.push(tanggal);
  const end = `(($${params.length}::date + 1)::timestamp AT TIME ZONE 'Asia/Jakarta')`;
  return { end, within: (column: string) => `${column} >= ${end} - ${span} AND ${column} < ${end}` };
}
export type TimeWindow = ReturnType<typeof timeWindow>;

let firstDay: { at: number; day: string | null } | null = null;
/**
 * The archive: from the WIB day of the earliest detection to yesterday. Today belongs to the live data. Without
 * any detection before today, `first` is after `last` and there is no archive day.
 */
export async function archiveBounds(db: Database) {
  if (!firstDay || Date.now() - firstDay.at > 600_000) {
    const row = (await db.query(`SELECT to_char((min(acq_at) AT TIME ZONE 'Asia/Jakarta')::date, 'YYYY-MM-DD') AS day FROM detections`)).rows[0];
    firstDay = { at: Date.now(), day: row?.day ?? null };
  }
  const today = wibDay();
  return { first: firstDay.day && firstDay.day < today ? firstDay.day : today, last: addDays(today, -1) };
}

/** The `tanggal` of a request: null for live data, else a WIB day inside the archive. */
export async function archiveDate(db: Database, value: unknown) {
  if (value === undefined || value === '') return null;
  const date = String(value);
  requireCondition(isCalendarDate(date), 400, 'INVALID_INPUT', 'Tanggal tidak valid. Tulis tanggal sebagai TTTT-BB-HH.');
  const { first, last } = await archiveBounds(db);
  requireCondition(first <= last, 400, 'INVALID_INPUT', 'Arsip belum tersedia. Lihat data hari ini.');
  requireCondition(date >= first && date <= last, 400, 'INVALID_INPUT', `Tanggal di luar arsip. Pilih tanggal ${first} sampai ${last}.`);
  return date;
}

/**
 * Cut vector tiles, the least recently used dropped first once they hold more than `limit` bytes together (an
 * empty tile counts a little too, so many of them cannot grow the map without bound).
 */
export class TileCache {
  private entries = new Map<string, { at: number; body: Buffer }>();
  private bytes = 0;
  constructor(private readonly limit: number) {}
  private size = (body: Buffer) => body.length + 256;
  get(key: string, ttl: number) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (Date.now() - entry.at > ttl) { this.bytes -= this.size(entry.body); return undefined; }
    this.entries.set(key, entry);
    return entry.body;
  }
  set(key: string, body: Buffer) {
    const old = this.entries.get(key);
    if (old) { this.entries.delete(key); this.bytes -= this.size(old.body); }
    this.entries.set(key, { at: Date.now(), body });
    this.bytes += this.size(body);
    for (const [oldest, entry] of this.entries) {
      if (this.bytes <= this.limit) break;
      this.entries.delete(oldest);
      this.bytes -= this.size(entry.body);
    }
  }
  /** Drops the entries whose key matches. */
  drop(match: (key: string) => boolean) {
    for (const [key, entry] of this.entries) {
      if (!match(key)) continue;
      this.entries.delete(key);
      this.bytes -= this.size(entry.body);
    }
  }
  clear() { this.entries.clear(); this.bytes = 0; }
  get totalBytes() { return this.bytes; }
}

/**
 * Incident columns plus its village, coordinates, latest field check and task (the open one, else the latest), as the
 * scope sees them, ready for incidentModel. scope_verified_at and scope_status are the field check summary of the scope.
 */
export function incidentSelect(scope: Scope) {
  const s = scopeSql(scope);
  return `SELECT i.*, ST_X(i.centroid) AS lon, ST_Y(i.centroid) AS lat, ${s.firstVerified()} AS scope_verified_at, ${s.latestStatus()} AS scope_status,
  v.name AS village_name, v.district AS village_district, v.regency AS village_regency, v.province AS village_province,
  ST_X(v.center) AS village_lon, ST_Y(v.center) AS village_lat,
  lc.status AS check_status, lc.observed_at AS check_observed_at, lc.is_demo AS check_demo,
  task.id AS task_id, task.status AS task_status, task.note AS task_note, task.created_at AS task_created_at, task.updated_at AS task_updated_at,
  task.closed_at AS task_closed_at, task.assignee_id AS task_assignee_id, task.assignee_name AS task_assignee_name,
  task.assignee_organization AS task_assignee_organization, task.assigned_by_name AS task_assigned_by, task.is_demo AS task_is_demo
  FROM incidents i LEFT JOIN villages v ON v.id = i.village_id
  LEFT JOIN LATERAL (SELECT c.status, c.observed_at, c.is_demo FROM verifications c WHERE c.incident_id = i.id${s.rows('c')}
    ORDER BY c.observed_at DESC, c.received_at DESC LIMIT 1) lc ON true
  LEFT JOIN LATERAL (SELECT a.id, a.status, a.note, a.created_at, a.updated_at, a.closed_at, a.assignee_id, a.is_demo, u.name AS assignee_name,
      u.organization AS assignee_organization, b.name AS assigned_by_name
    FROM assignments a JOIN users u ON u.id = a.assignee_id JOIN users b ON b.id = a.assigned_by
    WHERE a.incident_id = i.id${s.rows('a')} ORDER BY (a.status IN ${OPEN}) DESC, a.created_at DESC LIMIT 1) task ON true`;
}

export function cardIncident(row: Record<string, any>): CardIncident {
  return { detectionCount: row.detection_count, onPeat: row.on_peat, lastDetectedAt: row.last_detected_at, level: row.level as Level, nearStatic: row.near_static,
    modisOnly: Boolean(row.modis_only), locationUncertaintyM: row.location_uncertainty_m ?? null, place: nearestPlace(row),
    village: row.village_name ? { name: row.village_name } : null };
}

export function nearestPlace(row: Record<string, any>) {
  return row.place_name ? { name: row.place_name as string, kind: row.place_kind as string, distanceM: row.place_m as number, bearingDeg: (row.place_bearing ?? 0) as number } : null;
}

/**
 * An assignment as the API returns it, from columns named with a prefix (task_ in incidentSelect). The squad is
 * public; who assigned it and the note are for signed-in teams, like the notes of field reports.
 */
export function assignmentModel(row: Record<string, any>, prefix = 'task_', team = true) {
  const at = (name: string) => row[`${prefix}${name}`];
  if (!at('id')) return null;
  return { id: at('id') as string, status: at('status') as string,
    assignee: { id: at('assignee_id') as string, name: at('assignee_name') as string, organization: at('assignee_organization') as string },
    assignedBy: team ? at('assigned_by') as string : '', note: team ? at('note') as string : '',
    createdAt: (at('created_at') as Date).toISOString(), updatedAt: (at('updated_at') as Date).toISOString(), closedAt: (at('closed_at') as Date | null)?.toISOString() ?? null };
}

/**
 * A row of incidentSelect as the API returns it; field checks and the task are those of the row's scope. Visitors see
 * the squad of a task, not its note or who assigned it, and so does a demo session for a real task (see seesPrivate).
 */
export function incidentModel(row: Record<string, any>, viewer: Viewer) {
  const village = row.village_id ? { id: row.village_id, name: row.village_name, district: row.village_district, regency: row.village_regency,
    province: row.village_province, center: [row.village_lon, row.village_lat] as [number, number] } : null;
  return {
    id: row.id, code: row.code, village,
    firstDetectedAt: row.first_detected_at.toISOString(), lastDetectedAt: row.last_detected_at.toISOString(),
    detectionCount: row.detection_count, viirsCount: row.viirs_count ?? row.detection_count, modisCount: row.modis_count ?? 0,
    modisOnly: Boolean(row.modis_only), locationUncertaintyM: row.location_uncertainty_m ?? null,
    satellites: row.satellites, maxFrp: row.max_frp === null ? null : Number(row.max_frp),
    bestConfidence: row.best_confidence, onPeat: row.on_peat, nearStatic: row.near_static, centroid: [row.lon, row.lat] as [number, number],
    settlementMeters: row.settlement_m, score: row.score, scoreParts: row.score_parts, level: row.level,
    firstVerifiedAt: row.scope_verified_at?.toISOString() ?? null, latestStatus: row.scope_status ?? null,
    latestCheck: row.check_status ? { status: row.check_status, observedAt: row.check_observed_at.toISOString(), demo: row.check_demo } : null,
    assignment: assignmentModel(row, 'task_', seesPrivate(viewer, Boolean(row.task_is_demo))),
    nearestPlace: nearestPlace(row),
    indicatedAreaHa: row.indicated_area_ha === null || row.indicated_area_ha === undefined ? null : Number(row.indicated_area_ha),
    card: village ? cardText(cardIncident(row)) : null,
    sharePath: `/k/${row.code}`,
  };
}

export async function getIncident(db: Database, idOrCode: string, scope: Scope) {
  const byId = /^[0-9a-f-]{36}$/i.test(idOrCode);
  const result = await db.query(`${incidentSelect(scope)} WHERE ${byId ? 'i.id = $1::uuid' : 'i.code = $1'}`, [idOrCode]);
  requireCondition(result.rows[0], 404, 'NOT_FOUND', 'Kejadian tidak ditemukan. Muat ulang daftar kejadian.');
  return result.rows[0];
}

/**
 * Keeps an incident's verification summaries in step with its reports: first_verified_at and latest_status from real
 * field checks (the public's), first_verified_any_at and latest_status_any from all of them (a demo session's).
 */
export async function refreshVerificationSummary(db: Database, ids: string[]) {
  if (!ids.length) return;
  await db.query(`UPDATE incidents i SET
      first_verified_at = (SELECT min(observed_at) FROM verifications WHERE incident_id = i.id AND NOT is_demo),
      latest_status = (SELECT status FROM verifications WHERE incident_id = i.id AND NOT is_demo ORDER BY observed_at DESC, received_at DESC LIMIT 1),
      first_verified_any_at = (SELECT min(observed_at) FROM verifications WHERE incident_id = i.id),
      latest_status_any = (SELECT status FROM verifications WHERE incident_id = i.id ORDER BY observed_at DESC, received_at DESC LIMIT 1)
    WHERE i.id = ANY($1::uuid[])`, [ids]);
}

export const hoursParam = (value: unknown, fallback: number, max: number) => {
  const hours = value === undefined || value === '' ? fallback : Number(value);
  requireCondition(Number.isInteger(hours) && hours >= 1 && hours <= max, 400, 'INVALID_INPUT', `Rentang waktu harus 1–${max} jam.`);
  return hours;
};
export const optionalText = (value: unknown) => (value === undefined || value === '' ? null : String(value).slice(0, 80));

/** Where-clause pieces for the province and regency filters, on a query that joins villages as v. */
export function regionFilter(query: Record<string, unknown>, params: unknown[]) {
  const parts: string[] = [];
  const province = optionalText(query.province), regency = optionalText(query.regency);
  if (province) { params.push(province); parts.push(`v.province = $${params.length}`); }
  if (regency) { params.push(regency); parts.push(`v.regency = $${params.length}`); }
  return parts.length ? ` AND ${parts.join(' AND ')}` : '';
}

export const incidentStatuses = ['all', 'open', 'assigned', 'checked'] as const;
/** Open = no field check and no open task; assigned = an open task; checked = at least one field check; as the scope sees them. */
export function statusFilter(status: (typeof incidentStatuses)[number], scope: Scope) {
  const s = scopeSql(scope);
  const openTask = `EXISTS (SELECT 1 FROM assignments x WHERE x.incident_id = i.id AND x.status IN ${OPEN}${s.rows('x')})`;
  return { all: '', open: ` AND ${s.firstVerified()} IS NULL AND NOT ${openTask}`, assigned: ` AND ${openTask}`, checked: ` AND ${s.firstVerified()} IS NOT NULL` }[status];
}
const sorts = ['priority', 'recent', 'size', 'checked'] as const;
/** `checked` orders by the latest field check of the scope (incidentSelect's lc). */
function sortSql(sort: (typeof sorts)[number], scope: Scope) {
  return {
    priority: `(${scopeSql(scope).firstVerified()} IS NULL AND i.level = 'tinggi') DESC, i.score DESC, i.last_detected_at DESC, i.id`,
    recent: 'i.last_detected_at DESC, i.score DESC, i.id',
    size: 'i.detection_count DESC, i.score DESC, i.id',
    checked: 'lc.observed_at DESC NULLS LAST, i.score DESC, i.id',
  }[sort];
}
const levels = ['tinggi', 'sedang', 'rendah'] as const;

// Vector tiles cut by PostGIS (ST_AsMVT). Shapes change only with new reference data; hotspots every ingest.
// Hotspot tiles take the time window ($4 hours, and $5 the archive day): field checks and tasks are never replayed,
// an archive tile shows their state now. Only kejadian carries field check and task state, as its scope sees it.
const tileSql = {
  desa: () => `SELECT ST_AsMVT(q, 'desa', 4096, 'geom') AS mvt FROM (SELECT id, name, district, regency, peat_share,
      ST_AsMVTGeom(geom_3857, ST_TileEnvelope($1, $2, $3), 4096, 64, true) AS geom
    FROM villages WHERE $1 >= 8 AND geom_3857 && ST_TileEnvelope($1, $2, $3, margin => 0.0156)) q`,
  kabupaten: () => `SELECT ST_AsMVT(q, 'kabupaten', 4096, 'geom') AS mvt FROM (SELECT name, province, villages,
      ST_AsMVTGeom(ST_SimplifyPreserveTopology(geom_3857, CASE WHEN $1 < 7 THEN 400 WHEN $1 < 9 THEN 120 ELSE 30 END), ST_TileEnvelope($1, $2, $3), 4096, 64, true) AS geom
    FROM regencies WHERE geom_3857 && ST_TileEnvelope($1, $2, $3, margin => 0.0156)) q`,
  kejadian: (window: TimeWindow, scope: Scope) => `SELECT ST_AsMVT(q, 'kejadian', 4096, 'geom') AS mvt FROM (SELECT i.id::text AS id, i.level, i.detection_count AS count, i.score,
      (${scopeSql(scope).firstVerified()} IS NOT NULL) AS verified, i.on_peat AS peat,
      EXISTS (SELECT 1 FROM assignments a WHERE a.incident_id = i.id AND a.status IN ${OPEN}${scopeSql(scope).rows('a')}) AS assigned, i.modis_only AS "modisOnly",
      ST_AsMVTGeom(i.centroid_3857, ST_TileEnvelope($1, $2, $3), 4096, 64, true) AS geom
    FROM incidents i WHERE i.village_id IS NOT NULL AND ${window.within('i.last_detected_at')}
      AND i.centroid_3857 && ST_TileEnvelope($1, $2, $3, margin => 0.0156) ORDER BY i.score) q`,
  // From zoom 11 a second layer, piksel, holds each detection's pixel footprint (see footprintSql) with the same
  // properties. Its candidates reach 2.6 km past the tile, as a MODIS pixel at the edge of a scan is up to 4.8 km
  // wide; ST_AsMVTGeom clips every box to the tile and its buffer. `age` counts hours before the end of the window.
  deteksi: (window: TimeWindow) => `WITH d AS (
      SELECT confidence, (village_id IS NOT NULL) AS inside, CASE WHEN satellite IN ('T', 'A') THEN 'MODIS' ELSE 'VIIRS' END AS sensor,
        greatest(0, floor(extract(epoch FROM ${window.end} - acq_at) / 3600))::integer AS age, satellite, latitude, scan, track, geom_3857
      FROM detections WHERE $1 >= 7 AND ${window.within('acq_at')}
        AND geom_3857 && ST_Expand(ST_TileEnvelope($1, $2, $3, margin => 0.0156), CASE WHEN $1 >= 11 THEN 2600 ELSE 0 END))
    SELECT (SELECT ST_AsMVT(q, 'deteksi', 4096, 'geom') FROM (SELECT confidence, inside, sensor, age,
          ST_AsMVTGeom(geom_3857, ST_TileEnvelope($1, $2, $3), 4096, 64, true) AS geom
        FROM d WHERE geom_3857 && ST_TileEnvelope($1, $2, $3, margin => 0.0156)) q)
      || (SELECT ST_AsMVT(p, 'piksel', 4096, 'geom') FROM (SELECT confidence, inside, sensor, age,
          ST_AsMVTGeom(${footprintSql('d')}, ST_TileEnvelope($1, $2, $3), 4096, 64, true) AS geom
        FROM d WHERE $1 >= 11) p) AS mvt`,
} as const;

/** Live hotspot tiles change with every ingest; archive days and shapes do not. */
const LIVE_TTL = 120_000, ARCHIVE_TTL = 3_600_000;
const tiles = new TileCache(32 * 1024 * 1024);
let archiveDays: { at: number; body: unknown } | null = null;
/**
 * Forgets every cut tile and the archive day counts, so the next request shows new detections, checks and tasks at once.
 * A demo account's check or task changes only what demo sessions see: with `scope` 'demo' just their tiles go.
 */
export const clearTileCache = (scope?: Scope) => {
  if (scope === 'demo') { tiles.drop(key => key.endsWith('/demo')); return; }
  tiles.clear(); archiveDays = null; firstDay = null;
};
/** Bytes held by the tile cache, for the tests. */
export const tileCacheBytes = () => tiles.totalBytes;

/** Passes of one satellite over an incident: detections less than 30 minutes apart belong to one pass. */
function passes(detections: { satellite: string; acq_at: Date }[]) {
  const last = new Map<string, { kind: 'detected'; at: string; satellite: string; count: number; end: number }>();
  const events: { kind: 'detected'; at: string; satellite: string; count: number; end: number }[] = [];
  for (const detection of detections) {
    const time = detection.acq_at.getTime();
    const open = last.get(detection.satellite);
    if (open && time - open.end <= 30 * 60_000) { open.count++; open.end = time; continue; }
    const event = { kind: 'detected' as const, at: detection.acq_at.toISOString(), satellite: detection.satellite, count: 1, end: time };
    events.push(event);
    last.set(detection.satellite, event);
  }
  return events.map(({ end: _end, ...event }) => event);
}

export function installIncidents(app: FastifyInstance, pool: pg.Pool) {
  // Panning through the archive asks for many tiles: tiles have their own limit per address instead of the general
  // one (a route with its own limit is counted only there), so a busy map never locks the lists and forms.
  app.get('/api/v1/tiles/:layer/:z/:x/:y', { config: { rateLimit: { max: 3000, timeWindow: '1 minute' } } }, async (request, reply) => {
    const params = object(request.params);
    const query = object(request.query ?? {});
    const layer = choice(params.layer, ['desa', 'kabupaten', 'kejadian', 'deteksi'] as const, 'Lapisan');
    const z = Number(params.z), x = Number(params.x), y = Number(String(params.y).replace(/\.mvt$/, ''));
    requireCondition([z, x, y].every(Number.isInteger) && z >= 0 && z <= 16 && x >= 0 && y >= 0 && x < 2 ** z && y < 2 ** z, 400, 'INVALID_INPUT', 'Ubin peta tidak valid. Muat ulang peta.');
    const hotspots = layer === 'kejadian' || layer === 'deteksi';
    const hours = hotspots ? hoursParam(query.hours, 24, 168) : 0;
    const tanggal = hotspots ? await archiveDate(pool, query.tanggal) : null;
    const ttl = hotspots && !tanggal ? LIVE_TTL : ARCHIVE_TTL;
    // Everyone gets the real scope. A demo session asks for its own view of field checks and tasks with &lihat=demo;
    // for anyone else the parameter changes nothing. Demo tiles stay out of shared caches.
    const scope: Scope = layer === 'kejadian' && query.lihat === 'demo' && request.user?.demo ? 'demo' : 'real';
    const key = `${layer}/${z}/${x}/${y}/${hours}/${tanggal ?? ''}/${scope}`;
    let body = tiles.get(key, ttl);
    if (!body) {
      const sqlParams: unknown[] = [z, x, y];
      const sql = layer === 'kejadian' ? tileSql.kejadian(timeWindow(sqlParams, hours, tanggal), scope)
        : layer === 'deteksi' ? tileSql.deteksi(timeWindow(sqlParams, hours, tanggal)) : tileSql[layer]();
      body = ((await pool.query(sql, sqlParams)).rows[0]?.mvt as Buffer | undefined) ?? Buffer.alloc(0);
      tiles.set(key, body);
    }
    reply.header('Content-Type', 'application/vnd.mapbox-vector-tile')
      .header('Cache-Control', scope === 'demo' ? 'private, max-age=60' : `public, max-age=${ttl / 1000}`);
    return body;
  });

  // Every WIB day of the archive with its detections and incidents inside the villages, zero included.
  app.get('/api/v1/archive/days', async () => {
    if (archiveDays && Date.now() - archiveDays.at < 600_000) return archiveDays.body;
    const { first, last } = await archiveBounds(pool);
    const from = `($1::date::timestamp AT TIME ZONE 'Asia/Jakarta')`, to = `(($2::date + 1)::timestamp AT TIME ZONE 'Asia/Jakarta')`;
    const rows = first > last ? [] : (await pool.query(`SELECT to_char(g.day, 'YYYY-MM-DD') AS date, COALESCE(d.n, 0)::integer AS detections, COALESCE(i.n, 0)::integer AS incidents
      FROM generate_series($1::date, $2::date, interval '1 day') AS g(day)
      LEFT JOIN (SELECT (acq_at AT TIME ZONE 'Asia/Jakarta')::date AS day, count(*) AS n FROM detections
        WHERE village_id IS NOT NULL AND acq_at >= ${from} AND acq_at < ${to} GROUP BY 1) d ON d.day = g.day::date
      LEFT JOIN (SELECT (first_detected_at AT TIME ZONE 'Asia/Jakarta')::date AS day, count(*) AS n FROM incidents
        WHERE village_id IS NOT NULL AND first_detected_at >= ${from} AND first_detected_at < ${to} GROUP BY 1) i ON i.day = g.day::date
      ORDER BY g.day`, [first, last])).rows;
    const body = { data: { first, last, days: rows } };
    archiveDays = { at: Date.now(), body };
    return body;
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

  // One bubble per regency on the zoomed-out map. `open` counts high-priority incidents nobody has checked or
  // been sent to yet; regencies without incidents in the window are left out.
  app.get('/api/v1/regions/summary', async request => {
    const query = object(request.query ?? {});
    const hours = hoursParam(query.hours, 24, 168);
    const params: unknown[] = [];
    const window = timeWindow(params, hours, await archiveDate(pool, query.tanggal));
    const where = regionFilter(query, params);
    const s = scopeSql(scopeOf(request));
    const rows = (await pool.query(`WITH tasks AS (SELECT DISTINCT a.incident_id FROM assignments a WHERE a.status IN ${OPEN}${s.rows('a')})
      SELECT r.name, r.province, ST_X(r.center) AS lon, ST_Y(r.center) AS lat, count(*)::integer AS incidents,
        count(*) FILTER (WHERE i.level = 'tinggi')::integer AS high,
        count(*) FILTER (WHERE i.level = 'tinggi' AND ${s.firstVerified()} IS NULL AND t.incident_id IS NULL)::integer AS open,
        count(*) FILTER (WHERE ${s.firstVerified()} IS NOT NULL)::integer AS checked
      FROM incidents i JOIN villages v ON v.id = i.village_id JOIN regencies r ON r.name = v.regency LEFT JOIN tasks t ON t.incident_id = i.id
      WHERE ${window.within('i.last_detected_at')}${where}
      GROUP BY r.name, r.province, r.center ORDER BY open DESC, high DESC, incidents DESC, r.name`, params)).rows;
    return { data: rows.map(row => ({ name: row.name, province: row.province, center: [row.lon, row.lat], incidents: row.incidents, high: row.high,
      open: row.open, checked: row.checked })) };
  });

  app.get('/api/v1/summary', async request => {
    const query = object(request.query ?? {});
    const hours = hoursParam(query.hours, 24, 168);
    const params: unknown[] = [];
    const window = timeWindow(params, hours, await archiveDate(pool, query.tanggal));
    const where = regionFilter(query, params);
    const s = scopeSql(scopeOf(request));
    const incidents = (await pool.query(`SELECT count(*)::integer AS incidents,
        count(*) FILTER (WHERE i.level = 'tinggi' AND ${s.firstVerified()} IS NULL)::integer AS high_open,
        count(*) FILTER (WHERE ${s.firstVerified()} IS NOT NULL)::integer AS verified,
        count(DISTINCT i.village_id)::integer AS villages
      FROM incidents i JOIN villages v ON v.id = i.village_id WHERE ${window.within('i.last_detected_at')}${where}`, params)).rows[0];
    const detections = (await pool.query(`SELECT count(*)::integer AS n FROM detections d JOIN villages v ON v.id = d.village_id
      WHERE ${window.within('d.acq_at')}${where}`, params)).rows[0];
    return { data: { hours, incidents: incidents.incidents, highOpen: incidents.high_open, verified: incidents.verified, villages: incidents.villages, detections: detections.n } };
  });

  app.get('/api/v1/villages', async request => {
    const query = object(request.query ?? {});
    const q = optionalText(query.q);
    const params: unknown[] = [];
    let where = regionFilter(query, params);
    if (q) { params.push(`%${q}%`); where += ` AND (v.name ILIKE $${params.length} OR v.district ILIKE $${params.length} OR v.regency ILIKE $${params.length})`; }
    const firstVerified = scopeSql(scopeOf(request)).firstVerified();
    const result = await pool.query(`SELECT v.id, v.name, v.district, v.regency, v.province, v.peat_share, v.area_ha, ST_X(v.center) AS lon, ST_Y(v.center) AS lat,
        count(i.id) FILTER (WHERE i.last_detected_at > now() - interval '24 hours')::integer AS incidents_24h,
        count(i.id) FILTER (WHERE i.last_detected_at > now() - interval '7 days')::integer AS incidents_7d,
        count(i.id) FILTER (WHERE i.last_detected_at > now() - interval '24 hours' AND i.level = 'tinggi' AND ${firstVerified} IS NULL)::integer AS open_high
      FROM villages v LEFT JOIN incidents i ON i.village_id = v.id WHERE true${where}
      GROUP BY v.id ORDER BY ${q ? 'v.name' : 'incidents_7d DESC, v.name'} LIMIT 60`, params);
    return { data: result.rows.map(row => ({ id: row.id, name: row.name, district: row.district, regency: row.regency, province: row.province,
      peatShare: Number(row.peat_share), areaHa: Number(row.area_ha), center: [row.lon, row.lat], incidents24h: row.incidents_24h, incidents7d: row.incidents_7d, openHigh: row.open_high })) };
  });

  app.get('/api/v1/villages/:id', async request => {
    const id = String(object(request.params).id);
    const village = (await pool.query(`SELECT id, name, district, regency, province, peat_share, area_ha, center_source, ST_X(center) AS lon, ST_Y(center) AS lat,
      ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.0001), 5)::json AS geometry FROM villages WHERE id = $1`, [id])).rows[0];
    requireCondition(village, 404, 'NOT_FOUND', 'Desa tidak ditemukan. Cari desa lain.');
    const incidents = await pool.query(`${incidentSelect(scopeOf(request))} WHERE i.village_id = $1 AND i.last_detected_at > now() - interval '7 days'
      ORDER BY i.last_detected_at DESC LIMIT 100`, [id]);
    const daily = await pool.query(`SELECT to_char(day, 'YYYY-MM-DD') AS day, count(d.id)::integer AS detections
      FROM generate_series((now() AT TIME ZONE 'Asia/Jakarta')::date - 6, (now() AT TIME ZONE 'Asia/Jakarta')::date, interval '1 day') AS day
      LEFT JOIN detections d ON d.village_id = $1 AND (d.acq_at AT TIME ZONE 'Asia/Jakarta')::date = day::date
      GROUP BY day ORDER BY day`, [id]);
    return { data: { id: village.id, name: village.name, district: village.district, regency: village.regency, province: village.province,
      peatShare: Number(village.peat_share), areaHa: Number(village.area_ha), center: [village.lon, village.lat], centerSource: village.center_source,
      geometry: village.geometry, incidents: incidents.rows.map(row => incidentModel(row, request.user)), daily: daily.rows } };
  });

  // The incident list for the map sidebar, the volunteer and the agency queues, with the same filters as the map.
  app.get('/api/v1/incidents', async request => {
    const query = object(request.query ?? {});
    const hours = hoursParam(query.hours, 72, 168);
    const params: unknown[] = [];
    const window = timeWindow(params, hours, await archiveDate(pool, query.tanggal));
    let where = regionFilter(query, params);
    if (query.level !== undefined && query.level !== '') {
      const chosen = String(query.level).split(',').map(level => choice(level.trim(), levels, 'Prioritas'));
      params.push(chosen); where += ` AND i.level = ANY($${params.length}::text[])`;
    }
    const scope = scopeOf(request);
    where += statusFilter(choice(query.status ?? 'all', incidentStatuses, 'Status'), scope);
    const peat = choice(query.peat === undefined || query.peat === '' ? '0' : String(query.peat), ['0', '1', 'true', 'false'] as const, 'Filter gambut');
    if (peat === '1' || peat === 'true') where += ' AND i.on_peat';
    if (query.village !== undefined) { params.push(String(query.village)); where += ` AND i.village_id = $${params.length}`; }
    const sort = choice(query.sort ?? 'priority', sorts, 'Urutan');
    const limit = query.limit === undefined || query.limit === '' ? 100 : Number(query.limit);
    requireCondition(Number.isInteger(limit) && limit >= 1 && limit <= 500, 400, 'INVALID_INPUT', 'Batas daftar harus 1–500.');
    const result = await pool.query(`${incidentSelect(scope)} WHERE i.village_id IS NOT NULL AND ${window.within('i.last_detected_at')}${where}
      ORDER BY ${sortSql(sort, scope)} LIMIT ${limit}`, params);
    return { data: result.rows.map(row => incidentModel(row, request.user)) };
  });

  app.get('/api/v1/incidents/:id', async request => {
    const scope = scopeOf(request);
    const s = scopeSql(scope);
    const row = await getIncident(pool, String(object(request.params).id), scope);
    const viewer = request.user;
    const detections = await pool.query(`SELECT id, satellite, acq_at, latitude, longitude, confidence, confidence_pct, frp, bright_ti4, scan, track, daynight,
        on_peat, near_static
      FROM detections WHERE incident_id = $1 ORDER BY acq_at, id`, [row.id]);
    // The public sees what was found and when; who checked it, their notes and photos are for signed-in teams, and for a
    // demo session only on demo checks (see seesPrivate). Field checks and tasks are those of the scope.
    const verifications = await pool.query(`SELECT v.id, v.status, v.false_alarm_kind, v.observed_at, v.received_at, v.distance_m, v.is_demo,
        v.note, v.photo_url, v.photo_thumb_url, u.name AS reporter, u.role AS reporter_role
      FROM verifications v JOIN users u ON u.id = v.user_id WHERE v.incident_id = $1${s.rows('v')} ORDER BY v.observed_at DESC`, [row.id]);
    const tasks = await pool.query(`SELECT a.status, a.created_at, a.enroute_at, a.closed_at, u.name AS assignee
      FROM assignments a JOIN users u ON u.id = a.assignee_id WHERE a.incident_id = $1${s.rows('a')} ORDER BY a.created_at`, [row.id]);
    const order = { detected: 0, assigned: 1, enroute: 2, checked: 3, cancelled: 4 } as const;
    const timeline = [
      ...passes(detections.rows),
      ...tasks.rows.flatMap(task => [
        { kind: 'assigned' as const, at: task.created_at.toISOString(), actor: task.assignee },
        ...(task.enroute_at ? [{ kind: 'enroute' as const, at: task.enroute_at.toISOString(), actor: task.assignee }] : []),
        ...(task.status === 'dibatalkan' && task.closed_at ? [{ kind: 'cancelled' as const, at: task.closed_at.toISOString(), actor: task.assignee }] : []),
      ]),
      ...verifications.rows.map(v => ({ kind: 'checked' as const, at: v.observed_at.toISOString(), status: v.status, demo: v.is_demo,
        ...(seesPrivate(viewer, v.is_demo) ? { actor: v.reporter } : {}) })),
    ].sort((a, b) => a.at.localeCompare(b.at) || order[a.kind] - order[b.kind]);
    return { data: { ...incidentModel(row, viewer),
      detections: detections.rows.map(d => ({ id: Number(d.id), satellite: d.satellite, sensor: d.satellite === 'T' || d.satellite === 'A' ? 'MODIS' : 'VIIRS',
        acqAt: d.acq_at.toISOString(), latitude: d.latitude, longitude: d.longitude, confidence: d.confidence, confidencePct: d.confidence_pct,
        frp: d.frp === null ? null : Number(d.frp), brightTi4: d.bright_ti4 === null ? null : Number(d.bright_ti4),
        scan: d.scan === null ? null : Number(d.scan), track: d.track === null ? null : Number(d.track), daynight: d.daynight,
        onPeat: d.on_peat, nearStatic: d.near_static })),
      verifications: verifications.rows.map(v => ({ id: v.id, status: v.status, falseAlarmKind: v.false_alarm_kind, observedAt: v.observed_at.toISOString(),
        receivedAt: v.received_at.toISOString(), distanceMeters: v.distance_m, demo: v.is_demo,
        ...(seesPrivate(viewer, v.is_demo) ? { note: v.note, photoUrl: v.photo_url, photoThumbUrl: v.photo_thumb_url, reporter: v.reporter } : {}) })),
      timeline } };
  });
}
