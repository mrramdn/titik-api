// An address the app does not know. It is said at that address, never rewritten: when the copy of the app a service
// worker keeps is older than a link (a screen a later version added), the address survives until the update reloads
// the page, and the new version opens it.
import { Link } from 'react-router';
import { House, Map as MapIcon } from 'lucide-react';
import { Shell } from '../components/Shell';
import { dict, useT } from '../i18n';
import { HOME_PATH, MAP_PATH } from '../routes';

export const notFoundText = dict({
  id: { title: 'Halaman tidak ditemukan', lead: 'Alamat ini tidak ada di Titik Api. Periksa alamatnya, atau mulai dari peta atau beranda.', map: 'Buka peta', home: 'Ke beranda' },
  en: { title: 'Page not found', lead: 'This address does not exist in Titik Api. Check the address, or start from the map or the home page.', map: 'Open the map', home: 'Go to the home page' },
});

export function NotFoundPage() {
  const t = useT(notFoundText);
  return (
    <Shell region={false}>
      <main className="page narrow">
        <div className="page-head"><div><h1 className="title-24">{t('title')}</h1><p>{t('lead')}</p></div></div>
        <div className="notfound-actions">
          <Link to={MAP_PATH} className="btn btn-primary"><MapIcon size={18} aria-hidden="true" />{t('map')}</Link>
          <Link to={HOME_PATH} className="btn btn-secondary"><House size={16} aria-hidden="true" />{t('home')}</Link>
        </div>
      </main>
    </Shell>
  );
}
