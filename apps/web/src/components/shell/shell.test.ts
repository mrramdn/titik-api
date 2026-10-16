import { describe, expect, it } from 'vitest';
import type { Incident, IngestSatellite, IngestStatus } from '../../api';
import { defaultFilters } from '../../api';
import { clockOffset, readFreshness, roughMinutes } from './freshness';
import { incidentState, matchesFilters, prepareRows, summarize } from '../../map/list';
import { incidentFilter } from '../../map/style';
import { dailyLayer } from '../../map/imagery';

const now = Date.parse('2026-10-16T02:11:00Z'); // 09.11 WIB
const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString();
const window = (start: number, end: number) => ({ start: at(start), end: at(end), expectedBy: at(end + 180) });
const sat = (satellite: IngestSatellite['satellite'], extra: Partial<IngestSatellite>): IngestSatellite => ({
  satellite, label: '', sensor: satellite === 'T' || satellite === 'A' ? 'MODIS' : 'VIIRS', active: true, latestAcquisition: null, latestIngestedAt: null,
  last24h: 0, medianLatencyMin: null, nextWindow: null, ...extra,
});
const status = (satellites: IngestSatellite[]): IngestStatus => ({
  serverTime: at(0), runId: 7, intervalMinutes: 30, nextRunAt: at(19), lastRun: { finishedAt: at(0), ok: true, error: null }, runs: [], satellites,
});

describe('freshness in the top bar', () => {
  it('names the newest pass and joins overlapping VIIRS windows, not the Aqua pass after them', () => {
    const info = readFreshness(status([
      sat('N21', { latestAcquisition: at(-500), nextWindow: window(200, 300), medianLatencyMin: 110 }),
      sat('N20', { latestAcquisition: at(-520), nextWindow: window(210, 320), medianLatencyMin: 120 }),
      sat('A', { latestAcquisition: at(-360), nextWindow: window(320, 420) }),
    ]), now)!;
    expect(info.latest).toEqual({ at: at(-360), code: 'A' });
    expect(info.next).toMatchObject({ start: at(200), end: at(320), started: false, codes: ['N21', 'N20'] });
    // NOAA-21: middle of 200–300 plus 110 minutes of delay.
    expect(info.next!.arrival).toBe(at(360));
    expect(info.stale).toBe(false);
    expect(info.checkedAt).toBe(at(0));
  });

  it('turns amber only when a window has passed its expected time without newer data', () => {
    const late = readFreshness(status([sat('N21', { latestAcquisition: at(-900), nextWindow: window(-400, -300) })]), now)!;
    expect(late.stale).toBe(true);
    expect(late.next).toBeNull();
    const arrived = readFreshness(status([sat('N21', { latestAcquisition: at(-350), nextWindow: window(-400, -300) })]), now)!;
    expect(arrived.stale).toBe(false);
    const inactive = readFreshness(status([sat('N', { active: false, nextWindow: window(-400, -300) })]), now)!;
    expect(inactive.stale).toBe(false);
  });

  it('says a pass under way is on its way, until its expected time', () => {
    const info = readFreshness(status([sat('N21', { nextWindow: window(-60, 40), medianLatencyMin: 30 })]), now)!;
    expect(info.next).toMatchObject({ started: true });
    // Middle of the window (-10) plus 30 minutes of delay.
    expect(info.next!.arrival).toBe(at(20));
    // With a 5 minute delay the usual time is behind us: the deadline is what is left.
    const late = readFreshness(status([sat('N21', { nextWindow: window(-60, 40), medianLatencyMin: 5 })]), now)!;
    expect(late.next!.arrival).toBe(at(40 + 180));
  });

  it('reads the older status shape without pass windows', () => {
    const old = { intervalMinutes: 30, runs: [{ id: 3, finishedAt: at(-5), source: 'live', feeds: [], inserted: 0, error: null }],
      satellites: [{ satellite: 'N21', latestAcquisition: at(-400), last24h: 10 }, { satellite: 'N', latestAcquisition: at(-450), last24h: 5 }] } as unknown as IngestStatus;
    const info = readFreshness(old, now)!;
    expect(info).toMatchObject({ latest: { code: 'N21' }, checkedAt: at(-5), next: null, stale: false, failed: false });
    expect(info.satellites.map(s => s.label)).toEqual(['NOAA-21 (VIIRS)', 'S-NPP (VIIRS)']);
    expect(readFreshness(null)).toBeNull();
  });

  it('trusts the server clock only for small differences', () => {
    expect(clockOffset(at(2), now)).toBe(120_000);
    expect(clockOffset(at(-600), now)).toBe(0);
    expect(clockOffset(undefined, now)).toBe(0);
  });

  it('rounds the wait to five minutes under an hour and to hours after', () => {
    expect(roughMinutes(12)).toEqual({ unit: 'min', n: 10 });
    expect(roughMinutes(200)).toEqual({ unit: 'hour', n: 3 });
    expect(roughMinutes(-1)).toBeNull();
  });
});

