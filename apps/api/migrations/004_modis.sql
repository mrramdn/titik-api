-- MODIS (Terra T, Aqua A; 1 km pixels) next to VIIRS. MODIS gives a confidence from 0 to 100 instead of
-- low/nominal/high; the class is derived from it and the raw value is kept.
ALTER TABLE detections DROP CONSTRAINT IF EXISTS detections_satellite_check;
ALTER TABLE detections ADD CONSTRAINT detections_satellite_check CHECK (satellite IN ('N21', 'N20', 'N', 'T', 'A'));
ALTER TABLE detections ADD COLUMN confidence_pct smallint CHECK (confidence_pct BETWEEN 0 AND 100);
