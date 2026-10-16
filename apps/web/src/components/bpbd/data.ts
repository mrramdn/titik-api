// Data for the BPBD screens: a loader that keeps the HTTP status, the three dashboard lanes and how they are counted,
// and WIB dates for the daily recap.
import { useEffect, useState } from 'react';
import { api, ApiError, type Incident, type RegionSummary, type Status } from '../../api';
import { useErrorText } from '../ui';

/** GET /dashboard as these screens read it. Every part is optional, so an older or newer server never breaks the page. */
export interface DashboardSummary {
  incidents: number; verified: number; verifiedShare: number | null; high: number; openHigh: number; falseAlarms: number; onPeat: number;
  medianMinutesToVerification: number | null; medianMinutes: number | null; detections: number;
}
export interface DashboardVillage {
  id: string; name: string; district: string; regency: string; incidents: number; detections: number; verified: number; openHigh: number;
  lastDetectedAt: string; medianMinutesToVerification: number | null;
}
export interface RecentCheck { id: string; status: Status; observedAt: string; photoThumbUrl: string | null; demo: boolean; incidentId: string }
export interface DashboardData {
  summary?: Partial<DashboardSummary>;
  villages?: DashboardVillage[];
  recentVerifications?: RecentCheck[];
  verificationsFromDemoAccounts?: { total: number; demo: number };
}

export interface Load<T> { data: T | null; error: string | null; status: number | null; loading: boolean; reload(): void }

/**
 * GET /api/v1{path} like useApi, but keeps the HTTP status so a panel can hide when its endpoint is missing (404).
 * Without signal the last data stays on screen; any other error clears it.
 */
export function useLoad<T>(path: string | null, version = 0): Load<T> {
  const [state, setState] = useState<Omit<Load<T>, 'reload'>>({ data: null, error: null, status: null, loading: Boolean(path) });
  const [tick, setTick] = useState(0);
  const describe = useErrorText();
  useEffect(() => {
    if (!path) { setState({ data: null, error: null, status: null, loading: false }); return; }
    let alive = true;
    setState(previous => ({ ...previous, loading: true }));
    api<{ data: T }>(path)
      .then(body => { if (alive) setState({ data: body?.data ?? null, error: null, status: 200, loading: false }); })
      .catch((error: unknown) => {
        if (!alive) return;
        const status = error instanceof ApiError ? error.status : null;
        setState(previous => ({ data: status === 0 ? previous.data : null, error: describe(error), status, loading: false }));
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, version]);
  return { ...state, reload: () => setTick(value => value + 1) };
}

export type LaneKey = 'action' | 'active' | 'done';
export const laneKeys: LaneKey[] = ['action', 'active', 'done'];
/** How many incidents each lane asks for; the API allows at most 300. */
export const LANE_LIMIT = 300;

const hasOpenTask = (incident: Incident) => incident.assignment?.status === 'ditugaskan' || incident.assignment?.status === 'menuju';

/** The lane an incident belongs to. Checked beats assigned, assigned beats open; the open lane holds high priority only. */
export function laneOf(incident: Incident): LaneKey | null {
  if (incident.latestCheck || incident.firstVerifiedAt) return 'done';
  if (hasOpenTask(incident)) return 'active';
  return incident.level === 'tinggi' ? 'action' : null;
}

export type LaneLists = Record<LaneKey, Incident[] | null>;

/** Puts every incident in exactly one lane, whatever each list returned (an older API ignores the status filter). */
export function splitLanes(lists: LaneLists): Record<LaneKey, Incident[]> {
  const seen = new Set<string>();
  const result: Record<LaneKey, Incident[]> = { action: [], active: [], done: [] };
  for (const lane of ['done', 'active', 'action'] as const) {
    for (const incident of lists[lane] ?? []) {
      if (seen.has(incident.id) || laneOf(incident) !== lane) continue;
      seen.add(incident.id);
      result[lane].push(incident);
    }
  }
  return result;
}

export interface Count { value: number; more: boolean }

/**
 * The one number a lane and its KPI both show, so they never disagree. A list shorter than the limit is complete;
 * a full list falls back to the server total when there is one, or reads "300+".
 */
export function laneCount(shown: number, fetched: number | null, total?: number | null): Count | null {
  if (fetched === null) return null;
  if (fetched < LANE_LIMIT) return { value: shown, more: false };
  if (typeof total === 'number' && total >= shown) return { value: total, more: false };
  return { value: shown, more: true };
}

export interface Lanes { lists: LaneLists; errors: Partial<Record<LaneKey, string>>; loading: boolean; reload(): void }
const noLists: LaneLists = { action: null, active: null, done: null };

/** The three lane lists, fetched together so a reload never shows an incident in two lanes at once. */
export function useLanes(paths: Record<LaneKey, string> | null, version = 0): Lanes {
  const [state, setState] = useState<Omit<Lanes, 'reload'>>({ lists: noLists, errors: {}, loading: Boolean(paths) });
  const [tick, setTick] = useState(0);
  const describe = useErrorText();
  const key = paths ? laneKeys.map(lane => paths[lane]).join('\n') : null;
  useEffect(() => {
    if (!paths) return;
    let alive = true;
    setState(previous => ({ ...previous, loading: true }));
    void Promise.allSettled(laneKeys.map(lane => api<{ data: Incident[] }>(paths[lane]))).then(results => {
      if (!alive) return;
      setState(previous => {
        const lists: LaneLists = { ...noLists };
        const errors: Partial<Record<LaneKey, string>> = {};
        results.forEach((result, index) => {
          const lane = laneKeys[index]!;
          if (result.status === 'fulfilled') { lists[lane] = Array.isArray(result.value?.data) ? result.value.data : []; return; }
          errors[lane] = describe(result.reason);
          lists[lane] = result.reason instanceof ApiError && result.reason.status === 0 ? previous.lists[lane] : null;
        });
        return { lists, errors, loading: false };
      });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick, version]);
  return { ...state, reload: () => setTick(value => value + 1) };
}

/**
 * Open high-priority incidents in a regency. Uses `openHigh` when the server sends it; otherwise the smaller of
 * `high` and `open`, which is the open high-priority count whichever of the two carries the open filter.
 */
export function regionOpenHigh(region: RegionSummary & { openHigh?: number }) {
  if (typeof region.openHigh === 'number') return region.openHigh;
  const high = region.high ?? 0;
  return Math.min(high, region.open ?? high);
}

/** Whole minutes from one time to another (now by default), never negative. */
export function minutesBetween(from: string, to?: string | null, now = Date.now()) {
  const end = to ? new Date(to).getTime() : now;
  return Math.max(0, Math.round((end - new Date(from).getTime()) / 60000));
}

const wibDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' });
/** Today's date in WIB as YYYY-MM-DD. */
export const todayWib = (now = new Date()) => wibDate.format(now);
/** A YYYY-MM-DD date moved by whole days. */
export function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export const isDate = (value: string | null | undefined): value is string =>
  Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
