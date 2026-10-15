// A thin client for /api/v1. Errors carry the server's Indonesian message.
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      credentials: 'same-origin',
      ...rest,
      headers: { ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    });
  } catch {
    throw new ApiError(0, 'OFFLINE', 'Tidak ada sinyal. Coba lagi saat tersambung.');
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, body?.error?.code ?? 'ERROR', body?.error?.message ?? 'Terjadi kesalahan.');
  return body as T;
}

export type Level = 'tinggi' | 'sedang' | 'rendah';
export type Status = 'api_aktif' | 'asap_bara' | 'bakar_terkendali' | 'alarm_palsu' | 'tidak_terjangkau';
export interface ScorePart { key: string; label: string; points: number }
export interface Incident {
  id: string; code: string; village: { id: string; name: string; district: string; regency: string; province: string; center: [number, number] } | null;
  firstDetectedAt: string; lastDetectedAt: string; detectionCount: number; satellites: string[]; maxFrp: number | null;
  bestConfidence: 'low' | 'nominal' | 'high' | null; onPeat: boolean; nearStatic: boolean; centroid: [number, number];
  settlementMeters: number | null; score: number; scoreParts: ScorePart[]; level: Level; firstVerifiedAt: string | null;
  latestStatus: Status | null; card: string | null; sharePath: string;
}
export interface Detection { id: number; satellite: string; acqAt: string; latitude: number; longitude: number; confidence: string; frp: number | null; brightTi4: number | null; daynight: string; onPeat: boolean; nearStatic: boolean }
export interface Verification { id: string; status: Status; falseAlarmKind: string | null; observedAt: string; receivedAt: string; distanceMeters: number | null; demo: boolean; note?: string; photoUrl?: string | null; photoThumbUrl?: string | null; reporter?: string }
export interface IncidentDetail extends Incident { detections: Detection[]; verifications: Verification[] }
export interface Alert { id: string; createdAt: string; updatedAt: string; readAt: string | null; sharedAt: string | null; village: { id: string; name: string }; card: string; incident: Incident }
export interface User { id: string; name: string; email: string; role: 'mpa' | 'kades' | 'bpbd' | 'admin'; organization: string; demo: boolean }
export interface VillageSummary { id: string; name: string; district: string; regency: string; province: string; peatShare: number; areaHa: number; center: [number, number]; incidents24h: number; incidents7d: number; openHigh: number }
export interface IngestStatus { runs: { id: number; finishedAt: string; source: string; feeds: { satellite: string; rows: number; inArea: number; latest: string | null; error: string | null }[]; inserted: number; error: string | null }[];
  satellites: { satellite: string; latestAcquisition: string; last24h: number }[]; intervalMinutes: number }
