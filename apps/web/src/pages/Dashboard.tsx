// Dasbor BPBD/Daops: what needs action now, what is in progress, what is done. Four numbers over one time window filter
// the lanes, the map and the village table; the kabupaten column narrows everything to one regency.
import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { CalendarDays, Download, Info, X } from 'lucide-react';
import { incidentQuery, type RegionSummary } from '../api';
import { Shell } from '../components/Shell';
import { Banner, useDataVersion } from '../components/ui';
import { MapView, type MapFilters } from '../map/MapView';
import { dict, useT } from '../i18n';
import { useFormat } from '../format';
import { useRegion } from '../region';
import { useSession } from '../session';
import { canUseBpbd, RoleGate } from '../components/bpbd/RoleGate';
import { focusKeys, Kpis, type Focus } from '../components/bpbd/Kpis';
import { RegencyList } from '../components/bpbd/RegencyList';
import { Lanes } from '../components/bpbd/Lanes';
import { VillageTable } from '../components/bpbd/VillageTable';
import { LANE_LIMIT, laneCount, splitLanes, useLanes, useLoad, type DashboardData, type LaneKey } from '../components/bpbd/data';

const text = dict({
  id: {
    title: 'Dasbor', both: 'Sumatera Selatan dan Kalimantan Tengah', last24: '24 jam terakhir', last7: '7 hari terakhir',
    window: 'Rentang waktu', h24: '24 jam', d7: '7 hari', recap: 'Rekap harian', csv: 'Ekspor CSV',
    demo: '{demo} dari {total} cek lapangan dalam rentang ini berasal dari akun demo.',
    filters: 'Filter aktif', remove: 'Hapus filter {name}', clear: 'Hapus semua filter',
    checked: 'Sudah dicek', response: 'Waktu tanggap', action: 'Tinggi belum ditangani',
  },
  en: {
    title: 'Dashboard', both: 'Sumatera Selatan and Kalimantan Tengah', last24: 'last 24 hours', last7: 'last 7 days',
    window: 'Time window', h24: '24 h', d7: '7 days', recap: 'Daily recap', csv: 'Export CSV',
    demo: '{demo} of {total} field checks in this window come from demo accounts.',
    filters: 'Active filters', remove: 'Remove filter {name}', clear: 'Clear all filters',
    checked: 'Checked', response: 'Response time', action: 'High priority, not handled',
  },
});

const lanesFor: Record<Focus, LaneKey[]> = { all: ['action', 'active', 'done'], action: ['action'], checked: ['done'], response: ['active', 'done'] };
// Module constants, so the map sees the same object until the focus changes.
const mapFiltersFor: Record<Focus, MapFilters | undefined> = {
  all: undefined, action: { levels: ['tinggi'], status: 'open' }, checked: { status: 'checked' }, response: { status: 'checked' },
};

export function DashboardPage() {
  const { user } = useSession();
  if (!canUseBpbd(user?.role)) return <RoleGate page="dashboard" />;
  return <Dashboard />;
}

