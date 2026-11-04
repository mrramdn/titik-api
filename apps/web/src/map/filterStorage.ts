// The map screen's list filters, kept for the tab (sessionStorage) so a reload or a visit to another page finds them
// again. The archive date is not kept: the address is its only source (?tanggal=). A stored date used to come back on
// every map screen opened without one, so a notification, a /k/ link, "Buka peta" or a task's incident link opened a
// live incident on a past day, without "Cek lapangan". Back to an archive address still opens that day: the address
// carries it.
import { defaultFilters, type IncidentFilters } from '../api';
import { tanggalFromSearch } from './archive';

export const FILTERS_KEY = 'titikapi.filters';

/** The filters kept for this tab, without an archive date (live data). */
export function storedFilters(): IncidentFilters {
  try { return { ...defaultFilters, ...JSON.parse(sessionStorage.getItem(FILTERS_KEY) ?? '{}'), tanggal: '' }; } catch { return defaultFilters; }
}

/** Keeps the filters for this tab, all but the archive date. */
export function storeFilters(filters: IncidentFilters) {
  try { sessionStorage.setItem(FILTERS_KEY, JSON.stringify({ ...filters, tanggal: undefined })); } catch { /* private mode */ }
}

/**
 * The filters a map screen opens with: the kept ones, on the archive date in the address (/peta?tanggal=2026-10-23),
 * live data without one. `live` (the dashboard's fire danger link) opens live data whatever the address says.
 */
export function initialFilters(search: string, live = false): IncidentFilters {
  return { ...storedFilters(), tanggal: live ? '' : tanggalFromSearch(search) ?? '' };
}
