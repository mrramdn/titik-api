import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import type { Incident, Status } from '../api';
import { Shell } from '../components/Shell';
import { Banner, StatusPill, useApi } from '../components/ui';
import { MapView } from '../map/MapView';
import { ago, duration, km, percent, statusLabel, wib } from '../format';
import { useSession } from '../session';

interface Dashboard {
  summary: { incidents: number; verified: number; verifiedShare: number | null; high: number; openHigh: number; falseAlarms: number; onPeat: number; medianMinutesToVerification: number | null; detections: number };
  statuses: { status: Status; count: number }[];
  villages: { id: string; name: string; district: string; incidents: number; detections: number; verified: number; openHigh: number; maxScore: number; onPeat: boolean; lastDetectedAt: string; medianMinutesToVerification: number | null }[];
  recentVerifications: { id: string; status: Status; falseAlarmKind: string | null; observedAt: string; distanceMeters: number | null; note: string; photoThumbUrl: string | null; demo: boolean; reporter: string; incidentId: string; villageName: string | null; minutesFromDetection: number }[];
  verificationsFromDemoAccounts: { total: number; demo: number };
}

export function DashboardPage() {
  const { user, ready } = useSession();
  const navigate = useNavigate();
  const [range, setRange] = useState<'24h' | '7d'>('24h');
  const [allRows, setAllRows] = useState(false);
  const allowed = user?.role === 'bpbd' || user?.role === 'admin';
  const dashboard = useApi<Dashboard>(allowed ? `/dashboard?range=${range}` : null);
  const incidents = useApi<Incident[]>(allowed ? `/incidents?hours=${range === '24h' ? 24 : 168}` : null);
  if (ready && !user) return <Navigate to="/masuk" replace />;
  if (user && !allowed) return <Shell><div className="page narrow"><Banner tone="warn">Dasbor untuk BPBD dan Daops. Masuk sebagai petugas BPBD untuk mencoba.</Banner></div></Shell>;
  const data = dashboard.data;
  const s = data?.summary;
  return (
    <Shell>
      <div className="page wide dashboard">
        <div className="page-head">
          <div>
            <p className="kicker">Dasbor BPBD / Daops · Kabupaten Ogan Komering Ilir</p>
            <h1>Mana yang sudah dicek, dan seberapa cepat.</h1>
          </div>
          <div className="row">
            <div className="segmented" role="group" aria-label="Rentang">
              <button type="button" className={range === '24h' ? 'on' : ''} onClick={() => setRange('24h')}>24 jam</button>
              <button type="button" className={range === '7d' ? 'on' : ''} onClick={() => setRange('7d')}>7 hari</button>
            </div>
            <a className="btn" href={`/api/v1/export/groundcheck.csv?range=${range}`}>Ekspor CSV groundcheck</a>
          </div>
        </div>
        {data && data.verificationsFromDemoAccounts.demo > 0 && <Banner>Prototipe: {data.verificationsFromDemoAccounts.demo} dari {data.verificationsFromDemoAccounts.total} cek lapangan di rentang ini berasal dari akun demo. Titik panasnya data asli NASA FIRMS.</Banner>}
        {dashboard.error && <Banner tone="warn">{dashboard.error}</Banner>}
        <div className="bigkpis">
          <div><span>Kejadian</span><strong>{s?.incidents ?? '–'}</strong><small>{s ? `${s.detections} deteksi · ${s.onPeat} di gambut` : ''}</small></div>
          <div><span>Sudah dicek</span><strong>{s ? percent(s.verifiedShare) : '–'}</strong><small>{s ? `${s.verified} kejadian` : ''}</small></div>
          <div><span>Median deteksi → cek</span><strong>{s ? duration(s.medianMinutesToVerification) : '–'}</strong><small>termasuk jeda rilis data satelit</small></div>
          <div className="hot"><span>Prioritas tinggi belum dicek</span><strong>{s?.openHigh ?? '–'}</strong><small>{s ? `dari ${s.high} prioritas tinggi` : ''}</small></div>
          <div><span>Alarm palsu</span><strong>{s?.falseAlarms ?? '–'}</strong><small>masuk masker sumber tetap</small></div>
        </div>
        <div className="dash-grid">
          <MapView className="map-mid" incidents={incidents.data ?? []} layers={{ deteksi: false }} onSelect={id => navigate(`/kejadian/${id}`)} onVillage={id => navigate(`/desa/${id}`)} />
          <section className="feed">
            <h2>Cek lapangan terbaru</h2>
            {data && !data.recentVerifications.length && <p className="muted">Belum ada cek lapangan di rentang ini.</p>}
            <ul>
              {data?.recentVerifications.map(v => (
                <li key={v.id}>
                  {v.photoThumbUrl ? <img src={v.photoThumbUrl} alt="" loading="lazy" /> : <div className="nophoto" aria-hidden="true" />}
                  <div>
                    <div className="row"><StatusPill status={v.status} demo={v.demo} /><span className="mono">{wib(v.observedAt)}</span></div>
                    <Link to={`/kejadian/${v.incidentId}`}><b>Desa {v.villageName}</b></Link>
                    <small>{duration(v.minutesFromDetection)} setelah deteksi{v.distanceMeters !== null ? ` · ${km(v.distanceMeters)} dari titik` : ''} · {v.reporter}</small>
                    {v.note && <p>{v.note}</p>}
                  </div>
                </li>
              ))}
            </ul>
            {data && data.statuses.length > 0 && (
              <div className="statusbar">{data.statuses.map(item => <span key={item.status} className={`seg seg-${item.status}`} style={{ flex: item.count }} title={`${statusLabel[item.status]}: ${item.count}`}>{item.count}</span>)}</div>
            )}
          </section>
        </div>
        <section>
          <h2>Per desa</h2>
          <table className="table">
            <thead><tr><th>Desa</th><th>Kecamatan</th><th>Kejadian</th><th>Deteksi</th><th>Dicek</th><th>Tinggi belum dicek</th><th>Median ke cek</th><th>Terakhir</th></tr></thead>
            <tbody>
              {data?.villages.slice(0, allRows ? undefined : 30).map(v => (
                <tr key={v.id} onClick={() => navigate(`/desa/${v.id}`)} className={v.openHigh ? 'hot' : ''}>
                  <td><b>{v.name}</b>{v.onPeat && <span className="tag">gambut</span>}</td><td>{v.district}</td><td>{v.incidents}</td><td>{v.detections}</td>
                  <td>{v.verified}/{v.incidents}</td><td>{v.openHigh || '–'}</td><td>{duration(v.medianMinutesToVerification)}</td><td>{ago(v.lastDetectedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && data.villages.length > 30 && !allRows && <button type="button" className="btn btn-small" style={{ marginTop: 10 }} onClick={() => setAllRows(true)}>Tampilkan semua {data.villages.length} desa</button>}
        </section>
      </div>
    </Shell>
  );
}
