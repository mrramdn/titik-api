import { describe, expect, it } from 'vitest';
import { defaultFilters, incidentQuery, type ArchiveDays } from '../api';
import { ageClock, barHeights, busiestDay, inArchive, panelActions, tanggalFromSearch, windowStart, withTanggal } from './archive';
import { dailyLayerFor } from './imagery';
import { dotZoomRange, ESRI_ATTRIBUTION, ESRI_TILES, esriSource, footprintLayers, FOOTPRINT_ZOOM, imageryZoom, tileUrls } from './layers';
import { clearedFilters } from './list';

const archive: ArchiveDays = {
  first: '2026-10-08', last: '2026-11-02',
  days: [
    { date: '2026-10-21', detections: 9120, incidents: 640 },
    { date: '2026-10-22', detections: 25614, incidents: 1702 },
    { date: '2026-10-23', detections: 25614, incidents: 1650 },
    { date: '2026-10-26', detections: 310, incidents: 41 },
    { date: '2026-10-27', detections: 0, incidents: 0 },
  ],
};

describe('archive mode', () => {
  it('asks the API for the archive day, and for live data without it', () => {
    expect(incidentQuery({ ...defaultFilters, tanggal: '2026-10-23' }, '&limit=300')).toBe('?hours=24&sort=priority&tanggal=2026-10-23&limit=300');
    expect(incidentQuery({ hours: 72 })).toBe('?hours=72&sort=priority');
    expect(tileUrls('deteksi', 24, 3, '2026-10-23', 'https://titikapi.test')).toEqual(['https://titikapi.test/api/v1/tiles/deteksi/{z}/{x}/{y}.mvt?hours=24&v=3&tanggal=2026-10-23']);
    expect(tileUrls('kejadian', 72, 0, '', 'https://titikapi.test')).toEqual(['https://titikapi.test/api/v1/tiles/kejadian/{z}/{x}/{y}.mvt?hours=72&v=0']);
  });

  it('keeps the archive date, the time window and the sort order when the filters are cleared', () => {
    const narrowed = { ...defaultFilters, hours: 72, sort: 'recent' as const, tanggal: '2026-10-23', levels: ['tinggi' as const], status: 'open' as const, peat: true, regency: 'Ogan Komering Ilir' };
    expect(clearedFilters(narrowed)).toEqual({ ...defaultFilters, hours: 72, sort: 'recent', tanggal: '2026-10-23' });
  });

  it('reads and writes ?tanggal= without touching other parameters', () => {
    expect(tanggalFromSearch('?tanggal=2026-10-23')).toBe('2026-10-23');
    expect(tanggalFromSearch('?tanggal=23-10-2026')).toBe('');
    expect(tanggalFromSearch('?lang=en')).toBeNull();
    expect(tanggalFromSearch('')).toBeNull();
    expect(withTanggal('', '2026-10-23')).toBe('?tanggal=2026-10-23');
    expect(withTanggal('?tanggal=2026-10-22&x=1', '2026-10-23')).toBe('?tanggal=2026-10-23&x=1');
    expect(withTanggal('?x=1&tanggal=2026-10-23', '')).toBe('?x=1');
    expect(withTanggal('?tanggal=2026-10-23', '')).toBe('');
  });

  it('opens the busiest day, scales the bars to it and knows which days the archive holds', () => {
    expect(busiestDay(archive.days)).toBe('2026-10-23');
    expect(busiestDay([])).toBe('');
    const heights = barHeights(archive.days);
    expect(heights[1]).toBe(1);
    expect(heights[3]).toBe(0.04);
    expect(heights[4]).toBe(0);
    expect(inArchive(archive, '2026-10-08')).toBe(true);
    expect(inArchive(archive, '2026-11-03')).toBe(false);
    expect(inArchive(null, '2026-10-23')).toBe(false);
    expect(windowStart('2026-10-23', 24)).toBe('2026-10-23');
    expect(windowStart('2026-10-23', 72)).toBe('2026-10-21');
    expect(windowStart('2026-11-01', 168)).toBe('2026-10-26');
  });

  it('hides the field check in the archive and says that status is not replayed', () => {
    expect(panelActions('mpa', false)).toEqual({ check: true, notReplayed: false });
    expect(panelActions('mpa', true)).toEqual({ check: false, notReplayed: true });
    expect(panelActions('admin', true).check).toBe(false);
    expect(panelActions('bpbd', false).check).toBe(false);
    expect(panelActions(undefined, true)).toEqual({ check: false, notReplayed: true });
  });

  it('counts hotspot ages from the end of the archive day, and shows that day\'s NOAA-20 image', () => {
    expect(ageClock('2026-10-23')).toBe(24);
    expect(ageClock('', Date.parse('2026-10-23T06:30:00Z'))).toBe(13.5);
    expect(dailyLayerFor('2026-10-23')).toMatchObject({ satellite: 'NOAA-20', date: '2026-10-23', part: 'midday' });
    expect(dailyLayerFor('2026-10-23').tiles).toContain('/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/2026-10-23/');
  });
});

describe('pixel footprints', () => {
  it('draws hotspots as dots below zoom 11 and as pixel boxes from it', () => {
    expect(FOOTPRINT_ZOOM).toBe(11);
    const [fill, line] = footprintLayers(24);
    expect(fill).toMatchObject({ id: 'piksel-fill', type: 'fill', source: 'deteksi', 'source-layer': 'piksel', minzoom: 11 });
    expect(line).toMatchObject({ id: 'piksel-line', type: 'line', source: 'deteksi', 'source-layer': 'piksel', minzoom: 11 });
    expect(fill!.maxzoom).toBeUndefined();
    expect(JSON.stringify(fill)).toContain('"age"');
    expect(dotZoomRange(true, true)).toEqual([8, 11]);
    expect(dotZoomRange(false, true)).toEqual([7, 11]);
    // Tiles from an older server have no footprints: the dots stay at every zoom.
    expect(dotZoomRange(true, false)).toEqual([8, 24]);
  });
});

describe('HD imagery', () => {
  it('adds Esri World Imagery only with a key, with its attribution, from zoom 11', () => {
    expect(esriSource(null)).toBeNull();
    expect(esriSource('')).toBeNull();
    const source = esriSource('AAPK test/key')!;
    expect(source.tiles).toEqual([`${ESRI_TILES}AAPK%20test%2Fkey`]);
    expect(ESRI_TILES).toBe('https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=');
    expect(source).toMatchObject({ type: 'raster', tileSize: 256, maxzoom: 19, attribution: ESRI_ATTRIBUTION });
    expect(ESRI_ATTRIBUTION).toBe('Powered by Esri · Esri, Maxar, Earthstar Geographics, and the GIS User Community');
    expect(imageryZoom(true)).toEqual({ harian: [0, 9], citra: [9, 11], esri: [11, 24] });
    expect(imageryZoom(false).citra).toEqual([9, 24]);
  });
});
