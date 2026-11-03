// The map screen and the map download when they are first needed (pages/LazyMapScreen.tsx, map/LazyMapView.tsx), so
// they can fail to arrive: no signal on a first visit, or a new version has replaced the file. Then the part that is
// missing says so and offers a reload, instead of the whole page going blank.
import { Component, type ReactNode } from 'react';
import { RotateCw } from 'lucide-react';
import { dict, useT } from '../i18n';

const text = dict({
  id: { map: 'Peta tidak bisa dimuat.', screen: 'Halaman ini tidak bisa dimuat.', next: 'Periksa sinyal, lalu muat ulang halaman.', reload: 'Muat ulang' },
  en: { map: 'The map could not load.', screen: 'This page could not load.', next: 'Check the signal, then reload the page.', reload: 'Reload' },
});

export class LoadBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function LoadFailed({ what }: { what: 'map' | 'screen' }) {
  const t = useT(text);
  return (
    <div className="load-failed" role="alert">
      <p>{t(what)} {t('next')}</p>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => window.location.reload()}><RotateCw size={16} aria-hidden="true" />{t('reload')}</button>
    </div>
  );
}
