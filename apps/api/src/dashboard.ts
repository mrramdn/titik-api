import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { authenticated } from './auth.js';
import { choice, object } from './errors.js';
import { confidenceLabel, falseAlarmLabel, formatWib, satelliteLabel, statusLabel } from './geo.js';
import { regionFilter } from './incidents.js';

const ranges = { '24h': '24 hours', '7d': '7 days' } as const;
const rangeOf = (query: unknown) => ranges[choice(object(query ?? {}).range ?? '24h', ['24h', '7d'] as const, 'Rentang')];
const OPEN = `('ditugaskan', 'menuju')`;
export const assignmentStatuses = ['ditugaskan', 'menuju', 'selesai', 'dibatalkan'] as const;
/** Every status with its count, zero included. */
export const countByStatus = (rows: { status: string; count: number }[]) =>
  Object.fromEntries(assignmentStatuses.map(status => [status, rows.find(row => row.status === status)?.count ?? 0])) as Record<(typeof assignmentStatuses)[number], number>;

// What an agency needs at a glance: how many incidents, how many were checked on the ground, how fast, which
// high-priority ones nobody has checked or been sent to yet, and the tasks under way. Every number uses the same
// incidents (detected in the chosen range, inside the chosen region), so the counts never contradict each other.
// The median runs from the satellite pass to the first field check, so it includes the hours FIRMS needs to
// publish a detection.
export function installDashboard(app: FastifyInstance, pool: pg.Pool) {
  app.get('/api/v1/dashboard', async request => {
    authenticated(request, 'bpbd');
    const range = rangeOf(request.query);
    const rp: unknown[] = [range];
    const where = regionFilter(object(request.query ?? {}), rp);
    const scope = `FROM incidents i JOIN villages v ON v.id = i.village_id
      LEFT JOIN (SELECT DISTINCT incident_id FROM assignments WHERE status IN ${OPEN}) t ON t.incident_id = i.id
      WHERE i.last_detected_at > now() - $1::interval${where}`;
    const summary = (await pool.query(`SELECT count(*)::integer AS incidents,
        count(*) FILTER (WHERE i.first_verified_at IS NOT NULL)::integer AS verified,
        count(*) FILTER (WHERE i.level = 'tinggi')::integer AS high,
        count(*) FILTER (WHERE i.level = 'tinggi' AND i.first_verified_at IS NULL)::integer AS open_high,
        count(*) FILTER (WHERE i.level = 'tinggi' AND i.first_verified_at IS NULL AND t.incident_id IS NULL)::integer AS needs_action,
        count(*) FILTER (WHERE t.incident_id IS NOT NULL)::integer AS assigned,
        count(*) FILTER (WHERE i.latest_status = 'alarm_palsu')::integer AS false_alarms,
        count(*) FILTER (WHERE i.on_peat)::integer AS on_peat,
        count(*) FILTER (WHERE i.modis_only)::integer AS modis_only,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM i.first_verified_at - i.first_detected_at) / 60)
          FILTER (WHERE i.first_verified_at IS NOT NULL) AS median_minutes,
        COALESCE(sum(i.detection_count), 0)::integer AS detections
      ${scope}`, rp)).rows[0];
    const statuses = await pool.query(`SELECT i.latest_status AS status, count(*)::integer AS count ${scope} AND i.latest_status IS NOT NULL
      GROUP BY i.latest_status ORDER BY count DESC`, rp);
    const tasks = await pool.query(`SELECT a.status, count(*)::integer AS count FROM assignments a JOIN incidents i ON i.id = a.incident_id
      JOIN villages v ON v.id = i.village_id WHERE i.last_detected_at > now() - $1::interval${where} GROUP BY a.status`, rp);
    const villages = await pool.query(`SELECT v.id, v.name, v.district, v.regency, ST_X(v.center) AS lon, ST_Y(v.center) AS lat, count(i.id)::integer AS incidents,
        COALESCE(sum(i.detection_count), 0)::integer AS detections,
        count(i.id) FILTER (WHERE i.first_verified_at IS NOT NULL)::integer AS verified,
        count(i.id) FILTER (WHERE i.level = 'tinggi' AND i.first_verified_at IS NULL)::integer AS open_high,
        count(i.id) FILTER (WHERE t.incident_id IS NOT NULL)::integer AS assigned,
        max(i.score)::integer AS max_score, bool_or(i.on_peat) AS on_peat, max(i.last_detected_at) AS last_detected_at,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM i.first_verified_at - i.first_detected_at) / 60)
          FILTER (WHERE i.first_verified_at IS NOT NULL) AS median_minutes
      ${scope} GROUP BY v.id ORDER BY open_high DESC, max_score DESC, incidents DESC LIMIT 200`, rp);
    // The feed and the demo share follow the same incidents as the summary: detected in range, inside the chosen region.
    const recent = await pool.query(`SELECT r.id, r.status, r.false_alarm_kind, r.observed_at, r.received_at, r.distance_m, r.note, r.photo_thumb_url, r.is_demo,
        u.name AS reporter, i.id AS incident_id, i.first_detected_at, v.name AS village_name
      FROM verifications r JOIN users u ON u.id = r.user_id JOIN incidents i ON i.id = r.incident_id JOIN villages v ON v.id = i.village_id
      WHERE i.last_detected_at > now() - $1::interval${where} ORDER BY r.received_at DESC LIMIT 20`, rp);
    const demoShare = (await pool.query(`SELECT count(*)::integer AS total, count(*) FILTER (WHERE r.is_demo)::integer AS demo
      FROM verifications r JOIN incidents i ON i.id = r.incident_id JOIN villages v ON v.id = i.village_id
      WHERE i.last_detected_at > now() - $1::interval${where}`, rp)).rows[0];
    const median = (value: unknown) => (value === null ? null : Math.round(Number(value)));
    return { data: {
      range: object(request.query ?? {}).range ?? '24h',
      summary: { incidents: summary.incidents, verified: summary.verified, verifiedShare: summary.incidents ? summary.verified / summary.incidents : null,
        high: summary.high, openHigh: summary.open_high, needsAction: summary.needs_action, assigned: summary.assigned, falseAlarms: summary.false_alarms,
        onPeat: summary.on_peat, modisOnly: summary.modis_only, medianMinutesToVerification: median(summary.median_minutes), detections: summary.detections },
      assignments: countByStatus(tasks.rows),
      statuses: statuses.rows,
      villages: villages.rows.map(row => ({ id: row.id, name: row.name, district: row.district, regency: row.regency, center: [row.lon, row.lat], incidents: row.incidents,
        detections: row.detections, verified: row.verified, openHigh: row.open_high, assigned: row.assigned, maxScore: row.max_score, onPeat: row.on_peat,
        lastDetectedAt: row.last_detected_at.toISOString(), medianMinutesToVerification: median(row.median_minutes) })),
      recentVerifications: recent.rows.map(row => ({ id: row.id, status: row.status, falseAlarmKind: row.false_alarm_kind, observedAt: row.observed_at.toISOString(),
        receivedAt: row.received_at.toISOString(), distanceMeters: row.distance_m, note: row.note, photoThumbUrl: row.photo_thumb_url, demo: row.is_demo,
        reporter: row.reporter, incidentId: row.incident_id, villageName: row.village_name,
        minutesFromDetection: Math.round((row.observed_at.getTime() - row.first_detected_at.getTime()) / 60000) })),
      verificationsFromDemoAccounts: { total: demoShare.total, demo: demoShare.demo },
    } };
  });

  // Field reports in the shape of the SiPongi+ groundcheck form, so an agency can pass them on.
  app.get('/api/v1/export/groundcheck.csv', async (request, reply) => {
    authenticated(request, 'bpbd');
    const range = rangeOf(request.query);
    const rp: unknown[] = [range];
    const where = regionFilter(object(request.query ?? {}), rp);
    const rows = (await pool.query(`SELECT i.code, i.first_detected_at, i.detection_count, i.viirs_count, i.modis_count, i.satellites, i.best_confidence, i.max_frp,
        i.on_peat, i.score, i.level, ST_Y(i.centroid) AS lat, ST_X(i.centroid) AS lon, v.province, v.regency, v.district, v.name AS village,
        (SELECT max(confidence_pct) FROM detections WHERE incident_id = i.id AND satellite IN ('T', 'A')) AS modis_pct,
        r.status, r.false_alarm_kind, r.observed_at, r.latitude AS v_lat, r.longitude AS v_lon, r.distance_m, r.note, r.photo_url, r.is_demo
      FROM incidents i JOIN villages v ON v.id = i.village_id
      LEFT JOIN LATERAL (SELECT * FROM verifications WHERE incident_id = i.id ORDER BY observed_at LIMIT 1) r ON true
      WHERE i.last_detected_at > now() - $1::interval${where} ORDER BY i.first_detected_at`, rp)).rows;
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' });
    const origin = `${request.protocol}://${request.host}`;
    const header = ['id_kejadian', 'tanggal_deteksi', 'jam_deteksi_wib', 'provinsi', 'kabupaten', 'kecamatan', 'desa', 'lintang', 'bujur', 'satelit', 'sensor',
      'jumlah_deteksi', 'keyakinan', 'keyakinan_modis_pct', 'frp_maks_mw', 'di_gambut', 'skor_prioritas', 'prioritas', 'status_verifikasi', 'hotspot_palsu',
      'jenis_alarm_palsu', 'waktu_verifikasi_wib', 'menit_deteksi_ke_verifikasi', 'lintang_pemeriksa', 'bujur_pemeriksa', 'jarak_pemeriksa_m', 'keterangan',
      'foto', 'akun_demo'];
    const cell = (value: unknown) => { const s = value === null || value === undefined ? '' : String(value); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const sensor = (row: Record<string, any>) => [row.viirs_count > 0 ? 'VIIRS' : '', row.modis_count > 0 ? 'MODIS' : ''].filter(Boolean).join('+');
    const lines = rows.map(row => [row.code, date.format(row.first_detected_at), formatWib(row.first_detected_at), row.province, row.regency, row.district, row.village,
      row.lat.toFixed(5), row.lon.toFixed(5), row.satellites.map((s: string) => satelliteLabel[s] ?? s).join('/'), sensor(row), row.detection_count,
      confidenceLabel[row.best_confidence] ?? '', row.modis_pct ?? '', row.max_frp ?? '', row.on_peat ? 'ya' : 'tidak', row.score, row.level,
      row.status ? statusLabel[row.status] : 'belum dicek', row.status ? (row.status === 'alarm_palsu' ? 'ya' : 'tidak') : '',
      row.false_alarm_kind ? falseAlarmLabel[row.false_alarm_kind] : '', row.observed_at ? `${date.format(row.observed_at)} ${formatWib(row.observed_at)}` : '',
      row.observed_at ? Math.round((row.observed_at.getTime() - row.first_detected_at.getTime()) / 60000) : '', row.v_lat ?? '', row.v_lon ?? '', row.distance_m ?? '',
      row.note ?? '', row.photo_url ? `${origin}${row.photo_url}` : '', row.status ? (row.is_demo ? 'ya' : 'tidak') : ''].map(cell).join(','));
    reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="titik-api-groundcheck-${date.format(new Date())}.csv"`);
    return '﻿' + [header.join(','), ...lines].join('\r\n') + '\r\n';
  });
}
