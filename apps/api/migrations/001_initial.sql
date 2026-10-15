CREATE EXTENSION IF NOT EXISTS postgis;

-- People: field volunteers (MPA), village heads, and the agencies that read the dashboard.
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('mpa', 'kades', 'bpbd', 'admin')),
  organization text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_id ON sessions(user_id);

-- Which version of each committed reference file is loaded, so a new file replaces the old rows once.
CREATE TABLE reference_data (
  name text PRIMARY KEY,
  version text NOT NULL,
  loaded_at timestamptz NOT NULL DEFAULT now()
);

-- Villages (desa/kelurahan) of the pilot regency, from the HDX/BPS administrative boundaries.
CREATE TABLE villages (
  id text PRIMARY KEY,
  name text NOT NULL,
  district text NOT NULL,
  regency text NOT NULL,
  province text NOT NULL,
  geom geometry(MultiPolygon, 4326) NOT NULL,
  center geometry(Point, 4326) NOT NULL,
  center_source text NOT NULL CHECK (center_source IN ('osm', 'polygon')),
  area_ha numeric NOT NULL,
  peat_share numeric NOT NULL DEFAULT 0
);
CREATE INDEX villages_geom ON villages USING gist (geom);

-- Settlement points (OpenStreetMap places) for the distance part of the priority score.
CREATE TABLE settlements (
  id bigint PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL,
  geom geometry(Point, 4326) NOT NULL
);
CREATE INDEX settlements_geom ON settlements USING gist (geom);

-- Places that are hot without a land fire: industrial sites from OpenStreetMap and spots a volunteer verified
-- as a false alarm. Detections near them are flagged, never hidden.
CREATE TABLE static_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('industri', 'alarm_palsu')),
  label text NOT NULL,
  geom geometry(Point, 4326) NOT NULL,
  radius_m integer NOT NULL,
  verification_id uuid,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX static_sources_geom ON static_sources USING gist (geom);

CREATE TABLE ingest_runs (
  id bigserial PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  source text NOT NULL CHECK (source IN ('live', 'snapshot', 'fixture')),
  feeds jsonb NOT NULL DEFAULT '[]',
  fetched integer NOT NULL DEFAULT 0,
  in_area integer NOT NULL DEFAULT 0,
  inserted integer NOT NULL DEFAULT 0,
  incidents_touched integer NOT NULL DEFAULT 0,
  error text
);

-- An incident (kejadian) is one or more detections within 750 m of each other inside 24 hours.
CREATE TABLE incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  village_id text REFERENCES villages(id),
  first_detected_at timestamptz NOT NULL,
  last_detected_at timestamptz NOT NULL,
  detection_count integer NOT NULL DEFAULT 0,
  satellites text[] NOT NULL DEFAULT '{}',
  max_frp numeric,
  best_confidence text CHECK (best_confidence IN ('low', 'nominal', 'high')),
  on_peat boolean NOT NULL DEFAULT false,
  near_static boolean NOT NULL DEFAULT false,
  centroid geometry(Point, 4326),
  settlement_m integer,
  score integer NOT NULL DEFAULT 0,
  score_parts jsonb NOT NULL DEFAULT '[]',
  level text NOT NULL DEFAULT 'rendah' CHECK (level IN ('tinggi', 'sedang', 'rendah')),
  first_verified_at timestamptz,
  latest_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX incidents_last ON incidents(last_detected_at DESC);
CREATE INDEX incidents_village ON incidents(village_id, last_detected_at DESC);
CREATE INDEX incidents_centroid ON incidents USING gist (centroid);

-- One row per satellite pixel from NASA FIRMS (VIIRS 375 m).
CREATE TABLE detections (
  id bigserial PRIMARY KEY,
  satellite text NOT NULL CHECK (satellite IN ('N21', 'N20', 'N')),
  acq_at timestamptz NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  geom geometry(Point, 4326) NOT NULL,
  -- The same point in metres (UTM zone 48S covers the pilot regency), for fast distance checks.
  geom_m geometry(Point, 32748) NOT NULL,
  confidence text NOT NULL CHECK (confidence IN ('low', 'nominal', 'high')),
  frp numeric,
  bright_ti4 numeric,
  bright_ti5 numeric,
  scan numeric,
  track numeric,
  daynight text,
  village_id text REFERENCES villages(id),
  on_peat boolean NOT NULL DEFAULT false,
  near_static boolean NOT NULL DEFAULT false,
  incident_id uuid REFERENCES incidents(id) ON DELETE SET NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (satellite, acq_at, latitude, longitude)
);
CREATE INDEX detections_geom ON detections USING gist (geom);
CREATE INDEX detections_geom_m ON detections USING gist (geom_m);
CREATE INDEX detections_acq ON detections(acq_at DESC);
CREATE INDEX detections_incident ON detections(incident_id);

CREATE TABLE subscriptions (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  village_id text NOT NULL REFERENCES villages(id),
  radius_km integer NOT NULL DEFAULT 0 CHECK (radius_km BETWEEN 0 AND 10),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, village_id)
);

-- A card in someone's inbox. Its text is written from the incident when read, so it never goes stale.
CREATE TABLE alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  village_id text NOT NULL REFERENCES villages(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  shared_at timestamptz,
  UNIQUE (user_id, incident_id)
);
CREATE INDEX alerts_user ON alerts(user_id, updated_at DESC);

-- A field check of an incident. client_uuid makes a report sent again after a lost connection count once.
CREATE TABLE verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_uuid uuid NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('api_aktif', 'asap_bara', 'bakar_terkendali', 'alarm_palsu', 'tidak_terjangkau')),
  false_alarm_kind text CHECK (false_alarm_kind IN ('industri', 'pembakaran_sampah', 'lainnya')),
  note text NOT NULL DEFAULT '',
  latitude double precision,
  longitude double precision,
  accuracy_m numeric,
  distance_m integer,
  observed_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  photo_url text,
  photo_thumb_url text,
  is_demo boolean NOT NULL DEFAULT false
);
CREATE INDEX verifications_incident ON verifications(incident_id, observed_at);

-- Browsers that asked for push notifications (Web Push). Removed when the push service says they are gone.
CREATE TABLE push_subscriptions (
  endpoint text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_subscriptions_user ON push_subscriptions(user_id);
