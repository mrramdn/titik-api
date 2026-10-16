import { describe, expect, it } from 'vitest';
import type { Incident, Recap } from '../../api';
import { LANE_LIMIT, isDate, laneCount, laneOf, minutesBetween, regionOpenHigh, shiftDate, splitLanes, todayWib } from './data';
import { longDate, recapText } from './recapText';
import { villagesFor } from './VillageTable';

const incident = (id: string, extra: Partial<Incident> = {}) => ({
  id, level: 'tinggi', firstVerifiedAt: null, latestCheck: null, assignment: null, ...extra,
}) as Incident;
const task = (status: 'ditugaskan' | 'menuju' | 'selesai' | 'dibatalkan') => ({
  id: `t-${status}`, status, assignee: { id: 'u', name: 'Regu MPA Cengal', organization: 'MPA' }, assignedBy: 'b', note: '',
  createdAt: '2026-10-16T01:00:00Z', updatedAt: '2026-10-16T01:00:00Z', closedAt: null,
});

describe('dashboard lanes', () => {
  it('puts an incident in exactly one lane: checked, then assigned, then open high priority', () => {
    expect(laneOf(incident('a'))).toBe('action');
    expect(laneOf(incident('b', { level: 'sedang' }))).toBeNull();
    expect(laneOf(incident('c', { assignment: task('menuju') }))).toBe('active');
    expect(laneOf(incident('d', { assignment: task('dibatalkan') }))).toBe('action');
    expect(laneOf(incident('e', { assignment: task('ditugaskan'), latestCheck: { status: 'asap_bara', observedAt: '2026-10-16T02:00:00Z', demo: false } }))).toBe('done');
    // Older API: no assignment or latestCheck fields, only firstVerifiedAt.
    expect(laneOf({ id: 'f', level: 'tinggi', firstVerifiedAt: '2026-10-16T02:00:00Z' } as Incident)).toBe('done');
  });

  it('never shows an incident twice when the lists overlap (an older API ignores status)', () => {
    const open = incident('open'), assigned = incident('assigned', { assignment: task('ditugaskan') });
    const checked = incident('checked', { firstVerifiedAt: '2026-10-16T02:00:00Z' });
    const everything = [open, assigned, checked];
    const lanes = splitLanes({ action: everything, active: everything, done: everything });
    expect(lanes.action.map(i => i.id)).toEqual(['open']);
    expect(lanes.active.map(i => i.id)).toEqual(['assigned']);
    expect(lanes.done.map(i => i.id)).toEqual(['checked']);
    expect(splitLanes({ action: null, active: null, done: null })).toEqual({ action: [], active: [], done: [] });
  });

  it('counts a complete list exactly and falls back to the server total for a full one', () => {
    expect(laneCount(3, null)).toBeNull();
    expect(laneCount(0, null, 7)).toEqual({ value: 7, more: false });
    expect(laneCount(12, 40, 99)).toEqual({ value: 12, more: false });
    expect(laneCount(280, LANE_LIMIT, 412)).toEqual({ value: 412, more: false });
    expect(laneCount(280, LANE_LIMIT, 100)).toEqual({ value: 280, more: false });
    expect(laneCount(280, LANE_LIMIT)).toEqual({ value: 280, more: true });
    // An older server ignores status=assigned and sends 300 incidents, none of them assigned: the lane is empty.
    expect(laneCount(0, LANE_LIMIT)).toEqual({ value: 0, more: false });
  });

  it('reads open high priority per regency whichever field carries it', () => {
    const base = { name: 'Ogan Komering Ilir', province: 'Sumatera Selatan', center: [105, -3] as [number, number], incidents: 120, checked: 3 };
    expect(regionOpenHigh({ ...base, high: 30, open: 14 })).toBe(14);
    expect(regionOpenHigh({ ...base, high: 14, open: 80 })).toBe(14);
    expect(regionOpenHigh({ ...base, high: 30, open: 14, openHigh: 9 } as never)).toBe(9);
  });

  it('filters the village table with the same focus as the numbers', () => {
    const village = (id: string, openHigh: number, verified: number, median: number | null) => ({
      id, name: id, district: 'd', regency: 'r', incidents: 5, detections: 9, verified, openHigh, lastDetectedAt: '2026-10-16T00:00:00Z', medianMinutesToVerification: median,
    });
    const rows = [village('a', 0, 2, 90), village('b', 3, 0, null), village('c', 1, 1, 30)];
    expect(villagesFor(rows, 'all').map(v => v.id)).toEqual(['a', 'b', 'c']);
    expect(villagesFor(rows, 'action').map(v => v.id)).toEqual(['b', 'c']);
    expect(villagesFor(rows, 'checked').map(v => v.id)).toEqual(['a', 'c']);
    expect(villagesFor(rows, 'response').map(v => v.id)).toEqual(['a', 'c']);
  });
});

