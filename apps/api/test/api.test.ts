import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance, InjectOptions } from 'fastify';
import sharp from 'sharp';
import { createApp } from '../src/app.js';
import { createPool } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { loadReference } from '../src/reference.js';
import { ingest, recluster, type NewAlert } from '../src/ingest.js';
import { demoAccounts, demoPassword, demoSquads, resetDemo } from '../src/demo.js';
import { parseFirmsCsv } from '../src/firms.js';
import { cardText, formatDistance, formatWib, scoreIncident, sizePoints, uncertaintyText, windName, type CardIncident } from '../src/geo.js';
import { lonLatToPixel, type PeatMask } from '../src/peat.js';
import { pushAlerts } from '../src/push.js';
import { defaultWindows, learnWindows, nextWindow } from '../src/status.js';

const testUrl = process.env.TEST_DATABASE_URL ?? 'postgres://titikapi:titikapi@localhost:5442/titikapi_test';
assert.ok(new URL(testUrl).pathname.endsWith('_test'), 'Integration tests require a dedicated database ending in _test.');
const pool = createPool(testUrl);
const origin = 'http://localhost:3000';
let app: FastifyInstance;
let directory: string;
const pushed: { endpoint: string; payload: string }[] = [];
const peat: PeatMask = { isPeat: lon => lon > 105.5 };
let village: { id: string; name: string; regency: string; province: string; lon: number; lat: number };

// Fixture points sit on a 9 km × 6 km block of one large village, in Web Mercator metres from the block's south-west
// corner. The corner is a multiple of 3 km, so incident grid cells start at x = 0, 3000, 6000 and y = 0, 3000.
const R = 6378137;
let corner = { x: 0, y: 0 };
const pt = (x: number, y: number) => ({ lon: ((corner.x + x) / R) * (180 / Math.PI), lat: (2 * Math.atan(Math.exp((corner.y + y) / R)) - Math.PI / 2) * (180 / Math.PI) });
const header = 'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight';
const modisHeader = 'latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,confidence,version,bright_t31,frp,daynight';
// Incidents are grouped per day in Western Indonesian Time, so every fixture detection falls in one WIB day:
// an hour ago, or just before the last WIB midnight when an hour ago is too early in the day.
const wibHours = (date: Date) => ((date.getUTCHours() + 7) % 24) + date.getUTCMinutes() / 60;
let anchor = new Date(Date.now() - 3600_000);
if (wibHours(anchor) < 2.6) anchor = new Date(anchor.getTime() - wibHours(anchor) * 3600_000 - 60_000);
const wibDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(anchor);
const stamp = (hoursAgo: number) => {
  const time = new Date(anchor.getTime() - hoursAgo * 3600_000);
  return `${time.toISOString().slice(0, 10)},${String(time.getUTCHours()).padStart(2, '0')}${String(time.getUTCMinutes()).padStart(2, '0')}`;
};
function csv(satellite: string, rows: { point: { lon: number; lat: number }; hoursAgo: number; confidence?: string; frp?: number }[]) {
  return [header, ...rows.map(row => `${row.point.lat.toFixed(5)},${row.point.lon.toFixed(5)},340.1,0.4,0.37,${stamp(row.hoursAgo)},${satellite},${row.confidence ?? 'nominal'},2.0NRT,295.2,${row.frp ?? 6.5},D`)].join('\n');
}
function modisCsv(rows: { point: { lon: number; lat: number }; hoursAgo: number; satellite: string; confidence: number; scan?: number; track?: number }[]) {
  return [modisHeader, ...rows.map(row => `${row.point.lat.toFixed(5)},${row.point.lon.toFixed(5)},325.4,${row.scan ?? 1},${row.track ?? 1},${stamp(row.hoursAgo)},${row.satellite},${row.confidence},6.1NRT,298.7,18.2,D`)].join('\n');
}
const empty = { N21: '', N20: '', N: '', MODIS: '' };
async function call(method: string, url: string, token?: string, payload?: object) {
  return app.inject({ method: method as InjectOptions['method'], url: `/api/v1${url}`, ...(payload === undefined ? {} : { payload }),
    headers: token ? { authorization: `Bearer ${token}` } : {} });
}
async function demo(role: 'mpa' | 'kades' | 'bpbd') {
  const response = await call('POST', '/auth/demo', undefined, { role, client: 'mobile' });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().data.token as string;
}
/** The incident of the detection stored at a fixture point. */
async function incidentAt(point: { lon: number; lat: number }) {
  const row = (await pool.query('SELECT incident_id FROM detections WHERE abs(longitude - $1) < 0.00001 AND abs(latitude - $2) < 0.00001', [point.lon, point.lat])).rows[0];
  assert.ok(row, `a detection at ${point.lon},${point.lat}`);
  return row.incident_id as string;
}
const incident = async (id: string) => (await pool.query('SELECT * FROM incidents WHERE id = $1', [id])).rows[0];
const mpaId = demoAccounts[0].id, bpbdId = demoAccounts[2].id;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'titikapi-api-'));
  const web = join(directory, 'web');
  await mkdir(web);
  await writeFile(join(web, 'index.html'), '<html><head><title>Titik Api</title><meta property="og:title" content="Titik Api" /><meta name="description" content="x" /></head></html>');
  await migrate(pool);
  await loadReference(pool);
  await pool.query('TRUNCATE ingest_runs, detections, incidents, alerts, verifications, subscriptions, push_subscriptions, sessions, assignments RESTART IDENTITY CASCADE');
  await pool.query("DELETE FROM static_sources WHERE kind = 'alarm_palsu'");
  await pool.query('DELETE FROM users');
  // A village large enough to hold the whole fixture block.
  for (const candidate of (await pool.query(`SELECT id, name, regency, province, ST_X(center) AS lon, ST_Y(center) AS lat,
      floor(ST_X(ST_Transform(center, 3857)) / 3000) * 3000 - 3000 AS x0, floor(ST_Y(ST_Transform(center, 3857)) / 3000) * 3000 - 3000 AS y0
    FROM villages ORDER BY area_ha DESC LIMIT 60`)).rows) {
    const inside = await pool.query('SELECT ST_Contains(geom, ST_Transform(ST_MakeEnvelope($2::float8, $3::float8, $2::float8 + 9000, $3::float8 + 6000, 3857), 4326)) AS ok FROM villages WHERE id = $1',
      [candidate.id, candidate.x0, candidate.y0]);
    if (inside.rows[0].ok) { village = candidate; corner = { x: Number(candidate.x0), y: Number(candidate.y0) }; break; }
  }
  assert.ok(village, 'a village that holds the fixture block');
  await resetDemo(pool);
  app = (await createApp({ pool, uploadsDir: join(directory, 'uploads'), webDir: web, logger: false, origins: [origin], demoLogin: true,
    pushSender: async (subscription, payload) => { pushed.push({ endpoint: subscription.endpoint, payload }); } })).app;
});
after(async () => { if (app) await app.close(); await pool.end(); if (directory) await rm(directory, { recursive: true, force: true }); });

test('FIRMS rows are parsed, padded and kept only inside the pilot box', () => {
  const { rows, total } = parseFirmsCsv([header,
    '-3.10000,105.50000,330.1,0.4,0.4,2026-10-15,0529,N21,high,2.0NRT,296,12.5,D',
    '-3.20000,105.60000,330.1,0.4,0.4,2026-10-15,642,N20,n,2.0NRT,296,,N',
    '27.24000,116.89000,331.4,0.4,0.4,2026-10-15,0529,N21,nominal,2.0NRT,298,4.5,D'].join('\n'));
  assert.equal(total, 3);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.acqAt.toISOString(), '2026-10-15T05:29:00.000Z');
  assert.equal(rows[1]!.acqAt.toISOString(), '2026-10-15T06:42:00.000Z');
  assert.equal(rows[1]!.confidence, 'nominal');
  assert.equal(rows[1]!.confidencePct, null);
  assert.equal(rows[1]!.frp, null);
});

