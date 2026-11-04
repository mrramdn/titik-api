// The daily recap for BPBD/Daops. Incidents, regencies and villages count the incidents first detected on one WIB day
// (how many were checked so far and how fast); field check results and tasks count what was done on that day,
// whenever the incident was first seen. Indicated hot areas stay per incident: added up they read as burned area. Field
// checks and tasks are those of the viewer's scope: a demo session also counts demo ones.
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { authenticated } from './auth.js';
import { object, requireCondition } from './errors.js';
import { countByStatus } from './dashboard.js';
import { optionalText, scopeOf, scopeSql, type Scope } from './incidents.js';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
const stats = (scope: Scope) => {
  const verified = scopeSql(scope).firstVerified(), latest = scopeSql(scope).latestStatus();
  return `count(*)::integer AS incidents,
  count(*) FILTER (WHERE i.level = 'tinggi')::integer AS high,
  count(*) FILTER (WHERE ${verified} IS NOT NULL)::integer AS checked,
  count(*) FILTER (WHERE i.level = 'tinggi' AND ${verified} IS NULL)::integer AS open_high,
  count(*) FILTER (WHERE ${latest} = 'alarm_palsu')::integer AS false_alarms,
  COALESCE(sum(i.detection_count), 0)::integer AS detections,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM ${verified} - i.first_detected_at) / 60)
    FILTER (WHERE ${verified} IS NOT NULL) AS median`;
};
/** SQL: the column falls on the WIB day in $1. */
const within = (column: string) => `${column} >= ($1::date::timestamp AT TIME ZONE 'Asia/Jakarta') AND ${column} < (($1::date + 1)::timestamp AT TIME ZONE 'Asia/Jakarta')`;
const median = (value: unknown) => (value === null || value === undefined ? null : Math.round(Number(value)));

export function installRecap(app: FastifyInstance, pool: pg.Pool) {
  app.get('/api/v1/recap', async request => {
    authenticated(request, 'bpbd');
    const query = object(request.query ?? {});
    const date = query.date === undefined || query.date === '' ? today() : String(query.date);
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null;
    requireCondition(parsed && !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(date), 400, 'INVALID_INPUT',
      'Tanggal tidak valid. Tulis tanggal sebagai TTTT-BB-HH.');
    const province = optionalText(query.province);
    const params: unknown[] = [date, ...(province ? [province] : [])];
    const viewer = scopeOf(request), s = scopeSql(viewer);
    const scope = `JOIN villages v ON v.id = i.village_id
      WHERE i.first_detected_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Jakarta') AND i.first_detected_at < (($1::date + 1)::timestamp AT TIME ZONE 'Asia/Jakarta')
      ${province ? 'AND v.province = $2' : ''}`;
    // One query at a time: the recap holds one place at the gate for heavy reads, so it uses one connection, not five.
    const totals = await pool.query(`SELECT ${stats(viewer)} FROM incidents i ${scope}`, params);
    const regencies = await pool.query(`SELECT v.regency AS name, min(v.province) AS province, ${stats(viewer)} FROM incidents i ${scope}
      GROUP BY v.regency ORDER BY open_high DESC, incidents DESC, v.regency`, params);
    const villages = await pool.query(`SELECT v.id, min(v.name) AS name, min(v.district) AS district, min(v.regency) AS regency, ${stats(viewer)} FROM incidents i ${scope}
      GROUP BY v.id ORDER BY incidents DESC, detections DESC, min(v.name) LIMIT 15`, params);
    const checks = await pool.query(`SELECT r.status, count(*)::integer AS count FROM verifications r JOIN incidents i ON i.id = r.incident_id JOIN villages v ON v.id = i.village_id
      WHERE ${within('r.observed_at')}${s.rows('r')} ${province ? 'AND v.province = $2' : ''} GROUP BY r.status`, params);
    const tasks = await pool.query(`SELECT a.status, count(*)::integer AS count FROM assignments a JOIN incidents i ON i.id = a.incident_id JOIN villages v ON v.id = i.village_id
      WHERE (${within('a.created_at')} OR ${within('a.closed_at')})${s.rows('a')} ${province ? 'AND v.province = $2' : ''} GROUP BY a.status`, params);
    const t = totals.rows[0];
    return { data: {
      date, province,
      totals: { incidents: t.incidents, high: t.high, checked: t.checked, checkedShare: t.incidents ? t.checked / t.incidents : null,
        medianMinutes: median(t.median), falseAlarms: t.false_alarms, detections: t.detections },
      regencies: regencies.rows.map(row => ({ name: row.name, province: row.province, incidents: row.incidents, high: row.high, checked: row.checked,
        openHigh: row.open_high, medianMinutes: median(row.median) })),
      villages: villages.rows.map(row => ({ id: row.id, name: row.name, district: row.district, regency: row.regency, incidents: row.incidents, high: row.high,
        checked: row.checked, detections: row.detections })),
      checks: Object.fromEntries(checks.rows.map(row => [row.status, row.count])),
      assignments: countByStatus(tasks.rows),
    } };
  });
}