describe('recap helpers', () => {
  it('works in WIB dates', () => {
    expect(todayWib(new Date('2026-10-15T18:30:00Z'))).toBe('2026-10-16');
    expect(shiftDate('2026-10-01', -1)).toBe('2026-09-30');
    expect(isDate('2026-10-16')).toBe(true);
    expect(isDate('16/10/2026')).toBe(false);
    expect(isDate(null)).toBe(false);
    expect(minutesBetween('2026-10-16T01:00:00Z', '2026-10-16T02:23:00Z')).toBe(83);
    expect(minutesBetween('2026-10-16T03:00:00Z', '2026-10-16T02:00:00Z')).toBe(0);
    expect(longDate('2026-10-16', 'id')).toBe('Jumat, 16 Oktober 2026');
    expect(longDate('2026-10-16', 'en')).toBe('Friday, 16 October 2026');
    expect(longDate('not a date', 'id')).toBe('not a date');
  });

  it('writes the WhatsApp summary in the chosen language', () => {
    const recap: Recap = {
      date: '2026-10-16', province: 'Sumatera Selatan',
      totals: { incidents: 1299, high: 40, checked: 130, checkedShare: 0.1, medianMinutes: 83, falseAlarms: 2, detections: 15020 },
      regencies: [
        { name: 'Ogan Komering Ilir', province: 'Sumatera Selatan', incidents: 400, high: 12, checked: 30, openHigh: 5, medianMinutes: 70 },
        { name: 'Banyu Asin', province: 'Sumatera Selatan', incidents: 0, high: 0, checked: 0, openHigh: 0, medianMinutes: null },
      ],
      villages: [],
      checks: { asap_bara: 5, api_aktif: 3 },
      assignments: { ditugaskan: 1, menuju: 0, selesai: 4, dibatalkan: 0 },
    };
    const id = recapText(recap, 'id', 'Sumatera Selatan', 'https://titikapi.test/rekap?date=2026-10-16').split('\n');
    expect(id[0]).toBe('Rekap harian Titik Api, Sumatera Selatan');
    expect(id[1]).toBe('Jumat, 16 Oktober 2026');
    expect(id).toContain('Kejadian: 1.299, prioritas tinggi 40');
    expect(id).toContain('Sudah dicek: 130 dari 1.299 (10%)');
    expect(id).toContain('Waktu tanggap (median): 1 jam 23 menit');
    expect(id).toContain('Ogan Komering Ilir: 400 kejadian, 12 prioritas tinggi, 30 dicek');
    expect(id.join('\n')).not.toContain('Banyu Asin');
    expect(id).toContain('Hasil cek lapangan: 3 api aktif, 5 asap atau bara');
    expect(id).toContain('Penugasan: 1 ditugaskan, 4 selesai');
    expect(id.at(-1)).toBe('Rincian: https://titikapi.test/rekap?date=2026-10-16');
    const en = recapText(recap, 'en', 'Sumatera Selatan', 'https://titikapi.test/rekap').split('\n');
    expect(en).toContain('Checked: 130 of 1,299 (10%)');
    expect(en).toContain('Response time (median): 1 h 23 min');
    expect(en).toContain('Assignments: 1 assigned, 4 done');
  });
});
