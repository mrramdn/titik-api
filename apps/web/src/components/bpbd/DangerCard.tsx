// Tomorrow's fire danger on the dashboard: the regencies where tinggi or sangat tinggi (FWI with BMKG's classes) covers
// at least 10% of the area, and a way to the map with that layer on. Live data only; an older server without GET /risk
// shows no card.
import { Link } from 'react-router';
import { Gauge } from 'lucide-react';
import type { Risk } from '../../api';
import { dict, fill, useLang, useT, type Lang } from '../../i18n';
import { formatter } from '../../format';
import { highDanger, highDangerName, type HighDanger, type RiskLink } from '../../map/risk';
import { MAP_PATH } from '../../routes';
import { useLoad } from './data';
import { OpenMeteoCredit } from '../OpenMeteo';

const text = dict({
  id: {
    title: 'Bahaya kebakaran besok',
    one: 'Tinggi atau lebih di 1 kabupaten, menurut bagian wilayahnya: {names}.', many: 'Tinggi atau lebih di {n} kabupaten, menurut bagian wilayahnya: {names}.',
    more: '{names} dan {n} lainnya', none: 'Tidak ada kabupaten dengan bahaya tinggi atau lebih di sedikitnya 10% wilayahnya.',
    noWeather: 'Data cuaca belum tersedia.', note: 'FWI dari data model Open-Meteo dengan kelas BMKG. Bukan produk resmi BMKG.', map: 'Lihat di peta',
  },
  en: {
    title: 'Fire danger tomorrow',
    one: 'High or above in 1 regency, by share of its area: {names}.', many: 'High or above in {n} regencies, by share of their area: {names}.',
    more: '{names} and {n} more', none: 'No regency has high or above danger in at least 10% of its area.',
    noWeather: 'Weather data is not available yet.', note: 'FWI from Open-Meteo model data with BMKG classes. Not an official BMKG product.', map: 'View on the map',
  },
});
/** Regencies named in the card; the rest are counted. */
const NAMED = 3;
const toMap: RiskLink = { riskDay: 1 };

/** The card's sentence for the regencies from highDanger, in their order. */
export function dangerSummary(high: HighDanger[], lang: Lang) {
  const w = text[lang], f = formatter(lang);
  if (!high.length) return w.none;
  const named = high.slice(0, NAMED).map(regency => highDangerName(regency, lang)).join(', ');
  const names = high.length > NAMED ? fill(w.more, { names: named, n: f.num(high.length - NAMED) }) : named;
  return fill(high.length === 1 ? w.one : w.many, { n: f.num(high.length), names });
}

export function DangerCard({ province, version }: { province: string; version?: number }) {
  const t = useT(text);
  const { lang } = useLang();
  const risk = useLoad<Risk>('/risk', version);
  const data = risk.data;
  if (!data || data.archive) return null;
  const computed = Boolean(data.fetchedAt);
  // No forecast day yet: nothing to say about tomorrow.
  if (computed && !data.regencies.some(regency => regency.days[1])) return null;
  const summary = computed ? dangerSummary(highDanger(data, 1, province), lang) : t('noWeather');
  return (
    <section className="bd-danger" aria-labelledby="bd-danger-title">
      <Gauge size={18} className="icon" aria-hidden="true" />
      <div className="bd-danger-text">
        <h2 id="bd-danger-title">{t('title')}</h2>
        <p>{summary}</p>
        {computed && <p className="caption">{t('note')} <OpenMeteoCredit /></p>}
      </div>
      {computed && <Link to={MAP_PATH} state={toMap} className="btn btn-secondary btn-sm">{t('map')}</Link>}
    </section>
  );
}