test('MODIS rows: numeric confidence, Terra and Aqua, brightness columns, broken rows skipped', () => {
  const lines = [modisHeader,
    '-3.10000,105.50000,320.5,1.2,1.1,2026-10-15,0329,T,29,6.1NRT,295.1,12.3,D',
    '-3.10100,105.50000,321.0,1.0,1.0,2026-10-15,0329,T,30,6.1NRT,295.2,12.3,D',
    '-3.10200,105.50000,322.0,1.0,1.0,2026-10-15,1544,A,79,6.1NRT,295.3,12.3,N',
    '-3.10300,105.50000,323.0,1.0,1.0,2026-10-15,0329,Terra,80,6.1NRT,295.4,12.3,D',
    '-3.10400,105.50000,324.0,1.0,1.0,2026-10-15,1544,Aqua,100,6.1NRT,295.5,12.3,D',
    'abc,105.50000,320,1,1,2026-10-15,0329,T,50,6.1NRT,295,1,D',
    '-3.10500,105.50000,320,1,1,2026-10-15,0329,T,101,6.1NRT,295,1,D',
    '-3.10600,105.50000,320,1,1,2026-10-15,0329,X,50,6.1NRT,295,1,D',
    '-3.10700,105.50000,320,1,1,2026-10-15,2561,A,50,6.1NRT,295,1,D',
    '-3.10800,105.50000,320,1,1,2026-10-15,0329,A,high?,6.1NRT,295,1,D',
    '-3.10900,105.5'].join('\n');
  const { rows, total } = parseFirmsCsv(lines);
  assert.equal(total, 11);
  assert.deepEqual(rows.map(row => row.confidence), ['low', 'nominal', 'nominal', 'high', 'high']);
  assert.deepEqual(rows.map(row => row.confidencePct), [29, 30, 79, 80, 100]);
  assert.deepEqual(rows.map(row => row.satellite), ['T', 'T', 'A', 'T', 'A']);
  assert.equal(rows[0]!.brightTi4, 320.5);
  assert.equal(rows[0]!.brightTi5, 295.1);
  assert.equal(rows[0]!.scan, 1.2);
  assert.equal(rows[0]!.track, 1.1);
  assert.throws(() => parseFirmsCsv('<html><body>Service unavailable</body></html>'));
});

test('the priority score is a visible sum of rules, weighted by sensor', () => {
  const high = scoreIncident({ bestConfidence: 'high', maxFrp: 31, viirsCount: 4, modisCount: 0, onPeat: true, settlementMeters: 800, nearStatic: false });
  assert.deepEqual(high.parts.map(part => part.points), [30, 14, 10, 20, 15]);
  assert.equal(high.score, 89);
  assert.equal(high.level, 'tinggi');
  assert.deepEqual([1, 2, 3, 4, 5, 19, 20, 46].map(sizePoints), [0, 6, 10, 10, 15, 15, 20, 20]);
  assert.equal(scoreIncident({ bestConfidence: 'high', maxFrp: 31, viirsCount: 46, modisCount: 0, onPeat: true, settlementMeters: 800, nearStatic: false }).parts[2]!.points, 20);
  const both = scoreIncident({ bestConfidence: 'nominal', maxFrp: 8, viirsCount: 2, modisCount: 3, onPeat: false, settlementMeters: 2500, nearStatic: false });
  assert.deepEqual(both.parts.map(part => part.points), [18, 8, 6, 0, 8, 5]);
  assert.equal(both.parts.at(-1)!.label, 'Dikonfirmasi MODIS');
  const modis = scoreIncident({ bestConfidence: 'high', maxFrp: 31, viirsCount: 0, modisCount: 4, onPeat: true, settlementMeters: 800, nearStatic: false });
  assert.deepEqual(modis.parts.map(part => part.points), [18, 14, 5, 20, 15]);
  assert.equal(modis.parts[0]!.label, 'Keyakinan MODIS tinggi');
  assert.equal(modis.parts[2]!.label, '4 titik panas MODIS');
  const industrial = scoreIncident({ bestConfidence: 'high', maxFrp: 60, viirsCount: 5, modisCount: 0, onPeat: false, settlementMeters: 500, nearStatic: true });
  assert.equal(industrial.parts.at(-1)!.points, -40);
  assert.equal(industrial.level, 'sedang');
  assert.equal(scoreIncident({ bestConfidence: 'low', maxFrp: 1, viirsCount: 1, modisCount: 0, onPeat: false, settlementMeters: null, nearStatic: false }).level, 'rendah');
  for (const part of [...high.parts, ...industrial.parts, ...modis.parts]) assert.doesNotMatch(part.label, /model|AI|bukan/);
});

test('alert text names the nearest settlement and the village, in Jakarta time', () => {
  assert.equal(windName(135), 'tenggara');
  assert.equal(windName(-45), 'barat laut');
  assert.equal(formatDistance(1234), '1,2 km');
  assert.equal(formatDistance(340), '340 m');
  assert.equal(formatWib(new Date('2026-10-16T06:42:00Z')), '13.42');
  const base: CardIncident = { detectionCount: 46, onPeat: true, lastDetectedAt: new Date('2026-10-16T07:20:00Z'), level: 'tinggi', nearStatic: false, modisOnly: false,
    locationUncertaintyM: null, place: { name: 'Sungai Perlu', kind: 'hamlet', distanceM: 6900, bearingDeg: 225 }, village: { name: 'Cinta Jaya' } };
  const sameDay = new Date('2026-10-16T09:00:00Z');
  assert.equal(cardText(base, sameDay), '46 titik panas · 6,9 km barat daya Dusun Sungai Perlu · Desa Cinta Jaya · lahan gambut · terakhir 14.20 WIB · prioritas tinggi. Titik panas perlu dicek di lapangan.');
  assert.equal(cardText({ ...base, detectionCount: 1299, modisOnly: true, locationUncertaintyM: 707, onPeat: false, nearStatic: true, level: 'sedang' }, sameDay),
    '1.299 titik panas · 6,9 km barat daya Dusun Sungai Perlu · lokasi ±1 km · Desa Cinta Jaya · terakhir 14.20 WIB · prioritas sedang. Dekat sumber panas tetap. Titik panas perlu dicek di lapangan.');
  assert.equal(cardText({ ...base, place: { name: 'Cinta Jaya', kind: 'village', distanceM: 120, bearingDeg: 10 } }, sameDay),
    '46 titik panas · dekat Desa Cinta Jaya · lahan gambut · terakhir 14.20 WIB · prioritas tinggi. Titik panas perlu dicek di lapangan.');
  assert.match(cardText(base, new Date('2026-10-17T03:00:00Z')), / terakhir 16 Okt 14\.20 WIB · /, 'a detection from another day carries its date');
  assert.deepEqual([700, 1000, 1001, 1600, 2600].map(uncertaintyText), ['lokasi ±1 km', 'lokasi ±1 km', 'lokasi ±1,5 km', 'lokasi ±2 km', 'lokasi ±3 km']);
});

