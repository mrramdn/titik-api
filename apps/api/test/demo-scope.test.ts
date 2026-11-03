// The demo accounts are shared by every visitor, so what they do stays in the demo scope: visitors and real accounts see
// real field checks and tasks only, a demo session sees real and demo ones together, and the demo flow still works.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance, InjectOptions } from 'fastify';
import sharp from 'sharp';
import { createApp } from '../src/app.js';
import { demoAccounts, resetDemo } from '../src/demo.js';
import { statusLabel, wibDay } from '../src/geo.js';
import { clearTileCache } from '../src/incidents.js';
import { refreshIncidents } from '../src/ingest.js';
import { account, bigVillage, emptyDatabase, insertDetection, insertIncident, testPool, tileOf, wibMidnight, type Account } from './fixtures.js';
import { readTile } from './mvt.js';

const pool = testPool();
const origin = 'http://localhost:3000';
let app: FastifyInstance;
let directory: string;
let uploads: string;
const pushed: { endpoint: string; payload: { title: string; body: string } }[] = [];
let village: Awaited<ReturnType<typeof bigVillage>>;
let tile: { z: number; x: number; y: number };
/** High-priority incidents 400 m apart on one row of one zoom 12 tile, A to G. */
const incidents: Record<string, string> = {};
const points: Record<string, { lon: number; lat: number }> = {};
let real: { bpbd: Account; mpa: Account };
let demo: { bpbd: string; mpa: string };
const demoMpaId = demoAccounts[0].id;
const today = wibDay();

