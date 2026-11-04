import { afterEach, describe, expect, it, vi } from 'vitest';
import { keepReady, whenControlled, type WorkerContainer } from './offline';

/** navigator.serviceWorker while the first install is under way: no worker controls the page yet. */
class Container implements WorkerContainer {
  controller: object | null = null;
  readonly listeners = new Set<() => void>();
  addEventListener(_type: 'controllerchange', listener: () => void) { this.listeners.add(listener); }
  removeEventListener(_type: 'controllerchange', listener: () => void) { this.listeners.delete(listener); }
  /** The worker activates and claims the page (sw.ts calls clientsClaim). */
  takeOver() { this.controller = {}; this.listeners.forEach(listener => listener()); }
}

const A = '0b2d7a52-3a0e-4c1f-9d4e-1f2a3b4c5d6e', B = '9c8b7a65-4d3e-4f2a-8b1c-0d9e8f7a6b5c';
const now = Date.parse('2026-11-04T03:00:00Z');
const tasks = [{ id: A, last: now - 3_600_000 }, { id: B, last: now - 3_600_000 }];
const ok = () => new Response('{}', { status: 200 });

describe('"Siap tanpa sinyal" on the tasks page', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('prefetches the task details once the first install takes over, however long it takes', async () => {
    vi.useFakeTimers({ now });
    const container = new Container(), fetched: string[] = [], marks: string[][] = [];
    const run = keepReady(tasks, true, new AbortController().signal, ids => marks.push([...ids].sort()),
      { container, cached: async () => new Map(), fetch: async url => { fetched.push(String(url)); return ok(); } });
    // A slow signal: the precache takes over a minute. Nothing is fetched before a worker controls the page, since
    // only then does the response land in its cache, and nothing gives up meanwhile.
    await vi.advanceTimersByTimeAsync(75_000);
    expect(fetched).toEqual([]);
    expect(marks).toEqual([[]]);
    expect(container.listeners.size).toBe(1);
    container.takeOver();
    await run;
    expect(fetched.sort()).toEqual([`/api/v1/incidents/${A}`, `/api/v1/incidents/${B}`].sort());
    expect(marks.at(-1)).toEqual([A, B].sort());
    expect(container.listeners.size).toBe(0);
  });

  it('starts at once when a worker controls the page, and fetches only the missing and stale details', async () => {
    const container = new Container();
    container.controller = {};
    const fetched: string[] = [];
    const fresh = new Map([[A, now - 60_000], [B, now - 3 * 3_600_000]]);
    vi.useFakeTimers({ now });
    await keepReady(tasks, true, new AbortController().signal, () => {}, { container, cached: async () => fresh, fetch: async url => { fetched.push(String(url)); return ok(); } });
    expect(fetched).toEqual([`/api/v1/incidents/${B}`]);
    expect(container.listeners.size).toBe(0);
  });

  it('stops waiting when the screen goes or its list changes, and leaves no listener behind', async () => {
    const container = new Container(), fetched: string[] = [];
    const abort = new AbortController();
    const run = keepReady(tasks, true, abort.signal, () => {}, { container, cached: async () => new Map(), fetch: async url => { fetched.push(String(url)); return ok(); } });
    await vi.waitFor(() => expect(container.listeners.size).toBe(1));
    abort.abort();
    await run;
    container.takeOver();
    await Promise.resolve();
    expect(fetched).toEqual([]);
    expect(container.listeners.size).toBe(0);
  });

  it('shows what is ready without a signal, and waits for no worker then', async () => {
    const container = new Container(), marks: string[][] = [];
    await keepReady(tasks, false, new AbortController().signal, ids => marks.push([...ids]), { container, cached: async () => new Map([[A, now]]), fetch: async () => ok() });
    expect(marks).toEqual([[A]]);
    expect(container.listeners.size).toBe(0);
  });
});

describe('waiting for a service worker', () => {
  it('ignores a change that leaves the page without one, and answers false without service workers', async () => {
    const container = new Container();
    const controlled = whenControlled(container, new AbortController().signal);
    container.listeners.forEach(listener => listener());
    let settled = false;
    void controlled.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    container.takeOver();
    expect(await controlled).toBe(true);
    expect(await whenControlled(undefined, new AbortController().signal)).toBe(false);
    const gone = new AbortController();
    gone.abort();
    expect(await whenControlled(new Container(), gone.signal)).toBe(false);
  });
});