test('pass windows are learned per satellite and the pending window is the next one to watch', () => {
  const acquisitions = ['2026-10-10', '2026-10-11', '2026-10-12'].map((day, index) => ({ day, minute: 15 * 60 + index * 20 }));
  const aqua = learnWindows('A', acquisitions);
  assert.deepEqual(aqua[0], { window: [890, 950], learned: true }, 'Aqua afternoon passes at 15.00–15.40 WIB, plus 10 minutes on both sides');
  assert.deepEqual(aqua[1], { window: [150, 270], learned: false }, 'no night passes seen: the default window');
  assert.ok(learnWindows('A', acquisitions.slice(0, 2)).every(item => !item.learned), 'two days are not enough');
  // N20 crossing midnight: 23.54 belongs to the night window.
  const night = learnWindows('N20', ['2026-10-10', '2026-10-11', '2026-10-12'].map((day, index) => ({ day, minute: [1434, 20, 140][index]! })));
  assert.deepEqual(night[1], { window: [-16, 150], learned: true });
  const now = Date.parse('2026-10-16T03:00:00Z'); // 10.00 WIB
  const next = nextWindow(defaultWindows.N21, Date.parse('2026-10-15T18:30:00Z'), now); // data from the 01.30 WIB pass is in
  assert.deepEqual(next, { start: '2026-10-16T05:00:00.000Z', end: '2026-10-16T07:40:00.000Z', expectedBy: '2026-10-16T10:40:00.000Z' });
  const overdue = nextWindow(defaultWindows.N21, Date.parse('2026-10-15T07:00:00Z'), now); // nothing since 14.00 WIB yesterday
  assert.equal(overdue!.start, '2026-10-15T17:00:00.000Z');
  assert.ok(Date.parse(overdue!.expectedBy) < now, 'the night pass is overdue');
});

let firstIncident: string;
test('ingest links detections to villages, groups them into incidents and is idempotent', async () => {
  const texts = { ...empty,
    N21: csv('N21', [{ point: pt(4000, 1000), hoursAgo: 2.5, confidence: 'high', frp: 31 }, { point: pt(4250, 1120), hoursAgo: 2 }, { point: pt(5600, 1000), hoursAgo: 2 }]),
    N20: csv('N20', [{ point: pt(4120, 920), hoursAgo: 1.5 }, { point: { lon: 106.10, lat: -2.13 }, hoursAgo: 1.5 }]),
  };
  const first = await ingest(pool, { source: 'fixture', texts, peat });
  assert.equal(first.inserted, 5);
  assert.equal(first.incidents.length, 2);
  assert.deepEqual(first.feeds.map(feed => feed.satellite), ['N21', 'N20', 'N', 'T', 'A']);
  const outside = await pool.query('SELECT village_id, incident_id FROM detections WHERE abs(longitude - 106.10) < 0.001');
  assert.equal(outside.rows[0].village_id, null, 'Pangkalpinang (Bangka Belitung) lies outside the covered provinces');
  assert.equal(outside.rows[0].incident_id, null);
  const row = (await pool.query('SELECT * FROM incidents ORDER BY detection_count DESC LIMIT 1')).rows[0];
  firstIncident = row.id;
  assert.equal(row.detection_count, 3);
  assert.equal(row.viirs_count, 3);
  assert.equal(row.modis_count, 0);
  assert.deepEqual([...row.satellites].sort(), ['N20', 'N21']);
  assert.equal(row.best_confidence, 'high');
  assert.equal(row.village_id, village.id);
  assert.ok(row.place_name, 'the nearest settlement is stored');
  assert.ok(row.place_m >= 0 && row.place_bearing >= 0 && row.place_bearing < 360);
  assert.ok(row.score_parts.length >= 5);
  const again = await ingest(pool, { source: 'fixture', texts, peat });
  assert.equal(again.inserted, 0);
  assert.equal(again.incidents.length, 0);
});

test('the volunteer gets alerts for the villages they watch and can share them', async () => {
  const mpa = await demo('mpa');
  const save = await call('PUT', '/me/subscriptions', mpa, { villages: [{ villageId: village.id, radiusKm: 0 }] });
  assert.equal(save.statusCode, 200, save.body);
  const alerts = await call('GET', '/me/alerts', mpa);
  const cards = alerts.json().data as any[];
  const card = cards.find(item => item.incident.id === firstIncident);
  assert.ok(card, 'the incident in the watched village has an alert');
  assert.match(card.card, new RegExp(`Desa ${village.name}`));
  assert.match(card.card, /Titik panas perlu dicek di lapangan\.$/);
  assert.ok(card.incident.nearestPlace?.name);
  assert.equal((await call('POST', `/me/alerts/${card.id}/shared`, mpa)).statusCode, 200);
  assert.ok((await call('GET', '/me/alerts', mpa)).json().data.find((item: any) => item.id === card.id).sharedAt);
});

test('push: a browser subscribes and receives the newest alert as a test notification', async () => {
  const mpa = await demo('mpa');
  assert.equal((await call('POST', '/me/push/test', mpa)).statusCode, 409, 'no device yet');
  const subscribe = await call('POST', '/me/push', mpa, { endpoint: 'https://push.example/abc', keys: { p256dh: 'BPx'.padEnd(40, 'x'), auth: 'auth-key' } });
  assert.equal(subscribe.statusCode, 200, subscribe.body);
  const test = await call('POST', '/me/push/test', mpa);
  assert.equal(test.statusCode, 200, test.body);
  const payload = JSON.parse(pushed.at(-1)!.payload);
  assert.match(payload.body, /titik panas/);
  assert.match(payload.url, /^\/kejadian\//);
});

test('field reports: role guard, offline time, one copy per client id, false alarms teach the triage', async () => {
  const mpa = await demo('mpa');
  const kades = await demo('kades');
  const row = (await pool.query('SELECT first_detected_at FROM incidents WHERE id = $1', [firstIncident])).rows[0];
  const clientUuid = randomUUID();
  const observedAt = new Date(row.first_detected_at.getTime() + 47 * 60_000).toISOString();
  const report = { clientUuid, status: 'asap_bara', note: 'Asap tipis', latitude: pt(4030, 1030).lat, longitude: pt(4030, 1030).lon, accuracyM: 9, observedAt };
  assert.equal((await call('POST', `/incidents/${firstIncident}/verifications`, kades, report)).statusCode, 403);
  const early = await call('POST', `/incidents/${firstIncident}/verifications`, mpa, { ...report, clientUuid: randomUUID(), observedAt: new Date(row.first_detected_at.getTime() - 3 * 3600_000).toISOString() });
  assert.equal(early.statusCode, 400);
  const created = await call('POST', `/incidents/${firstIncident}/verifications`, mpa, report);
  assert.equal(created.statusCode, 201, created.body);
  const retry = await call('POST', `/incidents/${firstIncident}/verifications`, mpa, report);
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.json().data.duplicate, true);
  const stored = (await pool.query('SELECT first_verified_at, latest_status FROM incidents WHERE id = $1', [firstIncident])).rows[0];
  assert.equal(stored.first_verified_at.toISOString(), observedAt, 'the time is when the volunteer checked, not when the report arrived');
  assert.equal(stored.latest_status, 'asap_bara');
  const other = (await pool.query('SELECT id FROM incidents WHERE id <> $1 AND village_id IS NOT NULL LIMIT 1', [firstIncident])).rows[0].id;
  const falseAlarm = await call('POST', `/incidents/${other}/verifications`, mpa, { clientUuid: randomUUID(), status: 'alarm_palsu', falseAlarmKind: 'industri', observedAt: new Date().toISOString() });
  assert.equal(falseAlarm.statusCode, 201, falseAlarm.body);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM static_sources WHERE kind = 'alarm_palsu'")).rows[0].n, 1);
  assert.equal((await pool.query('SELECT near_static FROM incidents WHERE id = $1', [other])).rows[0].near_static, true);
  const publicView = (await call('GET', `/incidents/${firstIncident}`)).json().data;
  assert.equal(publicView.verifications[0].status, 'asap_bara');
  assert.equal(publicView.verifications[0].note, undefined, 'notes and reporters are not public');
  assert.equal(publicView.latestCheck.status, 'asap_bara');
  assert.equal(publicView.detections[0].sensor, 'VIIRS');
  assert.ok(publicView.timeline.some((event: any) => event.kind === 'checked' && event.actor === undefined));
});