function Dashboard() {
  const t = useT(text), f = useFormat();
  const navigate = useNavigate();
  const { province, provinces, bbox, query } = useRegion();
  const { version } = useDataVersion();
  const [params, setParams] = useSearchParams();

  // Window, focus and regency live in the address, so going back from an incident restores the same view.
  const range = params.get('range') === '7d' ? '7d' : '24h';
  const hours = range === '7d' ? 168 : 24;
  const askedFocus = params.get('focus') as Focus | null;
  const focus: Focus = askedFocus && focusKeys.includes(askedFocus) ? askedFocus : 'all';
  const regencies = province ? provinces.find(p => p.name === province)?.regencies ?? [] : provinces.flatMap(p => p.regencies);
  const askedRegency = params.get('regency') ?? '';
  // After a province switch in the top bar, a regency from the other province no longer applies.
  const regency = askedRegency && (!provinces.length || regencies.some(r => r.name === askedRegency)) ? askedRegency : '';
  const update = (changes: { range?: string; focus?: Focus; regency?: string }) => setParams(previous => {
    const next = new URLSearchParams(previous);
    for (const [key, value] of Object.entries(changes)) {
      if (value && value !== 'all' && value !== '24h') next.set(key, value); else next.delete(key);
    }
    return next;
  }, { replace: true });

  const regencyParam = regency ? `&regency=${encodeURIComponent(regency)}` : '';
  const dash = useLoad<DashboardData>(`/dashboard?range=${range}&hours=${hours}${query}${regencyParam}`, version);
  const regions = useLoad<RegionSummary[]>(`/regions/summary?hours=${hours}${query}`, version);
  const lanePaths = useMemo(() => {
    const extra = `&limit=${LANE_LIMIT}${query}`;
    return {
      action: `/incidents${incidentQuery({ hours, levels: ['tinggi'], status: 'open', sort: 'priority', regency }, extra)}`,
      active: `/incidents${incidentQuery({ hours, status: 'assigned', sort: 'priority', regency }, extra)}`,
      done: `/incidents${incidentQuery({ hours, status: 'checked', sort: 'recent', regency }, extra)}`,
    };
  }, [hours, regency, query]);
  const lanes = useLanes(lanePaths, version);
  const split = useMemo(() => splitLanes(lanes.lists), [lanes.lists]);

  const summary = dash.data?.summary;
  // The KPIs show the lane counts themselves, so a number on top never contradicts the lane below it.
  const counts = {
    action: laneCount(split.action.length, lanes.lists.action?.length ?? null, summary?.openHigh),
    active: laneCount(split.active.length, lanes.lists.active?.length ?? null),
    done: laneCount(split.done.length, lanes.lists.done?.length ?? null, summary?.verified),
  };
  const photos = useMemo(() => {
    const byIncident = new Map<string, string>();
    for (const check of dash.data?.recentVerifications ?? []) {
      if (check.photoThumbUrl && !byIncident.has(check.incidentId)) byIncident.set(check.incidentId, check.photoThumbUrl);
    }
    return byIncident;
  }, [dash.data]);
  const regionRows = Array.isArray(regions.data) && regions.data.length ? regions.data : null;
  const regencyBox = regency ? regencies.find(r => r.name === regency)?.bbox : undefined;
  const bounds = (regencyBox?.length === 4 ? regencyBox : bbox) as [number, number, number, number];
  const demo = dash.data?.verificationsFromDemoAccounts;
  const reloadAll = () => { lanes.reload(); dash.reload(); regions.reload(); };

  return (
    <Shell>
      <main className="page wide bd-page">
        <div className="bd-head">
          <div>
            <h1 className="title-24">{t('title')}</h1>
            <p>{province || t('both')}{regency ? ` › ${regency}` : ''} · {t(range === '7d' ? 'last7' : 'last24')}</p>
          </div>
          <div className="bd-actions">
            <div className="bd-window" role="group" aria-label={t('window')}>
              {(['24h', '7d'] as const).map(value => (
                <button key={value} type="button" className={range === value ? 'on' : ''} aria-pressed={range === value} onClick={() => update({ range: value })}>
                  {t(value === '7d' ? 'd7' : 'h24')}
                </button>
              ))}
            </div>
            <Link to="/rekap" className="btn btn-secondary btn-sm"><CalendarDays size={16} />{t('recap')}</Link>
            <a className="btn btn-secondary btn-sm" href={`/api/v1/export/groundcheck.csv?range=${range}${query}${regencyParam}`}><Download size={16} />{t('csv')}</a>
          </div>
        </div>
        {demo && demo.demo > 0 && <p className="note bd-demo"><Info size={14} className="icon" />{t('demo', { demo: f.num(demo.demo), total: f.num(demo.total) })}</p>}
        {dash.error && <Banner tone="warn">{dash.error}</Banner>}
        <Kpis focus={focus} onFocus={value => update({ focus: value })} incidents={summary?.incidents ?? null} detections={summary?.detections ?? null}
          high={summary?.high ?? null} medianMinutes={summary?.medianMinutesToVerification ?? summary?.medianMinutes ?? null}
          checked={counts.done} action={counts.action} />
        {(regency || focus !== 'all') && (
          <div className="bd-filters" role="group" aria-label={t('filters')}>
            {regency && <button type="button" className="bd-filter" aria-label={t('remove', { name: regency })} onClick={() => update({ regency: '' })}>{regency}<X size={14} /></button>}
            {focus !== 'all' && <button type="button" className="bd-filter" aria-label={t('remove', { name: t(focus) })} onClick={() => update({ focus: 'all' })}>{t(focus)}<X size={14} /></button>}
            {regency && focus !== 'all' && <button type="button" className="bd-clear" onClick={() => update({ regency: '', focus: 'all' })}>{t('clear')}</button>}
          </div>
        )}
        <div className={`bd-body ${regionRows ? '' : 'no-side'}`}>
          {regionRows && <RegencyList rows={regionRows} selected={regency} onSelect={name => update({ regency: name })}
            selectedCount={regency && counts.action && !counts.action.more && !lanes.loading ? counts.action.value : undefined} />}
          <div className="bd-centre">
            <div className="bd-map">
              <MapView hours={hours} bounds={bounds} filters={mapFiltersFor[focus]} version={version} initialLayers={{ deteksi: false }} legend={false}
                onSelect={id => navigate(`/kejadian/${id}`)} onVillage={id => navigate(`/desa/${id}`)} />
            </div>
            <Lanes lanes={split} counts={counts} errors={lanes.errors} visible={lanesFor[focus]} loading={lanes.loading} photos={photos} onChanged={reloadAll}
              loaded={{ action: lanes.lists.action !== null, active: lanes.lists.active !== null, done: lanes.lists.done !== null }} />
          </div>
        </div>
        <VillageTable villages={dash.data?.villages ?? null} focus={focus} loading={dash.loading} />
      </main>
    </Shell>
  );
}
