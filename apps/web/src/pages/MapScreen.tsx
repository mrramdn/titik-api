import { useEffect, useMemo, useState } from 'react';
import { Outlet, useNavigate, useOutletContext } from 'react-router';
import { Info, Search, X } from 'lucide-react';
import { defaultFilters, incidentQuery, type Incident, type IncidentFilters, type IncidentSort, type Level, type StatusFilter } from '../api';
import { Shell } from '../components/Shell';
import { PriorityMark, StatusLine, useApi, useDataVersion } from '../components/ui';
import { useRoleSwitch } from '../components/shell/roles';
import { MapView, type Selected } from '../map/MapView';
import { narrowed, prepareRows, summarize } from '../map/list';
import { dict, useT } from '../i18n';
import { useFormat } from '../format';
import { shortProvince, useRegion, type RegencyRef } from '../region';
import { useSession } from '../session';

const text = dict({
  id: {
    intro: 'Peta ini menunjukkan titik panas dari satelit, dikelompokkan menjadi kejadian per desa dan diurutkan menurut prioritas.',
    introRoles: 'Lihat sebagai', introClose: 'Tutup pengantar',
    search: 'Cari desa, kecamatan, atau kabupaten', village: 'Desa {name}', noVillage: 'Desa tidak ditemukan. Periksa ejaan atau cari nama kecamatan.',
    filters: 'Filter kejadian', peatOnly: 'Hanya lahan gambut', status: 'Status', statusAll: 'Semua status', statusOpen: 'Belum dicek',
    statusAssigned: 'Ditugaskan', statusChecked: 'Sudah dicek', time: 'Rentang waktu', h24: '24 jam', d3: '3 hari', d7: '7 hari',
    regency: 'Kabupaten', allRegencies: 'Semua kabupaten', clear: 'Hapus filter',
    incidents: 'Kejadian', highOpen: 'Tinggi, belum dicek', hotspots: 'Titik panas', sort: 'Urutkan', byPriority: 'Prioritas', byRecent: 'Terbaru', bySize: 'Terbesar',
    title: 'Desa {village} · Kec. {district}', outside: 'Di luar batas desa', fromSettlement: '{km} dari permukiman', peat: 'lahan gambut',
    hotspotOne: '{n} titik panas', hotspotMany: '{n} titik panas', uncertain: 'lokasi ±{km}', score: 'Skor prioritas {score} dari 100',
    loading: 'Memuat kejadian…', noMatch: 'Tidak ada kejadian yang cocok dengan filter ini.', noneIn: 'Tidak ada titik panas di desa dalam {window} terakhir.',
    widen: 'Lihat 7 hari terakhir', checkedEvery: 'Data satelit diperiksa tiap 30 menit.', retry: 'Muat ulang', more: 'Tampilkan {n} kejadian lagi',
    caveat: 'Titik panas perlu dicek di lapangan.',
  },
  en: {
    intro: 'This map shows satellite hotspots, grouped into incidents per village and ranked by priority.',
    introRoles: 'View as', introClose: 'Close the introduction',
    search: 'Search a village, district or regency', village: '{name}', noVillage: 'No village found. Check the spelling or search the district name.',
    filters: 'Incident filters', peatOnly: 'Peatland only', status: 'Status', statusAll: 'All statuses', statusOpen: 'Not checked',
    statusAssigned: 'Assigned', statusChecked: 'Checked', time: 'Time range', h24: '24 hours', d3: '3 days', d7: '7 days',
    regency: 'Regency', allRegencies: 'All regencies', clear: 'Clear filters',
    incidents: 'Incidents', highOpen: 'High, not checked', hotspots: 'Hotspots', sort: 'Sort', byPriority: 'Priority', byRecent: 'Newest', bySize: 'Largest',
    title: '{village} · {district} district', outside: 'Outside village boundaries', fromSettlement: '{km} from a settlement', peat: 'peatland',
    hotspotOne: '{n} hotspot', hotspotMany: '{n} hotspots', uncertain: 'location ±{km}', score: 'Priority score {score} of 100',
    loading: 'Loading incidents…', noMatch: 'No incidents match these filters.', noneIn: 'No hotspots in villages in the last {window}.',
    widen: 'Show the last 7 days', checkedEvery: 'Satellite data is checked every 30 minutes.', retry: 'Reload', more: 'Show {n} more incidents',
    caveat: 'Hotspots need a field check.',
  },
});
type Key = keyof typeof text.id;

