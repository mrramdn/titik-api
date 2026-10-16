// What the top bar says about data freshness, read from GET /ingest/status. Works with the pass-aware shape
// (lastRun, nextWindow per satellite) and with the older one (runs and the newest acquisition only).
import type { IngestStatus, Sensor } from '../../api';
import { satelliteName, sensorOf } from '../../i18n/common';

export interface PassWindow { start: string; end: string; expectedBy: string }
/** The next pass whose data has not arrived yet, with an estimate of when it lands. */
export interface NextPass extends PassWindow {
  /** When the data usually lands: the middle of the window plus the satellite's median delay. */
  arrival: string;
  /** The window has begun (or is over) and its data is on the way. */
  started: boolean;
  codes: string[];
}
export interface SatelliteRow {
  code: string; label: string; sensor: Sensor; active: boolean; latest: string | null; next: PassWindow | null;
  /** The window's data should have arrived by now and has not. */
  overdue: boolean;
  latencyMin: number | null;
}
export interface Freshness {
  /** Newest acquisition across satellites. */
  latest: { at: string; code: string } | null;
  /** When the server last looked at NASA FIRMS. */
  checkedAt: string | null;
  intervalMinutes: number;
  nextRunAt: string | null;
  /** The earliest pass still to arrive; passes that overlap it are announced with it. */
  next: NextPass | null;
  /** True only when a pass window's data should have arrived and has not. */
  stale: boolean;
  /** The last ingest run ended with an error. */
  failed: boolean;
  satellites: SatelliteRow[];
}

const order = ['N21', 'N20', 'N', 'T', 'A'];
const MINUTE = 60_000;
const time = (iso: string) => new Date(iso).getTime();
const iso = (ms: number) => new Date(ms).toISOString();
const rank = (code: string) => { const index = order.indexOf(code); return index === -1 ? order.length : index; };

/** Typical arrival: mid-window plus the median delay; without a measured delay, halfway between the end and expectedBy. */
function arrivalOf(window: PassWindow, latencyMin: number | null, now: number) {
  const start = time(window.start), end = time(window.end), by = time(window.expectedBy);
  const typical = latencyMin !== null && latencyMin >= 0 ? (start + end) / 2 + latencyMin * MINUTE : (end + by) / 2;
  const at = Math.min(typical, by);
  // Past the usual delay the data can still come until expectedBy.
  return at > now ? at : by;
}

/** Reads the status; `now` should be the server's clock when it is known. */
export function readFreshness(status: Partial<IngestStatus> | null | undefined, now = Date.now()): Freshness | null {
  if (!status) return null;
  const satellites: SatelliteRow[] = (Array.isArray(status.satellites) ? status.satellites : []).filter(s => s && s.satellite).map(s => {
    const sensor = s.sensor ?? sensorOf(s.satellite);
    const window = s.nextWindow?.start && s.nextWindow.end ? { start: s.nextWindow.start, end: s.nextWindow.end, expectedBy: s.nextWindow.expectedBy ?? s.nextWindow.end } : null;
    const active = s.active !== false;
    const latest = s.latestAcquisition ?? null;
    const overdue = Boolean(active && window && now > time(window.expectedBy) && (!latest || time(latest) < time(window.start)));
    const latency = typeof s.medianLatencyMin === 'number' && Number.isFinite(s.medianLatencyMin) ? s.medianLatencyMin : null;
    return { code: s.satellite, label: s.label || `${satelliteName(s.satellite)} (${sensor})`, sensor, active, latest, next: window, overdue, latencyMin: latency };
  }).sort((a, b) => rank(a.code) - rank(b.code));

  const newest = satellites.filter(s => s.latest).sort((a, b) => time(b.latest!) - time(a.latest!))[0];
  const upcoming = satellites.filter(s => s.active && s.next && time(s.next.expectedBy) > now)
    .map(s => ({ ...s.next!, arrival: arrivalOf(s.next!, s.latencyMin, now), code: s.code }))
    .sort((a, b) => time(a.start) - time(b.start) || a.arrival - b.arrival);
  let next: (PassWindow & { arrival: number; codes: string[] }) | null = null;
  for (const window of upcoming) {
    if (!next) { next = { start: window.start, end: window.end, expectedBy: window.expectedBy, arrival: window.arrival, codes: [window.code] }; continue; }
    // NOAA-21, NOAA-20 and S-NPP cross within minutes of each other: overlapping windows are one pass. A window that
    // only begins when this one ends (Aqua after VIIRS) is a later pass.
    if (time(window.start) >= time(next.end)) break;
    if (time(window.end) > time(next.end)) next.end = window.end;
    if (time(window.expectedBy) > time(next.expectedBy)) next.expectedBy = window.expectedBy;
    next.arrival = Math.min(next.arrival, window.arrival);
    next.codes.push(window.code);
  }
  return {
    latest: newest ? { at: newest.latest!, code: newest.code } : null,
    checkedAt: status.lastRun?.finishedAt ?? status.runs?.[0]?.finishedAt ?? null,
    intervalMinutes: status.intervalMinutes ?? 30,
    nextRunAt: status.nextRunAt ?? null,
    next: next ? { start: next.start, end: next.end, expectedBy: next.expectedBy, arrival: iso(next.arrival), started: time(next.start) <= now, codes: next.codes } : null,
    stale: satellites.some(s => s.overdue),
    failed: status.lastRun ? status.lastRun.ok === false : Boolean(status.runs?.[0]?.error),
    satellites,
  };
}

/**
 * Milliseconds to add to the browser clock to get the server clock. Small differences only: a status served from
 * the offline cache carries an old serverTime and must not shift the clock by hours.
 */
export function clockOffset(serverTime: string | null | undefined, receivedAt = Date.now()) {
  const server = serverTime ? time(serverTime) : NaN;
  const offset = server - receivedAt;
  return Number.isFinite(offset) && Math.abs(offset) < 15 * MINUTE ? offset : 0;
}

/** Rough time until something arrives: "±5 menit" style minutes under 50 minutes, whole hours after. */
export function roughMinutes(minutes: number): { unit: 'min' | 'hour'; n: number } | null {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  if (minutes < 50) return { unit: 'min', n: Math.max(5, Math.round(minutes / 5) * 5) };
  return { unit: 'hour', n: Math.max(1, Math.round(minutes / 60)) };
}
