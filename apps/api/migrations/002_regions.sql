-- Two provinces (South Sumatra, Central Kalimantan): regencies for filters and the zoomed-out map, and every
-- shape also stored in Web Mercator so vector tiles are cut without transforming each row on every request.
CREATE TABLE regencies (
  name text PRIMARY KEY,
  province text NOT NULL,
  villages integer NOT NULL,
  geom geometry(MultiPolygon, 4326) NOT NULL,
  geom_3857 geometry(MultiPolygon, 3857) NOT NULL,
  center geometry(Point, 4326) NOT NULL
);
CREATE INDEX regencies_geom_3857 ON regencies USING gist (geom_3857);

ALTER TABLE villages ADD COLUMN geom_3857 geometry(MultiPolygon, 3857);
CREATE INDEX villages_geom_3857 ON villages USING gist (geom_3857);
CREATE INDEX villages_regency ON villages(regency);

ALTER TABLE detections ADD COLUMN geom_3857 geometry(Point, 3857);
CREATE INDEX detections_geom_3857 ON detections USING gist (geom_3857);
ALTER TABLE incidents ADD COLUMN centroid_3857 geometry(Point, 3857);
CREATE INDEX incidents_centroid_3857 ON incidents USING gist (centroid_3857);
