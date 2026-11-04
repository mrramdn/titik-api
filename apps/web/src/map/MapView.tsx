import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Droplets, Earth, Gauge, Image, Layers, List, Satellite, Trees, X, type LucideIcon } from 'lucide-react';
import { tanggalParam, type RegionSummary, type Risk } from '../api';
import { dict, useT } from '../i18n';
import { useApi } from '../components/ui';
import { refuseImagery, useConfig } from '../config';
import { useFormat } from '../format';
import { ALL_BOUNDS, useRegion } from '../region';
import { useSession } from '../session';
import { ageClock } from './archive';
import { checkBadge } from './badge';
import { dailyLayer, dailyLayerFor } from './imagery';
import {
  dotZoomRange, EOX_ATTRIBUTION, EOX_TILES, esriSource, esriWatch, ESRI_ZOOM, footprintLayers, FOOTPRINT_ZOOM, imageryZoom, keepAttributionOpen, OVERVIEW_ZOOM,
  sentinelUnderEsri, tileUrls,
} from './layers';
import { Legend } from './Legend';
import { RISK_ATTRIBUTION, riskFeatures, riskFill, riskOpacity, riskPath, shownRiskDay } from './risk';
import { todayWib } from '../components/bpbd/data';
import { RiskCell, RiskDays } from './RiskParts';
import {
  badgeOffset, bubbleColor, bubbleLabel, bubbleNameOffset, bubbleRadius, checkedFilter, colors, detectionColor, detectionOpacity, detectionRadius,
  incidentFilter, incidentOpacity, incidentRadius, incidentSortKey, incidentStroke, incidentStrokeWidth, kilometreRadius, levelColor,
  modisDetection, type MapFilters,
} from './style';

export type { MapFilters } from './style';
maplibregl.setWorkerUrl(workerUrl);

export type LayerKey = 'deteksi' | 'gambut' | 'deforestasi' | 'risiko' | 'harian' | 'citra';
export interface Selected { id: string; centroid: [number, number]; detections?: [number, number][] }
interface Props {
  /** Map filters; optional so existing callers keep working. */
  filters?: MapFilters;
  /** Changes when a new ingest run lands; tile URLs carry it so the map refreshes. */
  version?: number;
  hours?: number;
  /** An archive day (YYYY-MM-DD); '' or none for live data. */
  tanggal?: string;
  bounds?: [number, number, number, number];
  /** The map zooms in at least this far when it fits `bounds` (a regency should open on its incidents). */
  boundsMinZoom?: number;
  selected?: Selected | null;
  focus?: GeoJSON.Geometry | null;
  initialLayers?: Partial<Record<LayerKey, boolean>>;
  /** The fire danger day (YYYY-MM-DD) shown first; without one the map shows today, or the archive day. */
  initialRiskDate?: string | null;
  onSelect?: (id: string) => void;
  onVillage?: (id: string) => void;
  controls?: boolean;
  /** Opens the legend on wide screens. */
  legend?: boolean;
  /** One bubble per regency below zoom 8 (default). False shows the incidents at every zoom. */
  overview?: boolean;
  className?: string;
}

