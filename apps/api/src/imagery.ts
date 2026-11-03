// Esri World Imagery through the API, so the ArcGIS key never reaches a browser. Under the ArcGIS Location Platform
// Agreement (E204, 3.1(d)(2)) one upstream response may serve one visitor only, so nothing is cached or shared here:
// every tile is fetched for the request that asked for it and goes out private to that browser. Only pages of this
// app may ask, only zoom 11–18 over the two provinces, for display. Esri sets no cap on the free tier (2,000,000
// tiles per billing cycle), so every request to Esri is first counted against our own daily and monthly caps. The
// origin check only reads headers, which a script can send too, so one address may also take only a share of a day.
import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { areaBoxes, type Box } from './firms.js';

/** From here the satellite view switches to Esri. */
export const MIN_ZOOM = 11;
/** Zoom 19 over rural South Sumatra comes back as "map data not yet available" placeholders. */
export const MAX_ZOOM = 18;
const SERVICE = 'https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer';
/** The service's copyrightText as published today (Maxar is now Vantor), used until the daily lookup answers. */
export const FALLBACK_ATTRIBUTION = 'Esri, Vantor, Earthstar Geographics, and the GIS User Community';
const TIMEOUT_MS = 8_000;
const MAX_TILE_BYTES = 2 * 1024 * 1024;
const MAX_METADATA_BYTES = 1024 * 1024;
const DAY_MS = 86_400_000;
/** A browser keeps a tile at most a day. */
const MAX_AGE_SECONDS = 86_400;
/** After imagery_usage could not be read, HD imagery stays off this long before the next try. */
const RETRY_READ_MS = 10_000;

export interface ImageryOptions {
  /** ARCGIS_API_KEY. Without it the tile route answers 404 and GET /config says hdImagery false. */
  key: string | undefined;
  fetch: typeof fetch;
  /** Requests to Esri per billing cycle and per UTC day; at a cap the tiles stop until the cycle or the day turns. */
  monthlyCap: number;
  dailyCap: number;
  /**
   * Requests to Esri one address (an IPv6 address by its /64) may cause per UTC day, so one client cannot use up the
   * daily cap; past it that address gets 429 until the day turns.
   */
  addressDailyCap: number;
  /** Day of the month (1–31) the Esri billing cycle starts, the sign-up day; in a shorter month, its last day. */
  cycleDay: number;
  /** Milliseconds between writes of the count to imagery_usage. */
  flushMs: number;
  now: () => number;
}

/** A whole number from the environment within min..max, else the default. */
export function envInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const number = value === undefined || value.trim() === '' ? NaN : Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}

/**
 * The monthly cap defaults to half the free tier, the daily one to a thirtieth of that. One address gets 5,000 a day:
 * a long look around close up takes one or two thousand, and it takes seven addresses to use up the day.
 */
export const imageryDefaults = (env: NodeJS.ProcessEnv = process.env): ImageryOptions => ({
  key: env.ARCGIS_API_KEY || undefined,
  fetch,
  monthlyCap: envInteger(env.ARCGIS_MONTHLY_TILE_CAP, 1_000_000, 0, 1_000_000_000),
  dailyCap: envInteger(env.ARCGIS_DAILY_TILE_CAP, 33_000, 0, 1_000_000_000),
  addressDailyCap: envInteger(env.ARCGIS_ADDRESS_DAILY_TILE_CAP, 5_000, 0, 1_000_000_000),
  cycleDay: envInteger(env.ARCGIS_CYCLE_DAY, 1, 1, 31),
  flushMs: 30_000,
  now: Date.now,
});

export interface Tile { z: number; y: number; x: number }