test('a photo is re-encoded without its metadata', async () => {
  const mpa = await demo('mpa');
  const jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#a33' } }).withMetadata({ exif: { IFD0: { Make: 'TestCam' } } }).jpeg().toBuffer();
  const boundary = '----titikapi';
  const fields = { clientUuid: randomUUID(), status: 'api_aktif', observedAt: new Date().toISOString() };
  const body = Buffer.concat([
    ...Object.entries(fields).map(([name, value]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`)),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="a.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`), jpeg, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const response = await app.inject({ method: 'POST', url: `/api/v1/incidents/${firstIncident}/verifications`, payload: body,
    headers: { authorization: `Bearer ${mpa}`, 'content-type': `multipart/form-data; boundary=${boundary}` } });
  assert.equal(response.statusCode, 201, response.body);
  const row = (await pool.query('SELECT photo_url FROM verifications WHERE id = $1', [response.json().data.id])).rows[0];
  const metadata = await sharp(join(directory, 'uploads', row.photo_url.split('/').at(-1))).metadata();
  assert.equal(metadata.exif, undefined);
});

test('new detections that bridge two incidents in one grid cell merge them, reports included', async () => {
  const other = await incidentAt(pt(5600, 1000));
  const before = (await pool.query('SELECT count(*)::int AS n FROM incidents WHERE village_id IS NOT NULL')).rows[0].n;
  await ingest(pool, { source: 'fixture', peat, texts: { ...empty, N21: csv('N21', [4800, 5250].map(x => ({ point: pt(x, 1000), hoursAgo: 0 }))) } });
  const after = (await pool.query('SELECT count(*)::int AS n FROM incidents WHERE village_id IS NOT NULL')).rows[0].n;
  assert.equal(after, before - 1, 'the two incidents became one');
  for (const x of [4000, 4800, 5250, 5600]) assert.equal(await incidentAt(pt(x, 1000)), firstIncident, 'the older incident keeps its id');
  assert.equal(await incident(other), undefined);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM verifications WHERE incident_id = $1', [firstIncident])).rows[0].n, 3, 'reports moved along');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM verifications v LEFT JOIN incidents i ON i.id = v.incident_id WHERE i.id IS NULL')).rows[0].n, 0);
});

test('MODIS joins the nearest VIIRS incident of the day, never merges two, and stands alone when no VIIRS is near', async () => {
  const [m1, m2, m3, m4] = [pt(1500, 4300), pt(1800, 4000), pt(4500, 4500), pt(5200, 4500)];
  const result = await ingest(pool, { source: 'fixture', peat, texts: { ...empty,
    N21: csv('N21', [{ point: pt(1000, 4000), hoursAgo: 2.3 }, { point: pt(1300, 4000), hoursAgo: 2.3 }, { point: pt(2200, 4000), hoursAgo: 2.2, confidence: 'high' }]),
    MODIS: modisCsv([{ point: m1, hoursAgo: 1.9, satellite: 'T', confidence: 85 }, { point: m2, hoursAgo: 1.9, satellite: 'A', confidence: 50 },
      { point: m3, hoursAgo: 2.2, satellite: 'Terra', confidence: 90, scan: 1.2, track: 1.1 }, { point: m4, hoursAgo: 2.1, satellite: 'Aqua', confidence: 40 }]) } });
  assert.equal(result.inserted, 7);
  assert.deepEqual(result.feeds.filter(feed => feed.satellite === 'T' || feed.satellite === 'A').map(feed => feed.inArea), [2, 2]);
  const v1 = await incidentAt(pt(1000, 4000)), v2 = await incidentAt(pt(2200, 4000));
  assert.notEqual(v1, v2, 'a MODIS pixel between two VIIRS incidents does not merge them');
  assert.equal(await incidentAt(pt(1300, 4000)), v1);
  assert.equal(await incidentAt(m1), v1, 'nearest VIIRS point first');
  assert.equal(await incidentAt(m2), v2);
  const first = await incident(v1);
  assert.equal(first.viirs_count, 2);
  assert.equal(first.modis_count, 1);
  assert.equal(first.modis_only, false);
  assert.ok(first.satellites.includes('T'));
  assert.ok(first.score_parts.some((part: any) => part.key === 'modis' && part.points === 5));
  const centroid = (await pool.query('SELECT ST_X(centroid) AS lon FROM incidents WHERE id = $1', [v1])).rows[0].lon;
  assert.ok(Math.abs(centroid - (pt(1000, 4000).lon + pt(1300, 4000).lon) / 2) < 0.00001, 'the location comes from VIIRS only');
  const alone = await incidentAt(m3);
  assert.equal(await incidentAt(m4), alone, 'leftover MODIS clusters within 1.5 km');
  let x = await incident(alone);
  assert.equal(x.modis_only, true);
  assert.equal(x.viirs_count, 0);
  assert.equal(x.modis_count, 2);
  assert.equal(x.location_uncertainty_m, 814, 'round(500 × √(1.2² + 1.1²))');
  assert.equal(x.score_parts[0].label, 'Keyakinan MODIS tinggi');
  assert.equal(x.score_parts[0].points, 18);
  assert.equal(x.score_parts[2].points, 3, 'the size term is halved');
  const detail = (await call('GET', `/incidents/${alone}`)).json().data;
  assert.equal(detail.modisOnly, true);
  assert.equal(detail.locationUncertaintyM, 814);
  assert.match(detail.card, /lokasi ±1 km/);
  assert.deepEqual(detail.detections.map((d: any) => [d.sensor, d.confidence, d.confidencePct, d.scan]), [['MODIS', 'high', 90, 1.2], ['MODIS', 'nominal', 40, 1]]);
  // The afternoon VIIRS pass sees the same fire: the older MODIS-only incident keeps its id.
  await ingest(pool, { source: 'fixture', peat, texts: { ...empty, N21: csv('N21', [{ point: pt(4600, 4500), hoursAgo: 0.5 }]) } });
  assert.equal(await incidentAt(pt(4600, 4500)), alone);
  x = await incident(alone);
  assert.equal(x.modis_only, false);
  assert.equal(x.viirs_count, 1);
  assert.equal(x.modis_count, 2);
  assert.equal(x.location_uncertainty_m, null);
});

