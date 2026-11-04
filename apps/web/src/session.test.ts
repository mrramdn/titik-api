// @vitest-environment happy-dom
// The session in a browser-like DOM: what the screen and the outbox are told when GET /auth/me answers, fails or hangs.
import 'fake-indexeddb/auto';
import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from './api';
import type { QueuedReport, Sender } from './outbox';
import { advance, renderDom, type Rendered } from './renderDom';

const mpa: User = { id: '10000000-0000-4000-8000-000000000001', name: 'Relawan MPA (demo)', email: 'mpa@titikapi.test', role: 'mpa', organization: 'MPA', demo: true };

/** One answer of GET /auth/me: a status the server sent without one, no signal, a request that hangs, or who is signed in. */
type Answer = 503 | 429 | 'no signal' | 'hangs' | User | null;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function authMe(answers: Answer[]) {
  return vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    const next = answers.length ? answers.shift()! : null;
    if (next === 'no signal') return Promise.reject(new TypeError('Failed to fetch'));
    if (next === 'hangs') return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError'))));
    if (next === 503 || next === 429) return Promise.resolve(json({ error: { code: 'ERROR', message: 'Service Unavailable' } }, next));
    return Promise.resolve(json({ data: next }));
  });
}

type Session = ReturnType<typeof import('./session')['useSession']>;
let view: Rendered | null = null;
let session: Session;
/** A page load: fresh modules (the outbox knows no account yet), the session provider and a line saying what it holds. */
async function load() {
  vi.resetModules();
  const [{ SessionProvider, useSession }, outbox] = await Promise.all([import('./session'), import('./outbox')]);
  function Probe() {
    session = useSession();
    return createElement('p', null, `${session.user?.role ?? 'publik'} ready=${session.ready} checked=${session.checked}`);
  }
  return { outbox, render: async () => { view = await renderDom(createElement(SessionProvider, null, createElement(Probe))); } };
}
const screen = () => view!.text();
/** What the outbox sends now, as startOutboxSync's tick would. */
async function sends(outbox: typeof import('./outbox')) {
  const sent: string[] = [];
  const send: Sender = async (report: QueuedReport) => { sent.push(report.clientUuid); return json({ data: {} }, 201); };
  await act(async () => { await outbox.flush(send); });
  return sent;
}
const report = { clientUuid: 'r1', incidentId: 'i', incidentLabel: 'KJD', status: 'asap_bara' as const, note: '', latitude: null, longitude: null, accuracyM: null,
  observedAt: '2026-11-04T02:00:00Z', photo: null, userId: mpa.id };

beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem('titikapi.user', JSON.stringify(mpa));
  const { queued, discard } = await import('./outbox');
  for (const item of await queued()) await discard(item.clientUuid);
});
afterEach(async () => {
  await view?.unmount();
  view = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the session check', () => {
  for (const failure of [503, 429, 'no signal'] as const) {
    it(`keeps the last account on screen and for the outbox when it gets no answer (${failure}), and asks again after 30 s`, async () => {
      const fetch = authMe([failure, mpa]);
      vi.stubGlobal('fetch', fetch);
      const { outbox, render } = await load();
      await outbox.enqueue(report);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      await render();
      await advance(0);
      expect(screen()).toBe('mpa ready=true checked=false');
      // The volunteer's waiting report goes out with the session cookie, which may well be valid.
      expect(await sends(outbox)).toEqual(['r1']);
      expect(fetch).toHaveBeenCalledTimes(1);
      await advance(29_000);
      expect(fetch).toHaveBeenCalledTimes(1);
      await advance(1_000);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(screen()).toBe('mpa ready=true checked=true');
    });
  }

  it('clears the account only when the server answers that nobody is signed in', async () => {
    vi.stubGlobal('fetch', authMe([503, 503, null]));
    const { outbox, render } = await load();
    await outbox.enqueue(report);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await render();
    await advance(30_000);
    // A second failure keeps it too, and asks again.
    expect(screen()).toBe('mpa ready=true checked=false');
    await advance(30_000);
    expect(screen()).toBe('publik ready=true checked=true');
    expect(localStorage.getItem('titikapi.user')).toBeNull();
    expect(await sends(outbox)).toEqual([]);
  });

  it('asks again as soon as the browser is back online', async () => {
    const fetch = authMe(['no signal', mpa]);
    vi.stubGlobal('fetch', fetch);
    const { render } = await load();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await render();
    await advance(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => { window.dispatchEvent(new Event('online')); });
    await advance(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen()).toBe('mpa ready=true checked=true');
  });

  it('gives up on a check that hangs after 10 s, keeps the account, and asks again', async () => {
    const fetch = authMe(['hangs', mpa]);
    vi.stubGlobal('fetch', fetch);
    const { render } = await load();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await render();
    await advance(9_000);
    expect(screen()).toBe('mpa ready=false checked=false');
    await advance(1_000);
    expect(screen()).toBe('mpa ready=true checked=false');
    await advance(30_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen()).toBe('mpa ready=true checked=true');
  });

  it('stops asking again once the visitor signs out, so a later answer cannot sign the account back in', async () => {
    const fetch = authMe([503]);
    vi.stubGlobal('fetch', fetch);
    const { render } = await load();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await render();
    await advance(0);
    // POST /auth/logout without a signal: the session may stay on the server.
    fetch.mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch')));
    await act(async () => { await session.signOut(); });
    expect(screen()).toBe('publik ready=true checked=false');
    await advance(60_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen()).toBe('publik ready=true checked=false');
  });
});
