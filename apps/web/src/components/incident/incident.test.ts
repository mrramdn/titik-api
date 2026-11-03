import { describe, expect, it } from 'vitest';
import type { Wind } from '../../api';
import { downwindLine, smokeSentence, windLine, windText } from './wind';

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
});
