import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { Download, ImageOff } from 'lucide-react';
import type { Incident, Status } from '../api';
import { Shell } from '../components/Shell';
import { Banner, FlameTile, LevelBadge, StatusText, useApi } from '../components/ui';
import { MapView } from '../map/MapView';
import { ago, duration, km, percent, wib } from '../format';
import { shortProvince, useRegion } from '../region';
import { useSession } from '../session';

interface Dashboard {
  summary: { incidents: number; verified: number; verifiedShare: number | null; high: number; openHigh: number; falseAlarms: number; onPeat: number; medianMinutesToVerification: number | null; detections: number };
  villages: { id: string; name: string; district: string; regency: string; incidents: number; detections: number; verified: number; openHigh: number; lastDetectedAt: string; medianMinutesToVerification: number | null }[];
  recentVerifications: { id: string; status: Status; observedAt: string; distanceMeters: number | null; note: string; photoThumbUrl: string | null; demo: boolean; reporter: string; incidentId: string; villageName: string | null; minutesFromDetection: number }[];
  verificationsFromDemoAccounts: { total: number; demo: number };
}

export function DashboardPage() {
  const { user, ready } = useSession();
  const { province, query, bbox, provinces } = useRegion();
  const navigate = useNavigate();
  const [range, setRange] = useState<'24h' | '7d'>('24h');
  const [all, setAll] = useState(false);
  const allowed = user?.role === 'bpbd' || user?.role === 'admin';
  const dash = useApi<Dashboard>(allowed ? `/dashboard?range=${range}${query}` : null);
  const queue = useApi<Incident[]>(allowed ? `/incidents?hours=${range === '24h' ? 24 : 168}&level=tinggi&limit=40${query}` : null);
  if (ready && !user) return <Navigate to="/masuk" replace />;
  if (user && !allowed) return <Shell><main className="page narrow"><Banner tone="warn">Dasbor untuk BPBD dan Daops. Masuk sebagai petugas BPBD untuk mencoba.</Banner></main></Shell>;
  const d = dash.data, s = d?.summary;
  const villageCount = province ? provinces.find(p => p.name === province)?.villages : provinces.reduce((n, p) => n + p.villages, 0);
  const open = (queue.data ?? []).filter(i => !i.firstVerifiedAt);
  return (
    <Shell>
      <main className="page wide">
        <div className="page-head">
          <div><h1 className="title-24">Dasbor</h1><p>{province ? province : 'Sumatera Selatan + Kalimantan Tengah'} · {range === '24h' ? '24 jam' : '7 hari'} terakhir{villageCount ? ` · ${villageCount.toLocaleString('id-ID')} desa` : ''}</p></div>
          <div className="chips">
            <button type="button" className={`chip ${range === '24h' ? 'on' : ''}`} onClick={() => setRange('24h')}>24 jam</button>
            <button type="button" className={`chip ${range === '7d' ? 'on' : ''}`} onClick={() => setRange('7d')}>7 hari</button>
            <a className="btn btn-secondary btn-sm" href={`/api/v1/export/groundcheck.csv?range=${range}${query}`}><Download size={16} />Ekspor CSV groundcheck</a>
          </div>
        </div>
        {d && d.verificationsFromDemoAccounts.demo > 0 && <Banner>Prototipe: {d.verificationsFromDemoAccounts.demo} dari {d.verificationsFromDemoAccounts.total} cek lapangan di rentang ini berasal dari akun demo. Titik panasnya data asli NASA FIRMS.</Banner>}
        {dash.error && <Banner tone="warn">{dash.error}</Banner>}
        <div className="card kpi-strip">
          <div><span className="label">Kejadian</span><span className="number-28">{s ? s.incidents.toLocaleString('id-ID') : '–'}</span><span className="caption muted">{s ? `${s.detections.toLocaleString('id-ID')} deteksi · ${s.incidents ? Math.round((s.onPeat / s.incidents) * 100) : 0}% di gambut` : ''}</span></div>
          <div><span className="label">Sudah dicek</span><span className="number-28">{s ? percent(s.verifiedShare) : '–'}</span><span className="caption muted">{s ? `${s.verified} kejadian` : ''}</span></div>
          <div><span className="label">Median deteksi → cek</span><span className="number-28">{s ? duration(s.medianMinutesToVerification) : '–'}</span><span className="caption muted">termasuk jeda rilis data satelit</span></div>
          <div className="hot"><span className="label">Tinggi belum dicek</span><span className="number-28">{s ? s.openHigh.toLocaleString('id-ID') : '–'}</span><span className="caption muted">{s ? `dari ${s.high.toLocaleString('id-ID')} prioritas tinggi` : ''}</span></div>
          <div><span className="label">Alarm palsu</span><span className="number-28">{s?.falseAlarms ?? '–'}</span><span className="caption muted">lokasi ditandai 30 hari</span></div>
        </div>
        <div className="dash-grid">
          <div className="dash-map"><MapView hours={range === '24h' ? 24 : 168} bounds={bbox} initialLayers={{ deteksi: false }} onSelect={id => navigate(`/kejadian/${id}`)} onVillage={id => navigate(`/desa/${id}`)} legend={false} /></div>
          <div className="card queue">
            <div className="queue-head"><span className="heading-16">Antrean: tinggi, belum dicek</span><span className="caption muted">{open.length}</span></div>
            <div className="queue-list">
              {open.slice(0, 20).map(i => (
                <Link key={i.id} to={`/kejadian/${i.id}`} className="alert-row">
                  <FlameTile level={i.level} size={20} />
                  <span className="main"><span className="title">{i.detectionCount} titik panas · Desa {i.village?.name}</span><span className="summary">{i.village?.regency} · {i.onPeat ? 'gambut · ' : ''}skor {i.score}</span>
                    <span className="meta"><LevelBadge level={i.level} />{wib(i.lastDetectedAt)} WIB</span></span>
                </Link>
              ))}
              {queue.data && !open.length && <div className="empty">Semua kejadian prioritas tinggi sudah dicek.</div>}
            </div>
          </div>
        </div>
        <div className="dash-grid">
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="table">
              <thead><tr><th>Desa</th><th>Kabupaten</th><th>Kejadian</th><th>Dicek</th><th>Tinggi belum dicek</th><th>Median ke cek</th><th>Terakhir</th></tr></thead>
              <tbody>{d?.villages.slice(0, all ? undefined : 15).map(v => (
                <tr key={v.id} onClick={() => navigate(`/desa/${v.id}`)}>
                  <td>{v.name}<div className="caption muted">{v.district}</div></td><td>{v.regency}</td><td>{v.incidents}</td>
                  <td><span className="checkbar"><span className="track"><i style={{ width: `${v.incidents ? (v.verified / v.incidents) * 100 : 0}%` }} /></span>{v.verified}/{v.incidents}</span></td>
                  <td className={v.openHigh ? 'hot' : ''}>{v.openHigh || '–'}</td><td>{duration(v.medianMinutesToVerification)}</td><td>{ago(v.lastDetectedAt)}</td>
                </tr>
              ))}</tbody>
            </table>
            {d && d.villages.length > 15 && !all && <div style={{ padding: 12 }}><button type="button" className="btn btn-secondary btn-sm" onClick={() => setAll(true)}>Tampilkan {d.villages.length} desa</button></div>}
          </div>
          <div className="card feed">
            <div className="queue-head"><span className="heading-16">Cek lapangan terbaru</span></div>
            {d?.recentVerifications.map(v => (
              <Link key={v.id} to={`/kejadian/${v.incidentId}`} className="feed-item">
                {v.photoThumbUrl ? <img src={v.photoThumbUrl} alt="" loading="lazy" /> : <span className="nophoto"><ImageOff size={18} /></span>}
                <span style={{ display: 'grid', gap: 3 }}><StatusText status={v.status} demo={v.demo} /><b style={{ fontWeight: 500 }}>Desa {v.villageName}</b>
                  <span className="caption muted">{duration(v.minutesFromDetection)} setelah deteksi{v.distanceMeters !== null ? ` · ${km(v.distanceMeters)} dari titik` : ''} · {v.reporter}</span></span>
              </Link>
            ))}
            {d && !d.recentVerifications.length && <div className="empty">Belum ada cek lapangan di rentang ini.</div>}
          </div>
        </div>
        <p className="note">Wilayah: {province ? shortProvince(province) : 'Sumsel + Kalteng'}. Ganti lewat pemilih wilayah di bilah atas.</p>
      </main>
    </Shell>
  );
}
