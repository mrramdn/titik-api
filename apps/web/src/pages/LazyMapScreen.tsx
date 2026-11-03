// The map screen (the incident list, or an incident's panel, beside the map) as a chunk of its own with React.lazy: the
// landing page and the pages without it never download it. MapLibre, a further chunk (map/LazyMapView.tsx), starts
// downloading at the same moment, so the map does not wait for the list's code. Meanwhile a light placeholder with the
// screen's layout holds the place.
import { lazy, Suspense, use } from 'react';
import { useLocation } from 'react-router';
import { Shell } from '../components/Shell';
import { LoadBoundary, LoadFailed } from '../components/LoadBoundary';
import { MapPlaceholder, preloadMap } from '../map/LazyMapView';
import { tanggalFromSearch } from '../map/archive';
import { dict, useT } from '../i18n';

const text = dict({ id: { loading: 'Memuat kejadian…' }, en: { loading: 'Loading incidents…' } });

type Modules = readonly [typeof import('./MapScreen'), typeof import('./IncidentPanel')];
let loaded: Modules | null = null;
let loading: Promise<Modules> | null = null;
/** The screen's code, downloaded once; a failed download is tried again the next time. */
function loadScreen(): Promise<Modules> {
  loading ??= Promise.all([import('./MapScreen'), import('./IncidentPanel')]).then(
    modules => (loaded = modules),
    error => { loading = null; throw error; },
  );
  return loading;
}

const Screen = lazy(() => {
  // The map's own boundary reports a failed download.
  preloadMap().catch(() => {});
  return loadScreen().then(([screen]) => ({ default: screen.MapScreen }));
});

/** The layout route of the map screen: the screen once its code is there, the placeholder until then. */
export function MapScreen() {
  return (
    <LoadBoundary fallback={<Shell><main className="page narrow"><LoadFailed what="screen" /></main></Shell>}>
      <Suspense fallback={<Placeholder />}><Screen /></Suspense>
    </LoadBoundary>
  );
}

// The list and the panel render in the screen's outlet, so their code has arrived with the screen's (`use` covers the
// case where it has not). Rendered straight away, they do not show a second placeholder.
export function IncidentList() {
  const List = (loaded ?? use(loadScreen()))[0].IncidentList;
  return <List />;
}

export function IncidentPanel() {
  const Panel = (loaded ?? use(loadScreen()))[1].IncidentPanel;
  return <Panel />;
}

function Placeholder() {
  const t = useT(text);
  const { search } = useLocation();
  return (
    <Shell freshness={!tanggalFromSearch(search)}>
      <main className="mapscreen" aria-busy="true">
        <aside className="sidebar dark"><div className="empty" role="status">{t('loading')}</div></aside>
        <MapPlaceholder />
      </main>
    </Shell>
  );
}
