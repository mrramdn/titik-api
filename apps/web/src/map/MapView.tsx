import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Incident } from '../api';

maplibregl.setWorkerUrl(workerUrl);

export type LayerKey = 'gambut' | 'deforestasi' | 'citra' | 'deteksi';
export const OKI_BOUNDS: [[number, number], [number, number]] = [[104.62, -4.29], [106.21, -2.37]];
const levelColor = ['match', ['get', 'level'], 'tinggi', '#E8501A', 'sedang', '#F59E0B', '#9A9188'] as unknown as maplibregl.ExpressionSpecification;

interface Props {
  incidents?: Incident[];
  detections?: GeoJSON.FeatureCollection;
  focus?: GeoJSON.Geometry | null;
  center?: [number, number] | null;
  marker?: [number, number] | null;
  layers?: Partial<Record<LayerKey, boolean>>;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onVillage?: (id: string) => void;
  showVillages?: boolean;
  className?: string;
  zoom?: number;
}

const incidentFeatures = (incidents: Incident[] = []): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features: incidents.map(incident => ({
  type: 'Feature', id: incident.id, geometry: { type: 'Point', coordinates: incident.centroid },
  properties: { id: incident.id, level: incident.level, count: incident.detectionCount, verified: Boolean(incident.firstVerifiedAt), score: incident.score },
})) });