let crossCell: [string, string];
test('clustering stops at 3 km grid cells and a second pass keeps ids, reports and tasks', async () => {
  const chain = (xs: number[], hoursAgo: number) => xs.map(x => ({ point: pt(x, 2500), hoursAgo }));
  const pass1 = { ...empty, N21: csv('N21', [...chain([5100, 7100], 2.0), ...chain([6100], 2.2), ...chain([2900, 3100], 2.1)]) };
  await ingest(pool, { source: 'fixture', peat, texts: pass1 });
  const s1 = await incidentAt(pt(5100, 2500)), s2 = await incidentAt(pt(6100, 2500)), s3 = await incidentAt(pt(7100, 2500));
  crossCell = [await incidentAt(pt(2900, 2500)), await incidentAt(pt(3100, 2500))];
  assert.notEqual(crossCell[0], crossCell[1], '200 m apart but in two grid cells');
  assert.equal(new Set([s1, s2, s3]).size, 3);
  // A report on s3, then an older open task on s2 and a newer one on s3.
  const mpa = await demo('mpa');
  const report = await call('POST', `/incidents/${s3}/verifications`, mpa, { clientUuid: randomUUID(), status: 'api_aktif', observedAt: new Date().toISOString() });
  assert.equal(report.statusCode, 201, report.body);
  const task = async (incidentId: string, minutesAgo: number) => (await pool.query(`INSERT INTO assignments (incident_id, assignee_id, assigned_by, created_at, updated_at)
    VALUES ($1, $2, $3, now() - make_interval(mins => $4), now() - make_interval(mins => $4)) RETURNING id`, [incidentId, mpaId, bpbdId, minutesAgo])).rows[0].id as string;
  const older = await task(s2, 10), newer = await task(s3, 5);
  // Pass 2 fills the gaps: without cells all five points would chain into one incident.
  const pass2 = { ...empty, N21: csv('N21', chain([5600, 6600], 1.0)) };
  const second = await ingest(pool, { source: 'fixture', peat, texts: pass2 });
  assert.equal(second.inserted, 2);
  assert.equal(await incidentAt(pt(5600, 2500)), s1, 'cell x 3–6 km keeps its incident');
  for (const x of [6100, 6600, 7100]) assert.equal(await incidentAt(pt(x, 2500)), s2, 'cell x 6–9 km: the older incident absorbs the newer');
  assert.equal(await incident(s3), undefined);
  assert.ok((await incident(s2)).first_verified_at, 'the report moved with the merge');
  const tasks = (await pool.query('SELECT id, incident_id, status FROM assignments WHERE id = ANY($1::uuid[]) ORDER BY created_at', [[older, newer]])).rows;
  assert.deepEqual(tasks.map(row => [row.incident_id, row.status]), [[s2, 'ditugaskan'], [s2, 'dibatalkan']], 'one open task stays open');
  // The same files again change nothing; a new pass elsewhere the same day keeps every id.
  const again = await ingest(pool, { source: 'fixture', peat, texts: pass2 });
  assert.equal(again.inserted, 0);
  const ids = async () => new Set((await pool.query('SELECT id FROM incidents').then(result => result.rows.map(row => row.id as string))));
  const before = await ids();
  await ingest(pool, { source: 'fixture', peat, texts: { ...empty, N20: csv('N20', [{ point: pt(8000, 5500), hoursAgo: 0.2 }]) } });
  const later = await ids();
  assert.ok([...before].every(id => later.has(id)), 'no incident changed id');
  assert.equal(later.size, before.size + 1);
  // An incident chained across a cell edge (as older versions did) splits; the larger part keeps the id, report and task.
  await pool.query('UPDATE detections SET incident_id = $1 WHERE incident_id = $2', [s2, s1]);
  await pool.query('DELETE FROM incidents WHERE id = $1', [s1]);
  await ingest(pool, { source: 'fixture', peat, texts: { ...empty, N20: csv('N20', [{ point: pt(8500, 5000), hoursAgo: 0.1 }]) } });
  assert.equal(await incidentAt(pt(6600, 2500)), s2);
  const split = await incidentAt(pt(5100, 2500));
  assert.notEqual(split, s2);
  assert.equal(await incidentAt(pt(5600, 2500)), split);
  assert.ok((await incident(s2)).first_verified_at);
  assert.equal((await pool.query("SELECT incident_id FROM assignments WHERE id = $1", [older])).rows[0].incident_id, s2);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM detections WHERE village_id IS NOT NULL AND incident_id IS NULL')).rows[0].n, 0);
  const widths = (await pool.query(`SELECT incident_id, ST_XMax(ST_Extent(geom_3857)) - ST_XMin(ST_Extent(geom_3857)) AS w, ST_YMax(ST_Extent(geom_3857)) - ST_YMin(ST_Extent(geom_3857)) AS h
    FROM detections WHERE incident_id IS NOT NULL AND satellite IN ('N21', 'N20', 'N') GROUP BY incident_id`)).rows;
  assert.ok(widths.every(row => row.w <= 3000 && row.h <= 3000), 'no incident is wider than a grid cell');
});

test('recluster groups recent days again: a chain splits at the cell edge, and a second run changes nothing', async () => {
  const left = await incidentAt(pt(5600, 2500)), right = await incidentAt(pt(6600, 2500));
  await pool.query('UPDATE detections SET incident_id = $1 WHERE incident_id = $2', [right, left]);
  await pool.query('DELETE FROM incidents WHERE id = $1', [left]);
  const first = await recluster(pool, 2);
  assert.ok(first && first.changed >= 2, JSON.stringify(first));
  assert.equal(await incidentAt(pt(6600, 2500)), right, 'the larger part keeps the id');
  const split = await incidentAt(pt(5100, 2500));
  assert.notEqual(split, right);
  assert.equal(await incidentAt(pt(5600, 2500)), split);
  assert.ok((await incident(split)).score_parts.length >= 5, 'the new part is scored');
  const second = await recluster(pool, 2);
  assert.deepEqual([second!.changed, second!.merged], [0, 0]);
});

