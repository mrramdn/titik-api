import { createApp } from './app.js';
import { startScheduler } from './scheduler.js';
import { seed } from './seed.js';

const { app, pool } = await createApp();
await app.listen({ port: Number(process.env.PORT ?? 3000), host: process.env.HOST ?? '0.0.0.0' });

// An empty database gets its week of satellite history and the demo accounts after the server is up, so the
// health check passes while FIRMS downloads. Production seeds only when SEED_DEMO=true.
const seedDemo = process.env.SEED_DEMO === 'true' || (!process.env.SEED_DEMO && process.env.NODE_ENV !== 'production');
let stop = () => {};
(async () => {
  if (seedDemo) {
    try { if (await seed(pool)) app.log.info('Demo accounts created'); }
    catch (error) { app.log.error({ err: error }, 'Seeding failed'); }
  }
  stop = startScheduler(pool, app.log);
})();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => { stop(); await app.close(); process.exit(0); });
}
