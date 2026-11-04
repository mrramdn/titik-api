-- The indicated hot area of an incident in hectares: the largest area covered by the pixel footprints of one
-- satellite pass (VIIRS when it saw the incident, else MODIS). Not burned area. Filled when an incident is
-- refreshed; `node dist/ingest.js refresh <days>` fills older ones.
ALTER TABLE incidents ADD COLUMN indicated_area_ha numeric(10,1);
