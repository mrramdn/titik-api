// A thin client for /api/v1 and the response shapes shared by the API and the web app.
// Errors carry the server's code; the web app shows its own text for known codes (see i18n/common.ts).
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
    throw new ApiError(0, 'OFFLINE', 'Tidak ada sinyal.');
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, body?.error?.code ?? 'ERROR', body?.error?.message ?? 'Terjadi kesalahan.');
  return body as T;
}

/** Codes the API can return; ASSIGNMENT_OPEN and ASSIGNMENT_CLOSED come with assignments. */
export type ErrorCode = 'OFFLINE' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'INVALID_INPUT' | 'INVALID_ORIGIN' | 'INVALID_CREDENTIALS'
  | 'INVALID_IMAGE' | 'CONFLICT' | 'NO_ALERTS' | 'NO_DEVICE' | 'ASSIGNMENT_OPEN' | 'ASSIGNMENT_CLOSED' | 'INTERNAL_ERROR' | 'ERROR';

export type Level = 'tinggi' | 'sedang' | 'rendah';
export type Status = 'api_aktif' | 'asap_bara' | 'bakar_terkendali' | 'alarm_palsu' | 'tidak_terjangkau';
/** N21 NOAA-21, N20 NOAA-20, N S-NPP (VIIRS 375 m); T Terra, A Aqua (MODIS 1 km). */
export type SatelliteCode = 'N21' | 'N20' | 'N' | 'T' | 'A';
export type Sensor = 'VIIRS' | 'MODIS';
export type AssignmentStatus = 'ditugaskan' | 'menuju' | 'selesai' | 'dibatalkan';
export type Role = 'mpa' | 'kades' | 'bpbd' | 'admin';

export interface ScorePart { key: string; label: string; points: number }
/** Nearest named OSM settlement to the incident (from VIIRS points when there are any). */
export interface NearestPlace { name: string; kind: string; distanceM: number; bearingDeg: number }
export interface Assignee { id: string; name: string; organization: string }
export interface AssignmentSummary {
  id: string; status: AssignmentStatus; assignee: Assignee; assignedBy: string; note: string;
  createdAt: string; updatedAt: string; closedAt: string | null;
}
export interface LatestCheck { status: Status; observedAt: string; demo: boolean }
export interface IncidentVillage { id: string; name: string; district: string; regency: string; province: string; center: [number, number] }

export interface Incident {
  id: string; code: string; village: IncidentVillage | null;
  firstDetectedAt: string; lastDetectedAt: string;
  /** All detections; viirsCount + modisCount. */
  detectionCount: number; viirsCount: number; modisCount: number;
  /** Seen only by MODIS: location is uncertain by about locationUncertaintyM. */
  modisOnly: boolean; locationUncertaintyM: number | null;
  satellites: SatelliteCode[]; maxFrp: number | null; bestConfidence: 'low' | 'nominal' | 'high' | null;
  onPeat: boolean; nearStatic: boolean; centroid: [number, number]; settlementMeters: number | null;
  score: number; scoreParts: ScorePart[]; level: Level;
  firstVerifiedAt: string | null; latestStatus: Status | null; latestCheck: LatestCheck | null;
  assignment: AssignmentSummary | null; nearestPlace: NearestPlace | null;
  /** Indonesian text built by the server (push notifications); the web app formats its own per language. */
  card: string | null; sharePath: string;
}

export type TimelineKind = 'detected' | 'assigned' | 'enroute' | 'checked' | 'cancelled';
/** One line of the incident history. The web app writes the text; the server only sends facts. */
export interface TimelineEvent { kind: TimelineKind; at: string; satellite?: SatelliteCode; count?: number; status?: Status; actor?: string; demo?: boolean }
export interface Detection {
  id: number; satellite: SatelliteCode; sensor: Sensor; acqAt: string; latitude: number; longitude: number;
  confidence: 'low' | 'nominal' | 'high'; confidencePct: number | null; frp: number | null; brightTi4: number | null;
  scan: number | null; track: number | null; daynight: string; onPeat: boolean; nearStatic: boolean;
}
export interface Verification { id: string; status: Status; falseAlarmKind: string | null; observedAt: string; receivedAt: string; distanceMeters: number | null; demo: boolean; note?: string; photoUrl?: string | null; photoThumbUrl?: string | null; reporter?: string }
export interface IncidentDetail extends Incident { detections: Detection[]; verifications: Verification[]; timeline: TimelineEvent[] }

