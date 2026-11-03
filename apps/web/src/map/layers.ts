// Sources and layers MapView adds over the base style, kept apart so their URLs and zoom ranges can be tested: the
// incident and hotspot tiles, the pixel footprints, and HD imagery from Esri.
import type { LayerSpecification, RasterSourceSpecification } from 'maplibre-gl';
import { tanggalParam } from '../api';
import { detectionColor } from './style';

/** Below this zoom the map shows one bubble per regency; incidents and hotspots appear from it. */
export const OVERVIEW_ZOOM = 8;
/** From this zoom a hotspot is drawn as its satellite pixel instead of a dot. */
export const FOOTPRINT_ZOOM = 11;
/** From this zoom the satellite view shows Esri World Imagery instead of Sentinel-2, when there is a key. */
export const ESRI_ZOOM = 11;

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
