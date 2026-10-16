/// <reference lib="webworker" />
// The service worker: the app opens without a signal, recent data stays readable, and alert cards arrive as
// notifications even when the app is closed.
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] };

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//, /^\/uploads\//] }));

// Map tiles get their own cache: their URLs change with every ingest run (&v=), and they must not push out the
// incident data a volunteer needs without a signal.
registerRoute(({ url, request }) => request.method === 'GET' && url.pathname.startsWith('/api/v1/tiles/'),
  new NetworkFirst({ cacheName: 'tiles', networkTimeoutSeconds: 4, plugins: [new ExpirationPlugin({ maxEntries: 800, maxAgeSeconds: 2 * 24 * 3600 })] }));
// Reads: fresh when there is a signal, the last copy when there is none.
registerRoute(({ url, request }) => request.method === 'GET' && url.pathname.startsWith('/api/v1/') && !url.pathname.startsWith('/api/v1/export'),
  new NetworkFirst({ cacheName: 'api', networkTimeoutSeconds: 4, plugins: [new ExpirationPlugin({ maxEntries: 400, maxAgeSeconds: 3 * 24 * 3600 })] }));
registerRoute(({ url }) => url.pathname.startsWith('/uploads/'), new CacheFirst({ cacheName: 'photos', plugins: [new ExpirationPlugin({ maxEntries: 120 })] }));
registerRoute(({ url }) => /(openfreemap\.org|tiles\.maps\.eox\.at|tiles\.globalforestwatch\.org|gibs\.earthdata\.nasa\.gov)$/.test(url.hostname),
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
