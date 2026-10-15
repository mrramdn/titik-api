// Web Push: the card reaches a volunteer's phone without the app being open (Chrome on Android, desktop
// browsers, and iOS once the app is on the home screen). Keys come from the environment; without them push
// is simply off.
import webpush from 'web-push';
import type pg from 'pg';
import { cardText } from './geo.js';
import { cardIncident, incidentSelect } from './incidents.js';

const publicKey = process.env.VAPID_PUBLIC_KEY ?? '';
const privateKey = process.env.VAPID_PRIVATE_KEY ?? '';
export const pushEnabled = () => Boolean(publicKey && privateKey);
if (pushEnabled()) webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? 'https://titik-api.mrramdn.com', publicKey, privateKey);
export const vapidPublicKey = () => publicKey;

export type Sender = (subscription: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => Promise<unknown>;
const defaultSender: Sender = (subscription, payload) => webpush.sendNotification(subscription, payload, { TTL: 6 * 3600, urgency: 'high' });

/** Sends one notification per card to every browser of its owner. Returns how many were delivered. */
export async function pushAlerts(pool: pg.Pool, alertIds: string[], send: Sender = defaultSender) {
  if (!alertIds.length || (!pushEnabled() && send === defaultSender)) return 0;
  const rows = (await pool.query(`SELECT a.id AS alert_id, a.user_id, s.name AS ref_name, ST_X(s.center) AS ref_lon, ST_Y(s.center) AS ref_lat, inc.*
    FROM alerts a JOIN villages s ON s.id = a.village_id JOIN (${incidentSelect}) inc ON inc.id = a.incident_id WHERE a.id = ANY($1::uuid[])`, [alertIds])).rows;
  let delivered = 0;
  for (const row of rows) {
    const subscriptions = await pool.query('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1', [row.user_id]);
    if (!subscriptions.rowCount) continue;
    const body = cardText(cardIncident(row), { name: row.ref_name, center: [row.ref_lon, row.ref_lat] },
      row.village_name ? { name: row.village_name, center: [row.village_lon, row.village_lat] } : null);
    const payload = JSON.stringify({ title: `Titik panas · prioritas ${String(row.level).toUpperCase()} · Desa ${row.ref_name}`, body, url: `/kejadian/${row.id}`, tag: row.id });
    for (const subscription of subscriptions.rows) {
      try {
        await send({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload);
        delivered++;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [subscription.endpoint]);
      }
    }
  }
  return delivered;
}
