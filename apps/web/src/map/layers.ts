// Sources and layers MapView adds over the base style, kept apart so their URLs and zoom ranges can be tested: the
// incident and hotspot tiles, and HD imagery from Esri.
import type { RasterSourceSpecification } from 'maplibre-gl';
import { tanggalParam } from '../api';

/** Below this zoom the map shows one bubble per regency; incidents and hotspots appear from it. */
export const OVERVIEW_ZOOM = 8;
/** From this zoom the satellite view shows Esri World Imagery instead of Sentinel-2, when there is a key. */
export const ESRI_ZOOM = 11;

/** Vector tiles for the incident or hotspot layer. `version` changes with every ingest run; `tanggal` asks for an archive day. */
export const tileUrls = (layer: 'kejadian' | 'deteksi', hours: number, version: number, tanggal: string, origin: string) =>
  [`${origin}/api/v1/tiles/${layer}/{z}/{x}/{y}.mvt?hours=${hours}&v=${version}${tanggalParam(tanggal)}`];

/**
 * Esri World Imagery; the referrer-restricted key from GET /config goes after `token=`. The service worker leaves these
 * tiles alone (no caching under the licence).
 */
export const ESRI_TILES = 'https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=';
export const ESRI_ATTRIBUTION = 'Powered by Esri · Esri, Maxar, Earthstar Geographics, and the GIS User Community';

/** The HD imagery source for a key; null without one, and then the satellite view stays as it was. */
export function esriSource(key: string | null | undefined): RasterSourceSpecification | null {
  if (!key) return null;
  return { type: 'raster', tileSize: 256, maxzoom: 19, tiles: [`${ESRI_TILES}${encodeURIComponent(key)}`], attribution: ESRI_ATTRIBUTION };
}

/** Satellite view by zoom: the daily GIBS image below 9, Sentinel-2 from 9, and Esri from 11 when there is a key. */
export const imageryZoom = (esri: boolean) => ({
  harian: [0, 9] as [number, number],
  citra: [9, esri ? ESRI_ZOOM : 24] as [number, number],
  esri: [ESRI_ZOOM, 24] as [number, number],
});
