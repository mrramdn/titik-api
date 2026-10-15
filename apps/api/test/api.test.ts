import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { createApp } from '../src/app.js';
import { createPool } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { loadReference } from '../src/reference.js';
import { ingest } from '../src/ingest.js';
import { resetDemo } from '../src/demo.js';
import { parseFirmsCsv } from '../src/firms.js';
import { cardText, formatDistance, formatWib, scoreIncident, windName } from '../src/geo.js';
import type { PeatMask } from '../src/peat.js';

const testUrl = process.env.TEST_DATABASE_URL ?? 'postgres://titikapi:titikapi@localhost:5442/titikapi_test';
assert.ok(new URL(testUrl).pathname.endsWith('_test'), 'Integration tests require a dedicated database ending in _test.');
const pool = createPool(testUrl);
const origin = 'http://localhost:3000';
let app: FastifyInstance;
let directory: string;
const pushed: { endpoint: string; payload: string }[] = [];
const peat: PeatMask = { isPeat: lon => lon > 105.5 };
let village: { id: string; name: string; lon: number; lat: number };

// Points east (+) and north (+) of the village centre, in metres.
const at = (east: number, north: number) => ({ lon: village.lon + east / (111_320 * Math.cos((village.lat * Math.PI) / 180)), lat: village.lat + north / 110_574 });
const header = 'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight';
// Incidents are grouped per day in Western Indonesian Time, so every fixture detection falls in one WIB day:
// an hour ago, or just before the last WIB midnight when an hour ago is too early in the day.
const wibHours = (date: Date) => ((date.getUTCHours() + 7) % 24) + date.getUTCMinutes() / 60;
let anchor = new Date(Date.now() - 3600_000);
if (wibHours(anchor) < 2.6) anchor = new Date(anchor.getTime() - wibHours(anchor) * 3600_000 - 60_000);
function csv(satellite: string, rows: { point: { lon: number; lat: number }; hoursAgo: number; confidence?: string; frp?: number }[]) {
  return [header, ...rows.map(row => {
    const time = new Date(anchor.getTime() - row.hoursAgo * 3600_000);
    const hhmm = `${String(time.getUTCHours()).padStart(2, '0')}${String(time.getUTCMinutes()).padStart(2, '0')}`;
    return `${row.point.lat.toFixed(5)},${row.point.lon.toFixed(5)},340.1,0.4,0.37,${time.toISOString().slice(0, 10)},${hhmm},${satellite},${row.confidence ?? 'nominal'},2.0NRT,295.2,${row.frp ?? 6.5},D`;
  })].join('\n');
}
async function call(method: string, url: string, token?: string, payload?: unknown) {
  return app.inject({ method: method as any, url: `/api/v1${url}`, ...(payload === undefined ? {} : { payload }), headers: token ? { authorization: `Bearer ${token}` } : {} });
}
async function demo(role: 'mpa' | 'kades' | 'bpbd') {
  const response = await call('POST', '/auth/demo', undefined, { role, client: 'mobile' });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().data.token as string;
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'titikapi-api-'));
  const web = join(directory, 'web');
  await mkdir(web);
  await writeFile(join(web, 'index.html'), '<html><head><title>Titik Api</title><meta property="og:title" content="Titik Api" /><meta name="description" content="x" /></head></html>');
  await migrate(pool);
  await loadReference(pool);
  await pool.query('TRUNCATE ingest_runs, detections, incidents, alerts, verifications, subscriptions, push_subscriptions, sessions RESTART IDENTITY CASCADE');
  await pool.query("DELETE FROM static_sources WHERE kind = 'alarm_palsu'");
  await pool.query('DELETE FROM users');
  // A village large enough that every test point (up to 4 km east of its centre) lies inside it.
  const offsets = [[0, 0], [250, 120], [120, -80], [30, 30], [900, 0], [1600, 0], [2300, 0], [3000, 0], [3600, 0], [4000, 0]];
  for (const candidate of (await pool.query('SELECT id, name, ST_X(center) AS lon, ST_Y(center) AS lat FROM villages ORDER BY area_ha DESC LIMIT 40')).rows) {
    village = candidate;
    const points = offsets.map(([east, north]) => at(east!, north!));
    const inside = await pool.query(`SELECT bool_and(ST_Contains(v.geom, ST_SetSRID(ST_MakePoint(p.lon, p.lat), 4326))) AS ok FROM villages v,
      unnest($2::float8[], $3::float8[]) AS p(lon, lat) WHERE v.id = $1`, [candidate.id, points.map(p => p.lon), points.map(p => p.lat)]);
    if (inside.rows[0].ok) break;
  }
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
  assert.equal(rows[1]!.frp, null);
});

