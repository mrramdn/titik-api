// One village: its map, hotspots per day over seven days and every incident of the week with where it stands.
import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ChevronLeft, Share2 } from 'lucide-react';
import type { Incident } from '../api';
import { Shell } from '../components/Shell';
import { Banner, PriorityMark, shareText, StatusLine, useApi, useDataVersion } from '../components/ui';
import { Bars7 } from '../components/volunteer/Bars7';
import { incidentLimit, villageSummaryText } from '../components/volunteer/villageSummary';
import { useFormat } from '../format';
import { dict, useLang, useT } from '../i18n';
import { MapView } from '../map/MapView';
import { useSession } from '../session';

const text = dict({
  id: {
    back: 'Peta', loading: 'Memuat desa…', village: 'Desa {name}', where: 'Kec. {district} · {regency} · {province}',
    size: '{area} ha · {peat}% lahan gambut', share: 'Bagikan ringkasan',
    bars: 'Titik panas 7 hari', forest: 'Peringatan gangguan hutan (GLAD-L, GLAD-S2, RADD) tampil di peta. Matikan lewat Lapisan.',
    incidents: 'Kejadian 7 hari', empty: 'Tidak ada titik panas dalam 7 hari terakhir.', watch: 'Pantau desa ini lewat Desa saya.',
    hotspots: '{n} titik panas', hotspot: '1 titik panas', peat: 'lahan gambut', priority: 'Prioritas {level}', more: '{n} kejadian lain tidak ditampilkan.',
  },
  en: {
    back: 'Map', loading: 'Loading the village…', village: '{name}', where: '{district} district · {regency} · {province}',
    size: '{area} ha · {peat}% peatland', share: 'Share summary',
    bars: 'Hotspots, 7 days', forest: 'Forest disturbance alerts (GLAD-L, GLAD-S2, RADD) are shown on the map. Turn them off under Layers.',
    incidents: 'Incidents, 7 days', empty: 'No hotspots in the last 7 days.', watch: 'Watch this village from My villages.',
    hotspots: '{n} hotspots', hotspot: '1 hotspot', peat: 'peatland', priority: '{level} priority', more: '{n} more incidents not shown.',
  },
});

interface VillageDetail { id: string; name: string; district: string; regency: string; province: string; peatShare: number; areaHa: number; center: [number, number]; geometry: GeoJSON.Geometry; incidents: Incident[]; daily: { day: string; detections: number }[] }
const shown = 30;

function IncidentRow({ incident }: { incident: Incident }) {
  const t = useT(text), f = useFormat();
  const level = f.lang === 'id' ? f.level(incident.level).toLowerCase() : f.level(incident.level);
  return (
    <Link to={`/kejadian/${incident.id}`} className="v-row v-row-link">
      <PriorityMark level={incident.level} />
      <span className="v-body">
        <span className="v-place">{incident.detectionCount === 1 ? t('hotspot') : t('hotspots', { n: f.num(incident.detectionCount) })}{incident.onPeat ? ` · ${t('peat')}` : ''}</span>
        <span className="v-facts">{[t('priority', { level }), f.span(incident.firstDetectedAt, incident.lastDetectedAt), incident.nearestPlace ? f.place(incident.nearestPlace) : null].filter(Boolean).join(' · ')}</span>
        <StatusLine incident={incident} />
      </span>
    </Link>
  );
}

export function VillagePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const t = useT(text), f = useFormat();
  const { lang } = useLang();
  const { user } = useSession();
  const { version } = useDataVersion();
  const village = useApi<VillageDetail>(`/villages/${id}`, version);
  const d = village.data;
  // The outline only changes with the village; a data refresh must not zoom the map back while someone reads it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const outline = useMemo(() => d?.geometry ?? null, [d?.id]);
  if (!d) return <Shell><main className="page">{village.error ? <Banner tone="warn">{village.error}</Banner> : <div className="empty">{t('loading')}</div>}</main></Shell>;
  const canWatch = Boolean(user) && user?.role !== 'bpbd';
  return (
    <Shell>
      <main className="page v-page">
        <Link to="/" className="back v-back"><ChevronLeft size={14} aria-hidden="true" />{t('back')}</Link>
        <div className="page-head">
          <div>
            <h1 className="title-24">{t('village', { name: d.name })}</h1>
            <p>{t('where', { district: d.district, regency: d.regency, province: d.province })}</p>
            <p className="v-muted">{t('size', { area: f.num(Math.round(d.areaHa)), peat: f.num(Math.round(d.peatShare * 100)) })}</p>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void shareText(villageSummaryText(d, d.incidents, lang))}><Share2 size={16} aria-hidden="true" />{t('share')}</button>
        </div>
        <div className="dash-grid">
          <div className="dash-map"><MapView hours={168} focus={outline} initialLayers={{ deteksi: true, deforestasi: true }} onSelect={x => navigate(`/kejadian/${x}`)} legend={false} /></div>
          <div className="card v-side">
            <span className="heading-16">{t('bars')}</span>
            <Bars7 daily={d.daily} />
            <p className="note">{t('forest')}</p>
          </div>
        </div>
        <section className="v-section" aria-labelledby="v-village-incidents">
          <div className="v-section-head"><h2 id="v-village-incidents" className="heading-16">{t('incidents')}</h2>{d.incidents.length > 0 && <span className="v-count">{f.num(d.incidents.length)}{d.incidents.length >= incidentLimit ? '+' : ''}</span>}</div>
          {d.incidents.length
            ? <div className="v-list">{d.incidents.slice(0, shown).map(incident => <IncidentRow key={incident.id} incident={incident} />)}</div>
            : <p className="v-empty">{t('empty')} {canWatch && <Link to="/desa-saya" className="link">{t('watch')}</Link>}</p>}
          {d.incidents.length > shown && <p className="note">{t('more', { n: d.incidents.length - shown })}</p>}
        </section>
      </main>
    </Shell>
  );
}
