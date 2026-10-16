import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Droplets, Image, Layers, List, Satellite, Trees } from 'lucide-react';
import type { Level, StatusFilter } from '../api';

maplibregl.setWorkerUrl(workerUrl);

export type LayerKey = 'deteksi' | 'gambut' | 'deforestasi' | 'citra';
export interface Selected { id: string; centroid: [number, number]; detections?: [number, number][] }
/** Filters applied to the incident layer on the map (same meaning as the list filters). */
export interface MapFilters { levels?: Level[]; status?: StatusFilter; peat?: boolean }
interface Props {
  /** Map filters; optional so existing callers keep working. */
  filters?: MapFilters;
  /** Changes when a new ingest run lands; tile URLs carry it so the map refreshes. */
  version?: number;
  hours?: number;
  bounds?: [number, number, number, number];
  selected?: Selected | null;
  focus?: GeoJSON.Geometry | null;
  initialLayers?: Partial<Record<LayerKey, boolean>>;
  onSelect?: (id: string) => void;
  onVillage?: (id: string) => void;
  controls?: boolean;
  legend?: boolean;
  className?: string;
}

const origin = () => location.origin;
const level = ['match', ['get', 'level'], 'tinggi', '#E5381C', 'sedang', '#F08C00', '#8E8A85'] as unknown as maplibregl.ExpressionSpecification;
const layerInfo: { key: LayerKey; label: string; source: string; icon: typeof Satellite }[] = [
  { key: 'deteksi', label: 'Deteksi satelit', source: 'NASA FIRMS · VIIRS 375 m', icon: Satellite },
  { key: 'gambut', label: 'Lahan gambut', source: 'Global peatland extent', icon: Droplets },
  { key: 'deforestasi', label: 'Alert gangguan hutan', source: 'GLAD-L, GLAD-S2, RADD', icon: Trees },
  { key: 'citra', label: 'Citra satelit', source: 'Sentinel-2 cloudless 2023', icon: Image },
];

