import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { bearing, distanceMeters, windName } from './geo';
import { duration, formatter, km, wib } from './format';
import * as common from './i18n/common';
import { dailyImagery } from './satellite';
import { enqueue, flush, queued } from './outbox';

describe('field helpers', () => {
  it('gives distance and direction to the hotspot without a network', () => {
    const here: [number, number] = [105.0, -3.0];
    const hotspot: [number, number] = [105.01, -3.01];
    expect(Math.round(distanceMeters(here, hotspot))).toBeGreaterThan(1500);
    expect(windName(bearing(here, hotspot))).toBe('tenggara');
    expect(km(1234)).toBe('1,2 km');
    expect(duration(83)).toBe('1 jam 23 menit');
    expect(formatter('en').duration(83)).toBe('1 h 23 min');
    expect(formatter('en').time('2026-10-16T06:42:00Z')).toBe('13:42');
    expect(formatter('en').km(1234)).toBe('1.2 km');
    expect(wib('2026-10-16T06:42:00Z')).toBe('13.42');
  });
});

describe('outbox', () => {
  const report = (clientUuid: string) => ({ clientUuid, incidentId: 'i', incidentLabel: 'KJD', status: 'asap_bara' as const, note: '', latitude: null, longitude: null,
    accuracyM: null, observedAt: '2026-10-16T06:00:00Z', photo: null });

  it('keeps reports while there is no signal and sends them once it returns', async () => {
    await enqueue(report('a'));
    await enqueue(report('b'));
    const offline = await flush(async () => { throw new TypeError('Failed to fetch'); });
    expect(offline).toEqual({ sent: 0, left: 2 });
    expect((await queued())[0]!.attempts).toBe(1);
    const sent: string[] = [];
    const online = await flush(async item => { sent.push(item.clientUuid); return new Response('{}', { status: 201 }); });
    expect(online).toEqual({ sent: 2, left: 0 });
    expect(sent).toEqual(['a', 'b']);
  });

  it('marks a report the server rejects instead of retrying it forever', async () => {
    await enqueue(report('c'));
    await flush(async () => new Response(JSON.stringify({ error: { message: 'Status tidak valid.' } }), { status: 400 }));
    const [item] = await queued();
    expect(item!.rejected).toBe(true);
    expect(item!.lastError).toBe('Status tidak valid.');
  });
});

describe('two languages', () => {
  it('has every shared label in Indonesian and English', () => {
    for (const [name, value] of Object.entries(common)) {
      if (value && typeof value === 'object' && 'id' in value && 'en' in value) {
        const pair = value as { id: object; en: object };
        const id = Object.keys(pair.id).sort(), en = Object.keys(pair.en).sort();
        expect(en, name).toEqual(id);
      }
    }
  });
});

describe('daily satellite imagery', () => {
  it('uses the newest pass that NASA GIBS has published', () => {
    expect(dailyImagery(new Date('2026-10-16T02:00:00Z')).layer).toContain('NOAA20');   // 09.00 WIB: yesterday's midday image
    expect(dailyImagery(new Date('2026-10-16T02:00:00Z')).date).toBe('2026-10-15');
    expect(dailyImagery(new Date('2026-10-16T06:00:00Z')).satellite).toBe('Terra');      // 13.00 WIB: this morning's Terra
    expect(dailyImagery(new Date('2026-10-16T11:00:00Z')).date).toBe('2026-10-16');      // 18.00 WIB: today's NOAA-20
    expect(dailyImagery(new Date('2026-10-16T06:00:00Z')).label.id).toBe('Citra Terra, 16 Okt pagi');
  });
});
