import { describe, expect, it } from 'vitest';
import type { Wind } from '../../api';
import { areaText, indicatedArea } from './area';
import { downwindLine, smokeSentence, windIsCurrent, windLine, windText } from './wind';

describe('indicated hot area', () => {
  it('shows hectares in each language, marks MODIS-only areas as coarse, and nothing without an area', () => {
    expect(indicatedArea({ indicatedAreaHa: 12.46, modisOnly: false }, 'id')).toBe('12,5 ha');
    expect(indicatedArea({ indicatedAreaHa: 12.46, modisOnly: false }, 'en')).toBe('12.5 ha');
    expect(indicatedArea({ indicatedAreaHa: 186.2, modisOnly: true }, 'id')).toBe('186 ha (kasar, MODIS ±1 km)');
    expect(indicatedArea({ indicatedAreaHa: 186.2, modisOnly: true }, 'en')).toBe('186 ha (coarse, MODIS ±1 km)');
    expect(indicatedArea({ indicatedAreaHa: null, modisOnly: false }, 'id')).toBeNull();
    expect(areaText.id.help).toBe('Luas jejak piksel pada satu lintasan satelit. Bukan luas terbakar.');
    expect(Object.keys(areaText.en).sort()).toEqual(Object.keys(areaText.id).sort());
  });
});

const wind = (extra: Partial<Wind> = {}): Wind => ({
  mode: 'now', at: '2026-10-23T06:00:00Z', speedKmh: 12.4, fromDeg: 90, towardDeg: 270, calm: false,
  villages: [{ id: 'a', name: 'Sungai Pasir', distanceM: 1230, bearingDeg: 265 }, { id: 'b', name: 'Cengal', distanceM: 3420, bearingDeg: 280 }], ...extra,
});
// 23 Oct 13.40 WIB: 40 minutes into the hour the server asked for (13.00 WIB).
const now = Date.parse('2026-10-23T06:40:00Z');
const minutes = (n: number) => Date.parse('2026-10-23T06:00:00Z') + n * 60_000;