export interface Ctx { hours: number; setHours(h: number): void; filters: IncidentFilters; setFilters(f: IncidentFilters): void; setSelected(s: Selected | null): void }
export const useScreen = () => useOutletContext<Ctx>();

const filterKey = 'titikapi.filters';
function storedFilters(): IncidentFilters {
  try { return { ...defaultFilters, ...JSON.parse(sessionStorage.getItem(filterKey) ?? '{}') }; } catch { return defaultFilters; }
}

/** The map stays mounted while the sidebar switches between the list and an incident. */
export function MapScreen() {
  const [filters, setFiltersState] = useState<IncidentFilters>(storedFilters);
  const [selected, setSelected] = useState<Selected | null>(null);
  const { bbox, regencies, findRegency, province } = useRegion();
  const { version } = useDataVersion();
  const navigate = useNavigate();
  const setFilters = (next: IncidentFilters) => { setFiltersState(next); try { sessionStorage.setItem(filterKey, JSON.stringify(next)); } catch { /* private mode */ } };
  // A regency from the other province makes no sense once the province changes.
  useEffect(() => { if (filters.regency && regencies.length && !regencies.some(r => r.name === filters.regency)) setFilters({ ...filters, regency: '' }); }, [province, regencies.length]);
  const regency = filters.regency ? findRegency(filters.regency) : null;
  const context: Ctx = { hours: filters.hours, setHours: hours => setFilters({ ...filters, hours }), filters, setFilters, setSelected };
  return (
    <Shell>
      <main className="mapscreen">
        <aside className="sidebar dark"><Outlet context={context} /></aside>
        <MapView hours={filters.hours} filters={{ levels: filters.levels, status: filters.status, peat: filters.peat }} version={version}
          bounds={(regency?.bbox as [number, number, number, number] | undefined) ?? bbox} boundsMinZoom={regency ? 8.4 : undefined}
          selected={selected} onSelect={id => navigate(`/kejadian/${id}`)} onVillage={id => navigate(`/desa/${id}`)} />
      </main>
    </Shell>
  );
}

interface Summary { incidents: number; highOpen: number; detections: number }
interface VillageHit { id: string; name: string; district: string; regency: string }
/** The list asks for up to this many incidents; counts come from the list itself when it is complete. */
const LIMIT = 300;
const PAGE = 50;
const introKey = 'titikapi.intro';
const seenIntro = () => { try { return localStorage.getItem(introKey) === 'seen'; } catch { return false; } };
const levels: Level[] = ['tinggi', 'sedang', 'rendah'];

function Intro({ onClose }: { onClose(): void }) {
  const t = useT(text), f = useFormat();
  const { choose, busy, error } = useRoleSwitch();
  return (
    <section className="intro">
      <button type="button" className="intro-close" aria-label={t('introClose')} onClick={onClose}><X size={16} /></button>
      <p className="intro-text">{t('intro')}</p>
      <div className="intro-roles">
        <span className="intro-label">{t('introRoles')}</span>
        {(['mpa', 'kades', 'bpbd'] as const).map(role => (
          <button key={role} type="button" className="btn btn-dark btn-sm" disabled={busy !== null} onClick={async () => { if (await choose(role)) onClose(); }}>{f.role(role)}</button>
        ))}
      </div>
      {error && <p className="intro-error" role="alert">{error}</p>}
    </section>
  );
}

