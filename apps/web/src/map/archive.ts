// Archive mode: the map screen shows one past WIB day of real satellite data (GET /archive/days lists the days). The
// date sits in the list filters (kept in sessionStorage) and in the address as ?tanggal=, so an archive view can be
// shared. Field status and tasks are not replayed: they show as they are now.
import type { ArchiveDay, ArchiveDays, Role } from '../api';
import { isDate, shiftDate } from '../components/bpbd/data';
import { hoursSinceMidnightWib } from './style';

/** The `tanggal` in a query string: null when there is none, '' when it is not a date (live data), else the date. */
export function tanggalFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get('tanggal');
  if (value === null) return null;
  return isDate(value) ? value : '';
}

/** The query string with `tanggal` set, or without it for live data; other parameters keep their place. */
export function withTanggal(search: string, tanggal: string): string {
  const params = new URLSearchParams(search);
  if (tanggal) params.set('tanggal', tanggal);
  else params.delete('tanggal');
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** True when the archive holds that date (first..last). */
export const inArchive = (archive: ArchiveDays | null | undefined, tanggal: string) => Boolean(archive && tanggal && tanggal >= archive.first && tanggal <= archive.last);

/** The day with the most detections, the later one when two are equal; '' for an empty list. */
export function busiestDay(days: ArchiveDay[]): string {
  let best: ArchiveDay | null = null;
  for (const day of days) if (!best || day.detections > best.detections || (day.detections === best.detections && day.date > best.date)) best = day;
  return best?.date ?? '';
}

/**
 * Under this many incidents in the last 24 hours over both provinces the live map counts as quiet. From 8 to 24 October
 * 2026 there were 900 to 3,200 incidents a day, from 25 October to 3 November 50 to 500. Under 100, the map of both
 * provinces shows a few scattered points, and a first visit would not see what the app does on a busy day.
 */
export const QUIET_INCIDENTS = 100;

/**
 * The archive day to point to while the live map is quiet: the busiest one, when it had at least QUIET_INCIDENTS
 * incidents. '' in the archive, without an archive, before the count is known, or when the live map is not quiet.
 */
export function quietSuggestion(incidents24h: number | null | undefined, archive: ArchiveDays | null, tanggal: string): string {
  if (tanggal || !archive || typeof incidents24h !== 'number' || incidents24h >= QUIET_INCIDENTS) return '';
  const date = busiestDay(archive.days);
  const day = archive.days.find(item => item.date === date);
  return day && day.incidents >= QUIET_INCIDENTS ? date : '';
}

/** Bar heights for the archive chart as a share of the busiest day; a day with any detection keeps a visible sliver. */
export function barHeights(days: ArchiveDay[]): number[] {
  const top = Math.max(1, ...days.map(day => day.detections));
  return days.map(day => (day.detections > 0 ? Math.max(0.04, day.detections / top) : 0));
}

/** The first WIB day of an archive window: 24 hours is the day itself, 72 that day and the two before. */
export const windowStart = (tanggal: string, hours: number) => shiftDate(tanggal, -(Math.max(1, Math.ceil(hours / 24)) - 1));

/**
 * The hour the hotspot age colours count from: the end of the archive day (24), or now in WIB. A detection at 22.00
 * on an archive day is then "within 3 hours", one earlier that day is "that day", the days before are "older".
 */
export const ageClock = (tanggal: string, now = Date.now()) => (tanggal ? 24 : hoursSinceMidnightWib(now));

/**
 * What the incident panel offers. In the archive there is no field check from the panel (a task is assigned from the
 * live dashboard only), and a note says that field status and tasks show as they are now.
 */
export function panelActions(role: Role | undefined, archive: boolean) {
  return { check: !archive && (role === 'mpa' || role === 'admin'), notReplayed: archive };
}
