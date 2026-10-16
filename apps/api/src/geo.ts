// Pure helpers shared by the ingest, the API and the tests: distances, directions, Jakarta time, the priority
// score and the Indonesian text of an alert (push notifications and link previews). The web app writes its own
// text in the visitor's language from the structured fields.

export const satelliteLabel: Record<string, string> = { N21: 'NOAA-21', N20: 'NOAA-20', N: 'S-NPP', T: 'Terra', A: 'Aqua' };
export const confidenceLabel: Record<string, string> = { high: 'tinggi', nominal: 'sedang', low: 'rendah' };
export const statusLabel: Record<string, string> = {
  api_aktif: 'Api aktif', asap_bara: 'Asap atau bara', bakar_terkendali: 'Bakar terkendali', alarm_palsu: 'Alarm palsu', tidak_terjangkau: 'Tidak terjangkau',
};
export const falseAlarmLabel: Record<string, string> = { industri: 'sumber panas industri', pembakaran_sampah: 'pembakaran sampah', lainnya: 'lainnya' };

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

export function distanceMeters(from: [number, number], to: [number, number]) {
  const [lon1, lat1] = from, [lon2, lat2] = to;
  const a = Math.sin(toRadians(lat2 - lat1) / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(toRadians(lon2 - lon1) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(a));
}

/** Initial bearing in degrees (0 = north, clockwise). */
export function bearingDegrees(from: [number, number], to: [number, number]) {
  const [lon1, lat1] = from.map(toRadians) as [number, number], [lon2, lat2] = to.map(toRadians) as [number, number];
  const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const winds = ['utara', 'timur laut', 'timur', 'tenggara', 'selatan', 'barat daya', 'barat', 'barat laut'];
export const windName = (degrees: number) => winds[Math.round((((degrees % 360) + 360) % 360) / 45) % 8]!;

export function formatDistance(meters: number) {
  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  if (meters < 10_000) return `${(Math.round(meters / 100) / 10).toLocaleString('id-ID')} km`;
  return `${Math.round(meters / 1000)} km`;
}
/** "1.299" */
export const formatCount = (n: number) => n.toLocaleString('id-ID');

const timeFormat = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dateFormat = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short' });
/** "13.42" in Western Indonesian Time. */
export const formatWib = (date: Date) => timeFormat.format(date).replace(':', '.');
/** "16 Okt 13.42". */
export const formatWibDateTime = (date: Date) => `${dateFormat.format(date).replace('.', '')} ${formatWib(date)}`;
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' });
/** "13.42" on the same WIB day as `now`, else "15 Okt 13.42". */
export const formatWibWhen = (date: Date, now = new Date()) => (dayFormat.format(date) === dayFormat.format(now) ? formatWib(date) : formatWibDateTime(date));

export interface ScoreInput {
  bestConfidence: string | null; maxFrp: number | null; viirsCount: number; modisCount: number;
  onPeat: boolean; settlementMeters: number | null; nearStatic: boolean;
}
/** `value` is the number or class behind the label, so a client can write the label in its own language. */
export interface ScorePart { key: string; label: string; points: number; value?: number | string | null }
export type Level = 'tinggi' | 'sedang' | 'rendah';

/** Points for the number of detections: 2 → 6, 3–4 → 10, 5–19 → 15, 20 or more → 20. */
export const sizePoints = (count: number) => (count >= 20 ? 20 : count >= 5 ? 15 : count >= 3 ? 10 : count === 2 ? 6 : 0);

/**
 * The priority of an incident as a sum of rules anyone can check by hand: satellite confidence, fire radiative
 * power, how many detections, peat, how close people live, and whether a known hot place is near. Confidence,
 * power and size come from VIIRS (375 m) when it saw the incident. An incident seen only by MODIS (1 km) gets
 * lower weights, because MODIS marks far more pixels as high confidence; one seen by both gets 5 points more.
 */
export function scoreIncident(input: ScoreInput): { score: number; level: Level; parts: ScorePart[] } {
  const modisOnly = input.viirsCount === 0 && input.modisCount > 0;
  const sensor = modisOnly ? 'MODIS' : 'VIIRS';
  const best = input.bestConfidence ?? 'low';
  const parts: ScorePart[] = [];
  const confidence = modisOnly ? (best === 'high' ? 18 : best === 'nominal' ? 10 : 4) : (best === 'high' ? 30 : best === 'nominal' ? 18 : 6);
  parts.push({ key: 'keyakinan', label: `Keyakinan ${sensor} ${confidenceLabel[best] ?? 'rendah'}`, points: confidence, value: best });
  const frp = input.maxFrp ?? 0;
  parts.push({ key: 'frp', label: `Daya radiasi api maksimum ${frp.toLocaleString('id-ID', { maximumFractionDigits: 1 })} MW`,
    points: frp >= 50 ? 20 : frp >= 20 ? 14 : frp >= 5 ? 8 : 3, value: frp });
  const count = modisOnly ? input.modisCount : input.viirsCount;
  parts.push({ key: 'jumlah', label: `${formatCount(count)} titik panas ${sensor}`, points: modisOnly ? Math.round(sizePoints(count) / 2) : sizePoints(count), value: count });
  parts.push({ key: 'gambut', label: input.onPeat ? 'Di lahan gambut' : 'Tidak di lahan gambut', points: input.onPeat ? 20 : 0, value: input.onPeat ? 1 : 0 });
  const settlement = input.settlementMeters;
  parts.push({ key: 'permukiman', label: settlement === null ? 'Jarak ke permukiman tidak diketahui' : `Permukiman terdekat ${formatDistance(settlement)}`,
    points: settlement === null ? 0 : settlement <= 1000 ? 15 : settlement <= 3000 ? 8 : 0, value: settlement });
  if (input.viirsCount > 0 && input.modisCount > 0) parts.push({ key: 'modis', label: 'Dikonfirmasi MODIS', points: 5, value: input.modisCount });
  if (input.nearStatic) parts.push({ key: 'sumber_tetap', label: 'Dekat sumber panas tetap', points: -40, value: null });
  const score = Math.max(0, Math.min(100, parts.reduce((sum, part) => sum + part.points, 0)));
  return { score, level: score >= 60 ? 'tinggi' : score >= 35 ? 'sedang' : 'rendah', parts };
}

export interface CardPlace { name: string; kind: string; distanceM: number; bearingDeg: number }
export interface CardIncident {
  detectionCount: number; onPeat: boolean; lastDetectedAt: Date; level: Level; nearStatic: boolean;
  modisOnly: boolean; locationUncertaintyM: number | null; place: CardPlace | null; village: { name: string } | null;
}

/** "Dusun Sungai Perlu": OpenStreetMap place kinds as Indonesian names (village = desa, hamlet = dusun). */
export function placeName(place: Pick<CardPlace, 'name' | 'kind'>) {
  const prefix = ({ village: 'Desa', hamlet: 'Dusun', city: 'Kota' } as Record<string, string>)[place.kind];
  return prefix && !place.name.toLowerCase().startsWith(prefix.toLowerCase()) ? `${prefix} ${place.name}` : place.name;
}

/** Where an incident is, from the nearest named settlement: "6,9 km barat daya Dusun Sungai Perlu". */
export function placeText(place: CardPlace) {
  return place.distanceM < 300 ? `dekat ${placeName(place)}` : `${formatDistance(place.distanceM)} ${windName(place.bearingDeg)} ${placeName(place)}`;
}

/** How far off a MODIS-only location may be, in steps of 500 m and at least 1 km: "lokasi ±1 km". */
export const uncertaintyText = (meters: number) => `lokasi ±${formatDistance(Math.max(1000, Math.ceil(meters / 500) * 500))}`;

/**
 * "46 titik panas · 6,9 km barat daya Dusun Sungai Perlu · Desa Cinta Jaya · lahan gambut · terakhir 14.20 WIB ·
 * prioritas tinggi. Titik panas perlu dicek di lapangan." The last detection carries its date when it was not today.
 */
export function cardText(incident: CardIncident, now = new Date()) {
  const parts = [`${formatCount(incident.detectionCount)} titik panas`];
  if (incident.place) parts.push(placeText(incident.place));
  if (incident.modisOnly && incident.locationUncertaintyM) parts.push(uncertaintyText(incident.locationUncertaintyM));
  if (incident.village && !(incident.place?.kind === 'village' && incident.place.name === incident.village.name)) parts.push(`Desa ${incident.village.name}`);
  if (incident.onPeat) parts.push('lahan gambut');
  parts.push(`terakhir ${formatWibWhen(incident.lastDetectedAt, now)} WIB`, `prioritas ${incident.level}`);
  return `${parts.join(' · ')}.${incident.nearStatic ? ' Dekat sumber panas tetap.' : ''} Titik panas perlu dicek di lapangan.`;
}
