// "Siap tanpa sinyal": while there is a signal, the tasks page fetches the detail of every open task and alert.
// The service worker keeps those responses (cache "api", see sw.ts), so the field check opens and a report can
// be filed later in a village without a signal. A card is marked ready once its detail sits in that cache, which
// empties when another account signs in (see accountData.ts).
import { useEffect, useMemo, useState } from 'react';
import { apiCacheName as cacheName } from '../../accountData';
import { onOutboxChange, outboxView, queued } from '../../outbox';
import { useSession } from '../../session';

const detailPath = (id: string) => `/api/v1/incidents/${id}`;
const refetchAfterMs = 2 * 3600_000;

/** Incident id → when its cached detail was fetched (ms). Empty without a service worker cache. */
async function cachedDetails(): Promise<Map<string, number>> {
  const found = new Map<string, number>();
  if (typeof caches === 'undefined' || !(await caches.has(cacheName))) return found;
  const cache = await caches.open(cacheName);
  for (const request of await cache.keys()) {
    const match = /^\/api\/v1\/incidents\/([0-9a-f-]{36})$/i.exec(new URL(request.url).pathname);
    if (!match) continue;
    const response = await cache.match(request, { ignoreVary: true });
    const date = Date.parse(response?.headers.get('date') ?? '');
    found.set(match[1]!.toLowerCase(), Number.isNaN(date) ? 0 : date);
  }
  return found;
}

/** What the prefetch needs of navigator.serviceWorker. */
export interface WorkerContainer {
  readonly controller: unknown;
  addEventListener(type: 'controllerchange', listener: () => void): void;
  removeEventListener(type: 'controllerchange', listener: () => void): void;
}
const workerContainer = (): WorkerContainer | undefined =>
  (typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? navigator.serviceWorker : undefined);

/**
 * Resolves true once a service worker controls the page (only then do fetches land in its cache): at once when one does,
 * otherwise when one takes over (sw.ts claims the open pages as it activates), however long its first install takes.
 * The first app screen installs it (see swRoutes.ts), so a first visit to the tasks page over a slow signal waits for
 * the whole precache; a time limit there left no task ready without a signal until a reload. False without service
 * workers, or once `signal` aborts (the screen went or its list changed); the listeners go either way.
 */
export function whenControlled(container: WorkerContainer | undefined, signal: AbortSignal): Promise<boolean> {
  if (!container || signal.aborted) return Promise.resolve(false);
  if (container.controller) return Promise.resolve(true);
  return new Promise(resolve => {
    const finish = (value: boolean) => {
      container.removeEventListener('controllerchange', changed);
      signal.removeEventListener('abort', aborted);
      resolve(value);
    };
    const changed = () => { if (container.controller) finish(true); };
    const aborted = () => finish(false);
    container.addEventListener('controllerchange', changed);
    signal.addEventListener('abort', aborted);
  });
}

export interface Prefetchable { id: string; lastDetectedAt: string }
export interface ReadyDeps { container?: WorkerContainer; fetch?: typeof fetch; cached?: () => Promise<Map<string, number>> }

/**
 * Says which incidents are ready without a signal (`mark`), then, while online, waits for a service worker to control
 * the page and fetches the details that are missing or stale, two at a time, so a weak signal is not swamped. Stops
 * when `signal` aborts.
 */
export async function keepReady(list: { id: string; last: number }[], online: boolean, signal: AbortSignal, mark: (ids: Set<string>) => void, deps: ReadyDeps = {}) {
  const { container = workerContainer(), fetch: get = fetch, cached: read = cachedDetails } = deps;
  const cached = await read().catch(() => new Map<string, number>());
  if (signal.aborted) return;
  const show = () => mark(new Set(list.filter(item => cached.has(item.id.toLowerCase())).map(item => item.id)));
  show();
  if (!online || !list.length || !(await whenControlled(container, signal)) || signal.aborted) return;
  const todo = list.filter(item => {
    const at = cached.get(item.id.toLowerCase());
    return at === undefined || at < item.last || Date.now() - at > refetchAfterMs;
  });
  const worker = async () => {
    for (let item = todo.shift(); item && !signal.aborted; item = todo.shift()) {
      try {
        const response = await get(detailPath(item.id), { credentials: 'same-origin' });
        if (response.ok) { await response.arrayBuffer(); cached.set(item.id.toLowerCase(), Date.now()); if (!signal.aborted) show(); }
      } catch { return; }
    }
  };
  await Promise.all([worker(), worker()]);
}

/** Ids of the given incidents whose detail is ready without a signal; fetches the missing ones while online. */
export function useOfflineReady(items: Prefetchable[], online: boolean): Set<string> {
  const [ready, setReady] = useState<Set<string>>(new Set());
  const key = useMemo(() => items.map(item => `${item.id}@${item.lastDetectedAt}`).sort().join(','), [items]);
  useEffect(() => {
    const abort = new AbortController();
    const list = key ? key.split(',').map(entry => { const [id, last] = entry.split('@'); return { id: id!, last: Date.parse(last!) }; }) : [];
    void keepReady(list, online, abort.signal, setReady);
    return () => abort.abort();
  }, [key, online]);
  return ready;
}

/** Incidents with a report of the signed-in account still waiting on this phone (another account's wait for it). */
export function useWaitingReports(): Set<string> {
  const viewer = useSession().user?.id ?? null;
  const [waiting, setWaiting] = useState<Set<string>>(new Set());
  useEffect(() => {
    const load = () => { void queued().then(items => setWaiting(new Set(outboxView(items, viewer).waiting.map(item => item.incidentId)))).catch(() => {}); };
    load();
    return onOutboxChange(load);
  }, [viewer]);
  return waiting;
}
