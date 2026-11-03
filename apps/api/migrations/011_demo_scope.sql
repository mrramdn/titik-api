-- The demo accounts (addresses ending in @titikapi.test) are shared by every visitor, so what they do stays in a demo
-- scope: visitors and real accounts see real field checks and tasks only, a demo session sees real and demo ones
-- together (see Scope in src/incidents.ts). The incident keeps two summaries: first_verified_at and latest_status from
-- real field checks only (what the public sees), first_verified_any_at and latest_status_any from every field check (what
-- a demo session sees). refreshVerificationSummary keeps both.
ALTER TABLE incidents ADD COLUMN first_verified_any_at timestamptz, ADD COLUMN latest_status_any text;

-- Field checks from a demo account were marked when they were filed; mark any that were not, by the account's address.
UPDATE verifications SET is_demo = true WHERE NOT is_demo AND user_id IN (SELECT id FROM users WHERE email LIKE '%@titikapi.test');

UPDATE incidents i
SET first_verified_at = s.first_real, latest_status = s.latest_real, first_verified_any_at = s.first_any, latest_status_any = s.latest_any
FROM (
  SELECT incident_id,
    min(observed_at) FILTER (WHERE NOT is_demo) AS first_real,
    (array_agg(status ORDER BY observed_at DESC, received_at DESC) FILTER (WHERE NOT is_demo))[1] AS latest_real,
    min(observed_at) AS first_any,
    (array_agg(status ORDER BY observed_at DESC, received_at DESC))[1] AS latest_any
  FROM verifications GROUP BY incident_id) s
WHERE i.id = s.incident_id;

-- A task from or to a demo account is a demo task. One open task per incident in each scope, so a demo task never
-- blocks a real one; a field check closes the open task of its own scope.
ALTER TABLE assignments ADD COLUMN is_demo boolean NOT NULL DEFAULT false;
UPDATE assignments SET is_demo = true
WHERE assignee_id IN (SELECT id FROM users WHERE email LIKE '%@titikapi.test') OR assigned_by IN (SELECT id FROM users WHERE email LIKE '%@titikapi.test');
DROP INDEX assignments_open_incident;
CREATE UNIQUE INDEX assignments_open_incident ON assignments(incident_id, is_demo) WHERE status IN ('ditugaskan', 'menuju');
