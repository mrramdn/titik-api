// The map as its own chunk (React.lazy): MapLibre, about 1 MB, downloads only when a screen shows a map, never with the
// landing page or the pages without one. Until it arrives, a light box of the map's size holds the place; the rest of
// the screen (the incident list, the dashboard lanes) works meanwhile.
import { lazy, Suspense, type ComponentProps } from 'react';
import type { MapView as MapViewComponent } from './MapView';
import { LoadBoundary, LoadFailed } from '../components/LoadBoundary';
import { dict, useT } from '../i18n';

const text = dict({ id: { loading: 'Memuat peta…' }, en: { loading: 'Loading the map…' } });

/** Starts MapLibre's download early, for a screen that is about to show the map (pages/LazyMapScreen.tsx). */
export const preloadMap = () => import('./MapView');
const LoadedMap = lazy(() => preloadMap().then(module => ({ default: module.MapView })));

/** The box MapView renders, holding the place until the map is there, or saying that it could not load. */
export function MapPlaceholder({ className, failed = false }: { className?: string; failed?: boolean }) {
  const t = useT(text);
  return (
    <div className={`map-pane ${className ?? ''}`}>
      {failed ? <div className="map map-loading"><LoadFailed what="map" /></div>
        : <div className="map map-loading" role="status" aria-busy="true"><span>{t('loading')}</span></div>}
    </div>
  );
}

export function MapView(props: ComponentProps<typeof MapViewComponent>) {
  return (
    <LoadBoundary fallback={<MapPlaceholder className={props.className} failed />}>
      <Suspense fallback={<MapPlaceholder className={props.className} />}>
        <LoadedMap {...props} />
      </Suspense>
    </LoadBoundary>
  );
}
