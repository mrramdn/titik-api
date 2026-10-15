import type { FastifyBaseLogger } from 'fastify';
import type pg from 'pg';
import { ingestWithFallback } from './ingest.js';
import { loadPeatMask } from './peat.js';
import { pushAlerts } from './push.js';

/** Pulls FIRMS every few minutes inside the API process and pushes the new cards. Returns a stop function. */
export function startScheduler(pool: pg.Pool, log: FastifyBaseLogger, minutes = Number(process.env.INGEST_INTERVAL_MINUTES ?? 30)) {
  if (!minutes || minutes <= 0) return () => {};
  const peat = loadPeatMask();
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await ingestWithFallback(pool, await peat, '24h');
      if (!result.skipped) log.info({ inArea: result.inArea, inserted: result.inserted, incidents: result.incidents.length, alerts: result.alerts.length,
        feeds: result.feeds.map(feed => `${feed.satellite}:${feed.error ? 'error' : feed.inArea}`) }, 'FIRMS ingest finished');
      if (result.alerts.length) log.info({ delivered: await pushAlerts(pool, result.alerts.map(alert => alert.id)) }, 'Push notifications sent');
    } catch (error) {
      log.error({ err: error }, 'FIRMS ingest failed');
    } finally { running = false; }
  };
  const first = setTimeout(tick, 5_000);
  const timer = setInterval(tick, minutes * 60_000);
  return () => { clearTimeout(first); clearInterval(timer); };
}