test('the priority score is a visible sum of rules', () => {
  const high = scoreIncident({ bestConfidence: 'high', maxFrp: 31, detectionCount: 4, onPeat: true, settlementMeters: 800, nearStatic: false });
  assert.deepEqual(high.parts.map(part => part.points), [30, 14, 10, 20, 15]);
  assert.equal(high.score, 89);
  assert.equal(high.level, 'tinggi');
  const industrial = scoreIncident({ bestConfidence: 'high', maxFrp: 60, detectionCount: 5, onPeat: false, settlementMeters: 500, nearStatic: true });
  assert.equal(industrial.parts.at(-1)!.points, -40);
  assert.equal(industrial.level, 'sedang');
  assert.equal(scoreIncident({ bestConfidence: 'low', maxFrp: 1, detectionCount: 1, onPeat: false, settlementMeters: null, nearStatic: false }).level, 'rendah');
});

test('a card says how far and which way from the village centre, in Jakarta time', () => {
  assert.equal(windName(135), 'tenggara');
  assert.equal(formatDistance(1234), '1,2 km');
  assert.equal(formatDistance(340), '340 m');
  assert.equal(formatWib(new Date('2026-10-16T06:42:00Z')), '13.42');
  const text = cardText({ detectionCount: 3, centroid: [106.0085, -3.0085], onPeat: true, lastDetectedAt: new Date('2026-10-16T06:42:00Z'), satellites: ['N21', 'N20'],
    bestConfidence: 'high', level: 'tinggi', nearStatic: false }, { name: 'Contoh', center: [106, -3] });
  assert.match(text, /^3 titik panas · 1,3 km tenggara pusat Desa Contoh · di lahan gambut · terakhir 13\.42 WIB \(NOAA-21\/NOAA-20\) · keyakinan tinggi · prioritas TINGGI\./);
  assert.match(text, /belum tentu api/);
});

let firstIncident: string;
test('ingest links detections to villages, groups them into incidents and is idempotent', async () => {
  const texts = {
    N21: csv('N21', [{ point: at(0, 0), hoursAgo: 2.5, confidence: 'high', frp: 31 }, { point: at(250, 120), hoursAgo: 2 }, { point: at(4000, 0), hoursAgo: 2 }]),
    N20: csv('N20', [{ point: at(120, -80), hoursAgo: 1.5 }, { point: { lon: 104.75, lat: -2.98 }, hoursAgo: 1.5 }]),
    N: '',
  };
  const first = await ingest(pool, { source: 'fixture', texts, peat });
  assert.equal(first.inserted, 5);
  assert.equal(first.incidents.length, 2);
  const outside = await pool.query('SELECT village_id, incident_id FROM detections WHERE longitude < 104.8');
  assert.equal(outside.rows[0].village_id, null, 'Palembang lies outside the pilot regency');
  assert.equal(outside.rows[0].incident_id, null);
  const incident = (await pool.query('SELECT * FROM incidents ORDER BY detection_count DESC LIMIT 1')).rows[0];
  firstIncident = incident.id;
  assert.equal(incident.detection_count, 3);
  assert.deepEqual([...incident.satellites].sort(), ['N20', 'N21']);
  assert.equal(incident.best_confidence, 'high');
  assert.equal(incident.village_id, village.id);
  assert.ok(incident.score_parts.length >= 5);
  const again = await ingest(pool, { source: 'fixture', texts, peat });
  assert.equal(again.inserted, 0);
  assert.equal(again.incidents.length, 0);
});

test('the volunteer gets cards for the villages they watch and can share them', async () => {
  const mpa = await demo('mpa');
  const save = await call('PUT', '/me/subscriptions', mpa, { villages: [{ villageId: village.id, radiusKm: 0 }] });
  assert.equal(save.statusCode, 200, save.body);
  const alerts = await call('GET', '/me/alerts', mpa);
  const cards = alerts.json().data as any[];
  const card = cards.find(item => item.incident.id === firstIncident);
  assert.ok(card, 'the incident in the watched village has a card');
  assert.match(card.card, new RegExp(`pusat Desa ${village.name}`));
  assert.equal((await call('POST', `/me/alerts/${card.id}/shared`, mpa)).statusCode, 200);
  assert.ok((await call('GET', '/me/alerts', mpa)).json().data.find((item: any) => item.id === card.id).sharedAt);
});

