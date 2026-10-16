-- A field check that BPBD/Daops asks of a regu MPA: ditugaskan, then menuju (on the way), then selesai when
-- any field check of the incident arrives, or dibatalkan. One open task per incident at a time.
CREATE TABLE assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  assignee_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'ditugaskan' CHECK (status IN ('ditugaskan', 'menuju', 'selesai', 'dibatalkan')),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- When the squad set off, so the incident history keeps that step after the task is closed.
  enroute_at timestamptz,
  closed_at timestamptz
);
CREATE UNIQUE INDEX assignments_open_incident ON assignments(incident_id) WHERE status IN ('ditugaskan', 'menuju');
CREATE INDEX assignments_incident ON assignments(incident_id, created_at DESC);
CREATE INDEX assignments_assignee ON assignments(assignee_id, created_at DESC);
