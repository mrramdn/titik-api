import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import staticFiles from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import type pg from 'pg';
import { createPool } from './db.js';
import { installAuth } from './auth.js';
import { installIncidents } from './incidents.js';
import { installAlerts } from './alerts.js';
import { installVerifications } from './verifications.js';
import { installDashboard } from './dashboard.js';
import { installShare } from './share.js';
import { ApiError } from './errors.js';
import type { Sender } from './push.js';

interface Options { pool?: pg.Pool; uploadsDir?: string; webDir?: string; origins?: string[]; production?: boolean; logger?: boolean; trustProxy?: string | false; pushSender?: Sender; demoLogin?: boolean }

// Addresses or ranges of the reverse proxies in front of the API. Only they may report a client address;
// trusting every hop would let a client choose its own. "true" means a proxy on a private network.
export function trustedProxies(value = process.env.TRUST_PROXY): string | false {
  if (!value || value === 'false') return false;
  return value === 'true' ? 'loopback, linklocal, uniquelocal' : value;
}

export async function createApp(options: Options = {}) {
  const ownsPool = !options.pool;
  const pool = options.pool ?? createPool();
  const uploadsDir = options.uploadsDir ?? resolve(process.env.UPLOAD_DIR ?? 'storage/uploads');
  const webDir = options.webDir ?? resolve(process.env.WEB_DIR ?? '../web/dist');
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const origins = new Set(options.origins ?? (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173').split(',').map(item => item.trim()));
  const app = Fastify({
    logger: options.logger ?? { redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'] },
    bodyLimit: 64 * 1024,
    trustProxy: options.trustProxy ?? trustedProxies(),
  });
  await mkdir(uploadsDir, { recursive: true });
  await app.register(cookie);
  await app.register(cors, { origin: [...origins], credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] });
  // The plugin throws what the builder returns, so it must carry its own status. Only API calls count.
  await app.register(rateLimit, { max: request => (request.method === 'GET' ? 900 : 300), timeWindow: '1 minute', allowList: request => !request.url.startsWith('/api/'),
    errorResponseBuilder: (_request, context) => new ApiError(context.statusCode, 'RATE_LIMITED', 'Terlalu banyak permintaan. Coba lagi sebentar.') });
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
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Permissions-Policy', 'geolocation=(self), camera=(self)');
  });
  installAuth(app, pool, origins, production, options.demoLogin);
  installIncidents(app, pool);
  installAlerts(app, pool, options.pushSender);
  installVerifications(app, pool, uploadsDir);
  installDashboard(app, pool);
  installShare(app, pool, webDir);

  app.get('/api/v1/health', async () => {
    await pool.query('SELECT 1');
    return { data: { status: 'ok' } };
  });
  app.setNotFoundHandler((request, reply) => {
    if (request.method === 'GET' && !request.url.startsWith('/api') && !request.url.startsWith('/uploads') && existsSync(`${webDir}/index.html`)) {
      return reply.header('Cache-Control', 'no-cache').type('text/html').sendFile('index.html', webDir);
    }
    return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Halaman tidak ditemukan.' } });
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    const pgError = error as { code?: string; statusCode?: number };
    if (pgError.code === '23505') return reply.code(409).send({ error: { code: 'CONFLICT', message: 'Data ini sudah tercatat.' } });
    if (pgError.statusCode && pgError.statusCode < 500) return reply.code(pgError.statusCode).send({ error: { code: 'INVALID_INPUT', message: pgError.statusCode === 413 ? 'Ukuran foto maksimal 6 MB.' : 'Permintaan tidak valid.' } });
    request.log.error({ err: error }, 'Request failed');
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan. Silakan coba lagi.' } });
  });
  if (ownsPool) app.addHook('onClose', () => pool.end());
  return { app, pool };
}
