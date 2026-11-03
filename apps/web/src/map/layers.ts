// Sources and layers MapView adds over the base style, kept apart so their URLs and zoom ranges can be tested: the
// incident and hotspot tiles, the pixel footprints, and HD imagery from Esri.
import type { LayerSpecification, RasterSourceSpecification } from 'maplibre-gl';
import { tanggalParam, type AppConfig } from '../api';
import { detectionColor } from './style';

/** Below this zoom the map shows one bubble per regency; incidents and hotspots appear from it. */
export const OVERVIEW_ZOOM = 8;
/** From this zoom a hotspot is drawn as its satellite pixel instead of a dot. */
export const FOOTPRINT_ZOOM = 11;
/** From this zoom the satellite view shows Esri World Imagery instead of Sentinel-2, when the server offers it. */
export const ESRI_ZOOM = 11;
/** The API serves Esri tiles up to this zoom; the map stops there too. */
export const ESRI_MAX_ZOOM = 18;

/**
 * Vector tiles for the incident or hotspot layer. `version` changes with every ingest run; `tanggal` asks for an archive
 * day. `demo` (the visitor is signed in to a demo account) asks for incident tiles that also show demo field checks and
 * tasks (&lihat=demo; the server honours it only for a demo session). Hotspot tiles carry no field check or task state.
 */
export const tileUrls = (layer: 'kejadian' | 'deteksi', hours: number, version: number, tanggal: string, origin: string, demo = false) =>
  [`${origin}/api/v1/tiles/${layer}/{z}/{x}/{y}.mvt?hours=${hours}&v=${version}${tanggalParam(tanggal)}${demo && layer === 'kejadian' ? '&lihat=demo' : ''}`];

/**
 * Zoom range of the hotspot dots (and the MODIS 1 km ring): from the overview zoom, or 7 without the overview, up to
 * the zoom where the pixel footprints take over. Tiles from an older server carry no footprints, so the dots stay.
 */
export const dotZoomRange = (overview: boolean, footprints: boolean): [number, number] => [overview ? OVERVIEW_ZOOM : 7, footprints ? FOOTPRINT_ZOOM : 24];

/**
 * The pixel footprints (source layer `piksel` of the hotspot tiles, the same properties as the dots): a faint fill
 * coloured by age like the dots, fainter outside village boundaries, and a thin outline.
 */
export function footprintLayers(hoursToday: number): LayerSpecification[] {
  const color = detectionColor(hoursToday);
  return [
    { id: 'piksel-fill', type: 'fill', source: 'deteksi', 'source-layer': 'piksel', minzoom: FOOTPRINT_ZOOM,
      paint: { 'fill-color': color, 'fill-opacity': ['case', ['to-boolean', ['get', 'inside']], 0.25, 0.12] } },
    { id: 'piksel-line', type: 'line', source: 'deteksi', 'source-layer': 'piksel', minzoom: FOOTPRINT_ZOOM,
      paint: { 'line-color': color, 'line-width': 1, 'line-opacity': 0.8 } },
  ];
}

/**
 * Esri World Imagery through the API (z/y/x is Esri's order), which adds its key on the server; the browser never sees
 * it. The service worker keeps none of these tiles (licence terms).
 */
export const ESRI_TILES = '/api/v1/imagery/{z}/{y}/{x}';
/** The service's copyright text as published, for a server that sends none. */
export const ESRI_DATA_ATTRIBUTION = 'Esri, Vantor, Earthstar Geographics, and the GIS User Community';

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
/** "Powered by Esri" with its link, then the copyright text from GET /config, as text (it comes from Esri). */
export const esriAttribution = (text: string | null | undefined) =>
  `Powered by <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a> · ${escapeHtml(text?.trim() || ESRI_DATA_ATTRIBUTION)}`;

/** The HD imagery source when GET /config offers it; null otherwise, and then the satellite view stays as it was. */
export function esriSource(config: AppConfig | null | undefined, origin: string): RasterSourceSpecification | null {
  if (!config?.hdImagery) return null;
  return { type: 'raster', tileSize: 256, minzoom: ESRI_ZOOM, maxzoom: ESRI_MAX_ZOOM, tiles: [`${origin}${ESRI_TILES}`], attribution: esriAttribution(config.imageryAttribution) };
}

/**
 * Esri's attribution stays open while its imagery shows (the Esri source is on the map, the detailed imagery layer is
 * on, zoom 11 or closer) on a map wider than 640 px, where MapLibre itself stops collapsing attributions. A narrower
 * map keeps it one tap away.
 */
export const keepAttributionOpen = (view: { esri: boolean; citra: boolean; zoom: number; width: number }) =>
  view.esri && view.citra && view.zoom >= ESRI_ZOOM && view.width > 640;

/** Satellite view by zoom: the daily GIBS image below 9, Sentinel-2 from 9, and Esri from 11 when the server offers it. */
export const imageryZoom = (esri: boolean) => ({
  harian: [0, 9] as [number, number],
  citra: [9, esri ? ESRI_ZOOM : 24] as [number, number],
  esri: [ESRI_ZOOM, 24] as [number, number],
});

/** Sentinel-2 cloudless 2023 by EOX, the detailed imagery from zoom 9. */
export const EOX_TILES = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/g/{z}/{y}/{x}.jpg';
export const EOX_ATTRIBUTION = 'Sentinel-2 cloudless 2023 by EOX (CC BY-NC-SA 4.0)';

/**
 * Sentinel-2 under Esri from zoom 11, drawn from zoom 11 tiles only (a few per screen, stretched closer in), so a tile
 * Esri does not have is not left empty: past the edge of the covered area (the API answers 404 there, which MapLibre
 * does not report), one that failed, one still on its way.
 */
export const sentinelUnderEsri = (): RasterSourceSpecification =>
  ({ type: 'raster', tileSize: 256, minzoom: ESRI_ZOOM, maxzoom: ESRI_ZOOM, tiles: [EOX_TILES], attribution: EOX_ATTRIBUTION });

/**
 * What a failed Esri tile says about the rest of the visit: 'off' when the API will not serve this visitor for now (403
 * refused, 429 its share of the day or too many requests, 503 a cap reached), 'flaky' when Esri failed for that tile
 * (another 5xx), null for anything else (no signal, a cancelled request).
 */
export function esriTileError(status: unknown): 'off' | 'flaky' | null {
  if (status === 403 || status === 429 || status === 503) return 'off';
  return typeof status === 'number' && status >= 500 && status < 600 ? 'flaky' : null;
}

/**
 * Reads the Esri tile errors of one map and says when Esri should give way to Sentinel-2 for the rest of the visit:
 * at the first refusal, or once three tiles failed within a minute (one slow tile alone does not end HD imagery).
 */
export function esriWatch(limit = 3, windowMs = 60_000) {
  let failures: number[] = [];
  return (status: unknown, now = Date.now()) => {
    const kind = esriTileError(status);
    if (kind !== 'flaky') return kind === 'off';
    failures = [...failures.filter(at => now - at < windowMs), now];
    return failures.length >= limit;
  };
}
