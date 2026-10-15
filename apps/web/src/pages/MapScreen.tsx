import { useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useNavigate, useOutletContext, useParams } from 'react-router';
import { ChevronLeft, Clock, Info, MapPin, Search, Share2, CircleCheck } from 'lucide-react';
import type { Incident, IncidentDetail } from '../api';
import { Shell } from '../components/Shell';
import { FlameTile, LevelBadge, ScoreRows, StatusText, shareCard, useApi } from '../components/ui';
import { MapView, type Selected } from '../map/MapView';
import { ago, confidenceLabel, duration, falseAlarmLabel, km, satelliteLabel, statusLabel, timeSpan, wib } from '../format';
import { shortProvince, useRegion } from '../region';
import { useSession } from '../session';

interface Ctx { hours: number; setHours(h: number): void; setSelected(s: Selected | null): void }
const useScreen = () => useOutletContext<Ctx>();

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

export function IncidentPanel() {
  const params = useParams();
  const key = params.id ?? params.code!;
  const { setSelected } = useScreen();
  const { user } = useSession();
  const [tab, setTab] = useState<'riwayat' | 'deteksi'>('riwayat');
  const incident = useApi<IncidentDetail>(`/incidents/${key}`);
  const d = incident.data;
  useEffect(() => { if (d) setSelected({ id: d.id, centroid: d.centroid, detections: d.detections.map(x => [x.longitude, x.latitude]) }); }, [d?.id]);
  const minutes = d?.firstVerifiedAt ? Math.round((new Date(d.firstVerifiedAt).getTime() - new Date(d.firstDetectedAt).getTime()) / 60000) : null;
  const events = useMemo(() => {
    if (!d) return [];
    const list: { at: string; text: string; photo?: string | null }[] = d.verifications.map(v => ({ at: v.observedAt,
      text: `${statusLabel[v.status]}${v.falseAlarmKind ? ` (${falseAlarmLabel[v.falseAlarmKind]})` : ''} · dicek${v.distanceMeters !== null ? ` ${km(v.distanceMeters)} dari titik` : ''}${v.demo ? ' · contoh dari akun demo' : ''}${v.note ? `. ${v.note}` : ''}`, photo: v.photoThumbUrl }));
    const bySat = new Map<string, { at: string; n: number; sat: string }>();
    for (const x of d.detections) { const k = `${x.satellite}-${x.acqAt}`; const e = bySat.get(k) ?? { at: x.acqAt, n: 0, sat: x.satellite }; e.n++; bySat.set(k, e); }
    for (const e of bySat.values()) list.push({ at: e.at, text: `${satelliteLabel[e.sat]} · ${e.n} deteksi` });
    return list.sort((a, b) => b.at.localeCompare(a.at));
  }, [d]);
  if (incident.error && !d) return <div className="detail"><section><Link to="/" className="back"><ChevronLeft size={14} />Semua kejadian</Link><p className="subline">{incident.error}</p></section></div>;
  if (!d) return <div className="empty">Memuat kejadian…</div>;
  return (
    <div className="sidebar-scroll detail">
      <section>
        <Link to="/" className="back"><ChevronLeft size={14} />Semua kejadian</Link>
        <div className="code-line"><LevelBadge level={d.level} /><span className="mono">KJD-{d.code.toUpperCase()}</span></div>
        <h1 className="title-24">{d.detectionCount} titik panas</h1>
        <p className="subline">Desa {d.village?.name} · Kec. {d.village?.district} · {d.village?.regency}</p>
        <div className="statusline"><Clock size={14} className="icon" /><span>{timeSpan(d.firstDetectedAt, d.lastDetectedAt)} · {[...new Set(d.satellites)].map(c => satelliteLabel[c]).join(', ')}</span></div>
        <div className="statusline"><StatusText status={d.latestStatus} demo={d.verifications[0]?.demo} />{minutes !== null && <span>· {duration(minutes)} setelah deteksi pertama</span>}</div>
      </section>
      <section>
        <div className="stats-grid">
          <div className="stat"><span className="label">Deteksi</span><span className="value">{d.detectionCount}</span></div>
          <div className="stat"><span className="label">FRP maks</span><span className="value">{d.maxFrp === null ? '–' : `${d.maxFrp.toLocaleString('id-ID', { maximumFractionDigits: 1 })} MW`}</span></div>
          <div className="stat"><span className="label">Gambut</span><span className="value">{d.onPeat ? 'Ya' : 'Tidak'}</span></div>
          <div className="stat"><span className="label">Permukiman</span><span className="value">{d.settlementMeters === null ? '–' : km(d.settlementMeters)}</span></div>
        </div>
      </section>
      <section>
        {(user?.role === 'mpa' || user?.role === 'admin') && <Link to={`/kejadian/${d.id}/cek`} className="btn btn-primary btn-block"><CircleCheck size={16} />Cek lapangan</Link>}
        {d.card && <button type="button" className="btn btn-wa btn-block" onClick={() => void shareCard(d.card!, d.sharePath)}><Share2 size={16} />Bagikan ke grup WA</button>}
        {d.village && <Link to={`/desa/${d.village.id}`} className="btn btn-dark btn-block"><MapPin size={16} />Halaman desa</Link>}
      </section>
      <section><ScoreRows parts={d.scoreParts} score={d.score} /></section>
      <div className="tabs">
        <button type="button" className={tab === 'riwayat' ? 'on' : ''} onClick={() => setTab('riwayat')}>Riwayat</button>
        <button type="button" className={tab === 'deteksi' ? 'on' : ''} onClick={() => setTab('deteksi')}>Deteksi ({d.detections.length})</button>
      </div>
      {tab === 'riwayat' ? (
        <div className="timeline">
          {events.map((e, i) => <div key={i} className="event"><span className="mono">{wib(e.at)}</span><div>{e.text}{e.photo && <img src={e.photo} alt="Foto cek lapangan" loading="lazy" />}</div></div>)}
          {!user && d.verifications.length > 0 && <p className="note">Catatan, foto, dan nama pelapor hanya terlihat oleh tim yang masuk.</p>}
          <p className="note">Data: NASA FIRMS, VIIRS 375 m. Titik panas adalah indikasi anomali suhu permukaan, bukan kepastian kebakaran.</p>
        </div>
      ) : (
        <table className="det-table"><thead><tr><th>WIB</th><th>Satelit</th><th>Keyakinan</th><th>FRP</th></tr></thead>
          <tbody>{d.detections.slice(0, 120).map(x => <tr key={x.id}><td className="mono">{wib(x.acqAt)}</td><td>{satelliteLabel[x.satellite]}</td><td>{confidenceLabel[x.confidence]}</td><td>{x.frp ?? '–'}</td></tr>)}</tbody></table>
      )}
      <p className="note" style={{ padding: '0 20px 20px' }}>Diperbarui {ago(d.lastDetectedAt)}.</p>
    </div>
  );
}
