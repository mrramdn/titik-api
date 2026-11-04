// Rows an older version of the API wrote the old way are put right when the server starts, before any scheduled work
// reads them. The judged version (joints-2026) runs on this schema after a rollback, but it knows nothing of the demo
// scope (see migrations/011_demo_scope.sql): its tasks from demo accounts take is_demo's default of false, it counts
// demo field checks in the public summary and leaves the demo session's summary as it was, and it stores a demo
// visitor's position, accuracy and exact distance. After a roll-forward those rows would show to visitors as real
// until the nightly demo reset, and a summary its reset left behind would never clear.
import type pg from 'pg';
import { transaction } from './db.js';
import { clearTileCache, repairVerificationSummaries } from './incidents.js';
import { demoDomain } from './models.js';
import { roughDistanceSql } from './verifications.js';

const OPEN = `('ditugaskan', 'menuju')`;

/**
 * Puts the demo scope right. A task from or to a demo account stored as real becomes a demo task; one that would give
 * its incident a second open demo task is cancelled first. A demo check that kept the visitor's accuracy or an exact
 * distance gets the incident centre, no accuracy and a rounded distance, as demo checks are stored now. Every incident
 * whose field check summaries do not follow from its checks gets them worked out again. Cheap and idempotent: when
 * nothing is wrong it changes nothing. Returns how many tasks, checks and incidents it put right.
 */
export async function reconcileDemoScope(pool: pg.Pool) {
  const fixed = await transaction(pool, async client => {
    const demoTask = `NOT a.is_demo AND EXISTS (SELECT 1 FROM users u WHERE u.id IN (a.assigned_by, a.assignee_id) AND u.email LIKE $1)`;
    await client.query(`UPDATE assignments a SET status = 'dibatalkan', closed_at = now(), updated_at = now()
      WHERE ${demoTask} AND a.status IN ${OPEN}
        AND EXISTS (SELECT 1 FROM assignments o WHERE o.incident_id = a.incident_id AND o.is_demo AND o.status IN ${OPEN})`, [`%${demoDomain}`]);
    const tasks = (await client.query(`UPDATE assignments a SET is_demo = true WHERE ${demoTask}`, [`%${demoDomain}`])).rowCount ?? 0;
    const checks = (await client.query(`UPDATE verifications v SET accuracy_m = NULL, distance_m = ${roughDistanceSql('v.distance_m')},
        latitude = CASE WHEN v.latitude IS NOT NULL THEN ST_Y(i.centroid) END, longitude = CASE WHEN v.longitude IS NOT NULL THEN ST_X(i.centroid) END
      FROM incidents i
      WHERE i.id = v.incident_id AND v.is_demo AND (v.accuracy_m IS NOT NULL OR v.distance_m IS DISTINCT FROM ${roughDistanceSql('v.distance_m')})`)).rowCount ?? 0;
    const incidents = (await repairVerificationSummaries(client)).length;
    return { tasks, checks, incidents };
  });
  if (fixed.tasks || fixed.checks || fixed.incidents) clearTileCache();
  return fixed;
}