test('tasks: BPBD assigns a squad, the squad sets off, any field check closes it, BPBD can cancel', async () => {
  const [target, spare] = crossCell;
  const bpbd = await demo('bpbd'), mpa = await demo('mpa'), kades = await demo('kades');
  const kadesId = demoAccounts[1].id;
  assert.equal((await call('POST', `/incidents/${target}/assignments`, mpa, { assigneeId: mpaId })).statusCode, 403);
  assert.equal((await call('POST', `/incidents/${target}/assignments`, bpbd, { assigneeId: kadesId })).statusCode, 400, 'only MPA squads take tasks');
  const created = await call('POST', `/incidents/${target}/assignments`, bpbd, { assigneeId: mpaId, note: 'Cek dari jalan kanal.' });
  assert.equal(created.statusCode, 201, created.body);
  const task = created.json().data;
  assert.equal(task.status, 'ditugaskan');
  assert.equal(task.assignee.name, 'Regu MPA Sungai Menang (demo)');
  assert.equal(task.assignedBy, 'Petugas BPBD/Daops (demo)');
  assert.equal(task.note, 'Cek dari jalan kanal.');
  const push = JSON.parse(pushed.at(-1)!.payload);
  assert.equal(push.title, `Tugas cek lapangan: Desa ${village.name}`);
  assert.equal(push.url, '/tugas');
  const twice = await call('POST', `/incidents/${target}/assignments`, bpbd, { assigneeId: mpaId });
  assert.equal(twice.statusCode, 409);
  assert.equal(twice.json().error.code, 'ASSIGNMENT_OPEN');
  const assigned = (await call('GET', '/incidents?hours=24&status=assigned')).json().data as any[];
  assert.ok(assigned.some(item => item.id === target && item.assignment.status === 'ditugaskan' && item.assignment.assignee.id === mpaId));
  const publicTask = assigned.find(item => item.id === target).assignment;
  assert.deepEqual([publicTask.note, publicTask.assignedBy], ['', ''], 'the note and who assigned it are for signed-in teams');
  const teamTask = ((await call('GET', '/incidents?hours=24&status=assigned', mpa)).json().data as any[]).find(item => item.id === target).assignment;
  assert.deepEqual([teamTask.note, teamTask.assignedBy], ['Cek dari jalan kanal.', 'Petugas BPBD/Daops (demo)']);
  assert.ok(!(await call('GET', '/incidents?hours=24&status=open')).json().data.some((item: any) => item.id === target));
  const mine = (await call('GET', '/me/assignments', mpa)).json().data as any[];
  assert.equal(mine[0].id, task.id);
  assert.equal(mine[0].incident.id, target);
  assert.equal((await call('GET', '/me/assignments', bpbd)).statusCode, 403);
  assert.equal((await call('PATCH', `/assignments/${task.id}`, kades, { status: 'menuju' })).statusCode, 403);
  const enroute = await call('PATCH', `/assignments/${task.id}`, mpa, { status: 'menuju' });
  assert.equal(enroute.statusCode, 200, enroute.body);
  assert.equal(enroute.json().data.status, 'menuju');
  assert.equal((await call('PATCH', `/assignments/${task.id}`, mpa, { status: 'dibatalkan' })).statusCode, 403, 'only BPBD cancels');
  // Another squad checks the incident first: the task is done all the same.
  const token = randomUUID();
  const otherSquad = (await pool.query(`INSERT INTO users (name, email, password_hash, role, organization) VALUES ('Regu MPA uji (demo)', 'regu-uji@titikapi.test', 'x', 'mpa', 'Uji')
    RETURNING id`)).rows[0].id;
  await pool.query(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 day')`, [createHash('sha256').update(token).digest('hex'), otherSquad]);
  const observedAt = new Date().toISOString();
  const check = await call('POST', `/incidents/${target}/verifications`, token, { clientUuid: randomUUID(), status: 'asap_bara', observedAt });
  assert.equal(check.statusCode, 201, check.body);
  assert.equal(check.json().data.closedAssignment, task.id);
  const closed = (await pool.query('SELECT status, closed_at FROM assignments WHERE id = $1', [task.id])).rows[0];
  assert.equal(closed.status, 'selesai');
  assert.equal(closed.closed_at.toISOString(), observedAt);
  const late = await call('PATCH', `/assignments/${task.id}`, mpa, { status: 'menuju' });
  assert.equal(late.statusCode, 409);
  assert.equal(late.json().error.code, 'ASSIGNMENT_CLOSED');
  const detail = (await call('GET', `/incidents/${target}`, bpbd)).json().data;
  assert.deepEqual(detail.timeline.map((event: any) => event.kind), ['detected', 'assigned', 'enroute', 'checked']);
  assert.equal(detail.timeline[0].satellite, 'N21');
  assert.equal(detail.timeline[0].count, 1);
  assert.equal(detail.timeline[3].actor, 'Regu MPA uji (demo)');
  assert.equal(detail.assignment.status, 'selesai');
  // Cancel.
  const second = (await call('POST', `/incidents/${spare}/assignments`, bpbd, { assigneeId: demoSquads[0].id })).json().data;
  const cancelled = await call('PATCH', `/assignments/${second.id}`, bpbd, { status: 'dibatalkan' });
  assert.equal(cancelled.statusCode, 200, cancelled.body);
  assert.equal(cancelled.json().data.status, 'dibatalkan');
  assert.ok(cancelled.json().data.closedAt);
  assert.equal((await call('PATCH', `/assignments/${second.id}`, bpbd, { status: 'dibatalkan' })).statusCode, 409);
  assert.ok((await call('GET', `/incidents/${spare}`)).json().data.timeline.some((event: any) => event.kind === 'cancelled'));
  // Squads to choose from, nearest first.
  const options = await call('GET', `/assignees?incident=${spare}`, bpbd);
  assert.equal(options.statusCode, 200, options.body);
  const squads = options.json().data as any[];
  const volunteer = squads.find(item => item.id === mpaId);
  assert.deepEqual(volunteer.villages, [village.name]);
  assert.equal(typeof volunteer.distanceM, 'number');
  assert.ok(squads.some(item => item.id === demoSquads[1].id));
  const distances = squads.map(item => item.distanceM ?? Infinity);
  assert.deepEqual(distances, [...distances].sort((a, b) => a - b));
  assert.equal((await call('GET', `/assignees?incident=${spare}`, mpa)).statusCode, 403);
});

test('the incident list filters by priority, status, peat and region, and sorts three ways', async () => {
  const list = async (query: string) => { const response = await call('GET', `/incidents?hours=24${query}`); assert.equal(response.statusCode, 200, response.body); return response.json().data as any[]; };
  const all = await list('');
  assert.ok(all.length >= 8);
  assert.ok((await list('&level=tinggi,sedang')).every(item => item.level === 'tinggi' || item.level === 'sedang'));
  assert.ok((await list('&status=checked')).every(item => item.firstVerifiedAt && item.latestCheck));
  const open = await list('&status=open');
  assert.ok(open.length && open.every(item => !item.firstVerifiedAt && !(item.assignment && ['ditugaskan', 'menuju'].includes(item.assignment.status))));
  assert.ok((await list('&status=assigned')).every(item => ['ditugaskan', 'menuju'].includes(item.assignment.status)));
  const peatCount = (await pool.query("SELECT count(*)::int AS n FROM incidents WHERE village_id IS NOT NULL AND on_peat AND last_detected_at > now() - interval '24 hours'")).rows[0].n;
  const onPeat = await list('&peat=1');
  assert.equal(onPeat.length, peatCount);
  assert.ok(onPeat.every(item => item.onPeat));
  assert.equal((await list(`&regency=${encodeURIComponent(village.regency)}`)).length, all.length);
  assert.equal((await list('&regency=Tidak%20Ada')).length, 0);
  const recent = await list('&sort=recent');
  assert.deepEqual(recent.map(item => item.lastDetectedAt), [...recent.map(item => item.lastDetectedAt)].sort().reverse());
  const size = await list('&sort=size');
  assert.deepEqual(size.map(item => item.detectionCount), [...size.map(item => item.detectionCount)].sort((a, b) => b - a));
  // Priority: unchecked high-priority incidents first, then by score.
  const key = (item: any) => [!item.firstVerifiedAt && item.level === 'tinggi' ? 1 : 0, item.score] as const;
  all.slice(1).forEach((item, index) => { const [a, b] = [key(all[index]), key(item)]; assert.ok(a[0] > b[0] || (a[0] === b[0] && a[1] >= b[1])); });
  assert.equal((await list('&limit=2')).length, 2);
  const sample = all[0];
  for (const key of ['viirsCount', 'modisCount', 'modisOnly', 'locationUncertaintyM', 'latestCheck', 'assignment', 'nearestPlace']) assert.ok(key in sample, key);
  for (const bad of ['&limit=501', '&level=bogus', '&status=bogus', '&sort=bogus', '&hours=169']) assert.equal((await call('GET', `/incidents?hours=24${bad}`)).statusCode, 400, bad);
});

test('both provinces are served as regions, regency summaries, vector tiles and a summary', async () => {
  const regions = (await call('GET', '/regions')).json().data as { name: string; villages: number; regencies: unknown[] }[];
  assert.deepEqual(regions.map(r => r.name).sort(), ['Kalimantan Tengah', 'Sumatera Selatan']);
  assert.ok(regions.reduce((n, r) => n + r.villages, 0) > 4000);
  const summaries = (await call('GET', '/regions/summary?hours=24')).json().data as any[];
  const mine = summaries.find(item => item.name === village.regency);
  const expected = (await pool.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE first_verified_at IS NOT NULL)::int AS checked FROM incidents i
    JOIN villages v ON v.id = i.village_id WHERE v.regency = $1 AND i.last_detected_at > now() - interval '24 hours'`, [village.regency])).rows[0];
  assert.equal(mine.incidents, expected.n);
  assert.equal(mine.checked, expected.checked);
  assert.ok(mine.open <= mine.high && mine.high <= mine.incidents);
  assert.equal(mine.center.length, 2);
  assert.deepEqual((await call('GET', `/regions/summary?hours=24&province=${encodeURIComponent('Bali')}`)).json().data, []);
  const [px, py] = lonLatToPixel(pt(4000, 1000).lon, pt(4000, 1000).lat, 12);
  const tx = Math.floor(px / 256), ty = Math.floor(py / 256);
  for (const layer of ['desa', 'kabupaten', 'kejadian', 'deteksi']) {
    const tile = await app.inject({ method: 'GET', url: `/api/v1/tiles/${layer}/12/${tx}/${ty}.mvt?hours=24` });
    assert.equal(tile.statusCode, 200);
    assert.equal(tile.headers['content-type'], 'application/vnd.mapbox-vector-tile');
    assert.ok(tile.rawPayload.length > 20, `${layer} tile has features`);
    if (layer === 'kejadian') for (const key of ['assigned', 'modisOnly', 'verified']) assert.ok(tile.rawPayload.includes(key), key);
    if (layer === 'deteksi') for (const key of ['sensor', 'age', 'VIIRS']) assert.ok(tile.rawPayload.includes(key), key);
  }
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/tiles/desa/3/99/0.mvt' })).statusCode, 400);
  const summary = (await call('GET', '/summary?hours=24')).json().data;
  assert.ok(summary.incidents >= 1 && summary.detections >= 3);
  const kalteng = (await call('GET', `/summary?hours=24&province=${encodeURIComponent('Bali')}`)).json().data;
  assert.equal(kalteng.incidents, 0);
});

test('the daily recap counts one WIB day and adds up', async () => {
  const bpbd = await demo('bpbd');
  const response = await call('GET', `/recap?date=${wibDay}`, bpbd);
  assert.equal(response.statusCode, 200, response.body);
  const recap = response.json().data;
  const expected = (await pool.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE first_verified_at IS NOT NULL)::int AS checked,
      count(*) FILTER (WHERE level = 'tinggi')::int AS high, COALESCE(sum(detection_count), 0)::int AS detections
    FROM incidents WHERE village_id IS NOT NULL AND to_char(first_detected_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') = $1`, [wibDay])).rows[0];
  assert.equal(recap.date, wibDay);
  assert.equal(recap.province, null);
  assert.equal(recap.totals.incidents, expected.n);
  assert.equal(recap.totals.checked, expected.checked);
  assert.equal(recap.totals.high, expected.high);
  assert.equal(recap.totals.detections, expected.detections);
  assert.equal(recap.totals.checkedShare, expected.checked / expected.n);
  assert.equal(typeof recap.totals.medianMinutes, 'number');
  assert.equal(recap.totals.falseAlarms, (await pool.query(`SELECT count(*)::int AS n FROM incidents WHERE village_id IS NOT NULL AND latest_status = 'alarm_palsu'
    AND to_char(first_detected_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') = $1`, [wibDay])).rows[0].n);
  assert.equal(recap.regencies.reduce((n: number, r: any) => n + r.incidents, 0), expected.n);
  assert.ok(recap.villages.length >= 1 && recap.villages.length <= 15);
  assert.equal(Object.values(recap.checks as Record<string, number>).reduce((a, b) => a + b, 0), expected.checked);
  assert.deepEqual(Object.keys(recap.assignments).sort(), ['dibatalkan', 'ditugaskan', 'menuju', 'selesai']);
  assert.ok(recap.assignments.selesai >= 1 && recap.assignments.dibatalkan >= 1);
  const elsewhere = (await call('GET', `/recap?date=${wibDay}&province=${encodeURIComponent('Sumatera Selatan')}`, bpbd)).json().data;
  assert.equal(elsewhere.totals.incidents, village.province === 'Sumatera Selatan' ? expected.n : 0);
  assert.equal((await call('GET', '/recap?date=2026-02-31', bpbd)).statusCode, 400);
  assert.equal((await call('GET', '/recap?date=kemarin', bpbd)).statusCode, 400);
  assert.equal((await call('GET', `/recap?date=${wibDay}`, await demo('mpa'))).statusCode, 403);
});

