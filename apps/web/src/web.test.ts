import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { bearing, distanceMeters, windName } from './geo';
import { duration, km, wib } from './format';
import { enqueue, flush, queued } from './outbox';

describe('field helpers', () => {
  it('gives distance and direction to the hotspot without a network', () => {
    const here: [number, number] = [105.0, -3.0];
    const hotspot: [number, number] = [105.01, -3.01];
    expect(Math.round(distanceMeters(here, hotspot))).toBeGreaterThan(1500);
    expect(windName(bearing(here, hotspot))).toBe('tenggara');
    expect(km(1234)).toBe('1,2 km');
    expect(duration(83)).toBe('1 j 23 mnt');
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
