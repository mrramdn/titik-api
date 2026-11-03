// The fire danger layer's parts around the map: the day switch, the legend section and the card for one grid cell.
import type { CSSProperties, ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import type { FwiClass, Risk, RiskDay } from '../api';
import type { Loaded } from '../components/ui';
import { dict, useLang, useT } from '../i18n';
import { useFormat } from '../format';
import { BMKG_FWI_URL, fwiClasses, fwiColors, fwiLabel, fwiOpacity, fwiRange, riskDetail } from './risk';

const text = dict({
  id: {
    title: 'Bahaya kebakaran', days: 'Hari', today: 'Hari ini', tomorrow: 'Besok', after: 'Lusa',
    loading: 'Memuat bahaya kebakaran…', noWeather: 'Data cuaca belum tersedia.', legend: 'Bahaya kebakaran (FWI)',
    note: 'Dihitung dari data model Open-Meteo dengan sistem FWI dan kelas BMKG. Bukan produk resmi BMKG.', bmkg: 'Peta FWI resmi BMKG',
  },
  en: {
    title: 'Fire danger', days: 'Day', today: 'Today', tomorrow: 'Tomorrow', after: 'In 2 days',
    loading: 'Loading fire danger…', noWeather: 'Weather data is not available yet.', legend: 'Fire danger (FWI)',
    note: 'Computed from Open-Meteo model data with the FWI system and BMKG classes. Not an official BMKG product.', bmkg: 'Official BMKG FWI map',
  },
});
const dayKeys = ['today', 'tomorrow', 'after'] as const;

/** A swatch that looks like a grid cell on the map: the class colour at the layer's opacity, with an outline. */
export const RiskSwatch = ({ fwiClass }: { fwiClass: FwiClass }) => (
  <i className="lg-box" style={{ '--c': fwiColors[fwiClass], '--fill': `${fwiOpacity[fwiClass] * 100}%` } as CSSProperties} />
);

/**
 * Over the top left of the map while the layer is on: today, tomorrow or the day after for live data, the date alone
 * in the archive, or why there is nothing to show.
 */
export function RiskDays({ risk, day, onDay }: { risk: Loaded<Risk>; day: number; onDay(day: number): void }) {
  const t = useT(text), f = useFormat();
  const data = risk.data;
  const count = Math.min(dayKeys.length, data?.cells[0]?.days.length ?? 0);
  let body: ReactNode;
  if (data && !data.fetchedAt) body = <span>{t('noWeather')}</span>;
  else if (data && (data.archive || count < 2)) body = <span>{f.calendar(data.asOf)}</span>;
  else if (data) {
    body = (
      <div className="risk-seg" role="group" aria-label={t('days')}>
        {dayKeys.slice(0, count).map((key, index) => (
          <button key={key} type="button" className={day === index ? 'on' : ''} aria-pressed={day === index} onClick={() => onDay(index)}>{t(key)}</button>
        ))}
      </div>
    );
  } else body = <span>{risk.error ?? t('loading')}</span>;
  return <div className="risk-days"><b>{t('title')}</b>{body}</div>;
}

/** The legend section: BMKG's four classes, what the numbers are, and the official map. */
export function RiskLegend() {
  const t = useT(text);
  const { lang } = useLang();
  return (<>
    <h3 className="lg-title">{t('legend')}</h3>
    {fwiClasses.map(name => <div key={name} className="lg-row"><RiskSwatch fwiClass={name} />{fwiLabel[lang][name]}<small className="lg-range">{fwiRange[name]}</small></div>)}
    <p className="lg-note">{t('note')}</p>
    <a className="lg-link" href={BMKG_FWI_URL} target="_blank" rel="noopener noreferrer">{t('bmkg')}<ExternalLink size={12} aria-hidden="true" /></a>
  </>);
}

/** One grid cell on the chosen day: class and FWI, the drought code, the noon weather and the days without rain. */
export function RiskCell({ day, closeButton }: { day: RiskDay; closeButton: ReactNode }) {
  const t = useT(text);
  const { lang } = useLang();
  const detail = riskDetail(day, lang);
  return (
    <div className="mapcard" role="dialog" aria-label={t('title')}>
      <div className="mapcard-head"><h3>{detail.title}</h3>{closeButton}</div>
      <p className="risk-class"><RiskSwatch fwiClass={day.fwiClass} />{detail.classLine}</p>
      <dl className="risk-facts">{detail.rows.map(row => <div key={row.key}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
      {detail.dcNote && <p className="lg-note">{detail.dcNote}</p>}
      <p className="lg-note">{t('note')}</p>
    </div>
  );
}