export function MapView({ incidents, detections, focus, center, marker, layers = {}, selectedId, onSelect, onVillage, showVillages = true, className, zoom }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const ready = useRef(false);
  const latest = useRef({ incidents, detections, focus, marker, layers, selectedId, onSelect, onVillage });
  latest.current = { incidents, detections, focus, marker, layers, selectedId, onSelect, onVillage };

  useEffect(() => {
    const instance = new maplibregl.Map({
      container: container.current!,
      style: 'https://tiles.openfreemap.org/styles/positron',
      bounds: center ? undefined : OKI_BOUNDS,
      center: center ?? undefined,
      zoom: center ? zoom ?? 13 : undefined,
      fitBoundsOptions: { padding: 24 },
      attributionControl: { compact: true, customAttribution: 'Titik panas: NASA FIRMS · Batas desa: BPS/HDX · Gambut & alert hutan: Global Nature Watch · Citra: Sentinel-2 cloudless (EOX)' },
      maxZoom: 17,
    });
    map.current = instance;
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    instance.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    instance.on('load', () => {
      const firstSymbol = instance.getStyle().layers?.find(layer => layer.type === 'symbol')?.id;
      instance.addSource('citra', { type: 'raster', tileSize: 256, maxzoom: 15, attribution: 'Sentinel-2 cloudless 2023 by EOX (CC BY-NC-SA 4.0)',
        tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/g/{z}/{y}/{x}.jpg'] });
      instance.addLayer({ id: 'citra', type: 'raster', source: 'citra', layout: { visibility: 'none' } }, firstSymbol);
      instance.addSource('gambut', { type: 'raster', tileSize: 256, maxzoom: 12, attribution: 'Global peatland extent (Miettinen et al. 2016) · Global Nature Watch (CC BY 4.0)',
        tiles: ['https://tiles.globalforestwatch.org/gfw_peatlands/v20230315/is/{z}/{x}/{y}.png'] });
      instance.addLayer({ id: 'gambut', type: 'raster', source: 'gambut', paint: { 'raster-opacity': 0.32 }, layout: { visibility: 'none' } }, firstSymbol);
      instance.addSource('deforestasi', { type: 'raster', tileSize: 256, maxzoom: 14, attribution: 'Integrated deforestation alerts (UMD/GLAD, WUR) · Global Nature Watch (CC BY 4.0)',
        tiles: ['https://tiles.globalforestwatch.org/gfw_integrated_alerts/latest/dynamic/{z}/{x}/{y}.png'] });
      instance.addLayer({ id: 'deforestasi', type: 'raster', source: 'deforestasi', paint: { 'raster-opacity': 0.85 }, layout: { visibility: 'none' } }, firstSymbol);

      instance.addSource('desa', { type: 'geojson', data: '/api/v1/villages.geojson', promoteId: 'id' });
      instance.addLayer({ id: 'desa-fill', type: 'fill', source: 'desa', paint: { 'fill-color': '#6B4E37', 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.12, 0.02] },
        layout: { visibility: showVillages ? 'visible' : 'none' } });
      instance.addLayer({ id: 'desa-line', type: 'line', source: 'desa', paint: { 'line-color': '#6B4E37', 'line-opacity': 0.45, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.4, 13, 1.4] },
        layout: { visibility: showVillages ? 'visible' : 'none' } });
      instance.addLayer({ id: 'desa-label', type: 'symbol', source: 'desa', minzoom: 11, layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-font': ['Noto Sans Regular'], visibility: showVillages ? 'visible' : 'none' },
        paint: { 'text-color': '#4A4038', 'text-halo-color': '#F5F0E8', 'text-halo-width': 1.4 } });

      instance.addSource('fokus', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      instance.addLayer({ id: 'fokus-line', type: 'line', source: 'fokus', paint: { 'line-color': '#1B1612', 'line-width': 2.2, 'line-dasharray': [2, 1.2] } });

      instance.addSource('deteksi', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      instance.addLayer({ id: 'deteksi', type: 'circle', source: 'deteksi', paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 1.6, 12, 3.5, 15, 7],
        'circle-color': ['match', ['get', 'confidence'], 'high', '#C2410C', 'nominal', '#EA7A3B', '#B8A99A'],
        'circle-opacity': ['case', ['==', ['get', 'villageId'], null], 0.35, 0.85] } });

      instance.addSource('kejadian', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      instance.addLayer({ id: 'kejadian-halo', type: 'circle', source: 'kejadian', filter: ['==', ['get', 'level'], 'tinggi'], paint: {
        'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 1, 12, 30, 22, 300, 34], 'circle-color': '#E8501A', 'circle-opacity': 0.14 } });
      instance.addLayer({ id: 'kejadian', type: 'circle', source: 'kejadian', paint: {
        'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 1, 5, 30, 10, 300, 16],
        'circle-color': levelColor, 'circle-stroke-width': ['case', ['get', 'verified'], 3, 1.5],
        'circle-stroke-color': ['case', ['get', 'verified'], '#2E7D4F', '#FFFFFF'] } });
      instance.addLayer({ id: 'kejadian-pilih', type: 'circle', source: 'kejadian', filter: ['==', ['get', 'id'], ''], paint: {
        'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 1, 11, 30, 16, 300, 22], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-width': 2.5, 'circle-stroke-color': '#1B1612' } });

      instance.addSource('penanda', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      instance.addLayer({ id: 'penanda', type: 'circle', source: 'penanda', paint: { 'circle-radius': 7, 'circle-color': '#2B6CB0', 'circle-stroke-width': 3, 'circle-stroke-color': '#FFFFFF' } });

      instance.on('click', 'kejadian', event => { const id = event.features?.[0]?.properties?.id; if (id) latest.current.onSelect?.(id); });
      instance.on('click', 'desa-fill', event => {
        if (instance.queryRenderedFeatures(event.point, { layers: ['kejadian'] }).length) return;
        const id = event.features?.[0]?.properties?.id; if (id) latest.current.onVillage?.(id);
      });
      let hovered: string | number | undefined;
      instance.on('mousemove', 'desa-fill', event => {
        if (hovered !== undefined) instance.setFeatureState({ source: 'desa', id: hovered }, { hover: false });
        hovered = event.features?.[0]?.id; if (hovered !== undefined) instance.setFeatureState({ source: 'desa', id: hovered }, { hover: true });
      });
      instance.on('mouseleave', 'desa-fill', () => { if (hovered !== undefined) instance.setFeatureState({ source: 'desa', id: hovered }, { hover: false }); hovered = undefined; });
      for (const layer of ['kejadian']) {
        instance.on('mouseenter', layer, () => { instance.getCanvas().style.cursor = 'pointer'; });
        instance.on('mouseleave', layer, () => { instance.getCanvas().style.cursor = ''; });
      }
      ready.current = true;
      sync();
    });
    return () => { ready.current = false; instance.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function sync() {
    const instance = map.current;
    if (!instance || !ready.current) return;
    const { incidents, detections, focus, marker, layers, selectedId } = latest.current;
    (instance.getSource('kejadian') as maplibregl.GeoJSONSource).setData(incidentFeatures(incidents));
    (instance.getSource('deteksi') as maplibregl.GeoJSONSource).setData(detections ?? { type: 'FeatureCollection', features: [] });
    (instance.getSource('fokus') as maplibregl.GeoJSONSource).setData(focus ? { type: 'Feature', geometry: focus, properties: {} } : { type: 'FeatureCollection', features: [] });
    (instance.getSource('penanda') as maplibregl.GeoJSONSource).setData(marker ? { type: 'Feature', geometry: { type: 'Point', coordinates: marker }, properties: {} } : { type: 'FeatureCollection', features: [] });
    instance.setFilter('kejadian-pilih', ['==', ['get', 'id'], selectedId ?? '']);
    for (const key of ['gambut', 'deforestasi', 'citra'] as const) instance.setLayoutProperty(key, 'visibility', layers[key] ? 'visible' : 'none');
    instance.setLayoutProperty('deteksi', 'visibility', layers.deteksi === false ? 'none' : 'visible');
  }
  useEffect(sync, [incidents, detections, focus, marker, layers, selectedId]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !focus) return;
    const coords: number[][] = [];
    const walk = (value: unknown) => { if (Array.isArray(value) && typeof value[0] === 'number') coords.push(value as number[]); else if (Array.isArray(value)) value.forEach(walk); };
    walk((focus as { coordinates?: unknown }).coordinates);
    if (!coords.length) return;
    const lons = coords.map(c => c[0]!), lats = coords.map(c => c[1]!);
    instance.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 36, duration: 0 });
  }, [focus]);

  useEffect(() => { if (center && map.current) map.current.jumpTo({ center, zoom: zoom ?? 13 }); }, [center?.[0], center?.[1]]);

  return <div ref={container} className={`map ${className ?? ''}`} role="region" aria-label="Peta titik panas" />;
}
