import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import staticFiles from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import type pg from 'pg';
import { createPool } from './db.js';
import { installAuth } from './auth.js';
import { installIncidents, type TileLimits } from './incidents.js';
import { installAlerts } from './alerts.js';
import { installVerifications } from './verifications.js';
import { installDashboard } from './dashboard.js';
import { installAssignments } from './assignments.js';
import { installRecap } from './recap.js';
import { installStatus } from './status.js';
import { installShare } from './share.js';
import { installRisk } from './weather.js';
import { installWind, type WindOptions } from './wind.js';
import { installImagery, type ImageryOptions } from './imagery.js';
import { ApiError } from './errors.js';
import type { Sender } from './push.js';
import { uploadsDirectory } from './uploads.js';

interface Options {
  pool?: pg.Pool; uploadsDir?: string; webDir?: string; origins?: string[]; production?: boolean; logger?: boolean; trustProxy?: string | false; pushSender?: Sender; demoLogin?: boolean;
  /** Limits on map tiles that miss the cache; the tests make them small. */
  tiles?: Partial<TileLimits>;
  /** Open-Meteo for the wind at an incident; the tests answer it themselves. */
  weatherFetch?: typeof fetch;
  /** The wind lookups' budget of calls to Open-Meteo, and their clock; the tests set their own. */
  wind?: Partial<Omit<WindOptions, 'fetch'>>;
  /** Esri World Imagery: key, caps and clock come from the environment; the tests set their own and answer Esri. */
  imagery?: Partial<ImageryOptions>;
  /** Where the log goes instead of stdout (the tests read it). */
  logStream?: { write(line: string): void };
}

// Addresses or ranges of the reverse proxies in front of the API. Only they may report a client address;
// trusting every hop would let a client choose its own. "true" means a proxy on a private network.
export function trustedProxies(value = process.env.TRUST_PROXY): string | false {
  if (!value || value === 'false') return false;
  return value === 'true' ? 'loopback, linklocal, uniquelocal' : value;
}

/**
 * A request as the log keeps it: its method, path and host, not who sent it. Fastify's own adds the client's address
 * and port; nginx already keeps visitors' addresses for 14 days, and the container log has no such limit.
 */
const requestLog = (request: FastifyRequest) => ({ method: request.method, url: request.url, host: request.host });

export async function createApp(options: Options = {}) {
  const ownsPool = !options.pool;
  const pool = options.pool ?? createPool();
  const uploadsDir = options.uploadsDir ?? uploadsDirectory();
  const webDir = options.webDir ?? resolve(process.env.WEB_DIR ?? '../web/dist');
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const origins = new Set(options.origins ?? (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173').split(',').map(item => item.trim()));
  const app = Fastify({
    logger: options.logger ?? { redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'], serializers: { req: requestLog },
      ...(options.logStream && { stream: options.logStream }) },
    bodyLimit: 64 * 1024,
    trustProxy: options.trustProxy ?? trustedProxies(),
  });
  // onClose hooks run last added first: the pool, added first, closes after the others (the imagery count is written).
  if (ownsPool) app.addHook('onClose', () => pool.end());
  await mkdir(uploadsDir, { recursive: true });
  await app.register(cookie);
  await app.register(cors, { origin: [...origins], credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] });
  // The plugin throws what the builder returns, so it must carry its own status. Only API calls count.
  await app.register(rateLimit, { max: request => (request.method === 'GET' ? 900 : 300), timeWindow: '1 minute', allowList: request => !request.url.startsWith('/api/'),
    errorResponseBuilder: (_request, context) => new ApiError(context.statusCode, 'RATE_LIMITED', 'Terlalu banyak permintaan. Tunggu satu menit, lalu ulangi.') });
  await app.register(multipart, { limits: { fileSize: 6 * 1024 * 1024, files: 1, fields: 12, fieldSize: 4096 } });
  await app.register(staticFiles, { root: uploadsDir, prefix: '/uploads/', index: false, dotfiles: 'deny', setHeaders(reply) {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'private, max-age=86400');
  } });
  if (existsSync(webDir)) await app.register(staticFiles, { root: webDir, prefix: '/', wildcard: false, decorateReply: false, index: false, setHeaders(reply, path) {
    // Vite fingerprints everything under /assets; the shell, the manifest and the service worker must revalidate.
    reply.header('Cache-Control', path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
  } });

  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    // Other sites get the origin only, never a path.
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Permissions-Policy', 'geolocation=(self), camera=(self)');
  });
  installAuth(app, pool, origins, production, options.demoLogin);
  installIncidents(app, pool, options.tiles);
  installAlerts(app, pool, options.pushSender);
  installVerifications(app, pool, uploadsDir);
  installDashboard(app, pool);
  installAssignments(app, pool, options.pushSender);
  installRecap(app, pool);
  installStatus(app, pool);
  installRisk(app, pool);
  installWind(app, pool, { ...options.wind, ...(options.weatherFetch && { fetch: options.weatherFetch }) });
  installShare(app, pool, webDir);
  const imagery = installImagery(app, pool, origins, options.imagery);

  app.get('/api/v1/health', async () => {
    await pool.query('SELECT 1');
    return { data: { status: 'ok' } };
  });
  // Public settings for the web app. HD imagery comes through GET /imagery; the ArcGIS key stays on the server.
  app.get('/api/v1/config', async () => ({ data: await imagery.config() }));
  app.setNotFoundHandler((request, reply) => {
    if (request.method === 'GET' && !request.url.startsWith('/api') && !request.url.startsWith('/uploads') && existsSync(`${webDir}/index.html`)) {
      return reply.header('Cache-Control', 'no-cache').type('text/html').sendFile('index.html', webDir);
    }
    return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Halaman tidak ditemukan. Periksa alamatnya.' } });
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    const pgError = error as { code?: string; statusCode?: number };
    if (pgError.code === '23505') return reply.code(409).send({ error: { code: 'CONFLICT', message: 'Data ini sudah tercatat. Muat ulang halaman.' } });
    if (pgError.statusCode && pgError.statusCode < 500) return reply.code(pgError.statusCode).send({ error: { code: 'INVALID_INPUT', message: pgError.statusCode === 413 ? 'Foto lebih dari 6 MB. Pilih foto yang lebih kecil.' : 'Permintaan tidak valid. Muat ulang halaman.' } });
    request.log.error({ err: error }, 'Request failed');
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan di server. Ulangi beberapa menit lagi.' } });
  });
  return { app, pool };
}