/** The centre of a tile, so the fixture row stays well inside it. */
function tileCentre(z: number, x: number, y: number) {
  const n = 2 ** z;
  return { lon: ((x + 0.5) / n) * 360 - 180, lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) * 180) / Math.PI };
}
async function call(method: string, url: string, token?: string, payload?: object) {
  return app.inject({ method: method as InjectOptions['method'], url: `/api/v1${url}`, ...(payload === undefined ? {} : { payload }),
    headers: token ? { authorization: `Bearer ${token}` } : {} });
}
async function data(url: string, token?: string) {
  const response = await call('GET', url, token);
  assert.equal(response.statusCode, 200, `${url}: ${response.body}`);
  return response.json().data;
}
const report = (status: string, extra: object = {}) => ({ clientUuid: randomUUID(), status, observedAt: new Date().toISOString(), ...extra });
async function check(token: string, name: string, status: string, extra: object = {}) {
  const response = await call('POST', `/incidents/${incidents[name]}/verifications`, token, report(status, extra));
  assert.equal(response.statusCode, 201, response.body);
  return response.json().data as { id: string; closedAssignment: string | null };
}
async function assign(token: string, name: string, assigneeId: string, note?: string) {
  return call('POST', `/incidents/${incidents[name]}/assignments`, token, { assigneeId, ...(note ? { note } : {}) });
}
/** The kejadian tile of the fixture row: its features by incident id and its cache header. */
async function kejadian(token?: string, extra = '') {
  const response = await app.inject({ method: 'GET', url: `/api/v1/tiles/kejadian/${tile.z}/${tile.x}/${tile.y}.mvt?hours=24${extra}`,
    headers: token ? { authorization: `Bearer ${token}` } : {} });
  assert.equal(response.statusCode, 200, response.body);
  const layer = readTile(response.rawPayload).find(item => item.name === 'kejadian');
  return { byId: new Map((layer?.features ?? []).map(feature => [String(feature.properties.id), feature.properties])), cache: response.headers['cache-control'] };
}
async function photoCheck(token: string, name: string, fields: Record<string, string>) {
  const jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#a33' } }).jpeg().toBuffer();
  const boundary = '----titikapi-demo';
  const body = Buffer.concat([
    ...Object.entries({ clientUuid: randomUUID(), observedAt: new Date().toISOString(), ...fields }).map(([key, value]) =>
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`)),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="a.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`), jpeg, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const response = await app.inject({ method: 'POST', url: `/api/v1/incidents/${incidents[name]}/verifications`, payload: body,
    headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` } });
  assert.equal(response.statusCode, 201, response.body);
  const row = (await pool.query('SELECT photo_url, photo_thumb_url FROM verifications WHERE id = $1', [response.json().data.id])).rows[0];
  return [row.photo_url, row.photo_thumb_url].map((url: string) => join(uploads, url.split('/').at(-1)!));
}
/** Rows of the groundcheck export by incident code, with quoted cells read back. */
async function exported(token: string) {
  const response = await app.inject({ method: 'GET', url: '/api/v1/export/groundcheck.csv?range=24h', headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.statusCode, 200, response.body);
  const split = (line: string) => {
    const cells: string[] = [];
    let cell = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (quoted && ch === '"' && line[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) { cells.push(cell); cell = ''; } else cell += ch;
    }
    return [...cells, cell];
  };
  const [head, ...lines] = response.body.replace('﻿', '').split('\r\n').filter(Boolean);
  const names = split(head!);
  return new Map(lines.map(line => { const row = Object.fromEntries(split(line).map((value, k) => [names[k]!, value])); return [row.id_kejadian!, row]; }));
}
/** What the triage made of an incident: score, level, its near_static flag and those of its detections in id order. */
async function triage(name: string) {
  const row = (await pool.query(`SELECT i.score, i.level, i.near_static, array_agg(d.near_static ORDER BY d.id) AS flags
    FROM incidents i JOIN detections d ON d.incident_id = i.id WHERE i.id = $1 GROUP BY i.id`, [incidents[name]])).rows[0];
  return { score: row.score as number, level: row.level as string, nearStatic: row.near_static as boolean, flags: row.flags as boolean[] };
}
const codeOf = async (name: string) => (await pool.query('SELECT code FROM incidents WHERE id = $1', [incidents[name]])).rows[0].code as string;
const centroidOf = async (name: string) => (await pool.query('SELECT ST_X(centroid) AS lon, ST_Y(centroid) AS lat FROM incidents WHERE id = $1', [incidents[name]])).rows[0] as { lon: number; lat: number };

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'titikapi-demo-'));
  uploads = join(directory, 'uploads');
  await emptyDatabase(pool);
  village = await bigVillage(pool);
  // The demo accounts come first, while there is no incident for the reset's examples to land on.
  await resetDemo(pool, uploads);
  const t = tileOf(village.lon, village.lat, 12);
  tile = { z: 12, ...t };
  const centre = tileCentre(12, t.x, t.y);
  // Detected earlier today (WIB), so the daily recap of today counts them.
  const first = new Date(Math.max(Date.now() - 3600_000, wibMidnight(today).getTime() + 30_000));
  for (const [k, name] of ['A', 'B', 'C', 'D', 'E', 'F', 'G'].entries()) {
    points[name] = { lon: centre.lon + 0.004 * (k - 3), lat: centre.lat };
    incidents[name] = await insertIncident(pool, { villageId: village.id, first, last: first, ...points[name]!, level: 'tinggi', score: 70 });
  }
  // D and E carry detections, so a false alarm could rescore them.
  for (const name of ['D', 'E']) {
    for (const dx of [0, 0.0012, 0.0024]) {
      await insertDetection(pool, { lon: points[name]!.lon + dx, lat: points[name]!.lat, acqAt: first, confidence: 'high', villageId: village.id, incidentId: incidents[name] });
    }
  }
  await refreshIncidents(pool, [incidents.D!, incidents.E!]);
  clearTileCache();
  app = (await createApp({ pool, uploadsDir: uploads, webDir: join(directory, 'web'), logger: false, origins: [origin], demoLogin: true,
    pushSender: async (subscription, payload) => { pushed.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) }); } })).app;
  real = { bpbd: await account(pool, 'bpbd', 'real'), mpa: await account(pool, 'mpa', 'real') };
  const session = async (role: 'mpa' | 'bpbd') => {
    const response = await call('POST', '/auth/demo', undefined, { role, client: 'mobile' });
    assert.equal(response.statusCode, 200, response.body);
    return response.json().data.token as string;
  };
  demo = { bpbd: await session('bpbd'), mpa: await session('mpa') };
  for (const [token, endpoint] of [[demo.mpa, 'https://push.example/demo'], [real.mpa.token, 'https://push.example/real']] as const) {
    const response = await call('POST', '/me/push', token, { endpoint, keys: { p256dh: 'BPx'.padEnd(40, 'x'), auth: 'auth-key' } });
    assert.equal(response.statusCode, 200, response.body);
  }
});
after(async () => { if (app) await app.close(); await pool.end(); if (directory) await rm(directory, { recursive: true, force: true }); });

test('a demo field check and a demo task change nothing that visitors and real accounts see, only what demo sessions see', async () => {
  const before = await kejadian();
  assert.deepEqual([before.byId.get(incidents.A!)?.verified, before.byId.get(incidents.B!)?.assigned], [false, false]);
  const publicSummary = await data('/summary?hours=24');
  const publicRegion = (await data('/regions/summary?hours=24') as any[]).find(item => item.name === village.regency);

  await check(demo.mpa, 'A', 'asap_bara', { note: 'Asap tipis dari pengunjung', latitude: points.A!.lat + 0.004, longitude: points.A!.lon, accuracyM: 8 });
  const task = await assign(demo.bpbd, 'B', demoMpaId, 'Cek dari akun demo');
  assert.equal(task.statusCode, 201, task.body);
  const stored = (await pool.query('SELECT first_verified_at, latest_status, first_verified_any_at, latest_status_any FROM incidents WHERE id = $1', [incidents.A])).rows[0];
  assert.deepEqual([stored.first_verified_at, stored.latest_status, stored.latest_status_any], [null, null, 'asap_bara'], 'the public summary keeps real checks only');
  assert.ok(stored.first_verified_any_at);

  // The public tile, also when &lihat=demo comes without a demo session.
  for (const [token, extra] of [[undefined, ''], [undefined, '&lihat=demo'], [real.bpbd.token, '&lihat=demo'], [demo.bpbd, '']] as const) {
    const shown = await kejadian(token, extra);
    assert.deepEqual([shown.byId.get(incidents.A!)?.verified, shown.byId.get(incidents.B!)?.assigned], [false, false], `${token ? 'signed in' : 'visitor'}${extra}`);
    assert.equal(shown.cache, 'public, max-age=120');
  }
  const demoTile = await kejadian(demo.mpa, '&lihat=demo');
  assert.deepEqual([demoTile.byId.get(incidents.A!)?.verified, demoTile.byId.get(incidents.B!)?.assigned], [true, true], 'a demo session sees its own check and task');
  assert.equal(demoTile.cache, 'private, max-age=60');
  assert.deepEqual([demoTile.byId.get(incidents.C!)?.verified, demoTile.byId.get(incidents.C!)?.assigned], [false, false]);

  const byId = (rows: any[]) => new Map(rows.map(row => [row.id as string, row]));
  for (const token of [undefined, real.bpbd.token]) {
    const who = token ? 'real BPBD' : 'visitor';
    const list = byId(await data('/incidents?hours=24', token));
    assert.deepEqual([list.get(incidents.A!).firstVerifiedAt, list.get(incidents.A!).latestStatus, list.get(incidents.A!).latestCheck], [null, null, null], who);
    assert.equal(list.get(incidents.B!).assignment, null, who);
    const ids = async (status: string) => (await data(`/incidents?hours=24&status=${status}`, token) as any[]).map(row => row.id);
    assert.ok(!(await ids('checked')).includes(incidents.A) && !(await ids('assigned')).includes(incidents.B), who);
    assert.ok((await ids('open')).includes(incidents.A) && (await ids('open')).includes(incidents.B), who);
    const a = await data(`/incidents/${incidents.A}`, token), b = await data(`/incidents/${incidents.B}`, token);
    assert.deepEqual([a.verifications, a.timeline.filter((event: any) => event.kind === 'checked')], [[], []], who);
    assert.equal(b.assignment, null, who);
    assert.ok(!b.timeline.some((event: any) => event.kind === 'assigned'), who);
    assert.deepEqual(await data('/summary?hours=24', token), publicSummary, who);
    assert.deepEqual((await data('/regions/summary?hours=24', token) as any[]).find(item => item.name === village.regency), publicRegion, who);
    assert.equal((await data(`/villages/${village.id}`, token)).incidents.find((row: any) => row.id === incidents.A).firstVerifiedAt, null, who);
  }

  const list = byId(await data('/incidents?hours=24', demo.bpbd));
  assert.ok(list.get(incidents.A!).firstVerifiedAt);
  assert.deepEqual([list.get(incidents.A!).latestStatus, list.get(incidents.A!).latestCheck.demo], ['asap_bara', true]);
  assert.deepEqual([list.get(incidents.B!).assignment.status, list.get(incidents.B!).assignment.note], ['ditugaskan', 'Cek dari akun demo']);
  assert.ok((await data('/incidents?hours=24&status=checked', demo.bpbd) as any[]).some(row => row.id === incidents.A));
  assert.ok((await data('/incidents?hours=24&status=assigned', demo.bpbd) as any[]).some(row => row.id === incidents.B));
  assert.ok(!(await data('/incidents?hours=24&status=open', demo.bpbd) as any[]).some(row => row.id === incidents.A || row.id === incidents.B));
  const a = await data(`/incidents/${incidents.A}`, demo.bpbd), b = await data(`/incidents/${incidents.B}`, demo.bpbd);
  assert.deepEqual(a.verifications.map((v: any) => [v.status, v.demo, v.note]), [['asap_bara', true, 'Asap tipis dari pengunjung']]);
  assert.ok(a.timeline.some((event: any) => event.kind === 'checked' && event.demo));
  assert.equal(b.assignment.status, 'ditugaskan');
  assert.ok(b.timeline.some((event: any) => event.kind === 'assigned'));
  const demoSummary = await data('/summary?hours=24', demo.bpbd);
  assert.deepEqual([demoSummary.verified, demoSummary.highOpen], [publicSummary.verified + 1, publicSummary.highOpen - 1]);
  const demoRegion = (await data('/regions/summary?hours=24', demo.bpbd) as any[]).find(item => item.name === village.regency);
  assert.deepEqual([demoRegion.checked, demoRegion.open], [publicRegion.checked + 1, publicRegion.open - 2], 'A is checked and B has a task');

  const realDash = await data('/dashboard?range=24h', real.bpbd.token), demoDash = await data('/dashboard?range=24h', demo.bpbd);
  assert.deepEqual([realDash.summary.verified, realDash.summary.assigned, realDash.assignments.ditugaskan, realDash.recentVerifications.length], [0, 0, 0, 0]);
  assert.deepEqual(realDash.verificationsFromDemoAccounts, { total: 0, demo: 0 });
  assert.deepEqual([demoDash.summary.verified, demoDash.summary.assigned, demoDash.assignments.ditugaskan], [1, 1, 1]);
  assert.equal(demoDash.summary.needsAction, realDash.summary.needsAction - 2);
  assert.deepEqual(demoDash.recentVerifications.map((v: any) => [v.incidentId, v.demo]), [[incidents.A, true]]);
  assert.deepEqual(demoDash.verificationsFromDemoAccounts, { total: 1, demo: 1 });
  const realRecap = await data(`/recap?date=${today}`, real.bpbd.token), demoRecap = await data(`/recap?date=${today}`, demo.bpbd);
  assert.deepEqual([realRecap.totals.checked, realRecap.checks, realRecap.assignments.ditugaskan], [0, {}, 0]);
  assert.deepEqual([demoRecap.totals.checked, demoRecap.checks, demoRecap.assignments.ditugaskan], [1, { asap_bara: 1 }, 1]);
});

test('a demo false alarm adds no fixed heat source and leaves the priority alone; a real one still teaches the triage', async () => {
  const state = async (name: string) => (await pool.query(`SELECT i.score, i.level, i.score_parts, i.near_static, bool_or(d.near_static) AS detections_static
    FROM incidents i JOIN detections d ON d.incident_id = i.id WHERE i.id = $1 GROUP BY i.id`, [incidents[name]])).rows[0];
  const sources = async () => (await pool.query("SELECT count(*)::int AS n FROM static_sources WHERE kind = 'alarm_palsu'")).rows[0].n as number;
  const before = await state('D');
  await check(demo.mpa, 'D', 'alarm_palsu', { falseAlarmKind: 'industri' });
  assert.equal(await sources(), 0);
  assert.deepEqual(await state('D'), before, 'score, level, parts and the near_static flags are unchanged');
  assert.equal((await data(`/incidents/${incidents.D}`, demo.bpbd)).latestStatus, 'alarm_palsu', 'the demo session still sees its report');

  const realBefore = await state('E');
  await check(real.mpa.token, 'E', 'alarm_palsu', { falseAlarmKind: 'industri', note: 'Cerobong pabrik' });
  assert.equal(await sources(), 1);
  const realAfter = await state('E');
  assert.deepEqual([realAfter.near_static, realAfter.detections_static], [true, true]);
  assert.ok(realAfter.score < realBefore.score && realAfter.score_parts.some((part: any) => part.points === -40));
});

test('a demo field check stores the incident centre and the distance to it, never the position of the visitor', async () => {
  const row = async (name: string) => (await pool.query('SELECT latitude, longitude, accuracy_m, distance_m FROM verifications WHERE incident_id = $1 ORDER BY received_at LIMIT 1',
    [incidents[name]])).rows[0];
  const centre = await centroidOf('A');
  const visitor = { lat: points.A!.lat + 0.004, lon: points.A!.lon };
  const distance = (await pool.query('SELECT round(ST_Distance(ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, centroid::geography))::int AS m FROM incidents WHERE id = $3',
    [visitor.lon, visitor.lat, incidents.A])).rows[0].m;
  assert.ok(distance > 400 && distance < 500);
  assert.deepEqual(await row('A'), { latitude: centre.lat, longitude: centre.lon, accuracy_m: null, distance_m: distance });
  // A real volunteer's report keeps the position and accuracy that were sent.
  const position = { latitude: points.F!.lat - 0.002, longitude: points.F!.lon + 0.001 };
  await check(real.mpa.token, 'F', 'asap_bara', { note: 'Asap tipis dari kanal', ...position, accuracyM: 6 });
  const stored = await row('F');
  assert.deepEqual([stored.latitude, stored.longitude, Number(stored.accuracy_m)], [position.latitude, position.longitude, 6]);
  // Without a position nothing is stored, as for anyone.
  await check(demo.mpa, 'G', 'tidak_terjangkau');
  assert.deepEqual(await row('G'), { latitude: null, longitude: null, accuracy_m: null, distance_m: null });
});

test('one open task per incident in each scope: a demo task never blocks a real one, and a check closes the task of its own scope', async () => {
  const demoTask = await assign(demo.bpbd, 'C', demoMpaId);
  assert.equal(demoTask.statusCode, 201, demoTask.body);
  assert.equal(pushed.at(-1)!.endpoint, 'https://push.example/demo');
  assert.equal(pushed.at(-1)!.payload.title, `Demo · Tugas cek lapangan: Desa ${village.name}`, 'a demo account is told the task is demo');
  const again = await assign(demo.bpbd, 'C', demoMpaId);
  assert.deepEqual([again.statusCode, again.json().error.code], [409, 'ASSIGNMENT_OPEN']);
  const realTask = await assign(real.bpbd.token, 'C', real.mpa.id, 'Cek dari jalan kanal.');
  assert.equal(realTask.statusCode, 201, realTask.body);
  assert.deepEqual([pushed.at(-1)!.endpoint, pushed.at(-1)!.payload.title], ['https://push.example/real', `Tugas cek lapangan: Desa ${village.name}`]);
  assert.equal((await assign(real.bpbd.token, 'C', real.mpa.id)).statusCode, 409);
  // Visitors see the real task without its note or who assigned it; the real squad sees both.
  const shown = (await data(`/incidents/${incidents.C}`)).assignment;
  assert.deepEqual([shown.id, shown.assignee.id, shown.note, shown.assignedBy], [realTask.json().data.id, real.mpa.id, '', '']);
  assert.deepEqual([(await data(`/incidents/${incidents.C}`, real.mpa.token)).assignment.note], ['Cek dari jalan kanal.']);
  // A demo session, open to anyone, sees it as visitors do, in the detail and in the lists.
  const toDemo = (await data(`/incidents/${incidents.C}`, demo.bpbd)).assignment;
  assert.deepEqual([toDemo.id, toDemo.note, toDemo.assignedBy], [realTask.json().data.id, '', '']);
  const listed = (await data('/incidents?hours=24&status=assigned', demo.bpbd) as any[]).find(row => row.id === incidents.C).assignment;
  assert.deepEqual([listed.id, listed.note, listed.assignedBy], [realTask.json().data.id, '', '']);
  // A demo account sends demo squads only, and changes demo tasks only; a real account the same the other way round.
  assert.equal((await assign(demo.bpbd, 'G', real.mpa.id)).statusCode, 400);
  assert.equal((await assign(real.bpbd.token, 'G', demoMpaId)).statusCode, 400);
  assert.equal((await call('PATCH', `/assignments/${realTask.json().data.id}`, demo.bpbd, { status: 'dibatalkan' })).statusCode, 403);
  assert.equal((await call('PATCH', `/assignments/${demoTask.json().data.id}`, real.bpbd.token, { status: 'dibatalkan' })).statusCode, 403);
  const squads = async (token: string) => (await data(`/assignees?incident=${incidents.C}`, token) as any[]);
  const demoSquads = await squads(demo.bpbd), realSquads = await squads(real.bpbd.token);
  assert.ok(demoSquads.some(item => item.id === demoMpaId) && !demoSquads.some(item => item.id === real.mpa.id));
  assert.deepEqual(realSquads.map(item => [item.id, item.openAssignments]), [[real.mpa.id, 1]]);
  assert.deepEqual((await data('/me/assignments', real.mpa.token) as any[]).map(item => item.id), [realTask.json().data.id]);
  assert.ok((await data('/me/assignments', demo.mpa) as any[]).some(item => item.id === demoTask.json().data.id));

  // The real check goes through with the demo task open, and closes the real task only.
  const realCheck = await check(real.mpa.token, 'C', 'api_aktif');
  assert.equal(realCheck.closedAssignment, realTask.json().data.id);
  const status = async (id: string) => (await pool.query('SELECT status FROM assignments WHERE id = $1', [id])).rows[0].status;
  assert.equal(await status(demoTask.json().data.id), 'ditugaskan');
  // A demo check closes the demo task and never a real one.
  const nextReal = await assign(real.bpbd.token, 'C', real.mpa.id);
  assert.equal(nextReal.statusCode, 201, nextReal.body);
  const demoCheck = await check(demo.mpa, 'C', 'asap_bara');
  assert.equal(demoCheck.closedAssignment, demoTask.json().data.id);
  assert.equal(await status(nextReal.json().data.id), 'ditugaskan');
  const publicView = await data(`/incidents/${incidents.C}`);
  assert.deepEqual([publicView.latestStatus, publicView.verifications.length, publicView.assignment.id], ['api_aktif', 1, nextReal.json().data.id]);
});

test('a demo session, open to anyone, reads real field checks as visitors do, and demo ones in full', async () => {
  // F has a real check with a note (see above), A a demo one.
  const team = await data(`/incidents/${incidents.F}`, real.bpbd.token);
  const realCheck = team.verifications.find((v: any) => !v.demo);
  assert.deepEqual([realCheck.note, realCheck.reporter], ['Asap tipis dari kanal', 'Akun nyata mpa']);
  assert.ok(team.timeline.some((event: any) => event.kind === 'checked' && event.actor === 'Akun nyata mpa'));
  const toDemo = await data(`/incidents/${incidents.F}`, demo.bpbd);
  const shown = toDemo.verifications.find((v: any) => v.id === realCheck.id);
  assert.deepEqual([shown.status, shown.distanceMeters, 'note' in shown, 'photoUrl' in shown, 'reporter' in shown], [realCheck.status, realCheck.distanceMeters, false, false, false]);
  assert.ok(!toDemo.timeline.some((event: any) => event.kind === 'checked' && event.actor), 'nor who checked it');
  const demoCheck = (await data(`/incidents/${incidents.A}`, demo.bpbd)).verifications[0];
  assert.deepEqual([demoCheck.demo, demoCheck.note, demoCheck.reporter], [true, 'Asap tipis dari pengunjung', demoAccounts[0].name]);
  // The dashboard feed the same way.
  const feed = async (token: string) => (await data('/dashboard?range=24h', token)).recentVerifications as any[];
  const realFeed = (await feed(real.bpbd.token)).find(v => v.id === realCheck.id);
  assert.deepEqual([realFeed.note, realFeed.reporter], ['Asap tipis dari kanal', 'Akun nyata mpa']);
  const demoFeed = await feed(demo.bpbd);
  assert.deepEqual(demoFeed.filter(v => !v.demo).map(v => [v.note, v.photoThumbUrl, v.reporter]), [['', null, ''], ['', null, ''], ['', null, '']], 'the real checks of C, E and F');
  assert.ok(demoFeed.some(v => v.demo && v.note === 'Asap tipis dari pengunjung'));
});

test('the groundcheck export: real rows for a real account; a demo session also gets demo rows, and nobody\'s note, photo or position', async () => {
  const [a, f] = [await codeOf('A'), await codeOf('F')];
  const realRows = await exported(real.bpbd.token);
  assert.deepEqual([realRows.get(a)!.status_verifikasi, realRows.get(a)!.akun_demo, realRows.get(a)!.keterangan], ['belum dicek', '', '']);
  assert.deepEqual([realRows.get(f)!.status_verifikasi, realRows.get(f)!.keterangan, realRows.get(f)!.akun_demo], [statusLabel.asap_bara, 'Asap tipis dari kanal', 'tidak']);
  assert.equal(Number(realRows.get(f)!.lintang_pemeriksa), points.F!.lat - 0.002);
  const demoRows = await exported(demo.bpbd);
  const row = demoRows.get(a)!, centre = await centroidOf('A');
  assert.deepEqual([row.status_verifikasi, row.akun_demo, row.keterangan, row.foto], [statusLabel.asap_bara, 'ya', '', '']);
  assert.deepEqual([Number(row.lintang_pemeriksa), Number(row.bujur_pemeriksa)], [centre.lat, centre.lon], 'the incident centre, not where the visitor stood');
  assert.ok(Number(row.jarak_pemeriksa_m) > 400);
  // A real row keeps its result and distance, not the volunteer's position, note or photo.
  const realRow = demoRows.get(f)!;
  assert.deepEqual([realRow.status_verifikasi, realRow.akun_demo, realRow.jarak_pemeriksa_m], [statusLabel.asap_bara, 'tidak', realRows.get(f)!.jarak_pemeriksa_m]);
  assert.deepEqual([realRow.lintang_pemeriksa, realRow.bujur_pemeriksa, realRow.keterangan, realRow.foto], ['', '', '', '']);
});

test('the demo reset deletes the photos of demo checks and the push subscriptions of demo accounts, and keeps everything real', async () => {
  const demoPhoto = await photoCheck(demo.mpa, 'G', { status: 'asap_bara', note: 'Foto pengunjung' });
  const realPhoto = await photoCheck(real.mpa.token, 'F', { status: 'api_aktif' });
  for (const file of [...demoPhoto, ...realPhoto]) assert.ok(existsSync(file), file);
  // A demo report whose photo address leads out of the photo folder: the reset leaves that file alone.
  const outside = join(directory, 'outside.jpg');
  await writeFile(outside, 'not a photo');
  await pool.query(`INSERT INTO verifications (incident_id, user_id, client_uuid, status, observed_at, photo_url, photo_thumb_url, is_demo)
    VALUES ($1, $2, $3, 'asap_bara', now(), '/uploads/../outside.jpg', '/uploads/../../outside.jpg', true)`, [incidents.G, demoMpaId, randomUUID()]);
  const realChecks = (await pool.query('SELECT count(*)::int AS n FROM verifications WHERE NOT is_demo')).rows[0].n;
  const realTasks = (await pool.query('SELECT id, status FROM assignments WHERE NOT is_demo ORDER BY created_at')).rows;
  assert.ok(realChecks >= 4 && realTasks.length === 2);

  const { photosDeleted } = await resetDemo(pool, uploads);
  assert.equal(photosDeleted, 2);
  for (const file of demoPhoto) assert.ok(!existsSync(file), `${file} is deleted`);
  for (const file of [...realPhoto, outside]) assert.ok(existsSync(file), `${file} stays`);
  assert.deepEqual((await pool.query('SELECT endpoint FROM push_subscriptions ORDER BY endpoint')).rows.map(row => row.endpoint), ['https://push.example/real']);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM verifications WHERE is_demo AND note NOT LIKE 'Contoh dari akun demo.%'")).rows[0].n, 0);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM verifications WHERE NOT is_demo')).rows[0].n, realChecks);
  assert.deepEqual((await pool.query('SELECT id, status FROM assignments WHERE NOT is_demo ORDER BY created_at')).rows, realTasks);
  assert.ok((await pool.query('SELECT assigned_by FROM assignments WHERE is_demo')).rows.every(row => row.assigned_by === demoAccounts[2].id), 'only the example tasks are left');
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM static_sources WHERE kind = 'alarm_palsu'")).rows[0].n, 1, 'the real false alarm stays');
  const g = (await pool.query('SELECT first_verified_any_at, latest_status_any FROM incidents WHERE id = $1', [incidents.G])).rows[0];
  assert.deepEqual([g.first_verified_any_at, g.latest_status_any], [null, null], 'the demo summary is taken back too');
});

test('the reset takes back what old demo false alarms taught the triage, and never what a real false alarm taught', async () => {
  // A row 2 km south of the others. H and L have two detections 900 m apart, each 450 m from the centre: the 375 m fixed
  // heat source of a false alarm covers neither, so only the false alarm itself flags them.
  const centre = tileCentre(tile.z, tile.x, tile.y), lat = centre.lat - 0.02, first = new Date(Date.now() - 1800_000);
  const place = async (name: string, lon: number, offsets: number[]) => {
    incidents[name] = await insertIncident(pool, { villageId: village.id, first, last: first, lon, lat, level: 'tinggi', score: 70 });
    for (const dx of offsets) await insertDetection(pool, { lon: lon + dx, lat, acqAt: first, confidence: 'high', villageId: village.id, incidentId: incidents[name] });
  };
  await place('H', centre.lon - 0.016, [-0.00405, 0.00405]);
  await place('L', centre.lon - 0.006, [-0.00405, 0.00405]);
  await place('J', centre.lon + 0.006, [0, 0.0012]);
  await place('K', centre.lon + 0.009, [0]);
  await refreshIncidents(pool, ['H', 'L', 'J', 'K'].map(name => incidents[name]!));
  const untaught = { J: await triage('J'), K: await triage('K') };
  assert.deepEqual([untaught.J.flags, untaught.K.flags], [[false, false], [false]]);

  // Before demo checks stopped teaching the triage, a demo false alarm left a fixed heat source and flagged every
  // detection of its incident. J had one, and K's detection, 270 m from J's centre, came in after it and was flagged too.
  const oldDemoFalseAlarm = async (name: string) => {
    const id = (await pool.query(`INSERT INTO verifications (incident_id, user_id, client_uuid, status, false_alarm_kind, observed_at, is_demo)
      VALUES ($1, $2, $3, 'alarm_palsu', 'industri', now(), true) RETURNING id`, [incidents[name], demoMpaId, randomUUID()])).rows[0].id;
    await pool.query(`INSERT INTO static_sources (kind, label, geom, radius_m, verification_id, expires_at)
      SELECT 'alarm_palsu', 'Alarm palsu dari akun demo', centroid, 375, $2, now() + interval '30 days' FROM incidents WHERE id = $1`, [incidents[name], id]);
    await pool.query('UPDATE detections SET near_static = true WHERE incident_id = $1', [incidents[name]]);
  };
  await oldDemoFalseAlarm('J');
  await pool.query('UPDATE detections SET near_static = true WHERE incident_id = $1', [incidents.K]);
  // L had one too, and a real volunteer then found L a false alarm as well.
  await oldDemoFalseAlarm('L');
  await refreshIncidents(pool, ['J', 'K', 'L'].map(name => incidents[name]!));
  assert.ok((await triage('J')).score < untaught.J.score && (await triage('K')).score < untaught.K.score);
  await check(real.mpa.token, 'L', 'alarm_palsu', { falseAlarmKind: 'industri' });
  // H: a real false alarm, then a demo field check of the same incident.
  await check(real.mpa.token, 'H', 'alarm_palsu', { falseAlarmKind: 'pembakaran_sampah' });
  await check(demo.mpa, 'H', 'api_aktif');
  const taught = { H: await triage('H'), L: await triage('L') };
  assert.deepEqual([taught.H.flags, taught.L.flags, taught.H.nearStatic, taught.L.nearStatic], [[true, true], [true, true], true, true]);

  await resetDemo(pool, uploads);
  assert.deepEqual(await triage('H'), taught.H, 'a demo field check does not take back a real false alarm');
  assert.deepEqual(await triage('L'), taught.L, 'the old demo source goes, the real false alarm stays');
  assert.deepEqual(await triage('J'), untaught.J, 'what the old demo false alarm taught is taken back');
  assert.deepEqual(await triage('K'), untaught.K, 'on the later detection within its radius too');
  const publicH = await data(`/incidents/${incidents.H}`);
  assert.deepEqual([publicH.score, publicH.level, publicH.nearStatic, publicH.latestStatus], [taught.H.score, taught.H.level, true, 'alarm_palsu']);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM static_sources WHERE kind = 'alarm_palsu'")).rows[0].n, 3, 'the real ones of E, H and L');
});
