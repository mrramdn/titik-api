-- The share of each regency's area that a grid cell covers (0–1; a regency's shares add up to 1), so that a regency's
-- fire danger is told by area instead of by its worst cell (see regencyDay in src/weather.ts). Geodesic areas of the
-- cell's intersection with the regency. Filled here for the cells already mapped; ensureCells fills it for new
-- mappings and for any row still without it.
ALTER TABLE weather_cell_regencies ADD COLUMN share double precision;

UPDATE weather_cell_regencies m
SET share = COALESCE(ST_Area(ST_CollectionExtract(ST_Intersection(c.geom, r.geom), 3)::geography) / NULLIF(ST_Area(r.geom::geography), 0), 0)
FROM weather_cells c, regencies r
WHERE c.id = m.cell_id AND r.name = m.regency;
