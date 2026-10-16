import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Droplets, Earth, Image, Layers, List, Satellite, Trees, X, type LucideIcon } from 'lucide-react';
import type { RegionSummary } from '../api';
import { dict, useT } from '../i18n';
import { useApi } from '../components/ui';
import { useFormat } from '../format';
import { ALL_BOUNDS, useRegion } from '../region';
import { checkBadge } from './badge';
import { dailyLayer } from './imagery';
import {
  badgeOffset, bubbleColor, bubbleLabel, bubbleNameOffset, bubbleRadius, checkedFilter, colors, detectionColor, detectionOpacity, detectionRadius, hoursSinceMidnightWib,
  incidentFilter, incidentOpacity, incidentRadius, incidentSortKey, incidentStroke, incidentStrokeWidth, kilometreRadius, levelColor,
  modisDetection, type MapFilters,
} from './style';

export type { MapFilters } from './style';
maplibregl.setWorkerUrl(workerUrl);

export type LayerKey = 'deteksi' | 'gambut' | 'deforestasi' | 'harian' | 'citra';
export interface Selected { id: string; centroid: [number, number]; detections?: [number, number][] }
interface Props {
  /** Map filters; optional so existing callers keep working. */
  filters?: MapFilters;
  /** Changes when a new ingest run lands; tile URLs carry it so the map refreshes. */
  version?: number;
  hours?: number;
  bounds?: [number, number, number, number];
  /** The map zooms in at least this far when it fits `bounds` (a regency should open on its incidents). */
  boundsMinZoom?: number;
  selected?: Selected | null;
  focus?: GeoJSON.Geometry | null;
  initialLayers?: Partial<Record<LayerKey, boolean>>;
  onSelect?: (id: string) => void;
  onVillage?: (id: string) => void;
  controls?: boolean;
  /** Opens the legend on wide screens. */
  legend?: boolean;
  className?: string;
}

const text = dict({
  id: {
    map: 'Peta titik panas', layers: 'Lapisan', layersTitle: 'Lapisan peta', legend: 'Legenda', close: 'Tutup',
    deteksi: 'Titik panas satelit', deteksiSource: 'NASA FIRMS, VIIRS 375 m dan MODIS 1 km', gambut: 'Lahan gambut', gambutSource: 'Global peatland extent',
    deforestasi: 'Peringatan gangguan hutan', deforestasiSource: 'GLAD-L, GLAD-S2, RADD', harian: 'Citra satelit harian', harianSource: '{satellite}, {date} {part} · NASA GIBS',
    morning: 'pagi', midday: 'siang', citra: 'Citra detail', citraSource: 'Sentinel-2 cloudless 2023, EOX',
    incidents: 'Prioritas kejadian', checked: 'Sudah dicek', assigned: 'Ditugaskan', sizeNote: 'titik panas per kejadian', modisOnly: 'Hanya MODIS, lokasi ±1 km',
    hotspots: 'Titik panas menurut umur', hotspotsConfidence: 'Titik panas menurut keyakinan', newest: '≤ 3 jam', today: 'Hari ini', older: 'Lebih lama',
    confHigh: 'Tinggi', confNominal: 'Sedang', confLow: 'Rendah', modisRing: 'Piksel MODIS, lokasi ±1 km',
    regencies: 'Kejadian per kabupaten', bubble: 'Prioritas tinggi, belum dicek atau ditugaskan', bubbleNone: 'Tidak ada prioritas tinggi yang menunggu',
    bubbleNote: 'Ukuran lingkaran mengikuti jumlah kejadian. Klik lingkaran atau perbesar peta untuk melihat tiap kejadian.',
  },
  en: {
    map: 'Hotspot map', layers: 'Layers', layersTitle: 'Map layers', legend: 'Legend', close: 'Close',
    deteksi: 'Satellite hotspots', deteksiSource: 'NASA FIRMS, VIIRS 375 m and MODIS 1 km', gambut: 'Peatland', gambutSource: 'Global peatland extent',
    deforestasi: 'Forest disturbance alerts', deforestasiSource: 'GLAD-L, GLAD-S2, RADD', harian: 'Daily satellite image', harianSource: '{satellite}, {date} {part} · NASA GIBS',
    morning: 'morning', midday: 'midday', citra: 'Detailed imagery', citraSource: 'Sentinel-2 cloudless 2023, EOX',
    incidents: 'Incident priority', checked: 'Checked', assigned: 'Assigned', sizeNote: 'hotspots per incident', modisOnly: 'MODIS only, location ±1 km',
    hotspots: 'Hotspots by age', hotspotsConfidence: 'Hotspots by confidence', newest: '≤ 3 h', today: 'Today', older: 'Older',
    confHigh: 'High', confNominal: 'Nominal', confLow: 'Low', modisRing: 'MODIS pixel, location ±1 km',
    regencies: 'Incidents per regency', bubble: 'High priority, not checked or assigned', bubbleNone: 'No high priority waiting',
    bubbleNote: 'Circle size follows the number of incidents. Click a circle or zoom in to see each incident.',
  },
});
type Key = keyof typeof text.id;