test('push: a browser subscribes and receives the newest card as a test notification', async () => {
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
  const incident = (await pool.query('SELECT first_detected_at FROM incidents WHERE id = $1', [firstIncident])).rows[0];
  const clientUuid = randomUUID();
  const observedAt = new Date(incident.first_detected_at.getTime() + 47 * 60_000).toISOString();
  const report = { clientUuid, status: 'asap_bara', note: 'Asap tipis', latitude: at(30, 30).lat, longitude: at(30, 30).lon, accuracyM: 9, observedAt };
  assert.equal((await call('POST', `/incidents/${firstIncident}/verifications`, kades, report)).statusCode, 403);
  const early = await call('POST', `/incidents/${firstIncident}/verifications`, mpa, { ...report, clientUuid: randomUUID(), observedAt: new Date(incident.first_detected_at.getTime() - 3 * 3600_000).toISOString() });
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

test('new detections that bridge two incidents merge them, reports included', async () => {
  const before = (await pool.query('SELECT count(*)::int AS n FROM incidents WHERE village_id IS NOT NULL')).rows[0].n;
  await ingest(pool, { source: 'fixture', peat, texts: { N21: csv('N21', [900, 1600, 2300, 3000, 3600].map(east => ({ point: at(east, 0), hoursAgo: 0 }))), N20: '', N: '' } });
  const after = (await pool.query('SELECT count(*)::int AS n FROM incidents WHERE village_id IS NOT NULL')).rows[0].n;
  assert.equal(after, before - 1, 'the two incidents became one');
  const merged = (await pool.query('SELECT incident_id FROM detections WHERE latitude = $1 OR longitude > $2', [at(4000, 0).lat, at(3900, 0).lon])).rows;
  assert.ok(merged.every(row => row.incident_id === merged[0].incident_id));
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM verifications v LEFT JOIN incidents i ON i.id = v.incident_id WHERE i.id IS NULL')).rows[0].n, 0);
});

test('the agency dashboard counts checks and the median time to the first one; the CSV follows the groundcheck form', async () => {
  const bpbd = await demo('bpbd');
  const mpa = await demo('mpa');
  assert.equal((await call('GET', '/dashboard', mpa)).statusCode, 403);
  const dashboard = await call('GET', '/dashboard?range=7d', bpbd);
  assert.equal(dashboard.statusCode, 200, dashboard.body);
  const summary = dashboard.json().data.summary;
  assert.ok(summary.verified >= 1);
  assert.equal(typeof summary.medianMinutesToVerification, 'number');
  const exported = await app.inject({ method: 'GET', url: '/api/v1/export/groundcheck.csv?range=7d', headers: { authorization: `Bearer ${bpbd}` } });
  assert.equal(exported.statusCode, 200);
  const [head] = exported.body.replace('﻿', '').split('\r\n');
  assert.ok(head!.startsWith('id_kejadian,tanggal_deteksi,jam_deteksi_wib,provinsi,kabupaten,kecamatan,desa,lintang,bujur,satelit'));
  assert.match(exported.body, /Asap\/bara/);
});

test('a shared link shows the card in the preview', async () => {
  const code = (await pool.query('SELECT code FROM incidents WHERE village_id IS NOT NULL ORDER BY detection_count DESC LIMIT 1')).rows[0].code;
  const response = await app.inject({ method: 'GET', url: `/k/${code}` });
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /<meta property="og:title" content="\d+ titik panas · Desa /);
  assert.match(response.body, /belum tentu api/);
});

test('the demo reset keeps satellite data and only takes back what demo accounts did', async () => {
  const detections = (await pool.query('SELECT count(*)::int AS n FROM detections')).rows[0].n;
  await resetDemo(pool);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM detections')).rows[0].n, detections);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM verifications WHERE NOT is_demo")).rows[0].n, 0);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM static_sources WHERE kind = 'alarm_palsu'")).rows[0].n, 0);
  assert.equal((await call('POST', '/auth/demo', undefined, { role: 'admin' })).statusCode, 400);
});
