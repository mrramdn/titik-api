import { Shell } from '../components/Shell';
import { dict, useT } from '../i18n';

const text = dict({ id: { title: 'Rekap harian' }, en: { title: 'Daily recap' } });

/** Daily recap for BPBD/Daops; filled in by the BPBD slice. */
export function RecapPage() {
  const t = useT(text);
  return <Shell><main className="page"><div className="page-head"><h1 className="title-24">{t('title')}</h1></div></main></Shell>;
}
