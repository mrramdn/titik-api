// The core flow end to end against a running server, as the three roles would do it:
// BPBD assigns a high-priority incident to the demo squad, the squad heads out and files a field check,
// the incident moves to "checked", its task closes, and the daily recap counts it.
//   node e2e/judge-path.mjs [baseUrl]
// Writes demo data (tagged "demo"); the nightly demo reset removes it.
import { request } from 'playwright-core';
import { randomUUID } from 'node:crypto';

const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
const steps = [];
const check = (ok, label, detail = '') => { steps.push(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` · ${detail}` : ''}`); if (!ok) throw new Error(label); };
const as = async role => {
  const context = await request.newContext({ baseURL: base, extraHTTPHeaders: { origin: base } });
  const signIn = await context.post('/api/v1/auth/demo', { data: { role, client: 'web' } });
  check(signIn.ok(), `sign in as ${role}`, String(signIn.status()));
  return context;
};
const json = async response => (await response.json()).data;

try {
  const bpbd = await as('bpbd');
  const open = await json(await bpbd.get('/api/v1/incidents?hours=72&level=tinggi&status=open&sort=priority&limit=20'));
  check(Array.isArray(open) && open.length > 0, 'BPBD sees high-priority incidents that need action', `${open?.length ?? 0}`);
  const incident = open.find(item => item.village) ?? open[0];

  const assignees = await json(await bpbd.get(`/api/v1/assignees?incident=${incident.id}`));
  const squad = assignees.find(item => /demo/i.test(item.name)) ?? assignees[0];
  check(Boolean(squad), 'a squad can take the task', squad ? `${squad.name}${squad.distanceM !== null ? `, ${Math.round(squad.distanceM / 100) / 10} km` : ''}` : 'none');
  const assigned = await bpbd.post(`/api/v1/incidents/${incident.id}/assignments`, { data: { assigneeId: squad.id, note: 'Cek dari judge-path' } });
  check(assigned.ok(), 'BPBD assigns the incident', String(assigned.status()));
  const again = await bpbd.post(`/api/v1/incidents/${incident.id}/assignments`, { data: { assigneeId: squad.id } });
  check(again.status() === 409, 'a second open task on the same incident is refused', String(again.status()));

  const mpa = await as('mpa');
  const tasks = await json(await mpa.get('/api/v1/me/assignments'));
  const task = tasks.find(item => item.incident?.id === incident.id);
  if (/demo/i.test(squad.name)) {
    check(Boolean(task), 'the volunteer sees the task');
    const enroute = await mpa.patch(`/api/v1/assignments/${task.id}`, { data: { status: 'menuju' } });
    check(enroute.ok(), 'the volunteer marks "on the way"', String(enroute.status()));
  }
  const [lon, lat] = incident.centroid;
  const report = await mpa.post(`/api/v1/incidents/${incident.id}/verifications`, { data: {
    clientUuid: randomUUID(), status: 'asap_bara', note: 'Cek dari judge-path', latitude: lat - 0.002, longitude: lon - 0.002, accuracyM: 12, observedAt: new Date().toISOString() } });
  check(report.ok(), 'the volunteer files a field check', String(report.status()));

  const detail = await json(await bpbd.get(`/api/v1/incidents/${incident.id}`));
  check(Boolean(detail.firstVerifiedAt), 'the incident is checked');
  check(detail.assignment?.status === 'selesai', 'the field check closes the task', detail.assignment?.status ?? 'no task');
  const kinds = (detail.timeline ?? []).map(event => event.kind);
  check(kinds.includes('assigned') && kinds.includes('checked'), 'the timeline shows the assignment and the check', kinds.join(', '));
  const checked = await json(await bpbd.get('/api/v1/incidents?hours=72&status=checked&sort=recent&limit=50'));
  check(checked.some(item => item.id === incident.id), 'the incident moves to the "Selesai" lane');
  const stillOpen = await json(await bpbd.get('/api/v1/incidents?hours=72&level=tinggi&status=open&limit=500'));
  check(!stillOpen.some(item => item.id === incident.id), 'and leaves "Perlu tindakan"');

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  const recap = await json(await bpbd.get(`/api/v1/recap?date=${today}`));
  check(recap.assignments.selesai >= 1 && recap.totals.checked >= 1, 'the daily recap counts the check and the closed task', `selesai ${recap.assignments.selesai}, dicek ${recap.totals.checked}`);
  console.log(steps.join('\n'));
  console.log('judge path ok');
} catch (error) {
  console.log(steps.join('\n'));
  console.error(`judge path failed: ${error.message}`);
  process.exitCode = 1;
}
