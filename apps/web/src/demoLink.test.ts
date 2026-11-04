import { describe, expect, it } from 'vitest';
import { demoLinkHandler, demoLinkRole, demoParam, withoutDemoParam, type DemoLinkEntry } from './demoLink';
import type { DemoRole } from './routes';
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

/** The handler with a fake router: `on` is the entry on screen, sign-ins wait until `finish` is called. */
function rig() {
  let on = '';
  const signIns: DemoRole[] = [];
  const replaced: { key: string; search: string; state: unknown }[] = [];
  const pending: { resolve(): void; reject(): void }[] = [];
  const handle = demoLinkHandler({
    signInDemo: role => { signIns.push(role); return new Promise<void>((resolve, reject) => pending.push({ resolve, reject: () => reject(new Error('HTTP 500')) })); },
    replace: (entry, search) => { replaced.push({ key: entry.key, search, state: entry.state }); on = `${entry.key}*`; },
    currentKey: () => on,
  });
  const open = (key: string, path: string, state: unknown = null): DemoLinkEntry => {
    on = key;
    const [pathname, search = ''] = path.split('?');
    return { key, pathname: pathname!, search: search ? `?${search}` : '', hash: '', state };
  };
  return { handle, open, signIns, replaced, pending, goTo: (key: string) => { on = key; } };
}

describe('the ?lihat= handler', () => {
  it('signs in to the account asked for, then takes ?lihat= out of the same entry, other parameters and state kept', async () => {
    const r = rig();
    const done = r.handle(r.open('a', '/dasbor?range=7d&lihat=bpbd', { from: 'landing' }), visitor, true);
    expect(r.signIns).toEqual(['bpbd']);
    expect(r.replaced).toEqual([]);
    r.pending[0]!.resolve();
    await done;
    expect(r.replaced).toEqual([{ key: 'a', search: '?range=7d', state: { from: 'landing' } }]);
  });

  it('never signs in over a real account, or while the session check failed, and still cleans the address', async () => {
    for (const [user, checked] of [[real('bpbd'), true], [visitor, false], [real('mpa'), false]] as const) {
      const r = rig();
      await r.handle(r.open('a', '/dasbor?lihat=bpbd'), user, checked);
      expect(r.signIns, JSON.stringify({ user, checked })).toEqual([]);
      expect(r.replaced).toEqual([{ key: 'a', search: '', state: null }]);
    }
  });

  it('reads an entry once, as React strict mode runs the effect twice', async () => {
    const r = rig();
    const entry = r.open('a', '/tugas?lihat=mpa');
    const first = r.handle(entry, visitor, true);
    expect(r.handle(entry, visitor, true)).toBeNull();
    r.pending[0]!.resolve();
    await first;
    expect(r.signIns).toEqual(['mpa']);
    expect(r.replaced).toHaveLength(1);
  });

  it('leaves the address alone when the visitor moved on before the sign-in returned, and reads the entry again on return', async () => {
    const r = rig();
    const entry = r.open('a', '/dasbor?lihat=bpbd');
    const done = r.handle(entry, visitor, true);
    // A click on Tentang in the top bar, or Back, while the sign-in is under way.
    r.goTo('b');
    r.pending[0]!.resolve();
    await done;
    expect(r.replaced).toEqual([]);
    // Back on that entry (Forward): now signed in to that demo account, the parameter goes.
    r.goTo('a');
    await r.handle(entry, demo('bpbd'), true);
    expect(r.signIns).toEqual(['bpbd']);
    expect(r.replaced).toEqual([{ key: 'a', search: '', state: null }]);
  });

  it('cleans the address after a failed sign-in as well, so the page shows what a visitor sees', async () => {
    const r = rig();
    const done = r.handle(r.open('a', '/desa-saya?lihat=kades'), visitor, true);
    r.pending[0]!.reject();
    await done;
    expect(r.replaced).toEqual([{ key: 'a', search: '', state: null }]);
  });

  it('does nothing on an address without ?lihat=', () => {
    const r = rig();
    expect(r.handle(r.open('a', '/dasbor?range=7d'), visitor, true)).toBeNull();
    expect(r.signIns).toEqual([]);
    expect(r.replaced).toEqual([]);
  });
});