test('the agency dashboard counts checks, tasks and the median time over one window; the CSV follows the groundcheck form', async () => {
  const bpbd = await demo('bpbd');
  const mpa = await demo('mpa');
  assert.equal((await call('GET', '/dashboard', mpa)).statusCode, 403);
  const dashboard = await call('GET', '/dashboard?range=7d', bpbd);
  assert.equal(dashboard.statusCode, 200, dashboard.body);
  const { summary, assignments } = dashboard.json().data;
  assert.ok(summary.verified >= 1);
  assert.equal(typeof summary.medianMinutesToVerification, 'number');
  assert.ok(summary.openHigh <= summary.high && summary.needsAction <= summary.openHigh);
  assert.equal(summary.assigned, (await pool.query("SELECT count(DISTINCT incident_id)::int AS n FROM assignments WHERE status IN ('ditugaskan', 'menuju')")).rows[0].n);
  assert.deepEqual(Object.keys(assignments).sort(), ['dibatalkan', 'ditugaskan', 'menuju', 'selesai']);
  const exported = await app.inject({ method: 'GET', url: '/api/v1/export/groundcheck.csv?range=7d', headers: { authorization: `Bearer ${bpbd}` } });
  assert.equal(exported.statusCode, 200);
  const [head] = exported.body.replace('﻿', '').split('\r\n');
  assert.ok(head!.startsWith('id_kejadian,tanggal_deteksi,jam_deteksi_wib,provinsi,kabupaten,kecamatan,desa,lintang,bujur,satelit,sensor,jumlah_deteksi,keyakinan,keyakinan_modis_pct'));
  assert.match(exported.body, /Asap atau bara/);
  assert.match(exported.body, /,VIIRS\+MODIS,/);
  assert.match(exported.body, /,NOAA-21\/Terra,VIIRS\+MODIS,/);
  assert.match(exported.body, /,belum dicek,/);
});

test('the ingest status tells each satellite, its last pass and the next window', async () => {
  const status = (await call('GET', '/ingest/status')).json().data;
  assert.ok(Math.abs(Date.parse(status.serverTime) - Date.now()) < 60_000);
  assert.equal(status.runId, (await pool.query('SELECT max(id)::int AS id FROM ingest_runs WHERE error IS NULL AND finished_at IS NOT NULL')).rows[0].id);
  assert.equal(typeof status.intervalMinutes, 'number');
  assert.equal(status.nextRunAt, null, 'no scheduler runs in the tests');
  assert.equal(status.lastRun.ok, true);
  assert.ok(status.lastRun.finishedAt);
  assert.deepEqual(status.satellites.map((s: any) => s.satellite), ['N21', 'N20', 'N', 'T', 'A']);
  assert.deepEqual(status.satellites.map((s: any) => s.label), ['NOAA-21', 'NOAA-20', 'S-NPP', 'Terra', 'Aqua']);
  assert.deepEqual(status.satellites.map((s: any) => s.sensor), ['VIIRS', 'VIIRS', 'VIIRS', 'MODIS', 'MODIS']);
  const [n21] = status.satellites;
  assert.ok(n21.latestAcquisition && n21.latestIngestedAt);
  assert.ok(n21.last24h >= 5);
  assert.equal(typeof n21.medianLatencyMin, 'number');
  for (const satellite of status.satellites) {
    assert.equal(satellite.active, true);
    assert.equal(Date.parse(satellite.nextWindow.expectedBy) - Date.parse(satellite.nextWindow.end), 180 * 60_000);
    assert.ok(Date.parse(satellite.nextWindow.end) > Date.parse(satellite.nextWindow.start));
  }
  assert.equal(status.runs[0].feeds.length, 5);
});

