// Order of the volunteer's lists. Pure functions, so they are easy to test.
import type { Alert, Incident, Level } from '../../api';
import { distanceMeters } from '../../geo';

const levelRank: Record<Level, number> = { tinggi: 0, sedang: 1, rendah: 2 };

/** Checked in the field by anyone (the server's latest check, or the older first-verified fields). */
export const isChecked = (incident: Pick<Incident, 'latestCheck' | 'firstVerifiedAt'>) => Boolean(incident.latestCheck ?? incident.firstVerifiedAt);

export type Order = 'priority' | 'nearest';
type Sortable = Pick<Incident, 'level' | 'score' | 'lastDetectedAt' | 'centroid' | 'latestCheck' | 'firstVerifiedAt'>;

/** Not checked first, then high before medium, then the higher score, then the newest. */
export function byPriority(a: Sortable, b: Sortable) {
  return Number(isChecked(a)) - Number(isChecked(b)) || (levelRank[a.level] ?? 3) - (levelRank[b.level] ?? 3)
    || b.score - a.score || b.lastDetectedAt.localeCompare(a.lastDetectedAt);
}

/** Not checked first, then the nearest to `here`. */
export const byDistance = (here: [number, number]) => (a: Sortable, b: Sortable) =>
  Number(isChecked(a)) - Number(isChecked(b)) || distanceMeters(here, a.centroid) - distanceMeters(here, b.centroid) || byPriority(a, b);

export const comparator = (order: Order, here: [number, number] | null) => (order === 'nearest' && here ? byDistance(here) : byPriority);

export interface VillageGroup { village: { id: string; name: string }; alerts: Alert[]; open: number }

/** Alerts per subscribed village; groups follow their most urgent (or nearest) alert. */
export function groupByVillage(alerts: Alert[], compare: (a: Sortable, b: Sortable) => number): VillageGroup[] {
  const groups = new Map<string, VillageGroup>();
  for (const alert of alerts) {
    const group = groups.get(alert.village.id) ?? { village: alert.village, alerts: [], open: 0 };
    group.alerts.push(alert);
    if (!isChecked(alert.incident)) group.open++;
    groups.set(alert.village.id, group);
  }
  const list = [...groups.values()];
  for (const group of list) group.alerts.sort((a, b) => compare(a.incident, b.incident));
  return list.sort((a, b) => compare(a.alerts[0]!.incident, b.alerts[0]!.incident) || a.village.name.localeCompare(b.village.name));
}
