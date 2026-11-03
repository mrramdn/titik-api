import { describe, expect, it } from 'vitest';
import { signOutFlag } from './components/shell/roles';
import { riskLinkDay } from './map/risk';
import { HOME_PATH, isMapPath, legacyMapTarget, mapPath, MAP_PATH, MAP_STATE, navActive } from './routes';
import { homeFor } from './session';

const sources = import.meta.glob<string>(['./**/*.{ts,tsx}', '!./**/*.test.ts'], { query: '?raw', import: 'default', eager: true });

describe('the map at /peta', () => {
  it('builds map links with /peta, an archive day as ?tanggal=', () => {
    expect(MAP_PATH).toBe('/peta');
    expect(HOME_PATH).toBe('/');
    expect(mapPath()).toBe('/peta');
    expect(mapPath('')).toBe('/peta');
    expect(mapPath('2026-10-23')).toBe('/peta?tanggal=2026-10-23');
  });

  it('keeps the map tab on for the list and an open incident, not for the landing page or a field check', () => {
    for (const path of ['/peta', '/kejadian/5b0c', '/k/ab12cd']) expect(isMapPath(path), path).toBe(true);
    for (const path of ['/', '/kejadian/5b0c/cek', '/tugas', '/desa/12', '/tentang']) expect(isMapPath(path), path).toBe(false);
    expect(navActive(MAP_PATH, '/kejadian/5b0c')).toBe(true);
    expect(navActive(MAP_PATH, '/')).toBe(false);
    expect(navActive('/tugas', '/tugas')).toBe(true);
    expect(navActive('/tugas', '/peta')).toBe(false);
    expect(navActive('/tentang', '/tentang')).toBe(true);
  });

  it('sends a visitor without an account to the map, a signed-in role to its own page', () => {
    expect(homeFor(null)).toBe('/peta');
    expect(homeFor({ role: 'bpbd' } as Parameters<typeof homeFor>[0])).toBe('/dasbor');
    expect(homeFor({ role: 'mpa' } as Parameters<typeof homeFor>[0])).toBe('/tugas');
  });

  it('has no link or navigation left that points at / for the map', () => {
    // A link to exactly "/" or "/?…", a navigate() there, or a "/?tanggal=" address: the map is at /peta now. The logo
    // and the fallback route name HOME_PATH.
    const patterns = [
      /\b(?:to|href)(?:=\{?|:)\s*["'`]\/["'`]/, /\b(?:to|href)(?:=\{?|:)\s*["'`]\/\?/, /\bpathname:\s*["'`]\/["'`]/,
      /navigate\(\s*["'`]\/["'`?]/, /["'`]\/\?tanggal=/,
    ];
    const files = Object.entries(sources);
    expect(files.length).toBeGreaterThan(40);
    const found = files.flatMap(([file, text]) => text.split('\n').flatMap((line, index) =>
      patterns.some(pattern => pattern.test(line)) ? [`${file}:${index + 1}: ${line.trim()}`] : []));
    expect(found).toEqual([]);
  });
});

describe('old map links on /', () => {
  it('go to /peta with the same query when they carry a map parameter', () => {
    expect(legacyMapTarget('?tanggal=2026-10-23')).toBe('/peta?tanggal=2026-10-23');
    expect(legacyMapTarget('?tanggal=2026-10-23&x=1')).toBe('/peta?tanggal=2026-10-23&x=1');
    expect(legacyMapTarget('?x=1&tanggal=2026-10-22')).toBe('/peta?x=1&tanggal=2026-10-22');
    // Not a date: the map shows live data, as it did on /.
    expect(legacyMapTarget('?tanggal=kemarin')).toBe('/peta?tanggal=kemarin');
  });

  it('go to /peta when their navigation state was meant for the map', () => {
    expect(legacyMapTarget('', { riskDay: 1 })).toBe('/peta');
    expect(legacyMapTarget('', { [signOutFlag]: true })).toBe('/peta');
    expect(MAP_STATE).toContain(signOutFlag);
    expect(riskLinkDay({ riskDay: 1 })).toBe(1);
    expect(MAP_STATE).toContain('riskDay');
  });

  it('leave the landing page alone otherwise', () => {
    expect(legacyMapTarget('')).toBeNull();
    expect(legacyMapTarget('?utm_source=wa')).toBeNull();
    expect(legacyMapTarget('?lihat=bpbd')).toBeNull();
    expect(legacyMapTarget('', null)).toBeNull();
    expect(legacyMapTarget('', { from: 'somewhere' })).toBeNull();
  });
});
