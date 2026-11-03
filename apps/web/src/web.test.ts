import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { accountSettler, forgetAccountData } from './accountData';
import { bearing, distanceMeters, windName } from './geo';
import { duration, formatter, km, wib } from './format';
import * as common from './i18n/common';
import { enqueue, flush, queued } from './outbox';
import { fwiLabel, riskText } from './map/risk';
import { windText } from './components/incident/wind';
import { areaText } from './components/incident/area';

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

  it('writes WIB calendar dates and hectares the Indonesian and the English way', () => {
    expect(formatter('id').calendar('2026-10-23')).toBe('23 Okt 2026');
    expect(formatter('en').calendar('2026-10-23')).toBe('23 Oct 2026');
    expect(formatter('id').weekdayDate('2026-10-23')).toBe('Jumat, 23 Okt 2026');
    expect(formatter('en').weekdayDate('2026-10-23')).toBe('Friday, 23 Oct 2026');
    expect(formatter('id').ha(12.46)).toBe('12,5 ha');
    expect(formatter('en').ha(12.46)).toBe('12.5 ha');
    expect(formatter('id').ha(1234.4)).toBe('1.234 ha');
    expect(formatter('en').ha(1234.4)).toBe('1,234 ha');
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

describe('account data', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('forgets the API copies and the checks filed from this phone, and nothing else', async () => {
    const deleted: string[] = [];
    vi.stubGlobal('caches', { delete: async (name: string) => { deleted.push(name); return true; } });
    const stored = new Map([['titikapi.myChecks', '{"i":{"at":"2026-11-03T20:00:00Z","status":"asap_bara"}}'], ['titikapi.lang', 'en']]);
    vi.stubGlobal('localStorage', { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => { stored.set(key, value); },
      removeItem: (key: string) => { stored.delete(key); } });
    await forgetAccountData();
    expect(deleted).toEqual(['api']);
    expect([...stored.keys()]).toEqual(['titikapi.lang']);
  });

  it('forgets when another account or a visitor takes over, and only then applies the new account', async () => {
    const events: string[] = [];
    const settle = accountSettler<{ id: string }>({ id: 'demo-mpa' }, next => { events.push(`now ${next?.id ?? 'visitor'}`); },
      async () => { await new Promise(resolve => setTimeout(resolve, 5)); events.push('forgot'); });
    await settle({ id: 'demo-mpa' });
    await settle({ id: 'real-mpa' });
    await settle({ id: 'real-mpa' });
    await settle(null);
    await settle(null);
    expect(events).toEqual(['now demo-mpa', 'forgot', 'now real-mpa', 'now real-mpa', 'forgot', 'now visitor', 'now visitor']);
  });
});

describe('two languages', () => {
  it('has every shared label in Indonesian and English', () => {
    const shared = { ...common, riskText, fwiLabel, windText, areaText };
    for (const [name, value] of Object.entries(shared)) {
      if (value && typeof value === 'object' && 'id' in value && 'en' in value) {
        const pair = value as { id: object; en: object };
        const id = Object.keys(pair.id).sort(), en = Object.keys(pair.en).sort();
        expect(en, name).toEqual(id);
      }
    }
  });
});