const layerInfo: { key: LayerKey; label: Key; source: Key; icon: LucideIcon }[] = [
  { key: 'deteksi', label: 'deteksi', source: 'deteksiSource', icon: Satellite },
  { key: 'gambut', label: 'gambut', source: 'gambutSource', icon: Droplets },
  { key: 'deforestasi', label: 'deforestasi', source: 'deforestasiSource', icon: Trees },
  { key: 'harian', label: 'harian', source: 'harianSource', icon: Earth },
  { key: 'citra', label: 'citra', source: 'citraSource', icon: Image },
];

/** Below this zoom the map shows one bubble per regency; incidents and hotspots appear from it. */
const OVERVIEW_ZOOM = 8;
const tiles = (layer: 'kejadian' | 'deteksi', hours: number, version: number) => [`${location.origin}/api/v1/tiles/${layer}/{z}/{x}/{y}.mvt?hours=${hours}&v=${version}`];
const wide = () => typeof matchMedia === 'function' && matchMedia('(min-width: 1280px)').matches;
// The legend opens by itself on wide screens until the visitor closes it once.
const legendKey = 'titikapi.legend';
const legendClosed = () => { try { return localStorage.getItem(legendKey) === 'closed'; } catch { return false; } };
const rememberLegend = (closed: boolean) => { try { if (closed) localStorage.setItem(legendKey, 'closed'); else localStorage.removeItem(legendKey); } catch { /* private mode */ } };
const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const levelKey = { tinggi: 'high', sedang: 'medium', rendah: 'low' } as const;

