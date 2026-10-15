import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { ApiError, choice, object, requireCondition, text } from './errors.js';
import { demoDomain, userModel, type Role, type User } from './models.js';

// A session lasts 30 days from its last use; it is extended at most once a day.
export const SESSION_SECONDS = 30 * 24 * 60 * 60;
const RENEW_AFTER_SECONDS = 24 * 60 * 60;
const cookieName = 'titikapi_session';
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const dummyPasswordHash = argon2.hash(randomBytes(32).toString('hex'), { type: argon2.argon2id });

function passwordInput(value: unknown, minimum: number) {
  requireCondition(typeof value === 'string' && value.length >= minimum && value.length <= 128, 400, 'INVALID_INPUT', `Password harus ${minimum}–128 karakter.`);
  return value;
}

declare module 'fastify' { interface FastifyRequest { user: User | null; sessionHash: string | null } }

export function installAuth(app: FastifyInstance, pool: pg.Pool, origins: Set<string>, production: boolean, demoLogin = process.env.DEMO_LOGIN !== 'false') {
  app.decorateRequest('user', null);
  app.decorateRequest('sessionHash', null);

  function checkOrigin(request: FastifyRequest) {
    requireCondition(typeof request.headers.origin === 'string' && origins.has(request.headers.origin), 403, 'INVALID_ORIGIN', 'Asal permintaan tidak diizinkan.');
  }

  const sessionCookie = { httpOnly: true, secure: production, sameSite: 'lax', path: '/', maxAge: SESSION_SECONDS } as const;

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    const origin = request.headers.origin;
    if (origin && !origins.has(origin)) throw new ApiError(403, 'INVALID_ORIGIN', 'Asal permintaan tidak diizinkan.');
    const authorization = request.headers.authorization;
    const bearer = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    const token = bearer ?? request.cookies[cookieName];
    if (!token) return;
    if (!bearer && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) checkOrigin(request);
    const tokenHash = hashToken(token);
    const result = await pool.query(`SELECT u.*, s.expires_at < now() + make_interval(secs => $2) AS renew
      FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [tokenHash, SESSION_SECONDS - RENEW_AFTER_SECONDS]);
    const row = result.rows[0];
    if (!row) return;
    request.user = userModel(row);
    request.sessionHash = tokenHash;
    if (row.renew) {
      await pool.query('UPDATE sessions SET expires_at = now() + make_interval(secs => $2) WHERE token_hash = $1', [tokenHash, SESSION_SECONDS]);
      if (!bearer) reply.setCookie(cookieName, token, sessionCookie);
    }
  });

  const rateLimit = { max: 30, timeWindow: '1 minute' };
  async function startSession(request: FastifyRequest, reply: FastifyReply, user: User, client: 'mobile' | 'web') {
    if (client === 'web') checkOrigin(request);
    const token = randomBytes(32).toString('base64url');
    await pool.query('DELETE FROM sessions WHERE expires_at < now()');
    await pool.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))', [hashToken(token), user.id, SESSION_SECONDS]);
    if (client === 'web') reply.setCookie(cookieName, token, sessionCookie);
    return { data: { user, ...(client === 'mobile' ? { token } : {}) } };
  }

  app.post('/api/v1/auth/login', { config: { rateLimit } }, async (request, reply) => {
    const body = object(request.body);
    const client = choice(body.client, ['mobile', 'web'] as const, 'Client');
    if (client === 'web') checkOrigin(request);
    const email = text(body.email, 'Email', 3, 254).toLowerCase();
    const password = passwordInput(body.password, 1);
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const row = result.rows[0];
    const validPassword = await argon2.verify(row?.password_hash ?? await dummyPasswordHash, password);
    requireCondition(row && validPassword, 401, 'INVALID_CREDENTIALS', 'Email atau password salah.');
    return startSession(request, reply, userModel(row), client);
  });

  // The judges and anyone trying the prototype sign in with one tap. Only the shared demo accounts can be
  // opened this way, and the switch turns it off for a real deployment.
  app.post('/api/v1/auth/demo', { config: { rateLimit } }, async (request, reply) => {
    requireCondition(demoLogin, 404, 'NOT_FOUND', 'Masuk demo tidak tersedia.');
    const body = object(request.body);
    const role = choice(body.role, ['mpa', 'kades', 'bpbd'] as const, 'Peran');
    const client = body.client === undefined ? 'web' : choice(body.client, ['mobile', 'web'] as const, 'Client');
    const row = (await pool.query('SELECT * FROM users WHERE email = $1', [`${role}${demoDomain}`])).rows[0];
    requireCondition(row, 404, 'NOT_FOUND', 'Akun demo belum disiapkan.');
    return startSession(request, reply, userModel(row), client);
  });

  app.get('/api/v1/auth/me', async request => ({ data: authenticated(request) }));
  app.post('/api/v1/auth/logout', async (request, reply) => {
    authenticated(request);
    await pool.query('DELETE FROM sessions WHERE token_hash = $1', [request.sessionHash]);
    reply.clearCookie(cookieName, { path: '/' });
    return { data: { loggedOut: true } };
  });
}

export function authenticated(request: FastifyRequest, ...roles: Role[]) {
  requireCondition(request.user, 401, 'UNAUTHENTICATED', 'Silakan masuk terlebih dahulu.');
  if (roles.length) requireCondition(roles.includes(request.user.role) || request.user.role === 'admin', 403, 'FORBIDDEN', 'Akses tidak diizinkan untuk peran ini.');
  return request.user;
}