export function MapView({ hours = 24, bounds, selected, focus, initialLayers, onSelect, onVillage, controls = true, legend = true, className }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const ready = useRef(false);
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({ deteksi: true, gambut: false, deforestasi: false, citra: false, ...initialLayers });
  const [panel, setPanel] = useState<'layers' | 'legend' | null>(null);
  const handlers = useRef({ onSelect, onVillage });
  handlers.current = { onSelect, onVillage };
  const state = useRef({ hours, layers, selected, focus });
  state.current = { hours, layers, selected, focus };

  useEffect(() => {
    const b = bounds ?? [102.0, -5.0, 115.9, 0.85];
    const instance = new maplibregl.Map({
      container: container.current!, style: 'https://tiles.openfreemap.org/styles/positron', bounds: [[b[0], b[1]], [b[2], b[3]]], fitBoundsOptions: { padding: 24 },
      maxZoom: 16, attributionControl: { compact: true, customAttribution: 'NASA FIRMS · BPS/HDX · Global Nature Watch · EOX' },
    });
    map.current = instance;
    // The compact attribution opens as soon as it is added and would cover a phone-sized map; it stays one tap away.
    const collapseAttribution = () => container.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
    collapseAttribution();
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    instance.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    instance.on('load', () => {
      collapseAttribution();
      const firstSymbol = instance.getStyle().layers?.find(layer => layer.type === 'symbol')?.id;
      instance.addSource('citra', { type: 'raster', tileSize: 256, maxzoom: 15, tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/g/{z}/{y}/{x}.jpg'], attribution: 'Sentinel-2 cloudless 2023 by EOX (CC BY-NC-SA 4.0)' });
      instance.addLayer({ id: 'citra', type: 'raster', source: 'citra', layout: { visibility: 'none' } }, firstSymbol);
      instance.addSource('gambut', { type: 'raster', tileSize: 256, maxzoom: 12, tiles: ['https://tiles.globalforestwatch.org/gfw_peatlands/v20230315/is/{z}/{x}/{y}.png'], attribution: 'Global peatland extent · Global Nature Watch (CC BY 4.0)' });
      instance.addLayer({ id: 'gambut', type: 'raster', source: 'gambut', paint: { 'raster-opacity': 0.3 }, layout: { visibility: 'none' } }, firstSymbol);
      instance.addSource('deforestasi', { type: 'raster', tileSize: 256, maxzoom: 14, tiles: ['https://tiles.globalforestwatch.org/gfw_integrated_alerts/latest/dynamic/{z}/{x}/{y}.png'], attribution: 'Integrated deforestation alerts (UMD/GLAD, WUR) · Global Nature Watch' });
      instance.addLayer({ id: 'deforestasi', type: 'raster', source: 'deforestasi', paint: { 'raster-opacity': 0.85 }, layout: { visibility: 'none' } }, firstSymbol);
      instance.addSource('kabupaten', { type: 'vector', tiles: [`${origin()}/api/v1/tiles/kabupaten/{z}/{x}/{y}.mvt`], maxzoom: 12 });
      instance.addLayer({ id: 'kabupaten-line', type: 'line', source: 'kabupaten', 'source-layer': 'kabupaten', paint: { 'line-color': '#57514B', 'line-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 10, 0.35], 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.6, 10, 1.6] } });
      instance.addLayer({ id: 'kabupaten-label', type: 'symbol', source: 'kabupaten', 'source-layer': 'kabupaten', maxzoom: 9, layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': '#57514B', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 } });
      instance.addSource('desa', { type: 'vector', tiles: [`${origin()}/api/v1/tiles/desa/{z}/{x}/{y}.mvt`], minzoom: 8, maxzoom: 14, promoteId: { desa: 'id' } });
      instance.addLayer({ id: 'desa-fill', type: 'fill', source: 'desa', 'source-layer': 'desa', paint: { 'fill-color': '#6B4E37', 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.1, 0.01] } });
      instance.addLayer({ id: 'desa-line', type: 'line', source: 'desa', 'source-layer': 'desa', paint: { 'line-color': '#8A837C', 'line-opacity': 0.55, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.3, 13, 1.2] } });
      instance.addLayer({ id: 'desa-label', type: 'symbol', source: 'desa', 'source-layer': 'desa', minzoom: 11, layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': '#57514B', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 } });
      instance.addSource('fokus', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      instance.addLayer({ id: 'fokus-line', type: 'line', source: 'fokus', paint: { 'line-color': '#161312', 'line-width': 2, 'line-dasharray': [2, 1.2] } });
      instance.addSource('deteksi', { type: 'vector', tiles: [`${origin()}/api/v1/tiles/deteksi/{z}/{x}/{y}.mvt?hours=${state.current.hours}`], minzoom: 7, maxzoom: 14 });
      instance.addLayer({ id: 'deteksi', type: 'circle', source: 'deteksi', 'source-layer': 'deteksi', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 1.4, 12, 3, 15, 6], 'circle-color': ['match', ['get', 'confidence'], 'high', '#C2410C', 'nominal', '#EA7A3B', '#B8A99A'], 'circle-opacity': ['case', ['get', 'inside'], 0.8, 0.3] } });
      instance.addSource('kejadian', { type: 'vector', tiles: [`${origin()}/api/v1/tiles/kejadian/{z}/{x}/{y}.mvt?hours=${state.current.hours}`], maxzoom: 14 });
      instance.addLayer({ id: 'kejadian-halo', type: 'circle', source: 'kejadian', 'source-layer': 'kejadian', filter: ['==', ['get', 'level'], 'tinggi'], paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 4, 10, ['interpolate', ['linear'], ['get', 'count'], 1, 10, 50, 20, 400, 30]], 'circle-color': '#E5381C', 'circle-opacity': 0.13 } });
      instance.addLayer({ id: 'kejadian', type: 'circle', source: 'kejadian', 'source-layer': 'kejadian', paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, ['interpolate', ['linear'], ['get', 'count'], 1, 1.8, 50, 3, 400, 4.5], 10, ['interpolate', ['linear'], ['get', 'count'], 1, 5, 50, 9, 400, 14]],
        'circle-color': level, 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 5, ['case', ['get', 'verified'], 2, 0.4], 9, ['case', ['get', 'verified'], 2.5, 1.2]], 'circle-stroke-color': ['case', ['get', 'verified'], '#2F9E44', '#ffffff'] } });
      instance.addSource('pilih-deteksi', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      instance.addLayer({ id: 'pilih-deteksi', type: 'circle', source: 'pilih-deteksi', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 2, 14, 5], 'circle-color': '#C2410C', 'circle-stroke-width': 1, 'circle-stroke-color': '#fff' } });
      instance.addSource('pilih', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      instance.addLayer({ id: 'pilih', type: 'circle', source: 'pilih', paint: { 'circle-radius': 14, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-width': 2.5, 'circle-stroke-color': '#161312' } });
      instance.on('click', 'kejadian', event => { const id = event.features?.[0]?.properties?.id; if (id) handlers.current.onSelect?.(String(id)); });
      instance.on('click', 'desa-fill', event => {
        if (instance.queryRenderedFeatures(event.point, { layers: ['kejadian'] }).length) return;
        const id = event.features?.[0]?.properties?.id; if (id) handlers.current.onVillage?.(String(id));
      });
      let hovered: string | number | undefined;
      instance.on('mousemove', 'desa-fill', event => {
        if (hovered !== undefined) instance.setFeatureState({ source: 'desa', sourceLayer: 'desa', id: hovered }, { hover: false });
        hovered = event.features?.[0]?.id; if (hovered !== undefined) instance.setFeatureState({ source: 'desa', sourceLayer: 'desa', id: hovered }, { hover: true });
      });
      instance.on('mouseleave', 'desa-fill', () => { if (hovered !== undefined) instance.setFeatureState({ source: 'desa', sourceLayer: 'desa', id: hovered }, { hover: false }); hovered = undefined; });
      instance.on('mouseenter', 'kejadian', () => { instance.getCanvas().style.cursor = 'pointer'; });
      instance.on('mouseleave', 'kejadian', () => { instance.getCanvas().style.cursor = ''; });
      ready.current = true;
      syncLayers(); syncSelected(true); syncFocus();
    });
    return () => { ready.current = false; instance.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function syncLayers() {
    const m = map.current; if (!m || !ready.current) return;
    for (const key of ['gambut', 'deforestasi', 'citra'] as const) m.setLayoutProperty(key, 'visibility', state.current.layers[key] ? 'visible' : 'none');
    m.setLayoutProperty('deteksi', 'visibility', state.current.layers.deteksi ? 'visible' : 'none');
  }
  function syncSelected(initial = false) {
    const m = map.current; if (!m || !ready.current) return;
    const sel = state.current.selected;
    (m.getSource('pilih') as maplibregl.GeoJSONSource).setData(sel ? { type: 'Feature', geometry: { type: 'Point', coordinates: sel.centroid }, properties: {} } : { type: 'FeatureCollection', features: [] });
    (m.getSource('pilih-deteksi') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: (sel?.detections ?? []).map(c => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: {} })) });
    if (sel) m.flyTo({ center: sel.centroid, zoom: Math.max(m.getZoom(), 12), duration: initial ? 0 : 900 });
  }
  function syncFocus() {
    const m = map.current; if (!m || !ready.current) return;
    const f = state.current.focus;
    (m.getSource('fokus') as maplibregl.GeoJSONSource).setData(f ? { type: 'Feature', geometry: f, properties: {} } : { type: 'FeatureCollection', features: [] });
    if (!f) return;
    const coords: number[][] = [];
    const walk = (v: unknown) => { if (Array.isArray(v) && typeof v[0] === 'number') coords.push(v as number[]); else if (Array.isArray(v)) v.forEach(walk); };
    walk((f as { coordinates?: unknown }).coordinates);
    if (coords.length) m.fitBounds([[Math.min(...coords.map(c => c[0]!)), Math.min(...coords.map(c => c[1]!))], [Math.max(...coords.map(c => c[0]!)), Math.max(...coords.map(c => c[1]!))]], { padding: 40, duration: 0 });
  }
  useEffect(syncLayers, [layers]);
  useEffect(() => syncSelected(), [selected?.id, selected?.detections?.length]);
  useEffect(syncFocus, [focus]);
  useEffect(() => {
    const m = map.current; if (!m || !ready.current) return;
    (m.getSource('kejadian') as maplibregl.VectorTileSource).setTiles([`${origin()}/api/v1/tiles/kejadian/{z}/{x}/{y}.mvt?hours=${hours}`]);
    (m.getSource('deteksi') as maplibregl.VectorTileSource).setTiles([`${origin()}/api/v1/tiles/deteksi/{z}/{x}/{y}.mvt?hours=${hours}`]);
  }, [hours]);
  useEffect(() => {
    const m = map.current; if (!m || !bounds) return;
    m.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 24, duration: ready.current ? 700 : 0 });
  }, [bounds?.join(',')]);

  return (
    <div className={`map-pane ${className ?? ''}`}>
      <div ref={container} className="map" role="region" aria-label="Peta titik panas" />
      {controls && (
        <div className="map-controls">
          <button type="button" className={`map-control ${panel === 'layers' ? 'on' : ''}`} onClick={() => setPanel(panel === 'layers' ? null : 'layers')}><Layers size={18} /><span>Lapisan</span></button>
          <button type="button" className={`map-control ${panel === 'legend' ? 'on' : ''}`} onClick={() => setPanel(panel === 'legend' ? null : 'legend')}><List size={18} /><span>Legenda</span></button>
        </div>
      )}
      {panel === 'layers' && (
        <div className="map-panel">
          <h3>Lapisan peta</h3>
          {layerInfo.map(({ key, label, source, icon: Icon }) => (
            <label key={key} className="layer"><Icon size={18} color="rgb(243 239 234 / 0.68)" /><span>{label}<small>{source}</small></span>
              <input type="checkbox" checked={layers[key]} onChange={event => setLayers(prev => ({ ...prev, [key]: event.target.checked }))} /><i className="switch" /></label>
          ))}
        </div>
      )}
      {panel === 'legend' && (
        <div className="map-panel">
          <h3>Kejadian titik panas</h3>
          <div className="legend-row"><i className="legend-dot" style={{ background: '#E5381C' }} />Prioritas tinggi</div>
          <div className="legend-row"><i className="legend-dot" style={{ background: '#F08C00' }} />Prioritas sedang</div>
          <div className="legend-row"><i className="legend-dot" style={{ background: '#8E8A85' }} />Prioritas rendah</div>
          <div className="legend-row"><i className="legend-dot" style={{ background: '#fff', border: '3px solid #2F9E44' }} />Sudah dicek warga</div>
          <div className="legend-row"><i className="legend-dot" style={{ background: '#EA7A3B', width: 8, height: 8, border: 0 }} />Deteksi satelit (piksel 375 m)</div>
          <p className="note" style={{ marginTop: 6 }}>Ukuran lingkaran mengikuti jumlah deteksi. Kejadian = titik panas berjarak ≤ 750 m pada hari yang sama.</p>
        </div>
      )}
      {legend && !panel && (
        <div className="map-legend">
          <span className="label">Prioritas</span>
          <span className="badge badge-tinggi">Tinggi</span><span className="badge badge-sedang">Sedang</span><span className="badge badge-rendah">Rendah</span>
          <span className="status status-checked">Sudah dicek</span>
        </div>
      )}
    </div>
  );
}
