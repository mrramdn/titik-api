-- Fire weather on a 0.5° grid over the two provinces: the cells (their polygons, centres at x.25 and x.75), the
-- regencies each cell overlaps, and per cell and WIB day the 12.00 WIB weather from Open-Meteo with the Canadian
-- FWI System codes computed from it (see src/weather.ts). Cells are built from the regencies on the first run.
CREATE TABLE weather_cells (
  id serial PRIMARY KEY,
  lon double precision NOT NULL,
  lat double precision NOT NULL,
  geom geometry(Polygon, 4326) NOT NULL,
  UNIQUE (lon, lat)
);

-- Regency names, not a foreign key: the regencies are loaded again whenever the reference data changes.
CREATE TABLE weather_cell_regencies (
  cell_id integer NOT NULL REFERENCES weather_cells(id) ON DELETE CASCADE,
  regency text NOT NULL,
  PRIMARY KEY (cell_id, regency)
);

CREATE TABLE weather_daily (
  cell_id integer NOT NULL REFERENCES weather_cells(id) ON DELETE CASCADE,
  day date NOT NULL,
  temp_c double precision NOT NULL,
  rh_pct double precision NOT NULL,
  wind_kmh double precision NOT NULL,
  -- Where the wind comes from, degrees from north.
  wind_from_deg double precision NOT NULL,
  -- Rain over the 24 hours to 12.00 WIB (the FWI input), and over the WIB day (for dry_days).
  rain24h_mm double precision NOT NULL,
  rain_day_mm double precision NOT NULL,
  -- Consecutive days up to this one with under 1 mm of rain (BMKG's "hari tanpa hujan").
  dry_days integer NOT NULL,
  ffmc double precision NOT NULL,
  dmc double precision NOT NULL,
  dc double precision NOT NULL,
  isi double precision NOT NULL,
  bui double precision NOT NULL,
  fwi double precision NOT NULL,
  -- True for today and later at the time of the fetch: forecast, not model analysis.
  forecast boolean NOT NULL,
  fetched_at timestamptz NOT NULL,
  PRIMARY KEY (cell_id, day)
);
CREATE INDEX weather_daily_day ON weather_daily(day);