const longitude = (x: number, n: number) => (x / n) * 360 - 180;
const latitude = (y: number, n: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
/** West, south, east and north of a Web Mercator tile, in degrees. */
export function tileBounds({ z, y, x }: Tile): Box {
  const n = 2 ** z;
  return [longitude(x, n), latitude(y + 1, n), longitude(x + 1, n), latitude(y, n)];
}

/**
 * The tile a request names, in Esri's order (level, row, column: z, y, x), or null when it is not a whole tile of
 * zoom 11–18 that overlaps the covered area.
 */
export function parseTile(params: unknown, boxes: readonly Box[] = areaBoxes): Tile | null {
  const values = (params !== null && typeof params === 'object' ? params : {}) as Record<string, unknown>;
  const [z, y, x] = [values.z, values.y, values.x].map(value => (typeof value === 'string' && /^\d{1,6}$/.test(value) ? Number(value) : NaN)) as [number, number, number];
  if (!(z >= MIN_ZOOM && z <= MAX_ZOOM && y >= 0 && y < 2 ** z && x >= 0 && x < 2 ** z)) return null;
  const [west, south, east, north] = tileBounds({ z, y, x });
  return boxes.some(box => west < box[2] && east > box[0] && south < box[3] && north > box[1]) ? { z, y, x } : null;
}

/**
 * True for a request from a page of this app: Sec-Fetch-Site same-origin or, from a browser that does not send it,
 * an Origin (else a Referer) at one of the allowed origins. Another site, a typed address and a request with neither
 * header are refused. It keeps other sites' pages away, but it is no proof: a script can send the same headers, and
 * then only the share per address limits it.
 */
export function fromApp(headers: FastifyRequest['headers'], origins: Iterable<string>): boolean {
  const site = headers['sec-fetch-site'];
  if (site !== undefined) return site === 'same-origin';
  const from = typeof headers.origin === 'string' ? headers.origin : typeof headers.referer === 'string' ? headers.referer : '';
  if (!from) return false;
  for (const allowed of origins) {
    const origin = allowed.trim().replace(/\/+$/, '');
    if (origin && (from === origin || from.startsWith(`${origin}/`))) return true;
  }
  return false;
}

/**
 * What a share is counted for: an IPv4 address as it is (also IPv6-mapped), an IPv6 address by its /64 network, which
 * one client can fill with addresses of its own.
 */
export function addressKey(ip: string): string {
  const address = ip.trim().toLowerCase().replace(/%.*$/, '');
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address)?.[1];
  if (mapped) return mapped;
  if (!address.includes(':')) return address;
  // An IPv4 tail stands for the last two groups.
  const groups = (part: string) => (part ? part.split(':').flatMap(group => (group.includes('.') ? ['0', '0'] : [group])) : []);
  const [head = '', tail] = address.split('::');
  const left = groups(head), right = tail === undefined ? [] : groups(tail);
  const full = tail === undefined ? left : [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return `${full.slice(0, 4).map(group => (Number.parseInt(group, 16) || 0).toString(16)).join(':')}::/64`;
}

/**
 * Cache-Control for a tile: private (never a shared cache) for as long as Esri allows, at most a day; no-store when
 * Esri gives no lifetime or forbids keeping it.
 */
export function privateCacheControl(upstream: string | null): string {
  const directives = (upstream ?? '').toLowerCase().split(',').map(part => part.trim());
  if (directives.some(directive => directive === 'no-store' || directive === 'no-cache' || directive.startsWith('no-cache='))) return 'no-store';
  const maxAge = directives.map(directive => /^max-age\s*=\s*"?(\d+)"?$/.exec(directive)?.[1]).find(value => value !== undefined);
  const seconds = maxAge === undefined ? 0 : Number(maxAge);
  return seconds > 0 ? `private, max-age=${Math.min(seconds, MAX_AGE_SECONDS)}` : 'no-store';
}

/** Esri's copyrightText as plain text: no markup or control characters, at most 300 characters; else null. */
export function cleanAttribution(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/<[^>]*>/g, ' ').replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim();
  return text.length > 0 && text.length <= 300 ? text : null;
}

export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The first day (YYYY-MM-DD) of the billing cycle that holds `day`. */
export function cycleStart(day: string, cycleDay: number): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  // Months count from 0 here; Date.UTC carries -1 into December of the year before.
  const startIn = (m: number) => new Date(Date.UTC(year, m, Math.min(cycleDay, new Date(Date.UTC(year, m + 1, 0)).getUTCDate())));
  const start = startIn(month - 1).getUTCDate() <= date ? startIn(month - 1) : startIn(month - 2);
  return start.toISOString().slice(0, 10);
}

