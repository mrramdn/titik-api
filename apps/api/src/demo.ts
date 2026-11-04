import { randomBytes, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import type pg from 'pg';
import { createPool, transaction } from './db.js';
import { alertSubscribers, refreshIncidents } from './ingest.js';
import { clearTileCache, refreshVerificationSummary, repairVerificationSummaries } from './incidents.js';
import { demoDomain } from './models.js';
import { deleteUploads, uploadsDirectory } from './uploads.js';

// The shared demo accounts at titik-api.mrramdn.com. They are not official accounts of any agency. What they do stays
// in the demo scope: only demo sessions see their field checks and tasks (see Scope in incidents.ts). A reset keeps
// every real satellite detection and only takes back what the demo accounts did (field checks and their photos, tasks,
// alerts, watched villages and push subscriptions), then subscribes the squads to the villages where the satellites saw
// the most in the last three days, so there is always something real to check, and adds a few example checks and tasks
// marked as demo.

export const demoPassword = 'TitikApiDemo!26';
const user = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const squadOrganization = 'Masyarakat Peduli Api (MPA) · akun demo';
/** The three accounts anyone can open with POST /auth/demo. */
export const demoAccounts = [
  { id: user(1), name: 'Regu MPA Sungai Menang (demo)', email: 'mpa@titikapi.test', role: 'mpa', organization: squadOrganization },
  { id: user(2), name: 'Kepala Desa (demo)', email: 'kades@titikapi.test', role: 'kades', organization: 'Pemerintah desa · akun demo' },
  { id: user(3), name: 'Petugas BPBD/Daops (demo)', email: 'bpbd@titikapi.test', role: 'bpbd', organization: 'BPBD dan Daops Manggala Agni · akun demo' },
] as const;
/** Two more squads that tasks can go to. Nobody signs in as them: their password is random and /auth/demo opens only the three above. */
export const demoSquads = [
  { id: user(4), name: 'Regu MPA Pedamaran (demo)', email: 'regu-pedamaran@titikapi.test', role: 'mpa', organization: squadOrganization, district: 'Pedamaran' },
  { id: user(5), name: 'Regu MPA Cengal (demo)', email: 'regu-cengal@titikapi.test', role: 'mpa', organization: squadOrganization, district: 'Cengal' },
] as const;
const [mpa, kades, bpbd] = demoAccounts;

// Example field reports, written only on incidents that are already a day old and marked as demo everywhere.
const examples = [
  { status: 'asap_bara', minutes: 46, note: 'Contoh dari akun demo. Asap tipis dan bara di tepi kanal.' },
  { status: 'api_aktif', minutes: 83, note: 'Contoh dari akun demo. Api permukaan, regu meminta bantuan pompa.' },
  { status: 'bakar_terkendali', minutes: 131, note: 'Contoh dari akun demo. Pembakaran sisa panen dijaga pemilik lahan.' },
  { status: 'tidak_terjangkau', minutes: 64, note: 'Contoh dari akun demo. Akses terputus kanal, lokasi dipantau dari jauh.' },
  { status: 'asap_bara', minutes: 212, note: 'Contoh dari akun demo. Sisa bara setelah pemadaman awal.' },
] as const;

/** An open incident (no check, no open task of any scope) from the last 24 hours, high priority first, preferring the given villages. */
async function openIncident(client: pg.PoolClient, villages: string[], exclude: string[]) {
  return (await client.query(`SELECT i.id FROM incidents i JOIN villages v ON v.id = i.village_id
    WHERE i.first_verified_any_at IS NULL AND i.last_detected_at > now() - interval '24 hours' AND NOT (i.id = ANY($2::uuid[]))
      AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.incident_id = i.id AND a.status IN ('ditugaskan', 'menuju'))
    ORDER BY (i.village_id = ANY($1::text[])) DESC, (i.level = 'tinggi') DESC, (v.regency = 'Ogan Komering Ilir') DESC, i.score DESC, i.id
    LIMIT 1`, [villages, exclude])).rows[0]?.id as string | undefined;
}

/**
 * Starts the demo over. `uploadsDir` is the photo folder of the server (UPLOAD_DIR); the photos of the demo field checks
 * are deleted from it once the database is reset, so a failed reset never leaves a report without its photo.
 */
export async function resetDemo(pool: pg.Pool, uploadsDir = uploadsDirectory()) {
  const passwordHash = await argon2.hash(demoPassword, { type: argon2.argon2id });
  const lockedHash = await argon2.hash(randomBytes(32).toString('hex'), { type: argon2.argon2id });
  const accounts = [...demoAccounts.map(account => ({ ...account, hash: passwordHash })), ...demoSquads.map(account => ({ ...account, hash: lockedHash }))];
  const ids = accounts.map(account => account.id);
  const { rescore, photos } = await transaction(pool, async client => {
    for (const account of accounts) {
      await client.query('DELETE FROM users WHERE email = $1 AND id <> $2', [account.email, account.id]);
      await client.query(`INSERT INTO users (id, name, email, password_hash, role, organization) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, password_hash = EXCLUDED.password_hash, role = EXCLUDED.role,
          organization = EXCLUDED.organization`, [account.id, account.name, account.email, account.hash, account.role, account.organization]);
    }
    // Demo field checks and tasks: those of these accounts and any other row marked as demo.
    const demoChecks = 'is_demo OR user_id = ANY($1::uuid[])';
    const checks = (await client.query(`SELECT photo_url, photo_thumb_url FROM verifications WHERE ${demoChecks}`, [ids])).rows;
    // Demo false alarms filed before demo checks stopped teaching the triage left a fixed heat source. The detections it
    // may have flagged (every detection of its incident, and later ones within its radius) are found before it goes.
    // Nothing else is worked out again: a real false alarm flags every detection of its incident however far, so
    // measuring distances afresh on the incidents of demo checks would take back real triage.
    const flagged = (await client.query(`WITH s AS (SELECT s.geom, s.radius_m, c.incident_id FROM static_sources s JOIN verifications c ON c.id = s.verification_id
        WHERE c.is_demo OR c.user_id = ANY($1::uuid[]))
      SELECT d.id FROM s JOIN detections d ON d.incident_id = s.incident_id WHERE d.near_static
      UNION SELECT d.id FROM s JOIN detections d ON ST_DWithin(s.geom, d.geom, s.radius_m / 90000.0::float8) AND ST_DWithin(s.geom::geography, d.geom::geography, s.radius_m)
        WHERE d.near_static`, [ids])).rows.map(row => String(row.id));
    await client.query(`DELETE FROM static_sources WHERE verification_id IN (SELECT id FROM verifications WHERE ${demoChecks})`, [ids]);
    await client.query(`DELETE FROM verifications WHERE ${demoChecks}`, [ids]);
    await client.query('DELETE FROM assignments WHERE is_demo OR assignee_id = ANY($1::uuid[]) OR assigned_by = ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM alerts WHERE user_id = ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM subscriptions WHERE user_id = ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM push_subscriptions WHERE user_id = ANY($1::uuid[]) OR user_id IN (SELECT id FROM users WHERE email LIKE $2)', [ids, `%${demoDomain}`]);
    // Those detections lose the flag, unless a source that is left still covers them or a real false alarm flagged their
    // incident. Only incidents whose detections changed are scored again.
    const unflagged = (await client.query(`UPDATE detections d SET near_static = false WHERE d.id = ANY($1::bigint[])
        AND NOT EXISTS (SELECT 1 FROM static_sources s WHERE (s.expires_at IS NULL OR s.expires_at > d.acq_at) AND ST_DWithin(s.geom::geography, d.geom::geography, s.radius_m))
        AND NOT EXISTS (SELECT 1 FROM verifications v WHERE v.incident_id = d.incident_id AND v.status = 'alarm_palsu' AND NOT v.is_demo)
      RETURNING d.incident_id`, [flagged])).rows;
    const rescore = [...new Set(unflagged.map(row => row.incident_id as string | null).filter((id): id is string => Boolean(id)))];
    // The summaries of every incident whose checks they no longer follow are worked out again: those whose demo checks
    // just went, and any an older version left behind, such as the judged version's reset after a rollback, which
    // deleted demo checks but kept the demo session's summary of them (see reconcile.ts).
    await repairVerificationSummaries(client);

    // The demo squads and village head work in the pilot regency, Ogan Komering Ilir.
    const ranked = `SELECT i.village_id FROM incidents i JOIN villages v ON v.id = i.village_id
      WHERE v.regency = 'Ogan Komering Ilir' AND i.last_detected_at > now() - interval '72 hours'`;
    let villages = (await client.query(`${ranked} GROUP BY i.village_id ORDER BY count(*) DESC, max(i.score) DESC, i.village_id LIMIT 8`)).rows.map(row => row.village_id as string);
    if (villages.length < 4) villages = [...new Set([...villages, ...(await client.query(`SELECT village_id FROM incidents WHERE village_id IS NOT NULL
      GROUP BY village_id ORDER BY max(last_detected_at) DESC LIMIT 8`)).rows.map(row => row.village_id as string)])].slice(0, 8);
    if (villages.length < 4) villages = [...new Set([...villages, ...(await client.query('SELECT id FROM villages ORDER BY peat_share DESC, id LIMIT 8')).rows.map(row => row.id as string)])].slice(0, 8);
    const mine = villages.slice(0, 4);
    for (const village of mine) await client.query('INSERT INTO subscriptions (user_id, village_id, radius_km) VALUES ($1, $2, 1)', [mpa.id, village]);
    if (villages[0]) await client.query('INSERT INTO subscriptions (user_id, village_id, radius_km) VALUES ($1, $2, 0)', [kades.id, villages[0]]);
    // Each other squad watches burning villages of its own district when there are any, else the next busiest ones.
    const squadVillages = new Map<string, string[]>();
    for (const [index, squad] of demoSquads.entries()) {
      const own = (await client.query(`${ranked} AND v.district = $1 GROUP BY i.village_id ORDER BY count(*) DESC, i.village_id LIMIT 2`, [squad.district])).rows
        .map(row => row.village_id as string);
      const next = villages.slice(4 + index * 2, 6 + index * 2);
      const chosen = own.length ? own : next.length ? next : villages.slice(index, index + 1);
      squadVillages.set(squad.id, chosen);
      for (const village of chosen) await client.query('INSERT INTO subscriptions (user_id, village_id, radius_km) VALUES ($1, $2, 1) ON CONFLICT DO NOTHING', [squad.id, village]);
    }

    // Sample checks land on recent incidents, first in the demo volunteer's own villages, then in the OKI pilot. Like
    // every demo check they store the incident centre as their place and a rounded distance (see verifications.ts).
    const candidates = (await client.query(`SELECT DISTINCT ON (i.village_id) i.id, i.first_detected_at, ST_X(i.centroid) AS lon, ST_Y(i.centroid) AS lat,
        (i.village_id = ANY($1::text[]))::integer * 2 + (v.regency = 'Ogan Komering Ilir')::integer AS rank
      FROM incidents i JOIN villages v ON v.id = i.village_id
      WHERE i.first_verified_any_at IS NULL AND i.first_detected_at BETWEEN now() - interval '30 hours' AND now() - interval '4 hours'
      ORDER BY i.village_id, i.score DESC`, [villages])).rows
      .sort((a, b) => b.rank - a.rank || b.first_detected_at - a.first_detected_at).slice(0, examples.length);
    for (const [index, incident] of candidates.entries()) {
      const example = examples[index]!;
      await client.query(`INSERT INTO verifications (incident_id, user_id, client_uuid, status, note, latitude, longitude, accuracy_m, distance_m, observed_at, received_at, is_demo)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, 100, $8, $8, true)`,
      [incident.id, mpa.id, randomUUID(), example.status, example.note, incident.lat, incident.lon,
        new Date(incident.first_detected_at.getTime() + example.minutes * 60_000)]);
    }
    const seeded = candidates.map(candidate => candidate.id as string);
    await refreshVerificationSummary(client, seeded);

    // Two example tasks from the demo BPBD account: one waiting for the demo volunteer, one squad already on the way.
    const forVolunteer = await openIncident(client, mine, []);
    if (forVolunteer) {
      await client.query(`INSERT INTO assignments (incident_id, assignee_id, assigned_by, note, created_at, updated_at, is_demo)
        VALUES ($1, $2, $3, $4, now() - interval '35 minutes', now() - interval '35 minutes', true)`,
      [forVolunteer, mpa.id, bpbd.id, 'Contoh dari akun demo. Cek titik panas terdekat dari jalan desa dan kirim foto.']);
    }
    const squad = demoSquads[0];
    const forSquad = await openIncident(client, squadVillages.get(squad.id) ?? [], forVolunteer ? [forVolunteer] : []);
    if (forSquad) {
      await client.query(`INSERT INTO assignments (incident_id, assignee_id, assigned_by, status, note, created_at, enroute_at, updated_at, is_demo)
        VALUES ($1, $2, $3, 'menuju', $4, now() - interval '80 minutes', now() - interval '50 minutes', now() - interval '50 minutes', true)`,
      [forSquad, squad.id, bpbd.id, 'Contoh dari akun demo. Cek titik panas di tepi kanal dan laporkan kondisinya.']);
    }
    // Alerts for the demo accounts only; nobody else's inbox changes.
    const recent = (await client.query("SELECT id FROM incidents WHERE last_detected_at > now() - interval '24 hours'")).rows.map(row => row.id as string);
    await alertSubscribers(client, recent, { userIds: ids });
    return { rescore, photos: checks.flatMap(row => [row.photo_url as string | null, row.photo_thumb_url as string | null]) };
  });
  const photosDeleted = await deleteUploads(uploadsDir, photos);
  if (rescore.length) await refreshIncidents(pool, rescore);
  clearTileCache();
  return { photosDeleted };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href && process.argv[2] === 'reset') {
  const pool = createPool();
  try {
    const { photosDeleted } = await resetDemo(pool);
    console.log(`Demo accounts reset. Satellite data kept. Photo files deleted: ${photosDeleted}.`);
  } finally { await pool.end(); }
}
