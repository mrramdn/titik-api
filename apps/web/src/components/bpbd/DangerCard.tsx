// Tomorrow's fire danger on the dashboard: the regencies at tinggi or sangat tinggi (FWI with BMKG's classes), and a
// way to the map with that layer on. Live data only; an older server without GET /risk shows no card.
import { Link } from 'react-router';
import { Gauge } from 'lucide-react';
import type { Risk } from '../../api';
import { dict, useLang, useT } from '../../i18n';
import { useFormat } from '../../format';
import { fwiLabel, highDanger, type RiskLink } from '../../map/risk';
import { useLoad } from './data';

const text = dict({
  id: {
    title: 'Bahaya kebakaran besok', one: '1 kabupaten tinggi atau sangat tinggi: {names}.', many: '{n} kabupaten tinggi atau sangat tinggi: {names}.',
    more: '{names} dan {n} lainnya', none: 'Tidak ada kabupaten dengan bahaya tinggi atau sangat tinggi.', noWeather: 'Data cuaca belum tersedia.',
    note: 'FWI dari data model Open-Meteo dengan kelas BMKG. Bukan produk resmi BMKG.', map: 'Lihat di peta',
  },
  en: {
    title: 'Fire danger tomorrow', one: '1 regency high or very high: {names}.', many: '{n} regencies high or very high: {names}.',
    more: '{names} and {n} more', none: 'No regency at high or very high danger.', noWeather: 'Weather data is not available yet.',
    note: 'FWI from Open-Meteo model data with BMKG classes. Not an official BMKG product.', map: 'View on the map',
  },
});
/** Regencies named in the card; the rest are counted. */
const NAMED = 3;
const toMap: RiskLink = { riskDay: 1 };

export function DangerCard({ province, version }: { province: string; version?: number }) {
  const t = useT(text), f = useFormat();
  const { lang } = useLang();
  const risk = useLoad<Risk>('/risk', version);
  const data = risk.data;
  if (!data || data.archive) return null;
  const computed = Boolean(data.fetchedAt);
  // No forecast day yet: nothing to say about tomorrow.
  if (computed && !data.regencies.some(regency => regency.days[1])) return null;
  const high = computed ? highDanger(data, 1, province) : [];
  const named = high.slice(0, NAMED).map(regency => `${regency.name} (${fwiLabel[lang][regency.fwiClass].toLowerCase()})`).join(', ');
  const names = high.length > NAMED ? t('more', { names: named, n: f.num(high.length - NAMED) }) : named;
  const summary = !computed ? t('noWeather') : !high.length ? t('none') : t(high.length === 1 ? 'one' : 'many', { n: f.num(high.length), names });
  return (
    <section className="bd-danger" aria-labelledby="bd-danger-title">
      <Gauge size={18} className="icon" aria-hidden="true" />
      <div className="bd-danger-text">
        <h2 id="bd-danger-title">{t('title')}</h2>
        <p>{summary}</p>
        {computed && <p className="caption">{t('note')}</p>}
      </div>
      {computed && <Link to="/" state={toMap} className="btn btn-secondary btn-sm">{t('map')}</Link>}
    </section>
  );
}
