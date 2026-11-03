import { describe, expect, it } from 'vitest';
import { defaultFilters, incidentQuery, type ArchiveDays, type FwiClass, type RegencyRiskDay, type Risk, type RiskDay } from '../api';
import { ageClock, barHeights, busiestDay, inArchive, panelActions, tanggalFromSearch, windowStart, withTanggal } from './archive';
import { dailyLayerFor } from './imagery';
import { dotZoomRange, ESRI_ATTRIBUTION, ESRI_TILES, esriSource, footprintLayers, FOOTPRINT_ZOOM, imageryZoom, tileUrls } from './layers';
import { clearedFilters } from './list';
import { fwiColors, fwiLabel, highDanger, highDangerName, partialText, regencyDays, riskDetail, riskFeatures, riskFill, riskLinkDay, riskOpacity, riskPath, riskText } from './risk';

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
    expect(riskLinkDay({ riskDay: 1 })).toBe(1);
    expect(riskLinkDay({ riskDay: -1 })).toBeNull();
    expect(riskLinkDay({ signOut: true })).toBeNull();
    expect(riskLinkDay(null)).toBeNull();
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
    expect(highDanger(risk, 1)).toEqual([
      { name: 'Pulang Pisau', province: 'Kalimantan Tengah', fwiClass: 'sangat_tinggi', share: 0.8, meanFwi: 14.2 },
      { name: 'Ogan Komering Ilir', province: 'Sumatera Selatan', fwiClass: 'sedang', share: 0.3, meanFwi: 6.1 },
      { name: 'Kapuas', province: 'Kalimantan Tengah', fwiClass: 'rendah', share: 0.3, meanFwi: 3.2 },
      { name: 'Banyuasin', province: 'Sumatera Selatan', fwiClass: 'rendah', share: 0.1, meanFwi: 2.3 },
    ]);
    expect(highDanger(risk, 1, 'Sumatera Selatan').map(r => r.name)).toEqual(['Ogan Komering Ilir', 'Banyuasin']);
    expect(highDanger(risk, 0).map(r => [r.name, r.share])).toEqual([['Ogan Komering Ilir', 0.6]]);
    expect(highDanger(risk, 2).map(r => r.name)).toEqual(['Pulang Pisau']);
    expect(highDanger(risk, 7)).toEqual([]);
    expect(regencyDays(risk).get('Kalimantan Tengah/Pulang Pisau')!.fwiClass).toBe('sedang');
    expect(regencyDays(risk, 1).get('Sumatera Selatan/Banyuasin')!.partial).toEqual({ fwiClass: 'tinggi', share: 0.1 });
    expect(regencyDays({ ...risk, fetchedAt: null }).size).toBe(0);
    expect(regencyDays(null).size).toBe(0);
  });

  it('names a regency with its share at high or above, and its class when that is high or very high', () => {
    const [pulang, oki] = highDanger(risk, 1);
    expect(highDangerName(pulang!, 'id')).toBe('Pulang Pisau 80%');
    expect(highDangerName(pulang!, 'en')).toBe('Pulang Pisau 80%');
    expect(highDangerName(oki!, 'id')).toBe('Ogan Komering Ilir 30%');
    expect(highDangerName(oki!, 'en')).toBe('Ogan Komering Ilir 30%');
    expect(highDangerName(highDanger(risk, 0)[0]!, 'id')).toBe('Ogan Komering Ilir 60%');
  });

  it('puts a regency on the card by its share at high or above, the same share its recap line gives', () => {
    // Musi Rawas, 30 July 2026: moderate 46.8%, high 8.5%, very high 1.6%. High or above covers 10.1%.
    const musi = regency('Musi Rawas', 'Sumatera Selatan', [area(0, 'sedang', [0.431, 0.468, 0.085, 0.016], 4.3, { fwiClass: 'tinggi', share: 0.101 })]);
    // Murung Raya, 24 July 2026: high or above covers 13.6%.
    const murung = regency('Murung Raya', 'Kalimantan Tengah', [area(0, 'rendah', [0.483, 0.381, 0.066, 0.07], 2.6, { fwiClass: 'tinggi', share: 0.136 })]);
    const july = { ...risk, regencies: [musi, murung] };
    expect(highDanger(july, 0).map(r => [r.name, r.fwiClass, r.share])).toEqual([['Murung Raya', 'rendah', 0.136], ['Musi Rawas', 'sedang', 0.101]]);
    expect(highDanger(july, 0).map(r => highDangerName(r, 'id'))).toEqual(['Murung Raya 14%', 'Musi Rawas 10%']);
    expect(partialText(regencyDays(july).get('Kalimantan Tengah/Murung Raya')!.partial!, 'id')).toBe('tinggi atau lebih di 14% wilayah');
    expect(partialText(regencyDays(july).get('Sumatera Selatan/Musi Rawas')!.partial!, 'id')).toBe('tinggi atau lebih di 10% wilayah');
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