type Fetched = { ok: true; body: Buffer; type: string | null; cacheControl: string | null } | { ok: false; status: number | null; reason: 'timeout' | 'network' | 'status' | 'type' | 'size' };

/** An image type without its parameters; never SVG or another XML type, which could carry script on this origin. */
function imageType(value: string | null) {
  const type = (value ?? '').split(';')[0]!.trim().toLowerCase();
  return /^image\/[a-z0-9.+-]+$/.test(type) && !/svg|xml/.test(type) ? type : null;
}

async function readLimited(response: Response, limit: number): Promise<Buffer | null> {
  if (Number(response.headers.get('content-length')) > limit) return null;
  if (!response.body) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    // Leaving the loop cancels the rest of the body.
    if (size > limit) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const timedOut = (error: unknown) => (error as { name?: unknown } | null)?.name === 'TimeoutError';

/**
 * One request to Esri. It never throws, and what it returns on failure holds no part of Esri's answer: no body, no
 * header, no URL, no error message (they can contain the request URL and so the key).
 */
async function fetchEsri(fetchImpl: typeof fetch, url: string, limit: number, image: boolean): Promise<Fetched> {
  let response: Response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'user-agent': 'titik-api (imagery)' } });
  } catch (error) {
    return { ok: false, status: null, reason: timedOut(error) ? 'timeout' : 'network' };
  }
  try {
    const type = imageType(response.headers.get('content-type'));
    // ibasemaps can answer a key error with HTTP 200 and a text body, so a tile must also be an image.
    const reason = response.status !== 200 ? 'status' : image && !type ? 'type' : null;
    if (reason) {
      response.body?.cancel().catch(() => {});
      return { ok: false, status: response.status, reason };
    }
    const body = await readLimited(response, limit);
    if (!body) {
      response.body?.cancel().catch(() => {});
      return { ok: false, status: response.status, reason: 'size' };
    }
    return { ok: true, body, type, cacheControl: response.headers.get('cache-control') };
  } catch (error) {
    return { ok: false, status: response.status, reason: timedOut(error) ? 'timeout' : 'network' };
  }
}

/**
 * The count of requests to Esri: what imagery_usage holds for the days of this billing cycle, plus what this process
 * counted and has not written yet. A cap is checked and the request counted in one step, so parallel requests cannot
 * pass a cap together.
 */
class Budget {
  private saved = new Map<string, number>();
  private unsaved = new Map<string, number>();
  private loaded = false;
  private loading: Promise<boolean> | null = null;
  private failedAt = -Infinity;
  private saving: Promise<void> | null = null;
  private warnedCycle = '';
  private refusedDay = '';

  constructor(private pool: pg.Pool, private log: FastifyBaseLogger, private options: Pick<ImageryOptions, 'monthlyCap' | 'dailyCap' | 'cycleDay' | 'now'>) {}

  /** Requests counted today (UTC) and since the start of this billing cycle. */
  usage() {
    const day = utcDay(this.options.now()), start = cycleStart(day, this.options.cycleDay);
    let today = 0, cycle = 0;
    for (const d of new Set([...this.saved.keys(), ...this.unsaved.keys()])) {
      if (d < start || d > day) continue;
      const tiles = (this.saved.get(d) ?? 0) + (this.unsaved.get(d) ?? 0);
      cycle += tiles;
      if (d === day) today = tiles;
    }
    return { day, start, today, cycle };
  }

  /** Reads this cycle's counts once; false while imagery_usage cannot be read, and then HD imagery is off. */
  ready(): Promise<boolean> {
    if (this.loaded) return Promise.resolve(true);
    if (this.options.now() - this.failedAt < RETRY_READ_MS) return Promise.resolve(false);
    if (!this.loading) {
      const job = this.read().finally(() => { if (this.loading === job) this.loading = null; });
      this.loading = job;
    }
    return this.loading;
  }

