// @vitest-environment happy-dom
// The field check page in a browser-like DOM, with its session, its outbox (on fake IndexedDB) and a stubbed API.
import 'fake-indexeddb/auto';
import { createElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../api';
import { renderDom, until, type Rendered } from '../renderDom';

const INCIDENT = '2a63ef7d-1f58-417a-890a-517152535ec4';
const mpa: User = { id: '10000000-0000-4000-8000-000000000001', name: 'Relawan MPA (demo)', email: 'mpa@titikapi.test', role: 'mpa', organization: 'MPA', demo: true };
const detail = {
  id: INCIDENT, code: 'qgfkjsm', village: { id: 'v', name: 'Sungai Pasir', district: 'Cengal', regency: 'Ogan Komering Ilir', province: 'Sumatera Selatan', center: [105.5, -3.7] },
  detectionCount: 2, nearestPlace: null, detections: [], centroid: [105.57, -3.71], modisOnly: false, locationUncertaintyM: null, level: 'tinggi',
};

/** The API as the page reaches it: who the session cookie belongs to, and what each request got. */
function server() {
  const state = { session: mpa as User | null, signal: true, calls: [] as string[] };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost');
    const method = init?.method ?? 'GET';
    state.calls.push(`${method} ${url.pathname}`);
    if (url.pathname === '/api/v1/auth/me') return json({ data: state.session });
    if (url.pathname === `/api/v1/incidents/${INCIDENT}` && method === 'GET') return json({ data: detail });
    if (url.pathname === `/api/v1/incidents/${INCIDENT}/verifications` && method === 'POST') {
      if (!state.signal) throw new TypeError('Failed to fetch');
      return state.session ? json({ data: { id: 'x', duplicate: false } }, 201) : json({ error: { code: 'UNAUTHENTICATED', message: 'Sesi berakhir. Masuk lagi untuk melanjutkan.' } }, 401);
    }
    return json({ error: { code: 'NOT_FOUND', message: 'Tidak ditemukan.' } }, 404);
  });
  return { state, fetch };
}

type App = { outbox: typeof import('../outbox') };
let view: Rendered | null = null;
/** The page at /kejadian/:id/cek, with /masuk as the sign-in page; modules fresh, so the outbox starts as a page load finds it. */
async function open(): Promise<App> {
  vi.resetModules();
  const [{ SessionProvider }, { VerifyPage }, { LangProvider }, outbox] = await Promise.all([
    import('../session'), import('./Verify'), import('../i18n'), import('../outbox'),
  ]);
  view = await renderDom(createElement(LangProvider, null, createElement(SessionProvider, null,
    createElement(MemoryRouter, { initialEntries: [`/kejadian/${INCIDENT}/cek`] }, createElement(Routes, null,
      createElement(Route, { path: '/kejadian/:id/cek', element: createElement(VerifyPage) }),
      createElement(Route, { path: '/masuk', element: createElement('p', { id: 'masuk' }, 'Halaman masuk') }),
    )))));
  return { outbox };
}
const page = () => view!;
const status = (value: string) => page().host.querySelector<HTMLInputElement>(`input[name=status][value=${value}]`);
async function submit() {
  status('asap_bara')!.click();
  await until(() => status('asap_bara')!.checked);
  page().host.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
}

let api: ReturnType<typeof server>;
beforeEach(async () => {
  api = server();
  vi.stubGlobal('fetch', api.fetch);
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { watchPosition: () => 1, clearWatch() {} } });
  localStorage.clear();
  localStorage.setItem('titikapi.user', JSON.stringify(mpa));
  const { queued, discard } = await import('../outbox');
  for (const item of await queued()) await discard(item.clientUuid);
});
afterEach(async () => {
  await view?.unmount();
  view = null;
  vi.unstubAllGlobals();
});

