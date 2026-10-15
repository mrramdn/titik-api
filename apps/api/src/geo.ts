// Pure helpers shared by the ingest, the API and the tests: distances, directions, Jakarta time, the priority
// score and the text of an alert card. Everything a volunteer reads is Indonesian.

export const satelliteLabel: Record<string, string> = { N21: 'NOAA-21', N20: 'NOAA-20', N: 'S-NPP' };
export const confidenceLabel: Record<string, string> = { high: 'tinggi', nominal: 'sedang', low: 'rendah' };
export const statusLabel: Record<string, string> = {
  api_aktif: 'Api aktif', asap_bara: 'Asap/bara', bakar_terkendali: 'Bakar terkendali', alarm_palsu: 'Alarm palsu', tidak_terjangkau: 'Tidak terjangkau',
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
export const windName = (degrees: number) => winds[Math.round(degrees / 45) % 8]!;

export function formatDistance(meters: number) {
  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  if (meters < 10_000) return `${(Math.round(meters / 100) / 10).toLocaleString('id-ID')} km`;
  return `${Math.round(meters / 1000)} km`;
}

const timeFormat = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dateFormat = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short' });
/** "13.42" in Western Indonesian Time. */
export const formatWib = (date: Date) => timeFormat.format(date).replace(':', '.');
/** "16 Okt 13.42". */
export const formatWibDateTime = (date: Date) => `${dateFormat.format(date)} ${formatWib(date)}`;

export interface ScoreInput { bestConfidence: string | null; maxFrp: number | null; detectionCount: number; onPeat: boolean; settlementMeters: number | null; nearStatic: boolean }
export interface ScorePart { key: string; label: string; points: number }
export type Level = 'tinggi' | 'sedang' | 'rendah';

/**
 * The priority of an incident, as a rule anyone can check by hand rather than a model: satellite confidence,
 * fire radiative power, how many detections, peat, how close people live, and whether a known hot place is near.
 */
export function scoreIncident(input: ScoreInput): { score: number; level: Level; parts: ScorePart[] } {
  const parts: ScorePart[] = [];
  const confidence = input.bestConfidence === 'high' ? 30 : input.bestConfidence === 'nominal' ? 18 : 6;
  parts.push({ key: 'keyakinan', label: `Keyakinan satelit ${confidenceLabel[input.bestConfidence ?? 'low']}`, points: confidence });
  const frp = input.maxFrp ?? 0;
  parts.push({ key: 'frp', label: `Daya radiasi api (FRP) maks ${frp.toLocaleString('id-ID', { maximumFractionDigits: 1 })} MW`, points: frp >= 50 ? 20 : frp >= 20 ? 14 : frp >= 5 ? 8 : 3 });
  const count = input.detectionCount;
  parts.push({ key: 'jumlah', label: `${count} deteksi satelit`, points: count >= 5 ? 15 : count >= 3 ? 10 : count === 2 ? 6 : 0 });
  parts.push({ key: 'gambut', label: input.onPeat ? 'Di lahan gambut' : 'Di luar peta gambut', points: input.onPeat ? 20 : 0 });
  const settlement = input.settlementMeters;
  parts.push({ key: 'permukiman', label: settlement === null ? 'Jarak ke permukiman tidak diketahui' : `Permukiman terdekat ${formatDistance(settlement)}`,
    points: settlement === null ? 0 : settlement <= 1000 ? 15 : settlement <= 3000 ? 8 : 0 });
  if (input.nearStatic) parts.push({ key: 'sumber_tetap', label: 'Dekat sumber panas tetap (industri atau alarm palsu terverifikasi)', points: -40 });
  const score = Math.max(0, Math.min(100, parts.reduce((sum, part) => sum + part.points, 0)));
  return { score, level: score >= 60 ? 'tinggi' : score >= 35 ? 'sedang' : 'rendah', parts };
}

export interface CardIncident { detectionCount: number; centroid: [number, number]; onPeat: boolean; lastDetectedAt: Date; satellites: string[]; bestConfidence: string | null; level: Level; nearStatic: boolean }
export interface CardVillage { name: string; center: [number, number] }

/** Where an incident is, said from the centre of a village: "1,2 km tenggara pusat Desa Bangsal". */
export function placeText(incident: CardIncident, reference: CardVillage, incidentVillage?: CardVillage | null) {
  const meters = distanceMeters(reference.center, incident.centroid);
  const where = meters < 300 ? `dekat pusat Desa ${reference.name}` : `${formatDistance(meters)} ${windName(bearingDegrees(reference.center, incident.centroid))} pusat Desa ${reference.name}`;
  return incidentVillage && incidentVillage.name !== reference.name ? `${where}, di wilayah Desa ${incidentVillage.name}` : where;
}

export function cardText(incident: CardIncident, reference: CardVillage, incidentVillage?: CardVillage | null) {
  const satellites = [...new Set(incident.satellites)].map(code => satelliteLabel[code] ?? code).join('/');
  return [
    `${incident.detectionCount} titik panas`,
    placeText(incident, reference, incidentVillage),
    incident.onPeat ? 'di lahan gambut' : 'di luar peta gambut',
    `terakhir ${formatWib(incident.lastDetectedAt)} WIB (${satellites})`,
    `keyakinan ${confidenceLabel[incident.bestConfidence ?? 'low']}`,
    `prioritas ${incident.level.toUpperCase()}`,
  ].join(' · ') + (incident.nearStatic ? '. Dekat sumber panas tetap, kemungkinan bukan kebakaran lahan.' : '.') + ' Titik panas belum tentu api, mohon dicek.';
}