  private async read() {
    try {
      const rows = (await this.pool.query(`SELECT to_char(day, 'YYYY-MM-DD') AS day, tiles FROM imagery_usage WHERE day >= $1::date`, [this.usage().start])).rows;
      for (const row of rows) this.saved.set(row.day, Number(row.tiles));
      this.loaded = true;
    } catch (error) {
      this.failedAt = this.options.now();
      this.log.error({ err: error }, 'Esri imagery count could not be read; HD imagery is off');
    }
    return this.loaded;
  }

  /** Whether a request to Esri would be allowed now. */
  async open(): Promise<boolean> {
    if (!(await this.ready())) return false;
    const { today, cycle } = this.usage();
    return today < this.options.dailyCap && cycle < this.options.monthlyCap;
  }

  /** Counts one request to Esri, or refuses it at a cap (logged once a day). */
  async take(): Promise<boolean> {
    if (!(await this.ready())) return false;
    const { day, start, today, cycle } = this.usage();
    const { dailyCap, monthlyCap } = this.options;
    if (today >= dailyCap || cycle >= monthlyCap) {
      if (this.refusedDay !== day) {
        this.refusedDay = day;
        this.log.warn({ today, dailyCap, cycle, monthlyCap, cycleStart: start }, `Esri imagery stopped: the ${today >= dailyCap ? 'daily' : 'monthly'} cap is reached`);
      }
      return false;
    }
    this.unsaved.set(day, (this.unsaved.get(day) ?? 0) + 1);
    if (cycle + 1 >= 0.75 * monthlyCap && this.warnedCycle !== start) {
      this.warnedCycle = start;
      this.log.warn({ cycle: cycle + 1, monthlyCap, cycleStart: start }, 'Esri imagery has used 75% of the monthly cap');
    }
    return true;
  }

  /** Adds the unwritten counts to imagery_usage. A count stays in memory, and in the caps, until its write succeeds. */
  save(): Promise<void> {
    if (!this.saving) {
      const job = this.write().finally(() => { if (this.saving === job) this.saving = null; });
      this.saving = job;
    }
    return this.saving;
  }

  private async write() {
    try {
      for (const [day, tiles] of [...this.unsaved]) {
        const row = (await this.pool.query(`INSERT INTO imagery_usage (day, tiles) VALUES ($1, $2)
          ON CONFLICT (day) DO UPDATE SET tiles = imagery_usage.tiles + EXCLUDED.tiles RETURNING tiles`, [day, tiles])).rows[0];
        // The table's total for the day, and what was counted while it was written stays unwritten.
        this.saved.set(day, Number(row.tiles));
        const left = (this.unsaved.get(day) ?? 0) - tiles;
        if (left > 0) this.unsaved.set(day, left); else this.unsaved.delete(day);
      }
      const { start } = this.usage();
      for (const day of [...this.saved.keys()]) if (day < start) this.saved.delete(day);
    } catch (error) {
      this.log.error({ err: error }, 'Esri imagery count could not be written; it is kept for the next write');
    }
  }
}

/**
 * Requests to Esri per address today (UTC). An address has an entry only while it holds a counted request, so there are
 * never more entries than the daily cap lets through.
 */
class Shares {
  private day = '';
  private used = new Map<string, number>();
  private warned = new Set<string>();

  constructor(private log: FastifyBaseLogger, private options: Pick<ImageryOptions, 'addressDailyCap' | 'now'>) {}

  /** Counts one request for the address, or refuses it once the address has used its share of the day (logged once). */
  take(address: string): boolean {
    const day = utcDay(this.options.now());
    if (day !== this.day) {
      this.day = day;
      this.used.clear();
      this.warned.clear();
    }
    const used = this.used.get(address) ?? 0;
    if (used >= this.options.addressDailyCap) {
      if (!this.warned.has(address)) {
        this.warned.add(address);
        this.log.warn({ address, addressDailyCap: this.options.addressDailyCap }, 'Esri imagery stopped for one address: its daily share is used');
      }
      return false;
    }
    this.used.set(address, used + 1);
    return true;
  }

  /** Gives back a request that did not go to Esri after all (a cap stopped it). */
  giveBack(address: string) {
    const used = this.used.get(address) ?? 0;
    if (used > 1) this.used.set(address, used - 1);
    else this.used.delete(address);
  }
}

