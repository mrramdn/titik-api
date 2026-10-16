// What the top bar says about data freshness, read from GET /ingest/status. Works with the pass-aware shape
// (lastRun, nextWindow per satellite) and with the older one (runs and the newest acquisition only).
import type { IngestStatus, Sensor } from '../../api';
import { satelliteName, sensorOf } from '../../i18n/common';

export interface PassWindow { start: string; end: string; expectedBy: string }
export interface SatelliteRow { code: string; label: string; sensor: Sensor; active: boolean; latest: string | null; next: PassWindow | null; overdue: boolean }
export interface Freshness {
  /** Newest acquisition across satellites. */
  latest: { at: string; code: string } | null;
  /** When the server last looked at NASA FIRMS. */
  checkedAt: string | null;
  intervalMinutes: number;
  nextRunAt: string | null;
  /** The earliest pass still to arrive, widened by passes that follow right after it. */
  next: PassWindow | null;
  /** True only when a pass window's data should have arrived and has not. */
  stale: boolean;
  /** The last ingest run ended with an error. */
  failed: boolean;
  satellites: SatelliteRow[];
}

const order = ['N21', 'N20', 'N', 'T', 'A'];
const time = (iso: string) => new Date(iso).getTime();
/** Passes that start within this gap of the previous one are announced as one window. */
const joinGapMs = 10 * 60_000;

export function readFreshness(status: Partial<IngestStatus> | null | undefined, now = Date.now()): Freshness | null {
  if (!status) return null;
  const satellites: SatelliteRow[] = (Array.isArray(status.satellites) ? status.satellites : []).map(s => {
    const sensor = s.sensor ?? sensorOf(s.satellite);
    const window = s.nextWindow?.start && s.nextWindow.end ? { start: s.nextWindow.start, end: s.nextWindow.end, expectedBy: s.nextWindow.expectedBy ?? s.nextWindow.end } : null;
    const active = s.active !== false;
    const latest = s.latestAcquisition ?? null;
    const overdue = Boolean(active && window && now > time(window.expectedBy) && (!latest || time(latest) < time(window.start)));
    return { code: s.satellite, label: s.label || `${satelliteName(s.satellite)} (${sensor})`, sensor, active, latest, next: window, overdue };
  }).sort((a, b) => rank(a.code) - rank(b.code));

  const newest = satellites.filter(s => s.latest).sort((a, b) => time(b.latest!) - time(a.latest!))[0];
  const upcoming = satellites.filter(s => s.active && s.next && time(s.next.expectedBy) > now).map(s => s.next!).sort((a, b) => time(a.start) - time(b.start));
  let next: PassWindow | null = null;
  for (const window of upcoming) {
    if (!next) { next = { ...window }; continue; }
    if (time(window.start) > time(next.end) + joinGapMs) break;
    if (time(window.end) > time(next.end)) next.end = window.end;
    if (time(window.expectedBy) < time(next.expectedBy)) next.expectedBy = window.expectedBy;
  }
  return {
    latest: newest ? { at: newest.latest!, code: newest.code } : null,
    checkedAt: status.lastRun?.finishedAt ?? status.runs?.[0]?.finishedAt ?? null,
    intervalMinutes: status.intervalMinutes ?? 30,
    nextRunAt: status.nextRunAt ?? null,
    next,
    stale: satellites.some(s => s.overdue),
    failed: status.lastRun ? status.lastRun.ok === false : Boolean(status.runs?.[0]?.error),
    satellites,
  };
}

function rank(code: string) { const index = order.indexOf(code); return index === -1 ? order.length : index; }

/** Rough time until something arrives: "±5 menit" style minutes under an hour, whole hours after. */
export function roughMinutes(minutes: number): { unit: 'min' | 'hour'; n: number } | null {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  if (minutes < 50) return { unit: 'min', n: Math.max(5, Math.round(minutes / 5) * 5) };
  return { unit: 'hour', n: Math.max(1, Math.round(minutes / 60)) };
}
