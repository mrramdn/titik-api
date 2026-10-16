import { useEffect, useState } from 'react';
import { Outlet, useNavigate, useOutletContext } from 'react-router';
import { ChevronLeft, Clock, Info, MapPin, Search, Share2, CircleCheck } from 'lucide-react';
import type { Incident, IncidentDetail } from '../api';
import { Shell } from '../components/Shell';
import { FlameTile, LevelBadge, ScoreRows, StatusText, shareCard, useApi } from '../components/ui';
import { MapView, type Selected } from '../map/MapView';
import { ago, confidenceLabel, duration, falseAlarmLabel, km, satelliteLabel, statusLabel, timeSpan, wib } from '../format';
import { shortProvince, useRegion } from '../region';
import { useSession } from '../session';

export interface Ctx { hours: number; setHours(h: number): void; setSelected(s: Selected | null): void }
export const useScreen = () => useOutletContext<Ctx>();

/** The map stays mounted while the sidebar switches between the list and an incident. */
export function MapScreen() {
  const [hours, setHours] = useState(24);
  const [selected, setSelected] = useState<Selected | null>(null);
  const { bbox } = useRegion();
  const navigate = useNavigate();
  return (
    <Shell>
      <main className="mapscreen">
        <aside className="sidebar dark"><Outlet context={{ hours, setHours, setSelected } satisfies Ctx} /></aside>
        <MapView hours={hours} bounds={selected ? undefined : bbox} selected={selected} onSelect={id => navigate(`/kejadian/${id}`)} onVillage={id => navigate(`/desa/${id}`)} />
      </main>
    </Shell>
  );
}

interface Summary { incidents: number; highOpen: number; detections: number; villages: number }
interface VillageHit { id: string; name: string; district: string; regency: string }

export function IncidentList() {
  const { hours, setHours, setSelected } = useScreen();
  const { province, provinces, setProvince, query } = useRegion();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  useEffect(() => setSelected(null), []);
  const summary = useApi<Summary>(`/summary?hours=${hours}${query}`);
  const incidents = useApi<Incident[]>(`/incidents?hours=${hours}&limit=60${query}`);
  const hits = useApi<VillageHit[]>(q.trim().length >= 2 ? `/villages?q=${encodeURIComponent(q.trim())}${query}` : null);
  const s = summary.data;
  return (
    <>
      <div className="sidebar-scroll">
        <div className="side-head">
          <label className="search"><Search size={16} /><input value={q} onChange={event => setQ(event.target.value)} placeholder="Cari desa, kecamatan, atau kabupaten" /></label>
          {q.trim().length >= 2 && hits.data && (
            <div className="search-results">
              {hits.data.slice(0, 6).map(v => <button key={v.id} type="button" onClick={() => navigate(`/desa/${v.id}`)}><span>Desa {v.name}</span><small>{v.district} · {v.regency}</small></button>)}
              {!hits.data.length && <div className="empty">Desa tidak ditemukan.</div>}
            </div>
          )}
          <div className="stats-row">
            <div className="stat"><span className="label">Kejadian {hours} j</span><span className="value">{s ? s.incidents.toLocaleString('id-ID') : '–'}</span></div>
            <div className="stat"><span className="label">Tinggi, belum dicek</span><span className="value" style={{ color: 'var(--priority-high)' }}>{s ? s.highOpen.toLocaleString('id-ID') : '–'}</span></div>
            <div className="stat"><span className="label">Deteksi di desa</span><span className="value">{s ? s.detections.toLocaleString('id-ID') : '–'}</span></div>
          </div>
          <div className="chips">
            {[24, 72].map(h => <button key={h} type="button" className={`chip ${hours === h ? 'on' : ''}`} onClick={() => setHours(h)}>{h} jam</button>)}
            <button type="button" className={`chip ${province === '' ? 'on' : ''}`} onClick={() => setProvince('')}>Semua</button>
            {provinces.map(p => <button key={p.name} type="button" className={`chip ${province === p.name ? 'on' : ''}`} onClick={() => setProvince(p.name)}>{shortProvince(p.name)}</button>)}
          </div>
        </div>
        <hr className="hairline" />
        <div className="list-head"><span className="label">Prioritas teratas</span><span className="caption" style={{ color: 'var(--chrome-text-3)' }}>urut skor</span></div>
        {incidents.loading && !incidents.data && <div className="empty">Memuat…</div>}
        {incidents.data && !incidents.data.length && <div className="empty">Tidak ada titik panas di desa dalam {hours} jam terakhir. Tidak ada titik belum tentu aman.</div>}
        {incidents.data?.map(incident => (
          <button key={incident.id} type="button" className="inc-row" onClick={() => navigate(`/kejadian/${incident.id}`)}>
            <FlameTile level={incident.level} checked={Boolean(incident.firstVerifiedAt)} />
            <span className="main">
              <span className="title">Desa {incident.village?.name}</span>
              <span className="sub">Kec. {incident.village?.district} · {incident.village?.regency}</span>
              <span className="meta"><LevelBadge level={incident.level} />{incident.detectionCount} deteksi{incident.onPeat ? ' · gambut' : ''}</span>
            </span>
            <span className="right"><span>{wib(incident.lastDetectedAt)}</span><StatusText status={incident.latestStatus} /></span>
          </button>
        ))}
      </div>
      <div className="side-foot note"><Info size={16} className="icon" />Titik panas adalah anomali panas dari satelit, belum tentu api. Tidak ada titik juga belum tentu aman: awan dan asap tebal bisa menutupi api.</div>
    </>
  );
}
