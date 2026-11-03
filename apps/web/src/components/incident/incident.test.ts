import { describe, expect, it } from 'vitest';
import type { Wind } from '../../api';
import { areaText, indicatedArea } from './area';
import { downwindLine, smokeSentence, windLine, windText } from './wind';

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

describe('wind in the incident panel', () => {
  it('says where the wind comes from and where the smoke drifts, now or at the last detection', () => {
    expect(windLine(wind(), 'id')).toBe('Angin sekarang dari timur, 12 km/jam · asap mengarah ke barat');
    expect(windLine(wind(), 'en')).toBe('Wind now from the east, 12 km/h · smoke drifts west');
    const detected = wind({ mode: 'detected', fromDeg: 225, towardDeg: 45 });
    expect(windLine(detected, 'id')).toBe('Angin saat terakhir terdeteksi (23 Okt 13.00 WIB): dari barat daya, 12 km/jam · asap mengarah ke timur laut');
    expect(windLine(detected, 'en')).toBe('Wind when last detected (23 Oct 13:00 WIB): from the southwest, 12 km/h · smoke drifts northeast');
  });

  it('keeps it short when the wind is calm', () => {
    expect(windLine(wind({ calm: true, speedKmh: 3, villages: [] }), 'id')).toBe('Angin lemah (di bawah 5 km/jam).');
    expect(windLine(wind({ calm: true, speedKmh: 3, villages: [] }), 'en')).toBe('Light wind (under 5 km/h).');
    expect(windLine(wind({ mode: 'detected', calm: true, villages: [] }), 'id')).toBe('Angin saat terakhir terdeteksi (23 Okt 13.00 WIB): lemah (di bawah 5 km/jam).');
    expect(downwindLine(wind({ calm: true, villages: [] }), 'id')).toBeNull();
    expect(smokeSentence(wind({ calm: true, villages: [] }), 'id')).toBeNull();
  });

  it('names the villages the smoke drifts toward, with their distance, in the panel and in the WhatsApp message', () => {
    expect(downwindLine(wind(), 'id')).toBe('Desa di arah asap (≤ 5 km): Sungai Pasir (1,2 km), Cengal (3,4 km)');
    expect(downwindLine(wind(), 'en')).toBe('Villages downwind (≤ 5 km): Sungai Pasir (1.2 km), Cengal (3.4 km)');
    expect(downwindLine(wind({ villages: [] }), 'en')).toBeNull();
    expect(smokeSentence(wind(), 'id')).toBe('Asap mengarah ke Desa Sungai Pasir, Desa Cengal.');
    expect(smokeSentence(wind(), 'en')).toBe('Smoke drifts toward Sungai Pasir, Cengal.');
    expect(smokeSentence(null, 'id')).toBeNull();
    expect(Object.keys(windText.en).sort()).toEqual(Object.keys(windText.id).sort());
  });

  it('puts the smoke line into the WhatsApp message, before the links', async () => {
    Object.assign(globalThis, { location: { origin: 'https://titikapi.test' } });
    const { waText } = await import('../ui');
    const incident = { village: { id: 'v', name: 'Cengal', district: 'Cengal', regency: 'Ogan Komering Ilir', province: 'Sumatera Selatan', center: [105, -3] },
      level: 'tinggi', detectionCount: 12, onPeat: true, lastDetectedAt: '2026-10-23T06:24:00Z', nearestPlace: null, modisOnly: false, locationUncertaintyM: null,
      centroid: [105.4, -3.4], sharePath: '/k/abc' } as unknown as Parameters<typeof waText>[0];
    const lines = waText(incident, 'id', smokeSentence(wind(), 'id')).split('\n');
    expect(lines[2]).toBe('Asap mengarah ke Desa Sungai Pasir, Desa Cengal.');
    expect(lines[3]).toMatch(/^Lokasi: /);
    expect(waText(incident, 'id', null)).not.toContain('Asap');
  });
});
