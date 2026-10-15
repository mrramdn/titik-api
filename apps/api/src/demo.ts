import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import type pg from 'pg';
import { createPool, transaction } from './db.js';
import { alertSubscribers, refreshIncidents } from './ingest.js';
import { refreshVerificationSummary } from './incidents.js';

// The shared demo accounts at titik-api.mrramdn.com. They are not official accounts of any agency. A reset
// keeps every real satellite detection and only takes back what the demo accounts did, then subscribes the
// volunteer to the villages where the satellites saw the most in the last three days, so there is always
// something real to check.

export const demoPassword = 'TitikApiDemo!26';
const user = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const demoAccounts = [
  { id: user(1), name: 'Regu MPA (demo)', email: 'mpa@titikapi.test', role: 'mpa', organization: 'Masyarakat Peduli Api · akun demo' },
  { id: user(2), name: 'Kepala Desa (demo)', email: 'kades@titikapi.test', role: 'kades', organization: 'Pemerintah desa · akun demo' },
  { id: user(3), name: 'Petugas BPBD/Daops (demo)', email: 'bpbd@titikapi.test', role: 'bpbd', organization: 'BPBD / Daops Manggala Agni · akun demo' },
] as const;
const [mpa, kades] = demoAccounts;

// Example field reports, written only on incidents that are already a day old and marked as demo everywhere.
const examples = [
  { status: 'asap_bara', minutes: 46, note: 'Contoh dari akun demo: asap tipis dan bara di tepi kanal.' },
  { status: 'api_aktif', minutes: 83, note: 'Contoh dari akun demo: api permukaan, regu meminta bantuan pompa.' },
  { status: 'bakar_terkendali', minutes: 131, note: 'Contoh dari akun demo: pembakaran sisa panen dijaga pemilik.' },
  { status: 'tidak_terjangkau', minutes: 64, note: 'Contoh dari akun demo: akses terputus kanal, dipantau dari jauh.' },
  { status: 'asap_bara', minutes: 212, note: 'Contoh dari akun demo: sisa bara setelah pemadaman awal.' },
] as const;

export async function resetDemo(pool: pg.Pool) {
  const passwordHash = await argon2.hash(demoPassword, { type: argon2.argon2id });
  const ids = demoAccounts.map(account => account.id);
  const affected = await transaction(pool, async client => {
    for (const account of demoAccounts) {
      await client.query('DELETE FROM users WHERE email = $1 AND id <> $2', [account.email, account.id]);
      await client.query(`INSERT INTO users (id, name, email, password_hash, role, organization) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, password_hash = EXCLUDED.password_hash, role = EXCLUDED.role,
          organization = EXCLUDED.organization`, [account.id, account.name, account.email, passwordHash, account.role, account.organization]);
    }
    const touched = (await client.query('SELECT DISTINCT incident_id FROM verifications WHERE user_id = ANY($1::uuid[])', [ids])).rows.map(row => row.incident_id as string);
    await client.query('DELETE FROM static_sources WHERE verification_id IN (SELECT id FROM verifications WHERE user_id = ANY($1::uuid[]))', [ids]);
    await client.query('DELETE FROM verifications WHERE user_id = ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM alerts WHERE user_id = ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM subscriptions WHERE user_id = ANY($1::uuid[])', [ids]);
    await client.query(`UPDATE detections d SET near_static = EXISTS (SELECT 1 FROM static_sources s WHERE (s.expires_at IS NULL OR s.expires_at > d.acq_at)
      AND ST_DWithin(s.geom::geography, d.geom::geography, s.radius_m)) WHERE d.incident_id = ANY($1::uuid[])`, [touched]);
    await refreshVerificationSummary(client, touched);

    let villages = (await client.query(`SELECT village_id FROM incidents WHERE village_id IS NOT NULL AND last_detected_at > now() - interval '72 hours'
      GROUP BY village_id ORDER BY count(*) DESC, max(score) DESC, village_id LIMIT 5`)).rows.map(row => row.village_id as string);
    if (villages.length < 5) villages = [...new Set([...villages, ...(await client.query(`SELECT village_id FROM incidents WHERE village_id IS NOT NULL
      GROUP BY village_id ORDER BY max(last_detected_at) DESC LIMIT 5`)).rows.map(row => row.village_id as string)])].slice(0, 5);
    if (villages.length < 5) villages = [...new Set([...villages, ...(await client.query('SELECT id FROM villages ORDER BY peat_share DESC, id LIMIT 5')).rows.map(row => row.id as string)])].slice(0, 5);
    for (const village of villages.slice(0, 4)) await client.query('INSERT INTO subscriptions (user_id, village_id, radius_km) VALUES ($1, $2, 1)', [mpa.id, village]);
    if (villages[0]) await client.query('INSERT INTO subscriptions (user_id, village_id, radius_km) VALUES ($1, $2, 0)', [kades.id, villages[0]]);

    const candidates = (await client.query(`SELECT DISTINCT ON (village_id) id, first_detected_at, ST_X(centroid) AS lon, ST_Y(centroid) AS lat FROM incidents
      WHERE village_id IS NOT NULL AND first_verified_at IS NULL AND first_detected_at BETWEEN now() - interval '72 hours' AND now() - interval '20 hours'
      ORDER BY village_id, score DESC`)).rows.sort((a, b) => b.first_detected_at - a.first_detected_at).slice(0, examples.length);
    for (const [index, incident] of candidates.entries()) {
      const example = examples[index]!;
      await client.query(`INSERT INTO verifications (incident_id, user_id, client_uuid, status, note, latitude, longitude, accuracy_m, distance_m, observed_at, received_at, is_demo)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 12, 140, $8, $8, true)`,
      [incident.id, mpa.id, randomUUID(), example.status, example.note, incident.lat - 0.0009, incident.lon - 0.0009,
        new Date(incident.first_detected_at.getTime() + example.minutes * 60_000)]);
    }
    const seeded = candidates.map(candidate => candidate.id as string);
    await refreshVerificationSummary(client, seeded);
    const recent = (await client.query("SELECT id FROM incidents WHERE last_detected_at > now() - interval '24 hours'")).rows.map(row => row.id as string);
    await alertSubscribers(client, recent);
    return touched;
  });
  if (affected.length) await refreshIncidents(pool, affected);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href && process.argv[2] === 'reset') {
  const pool = createPool();
  try { await resetDemo(pool); console.log('Demo accounts reset. Satellite data kept.'); }
  finally { await pool.end(); }
}
