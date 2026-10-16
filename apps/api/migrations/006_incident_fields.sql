-- Per incident: the nearest named settlement (distance, and the bearing from that place to the incident), how
-- many detections came from each sensor, and whether only MODIS saw it (then the location is uncertain).
ALTER TABLE incidents
  ADD COLUMN place_name text,
  ADD COLUMN place_kind text,
  ADD COLUMN place_m integer,
  ADD COLUMN place_bearing integer,
  ADD COLUMN viirs_count integer NOT NULL DEFAULT 0,
  ADD COLUMN modis_count integer NOT NULL DEFAULT 0,
  ADD COLUMN modis_only boolean NOT NULL DEFAULT false,
  ADD COLUMN location_uncertainty_m integer;

-- Every incident so far was made from VIIRS only.
UPDATE incidents SET viirs_count = detection_count;
UPDATE incidents i SET (place_name, place_kind, place_m, place_bearing) = (
    SELECT s.name, s.kind, round(ST_Distance(s.geom::geography, i.centroid::geography))::integer,
      COALESCE(round(degrees(ST_Azimuth(s.geom::geography, i.centroid::geography)))::integer % 360, 0)
    FROM settlements s WHERE s.kind <> 'neighbourhood' ORDER BY s.geom <-> i.centroid LIMIT 1)
  WHERE i.centroid IS NOT NULL;
