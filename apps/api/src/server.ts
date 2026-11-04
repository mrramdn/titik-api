import { createApp } from './app.js';
import { reconcileDemoScope } from './reconcile.js';
import { startScheduler } from './scheduler.js';
import { seed } from './seed.js';
import { startWeatherScheduler } from './weather.js';

const { app, pool } = await createApp();
await app.listen({ port: Number(process.env.PORT ?? 3000), host: process.env.HOST ?? '0.0.0.0' });

// An empty database gets its week of satellite history and the demo accounts after the server is up, so the
// health check passes while FIRMS downloads. Production seeds only when SEED_DEMO=true.
const seedDemo = process.env.SEED_DEMO === 'true' || (!process.env.SEED_DEMO && process.env.NODE_ENV !== 'production');
let stop = () => {};
let stopWeather = async () => {};
(async () => {
  if (seedDemo) {
    try { if (await seed(pool)) app.log.info('Demo accounts created'); }
    catch (error) { app.log.error({ err: error }, 'Seeding failed'); }
  }
  // Rows an older version wrote the old way (after a rollback and a roll-forward) go back to the demo scope before the
  // schedulers start. Silent when there is nothing to put right.
  try {
    const fixed = await reconcileDemoScope(pool);
    if (fixed.tasks || fixed.checks || fixed.incidents) app.log.warn(fixed, 'Demo rows written the old way put right');
  } catch (error) { app.log.error({ err: error }, 'Demo scope check failed'); }
  stop = startScheduler(pool, app.log);
  // Fire weather from Open-Meteo every few hours, the first time 30 seconds after this; it never holds up the server.
  stopWeather = startWeatherScheduler(pool, app.log);
})();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    stop();
    // app.close() waits for every database client. A weather run under way lets go of its own at its next request,
    // pause or save: up to 5 s for that, well inside the 10 s Docker gives before it kills the process.
    await Promise.race([stopWeather(), new Promise(resolve => setTimeout(resolve, 5_000))]);
    await app.close();
    process.exit(0);
  });
}