const text = dict({
  id: {
    map: 'Peta titik panas', layers: 'Lapisan', layersTitle: 'Lapisan peta', legend: 'Legenda', close: 'Tutup',
    deteksi: 'Titik panas satelit', deteksiSource: 'NASA FIRMS, VIIRS 375 m dan MODIS 1 km', gambut: 'Lahan gambut', gambutSource: 'Global peatland extent',
    deforestasi: 'Peringatan gangguan hutan', deforestasiSource: 'GLAD-L, GLAD-S2, RADD', harian: 'Citra satelit harian', harianSource: '{satellite}, {date} {part} · NASA GIBS',
    morning: 'pagi', midday: 'siang', citra: 'Citra detail', citraSource: 'Sentinel-2 cloudless 2023, EOX', citraEsri: 'Sentinel-2 cloudless 2023, EOX · dari dekat Esri World Imagery',
    risiko: 'Bahaya kebakaran (FWI)', risikoSource: 'Dihitung dari Open-Meteo, kelas BMKG', satellite: 'Tampilan satelit',
  },
  en: {
    map: 'Hotspot map', layers: 'Layers', layersTitle: 'Map layers', legend: 'Legend', close: 'Close',
    deteksi: 'Satellite hotspots', deteksiSource: 'NASA FIRMS, VIIRS 375 m and MODIS 1 km', gambut: 'Peatland', gambutSource: 'Global peatland extent',
    deforestasi: 'Forest disturbance alerts', deforestasiSource: 'GLAD-L, GLAD-S2, RADD', harian: 'Daily satellite image', harianSource: '{satellite}, {date} {part} · NASA GIBS',
    morning: 'morning', midday: 'midday', citra: 'Detailed imagery', citraSource: 'Sentinel-2 cloudless 2023, EOX', citraEsri: 'Sentinel-2 cloudless 2023, EOX · close up Esri World Imagery',
    risiko: 'Fire danger (FWI)', risikoSource: 'Computed from Open-Meteo, BMKG classes', satellite: 'Satellite view',
  },
});
type Key = keyof typeof text.id;

const layerInfo: { key: LayerKey; label: Key; source: Key; icon: LucideIcon }[] = [
  { key: 'deteksi', label: 'deteksi', source: 'deteksiSource', icon: Satellite },
  { key: 'gambut', label: 'gambut', source: 'gambutSource', icon: Droplets },
  { key: 'deforestasi', label: 'deforestasi', source: 'deforestasiSource', icon: Trees },
  { key: 'risiko', label: 'risiko', source: 'risikoSource', icon: Gauge },
  { key: 'harian', label: 'harian', source: 'harianSource', icon: Earth },
  { key: 'citra', label: 'citra', source: 'citraSource', icon: Image },
];

const tiles = (layer: 'kejadian' | 'deteksi', hours: number, version: number, tanggal: string, demo: boolean) => tileUrls(layer, hours, version, tanggal, location.origin, demo);
const wide = () => typeof matchMedia === 'function' && matchMedia('(min-width: 1280px)').matches;
// The legend opens by itself on wide screens until the visitor closes it once.
const legendKey = 'titikapi.legend';
const legendClosed = () => { try { return localStorage.getItem(legendKey) === 'closed'; } catch { return false; } };
const rememberLegend = (closed: boolean) => { try { if (closed) localStorage.setItem(legendKey, 'closed'); else localStorage.removeItem(legendKey); } catch { /* private mode */ } };
const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