describe('the field check page', () => {
  it('shows the result of a report the server met with a 401, with a way to sign in again, instead of leaving for /masuk', async () => {
    const { outbox } = await open();
    await until(() => Boolean(status('asap_bara')));
    // The session ends on the server while the form is open.
    api.state.session = null;
    await submit();
    await until(() => Boolean(page().host.querySelector('.v-result') || page().host.querySelector('#masuk')));
    // The 401 made the session ask again, and the server said nobody is signed in.
    await until(() => api.state.calls.filter(call => call === 'GET /api/v1/auth/me').length === 2);
    await until(() => !page().host.querySelector('button[type=submit]'));
    expect(page().host.querySelector('#masuk')).toBeNull();
    expect(page().host.querySelector('.v-result strong')?.textContent).toBe('Sesi berakhir, masuk lagi untuk mengirim');
    const again = page().host.querySelector<HTMLAnchorElement>('.v-stack a[href="/masuk"]');
    expect(again?.textContent).toBe('Masuk lagi');
    expect(page().host.querySelector('.v-stack a[href="/tugas"]')).toBeNull();
    // The report waits in the outbox for the account to sign in again.
    const [report] = await outbox.queued();
    expect(report).toMatchObject({ userId: mpa.id, rejected: false, lastError: 'Sesi berakhir. Masuk lagi untuk melanjutkan.' });
    expect(api.state.calls.filter(call => call.startsWith('POST'))).toHaveLength(1);
  });

  it('keeps a waiting report\'s result on screen when the 401 comes later, as the signal returns', async () => {
    const { outbox } = await open();
    await until(() => Boolean(status('asap_bara')));
    api.state.signal = false;
    await submit();
    await until(() => page().host.querySelector('.v-result strong')?.textContent === 'Menunggu sinyal, dikirim otomatis');
    // The session ends meanwhile; the signal comes back and the outbox tries again (startOutboxSync's tick).
    api.state.session = null;
    api.state.signal = true;
    await outbox.flush();
    await until(() => api.state.calls.filter(call => call === 'GET /api/v1/auth/me').length === 2);
    await until(() => page().host.querySelector('.v-result strong')?.textContent === 'Sesi berakhir, masuk lagi untuk mengirim');
    // Give a redirect every chance to happen.
    await new Promise(done => setTimeout(done, 50));
    await until(() => page().host.querySelector('.v-result strong')?.textContent === 'Sesi berakhir, masuk lagi untuk mengirim');
    expect(page().host.querySelector('#masuk')).toBeNull();
    expect(page().host.querySelector('.v-stack a[href="/masuk"]')?.textContent).toBe('Masuk lagi');
  });

  describe('follows a switch in another tab', () => {
    const kades: User = { ...mpa, id: '10000000-0000-4000-8000-000000000002', name: 'Kepala desa (demo)', email: 'kades@titikapi.test', role: 'kades' };
    /** The other tab switches: the session cookie is the new account's, and that tab stores it; this tab hears of it. */
    const otherTab = (user: User | null) => {
      api.state.session = user;
      if (user) localStorage.setItem('titikapi.user', JSON.stringify(user)); else localStorage.removeItem('titikapi.user');
      window.dispatchEvent(new StorageEvent('storage', { key: 'titikapi.user', oldValue: JSON.stringify(mpa), newValue: user ? JSON.stringify(user) : null }));
    };

    it('a waiting report\'s result then says it waits for its account to sign in again', async () => {
      await open();
      await until(() => Boolean(status('asap_bara')));
      api.state.signal = false;
      await submit();
      await until(() => page().host.querySelector('.v-result strong')?.textContent === 'Menunggu sinyal, dikirim otomatis');
      otherTab(kades);
      await until(() => page().host.querySelector('.v-result strong')?.textContent === 'Sesi berakhir, masuk lagi untuk mengirim');
      expect(page().host.querySelector('.v-stack a[href="/masuk"]')?.textContent).toBe('Masuk lagi');
    });

    it('the open form gives way to the note on who files field checks, or to /masuk after a sign-out', async () => {
      await open();
      await until(() => Boolean(status('asap_bara')));
      otherTab(kades);
      await until(() => page().text().includes('Cek lapangan diisi oleh relawan MPA'));
      expect(page().host.querySelector('form')).toBeNull();
      otherTab(null);
      await until(() => Boolean(page().host.querySelector('#masuk')));
    });
  });

  it('still sends a visitor without an account to /masuk', async () => {
    localStorage.removeItem('titikapi.user');
    api.state.session = null;
    await open();
    await until(() => Boolean(page().host.querySelector('#masuk')));
    expect(page().host.querySelector('form')).toBeNull();
  });
});
