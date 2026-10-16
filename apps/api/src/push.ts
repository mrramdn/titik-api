// Web Push: an alert reaches a volunteer's phone without the app being open (Chrome on Android, desktop
// browsers, and iOS once the app is on the home screen). Keys come from the environment; without them push
// is off. Notifications stay Indonesian.
import webpush from 'web-push';
import type pg from 'pg';
import { cardText, formatCount } from './geo.js';
import { cardIncident, incidentSelect } from './incidents.js';

const publicKey = process.env.VAPID_PUBLIC_KEY ?? '';
const privateKey = process.env.VAPID_PRIVATE_KEY ?? '';
export const pushEnabled = () => Boolean(publicKey && privateKey);
if (pushEnabled()) webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? 'https://titik-api.mrramdn.com', publicKey, privateKey);
export const vapidPublicKey = () => publicKey;

export type Sender = (subscription: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => Promise<unknown>;
const defaultSender: Sender = (subscription, payload) => webpush.sendNotification(subscription, payload, { TTL: 6 * 3600, urgency: 'high' });

export interface Notification { title: string; body: string; url: string; tag: string }

/** Sends one notification to every browser of a user. Returns how many were delivered; dead subscriptions are removed. */
export async function pushToUser(pool: pg.Pool, userId: string, notification: Notification, send: Sender = defaultSender) {
  if (!pushEnabled() && send === defaultSender) return 0;
  const subscriptions = await pool.query('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1', [userId]);
  let delivered = 0;
  for (const subscription of subscriptions.rows) {
    try {
      await send({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify(notification));
      delivered++;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [subscription.endpoint]);
    }
  }
  return delivered;
}

/**
 * One notification per user for a batch of new alerts (one ingest run): the highest-scoring alert, with the
 * number of new alerts in the title when there is more than one. Returns how many were delivered.
 */
export async function pushAlerts(pool: pg.Pool, alertIds: string[], send: Sender = defaultSender) {
  if (!alertIds.length || (!pushEnabled() && send === defaultSender)) return 0;
  const rows = (await pool.query(`SELECT a.id AS alert_id, a.user_id, inc.*
    FROM alerts a JOIN (${incidentSelect}) inc ON inc.id = a.incident_id WHERE a.id = ANY($1::uuid[])
    ORDER BY a.user_id, inc.score DESC, inc.last_detected_at DESC`, [alertIds])).rows;
  const byUser = new Map<string, Record<string, any>[]>();
  for (const row of rows) byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row]);
  let delivered = 0;
  for (const [userId, alerts] of byUser) {
    const top = alerts[0]!;
    const village = top.village_name ? `Desa ${top.village_name}` : 'Desa pantauan';
    const title = alerts.length > 1 ? `${formatCount(alerts.length)} peringatan baru · ${village} dan ${formatCount(alerts.length - 1)} lainnya`
      : `Titik panas prioritas ${top.level} · ${village}`;
    delivered += await pushToUser(pool, userId, { title, body: cardText(cardIncident(top)), url: `/kejadian/${top.id}`, tag: top.id }, send);
  }
  return delivered;
}
