// NASA FIRMS active-fire CSVs: VIIRS 375 m (NOAA-21, NOAA-20, S-NPP) and MODIS 1 km (Terra and Aqua in one
// file). The regional files are public and need no key. S-NPP stops delivering data on 1–2 Nov 2026 (NASA
// Earthdata / NOAA OSPO), so its feed switches itself off then; NOAA-21 and NOAA-20 come first.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

export type Satellite = 'N21' | 'N20' | 'N' | 'T' | 'A';
export type Sensor = 'VIIRS' | 'MODIS';
export const satellites: readonly Satellite[] = ['N21', 'N20', 'N', 'T', 'A'];
export const modisSatellites: readonly Satellite[] = ['T', 'A'];
export const sensorOf = (satellite: string): Sensor => (satellite === 'T' || satellite === 'A' ? 'MODIS' : 'VIIRS');

export interface Feed { id: string; satellites: Satellite[]; sensor: Sensor; path: string; activeUntil?: string }
export const feeds: Feed[] = [
  { id: 'N21', satellites: ['N21'], sensor: 'VIIRS', path: 'noaa-21-viirs-c2/csv/J2_VIIRS_C2_SouthEast_Asia' },
  { id: 'N20', satellites: ['N20'], sensor: 'VIIRS', path: 'noaa-20-viirs-c2/csv/J1_VIIRS_C2_SouthEast_Asia' },
  { id: 'N', satellites: ['N'], sensor: 'VIIRS', path: 'suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_SouthEast_Asia', activeUntil: '2026-11-02T13:00:00Z' },
  { id: 'MODIS', satellites: ['T', 'A'], sensor: 'MODIS', path: 'modis-c6.1/csv/MODIS_C6_1_SouthEast_Asia' },
];
export const feedActive = (feed: Feed, now = new Date()) => !feed.activeUntil || now.getTime() < Date.parse(feed.activeUntil);
export const feedUrl = (feed: Feed, range: '24h' | '7d') => `https://firms.modaps.eosdis.nasa.gov/data/active_fire/${feed.path}_${range}.csv`;

export type Box = readonly [number, number, number, number];
/** The covered provinces with a margin of about 5 km (west, south, east, north): South Sumatra and Central Kalimantan. */
export const areaBoxes: readonly Box[] = [[102.0, -4.98, 106.25, -1.57], [110.68, -3.6, 115.9, 0.83]];
const inBoxes = (lon: number, lat: number, boxes: readonly Box[]) => boxes.some(b => lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3]);

export interface FirmsRow {
  satellite: Satellite; acqAt: Date; latitude: number; longitude: number; confidence: 'low' | 'nominal' | 'high';
  /** MODIS only: the confidence as delivered, 0–100. */
  confidencePct: number | null;
  frp: number | null; brightTi4: number | null; brightTi5: number | null; scan: number | null; track: number | null; daynight: string | null;
}

const number = (value: string | undefined) => (value === undefined || value.trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value));
const satelliteCodes: Record<string, Satellite> = { N21: 'N21', N20: 'N20', N: 'N', T: 'T', A: 'A', TERRA: 'T', AQUA: 'A', 'NOAA-21': 'N21', 'NOAA-20': 'N20', 'SUOMI-NPP': 'N' };
const confidenceWords = { h: 'high', n: 'nominal', l: 'low', high: 'high', nominal: 'nominal', low: 'low' } as const;

/** MODIS confidence 0–29 is low, 30–79 nominal, 80–100 high (FIRMS MCD14DL guidance). */
export function modisConfidence(percent: number): 'low' | 'nominal' | 'high' {
  return percent >= 80 ? 'high' : percent >= 30 ? 'nominal' : 'low';
}

/**
 * Parses a FIRMS VIIRS or MODIS CSV and keeps the rows inside the covered area. MODIS columns are mapped onto the
 * VIIRS ones (brightness → bright_ti4, bright_t31 → bright_ti5). A broken row is skipped and never stops the
 * file; only a file without the FIRMS columns throws. `totals` and `latest` count every row of a satellite, inside
 * the area or not, so a pass that saw no fire here still shows that the satellite delivered.
 */
