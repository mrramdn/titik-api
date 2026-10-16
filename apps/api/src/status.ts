// How fresh the data is and when the next satellite pass should land. The polar orbiters cross the two provinces
// at roughly fixed times of day, and FIRMS publishes each pass within about three hours. Windows are learned
// from the last 7 days of acquisition times per satellite, so slow orbit drift (Terra and Aqua) is followed;
// a window with too few passes falls back to the default windows measured from the FIRMS files of 8–16 Oct 2026.
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { feedActive, feeds, satellites, sensorOf, type Satellite } from './firms.js';
import { satelliteLabel } from './geo.js';

/** Filled in by the scheduler; null when no scheduler runs in this process. */
export const schedule = { intervalMinutes: Number(process.env.INGEST_INTERVAL_MINUTES ?? 30), nextRunAt: null as Date | null };

const MINUTE = 60_000;
/** Data usually lands within three hours of the end of a pass. */
const DELAY_MINUTES = 180;
type Window = [start: number, end: number];
/** Minutes of the WIB day: VIIRS 12.00–14.40 and 00.00–02.30, Terra 07.30–09.10 and 19.30–21.30, Aqua 14.40–16.20 and 02.30–04.30. */
export const defaultWindows: Record<Satellite, Window[]> = {
  N21: [[720, 880], [0, 150]], N20: [[720, 880], [0, 150]], N: [[720, 880], [0, 150]],
  T: [[450, 550], [1170, 1290]], A: [[880, 980], [150, 270]],
};

/**
 * Each default window takes the acquisitions closest to it (around the clock); with passes on at least 3 days,
 * the window becomes their span plus 10 minutes on both sides, unless that is wider than 4 hours.
 */
export function learnWindows(satellite: Satellite, acquisitions: { day: string; minute: number }[]) {
  return defaultWindows[satellite].map(([start, end], index, all) => {
    const centre = (start + end) / 2;
    const offset = (minute: number, from: number) => ((minute - from + 720 + 1440 * 2) % 1440) - 720;
    const mine = acquisitions.filter(a => all.every(([s, e], other) => other === index || Math.abs(offset(a.minute, centre)) <= Math.abs(offset(a.minute, (s + e) / 2))));
    const days = new Set(mine.map(a => a.day)).size;
    if (days < 3) return { window: [start, end] as Window, learned: false };
    const offsets = mine.map(a => offset(a.minute, centre));
    const learned: Window = [Math.round(centre + Math.min(...offsets) - 10), Math.round(centre + Math.max(...offsets) + 10)];
    return learned[1] - learned[0] > 240 ? { window: [start, end] as Window, learned: false } : { window: learned, learned: true };
  });
}

const wibMidnight = (time: number) => { const wib = new Date(time + 7 * 3600_000); return Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate()) - 7 * 3600_000; };

/**
 * The window whose data has not arrived yet: the next pass, or one that has passed while its data is on the way.
 * Data from up to an hour before a window counts for it. When `expectedBy` is already behind the server time,
 * the pass is overdue. Windows more than 18 hours old are never shown.
 */
export function nextWindow(windows: Window[], lastSeen: number | null, now: number) {
  const today = wibMidnight(now);
  const occurrences = [-1, 0, 1].flatMap(days => windows.map(([start, end]) => ({ start: today + days * 1440 * MINUTE + start * MINUTE, end: today + days * 1440 * MINUTE + end * MINUTE })))
    .filter(w => w.end > now - 18 * 3600_000).sort((a, b) => a.start - b.start);
  const next = occurrences.find(w => lastSeen === null || w.start - 60 * MINUTE > lastSeen);
  return next ? { start: new Date(next.start).toISOString(), end: new Date(next.end).toISOString(), expectedBy: new Date(next.end + DELAY_MINUTES * MINUTE).toISOString() } : null;
}

interface Stats {
  latest: Map<string, Date>; ingested: Map<string, Date>; last24h: Map<string, number>; latency: Map<string, number>; published: Map<string, number>;
  acquisitions: Map<string, { day: string; minute: number }[]>;
}
let cached: { at: number; stats: Stats } | null = null;
/** Forgets the satellite statistics, so the next status shows a run that just finished. */
export const clearStatusCache = () => { cached = null; };

