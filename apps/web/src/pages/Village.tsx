import { useParams, useNavigate, Link } from 'react-router';
import { ChevronLeft, Share2 } from 'lucide-react';
import type { Incident } from '../api';
import { Shell } from '../components/Shell';
import { Banner, FlameTile, LevelBadge, StatusText, shareCard, useApi } from '../components/ui';
import { MapView } from '../map/MapView';
import { statusLabel, timeSpan } from '../format';

interface VillageDetail { id: string; name: string; district: string; regency: string; province: string; peatShare: number; areaHa: number; center: [number, number]; geometry: GeoJSON.Geometry; incidents: Incident[]; daily: { day: string; detections: number }[] }

export function VillagePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const village = useApi<VillageDetail>(`/villages/${id}`);
  const d = village.data;
  if (!d) return <Shell><main className="page">{village.error ? <Banner tone="warn">{village.error}</Banner> : <div className="empty">Memuat desa…</div>}</main></Shell>;
  const max = Math.max(1, ...d.daily.map(x => x.detections));
  const today = d.incidents.filter(i => Date.now() - new Date(i.lastDetectedAt).getTime() < 24 * 3600_000);
  const summary = `Ringkasan 24 jam Desa ${d.name} (Kec. ${d.district}, ${d.regency}): ${today.length} kejadian titik panas, ${today.filter(i => i.level === 'tinggi').length} prioritas tinggi, ${today.filter(i => i.firstVerifiedAt).length} sudah dicek${today.length ? ` (${today.map(i => (i.latestStatus ? statusLabel[i.latestStatus] : 'belum dicek')).join(', ')})` : ''}. Titik panas belum tentu api; tidak ada titik juga belum tentu aman.`;
  return (
    <Shell>
      <main className="page">
        <Link to="/" className="back" style={{ color: 'var(--text-2)' }}><ChevronLeft size={14} />Peta</Link>
        <div className="page-head">
          <div><h1 className="title-24">Desa {d.name}</h1><p>Kec. {d.district} · {d.regency} · {d.province} · {Math.round(d.areaHa).toLocaleString('id-ID')} ha · {Math.round(d.peatShare * 100)}% bergambut</p></div>
          <button type="button" className="btn btn-wa btn-sm" onClick={() => void shareCard(summary, `/desa/${d.id}`)}><Share2 size={16} />Bagikan ringkasan desa</button>
        </div>
        <div className="dash-grid">
          <div className="dash-map"><MapView hours={168} focus={d.geometry} initialLayers={{ deteksi: true, deforestasi: true }} onSelect={x => navigate(`/kejadian/${x}`)} legend={false} /></div>
          <div className="card" style={{ padding: 16, display: 'grid', gap: 12, alignContent: 'start' }}>
            <span className="heading-16">Deteksi satelit 7 hari</span>
            <div className="bars7">{d.daily.map(x => <div key={x.day}><i style={{ height: `${(x.detections / max) * 100}%` }} /><b>{x.detections}</b><span>{x.day.slice(8)}/{x.day.slice(5, 7)}</span></div>)}</div>
            <p className="note">Lapisan alert gangguan hutan (GLAD-L, GLAD-S2, RADD) aktif di peta untuk memantau alih fungsi lahan. Matikan lewat tombol Lapisan.</p>
          </div>
        </div>
        <div className="card list-card">
          <div className="queue-head"><span className="heading-16">Kejadian 7 hari</span><span className="caption muted">{d.incidents.length}</span></div>
          {!d.incidents.length && <div className="empty">Tidak ada titik panas dalam 7 hari. Tetap waspada: awan dan asap bisa menutupi api.</div>}
          {d.incidents.slice(0, 30).map(i => (
            <Link key={i.id} to={`/kejadian/${i.id}`} className="alert-row">
              <FlameTile level={i.level} checked={Boolean(i.firstVerifiedAt)} size={20} />
              <span className="main"><span className="title">{i.detectionCount} titik panas</span><span className="summary">{timeSpan(i.firstDetectedAt, i.lastDetectedAt)}{i.onPeat ? ' · gambut' : ''}</span>
                <span className="meta"><LevelBadge level={i.level} /><StatusText status={i.latestStatus} /></span></span>
            </Link>
          ))}
        </div>
      </main>
    </Shell>
  );
}
