import { afterEach, describe, expect, it, vi } from 'vitest';
import { accountSettler, forgetAccountData } from './accountData';
import { bearing, distanceMeters, windName } from './geo';
import { duration, formatter, km, wib } from './format';
import * as common from './i18n/common';
import { fwiLabel, riskText } from './map/risk';
import { windText } from './components/incident/wind';
import { areaText } from './components/incident/area';
import { openMeteoText } from './components/OpenMeteo';
import { manifest } from './manifest';
import indexHtml from '../index.html?raw';

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
    const shared = { ...common, riskText, fwiLabel, windText, areaText, openMeteoText };
    for (const [name, value] of Object.entries(shared)) {
      if (value && typeof value === 'object' && 'id' in value && 'en' in value) {
        const pair = value as { id: object; en: object };
        const id = Object.keys(pair.id).sort(), en = Object.keys(pair.en).sort();
        expect(en, name).toEqual(id);
      }
    }
  });
});

describe('what the site says about itself', () => {
  const meta = (attribute: string) => new RegExp(`<meta ${attribute} content="([^"]*)"`).exec(indexHtml)?.[1] ?? '';

  it('says demo in the title, every link preview and the installed app, and not an official warning system', () => {
    const title = /<title>([^<]*)<\/title>/.exec(indexHtml)?.[1] ?? '';
    for (const [name, value] of Object.entries({ title, ogTitle: meta('property="og:title"'), siteName: meta('property="og:site_name"'), manifest: manifest.name ?? '' })) {
      expect(value, name).toMatch(/\bdemo\b/i);
    }
    for (const [name, value] of Object.entries({ description: meta('name="description"'), ogDescription: meta('property="og:description"'), manifest: manifest.description ?? '' })) {
      expect(value, name).toMatch(/^Demo portofolio /);
      expect(value, name).toMatch(/Bukan sistem peringatan resmi\.$/);
    }
    expect(meta('property="og:image"')).toBe('https://titik-api.mrramdn.com/og.png');
  });
});
