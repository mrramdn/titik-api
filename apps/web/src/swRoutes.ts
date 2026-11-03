// Which requests the service worker keeps, apart from sw.ts so they can be tested without a service worker.

/** Esri World Imagery through the API: one answer may serve one visitor only, so no cache keeps it (network only). */
export const isImagery = (url: URL) => url.pathname.startsWith('/api/v1/imagery/');

/** Map tiles, in their own cache. */
export const isTile = (url: URL) => url.pathname.startsWith('/api/v1/tiles/');

/** Other API reads: fresh with a signal, the last copy without one. Exports and imagery are never kept. */
export const isApiRead = (url: URL) => url.pathname.startsWith('/api/v1/') && !url.pathname.startsWith('/api/v1/export') && !isImagery(url);

/** Report photos. */
export const isPhoto = (url: URL) => url.pathname.startsWith('/uploads/');
/**
 * A photo stays in the service worker's cache a day at most, as long as the API lets a browser keep it (Cache-Control
 * on /uploads/), so one deleted at the nightly demo reset is gone from visitors' phones within a day too.
 */
export const PHOTO_MAX_AGE_SECONDS = 24 * 3600;

/** Base map, daily imagery, Sentinel-2 and the forest layers from their own hosts. */
export const isMapHost = (url: URL) => /(openfreemap\.org|tiles\.maps\.eox\.at|tiles\.globalforestwatch\.org|gibs\.earthdata\.nasa\.gov)$/.test(url.hostname);

/** True when one of the caching routes would take this request. */
export const cached = (url: URL) => isTile(url) || isApiRead(url) || isPhoto(url) || isMapHost(url);