function Filters({ filters, onChange, regencies }: { filters: IncidentFilters; onChange(f: IncidentFilters): void; regencies: RegencyRef[] }) {
  const t = useT(text), f = useFormat();
  const set = (patch: Partial<IncidentFilters>) => onChange({ ...filters, ...patch });
  const toggleLevel = (level: Level) => set({ levels: filters.levels.includes(level) ? filters.levels.filter(item => item !== level) : levels.filter(item => item === level || filters.levels.includes(item)) });
  const provinces = [...new Set(regencies.map(r => r.province))];
  return (
    <div className="filters" role="group" aria-label={t('filters')}>
      {levels.map(level => (
        <button key={level} type="button" className={`fchip ${filters.levels.includes(level) ? 'on' : ''}`} aria-pressed={filters.levels.includes(level)} onClick={() => toggleLevel(level)}>
          <i className={`fdot fdot-${level}`} aria-hidden="true" />{f.level(level)}
        </button>
      ))}
      <button type="button" className={`fchip ${filters.peat ? 'on' : ''}`} aria-pressed={filters.peat} onClick={() => set({ peat: !filters.peat })}>{t('peatOnly')}</button>
      <div className="fseg" role="group" aria-label={t('time')}>
        {([[24, 'h24'], [72, 'd3'], [168, 'd7']] as [number, Key][]).map(([hours, key]) => (
          <button key={hours} type="button" className={filters.hours === hours ? 'on' : ''} aria-pressed={filters.hours === hours} onClick={() => set({ hours })}>{t(key)}</button>
        ))}
      </div>
      <select className="fselect" aria-label={t('status')} value={filters.status} onChange={event => set({ status: event.target.value as StatusFilter })}>
        <option value="all">{t('statusAll')}</option><option value="open">{t('statusOpen')}</option>
        <option value="assigned">{t('statusAssigned')}</option><option value="checked">{t('statusChecked')}</option>
      </select>
      <select className="fselect" aria-label={t('regency')} value={filters.regency} onChange={event => set({ regency: event.target.value })}>
        <option value="">{t('allRegencies')}</option>
        {provinces.map(province => (
          <optgroup key={province} label={shortProvince(province)}>
            {regencies.filter(r => r.province === province).map(r => <option key={`${province}/${r.name}`} value={r.name}>{r.name}</option>)}
          </optgroup>
        ))}
      </select>
      {narrowed(filters) && <button type="button" className="fclear" onClick={() => onChange({ ...defaultFilters, hours: filters.hours, sort: filters.sort })}>{t('clear')}</button>}
    </div>
  );
}

/** One incident in the list: priority bar, place, why it matters, score, age, status. */
function IncidentRow({ incident, onOpen }: { incident: Incident; onOpen(): void }) {
  const t = useT(text), f = useFormat();
  const v = incident.village;
  const reason = [
    incident.nearestPlace ? f.place(incident.nearestPlace) : incident.settlementMeters !== null && incident.settlementMeters !== undefined ? t('fromSettlement', { km: f.km(incident.settlementMeters) }) : null,
    incident.onPeat ? t('peat') : null,
    t(incident.detectionCount === 1 ? 'hotspotOne' : 'hotspotMany', { n: f.num(incident.detectionCount) }),
    incident.modisOnly ? t('uncertain', { km: f.km(incident.locationUncertaintyM ?? 1000) }) : null,
  ].filter(Boolean).join(', ');
  return (
    <button type="button" className="inc" onClick={onOpen}>
      <PriorityMark level={incident.level} />
      <span className="inc-main">
        <span className="inc-title">{v ? t('title', { village: v.name, district: v.district }) : t('outside')}</span>
        <span className="inc-reason">{reason.charAt(0).toUpperCase() + reason.slice(1)}</span>
        <StatusLine incident={incident} />
      </span>
      <span className="inc-side">
        <span className="inc-score" title={t('score', { score: incident.score })} aria-label={t('score', { score: incident.score })}>{incident.score}</span>
        <time className="inc-time" dateTime={incident.lastDetectedAt} title={f.span(incident.lastDetectedAt, incident.lastDetectedAt)}>{f.ago(incident.lastDetectedAt)}</time>
      </span>
    </button>
  );
}

