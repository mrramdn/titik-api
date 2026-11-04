import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { defaultFilters, incidentQuery, type ArchiveDays, type FwiClass, type RegencyRiskDay, type Risk, type RiskDay } from '../api';
import { RiskDays } from './RiskParts';
import { ageClock, barHeights, busiestDay, inArchive, panelActions, tanggalFromSearch, windowStart, withTanggal } from './archive';
import { dailyLayerFor } from './imagery';
import { readConfig } from '../config';
import {
  dotZoomRange, EOX_ATTRIBUTION, EOX_TILES, ESRI_DATA_ATTRIBUTION, ESRI_TILES, esriAttribution, esriSource, esriTileError, esriWatch, footprintLayers, FOOTPRINT_ZOOM,
  imageryZoom, keepAttributionOpen, sentinelUnderEsri, tileUrls,
} from './layers';
import { clearedFilters } from './list';
import {
  fwiColors, fwiLabel, highDanger, highDangerName, partialText, regencyDays, riskAge, riskDayIndex, riskDayLabel, riskDetail, riskFeatures, riskFill, riskLinkDate, shownRiskDay,
  riskOpacity, riskPath, riskText,
} from './risk';

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

  it('asks for demo field checks and tasks on the incident tiles only while a demo account is signed in', () => {
    expect(tileUrls('kejadian', 24, 2, '', 'https://titikapi.test', true)).toEqual(['https://titikapi.test/api/v1/tiles/kejadian/{z}/{x}/{y}.mvt?hours=24&v=2&lihat=demo']);
    expect(tileUrls('kejadian', 24, 2, '2026-10-23', 'https://titikapi.test', true)[0]).toMatch(/&tanggal=2026-10-23&lihat=demo$/);
    expect(tileUrls('deteksi', 24, 2, '', 'https://titikapi.test', true)).toEqual(['https://titikapi.test/api/v1/tiles/deteksi/{z}/{x}/{y}.mvt?hours=24&v=2']);
    expect(tileUrls('kejadian', 24, 2, '', 'https://titikapi.test', false)[0]).not.toMatch(/lihat/);
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
  const poweredBy = 'Powered by <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a> · ';

  it('takes Esri World Imagery from the API (z/y/x) only when GET /config offers it, zoom 11 to 18, with its attribution', () => {
    expect(esriSource(null, 'https://titikapi.test')).toBeNull();
    expect(esriSource({ hdImagery: false, imageryAttribution: null }, 'https://titikapi.test')).toBeNull();
    const source = esriSource({ hdImagery: true, imageryAttribution: 'Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community' }, 'https://titikapi.test');
    expect(source).toEqual({ type: 'raster', tileSize: 256, minzoom: 11, maxzoom: 18, tiles: ['https://titikapi.test/api/v1/imagery/{z}/{y}/{x}'],
      attribution: `${poweredBy}Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community` });
    expect(ESRI_TILES).toBe('/api/v1/imagery/{z}/{y}/{x}');
    expect(JSON.stringify(source)).not.toMatch(/token|arcgis/);
    expect(imageryZoom(true)).toEqual({ harian: [0, 9], citra: [9, 11], esri: [11, 24] });
    expect(imageryZoom(false).citra).toEqual([9, 24]);
  });

  it('shows Esri\'s copyright text as text, and the published one when the server sends none', () => {
    expect(esriAttribution('Esri <img src=x onerror=alert(1)> & "Vantor"')).toBe(`${poweredBy}Esri &lt;img src=x onerror=alert(1)&gt; &amp; &quot;Vantor&quot;`);
    expect(esriAttribution(null)).toBe(`${poweredBy}${ESRI_DATA_ATTRIBUTION}`);
    expect(esriAttribution('  ')).toBe(`${poweredBy}${ESRI_DATA_ATTRIBUTION}`);
    expect(ESRI_DATA_ATTRIBUTION).toBe('Esri, Vantor, Earthstar Geographics, and the GIS User Community');
  });

  it('keeps Esri\'s attribution open on a map wider than 640 px while its imagery shows', () => {
    const view = { esri: true, citra: true, zoom: 11, width: 1024 };
    expect(keepAttributionOpen(view)).toBe(true);
    expect(keepAttributionOpen({ ...view, zoom: 18 })).toBe(true);
    expect(keepAttributionOpen({ ...view, width: 641 })).toBe(true);
    expect(keepAttributionOpen({ ...view, width: 640 })).toBe(false);
    expect(keepAttributionOpen({ ...view, zoom: 10.9 })).toBe(false);
    expect(keepAttributionOpen({ ...view, esri: false })).toBe(false);
    expect(keepAttributionOpen({ ...view, citra: false })).toBe(false);
  });

  it('reads GET /config: HD imagery only when the server says so, the attribution only with it', () => {
    expect(readConfig({ hdImagery: true, imageryAttribution: 'Esri' })).toEqual({ hdImagery: true, imageryAttribution: 'Esri' });
    expect(readConfig({ hdImagery: true, imageryAttribution: null })).toEqual({ hdImagery: true, imageryAttribution: null });
    expect(readConfig({ hdImagery: false, imageryAttribution: 'Esri' })).toEqual({ hdImagery: false, imageryAttribution: null });
    // A server from before the proxy sends a key instead: no HD imagery.
    expect(readConfig({ esriKey: 'AAPK' } as never)).toEqual({ hdImagery: false, imageryAttribution: null });
    expect(readConfig(null)).toEqual({ hdImagery: false, imageryAttribution: null });
  });

  it('gives way to Sentinel-2 when the API refuses Esri tiles, or after three failed tiles within a minute', () => {
    for (const status of [403, 429, 503]) expect(esriTileError(status), String(status)).toBe('off');
    for (const status of [500, 502, 504]) expect(esriTileError(status), String(status)).toBe('flaky');
    // No signal, a cancelled request and a tile outside the area (404, which MapLibre does not report anyway).
    for (const status of [0, 404, 200, undefined, '503']) expect(esriTileError(status), String(status)).toBeNull();
    expect(esriWatch()(503, 0)).toBe(true);
    const flaky = esriWatch();
    expect([flaky(502, 0), flaky(504, 20_000), flaky(0, 30_000)]).toEqual([false, false, false]);
    expect(flaky(502, 59_000)).toBe(true);
    // Failures spread over minutes are slow tiles, not Esri down.
    const slow = esriWatch();
    expect([slow(502, 0), slow(502, 40_000), slow(502, 80_000)]).toEqual([false, false, false]);
    expect(slow(502, 90_000)).toBe(true);
  });

  it('puts a coarse Sentinel-2 under Esri, from zoom 11 tiles only, for the tiles Esri does not have', () => {
    expect(sentinelUnderEsri()).toEqual({ type: 'raster', tileSize: 256, minzoom: 11, maxzoom: 11, tiles: [EOX_TILES], attribution: EOX_ATTRIBUTION });
    expect(EOX_TILES).toBe('https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/g/{z}/{y}/{x}.jpg');
  });

  it('keeps a refusal for the rest of the visit: the next map opens without Esri', async () => {
    vi.resetModules();
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ data: { hdImagery: true, imageryAttribution: 'Esri' } }), { status: 200 }));
    try {
      const { loadConfig, refuseImagery } = await import('../config');
      expect(await loadConfig()).toMatchObject({ hdImagery: true, imageryAttribution: 'Esri' });
      refuseImagery();
      expect(await loadConfig()).toEqual({ hdImagery: false, imageryAttribution: null, current: true });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

const riskDay = (date: string, fwiClass: FwiClass, fwi: number, extra: Partial<RiskDay> = {}): RiskDay => ({
  date, forecast: true, fwiClass, codes: { ffmc: 88.1, dmc: 61.2, dc: 512.4, isi: 6.3, bui: 95.5, fwi },
  noon: { tempC: 33.4, rhPct: 52.2, windKmh: 12.4, windFromDeg: 92, rain24hMm: 0.38 }, dryDays: 14, ...extra,
});
const days3 = (classes: FwiClass[], fwis: number[]) => classes.map((name, index) => riskDay(`2026-11-0${index + 3}`, name, fwis[index]!));
/** A regency's day: the class, the shares of rendah, sedang, tinggi and sangat tinggi, the mean FWI and the partial class. */
const area = (index: number, fwiClass: FwiClass, [rendah, sedang, tinggi, sangat_tinggi]: number[], meanFwi: number, partial: RegencyRiskDay['partial'] = null): RegencyRiskDay => ({
  date: `2026-11-0${index + 3}`, forecast: true, fwiClass, shares: { rendah: rendah!, sedang: sedang!, tinggi: tinggi!, sangat_tinggi: sangat_tinggi! }, partial, meanFwi,
});
const regency = (name: string, province: string, days: RegencyRiskDay[]) => ({ name, province, center: [105, -3] as [number, number], peatShare: 0.4, days });
const risk: Risk = {
  asOf: '2026-11-03', archive: false, fetchedAt: '2026-11-03T04:10:00Z', cellSize: 0.5,
  cells: [
    { lon: 105, lat: -3, days: days3(['tinggi', 'sangat_tinggi', 'sedang'], [9.4, 15.2, 4.1]) },
    { lon: 105.5, lat: -3, days: days3(['rendah', 'sedang', 'rendah'], [0.6, 3, 1]) },
  ],
  regencies: [
    regency('Ogan Komering Ilir', 'Sumatera Selatan', [area(0, 'tinggi', [0.2, 0.2, 0.6, 0], 9), area(1, 'sedang', [0.1, 0.6, 0.3, 0], 6.1, { fwiClass: 'tinggi', share: 0.3 }),
      area(2, 'sedang', [0, 1, 0, 0], 4)]),
    regency('Pulang Pisau', 'Kalimantan Tengah', [area(0, 'sedang', [0.3, 0.7, 0, 0], 5), area(1, 'sangat_tinggi', [0, 0.2, 0.25, 0.55], 14.2),
      area(2, 'tinggi', [0, 0.4, 0.6, 0], 8)]),
    regency('Banyuasin', 'Sumatera Selatan', [area(0, 'rendah', [0.9, 0.1, 0, 0], 1), area(1, 'rendah', [0.7, 0.2, 0.1, 0], 2.3, { fwiClass: 'tinggi', share: 0.1 }),
      area(2, 'rendah', [1, 0, 0, 0], 0.4)]),
    regency('Kapuas', 'Kalimantan Tengah', [area(0, 'rendah', [1, 0, 0, 0], 0.5), area(1, 'rendah', [0.65, 0.05, 0.3, 0], 3.2, { fwiClass: 'tinggi', share: 0.3 })]),
    // High on 9.9% only: left out.
    regency('Katingan', 'Kalimantan Tengah', [area(0, 'rendah', [1, 0, 0, 0], 0.5), area(1, 'rendah', [0.8, 0.101, 0.099, 0], 2, { fwiClass: 'sedang', share: 0.2 })]),
  ],
};

describe('fire danger (FWI)', () => {
  it('asks for three live days or one archive day, and reads the dashboard\'s link to tomorrow', () => {
    expect(riskPath('')).toBe('/risk');
    expect(riskPath('2026-10-23')).toBe('/risk?tanggal=2026-10-23');
    expect(riskLinkDate({ riskDate: '2026-11-04' })).toBe('2026-11-04');
    expect(riskLinkDate({ riskDate: 1 })).toBeNull();
    expect(riskLinkDate({ riskDate: 'besok' })).toBeNull();
    expect(riskLinkDate({ signOut: true })).toBeNull();
    expect(riskLinkDate(null)).toBeNull();
  });

  it('colours and names BMKG\'s four classes in both languages', () => {
    expect(riskFill.slice(2, 10)).toEqual(['rendah', fwiColors.rendah, 'sedang', fwiColors.sedang, 'tinggi', fwiColors.tinggi, 'sangat_tinggi', fwiColors.sangat_tinggi]);
    expect(new Set(Object.values(fwiColors)).size).toBe(4);
    // Around 0.35, stronger for the higher classes.
    expect(riskOpacity.slice(2, 10)).toEqual(['rendah', 0.25, 'sedang', 0.32, 'tinggi', 0.4, 'sangat_tinggi', 0.5]);
    expect(fwiLabel.id).toEqual({ rendah: 'Rendah', sedang: 'Sedang', tinggi: 'Tinggi', sangat_tinggi: 'Sangat tinggi' });
    expect(fwiLabel.en.sangat_tinggi).toBe('Very high');
    expect(Object.keys(riskText.en).sort()).toEqual(Object.keys(riskText.id).sort());
  });

  it('draws each grid cell as a square around its centre for the chosen day', () => {
    const today = riskFeatures(risk, 0);
    expect(today.features).toHaveLength(2);
    expect(today.features[0]!.properties).toEqual({ cell: 0, fwiClass: 'tinggi', fwi: 9.4 });
    expect((today.features[0]!.geometry as GeoJSON.Polygon).coordinates[0]).toEqual([[104.75, -3.25], [105.25, -3.25], [105.25, -2.75], [104.75, -2.75], [104.75, -3.25]]);
    expect(riskFeatures(risk, 1).features[0]!.properties!.fwiClass).toBe('sangat_tinggi');
    expect(riskFeatures(risk, 5).features).toHaveLength(0);
  });

  it('explains a cell: date, forecast, class, drought code with its haze note above 400, noon weather and dry days', () => {
    const id = riskDetail(risk.cells[0]!.days[0]!, 'id');
    expect(id.title).toBe('Selasa, 3 Nov 2026 · prakiraan');
    expect(id.classLine).toBe('Tinggi · FWI 9,4');
    expect(id.dcNote).toBe('DC di atas 400: kabut asap dari gambut jauh lebih sering (de Groot dkk. 2007)');
    expect(id.rows.map(row => row.value)).toEqual(['512', '33 °C', '52%', 'dari timur, 12 km/jam', '0,4 mm', '14 hari']);
    const en = riskDetail(riskDay('2026-10-23', 'sedang', 3.6, { forecast: false, codes: { ffmc: 80, dmc: 20, dc: 380, isi: 3, bui: 30, fwi: 3.6 } }), 'en');
    expect(en.title).toBe('Friday, 23 Oct 2026');
    expect(en.classLine).toBe('Moderate · FWI 3.6');
    expect(en.dcNote).toBeNull();
    expect(en.rows.find(row => row.key === 'wind')!.value).toBe('from the east, 12 km/h');
    expect(en.rows.find(row => row.key === 'rain')!.value).toBe('0.4 mm');
  });

  it('lists the regencies where high or above covers at least 10% of the area, the largest share first, then the mean FWI', () => {
    expect(highDanger(risk, '2026-11-04')).toEqual([
      { name: 'Pulang Pisau', province: 'Kalimantan Tengah', fwiClass: 'sangat_tinggi', share: 0.8, meanFwi: 14.2 },
      { name: 'Ogan Komering Ilir', province: 'Sumatera Selatan', fwiClass: 'sedang', share: 0.3, meanFwi: 6.1 },
      { name: 'Kapuas', province: 'Kalimantan Tengah', fwiClass: 'rendah', share: 0.3, meanFwi: 3.2 },
      { name: 'Banyuasin', province: 'Sumatera Selatan', fwiClass: 'rendah', share: 0.1, meanFwi: 2.3 },
    ]);
    expect(highDanger(risk, '2026-11-04', 'Sumatera Selatan').map(r => r.name)).toEqual(['Ogan Komering Ilir', 'Banyuasin']);
    expect(highDanger(risk, '2026-11-03').map(r => [r.name, r.share])).toEqual([['Ogan Komering Ilir', 0.6]]);
    expect(highDanger(risk, '2026-11-05').map(r => r.name)).toEqual(['Pulang Pisau']);
    expect(highDanger(risk, '2026-11-10')).toEqual([]);
    expect(regencyDays(risk, '2026-11-03').get('Kalimantan Tengah/Pulang Pisau')!.fwiClass).toBe('sedang');
    expect(regencyDays(risk, '2026-11-04').get('Sumatera Selatan/Banyuasin')!.partial).toEqual({ fwiClass: 'tinggi', share: 0.1 });
    expect(regencyDays({ ...risk, fetchedAt: null }, '2026-11-03').size).toBe(0);
    expect(regencyDays(null, '2026-11-03').size).toBe(0);
  });

  it('finds a day by its date, not its place: a regency missing a day does not shift the next one into its slot', () => {
    // Kapuas has 3 and 4 Nov; Katingan lacks 3 Nov (a failed weather request), so its first entry is 4 Nov.
    const gap = { ...risk, regencies: [risk.regencies[3]!, regency('Katingan', 'Kalimantan Tengah', [area(1, 'tinggi', [0, 0.2, 0.8, 0], 9.6)])] };
    expect(highDanger(gap, '2026-11-03')).toEqual([]);
    expect(highDanger(gap, '2026-11-04').map(r => r.name)).toEqual(['Katingan', 'Kapuas']);
    expect(regencyDays(gap, '2026-11-03').has('Kalimantan Tengah/Katingan')).toBe(false);
    expect(regencyDays(gap, '2026-11-04').get('Kalimantan Tengah/Katingan')!.fwiClass).toBe('tinggi');
  });

  it('names each day of the switch by its date against today in WIB, so a kept copy never calls yesterday "today"', () => {
    expect(['2026-11-03', '2026-11-04', '2026-11-05'].map(date => riskDayLabel(date, 'id', '2026-11-03'))).toEqual(['Hari ini', 'Besok', 'Lusa']);
    expect(['2026-11-03', '2026-11-04', '2026-11-05'].map(date => riskDayLabel(date, 'en', '2026-11-03'))).toEqual(['Today', 'Tomorrow', 'In 2 days']);
    // The same answer read two days later, offline: its first two days are past.
    expect(['2026-11-03', '2026-11-04', '2026-11-05'].map(date => riskDayLabel(date, 'id', '2026-11-05'))).toEqual(['3 Nov', '4 Nov', 'Hari ini']);
    expect(riskDayLabel('2026-10-31', 'id', '2026-11-01')).toBe('31 Okt');
    expect(riskDayLabel('2026-12-31', 'en', '2026-12-29')).toBe('In 2 days');
    expect(riskDayLabel('2027-01-01', 'en', '2026-12-31')).toBe('Tomorrow');
    expect(riskDayIndex(risk, '2026-11-04')).toBe(1);
    expect(riskDayIndex(risk, '2026-11-06')).toBe(-1);
    expect(riskDayIndex({ ...risk, cells: [] }, '2026-11-04')).toBe(-1);
  });

  it('opens on the chosen day, else today or the archive day, by date, so a kept copy opens on today and not on its first day', () => {
    expect(shownRiskDay(risk, null, '2026-11-03')).toBe(0);
    // The 3 Nov answer kept until 4 Nov: today is its second day.
    expect(shownRiskDay(risk, null, '2026-11-04')).toBe(1);
    // The dashboard's link to tomorrow, made from that answer or a newer one, finds its date.
    expect(shownRiskDay(risk, '2026-11-05', '2026-11-04')).toBe(2);
    // A date the answer lacks falls back to today, then to the first day.
    expect(shownRiskDay(risk, '2026-11-06', '2026-11-04')).toBe(1);
    expect(shownRiskDay(risk, null, '2026-11-09')).toBe(0);
    expect(shownRiskDay(null, '2026-11-04', '2026-11-04')).toBe(0);
  });

  it('says how old the live forecast is once it passes 6 hours, never for an archive day', () => {
    const at = (hours: number) => Date.parse('2026-11-03T04:10:00Z') + hours * 3_600_000;
    expect(riskAge(risk, 'id', at(2))).toBeNull();
    expect(riskAge(risk, 'id', at(6))).toBeNull();
    expect(riskAge(risk, 'id', at(8.5))).toBe('Dihitung 8 jam lalu');
    expect(riskAge(risk, 'en', at(8.5))).toBe('Computed 8 hours ago');
    expect(riskAge(risk, 'id', at(30))).toBe('Dihitung 1 hari lalu');
    expect(riskAge(risk, 'en', at(30))).toBe('Computed 1 day ago');
    expect(riskAge(risk, 'en', at(50))).toBe('Computed 2 days ago');
    expect(riskAge({ ...risk, archive: true }, 'id', at(500))).toBeNull();
    expect(riskAge({ ...risk, fetchedAt: null }, 'id', at(50))).toBeNull();
  });

  it('shows the map\'s day switch by date with the forecast\'s age, from a copy kept two days ago', () => {
    const days = (data: Risk, day = 0) => renderToStaticMarkup(createElement(RiskDays, { risk: { data, error: null, loading: false, reload() {} }, day, onDay() {} }));
    vi.useFakeTimers();
    try {
      // 3 Nov 13.00 WIB, two hours after the run: today, tomorrow and the day after, no age.
      vi.setSystemTime(new Date('2026-11-03T06:10:00Z'));
      const fresh = days(risk);
      expect([...fresh.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map(match => match[1])).toEqual(['Hari ini', 'Besok', 'Lusa']);
      expect(fresh).not.toContain('Dihitung');
      // 5 Nov 09.00 WIB, offline: the same answer from the service worker.
      vi.setSystemTime(new Date('2026-11-05T02:00:00Z'));
      const kept = days(risk);
      expect([...kept.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map(match => match[1])).toEqual(['3 Nov', '4 Nov', 'Hari ini']);
      expect(kept).toContain('<span>Dihitung 1 hari lalu</span>');
      // The archive shows its date and no age.
      const archived = days({ ...risk, archive: true, asOf: '2026-10-23', cells: risk.cells.map(cell => ({ ...cell, days: cell.days.slice(0, 1) })) });
      expect(archived).toContain('23 Okt 2026');
      expect(archived).not.toContain('Dihitung');
    } finally {
      vi.useRealTimers();
    }
  });

  it('names a regency with its share at high or above, and its class when that is high or very high', () => {
    const [pulang, oki] = highDanger(risk, '2026-11-04');
    expect(highDangerName(pulang!, 'id')).toBe('Pulang Pisau 80%');
    expect(highDangerName(pulang!, 'en')).toBe('Pulang Pisau 80%');
    expect(highDangerName(oki!, 'id')).toBe('Ogan Komering Ilir 30%');
    expect(highDangerName(oki!, 'en')).toBe('Ogan Komering Ilir 30%');
    expect(highDangerName(highDanger(risk, '2026-11-03')[0]!, 'id')).toBe('Ogan Komering Ilir 60%');
  });

  it('puts a regency on the card by its share at high or above, the same share its recap line gives', () => {
    // Musi Rawas, 30 July 2026: moderate 46.8%, high 8.5%, very high 1.6%. High or above covers 10.1%.
    const musi = regency('Musi Rawas', 'Sumatera Selatan', [area(0, 'sedang', [0.431, 0.468, 0.085, 0.016], 4.3, { fwiClass: 'tinggi', share: 0.101 })]);
    // Murung Raya, 24 July 2026: high or above covers 13.6%.
    const murung = regency('Murung Raya', 'Kalimantan Tengah', [area(0, 'rendah', [0.483, 0.381, 0.066, 0.07], 2.6, { fwiClass: 'tinggi', share: 0.136 })]);
    const july = { ...risk, regencies: [musi, murung] };
    expect(highDanger(july, '2026-11-03').map(r => [r.name, r.fwiClass, r.share])).toEqual([['Murung Raya', 'rendah', 0.136], ['Musi Rawas', 'sedang', 0.101]]);
    expect(highDanger(july, '2026-11-03').map(r => highDangerName(r, 'id'))).toEqual(['Murung Raya 14%', 'Musi Rawas 10%']);
    expect(partialText(regencyDays(july, '2026-11-03').get('Kalimantan Tengah/Murung Raya')!.partial!, 'id')).toBe('tinggi atau lebih di 14% wilayah');
    expect(partialText(regencyDays(july, '2026-11-03').get('Sumatera Selatan/Musi Rawas')!.partial!, 'id')).toBe('tinggi atau lebih di 10% wilayah');
  });

  it('writes the recap\'s line for a higher class over part of a regency', () => {
    expect(partialText({ fwiClass: 'tinggi', share: 0.3 }, 'id')).toBe('tinggi atau lebih di 30% wilayah');
    expect(partialText({ fwiClass: 'tinggi', share: 0.3 }, 'en')).toBe('high or above in 30% of the area');
    expect(partialText({ fwiClass: 'sangat_tinggi', share: 0.12 }, 'id')).toBe('sangat tinggi di 12% wilayah');
    expect(partialText({ fwiClass: 'sangat_tinggi', share: 0.12 }, 'en')).toBe('very high in 12% of the area');
    expect(partialText({ fwiClass: 'sedang', share: 0.2 }, 'id')).toBe('sedang atau lebih di 20% wilayah');
    expect(partialText({ fwiClass: 'sedang', share: 0.2 }, 'en')).toBe('moderate or above in 20% of the area');
  });
});