export function parseFirmsCsv(text: string, boxes: readonly Box[] = areaBoxes) {
  const lines = text.trim().split(/\r?\n/);
  const header = (lines.shift() ?? '').split(',').map(name => name.trim().toLowerCase());
  const column = (...names: string[]) => names.map(name => header.indexOf(name)).find(index => index >= 0) ?? -1;
  const at = { lat: column('latitude'), lon: column('longitude'), ti4: column('bright_ti4', 'brightness'), scan: column('scan'), track: column('track'),
    date: column('acq_date'), time: column('acq_time'), satellite: column('satellite'), confidence: column('confidence'), ti5: column('bright_ti5', 'bright_t31'),
    frp: column('frp'), daynight: column('daynight') };
  if (at.lat < 0 || at.lon < 0 || at.date < 0 || at.time < 0 || at.satellite < 0 || at.confidence < 0) throw new Error('Bukan berkas CSV FIRMS.');
  const rows: FirmsRow[] = [];
  const totals: Partial<Record<Satellite, number>> = {};
  const latest: Partial<Record<Satellite, Date>> = {};
  let total = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    total++;
    const cells = line.split(',').map(cell => cell.trim());
    const satellite = satelliteCodes[(cells[at.satellite] ?? '').toUpperCase()];
    const time = cells[at.time] ?? '';
    const date = cells[at.date] ?? '';
    if (!satellite || !/^\d{1,4}$/.test(time) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const hhmm = time.padStart(4, '0');
    const acqAt = new Date(`${date}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00Z`);
    if (Number.isNaN(acqAt.getTime()) || Number(hhmm.slice(0, 2)) > 23 || Number(hhmm.slice(2)) > 59) continue;
    totals[satellite] = (totals[satellite] ?? 0) + 1;
    if (!latest[satellite] || acqAt > latest[satellite]!) latest[satellite] = acqAt;
    const latitude = number(cells[at.lat]), longitude = number(cells[at.lon]);
    if (latitude === null || longitude === null || !inBoxes(longitude, latitude, boxes)) continue;
    const rawConfidence = (cells[at.confidence] ?? '').toLowerCase();
    let confidence: FirmsRow['confidence'] | undefined;
    let confidencePct: number | null = null;
    if (/^\d{1,3}$/.test(rawConfidence)) {
      confidencePct = Number(rawConfidence);
      if (confidencePct > 100) continue;
      confidence = modisConfidence(confidencePct);
    } else confidence = confidenceWords[rawConfidence as keyof typeof confidenceWords];
    if (!confidence) continue;
    rows.push({ satellite, acqAt, latitude, longitude, confidence, confidencePct,
      frp: number(cells[at.frp]), brightTi4: number(cells[at.ti4]), brightTi5: number(cells[at.ti5]), scan: number(cells[at.scan]), track: number(cells[at.track]),
      daynight: at.daynight >= 0 && cells[at.daynight] ? cells[at.daynight]!.slice(0, 1) : null });
  }
  return { rows, total, totals, latest };
}

export async function fetchFeed(feed: Feed, range: '24h' | '7d', fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl(feedUrl(feed, range), { signal: AbortSignal.timeout(60_000), headers: { 'user-agent': 'titik-api (hackathon prototype)' } });
  if (!response.ok) throw new Error(`FIRMS ${feed.id} ${range}: HTTP ${response.status}`);
  return response.text();
}

/** The committed snapshot (data/firms-snapshot/<date>/<feed>_<range>.csv.gz), used when FIRMS cannot be reached. */
export async function snapshotFeed(feed: Feed, range: '24h' | '7d', dataDir: string) {
  const directory = resolve(dataDir, 'firms-snapshot', '2026-10-16');
  return gunzipSync(await readFile(resolve(directory, `${feed.id}_${range}.csv.gz`))).toString('utf8');
}