export function MapView({ filters, version = 0, hours = 24, bounds, boundsMinZoom, selected, focus, initialLayers, onSelect, onVillage, controls = true, legend = true, className }: Props) {
  const t = useT(text), f = useFormat();
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const ready = useRef(false);
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({ deteksi: true, gambut: false, deforestasi: false, harian: false, citra: false, ...initialLayers });
  // The newest complete daily image; it changes at midday and in the evening, checked again with every new ingest run.
  const [daily, setDaily] = useState(dailyLayer);
  const [panel, setPanel] = useState<'layers' | 'legend' | null>(() => (legend && controls && wide() && !legendClosed() ? 'legend' : null));
  const panelOpen = useRef(panel !== null);
  panelOpen.current = panel !== null;
  /** Fitting a region leaves room for an open legend or layer card on the right. */
  const padding = () => ({ top: 24, bottom: 24, left: 24, right: panelOpen.current && wide() ? 324 : 24 });
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [ageAware, setAgeAware] = useState(false);
  // Below the overview zoom the map shows regency bubbles only, and the legend explains just those.
  const [zoomedOut, setZoomedOut] = useState(true);
  const { query, findRegency } = useRegion();
  const regions = useApi<RegionSummary[]>(`/regions/summary?hours=${hours}${query}`, version);
  // Bubbles need GET /regions/summary; without it (an older API) incidents show at every zoom instead. A later failed
  // refresh keeps the bubbles it already has.
  const overview = Array.isArray(regions.data) || (regions.data === null && !regions.error);
  const handlers = useRef({ onSelect, onVillage, findRegency });
  handlers.current = { onSelect, onVillage, findRegency };
  const state = useRef({ hours, version, layers, selected, focus, filters, regions: regions.data, overview, boundsMinZoom, daily });
  state.current = { hours, version, layers, selected, focus, filters, regions: regions.data, overview, boundsMinZoom, daily };

  useEffect(() => {
    const b = bounds ?? ALL_BOUNDS;
    const instance = new maplibregl.Map({
      container: container.current!, style: 'https://tiles.openfreemap.org/styles/positron', bounds: [[b[0], b[1]], [b[2], b[3]]], fitBoundsOptions: { padding: 24 },
      maxZoom: 16, attributionControl: { compact: true, customAttribution: 'NASA FIRMS · BPS/HDX · Global Nature Watch · EOX' },
    });
    map.current = instance;
    // The compact attribution opens as soon as it is added and would cover a phone-sized map; it stays one tap away.
    const collapseAttribution = () => container.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
    collapseAttribution();
    if (controls) {
      const box = document.createElement('div');
      box.className = 'maplibregl-ctrl maplibregl-ctrl-group mapctl';
      instance.addControl({ onAdd: () => box, onRemove: () => box.remove() }, 'top-right');
      setHost(box);
    }
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    instance.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: false }), 'bottom-right');
    instance.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    instance.on('load', collapseAttribution);
    // Own layers go in as soon as the style is ready, so incidents load alongside the base map tiles.
    instance.once('style.load', () => {
      const { hours: h, version: v } = state.current;
      const today = hoursSinceMidnightWib();
      const firstSymbol = instance.getStyle().layers?.find(layer => layer.type === 'symbol')?.id;
      instance.addSource('citra', { type: 'raster', tileSize: 256, maxzoom: 15, tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/g/{z}/{y}/{x}.jpg'], attribution: 'Sentinel-2 cloudless 2023 by EOX (CC BY-NC-SA 4.0)' });
      instance.addLayer({ id: 'citra', type: 'raster', source: 'citra', layout: { visibility: 'none' } }, firstSymbol);
      const day = state.current.daily;
      instance.addSource('harian', { type: 'raster', tileSize: 256, maxzoom: day.maxzoom, tiles: [day.tiles], attribution: 'NASA EOSDIS GIBS' });
      instance.addLayer({ id: 'harian', type: 'raster', source: 'harian', layout: { visibility: 'none' } }, firstSymbol);
      instance.addSource('gambut', { type: 'raster', tileSize: 256, maxzoom: 12, tiles: ['https://tiles.globalforestwatch.org/gfw_peatlands/v20230315/is/{z}/{x}/{y}.png'], attribution: 'Global peatland extent · Global Nature Watch (CC BY 4.0)' });
      instance.addLayer({ id: 'gambut', type: 'raster', source: 'gambut', paint: { 'raster-opacity': 0.3 }, layout: { visibility: 'none' } }, firstSymbol);
      instance.addSource('deforestasi', { type: 'raster', tileSize: 256, maxzoom: 14, tiles: ['https://tiles.globalforestwatch.org/gfw_integrated_alerts/latest/dynamic/{z}/{x}/{y}.png'], attribution: 'Integrated deforestation alerts (UMD/GLAD, WUR) · Global Nature Watch' });
      instance.addLayer({ id: 'deforestasi', type: 'raster', source: 'deforestasi', paint: { 'raster-opacity': 0.85 }, layout: { visibility: 'none' } }, firstSymbol);
      instance.addSource('kabupaten', { type: 'vector', tiles: [`${location.origin}/api/v1/tiles/kabupaten/{z}/{x}/{y}.mvt`], maxzoom: 12 });
      instance.addLayer({ id: 'kabupaten-line', type: 'line', source: 'kabupaten', 'source-layer': 'kabupaten', paint: { 'line-color': colors.line, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 10, 0.35], 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.6, 10, 1.6] } });
      instance.addLayer({ id: 'kabupaten-label', type: 'symbol', source: 'kabupaten', 'source-layer': 'kabupaten', maxzoom: 9, layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': colors.line, 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 } });
      instance.addSource('desa', { type: 'vector', tiles: [`${location.origin}/api/v1/tiles/desa/{z}/{x}/{y}.mvt`], minzoom: 8, maxzoom: 14, promoteId: { desa: 'id' } });
      instance.addLayer({ id: 'desa-fill', type: 'fill', source: 'desa', 'source-layer': 'desa', paint: { 'fill-color': '#6B4E37', 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.1, 0.01] } });
      instance.addLayer({ id: 'desa-line', type: 'line', source: 'desa', 'source-layer': 'desa', paint: { 'line-color': '#8A837C', 'line-opacity': 0.55, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.3, 13, 1.2] } });
      instance.addLayer({ id: 'desa-label', type: 'symbol', source: 'desa', 'source-layer': 'desa', minzoom: 11, layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': colors.line, 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 } });
      instance.addSource('fokus', { type: 'geojson', data: empty });
      instance.addLayer({ id: 'fokus-line', type: 'line', source: 'fokus', paint: { 'line-color': colors.ink, 'line-width': 2, 'line-dasharray': [2, 1.2] } });
      instance.addSource('deteksi', { type: 'vector', tiles: tiles('deteksi', h, v), minzoom: 7, maxzoom: 14 });
      instance.addLayer({ id: 'deteksi-modis', type: 'circle', source: 'deteksi', 'source-layer': 'deteksi', filter: modisDetection, paint: { 'circle-radius': kilometreRadius, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-width': 1, 'circle-stroke-color': colors.newest, 'circle-stroke-opacity': 0.35 } });
      instance.addLayer({ id: 'deteksi', type: 'circle', source: 'deteksi', 'source-layer': 'deteksi', paint: { 'circle-radius': detectionRadius, 'circle-color': detectionColor(today), 'circle-opacity': detectionOpacity(today) } });
      instance.addSource('kejadian', { type: 'vector', tiles: tiles('kejadian', h, v), maxzoom: 14 });
      instance.addLayer({ id: 'kejadian', type: 'circle', source: 'kejadian', 'source-layer': 'kejadian', layout: { 'circle-sort-key': incidentSortKey }, paint: {
        'circle-radius': incidentRadius, 'circle-color': levelColor, 'circle-opacity': incidentOpacity, 'circle-stroke-color': incidentStroke, 'circle-stroke-width': incidentStrokeWidth } });
      const badge = checkBadge(2);
      if (badge) instance.addImage('cek', badge, { pixelRatio: 2 });
      instance.addLayer({ id: 'kejadian-cek', type: 'symbol', source: 'kejadian', 'source-layer': 'kejadian', minzoom: 9, filter: checkedFilter(state.current.filters),
        layout: { 'icon-image': 'cek', 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-offset': badgeOffset } });
      instance.addSource('wilayah', { type: 'geojson', data: empty });
      instance.addLayer({ id: 'wilayah-bubble', type: 'circle', source: 'wilayah', maxzoom: OVERVIEW_ZOOM, paint: { 'circle-radius': bubbleRadius, 'circle-color': bubbleColor, 'circle-opacity': 0.88, 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' } });
      instance.addLayer({ id: 'wilayah-count', type: 'symbol', source: 'wilayah', maxzoom: OVERVIEW_ZOOM, layout: { 'text-field': bubbleLabel, 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 4, 10, 7, 12], 'text-allow-overlap': true, 'text-ignore-placement': true }, paint: { 'text-color': '#ffffff' } });
      // Names only once there is room for them (the desktop overview opens at about z5.7, a phone at about z4).
      instance.addLayer({ id: 'wilayah-name', type: 'symbol', source: 'wilayah', minzoom: 5.2, maxzoom: OVERVIEW_ZOOM, layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-anchor': 'top',
        'text-offset': bubbleNameOffset, 'text-optional': true }, paint: { 'text-color': colors.line, 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 } });
      instance.addSource('pilih-deteksi', { type: 'geojson', data: empty });
      instance.addLayer({ id: 'pilih-deteksi', type: 'circle', source: 'pilih-deteksi', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 2, 14, 5], 'circle-color': colors.newest, 'circle-stroke-width': 1, 'circle-stroke-color': '#fff' } });
      instance.addSource('pilih', { type: 'geojson', data: empty });
      instance.addLayer({ id: 'pilih', type: 'circle', source: 'pilih', paint: { 'circle-radius': 16, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-width': 2.5, 'circle-stroke-color': colors.ink } });

      instance.on('click', 'kejadian', event => { const id = event.features?.[0]?.properties?.id; if (id) handlers.current.onSelect?.(String(id)); });
      instance.on('click', 'wilayah-bubble', event => {
        const feature = event.features?.[0]; if (!feature) return;
        const regency = handlers.current.findRegency(String(feature.properties?.name ?? ''));
        const camera = regency ? instance.cameraForBounds([[regency.bbox[0]!, regency.bbox[1]!], [regency.bbox[2]!, regency.bbox[3]!]], { padding: padding() }) : undefined;
        const center = camera?.center ?? ((feature.geometry as GeoJSON.Point).coordinates as [number, number]);
        instance.flyTo({ center, zoom: Math.max(camera?.zoom ?? 0, OVERVIEW_ZOOM + 0.4), duration: 800 });
      });
      instance.on('click', 'desa-fill', event => {
        if (instance.queryRenderedFeatures(event.point, { layers: ['kejadian', 'wilayah-bubble'].filter(id => instance.getLayer(id)) }).length) return;
        const id = event.features?.[0]?.properties?.id; if (id) handlers.current.onVillage?.(String(id));
      });
      let hovered: string | number | undefined;
      instance.on('mousemove', 'desa-fill', event => {
        if (hovered !== undefined) instance.setFeatureState({ source: 'desa', sourceLayer: 'desa', id: hovered }, { hover: false });
        hovered = event.features?.[0]?.id; if (hovered !== undefined) instance.setFeatureState({ source: 'desa', sourceLayer: 'desa', id: hovered }, { hover: true });
      });
      instance.on('mouseleave', 'desa-fill', () => { if (hovered !== undefined) instance.setFeatureState({ source: 'desa', sourceLayer: 'desa', id: hovered }, { hover: false }); hovered = undefined; });
      for (const id of ['kejadian', 'wilayah-bubble']) {
        instance.on('mouseenter', id, () => { instance.getCanvas().style.cursor = 'pointer'; });
        instance.on('mouseleave', id, () => { instance.getCanvas().style.cursor = ''; });
      }
      // The legend explains hotspot age only once the tiles carry it.
      instance.on('idle', function checkAge() {
        if (!instance.getLayer('deteksi') || instance.getZoom() < 7) return;
        if (instance.querySourceFeatures('deteksi', { sourceLayer: 'deteksi' }).some(feature => feature.properties?.age !== undefined && feature.properties.age !== null)) {
          setAgeAware(true); instance.off('idle', checkAge);
        }
      });
      const onZoom = () => setZoomedOut(instance.getZoom() < OVERVIEW_ZOOM);
      instance.on('zoom', onZoom);
      onZoom();
      ready.current = true;
      syncLayers(); syncFilters(); syncOverview(); syncSelected(true); syncFocus();
    });
    return () => { ready.current = false; instance.remove(); map.current = null; setHost(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function syncLayers() {
    const m = map.current; if (!m || !ready.current) return;
    for (const key of ['gambut', 'deforestasi', 'harian', 'citra'] as const) m.setLayoutProperty(key, 'visibility', state.current.layers[key] ? 'visible' : 'none');
    for (const id of ['deteksi', 'deteksi-modis']) m.setLayoutProperty(id, 'visibility', state.current.layers.deteksi ? 'visible' : 'none');
  }
  function syncFilters() {
    const m = map.current; if (!m || !ready.current) return;
    m.setFilter('kejadian', incidentFilter(state.current.filters));
    m.setFilter('kejadian-cek', checkedFilter(state.current.filters));
  }
  function syncTiles() {
    const m = map.current; if (!m || !ready.current) return;
    const { hours: h, version: v } = state.current;
    (m.getSource('kejadian') as maplibregl.VectorTileSource).setTiles(tiles('kejadian', h, v));
    (m.getSource('deteksi') as maplibregl.VectorTileSource).setTiles(tiles('deteksi', h, v));
    const today = hoursSinceMidnightWib();
    m.setPaintProperty('deteksi', 'circle-color', detectionColor(today));
    m.setPaintProperty('deteksi', 'circle-opacity', detectionOpacity(today));
  }
  function syncDaily() {
    const m = map.current; if (!m || !ready.current) return;
    (m.getSource('harian') as maplibregl.RasterTileSource | undefined)?.setTiles([state.current.daily.tiles]);
  }
  function syncOverview() {
    const m = map.current; if (!m || !ready.current) return;
    const { regions: rows, overview: on } = state.current;
    const features: GeoJSON.Feature[] = (on && Array.isArray(rows) ? rows : [])
      .filter(row => row.incidents > 0 && Array.isArray(row.center))
      .map(row => ({ type: 'Feature', geometry: { type: 'Point', coordinates: row.center }, properties: { name: row.name, province: row.province, incidents: row.incidents, label: row.open ?? row.high ?? 0 } }));
    (m.getSource('wilayah') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features });
    const from = on ? OVERVIEW_ZOOM : 0;
    m.setLayerZoomRange('kejadian', from, 24);
    m.setLayerZoomRange('kejadian-cek', Math.max(from, 9), 24);
    m.setLayerZoomRange('deteksi', on ? OVERVIEW_ZOOM : 7, 24);
    m.setLayerZoomRange('deteksi-modis', on ? OVERVIEW_ZOOM : 7, 24);
    // Regency names ride with the bubbles below the overview zoom; above it a polygon cut into tiles would repeat its name.
    m.setLayerZoomRange('kabupaten-label', on ? OVERVIEW_ZOOM : 0, on ? OVERVIEW_ZOOM : 9);
  }
  function syncSelected(initial = false) {
    const m = map.current; if (!m || !ready.current) return;
    const sel = state.current.selected;
    (m.getSource('pilih') as maplibregl.GeoJSONSource).setData(sel ? { type: 'Feature', geometry: { type: 'Point', coordinates: sel.centroid }, properties: {} } : empty);
    (m.getSource('pilih-deteksi') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: (sel?.detections ?? []).map(c => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: {} })) });
    if (sel) m.flyTo({ center: sel.centroid, zoom: Math.max(m.getZoom(), 12), duration: initial ? 0 : 900 });
  }
  function syncFocus() {
    const m = map.current; if (!m || !ready.current) return;
    const f = state.current.focus;
    (m.getSource('fokus') as maplibregl.GeoJSONSource).setData(f ? { type: 'Feature', geometry: f, properties: {} } : empty);
    if (!f) return;
    const coords: number[][] = [];
    const walk = (v: unknown) => { if (Array.isArray(v) && typeof v[0] === 'number') coords.push(v as number[]); else if (Array.isArray(v)) v.forEach(walk); };
    walk((f as { coordinates?: unknown }).coordinates);
    if (coords.length) m.fitBounds([[Math.min(...coords.map(c => c[0]!)), Math.min(...coords.map(c => c[1]!))], [Math.max(...coords.map(c => c[0]!)), Math.max(...coords.map(c => c[1]!))]], { padding: 40, duration: 0 });
  }
  const filterKey = JSON.stringify(filters ?? {});
  useEffect(syncLayers, [layers]);
  useEffect(syncFilters, [filterKey]);
  useEffect(syncTiles, [hours, version]);
  useEffect(() => { const next = dailyLayer(); if (next.tiles !== daily.tiles) setDaily(next); }, [version, layers.harian]);
  useEffect(syncDaily, [daily.tiles]);
  useEffect(syncOverview, [regions.data, overview]);
  useEffect(() => syncSelected(), [selected?.id, selected?.detections?.length]);
  useEffect(syncFocus, [focus]);
  useEffect(() => {
    const m = map.current; if (!m || !bounds) return;
    const box: maplibregl.LngLatBoundsLike = [[bounds[0], bounds[1]], [bounds[2], bounds[3]]];
    // The first view shows the whole region; a region chosen later leaves room for an open card.
    const pad = ready.current ? padding() : 24;
    const camera = m.cameraForBounds(box, { padding: pad });
    const min = state.current.boundsMinZoom;
    if (camera && min !== undefined && (camera.zoom ?? 0) < min) m.flyTo({ center: camera.center, zoom: min, duration: ready.current ? 700 : 0 });
    else m.fitBounds(box, { padding: pad, duration: ready.current ? 700 : 0 });
  }, [bounds?.join(',')]);

  const close = () => { if (panel === 'legend') rememberLegend(true); setPanel(null); };
  const closeButton = <button type="button" className="mapcard-close" aria-label={t('close')} onClick={close}><X size={16} /></button>;
  const toggle = (next: 'layers' | 'legend') => {
    if (panel === next) { close(); return; }
    if (next === 'legend') rememberLegend(false);
    setPanel(next);
  };
  return (
    <div className={`map-pane ${className ?? ''}`}>
      <div ref={container} className="map" role="region" aria-label={t('map')} />
      {host && createPortal(<>
        <button type="button" className={`mapctl-btn ${panel === 'layers' ? 'on' : ''}`} aria-label={t('layers')} title={t('layers')} aria-expanded={panel === 'layers'} onClick={() => toggle('layers')}><Layers size={18} /></button>
        <button type="button" className={`mapctl-btn ${panel === 'legend' ? 'on' : ''}`} aria-label={t('legend')} title={t('legend')} aria-expanded={panel === 'legend'} onClick={() => toggle('legend')}><List size={18} /></button>
      </>, host)}
      {panel === 'layers' && (
        <div className="mapcard" role="dialog" aria-label={t('layersTitle')}>
          <div className="mapcard-head"><h3>{t('layersTitle')}</h3>{closeButton}</div>
          {layerInfo.map(({ key, label, source, icon: Icon }) => (
            <label key={key} className="maplayer"><Icon size={18} className="icon" aria-hidden="true" />
              <span>{t(label)}<small>{key === 'harian' ? t('harianSource', { satellite: daily.satellite, date: f.day(`${daily.date}T12:00:00+07:00`), part: t(daily.part) }) : t(source)}</small></span>
              <input type="checkbox" checked={layers[key]} onChange={event => setLayers(prev => ({ ...prev, [key]: event.target.checked }))} /><i className="maplayer-switch" aria-hidden="true" /></label>
          ))}
        </div>
      )}
      {panel === 'legend' && (
        <div className="mapcard" role="dialog" aria-label={t('legend')}>
          {overview && zoomedOut ? (<>
            <div className="mapcard-head"><h3>{t('regencies')}</h3>{closeButton}</div>
            <div className="lg-row"><i className="lg-bubble">12</i>{t('bubble')}</div>
            <div className="lg-row"><i className="lg-bubble lg-bubble-none" />{t('bubbleNone')}</div>
            <p className="lg-note">{t('bubbleNote')}</p>
          </>) : (<>
            <div className="mapcard-head"><h3>{t('incidents')}</h3>{closeButton}</div>
            <div className="lg-row lg-inline">
              {(['tinggi', 'sedang', 'rendah'] as const).map(level => <span key={level}><i className="lg-dot" style={{ background: colors[levelKey[level]] }} />{f.level(level)}</span>)}
            </div>
            <div className="lg-row lg-inline">
              <span><i className="lg-dot lg-ring" style={{ borderColor: colors.checked }} />{t('checked')}</span>
              <span><i className="lg-dot lg-ring" style={{ borderColor: colors.assigned }} />{t('assigned')}</span>
            </div>
            <div className="lg-row"><i className="lg-dot" style={{ background: colors.high, opacity: 0.55 }} />{t('modisOnly')}</div>
            <div className="lg-row lg-sizes"><span><i className="lg-dot lg-s0" />1–4</span><span><i className="lg-dot lg-s1" />5–19</span><span><i className="lg-dot lg-s2" />20+</span><small>{t('sizeNote')}</small></div>
            <h3 className="lg-title">{ageAware ? t('hotspots') : t('hotspotsConfidence')}</h3>
            <div className="lg-row lg-inline">
              <span><i className="lg-dot lg-small" style={{ background: colors.newest }} />{ageAware ? t('newest') : t('confHigh')}</span>
              <span><i className="lg-dot lg-small" style={{ background: colors.today }} />{ageAware ? t('today') : t('confNominal')}</span>
              <span><i className="lg-dot lg-small" style={{ background: colors.older }} />{ageAware ? t('older') : t('confLow')}</span>
            </div>
            <div className="lg-row"><i className="lg-dot lg-ring lg-thin" style={{ borderColor: colors.newest }} />{t('modisRing')}</div>
          </>)}
        </div>
      )}
    </div>
  );
}