export interface Alert { id: string; createdAt: string; updatedAt: string; readAt: string | null; sharedAt: string | null; village: { id: string; name: string }; card: string; incident: Incident }
export interface MyAssignment extends AssignmentSummary { incident: Incident }
/** A regu MPA account that can take a task, nearest to the incident first. */
export interface AssigneeOption { id: string; name: string; organization: string; villages: string[]; distanceM: number | null; openAssignments: number }

export interface User { id: string; name: string; email: string; role: Role; organization: string; demo: boolean }
export interface VillageSummary { id: string; name: string; district: string; regency: string; province: string; peatShare: number; areaHa: number; center: [number, number]; incidents24h: number; incidents7d: number; openHigh: number }
/** One bubble per regency on the zoomed-out map. */
export interface RegionSummary { name: string; province: string; center: [number, number]; incidents: number; high: number; open: number; checked: number }

export interface Recap {
  date: string; province: string | null;
  totals: { incidents: number; high: number; checked: number; checkedShare: number | null; medianMinutes: number | null; falseAlarms: number; detections: number };
  regencies: { name: string; province: string; incidents: number; high: number; checked: number; openHigh: number; medianMinutes: number | null }[];
  villages: { id: string; name: string; district: string; regency: string; incidents: number; high: number; checked: number; detections: number }[];
  checks: Partial<Record<Status, number>>;
  assignments: Record<AssignmentStatus, number>;
}

export interface IngestSatellite {
  satellite: SatelliteCode; label: string; sensor: Sensor; active: boolean;
  latestAcquisition: string | null; latestIngestedAt: string | null; last24h: number; medianLatencyMin: number | null;
  /** The next expected pass over the two provinces and when its data usually arrives. */
  nextWindow: { start: string; end: string; expectedBy: string } | null;
}
export interface IngestStatus {
  serverTime: string; runId: number | null; intervalMinutes: number; nextRunAt: string | null;
  lastRun: { finishedAt: string | null; ok: boolean; error: string | null } | null;
  runs: { id: number; finishedAt: string; source: string; feeds: { satellite: string; rows: number; inArea: number; latest: string | null; error: string | null }[]; inserted: number; error: string | null }[];
  satellites: IngestSatellite[];
}

/** `checked` orders by the latest field check, newest first. */
export type IncidentSort = 'priority' | 'recent' | 'size' | 'checked';
export type StatusFilter = 'all' | 'open' | 'assigned' | 'checked';
export interface IncidentFilters { hours: number; levels: Level[]; status: StatusFilter; peat: boolean; regency: string; sort: IncidentSort }
export const defaultFilters: IncidentFilters = { hours: 24, levels: [], status: 'all', peat: false, regency: '', sort: 'priority' };

/**
 * Query string for GET /incidents. `levels` empty means every level; `status`: open = not checked and no open task,
 * assigned = open task (ditugaskan or menuju), checked = has a field check. The province comes from the region query.
 */
export function incidentQuery(filters: Partial<IncidentFilters>, extra = ''): string {
  const f = { ...defaultFilters, ...filters };
  const parts = [`hours=${f.hours}`, `sort=${f.sort}`];
  if (f.levels.length) parts.push(`level=${f.levels.join(',')}`);
  if (f.status !== 'all') parts.push(`status=${f.status}`);
  if (f.peat) parts.push('peat=1');
  if (f.regency) parts.push(`regency=${encodeURIComponent(f.regency)}`);
  return `?${parts.join('&')}${extra}`;
}
