// "Siap tanpa sinyal": while there is a signal, the tasks page fetches the detail of every open task and alert.
// The service worker keeps those responses (cache "api", see sw.ts), so the field check opens and a report can
// be filed later in a village without a signal. A card is marked ready once its detail sits in that cache.
import { useEffect, useMemo, useState } from 'react';
import { onOutboxChange, queued } from '../../outbox';

const cacheName = 'api';
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

/** Resolves true once a service worker controls the page (only then do fetches land in its cache). */
async function controlled(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
  if (navigator.serviceWorker.controller) return true;
  const registration = await navigator.serviceWorker.getRegistration().catch(() => undefined);
  if (!registration) return false;
  return new Promise(resolve => {
    const done = () => { navigator.serviceWorker.removeEventListener('controllerchange', done); clearTimeout(timer); resolve(Boolean(navigator.serviceWorker.controller)); };
    const timer = setTimeout(done, 10_000);
    navigator.serviceWorker.addEventListener('controllerchange', done);
  });
}

export interface Prefetchable { id: string; lastDetectedAt: string }

/** Ids of the given incidents whose detail is ready without a signal; fetches the missing ones while online. */
export function useOfflineReady(items: Prefetchable[], online: boolean): Set<string> {
  const [ready, setReady] = useState<Set<string>>(new Set());
  const key = useMemo(() => items.map(item => `${item.id}@${item.lastDetectedAt}`).sort().join(','), [items]);
  useEffect(() => {
    let alive = true;
    const list = key ? key.split(',').map(entry => { const [id, last] = entry.split('@'); return { id: id!, last: Date.parse(last!) }; }) : [];
    void (async () => {
      const cached = await cachedDetails().catch(() => new Map<string, number>());
      if (!alive) return;
      const mark = () => setReady(new Set(list.filter(item => cached.has(item.id.toLowerCase())).map(item => item.id)));
      mark();
      if (!online || !list.length || !(await controlled()) || !alive) return;
      // Stale or missing copies only, two at a time, so a weak signal is not swamped.
      const todo = list.filter(item => {
        const at = cached.get(item.id.toLowerCase());
        return at === undefined || at < item.last || Date.now() - at > refetchAfterMs;
      });
      const worker = async () => {
        for (let item = todo.shift(); item && alive; item = todo.shift()) {
          try {
            const response = await fetch(detailPath(item.id), { credentials: 'same-origin' });
            if (response.ok) { await response.arrayBuffer(); cached.set(item.id.toLowerCase(), Date.now()); if (alive) mark(); }
          } catch { return; }
        }
      };
      await Promise.all([worker(), worker()]);
    })();
    return () => { alive = false; };
  }, [key, online]);
  return ready;
}

/** Incidents with a report still waiting on this phone for a signal. */
export function useWaitingReports(): Set<string> {
  const [waiting, setWaiting] = useState<Set<string>>(new Set());
  useEffect(() => {
    const load = () => { void queued().then(items => setWaiting(new Set(items.filter(item => !item.rejected).map(item => item.incidentId)))).catch(() => {}); };
    load();
    return onOutboxChange(load);
  }, []);
  return waiting;
}
