import type { FastifyBaseLogger } from 'fastify';
import type pg from 'pg';
import { ingestWithFallback } from './ingest.js';
import { loadPeatMask } from './peat.js';
import { pushAlerts } from './push.js';
import { schedule } from './status.js';

/**
 * Pulls FIRMS every few minutes inside the API process and pushes the new alerts: the first pull 5 seconds after
 * start, then on a fixed beat. The time of the next pull is published in /ingest/status. Returns a stop function.
 */
export function startScheduler(pool: pg.Pool, log: FastifyBaseLogger, minutes = Number(process.env.INGEST_INTERVAL_MINUTES ?? 30)) {
  if (!minutes || minutes <= 0) return () => {};
  schedule.intervalMinutes = minutes;
  const peat = loadPeatMask();
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  const tick = async () => {
    try {
      const result = await ingestWithFallback(pool, await peat, '24h');
      if (!result.skipped) log.info({ inArea: result.inArea, inserted: result.inserted, incidents: result.incidents.length, alerts: result.alerts.length,
        feeds: result.feeds.map(feed => `${feed.satellite}:${feed.error ? 'error' : feed.inArea}`) }, 'FIRMS ingest finished');
      if (result.alerts.length) log.info({ delivered: await pushAlerts(pool, result.alerts.map(alert => alert.id)) }, 'Push notifications sent');
    } catch (error) {
      log.error({ err: error }, 'FIRMS ingest failed');
    }
  };
  const plan = (at: number) => {
    schedule.nextRunAt = new Date(at);
    timer = setTimeout(async () => {
      // While this pull runs, the status already names the one after it.
      schedule.nextRunAt = new Date(at + minutes * 60_000);
      await tick();
      if (stopped) return;
      // Keep the beat; a pull that ran past the next slot moves on to the one after.
      let next = at + minutes * 60_000;
      while (next <= Date.now()) next += minutes * 60_000;
      plan(next);
    }, Math.max(0, at - Date.now()));
  };
  plan(Date.now() + 5_000);
  return () => { stopped = true; clearTimeout(timer); schedule.nextRunAt = null; };
}