const incident = (extra: Partial<Incident>): Incident => ({
  id: 'i', code: 'c', village: { id: 'v', name: 'Cengal', district: 'Cengal', regency: 'Ogan Komering Ilir', province: 'Sumatera Selatan', center: [105, -3] },
  firstDetectedAt: at(-60), lastDetectedAt: at(-60), detectionCount: 3, viirsCount: 3, modisCount: 0, modisOnly: false, locationUncertaintyM: null,
  satellites: ['N21'], maxFrp: 10, bestConfidence: 'nominal', onPeat: false, nearStatic: false, centroid: [105, -3], settlementMeters: 900, score: 50,
  scoreParts: [], level: 'sedang', firstVerifiedAt: null, latestStatus: null, latestCheck: null, assignment: null, nearestPlace: null, card: null, sharePath: '/k/c',
  ...extra,
});
const task = (status: 'ditugaskan' | 'menuju' | 'selesai') => ({ id: 'a', status, assignee: { id: 'u', name: 'Regu', organization: 'MPA' }, assignedBy: 'b', note: '',
  createdAt: at(-30), updatedAt: at(-30), closedAt: null });

describe('incident list and map filters', () => {
  it('sorts incidents into checked, assigned and open the way the API does', () => {
    expect(incidentState(incident({}))).toBe('open');
    expect(incidentState(incident({ assignment: task('menuju') }))).toBe('assigned');
    expect(incidentState(incident({ assignment: task('selesai') }))).toBe('open');
    expect(incidentState(incident({ assignment: task('menuju'), firstVerifiedAt: at(-5) }))).toBe('checked');
  });

  it('filters and counts the rows with the chips that are on', () => {
    const rows = [
      incident({ id: 'a', level: 'tinggi', score: 80, onPeat: true, detectionCount: 30 }),
      incident({ id: 'b', level: 'tinggi', score: 70, firstVerifiedAt: at(-10), latestStatus: 'asap_bara' }),
      incident({ id: 'c', level: 'sedang', score: 50, lastDetectedAt: at(-1) }),
    ];
    const high = { ...defaultFilters, levels: ['tinggi' as const] };
    expect(rows.filter(row => matchesFilters(row, high)).map(row => row.id)).toEqual(['a', 'b']);
    expect(prepareRows(rows, { ...defaultFilters, status: 'checked' }).map(row => row.id)).toEqual(['b']);
    expect(prepareRows(rows, { ...defaultFilters, sort: 'recent' }).map(row => row.id)).toEqual(['c', 'a', 'b']);
    expect(prepareRows(rows, { ...defaultFilters, sort: 'size' })[0]!.id).toBe('a');
    expect(summarize(rows)).toEqual({ incidents: 3, highOpen: 1, detections: 36, atLeast: false });
  });

  it('builds the same filter for the map layer', () => {
    expect(incidentFilter({})).toBeNull();
    expect(incidentFilter({ levels: ['tinggi'], peat: true })).toEqual(['all', ['in', ['get', 'level'], ['literal', ['tinggi']]], ['to-boolean', ['get', 'peat']]]);
    expect(JSON.stringify(incidentFilter({ status: 'assigned' }))).toContain('assigned');
  });
});

describe('daily imagery layer', () => {
  it('uses the newest image NASA GIBS has published', () => {
    expect(dailyLayer(new Date('2026-10-16T02:00:00Z'))).toMatchObject({ satellite: 'NOAA-20', date: '2026-10-15', part: 'midday' });
    expect(dailyLayer(new Date('2026-10-16T06:00:00Z'))).toMatchObject({ satellite: 'Terra', date: '2026-10-16', part: 'morning' });
    expect(dailyLayer(new Date('2026-10-16T11:00:00Z')).tiles).toContain('/2026-10-16/');
  });
});
