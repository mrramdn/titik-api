// The incident list beside the map: filter, sort and count with the same meaning as the API and the map layer.
import type { Incident, IncidentFilters, IncidentSort } from '../api';

type Checkable = Pick<Incident, 'latestCheck' | 'firstVerifiedAt' | 'assignment'>;
/** checked = has a field check; assigned = an open task (ditugaskan or menuju) and no check yet; open = neither. */
export function incidentState(incident: Checkable): 'checked' | 'assigned' | 'open' {
  if (incident.latestCheck ?? incident.firstVerifiedAt) return 'checked';
  const task = incident.assignment;
  return task && (task.status === 'ditugaskan' || task.status === 'menuju') ? 'assigned' : 'open';
}

export function matchesFilters(incident: Incident, filters: IncidentFilters) {
  if (filters.levels.length && !filters.levels.includes(incident.level)) return false;
  if (filters.status !== 'all' && incidentState(incident) !== filters.status) return false;
  if (filters.peat && !incident.onPeat) return false;
  if (filters.regency && incident.village?.regency !== filters.regency) return false;
  return true;
}

const urgent = (incident: Incident) => (incident.level === 'tinggi' && incidentState(incident) !== 'checked' ? 1 : 0);
export function sortIncidents(rows: Incident[], sort: IncidentSort) {
  const copy = [...rows];
  if (sort === 'recent') return copy.sort((a, b) => b.lastDetectedAt.localeCompare(a.lastDetectedAt) || b.score - a.score);
  if (sort === 'size') return copy.sort((a, b) => b.detectionCount - a.detectionCount || b.score - a.score);
  return copy.sort((a, b) => urgent(b) - urgent(a) || b.score - a.score || b.lastDetectedAt.localeCompare(a.lastDetectedAt));
}

/** True when the rows come from an API that applies the filters and the priority order itself. */
export const servedFiltered = (rows: Incident[]) => rows.length > 0 && 'assignment' in rows[0]!;

/**
 * The rows to show. The API filters already; the same filters run here too so the list always agrees with the chips
 * and the status lines, also against an older API that ignores some of them. Priority order is the API's own when it
 * sends it; "recent" and "size" are sorted here.
 */
export function prepareRows(rows: Incident[], filters: IncidentFilters) {
  const kept = rows.filter(row => matchesFilters(row, filters));
  return filters.sort === 'priority' && servedFiltered(rows) ? kept : sortIncidents(kept, filters.sort);
}

export interface ListSummary { incidents: number; highOpen: number; detections: number; atLeast: boolean }
export function summarize(rows: Incident[], atLeast = false): ListSummary {
  return {
    incidents: rows.length,
    highOpen: rows.filter(row => row.level === 'tinggi' && incidentState(row) !== 'checked').length,
    detections: rows.reduce((sum, row) => sum + (row.detectionCount ?? 0), 0),
    atLeast,
  };
}

/** Any filter other than the time window and the sort order. */
export const narrowed = (filters: IncidentFilters) => filters.levels.length > 0 || filters.status !== 'all' || filters.peat || filters.regency !== '';
