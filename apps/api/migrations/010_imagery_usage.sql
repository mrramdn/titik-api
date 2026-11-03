-- Requests to Esri World Imagery per UTC day (tiles and the daily attribution lookup), counted by the API before
-- each request. The free tier has no cap of its own at Esri, so this count is the only cap.
CREATE TABLE IF NOT EXISTS imagery_usage (
  day date PRIMARY KEY,
  tiles integer NOT NULL
);