async function satelliteStats(pool: pg.Pool): Promise<Stats> {
  if (cached && Date.now() - cached.at < 60_000) return cached.stats;
  const [latest, latency, acquisitions, runs] = await Promise.all([
    pool.query(`SELECT satellite, max(acq_at) AS latest, max(ingested_at) AS ingested, count(*) FILTER (WHERE acq_at > now() - interval '24 hours')::integer AS last_24h
      FROM detections WHERE acq_at > now() - interval '14 days' GROUP BY satellite`),
    // Only rows that arrived within 6 hours of the pass: backfills would say nothing about how fast FIRMS is.
    pool.query(`SELECT satellite, percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM ingested_at - acq_at) / 60) AS median
      FROM detections WHERE acq_at > now() - interval '14 days' AND ingested_at >= acq_at AND ingested_at - acq_at <= interval '6 hours' GROUP BY satellite`),
    pool.query(`SELECT satellite, to_char(acq_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS day,
        (extract(hour FROM acq_at AT TIME ZONE 'Asia/Jakarta') * 60 + extract(minute FROM acq_at AT TIME ZONE 'Asia/Jakarta'))::integer AS minute
      FROM detections WHERE acq_at > now() - interval '7 days' GROUP BY 1, 2, 3`),
    // A pass that saw no fire in the two provinces still shows up elsewhere in the regional file.
    pool.query(`SELECT feeds FROM ingest_runs WHERE finished_at > now() - interval '36 hours' AND error IS NULL`),
  ]);
  const stats: Stats = { latest: new Map(), ingested: new Map(), last24h: new Map(), latency: new Map(), published: new Map(), acquisitions: new Map() };
  for (const row of latest.rows) { stats.latest.set(row.satellite, row.latest); stats.ingested.set(row.satellite, row.ingested); stats.last24h.set(row.satellite, row.last_24h); }
  for (const row of latency.rows) stats.latency.set(row.satellite, Math.round(Number(row.median)));
  for (const row of acquisitions.rows) stats.acquisitions.set(row.satellite, [...(stats.acquisitions.get(row.satellite) ?? []), { day: row.day, minute: row.minute }]);
  for (const run of runs.rows) {
    for (const feed of (Array.isArray(run.feeds) ? run.feeds : []) as { satellite?: string; latestAll?: string | null }[]) {
      const time = feed.latestAll ? Date.parse(feed.latestAll) : NaN;
      if (feed.satellite && Number.isFinite(time) && time > (stats.published.get(feed.satellite) ?? 0)) stats.published.set(feed.satellite, time);
    }
  }
  cached = { at: Date.now(), stats };
  return stats;
}

export function installStatus(app: FastifyInstance, pool: pg.Pool) {
  app.get('/api/v1/ingest/status', async () => {
    const now = new Date();
    const runs = await pool.query(`SELECT id, started_at, finished_at, source, feeds, fetched, in_area, inserted, incidents_touched, error
      FROM ingest_runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 5`);
    const success = (await pool.query('SELECT max(id) AS id FROM ingest_runs WHERE finished_at IS NOT NULL AND error IS NULL')).rows[0]?.id;
    const stats = await satelliteStats(pool);
    const last = runs.rows[0];
    return { data: {
      serverTime: now.toISOString(),
      runId: success === null || success === undefined ? null : Number(success),
      intervalMinutes: schedule.intervalMinutes,
      nextRunAt: schedule.nextRunAt?.toISOString() ?? null,
      lastRun: last ? { finishedAt: last.finished_at.toISOString(), ok: last.error === null, error: last.error } : null,
      runs: runs.rows.map(run => ({ id: Number(run.id), startedAt: run.started_at.toISOString(), finishedAt: run.finished_at.toISOString(), source: run.source,
        feeds: run.feeds, fetched: run.fetched, inArea: run.in_area, inserted: run.inserted, incidentsTouched: run.incidents_touched, error: run.error })),
      satellites: satellites.map(satellite => {
        const feed = feeds.find(item => item.satellites.includes(satellite));
        const active = feed ? feedActive(feed, now) : false;
        const latest = stats.latest.get(satellite) ?? null;
        const learned = learnWindows(satellite, stats.acquisitions.get(satellite) ?? []);
        const seen = Math.max(latest?.getTime() ?? 0, stats.published.get(satellite) ?? 0);
        return { satellite, label: satelliteLabel[satellite]!, sensor: sensorOf(satellite), active,
          latestAcquisition: latest?.toISOString() ?? null, latestIngestedAt: stats.ingested.get(satellite)?.toISOString() ?? null,
          last24h: stats.last24h.get(satellite) ?? 0, medianLatencyMin: stats.latency.get(satellite) ?? null,
          nextWindow: active ? nextWindow(learned.map(item => item.window), seen || null, now.getTime()) : null,
          windowsLearned: learned.every(item => item.learned) };
      }),
    } };
  });
}
