/// <reference lib="webworker" />
// The service worker: the app opens without a signal, recent data stays readable, and alert cards arrive as
// notifications even when the app is closed.
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { isApiRead, isMapHost, isPhoto, isTile, PHOTO_MAX_AGE_SECONDS } from './swRoutes';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] };

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//, /^\/uploads\//] }));

// Map tiles get their own cache: their URLs change with every ingest run (&v=), and they must not push out the
// incident data a volunteer needs without a signal.
registerRoute(({ url, request }) => request.method === 'GET' && isTile(url),
  new NetworkFirst({ cacheName: 'tiles', networkTimeoutSeconds: 4, plugins: [new ExpirationPlugin({ maxEntries: 800, maxAgeSeconds: 2 * 24 * 3600 })] }));
// Reads: fresh when there is a signal, the last copy when there is none. The copies are the signed-in account's: the app
// empties this cache when another account, or none, takes over (see accountData.ts).
registerRoute(({ url, request }) => request.method === 'GET' && isApiRead(url),
  new NetworkFirst({ cacheName: 'api', networkTimeoutSeconds: 4, plugins: [new ExpirationPlugin({ maxEntries: 400, maxAgeSeconds: 3 * 24 * 3600 })] }));
registerRoute(({ url }) => isPhoto(url), new CacheFirst({ cacheName: 'photos', plugins: [new ExpirationPlugin({ maxEntries: 120, maxAgeSeconds: PHOTO_MAX_AGE_SECONDS })] }));
// Esri World Imagery (/api/v1/imagery/) matches no route on purpose (licence terms): the browser fetches it from the
// network and no cache here keeps it.
registerRoute(({ url }) => isMapHost(url),
  new CacheFirst({ cacheName: 'map', plugins: [new ExpirationPlugin({ maxEntries: 1500, maxAgeSeconds: 14 * 24 * 3600 })] }));

self.addEventListener('push', event => {
  const data = (() => { try { return event.data?.json() ?? {}; } catch { return { title: 'Titik Api', body: event.data?.text() }; } })();
  event.waitUntil(self.registration.showNotification(data.title ?? 'Titik panas baru', {
    body: data.body, tag: data.tag, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url: data.url ?? '/tugas' },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? '/tugas', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find(client => client.url.startsWith(self.location.origin));
    if (open) { await open.focus(); return (open as WindowClient).navigate(url); }
    return self.clients.openWindow(url);
  })());
});
