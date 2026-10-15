import { randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import sharp from 'sharp';
import { authenticated } from './auth.js';
import { transaction } from './db.js';
import { ApiError, choice, object, requireCondition, text, uuid } from './errors.js';
import { falseAlarmLabel } from './geo.js';
import { getIncident, refreshVerificationSummary } from './incidents.js';

export const statuses = ['api_aktif', 'asap_bara', 'bakar_terkendali', 'alarm_palsu', 'tidak_terjangkau'] as const;
const falseAlarmKinds = ['industri', 'pembakaran_sampah', 'lainnya'] as const;

function imageExtension(buffer: Buffer) {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'jpg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}

/** Reads the report from a multipart form (with an optional photo) or from JSON. */
async function readReport(request: FastifyRequest) {
  if (!request.isMultipart()) return { fields: object(request.body) as Record<string, unknown>, photo: null as Buffer | null };
  const fields: Record<string, unknown> = {};
  let photo: Buffer | null = null;
  for await (const part of request.parts()) {
    if (part.type === 'file') {
      requireCondition(part.fieldname === 'photo' && !photo, 400, 'INVALID_INPUT', 'Kirim satu foto saja.');
      photo = await part.toBuffer();
    } else fields[part.fieldname] = part.value;
  }
  return { fields, photo };
}

const optionalNumber = (value: unknown, name: string, min: number, max: number) => {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  requireCondition(Number.isFinite(number) && number >= min && number <= max, 400, 'INVALID_INPUT', `${name} tidak valid.`);
  return number;
};

export function installVerifications(app: FastifyInstance, pool: pg.Pool, uploadsDir: string) {
  app.post('/api/v1/incidents/:id/verifications', async (request, reply) => {
    const user = authenticated(request, 'mpa');
    const incident = await getIncident(pool, String(object(request.params).id));
    const { fields, photo } = await readReport(request);
    const clientUuid = uuid(fields.clientUuid);
    // The same report sent again after a lost connection is answered with the first copy.
    const existing = await pool.query('SELECT id, incident_id FROM verifications WHERE client_uuid = $1', [clientUuid]);
    if (existing.rows[0]) {
      requireCondition(existing.rows[0].incident_id === incident.id, 409, 'CONFLICT', 'ID laporan sudah dipakai untuk kejadian lain.');
      return { data: { id: existing.rows[0].id, duplicate: true } };
    }
    const status = choice(fields.status, statuses, 'Status');
    const falseAlarmKind = status === 'alarm_palsu' ? choice(fields.falseAlarmKind ?? 'lainnya', falseAlarmKinds, 'Jenis alarm palsu') : null;
    const note = fields.note === undefined || fields.note === '' ? '' : text(fields.note, 'Catatan', 0, 600);
    const latitude = optionalNumber(fields.latitude, 'Lintang', -90, 90);
    const longitude = optionalNumber(fields.longitude, 'Bujur', -180, 180);
    requireCondition((latitude === null) === (longitude === null), 400, 'INVALID_INPUT', 'Koordinat harus lengkap.');
    const accuracy = optionalNumber(fields.accuracyM, 'Akurasi', 0, 100_000);
    const observedAt = new Date(text(fields.observedAt, 'Waktu pemeriksaan', 10, 40));
    requireCondition(!Number.isNaN(observedAt.getTime()), 400, 'INVALID_INPUT', 'Waktu pemeriksaan tidak valid.');
    requireCondition(observedAt.getTime() <= Date.now() + 5 * 60_000, 400, 'INVALID_INPUT', 'Waktu pemeriksaan tidak boleh di masa depan.');
    requireCondition(observedAt.getTime() >= incident.first_detected_at.getTime() - 60 * 60_000, 400, 'INVALID_INPUT', 'Waktu pemeriksaan sebelum titik panas terdeteksi.');

    let photoUrl: string | null = null, thumbUrl: string | null = null;
    const written: string[] = [];
    if (photo) {
      requireCondition(imageExtension(photo), 400, 'INVALID_IMAGE', 'Foto harus JPEG, PNG, atau WebP.');
      // Re-encoding proves the bytes are a picture and drops what the camera adds, the GPS position included:
      // the location of a report is the one the volunteer chose to send, nothing more.
      const encode = (size: number, quality: number) => sharp(photo, { limitInputPixels: 50_000_000 }).rotate()
        .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true }).jpeg({ quality, mozjpeg: true }).toBuffer();
      const [full, thumb] = await Promise.all([encode(1600, 80), encode(480, 74)]).catch(() => { throw new ApiError(400, 'INVALID_IMAGE', 'Foto tidak bisa dibaca. Coba foto lain.'); });
      const name = randomUUID();
      await writeFile(join(uploadsDir, `${name}.jpg`), full, { flag: 'wx' });
      await writeFile(join(uploadsDir, `${name}.thumb.jpg`), thumb, { flag: 'wx' });
      written.push(join(uploadsDir, `${name}.jpg`), join(uploadsDir, `${name}.thumb.jpg`));
      photoUrl = `/uploads/${name}.jpg`; thumbUrl = `/uploads/${name}.thumb.jpg`;
    }
    try {
      const id = await transaction(pool, async client => {
        const inserted = await client.query(`INSERT INTO verifications (incident_id, user_id, client_uuid, status, false_alarm_kind, note, latitude, longitude, accuracy_m,
            distance_m, observed_at, photo_url, photo_thumb_url, is_demo)
          SELECT $1, $2, $3, $4, $5, $6, $7::float8, $8::float8, $9,
            CASE WHEN $7::float8 IS NULL THEN NULL ELSE round(ST_Distance(ST_SetSRID(ST_MakePoint($8::float8, $7::float8), 4326)::geography, i.centroid::geography))::integer END,
            $10, $11, $12, $13 FROM incidents i WHERE i.id = $1
          ON CONFLICT (client_uuid) DO NOTHING RETURNING id`,
        [incident.id, user.id, clientUuid, status, falseAlarmKind, note, latitude, longitude, accuracy, observedAt, photoUrl, thumbUrl, user.demo]);
        requireCondition(inserted.rows[0], 409, 'CONFLICT', 'Laporan ini sudah diterima.');
        await refreshVerificationSummary(client, [incident.id]);
        // A verified false alarm teaches the triage: later detections at the same spot are flagged for 30 days.
        if (status === 'alarm_palsu') {
          await client.query(`INSERT INTO static_sources (kind, label, geom, radius_m, verification_id, expires_at)
            SELECT 'alarm_palsu', $2, centroid, 375, $3, now() + interval '30 days' FROM incidents WHERE id = $1`,
          [incident.id, `Alarm palsu terverifikasi (${falseAlarmLabel[falseAlarmKind!]})`, inserted.rows[0].id]);
          await client.query('UPDATE incidents SET near_static = true WHERE id = $1', [incident.id]);
        }
        return inserted.rows[0].id as string;
      });
      if (status === 'alarm_palsu') {
        const { refreshIncidents } = await import('./ingest.js');
        await pool.query(`UPDATE detections d SET near_static = true WHERE d.incident_id = $1`, [incident.id]);
        await refreshIncidents(pool, [incident.id]);
      }
      reply.code(201);
      return { data: { id, duplicate: false } };
    } catch (error) {
      for (const file of written) await unlink(file).catch(() => {});
      throw error;
    }
  });
}
