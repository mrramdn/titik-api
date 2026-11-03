import { describe, expect, it } from 'vitest';
import { demoLinkRole, demoParam, withoutDemoParam } from './demoLink';
import { tryPath } from './routes';

const visitor = null;
const demo = (role: 'mpa' | 'kades' | 'bpbd') => ({ role, demo: true });
const real = (role: 'mpa' | 'kades' | 'bpbd' | 'admin') => ({ role, demo: false });

describe('?lihat= deep links', () => {
  it('open the demo account asked for when nobody is signed in', () => {
    expect(demoLinkRole('mpa', visitor, true)).toBe('mpa');
    expect(demoLinkRole('kades', visitor, true)).toBe('kades');
    expect(demoLinkRole('bpbd', visitor, true)).toBe('bpbd');
  });

  it('switch from one demo account to another, and leave the same one as it is', () => {
    expect(demoLinkRole('bpbd', demo('mpa'), true)).toBe('bpbd');
    expect(demoLinkRole('mpa', demo('kades'), true)).toBe('mpa');
    expect(demoLinkRole('kades', demo('bpbd'), true)).toBe('kades');
    expect(demoLinkRole('bpbd', demo('bpbd'), true)).toBeNull();
  });

  it('never switch a real account', () => {
    for (const role of ['mpa', 'kades', 'bpbd', 'admin'] as const) {
      for (const asked of ['mpa', 'kades', 'bpbd']) expect(demoLinkRole(asked, real(role), true), `${asked} over ${role}`).toBeNull();
    }
  });

  it('switch nothing while the server has not said who is signed in: a real session cookie may still be there', () => {
    // GET /auth/me failed (500, 502, 429 or no signal): the session then shows nobody, or a copy from an earlier visit.
    for (const asked of ['mpa', 'kades', 'bpbd']) {
      expect(demoLinkRole(asked, visitor, false), asked).toBeNull();
      expect(demoLinkRole(asked, demo('mpa'), false), asked).toBeNull();
      expect(demoLinkRole(asked, real('bpbd'), false), asked).toBeNull();
    }
  });

  it('ignore unknown values', () => {
    for (const value of ['', 'admin', 'publik', 'public', 'BPBD', 'bpbd ', 'demo', null]) expect(demoLinkRole(value, visitor, true), String(value)).toBeNull();
    expect(demoLinkRole('admin', demo('mpa'), true)).toBeNull();
  });

  it('open each role\'s own page from "Coba sebagai"', () => {
    expect(tryPath('bpbd')).toBe('/dasbor?lihat=bpbd');
    expect(tryPath('mpa')).toBe('/tugas?lihat=mpa');
    expect(tryPath('kades')).toBe('/desa-saya?lihat=kades');
  });

  it('read the parameter and take it out of the address, other parameters in place', () => {
    expect(demoParam('?lihat=bpbd')).toBe('bpbd');
    expect(demoParam('?range=7d')).toBeNull();
    expect(demoParam('')).toBeNull();
    expect(withoutDemoParam('?lihat=bpbd')).toBe('');
    expect(withoutDemoParam('?range=7d&lihat=bpbd&focus=action')).toBe('?range=7d&focus=action');
    expect(withoutDemoParam('?tanggal=2026-10-23&lihat=mpa')).toBe('?tanggal=2026-10-23');
  });
});
