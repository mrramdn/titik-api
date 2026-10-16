import { describe, expect, it } from 'vitest';
import type { Alert, Incident } from '../../api';
import { coordText, nearestPoint, windName } from '../../geo';
import { byDistance, byPriority, groupByVillage, isChecked } from './sort';
import { villageStats, villageSummaryText } from './villageSummary';

const incident = (id: string, extra: Partial<Incident> = {}): Incident => ({
  id, code: id, village: { id: 'v1', name: 'Cengal', district: 'Cengal', regency: 'Ogan Komering Ilir', province: 'Sumatera Selatan', center: [105.42, -3.5] },
  firstDetectedAt: '2026-10-16T00:00:00Z', lastDetectedAt: '2026-10-16T01:00:00Z', detectionCount: 3, viirsCount: 3, modisCount: 0,
  modisOnly: false, locationUncertaintyM: null, satellites: ['N21'], maxFrp: 10, bestConfidence: 'nominal', onPeat: true, nearStatic: false,
  centroid: [105.4, -3.4], settlementMeters: 900, score: 50, scoreParts: [], level: 'sedang', firstVerifiedAt: null, latestStatus: null,
  latestCheck: null, assignment: null, nearestPlace: null, card: null, sharePath: `/k/${id}`, ...extra,
});
const alert = (village: string, item: Incident): Alert => ({ id: `a-${item.id}`, createdAt: '', updatedAt: '', readAt: null, sharedAt: null, village: { id: village, name: village }, card: '', incident: item });

describe('volunteer geo helpers', () => {
  it('names directions in both languages and finds the nearest detection', () => {
    expect(windName(135, 'en')).toBe('southeast');
    expect(windName(-45)).toBe('barat laut');
    const here: [number, number] = [105.0, -3.0];
    const nearest = nearestPoint(here, [[105.2, -3.2], [105.01, -3.0], [104.5, -3.5]]);
    expect(nearest?.point).toEqual([105.01, -3.0]);
    expect(Math.round(nearest!.meters / 100)).toBe(11);
    expect(nearestPoint(here, [])).toBeNull();
    expect(coordText([105.227316, -3.426918])).toBe('-3.42692, 105.22732');
  });
});

describe('volunteer lists', () => {
  it('puts unchecked high priority first, then score, then the newest', () => {
    const checkedHigh = incident('a', { level: 'tinggi', score: 90, latestCheck: { status: 'asap_bara', observedAt: '2026-10-16T02:00:00Z', demo: false } });
    const high = incident('b', { level: 'tinggi', score: 70 });
    const medium = incident('c', { level: 'sedang', score: 55 });
    const older = incident('d', { level: 'sedang', score: 55, lastDetectedAt: '2026-10-15T01:00:00Z' });
    expect([older, checkedHigh, medium, high].sort(byPriority).map(item => item.id)).toEqual(['b', 'c', 'd', 'a']);
    // Older responses only carry firstVerifiedAt: still counts as checked.
    expect(isChecked(incident('e', { firstVerifiedAt: '2026-10-16T02:00:00Z', latestCheck: undefined as unknown as null }))).toBe(true);
  });

  it('sorts by distance from the GPS fix, unchecked first', () => {
    const near = incident('near', { centroid: [105.01, -3.0] });
    const far = incident('far', { centroid: [105.5, -3.0], level: 'tinggi' });
    const checked = incident('checked', { centroid: [105.0, -3.0], firstVerifiedAt: '2026-10-16T02:00:00Z' });
    expect([far, checked, near].sort(byDistance([105.0, -3.0])).map(item => item.id)).toEqual(['near', 'far', 'checked']);
  });

  it('groups alerts by village and leads with the most urgent village', () => {
    const groups = groupByVillage([
      alert('Sungai Pasir', incident('1')),
      alert('Cengal', incident('2', { level: 'tinggi' })),
      alert('Sungai Pasir', incident('3', { firstVerifiedAt: '2026-10-16T02:00:00Z' })),
    ], byPriority);
    expect(groups.map(group => [group.village.name, group.alerts.length, group.open])).toEqual([['Cengal', 1, 1], ['Sungai Pasir', 2, 1]]);
  });
});

describe('village summary', () => {
  it('counts the week and finds the last field check, new or old response shape', () => {
    const now = Date.parse('2026-10-16T06:00:00Z');
    const items = [
      incident('1', { level: 'tinggi', lastDetectedAt: '2026-10-16T01:00:00Z', latestCheck: { status: 'api_aktif', observedAt: '2026-10-16T03:00:00Z', demo: false } }),
      incident('2', { lastDetectedAt: '2026-10-13T01:00:00Z', firstVerifiedAt: '2026-10-13T05:00:00Z', latestStatus: 'alarm_palsu' }),
      incident('3', { lastDetectedAt: '2026-10-12T01:00:00Z' }),
    ];
    expect(villageStats(items, now)).toEqual({ total: 3, day: 1, high: 1, checked: 2, open: 1, lastCheck: { at: '2026-10-16T03:00:00Z', status: 'api_aktif' }, capped: false });
    const id = villageSummaryText(items[0]!.village!, items, 'id');
    expect(id).toContain('Ringkasan Desa Cengal');
    expect(id).toContain('Titik panas perlu dicek di lapangan.');
    expect(villageSummaryText(items[0]!.village!, items, 'en')).toContain('Hotspots need a field check.');
  });
});
