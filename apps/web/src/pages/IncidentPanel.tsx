import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ChevronLeft, Clock, MapPin, Share2, CircleCheck } from 'lucide-react';
import type { IncidentDetail } from '../api';
import { LevelBadge, ScoreRows, StatusText, shareCard, useApi } from '../components/ui';
import { ago, confidenceLabel, duration, falseAlarmLabel, km, satelliteLabel, statusLabel, timeSpan, wib } from '../format';
import { useSession } from '../session';
import { useScreen } from './MapScreen';

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
