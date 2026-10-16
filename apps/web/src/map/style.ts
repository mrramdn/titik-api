// MapLibre expressions for the incident, hotspot and regency layers. Tile properties: kejadian {id, level, count,
// score, verified, peat, assigned?}, deteksi {confidence, inside, age?, sensor?, satellite?}. Missing properties
// read as false or null, so older tiles keep working.
import type { ExpressionSpecification, FilterSpecification } from 'maplibre-gl';
import type { Level, StatusFilter } from '../api';

/** Filters applied to the incident layer on the map (same meaning as the list filters). */
export interface MapFilters { levels?: Level[]; status?: StatusFilter; peat?: boolean }

export const colors = {
  high: '#E5381C', medium: '#F08C00', low: '#8E8A85', checked: '#2F9E44', assigned: '#1971C2', ink: '#161312', line: '#57514B',
  newest: '#C2410C', today: '#EA7A3B', older: '#A8A29E',
} as const;

type E = ExpressionSpecification;
const flag = (name: string): E => ['to-boolean', ['get', name]];
const verified = flag('verified');
const assigned = ['all', ['!', verified], flag('assigned')] as E;
const level = ['get', 'level'] as E;
const count = ['to-number', ['get', 'count'], 1] as E;
export const modisOnly = ['any', flag('modisOnly'), flag('modis_only')] as E;

/** The list filters as a MapLibre filter on the incident layer; null when nothing is filtered. */
export function incidentFilter(filters: MapFilters = {}): FilterSpecification | null {
  const parts: E[] = [];
  if (filters.levels?.length) parts.push(['in', level, ['literal', filters.levels]]);
  if (filters.status === 'checked') parts.push(verified);
  else if (filters.status === 'assigned') parts.push(assigned);
  else if (filters.status === 'open') parts.push(['all', ['!', verified], ['!', flag('assigned')]]);
  if (filters.peat) parts.push(flag('peat'));
  return parts.length ? (['all', ...parts] as FilterSpecification) : null;
}
/** The check badge sits on checked incidents that pass the filters. */
export const checkedFilter = (filters: MapFilters = {}): FilterSpecification => {
  const base = incidentFilter(filters);
  return (base ? ['all', verified, base] : verified) as FilterSpecification;
};

/** Three size classes by hotspot count: 1–4, 5–19, 20 and more. */
export const sizeBreaks = [5, 20] as const;
const sizeClass = ['step', count, 0, sizeBreaks[0], 1, sizeBreaks[1], 2] as E;
/** Circle radius per zoom for each size class. */
const radiusStops: [number, [number, number, number]][] = [[5, [3, 4.5, 6]], [8, [4.5, 7, 10]], [12, [6.5, 10, 14]], [15, [8, 12.5, 17]]];
const bySize = (pick: (radius: number) => unknown) => radiusStops.flatMap(([zoom, sizes]) => [zoom, ['match', sizeClass, 0, pick(sizes[0]), 1, pick(sizes[1]), pick(sizes[2])]]);
export const incidentRadius = ['interpolate', ['linear'], ['zoom'], ...bySize(radius => radius)] as E;
/** The check badge sits on the circle's upper right edge. */
export const badgeOffset = ['interpolate', ['linear'], ['zoom'], ...bySize(radius => ['literal', [radius * 0.75, -radius * 0.75]])] as E;

export const levelColor = ['match', level, 'tinggi', colors.high, 'sedang', colors.medium, colors.low] as E;
/** Green ring when checked, blue ring when assigned, a thin white edge otherwise. */
export const incidentStroke = ['case', verified, colors.checked, assigned, colors.assigned, '#ffffff'] as E;
export const incidentStrokeWidth = ['interpolate', ['linear'], ['zoom'], 8, ['case', ['any', verified, assigned], 2.5, 1], 13, ['case', ['any', verified, assigned], 3.5, 1.5]] as E;
/** Seen by MODIS only: drawn paler, the location is uncertain by about 1 km. */
export const incidentOpacity = ['case', modisOnly, 0.55, 0.95] as E;
/** Unchecked first (tinggi on top), then checked; smaller circles above larger ones of the same rank. */
export const incidentSortKey = ['-', ['+', ['case', verified, 0, 3], ['match', level, 'tinggi', 2, 'sedang', 1, 0]], ['/', ['min', count, 999], 1000]] as E;

/** Hotspot age classes the tiles may send: a label, or the age in hours. */
const newestLabels = ['3h', 'recent', 'new', 'newest', 'latest', 'baru'];
const todayLabels = ['today', 'hari_ini', 'day'];
/**
 * A value per hotspot age: within 3 hours, earlier today (WIB) or older. Falls back to `fallback` when the tile has no
 * `age` property. `hoursToday` is the number of hours since midnight WIB.
 */
export function byAge(values: { newest: unknown; today: unknown; older: unknown }, fallback: unknown, hoursToday: number): E {
  const age = ['get', 'age'];
  return ['case',
    ['==', ['typeof', age], 'number'], ['case', ['<=', ['to-number', age], 3], values.newest, ['<=', ['to-number', age], Math.max(3, hoursToday)], values.today, values.older],
    ['==', ['typeof', age], 'string'], ['match', ['to-string', age], newestLabels, values.newest, todayLabels, values.today, values.older],
    fallback] as E;
}
const confidenceColor = ['match', ['get', 'confidence'], 'high', colors.newest, 'nominal', colors.today, colors.older] as E;
export const detectionColor = (hoursToday: number) => byAge({ newest: colors.newest, today: colors.today, older: colors.older }, confidenceColor, hoursToday);
export const detectionOpacity = (hoursToday: number) => ['*', ['case', flag('inside'), 1, 0.45], byAge({ newest: 0.95, today: 0.8, older: 0.5 }, 0.8, hoursToday)] as E;
export const detectionRadius = ['interpolate', ['linear'], ['zoom'], 7, 1.4, 12, 3, 15, 6] as E;
/** MODIS pixels are 1 km: their hotspots get a ring of about 1 km radius (at the latitude of the two provinces). */
export const modisDetection = ['any', ['==', ['get', 'sensor'], 'MODIS'], ['in', ['to-string', ['get', 'satellite']], ['literal', ['T', 'A']]]] as FilterSpecification;
export const kilometreRadius = ['interpolate', ['exponential', 2], ['zoom'], 8, 1.64, 16, 419] as E;

/** Regency bubbles: the number is the open high-priority count, the size follows all incidents. */
export const bubbleRadius = ['interpolate', ['linear'], ['sqrt', ['to-number', ['get', 'incidents'], 0]], 1, 11, 10, 17, 30, 26, 60, 34] as E;
export const bubbleColor = ['case', ['>', ['to-number', ['get', 'label'], 0], 0], colors.high, colors.line] as E;

/** Hours since midnight in WIB (UTC+7, no daylight saving). */
export const hoursSinceMidnightWib = (now = Date.now()) => (((now / 3_600_000 + 7) % 24) + 24) % 24;
