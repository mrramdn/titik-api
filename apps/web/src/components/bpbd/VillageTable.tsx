// Villages with incidents in the window, under the same filters as the lanes. A row opens the village page.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { dict, useT } from '../../i18n';
import { useFormat } from '../../format';
import type { DashboardVillage } from './data';
import type { Focus } from './Kpis';

const text = dict({
  id: {
    title: 'Desa', count: '{n} desa dengan kejadian', village: 'Desa', regency: 'Kabupaten', incidents: 'Kejadian', checked: 'Dicek',
    openHigh: 'Tinggi belum dicek', response: 'Waktu tanggap', last: 'Terakhir', district: 'Kec. {name}',
    all: 'Tampilkan semua ({n} desa)', fewer: 'Tampilkan {n} desa', loading: 'Memuat…', empty: 'Tidak ada desa yang cocok dengan filter ini.',
  },
  en: {
    title: 'Villages', count: '{n} villages with incidents', village: 'Village', regency: 'Regency', incidents: 'Incidents', checked: 'Checked',
    openHigh: 'High, not checked', response: 'Response time', last: 'Last seen', district: '{name} district',
    all: 'Show all ({n} villages)', fewer: 'Show {n} villages', loading: 'Loading…', empty: 'No village matches these filters.',
  },
});

const FIRST = 15;

/** The same focus as the KPIs: open high priority, checked villages, or slowest response first. */
export function villagesFor(villages: DashboardVillage[], focus: Focus) {
  if (focus === 'action') return villages.filter(v => v.openHigh > 0).sort((a, b) => b.openHigh - a.openHigh);
  if (focus === 'checked') return villages.filter(v => v.verified > 0).sort((a, b) => b.verified - a.verified);
  if (focus === 'response') return villages.filter(v => v.medianMinutesToVerification !== null && v.medianMinutesToVerification !== undefined)
    .sort((a, b) => (b.medianMinutesToVerification ?? 0) - (a.medianMinutesToVerification ?? 0));
  return villages;
}

export function VillageTable({ villages, focus, loading }: { villages: DashboardVillage[] | null; focus: Focus; loading: boolean }) {
  const t = useT(text), f = useFormat();
  const navigate = useNavigate();
  const [all, setAll] = useState(false);
  const rows = villagesFor(villages ?? [], focus);
  return (
    <section className="bd-section" aria-labelledby="bd-villages">
      <div className="bd-section-head">
        <h2 id="bd-villages" className="heading-16">{t('title')}</h2>
        {villages && <span className="caption muted">{t('count', { n: f.num(rows.length) })}</span>}
      </div>
      <div className="bd-table-wrap">
        {!villages && <p className="bd-quiet">{loading ? t('loading') : t('empty')}</p>}
        {villages && !rows.length && <p className="bd-quiet">{t('empty')}</p>}
        {rows.length > 0 && (
          <table className="bd-table">
            <thead>
              <tr>
                <th>{t('village')}</th><th>{t('regency')}</th><th className="num">{t('incidents')}</th><th>{t('checked')}</th>
                <th className="num">{t('openHigh')}</th><th className="num">{t('response')}</th><th className="num">{t('last')}</th>
              </tr>
            </thead>
            <tbody>
              {(all ? rows : rows.slice(0, FIRST)).map(v => (
                <tr key={v.id} className="link" onClick={() => navigate(`/desa/${v.id}`)}>
                  <td className="name"><Link to={`/desa/${v.id}`} onClick={event => event.stopPropagation()}>{v.name}</Link><small>{t('district', { name: v.district })}</small></td>
                  <td>{v.regency}</td>
                  <td className="num">{f.num(v.incidents)}</td>
                  <td><span className="checkbar"><span className="track"><i style={{ width: `${v.incidents ? Math.min(100, (v.verified / v.incidents) * 100) : 0}%` }} /></span>{f.num(v.verified)}/{f.num(v.incidents)}</span></td>
                  <td className={`num ${v.openHigh ? 'hot' : ''}`}>{v.openHigh ? f.num(v.openHigh) : '–'}</td>
                  <td className="num">{f.duration(v.medianMinutesToVerification)}</td>
                  <td className="num">{v.lastDetectedAt ? f.ago(v.lastDetectedAt) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {rows.length > FIRST && (
          <button type="button" className="bd-more" aria-expanded={all} onClick={() => setAll(!all)}>{all ? t('fewer', { n: FIRST }) : t('all', { n: f.num(rows.length) })}</button>
        )}
      </div>
    </section>
  );
}