test('S-NPP switches off after its last day and a broken MODIS row does not stop the ingest', async () => {
  const good = pt(8500, 3500);
  const result = await ingest(pool, { source: 'fixture', peat, now: new Date('2026-11-03T00:00:00Z'), texts: { ...empty,
    N: csv('N', [{ point: pt(8600, 3600), hoursAgo: 0.3 }]),
    MODIS: `${modisCsv([{ point: good, hoursAgo: 0.3, satellite: 'A', confidence: 64 }])}\n-3.1,abc,320,1,1,2026-10-15,0329,A,50,6.1NRT,295,1,D\n${good.lat},${good.lon},320,1,1,2026-10-15,99999,A,50,6.1NRT,295,1,D` } });
  assert.ok(!result.feeds.some(feed => feed.satellite === 'N'));
  assert.equal(result.inserted, 1);
  assert.equal(result.feeds.find(feed => feed.satellite === 'A')!.error, null);
  const row = await incident(await incidentAt(good));
  assert.equal(row.modis_only, true);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM detections WHERE satellite = 'N'")).rows[0].n, 0);
});

test('an ingest notifies for a new alert or an incident that just became high priority, not for every pass', async () => {
  // High confidence, 64 MW and three detections make 60 points before peat and settlements: high priority anywhere.
  const strong = (x: number, y: number, hoursAgo: number) => ({ point: pt(x, y), hoursAgo, confidence: 'high', frp: 64 });
  const row = (y: number, hoursAgo: number, xs = [300, 500, 700]) => xs.map(x => strong(x, y, hoursAgo));
  const mine = (alerts: NewAlert[]) => alerts.filter(alert => alert.userId === mpaId).map(alert => [alert.incidentId, alert.fresh] as const).sort();
  const pass1 = await ingest(pool, { source: 'fixture', peat, texts: { ...empty, N21: csv('N21', [...row(300, 1.4), ...row(1700, 1.4)]) } });
  const x = await incidentAt(pt(300, 300)), y = await incidentAt(pt(300, 1700));
  assert.notEqual(x, y);
  assert.equal((await incident(x)).level, 'tinggi');
  assert.deepEqual(mine(pass1.alerts), [[x, true], [y, true]].sort(), 'two new alerts for the volunteer who watches the village');
  // X was already high priority and its alert was read; Y looked like medium priority before the next pass.
  await pool.query('UPDATE alerts SET read_at = now() WHERE user_id = $1 AND incident_id = $2', [mpaId, x]);
  await pool.query("UPDATE incidents SET level = 'sedang' WHERE id = $1", [y]);
  const pass2 = await ingest(pool, { source: 'fixture', peat, texts: { ...empty,
    N20: csv('N20', [...row(300, 0.4, [900]), ...row(1700, 0.4, [900]), ...row(2700, 0.4)]) } });
  assert.equal(await incidentAt(pt(900, 300)), x);
  const z = await incidentAt(pt(300, 2700));
  assert.deepEqual(mine(pass2.alerts), [[y, false], [z, true]].sort(), 'Y became high priority and Z is new; X only gained detections');
  assert.equal((await pool.query('SELECT read_at FROM alerts WHERE user_id = $1 AND incident_id = $2', [mpaId, x])).rows[0].read_at, null, 'X moved up the inbox, unread');
  // One notification per user and run, for the highest-scoring alert, with the count in the title.
  const sent: { endpoint: string; payload: any }[] = [];
  await pushAlerts(pool, pass2.alerts.map(alert => alert.id), async (subscription, payload) => { sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) }); });
  const toVolunteer = sent.filter(item => item.endpoint === 'https://push.example/abc');
  assert.equal(toVolunteer.length, 1);
  assert.equal(toVolunteer[0]!.payload.title, `2 peringatan baru · Desa ${village.name} dan 1 lainnya`);
  assert.match(toVolunteer[0]!.payload.body, /titik panas · .* · prioritas tinggi\. Titik panas perlu dicek di lapangan\.$/);
  // Another user who starts watching the village gets alerts; the volunteer's inbox stays as it was.
  await pool.query('UPDATE alerts SET read_at = now() WHERE user_id = $1', [mpaId]);
  const saved = await call('PUT', '/me/subscriptions', await demo('kades'), { villages: [{ villageId: village.id, radiusKm: 0 }] });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.ok(saved.json().data.newAlerts >= 3);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM alerts WHERE user_id = $1 AND read_at IS NULL', [mpaId])).rows[0].n, 0);
});

test('a shared link shows the alert text in the preview', async () => {
  const code = (await pool.query('SELECT code FROM incidents WHERE village_id IS NOT NULL ORDER BY detection_count DESC LIMIT 1')).rows[0].code;
  const response = await app.inject({ method: 'GET', url: `/k/${code}` });
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /<meta property="og:title" content="\d+ titik panas · Desa [^"]+ · prioritas (tinggi|sedang|rendah)"/);
  assert.match(response.body, /Titik panas perlu dicek di lapangan\./);
});

test('the demo reset keeps satellite data, takes back what demo accounts did and seeds example tasks', async () => {
  const detections = (await pool.query('SELECT count(*)::int AS n FROM detections')).rows[0].n;
  await resetDemo(pool);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM detections')).rows[0].n, detections);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM verifications WHERE NOT is_demo")).rows[0].n, 0);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM static_sources WHERE kind = 'alarm_palsu'")).rows[0].n, 0);
  const tasks = (await pool.query('SELECT status, assignee_id, assigned_by FROM assignments ORDER BY status')).rows;
  assert.deepEqual(tasks.map(row => row.status), ['ditugaskan', 'menuju'], 'earlier tasks are gone, two examples are back');
  assert.ok(tasks.every(row => row.assigned_by === bpbdId));
  assert.equal(tasks.find(row => row.status === 'ditugaskan')!.assignee_id, mpaId);
  assert.equal(tasks.find(row => row.status === 'menuju')!.assignee_id, demoSquads[0].id);
  const names = (await pool.query("SELECT name FROM users WHERE role = 'mpa' AND email LIKE '%@titikapi.test' ORDER BY name")).rows.map(row => row.name);
  assert.ok(names.includes('Regu MPA Sungai Menang (demo)') && names.includes('Regu MPA Pedamaran (demo)') && names.includes('Regu MPA Cengal (demo)'));
  const squadLogin = await call('POST', '/auth/login', undefined, { email: demoSquads[0].email, password: demoPassword, client: 'mobile' });
  assert.equal(squadLogin.statusCode, 401, 'the extra squads cannot sign in');
  assert.equal((await call('POST', '/auth/demo', undefined, { role: 'admin' })).statusCode, 400);
  const mine = (await call('GET', '/me/assignments', await demo('mpa'))).json().data as any[];
  assert.equal(mine.length, 1);
  assert.equal(mine[0].status, 'ditugaskan');
});
