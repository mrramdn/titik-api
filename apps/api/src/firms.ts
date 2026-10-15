// NASA FIRMS active-fire CSVs (VIIRS 375 m). The regional files are public and need no key.
// S-NPP stops delivering data on 1–2 Nov 2026 (NASA Earthdata / NOAA OSPO), so NOAA-21 and NOAA-20 come first.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface Feed { satellite: 'N21' | 'N20' | 'N'; path: string }
export const feeds: Feed[] = [
  { satellite: 'N21', path: 'noaa-21-viirs-c2/csv/J2_VIIRS_C2_SouthEast_Asia' },
  { satellite: 'N20', path: 'noaa-20-viirs-c2/csv/J1_VIIRS_C2_SouthEast_Asia' },
  { satellite: 'N', path: 'suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_SouthEast_Asia' },
];
export const feedUrl = (feed: Feed, range: '24h' | '7d') => `https://firms.modaps.eosdis.nasa.gov/data/active_fire/${feed.path}_${range}.csv`;

/** Ogan Komering Ilir with a margin of about 6 km: west, south, east, north. */
export const areaBox = [104.58, -4.33, 106.25, -2.33] as const;

export interface FirmsRow {
  satellite: string; acqAt: Date; latitude: number; longitude: number; confidence: 'low' | 'nominal' | 'high';
  frp: number | null; brightTi4: number | null; brightTi5: number | null; scan: number | null; track: number | null; daynight: string | null;
}

const number = (value: string | undefined) => (value === undefined || value === '' || Number.isNaN(Number(value)) ? null : Number(value));

/** Parses a FIRMS VIIRS CSV and keeps the rows inside the box. Unknown or broken rows are skipped. */
export function parseFirmsCsv(text: string, box: readonly [number, number, number, number] = areaBox) {
  const lines = text.trim().split(/\r?\n/);
  const header = (lines.shift() ?? '').split(',');
  const column = (name: string) => header.indexOf(name);
  const at = { lat: column('latitude'), lon: column('longitude'), ti4: column('bright_ti4'), scan: column('scan'), track: column('track'), date: column('acq_date'),
    time: column('acq_time'), satellite: column('satellite'), confidence: column('confidence'), ti5: column('bright_ti5'), frp: column('frp'), daynight: column('daynight') };
  if (at.lat < 0 || at.lon < 0 || at.date < 0 || at.time < 0) throw new Error('Not a FIRMS VIIRS CSV');
  const rows: FirmsRow[] = [];
  let total = 0;
  for (const line of lines) {
    if (!line) continue;
    total++;
    const cells = line.split(',');
    const latitude = Number(cells[at.lat]), longitude = Number(cells[at.lon]);
    if (!(longitude >= box[0] && longitude <= box[2] && latitude >= box[1] && latitude <= box[3])) continue;
    const time = (cells[at.time] ?? '').padStart(4, '0');
    const acqAt = new Date(`${cells[at.date]}T${time.slice(0, 2)}:${time.slice(2)}:00Z`);
    const confidence = ({ h: 'high', n: 'nominal', l: 'low', high: 'high', nominal: 'nominal', low: 'low' } as const)[cells[at.confidence] as 'h'] ;
    if (Number.isNaN(acqAt.getTime()) || !confidence) continue;
    rows.push({ satellite: cells[at.satellite] ?? '', acqAt, latitude, longitude, confidence,
      frp: number(cells[at.frp]), brightTi4: number(cells[at.ti4]), brightTi5: number(cells[at.ti5]), scan: number(cells[at.scan]), track: number(cells[at.track]),
      daynight: cells[at.daynight] ?? null });
  }
  return { rows, total };
}

export async function fetchFeed(feed: Feed, range: '24h' | '7d', fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl(feedUrl(feed, range), { signal: AbortSignal.timeout(60_000), headers: { 'user-agent': 'titik-api (hackathon prototype)' } });
  if (!response.ok) throw new Error(`FIRMS ${feed.satellite} ${range}: HTTP ${response.status}`);
  return response.text();
}

/** The committed snapshot (data/firms-snapshot/<date>/<satellite>_<range>.csv), used when FIRMS cannot be reached. */
export async function snapshotFeed(feed: Feed, range: '24h' | '7d', dataDir: string) {
  const directory = resolve(dataDir, 'firms-snapshot', '2026-10-16');
  return readFile(resolve(directory, `${feed.satellite}_${range}.csv`), 'utf8');
}
