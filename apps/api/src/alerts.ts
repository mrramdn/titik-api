import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { authenticated } from './auth.js';
import { transaction } from './db.js';
import { integer, object, requireCondition, text, uuid } from './errors.js';
import { cardText } from './geo.js';
import { cardIncident, incidentModel, incidentSelect } from './incidents.js';
import { pushAlerts, pushEnabled, vapidPublicKey, type Sender } from './push.js';

export function installAlerts(app: FastifyInstance, pool: pg.Pool, send?: Sender) {
  app.get('/api/v1/me/subscriptions', async request => {
    const user = authenticated(request);
    const result = await pool.query(`SELECT s.village_id, s.radius_km, v.name, v.district, v.peat_share FROM subscriptions s JOIN villages v ON v.id = s.village_id
      WHERE s.user_id = $1 ORDER BY v.name`, [user.id]);
    return { data: result.rows.map(row => ({ villageId: row.village_id, radiusKm: row.radius_km, name: row.name, district: row.district, peatShare: Number(row.peat_share) })) };
  });

  app.put('/api/v1/me/subscriptions', async request => {
    const user = authenticated(request, 'mpa', 'kades', 'bpbd');
    const body = object(request.body);
    requireCondition(Array.isArray(body.villages) && body.villages.length <= 20, 400, 'INVALID_INPUT', 'Desa pantauan paling banyak 20. Hapus sebagian desa.');
    const items = (body.villages as unknown[]).map(item => {
      const value = object(item);
      return { villageId: text(value.villageId, 'Desa', 3, 32), radiusKm: value.radiusKm === undefined ? 0 : integer(value.radiusKm, 'Radius', 0, 10) };
    });
    const known = await pool.query('SELECT id FROM villages WHERE id = ANY($1::text[])', [items.map(item => item.villageId)]);
    requireCondition(known.rowCount === new Set(items.map(item => item.villageId)).size, 400, 'INVALID_INPUT', 'Ada desa yang tidak dikenal. Pilih desa dari daftar.');
    await transaction(pool, async client => {
      await client.query('DELETE FROM subscriptions WHERE user_id = $1', [user.id]);
      for (const item of items) await client.query('INSERT INTO subscriptions (user_id, village_id, radius_km) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [user.id, item.villageId, item.radiusKm]);
    });
    // A new village brings in what is already burning there, so the inbox is right at once.
    const recent = await pool.query("SELECT id FROM incidents WHERE last_detected_at > now() - interval '48 hours'");
    const { alertSubscribers } = await import('./ingest.js');
    const created = (await alertSubscribers(pool, recent.rows.map(row => row.id))).filter(alert => alert.userId === user.id);
    return { data: { saved: items.length, newAlerts: created.length } };
  });

  app.get('/api/v1/me/alerts', async request => {
    const user = authenticated(request);
    const result = await pool.query(`SELECT a.id AS alert_id, a.created_at AS alert_created, a.updated_at AS alert_updated, a.read_at, a.shared_at,
        s.id AS ref_id, s.name AS ref_name, inc.*
      FROM alerts a JOIN villages s ON s.id = a.village_id JOIN (${incidentSelect}) inc ON inc.id = a.incident_id
      WHERE a.user_id = $1 ORDER BY (a.read_at IS NULL) DESC, (inc.first_verified_at IS NULL) DESC, (inc.level = 'tinggi') DESC, inc.last_detected_at DESC LIMIT 60`, [user.id]);
    return { data: result.rows.map(row => ({
      id: row.alert_id, createdAt: row.alert_created.toISOString(), updatedAt: row.alert_updated.toISOString(),
      readAt: row.read_at?.toISOString() ?? null, sharedAt: row.shared_at?.toISOString() ?? null,
      village: { id: row.ref_id, name: row.ref_name },
      card: cardText(cardIncident(row)),
      incident: incidentModel(row),
    })), meta: { unread: result.rows.filter(row => !row.read_at).length } };
  });

  for (const action of ['read', 'shared'] as const) {
    app.post(`/api/v1/me/alerts/:id/${action}`, async request => {
      const user = authenticated(request);
      const id = uuid(object(request.params).id);
      const result = await pool.query(`UPDATE alerts SET ${action === 'read' ? 'read_at = COALESCE(read_at, now())' : 'shared_at = now(), read_at = COALESCE(read_at, now())'}
        WHERE id = $1 AND user_id = $2 RETURNING id`, [id, user.id]);
      requireCondition(result.rowCount, 404, 'NOT_FOUND', 'Peringatan tidak ditemukan. Muat ulang daftar peringatan.');
      return { data: { id, [action]: true } };
    });
  }

  app.get('/api/v1/push/public-key', async () => ({ data: { enabled: pushEnabled() || Boolean(send), publicKey: vapidPublicKey() } }));
  app.post('/api/v1/me/push', async request => {
    const user = authenticated(request);
    const body = object(request.body);
    const endpoint = text(body.endpoint, 'Endpoint', 10, 2000);
    requireCondition(endpoint.startsWith('https://'), 400, 'INVALID_INPUT', 'Alamat notifikasi tidak valid. Aktifkan ulang notifikasi.');
    const keys = object(body.keys);
    await pool.query(`INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth) VALUES ($1, $2, $3, $4)
      ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [endpoint, user.id, text(keys.p256dh, 'Kunci', 10, 200), text(keys.auth, 'Kunci', 4, 100)]);
    return { data: { subscribed: true } };
  });
  app.delete('/api/v1/me/push', async request => {
    const user = authenticated(request);
    const endpoint = text(object(request.body).endpoint, 'Endpoint', 10, 2000);
    await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [endpoint, user.id]);
    return { data: { subscribed: false } };
  });
  // Sends the newest alert again as a notification, so anyone can see push working without waiting for a satellite.
  app.post('/api/v1/me/push/test', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async request => {
    const user = authenticated(request);
    const latest = await pool.query('SELECT id FROM alerts WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1', [user.id]);
    requireCondition(latest.rows[0], 404, 'NO_ALERTS', 'Belum ada peringatan untuk dikirim. Pilih desa pantauan di Desa saya.');
    const delivered = await pushAlerts(pool, [latest.rows[0].id], send);
    requireCondition(delivered > 0, 409, 'NO_DEVICE', 'Notifikasi belum aktif di perangkat ini. Aktifkan notifikasi lalu coba lagi.');
    return { data: { delivered } };
  });
}