describe('wind in the incident panel', () => {
  it('says where the wind comes from and where the smoke drifts, now or at the last detection', () => {
    expect(windLine(wind(), 'id', now)).toBe('Angin sekarang dari timur, 12 km/jam · asap mengarah ke barat');
    expect(windLine(wind(), 'en', now)).toBe('Wind now from the east, 12 km/h · smoke drifts west');
    const detected = wind({ mode: 'detected', fromDeg: 225, towardDeg: 45 });
    expect(windLine(detected, 'id', now)).toBe('Angin saat terakhir terdeteksi (23 Okt 13.00 WIB): dari barat daya, 12 km/jam · asap mengarah ke timur laut');
    expect(windLine(detected, 'en', now)).toBe('Wind when last detected (23 Oct 13:00 WIB): from the southwest, 12 km/h · smoke drifts northeast');
  });

  it('gives the hour instead of "now" once that hour is over an hour old: a copy the service worker kept, or a panel left open', () => {
    expect(windIsCurrent(wind(), minutes(60))).toBe(true);
    expect(windIsCurrent(wind(), minutes(61))).toBe(false);
    expect(windIsCurrent(wind({ mode: 'detected' }), now)).toBe(false);
    expect(windLine(wind(), 'id', minutes(61))).toBe('Angin pada 23 Okt 13.00 WIB: dari timur, 12 km/jam · asap mengarah ke barat');
    expect(windLine(wind(), 'en', minutes(61))).toBe('Wind at 23 Oct 13:00 WIB: from the east, 12 km/h · smoke drifts west');
    // Two days later, offline: the cached answer still says when its wind was.
    const later = Date.parse('2026-10-25T09:00:00Z');
    expect(windLine(wind(), 'id', later)).toBe('Angin pada 23 Okt 13.00 WIB: dari timur, 12 km/jam · asap mengarah ke barat');
    expect(windLine(wind({ calm: true, speedKmh: 3, villages: [] }), 'id', later)).toBe('Angin pada 23 Okt 13.00 WIB: lemah (di bawah 5 km/jam).');
    expect(windLine(wind({ calm: true, speedKmh: 3, villages: [] }), 'en', later)).toBe('Wind at 23 Oct 13:00 WIB: light (under 5 km/h).');
    // A device clock a little behind the server's still reads the wind as now.
    expect(windLine(wind(), 'id', minutes(-5))).toBe('Angin sekarang dari timur, 12 km/jam · asap mengarah ke barat');
  });

  it('keeps it short when the wind is calm', () => {
    expect(windLine(wind({ calm: true, speedKmh: 3, villages: [] }), 'id', now)).toBe('Angin lemah (di bawah 5 km/jam).');
    expect(windLine(wind({ calm: true, speedKmh: 3, villages: [] }), 'en', now)).toBe('Light wind (under 5 km/h).');
    expect(windLine(wind({ mode: 'detected', calm: true, villages: [] }), 'id', now)).toBe('Angin saat terakhir terdeteksi (23 Okt 13.00 WIB): lemah (di bawah 5 km/jam).');
    expect(downwindLine(wind({ calm: true, villages: [] }), 'id')).toBeNull();
    expect(smokeSentence(wind({ calm: true, villages: [] }), 'id', now)).toBeNull();
  });

  it('names the villages the smoke drifts toward, with their distance, in the panel and in the WhatsApp message', () => {
    expect(downwindLine(wind(), 'id')).toBe('Desa di arah asap (≤ 5 km): Sungai Pasir (1,2 km), Cengal (3,4 km)');
    expect(downwindLine(wind(), 'en')).toBe('Villages downwind (≤ 5 km): Sungai Pasir (1.2 km), Cengal (3.4 km)');
    expect(downwindLine(wind({ villages: [] }), 'en')).toBeNull();
    expect(smokeSentence(wind(), 'id', now)).toBe('Asap mengarah ke Desa Sungai Pasir, Desa Cengal.');
    expect(smokeSentence(wind(), 'en', now)).toBe('Smoke drifts toward Sungai Pasir, Cengal.');
    expect(smokeSentence(null, 'id', now)).toBeNull();
    expect(Object.keys(windText.en).sort()).toEqual(Object.keys(windText.id).sort());
  });

  it('gives the WhatsApp message the hour of a wind that is not current, so a forwarded message says when', () => {
    expect(smokeSentence(wind(), 'id', minutes(61))).toBe('Asap mengarah ke Desa Sungai Pasir, Desa Cengal (angin pada 23 Okt 13.00 WIB).');
    expect(smokeSentence(wind(), 'en', minutes(61))).toBe('Smoke drifts toward Sungai Pasir, Cengal (wind at 23 Oct 13:00 WIB).');
    expect(smokeSentence(wind({ mode: 'detected' }), 'id', now)).toBe('Asap mengarah ke Desa Sungai Pasir, Desa Cengal (angin pada 23 Okt 13.00 WIB).');
  });

  it('gives a demo check\'s distance as approximate, the server keeping only a rounded one', async () => {
    const { checkDistance } = await import('../../pages/IncidentPanel');
    expect(checkDistance({ distanceMeters: 1234, demo: false }, 'id')).toBe('1,2 km dari titik panas');
    expect(checkDistance({ distanceMeters: 1234, demo: false }, 'en')).toBe('1.2 km from the hotspot');
    expect(checkDistance({ distanceMeters: 100_000, demo: true }, 'id')).toBe('sekitar 100 km dari titik panas');
    expect(checkDistance({ distanceMeters: 100_000, demo: true }, 'en')).toBe('about 100 km from the hotspot');
    expect(checkDistance({ distanceMeters: 900, demo: true }, 'id')).toBe('sekitar 900 m dari titik panas');
    expect(checkDistance({ distanceMeters: null, demo: true }, 'id')).toBeNull();
  });

  it('puts the smoke line into the WhatsApp message, before the links', async () => {
    Object.assign(globalThis, { location: { origin: 'https://titikapi.test' } });
    const { waText } = await import('../ui');
    const incident = { village: { id: 'v', name: 'Cengal', district: 'Cengal', regency: 'Ogan Komering Ilir', province: 'Sumatera Selatan', center: [105, -3] },
      level: 'tinggi', detectionCount: 12, onPeat: true, lastDetectedAt: '2026-10-23T06:24:00Z', nearestPlace: null, modisOnly: false, locationUncertaintyM: null,
      centroid: [105.4, -3.4], sharePath: '/k/abc' } as unknown as Parameters<typeof waText>[0];
    const lines = waText(incident, 'id', smokeSentence(wind(), 'id', now)).split('\n');
    expect(lines[2]).toBe('Asap mengarah ke Desa Sungai Pasir, Desa Cengal.');
    expect(lines[3]).toMatch(/^Lokasi: /);
    expect(waText(incident, 'id', null)).not.toContain('Asap');
  });
});