/** Whole seconds until the next UTC day, when an address's share starts again. */
const untilNextDay = (ms: number) => Math.ceil(((Math.floor(ms / DAY_MS) + 1) * DAY_MS - ms) / 1000);

/**
 * GET /api/v1/imagery/:z/:y/:x, a pass-through for Esri World Imagery tiles with the key added. Returns what GET
 * /config tells the web app about it.
 */
export function installImagery(app: FastifyInstance, pool: pg.Pool, origins: Iterable<string>, options: Partial<ImageryOptions> = {}) {
  const settings: ImageryOptions = { ...imageryDefaults(), ...options };
  const { key, now, fetch: fetchImpl } = settings;
  const budget = new Budget(pool, app.log, settings);
  const shares = new Shares(app.log, settings);
  let attribution: string | null = null;
  let attributionAt = -Infinity;

  /** The copyrightText of the service, looked up at most once a day; each lookup counts like a tile. */
  async function lookUpAttribution(token: string) {
    try {
      if (!(await budget.take())) return;
      const result = await fetchEsri(fetchImpl, `${SERVICE}?f=json&token=${encodeURIComponent(token)}`, MAX_METADATA_BYTES, false);
      let text: string | null = null;
      if (result.ok) {
        try { text = cleanAttribution((JSON.parse(result.body.toString('utf8')) as { copyrightText?: unknown } | null)?.copyrightText); } catch { /* not JSON */ }
      }
      if (text) attribution = text;
      else app.log.warn({ status: result.ok ? 200 : result.status, reason: result.ok ? 'no copyrightText' : result.reason }, 'Esri imagery attribution not updated');
    } catch {
      app.log.warn({ reason: 'error' }, 'Esri imagery attribution not updated');
    }
  }

  app.get('/api/v1/imagery/:z/:y/:x', {
    // A HEAD request would cost a tile for nothing.
    exposeHeadRoute: false,
    // Its own limit per address; a screen of satellite view close up takes some 20–40 tiles.
    config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
    // No cookie on these responses, and no answer but a tile may be kept anywhere.
    onSend: async (_request, reply, payload) => {
      reply.removeHeader('set-cookie');
      if (reply.statusCode !== 200) reply.header('Cache-Control', 'no-store');
      return payload;
    },
  }, async (request, reply) => {
    if (!key) return reply.code(404).send();
    if (!fromApp(request.headers, origins)) return reply.code(403).send();
    const tile = parseTile(request.params);
    if (!tile) return reply.code(404).send();
    const address = addressKey(request.ip);
    if (!shares.take(address)) return reply.code(429).header('Retry-After', String(untilNextDay(now()))).send();
    if (!(await budget.take())) {
      shares.giveBack(address);
      return reply.code(503).send();
    }
    const result = await fetchEsri(fetchImpl, `${SERVICE}/tile/${tile.z}/${tile.y}/${tile.x}?token=${encodeURIComponent(key)}`, MAX_TILE_BYTES, true);
    if (!result.ok) {
      request.log.warn({ status: result.status, reason: result.reason, z: tile.z, y: tile.y, x: tile.x }, 'Esri imagery tile failed');
      return reply.code(502).send();
    }
    return reply.header('Content-Type', result.type).header('Cache-Control', privateCacheControl(result.cacheControl)).send(result.body);
  });

  const timer = key ? setInterval(() => { budget.save().catch(() => {}); }, settings.flushMs) : undefined;
  timer?.unref();
  app.addHook('onClose', async () => {
    clearInterval(timer);
    await budget.save();
  });

  return {
    /** HD imagery is on with a key while both caps allow it; the attribution then comes with it. */
    async config(): Promise<{ hdImagery: boolean; imageryAttribution: string | null }> {
      if (!key || !(await budget.open())) return { hdImagery: false, imageryAttribution: null };
      if (now() - attributionAt >= DAY_MS) {
        attributionAt = now();
        void lookUpAttribution(key);
      }
      return { hdImagery: true, imageryAttribution: attribution ?? FALLBACK_ATTRIBUTION };
    },
  };
}