export function MapView({ filters, version = 0, hours = 24, tanggal = '', bounds, boundsMinZoom, selected, focus, initialLayers, initialRiskDate = null, onSelect, onVillage, controls = true, legend = true, overview: bubbles = true, className }: Props) {
  const t = useT(text), f = useFormat();
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const ready = useRef(false);
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({ deteksi: true, gambut: false, deforestasi: false, risiko: false, harian: false, citra: false, ...initialLayers });
  // The newest complete daily image (it changes at midday and in the evening, checked again with every ingest run), or
  // the archive day's midday image.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const daily = useMemo(() => (tanggal ? dailyLayerFor(tanggal) : dailyLayer()), [tanggal, version, layers.harian]);
  const [panel, setPanel] = useState<'layers' | 'legend' | 'risk' | null>(() => (legend && controls && wide() && !legendClosed() ? 'legend' : null));
  const panelOpen = useRef(panel !== null);
  panelOpen.current = panel !== null;
  /** Fitting a region leaves room for an open legend or layer card on the right. */
  const padding = () => ({ top: 24, bottom: 24, left: 24, right: panelOpen.current && wide() ? 324 : 24 });
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [ageAware, setAgeAware] = useState(false);
  // Below the overview zoom the map shows regency bubbles only, and the legend explains just those; from the footprint
  // zoom hotspots are boxes.
  const [zoomedOut, setZoomedOut] = useState(true);
  const [closeUp, setCloseUp] = useState(false);
  const { query, findRegency } = useRegion();
  // A demo session sees its own field checks and tasks on the incident dots too; everyone else sees real ones only.
  const demo = Boolean(useSession().user?.demo);
  // HD imagery when GET /config offers it (the API serves Esri's tiles); otherwise the satellite view stays EOX
  // Sentinel-2 close up, also once the API stops serving Esri's tiles to this visitor (esriRefused). A server older
  // than GET /config sends no pixel footprints: its hotspots stay dots at every zoom.
  const config = useConfig();
  const [esriRefused, setEsriRefused] = useState(false);
  const hdImagery = (config?.hdImagery ?? false) && !esriRefused;
  const imageryAttribution = config?.imageryAttribution ?? null;
  const footprints = config?.current !== false;
  // Fire danger (GET /risk, which came with GET /config): fetched while the layer is on; three days live, one in the
  // archive. Nothing is drawn until the weather has been fetched once (fetchedAt).
  const riskOn = layers.risiko && config?.current !== false;
  const risk = useApi<Risk>(riskOn ? riskPath(tanggal) : null, version);
  const riskData = riskOn && risk.data?.fetchedAt ? risk.data : null;
  // The day is kept as a date, so a newer answer (one more day, one less) keeps showing the same day.
  const [riskDate, setRiskDate] = useState<string | null>(initialRiskDate);
  const shownDay = shownRiskDay(riskData, riskDate, tanggal || todayWib());
  const [riskCell, setRiskCell] = useState<number | null>(null);
  const regions = useApi<RegionSummary[]>(bubbles ? `/regions/summary?hours=${hours}${query}${tanggalParam(tanggal)}` : null, version);
  // Bubbles need GET /regions/summary; without it (an older API) incidents show at every zoom instead. A later failed
  // refresh keeps the bubbles it already has.
  const overview = bubbles && (Array.isArray(regions.data) || (regions.data === null && !regions.error));
  const onRiskCell = (index: number) => { setRiskCell(index); setPanel('risk'); };
  const handlers = useRef({ onSelect, onVillage, findRegency, onRiskCell });
  handlers.current = { onSelect, onVillage, findRegency, onRiskCell };
  const state = useRef({ hours, version, tanggal, demo, layers, selected, focus, filters, regions: regions.data, overview, boundsMinZoom, daily, hdImagery, imageryAttribution, footprints, risk: riskData, riskDay: shownDay });
  state.current = { hours, version, tanggal, demo, layers, selected, focus, filters, regions: regions.data, overview, boundsMinZoom, daily, hdImagery, imageryAttribution, footprints, risk: riskData, riskDay: shownDay };
  const attribution = () => container.current?.querySelector<HTMLElement>('.maplibregl-ctrl-attrib') ?? null;
  /** True while the attribution is held open for Esri's imagery. */
  const attributionHeld = useRef(false);

  useEffect(() => {
    const b = bounds ?? ALL_BOUNDS;
    const instance = new maplibregl.Map({
      container: container.current!, style: 'https://tiles.openfreemap.org/styles/positron', bounds: [[b[0], b[1]], [b[2], b[3]]], fitBoundsOptions: { padding: 24 },
      maxZoom: 18, attributionControl: { compact: true, customAttribution: 'NASA FIRMS · BPS/HDX · Global Nature Watch · EOX' },
    });
    map.current = instance;
    // The compact attribution opens as soon as it is added and would cover a phone-sized map; it stays one tap away,
    // except while Esri's imagery shows on a wider map (syncAttribution).
    const collapseAttribution = () => {
      attribution()?.classList.remove('maplibregl-compact-show');
      attributionHeld.current = false;
      syncAttribution();
    };
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
    // MapLibre folds the attribution away on every drag; Esri's comes straight back.
    instance.on('drag', syncAttribution);
    instance.on('resize', syncAttribution);
    // When the API refuses Esri's tiles (a cap, too many from this address) or Esri keeps failing, the close-up goes
    // back to Sentinel-2 instead of staying empty. With a listener here MapLibre no longer prints other errors itself.
    const esriGivesWay = esriWatch();
    instance.on('error', event => {
      const { sourceId, error } = event as maplibregl.ErrorEvent & { sourceId?: string };
      if (sourceId !== 'esri') { console.error(error); return; }
      if (esriGivesWay((error as { status?: unknown }).status)) {
        refuseImagery();
        setEsriRefused(true);
      }
    });
    // Own layers go in as soon as the style is ready, so incidents load alongside the base map tiles.
    instance.once('style.load', () => {
      const { hours: h, version: v, tanggal: day, demo: d } = state.current;
      const today = ageClock(day);
      const firstSymbol = instance.getStyle().layers?.find(layer => layer.type === 'symbol')?.id;
      instance.addSource('citra', { type: 'raster', tileSize: 256, maxzoom: 15, tiles: [EOX_TILES], attribution: EOX_ATTRIBUTION });
      instance.addLayer({ id: 'citra', type: 'raster', source: 'citra', minzoom: 9, layout: { visibility: 'none' } }, firstSymbol);
      const image = state.current.daily;
      instance.addSource('harian', { type: 'raster', tileSize: 256, maxzoom: image.maxzoom, tiles: [image.tiles], attribution: 'NASA EOSDIS GIBS' });
      // GIBS tiles stop at zoom 9; past that the Sentinel-2 layer (minzoom 9) takes over.
      instance.addLayer({ id: 'harian', type: 'raster', source: 'harian', maxzoom: 9, layout: { visibility: 'none' } }, firstSymbol);
      instance.addSource('gambut', { type: 'raster', tileSize: 256, maxzoom: 12, tiles: ['https://tiles.globalforestwatch.org/gfw_peatlands/v20230315/is/{z}/{x}/{y}.png'], attribution: 'Global peatland extent · Global Nature Watch (CC BY 4.0)' });
      instance.addLayer({ id: 'gambut', type: 'raster', source: 'gambut', paint: { 'raster-opacity': 0.3 }, layout: { visibility: 'none' } }, firstSymbol);
      instance.addSource('deforestasi', { type: 'raster', tileSize: 256, maxzoom: 14, tiles: ['https://tiles.globalforestwatch.org/gfw_integrated_alerts/latest/dynamic/{z}/{x}/{y}.png'], attribution: 'Integrated deforestation alerts (UMD/GLAD, WUR) · Global Nature Watch' });
      instance.addLayer({ id: 'deforestasi', type: 'raster', source: 'deforestasi', paint: { 'raster-opacity': 0.85 }, layout: { visibility: 'none' } }, firstSymbol);
      // Fire danger cells over the imagery and under the place names; Open-Meteo's and Copernicus's credit shows while they do.
      instance.addSource('risiko', { type: 'geojson', data: empty, attribution: RISK_ATTRIBUTION });
      instance.addLayer({ id: 'risiko', type: 'fill', source: 'risiko', paint: { 'fill-color': riskFill, 'fill-opacity': riskOpacity }, layout: { visibility: 'none' } }, firstSymbol);
      instance.addSource('kabupaten', { type: 'vector', tiles: [`${location.origin}/api/v1/tiles/kabupaten/{z}/{x}/{y}.mvt`], maxzoom: 12 });
      instance.addLayer({ id: 'kabupaten-line', type: 'line', source: 'kabupaten', 'source-layer': 'kabupaten', paint: { 'line-color': colors.line, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 10, 0.35], 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.6, 10, 1.6] } });
      instance.addLayer({ id: 'kabupaten-label', type: 'symbol', source: 'kabupaten', 'source-layer': 'kabupaten', maxzoom: 9, layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': colors.line, 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 } });
      instance.addSource('desa', { type: 'vector', tiles: [`${location.origin}/api/v1/tiles/desa/{z}/{x}/{y}.mvt`], minzoom: 8, maxzoom: 14, promoteId: { desa: 'id' } });
      instance.addLayer({ id: 'desa-fill', type: 'fill', source: 'desa', 'source-layer': 'desa', paint: { 'fill-color': '#6B4E37', 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.1, 0.01] } });
      instance.addLayer({ id: 'desa-line', type: 'line', source: 'desa', 'source-layer': 'desa', paint: { 'line-color': '#8A837C', 'line-opacity': 0.55, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.3, 13, 1.2] } });
      instance.addLayer({ id: 'desa-label', type: 'symbol', source: 'desa', 'source-layer': 'desa', minzoom: 11, layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': colors.line, 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 } });
      instance.addSource('fokus', { type: 'geojson', data: empty });
      instance.addLayer({ id: 'fokus-line', type: 'line', source: 'fokus', paint: { 'line-color': colors.ink, 'line-width': 2, 'line-dasharray': [2, 1.2] } });
      instance.addSource('deteksi', { type: 'vector', tiles: tiles('deteksi', h, v, day, d), minzoom: 7, maxzoom: 14 });
      instance.addLayer({ id: 'deteksi-modis', type: 'circle', source: 'deteksi', 'source-layer': 'deteksi', filter: modisDetection, paint: { 'circle-radius': kilometreRadius, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-width': 1, 'circle-stroke-color': colors.newest, 'circle-stroke-opacity': 0.35 } });
      instance.addLayer({ id: 'deteksi', type: 'circle', source: 'deteksi', 'source-layer': 'deteksi', paint: { 'circle-radius': detectionRadius, 'circle-color': detectionColor(today), 'circle-opacity': detectionOpacity(today) } });
      for (const layer of footprintLayers(today)) instance.addLayer(layer);
      instance.addSource('kejadian', { type: 'vector', tiles: tiles('kejadian', h, v, day, d), maxzoom: 14 });
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
      const onIncident = (point: maplibregl.PointLike) => instance.queryRenderedFeatures(point, { layers: ['kejadian', 'wilayah-bubble'].filter(id => instance.getLayer(id)) }).length > 0;
      // While the fire danger cells are on screen a tap explains the cell under it instead of opening the village.
      const riskShown = () => instance.getLayoutProperty('risiko', 'visibility') === 'visible';
      instance.on('click', 'desa-fill', event => {
        if (riskShown() || onIncident(event.point)) return;
        const id = event.features?.[0]?.properties?.id; if (id) handlers.current.onVillage?.(String(id));
      });
      instance.on('click', 'risiko', event => {
        if (onIncident(event.point)) return;
        const cell = event.features?.[0]?.properties?.cell;
        if (typeof cell === 'number') handlers.current.onRiskCell(cell);
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
      const onZoom = () => { setZoomedOut(instance.getZoom() < OVERVIEW_ZOOM); setCloseUp(instance.getZoom() >= FOOTPRINT_ZOOM); syncAttribution(); };
      instance.on('zoom', onZoom);
      onZoom();
      ready.current = true;
      syncLayers(); syncImagery(); syncRisk(); syncFilters(); syncOverview(); syncSelected(true); syncFocus();
    });
    return () => { ready.current = false; instance.remove(); map.current = null; setHost(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function syncLayers() {
    const m = map.current; if (!m || !ready.current) return;
    for (const key of ['gambut', 'deforestasi', 'harian', 'citra'] as const) m.setLayoutProperty(key, 'visibility', state.current.layers[key] ? 'visible' : 'none');
    for (const id of ['deteksi', 'deteksi-modis', 'piksel-fill', 'piksel-line']) m.setLayoutProperty(id, 'visibility', state.current.layers.deteksi ? 'visible' : 'none');
  }
  /**
   * Esri World Imagery joins the detailed imagery from zoom 11 once GET /config offers it, over a coarse Sentinel-2 for
   * the tiles it lacks; the full Sentinel-2 layer then stops at 11. When Esri is refused both go and Sentinel-2 is back.
   */
  function syncImagery() {
    const m = map.current; if (!m || !ready.current) return;
    const { hdImagery: hd, imageryAttribution: credit } = state.current;
    const source = esriSource({ hdImagery: hd, imageryAttribution: credit }, location.origin);
    if (source && !m.getSource('esri')) {
      m.addSource('citra-latar', sentinelUnderEsri());
      m.addLayer({ id: 'citra-latar', type: 'raster', source: 'citra-latar', minzoom: ESRI_ZOOM, layout: { visibility: 'none' } }, 'harian');
      m.addSource('esri', source);
      m.addLayer({ id: 'esri', type: 'raster', source: 'esri', minzoom: ESRI_ZOOM, layout: { visibility: 'none' } }, 'harian');
    } else if (!source && m.getSource('esri')) {
      for (const id of ['esri', 'citra-latar']) { m.removeLayer(id); m.removeSource(id); }
    }
    const esri = Boolean(m.getLayer('esri'));
    const [from, to] = imageryZoom(esri).citra;
    m.setLayerZoomRange('citra', from, to);
    if (esri) for (const id of ['citra-latar', 'esri']) m.setLayoutProperty(id, 'visibility', state.current.layers.citra ? 'visible' : 'none');
    syncAttribution();
  }
  /** Esri's attribution is held open while its imagery shows on a wide map; when it goes, the attribution folds again. */
  function syncAttribution() {
    const m = map.current, element = attribution(); if (!m || !ready.current || !element) return;
    const hold = keepAttributionOpen({ esri: Boolean(m.getLayer('esri')), citra: state.current.layers.citra, zoom: m.getZoom(), width: m.getContainer().offsetWidth });
    if (hold) {
      element.classList.add('maplibregl-compact-show');
      element.setAttribute('open', '');
    } else if (attributionHeld.current) element.classList.remove('maplibregl-compact-show');
    attributionHeld.current = hold;
  }
  /** The fire danger grid for the chosen day; hidden while the layer is off or nothing has been computed. */
  function syncRisk() {
    const m = map.current; if (!m || !ready.current) return;
    const { risk: data, riskDay: day } = state.current;
    (m.getSource('risiko') as maplibregl.GeoJSONSource).setData(data ? riskFeatures(data, day) : empty);
    m.setLayoutProperty('risiko', 'visibility', data ? 'visible' : 'none');
  }
  function syncFilters() {
    const m = map.current; if (!m || !ready.current) return;
    m.setFilter('kejadian', incidentFilter(state.current.filters));
    m.setFilter('kejadian-cek', checkedFilter(state.current.filters));
  }
  function syncTiles() {
    const m = map.current; if (!m || !ready.current) return;
    const { hours: h, version: v, tanggal: day, demo: d } = state.current;
    (m.getSource('kejadian') as maplibregl.VectorTileSource).setTiles(tiles('kejadian', h, v, day, d));
    (m.getSource('deteksi') as maplibregl.VectorTileSource).setTiles(tiles('deteksi', h, v, day, d));
    const today = ageClock(day);
    m.setPaintProperty('deteksi', 'circle-color', detectionColor(today));
    m.setPaintProperty('deteksi', 'circle-opacity', detectionOpacity(today));
    m.setPaintProperty('piksel-fill', 'fill-color', detectionColor(today));
    m.setPaintProperty('piksel-line', 'line-color', detectionColor(today));
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
    // Dots below the footprint zoom, the pixel boxes from it.
    const [lowest, highest] = dotZoomRange(on, state.current.footprints);
    m.setLayerZoomRange('deteksi', lowest, highest);
    m.setLayerZoomRange('deteksi-modis', lowest, highest);
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
  useEffect(syncImagery, [hdImagery, imageryAttribution, layers.citra]);
  useEffect(syncRisk, [riskData, shownDay]);
  // The cell card goes with the layer.
  useEffect(() => { if (!riskData && panel === 'risk') setPanel(null); }, [riskData]);
  useEffect(syncFilters, [filterKey]);
  useEffect(syncTiles, [hours, version, tanggal, demo]);
  useEffect(syncDaily, [daily.tiles]);
  useEffect(syncOverview, [regions.data, overview, footprints]);
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

  // Satellite view: today's NASA image when zoomed out, the sharper Sentinel-2 mosaic when zoomed in, and Esri World
  // Imagery close up when the server offers it.
  const satellite = layers.harian && layers.citra;
  const close = () => { if (panel === 'legend') rememberLegend(true); setPanel(null); };
  const closeButton = <button type="button" className="mapcard-close" aria-label={t('close')} onClick={close}><X size={16} /></button>;
  const toggle = (next: 'layers' | 'legend') => {
    if (panel === next) { close(); return; }
    if (next === 'legend') rememberLegend(false);
    setPanel(next);
  };
  // The fire danger layer is offered once GET /config shows a server that has GET /risk.
  const shownLayers = layerInfo.filter(({ key }) => key !== 'risiko' || config?.current === true || layers.risiko);
  const cellDay = panel === 'risk' && riskData && riskCell !== null ? riskData.cells[riskCell]?.days[shownDay] : undefined;
  return (
    <div className={`map-pane ${className ?? ''}`}>
      <div ref={container} className="map" role="region" aria-label={t('map')} />
      {riskOn && <RiskDays risk={risk} day={shownDay} onDay={index => setRiskDate(risk.data?.cells[0]?.days[index]?.date ?? null)} />}
      {host && createPortal(<>
        <button type="button" className={`mapctl-btn ${panel === 'layers' ? 'on' : ''}`} aria-label={t('layers')} title={t('layers')} aria-expanded={panel === 'layers'} onClick={() => toggle('layers')}><Layers size={18} /></button>
        <button type="button" className={`mapctl-btn ${panel === 'legend' ? 'on' : ''}`} aria-label={t('legend')} title={t('legend')} aria-expanded={panel === 'legend'} onClick={() => toggle('legend')}><List size={18} /></button>
        <button type="button" className={`mapctl-btn ${satellite ? 'on' : ''}`} aria-label={t('satellite')} title={t('satellite')} aria-pressed={satellite}
          onClick={() => setLayers(previous => ({ ...previous, harian: !satellite, citra: !satellite }))}><Earth size={18} /></button>
      </>, host)}
      {panel === 'layers' && (
        <div className="mapcard" role="dialog" aria-label={t('layersTitle')}>
          <div className="mapcard-head"><h3>{t('layersTitle')}</h3>{closeButton}</div>
          {shownLayers.map(({ key, label, source, icon: Icon }) => (
            <label key={key} className="maplayer"><Icon size={18} className="icon" aria-hidden="true" />
              <span>{t(label)}<small>{key === 'harian' ? t('harianSource', { satellite: daily.satellite, date: f.day(`${daily.date}T12:00:00+07:00`), part: t(daily.part) })
                : key === 'citra' && hdImagery ? t('citraEsri') : t(source)}</small></span>
              <input type="checkbox" checked={layers[key]} onChange={event => setLayers(prev => ({ ...prev, [key]: event.target.checked }))} /><i className="maplayer-switch" aria-hidden="true" /></label>
          ))}
        </div>
      )}
      {panel === 'legend' && <Legend bubbles={overview && zoomedOut} ageAware={ageAware} archive={Boolean(tanggal)} boxes={closeUp && footprints} risk={Boolean(riskData)} closeButton={closeButton} />}
      {cellDay && <RiskCell day={cellDay} closeButton={closeButton} />}
    </div>
  );
}