export function IncidentList() {
  const t = useT(text), f = useFormat();
  const { filters, setFilters, setSelected } = useScreen();
  const { query, regencies } = useRegion();
  const { version, status } = useDataVersion();
  const { user } = useSession();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [intro, setIntro] = useState(() => !seenIntro());
  const key = JSON.stringify(filters);
  useEffect(() => setSelected(null), []);
  useEffect(() => setShown(PAGE), [key, query]);
  // An older API takes one priority per request; then the list asks for all and filters here.
  const legacy = Boolean(status && !('serverTime' in status));
  const asked = legacy && filters.levels.length > 1 ? { ...filters, levels: [] } : filters;
  const list = useApi<Incident[]>(`/incidents${incidentQuery(asked, query)}&limit=${LIMIT}`, version);
  // /summary knows the time window and the region only, so other filters do not refetch it.
  const server = useApi<Summary>(`/summary?hours=${filters.hours}${filters.regency ? `&regency=${encodeURIComponent(filters.regency)}` : ''}${query}`, version);
  const hits = useApi<VillageHit[]>(q.trim().length >= 2 ? `/villages?q=${encodeURIComponent(q.trim())}${query}` : null);
  const rows = useMemo(() => (Array.isArray(list.data) ? prepareRows(list.data, filters) : null), [list.data, key]);
  // Counts follow the same filters as the rows: from the rows when the list is complete; from /summary when only
  // the time window and the region narrow it (the filters /summary knows); otherwise the rows with a "+".
  const complete = Array.isArray(list.data) && list.data.length < LIMIT;
  const serverExact = !filters.levels.length && filters.status === 'all' && !filters.peat;
  const counts = rows && (complete || !serverExact || !server.data) ? summarize(rows, !complete) : server.data ? { ...server.data, atLeast: false } : null;
  const closeIntro = () => { setIntro(false); try { localStorage.setItem(introKey, 'seen'); } catch { /* private mode */ } };
  const windowLabel = t(filters.hours === 24 ? 'h24' : filters.hours === 72 ? 'd3' : 'd7');
  const sorts: [IncidentSort, Key][] = [['priority', 'byPriority'], ['recent', 'byRecent'], ['size', 'bySize']];
  const number = (n: number, atLeast = false) => `${f.num(n)}${atLeast ? '+' : ''}`;
  return (
    <>
      <div className="sidebar-scroll">
        {intro && !user && <Intro onClose={closeIntro} />}
        <div className="side-head">
          <label className="search"><Search size={16} aria-hidden="true" /><input value={q} onChange={event => setQ(event.target.value)} placeholder={t('search')} aria-label={t('search')} spellCheck={false} /></label>
          {q.trim().length >= 2 && hits.data && (
            <div className="search-results">
              {hits.data.slice(0, 6).map(v => <button key={v.id} type="button" onClick={() => navigate(`/desa/${v.id}`)}><span>{t('village', { name: v.name })}</span><small>{v.district} · {v.regency}</small></button>)}
              {!hits.data.length && <div className="empty">{t('noVillage')}</div>}
            </div>
          )}
          <Filters filters={filters} onChange={setFilters} regencies={regencies} />
        </div>
        <div className="sumrow" aria-live="polite">
          <div><b>{counts ? number(counts.incidents, counts.atLeast) : '–'}</b><span>{t('incidents')}</span></div>
          <div className="hot"><b>{counts ? number(counts.highOpen, counts.atLeast) : '–'}</b><span>{t('highOpen')}</span></div>
          <div><b>{counts ? number(counts.detections, counts.atLeast) : '–'}</b><span>{t('hotspots')}</span></div>
        </div>
        <div className="list-head">
          <span className="label">{t('sort')}</span>
          <div className="sortseg" role="group" aria-label={t('sort')}>
            {sorts.map(([sort, label]) => <button key={sort} type="button" className={filters.sort === sort ? 'on' : ''} aria-pressed={filters.sort === sort} onClick={() => setFilters({ ...filters, sort })}>{t(label)}</button>)}
          </div>
        </div>
        {list.loading && !rows && <div className="empty">{t('loading')}</div>}
        {list.error && (
          <div className="side-msg"><p>{list.error}</p><button type="button" className="btn btn-dark btn-sm" onClick={list.reload}>{t('retry')}</button></div>
        )}
        {rows && !rows.length && !list.loading && (
          <div className="side-msg">
            <p>{narrowed(filters) ? t('noMatch') : t('noneIn', { window: windowLabel })}</p>
            {narrowed(filters) ? <button type="button" className="btn btn-dark btn-sm" onClick={() => setFilters({ ...defaultFilters, hours: filters.hours, sort: filters.sort })}>{t('clear')}</button>
              : filters.hours < 168 ? <button type="button" className="btn btn-dark btn-sm" onClick={() => setFilters({ ...filters, hours: 168 })}>{t('widen')}</button>
              : <p className="muted">{t('checkedEvery')}</p>}
          </div>
        )}
        <div className="inc-list">{rows?.slice(0, shown).map(incident => <IncidentRow key={incident.id} incident={incident} onOpen={() => navigate(`/kejadian/${incident.id}`)} />)}</div>
        {rows && rows.length > shown && (
          <div className="side-more"><button type="button" className="btn btn-dark btn-block" onClick={() => setShown(shown + PAGE)}>{t('more', { n: f.num(Math.min(PAGE, rows.length - shown)) })}</button></div>
        )}
      </div>
      <div className="side-foot note"><Info size={16} className="icon" aria-hidden="true" />{t('caveat')}</div>
    </>
  );
}
