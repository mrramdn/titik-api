import { useMemo } from 'react';
import { Link, useParams } from 'react-router';
import type { IncidentDetail } from '../api';
import { Shell } from '../components/Shell';
import { Banner, Facts, LevelBadge, ScoreBreakdown, StatusPill, shareCard, useApi } from '../components/ui';
import { MapView } from '../map/MapView';
import { confidenceLabel, duration, falseAlarmLabel, km, satelliteLabel, wib, wibDay } from '../format';
import { useSession } from '../session';

export function IncidentPage({ code }: { code?: string }) {
  const params = useParams();
  const key = code ?? params.id!;
  const { user } = useSession();
  const incident = useApi<IncidentDetail>(`/incidents/${key}`);
  const data = incident.data;
  const detections = useMemo<GeoJSON.FeatureCollection | undefined>(() => data ? { type: 'FeatureCollection', features: data.detections.map(d => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [d.longitude, d.latitude] }, properties: { confidence: d.confidence, villageId: data.village?.id ?? null } })) } : undefined, [data]);
  if (incident.error && !data) return <Shell><div className="page"><Banner tone="warn">{incident.error}</Banner></div></Shell>;
  if (!data) return <Shell><div className="page"><p className="muted">Memuat kejadian…</p></div></Shell>;
  const minutes = data.firstVerifiedAt ? Math.round((new Date(data.firstVerifiedAt).getTime() - new Date(data.firstDetectedAt).getTime()) / 60000) : null;
  return (
    <Shell>
      <div className="page incident">
        <div className="incident-head">
          <p className="kicker mono">KJD-{data.code.toUpperCase()} · {wibDay(data.firstDetectedAt)} WIB</p>
          <h1>{data.detectionCount} titik panas{data.village ? <> di Desa {data.village.name}</> : null}</h1>
          <div className="row"><LevelBadge level={data.level} /><StatusPill status={data.latestStatus} demo={data.verifications[0]?.demo} />
            {minutes !== null && <span className="pill pill-time">dicek {duration(minutes)} setelah deteksi</span>}</div>
          {data.card && <p className="cardline">{data.card}</p>}
          <div className="row">
            {data.card && <button type="button" className="btn btn-wa" onClick={() => void shareCard(data.card!, data.sharePath)}>Bagikan ke WA</button>}
            {(user?.role === 'mpa' || user?.role === 'admin') && <Link className="btn btn-primary" to={`/kejadian/${data.id}/cek`}>Cek lapangan</Link>}
            {data.village && <Link className="btn" to={`/desa/${data.village.id}`}>Lihat desa</Link>}
          </div>
        </div>
        <div className="incident-grid">
          <MapView className="map-mid" incidents={[data]} detections={detections} selectedId={data.id} center={data.centroid} zoom={13} layers={{ deteksi: true, gambut: data.onPeat }} />
          <div className="stack">
            <Facts incident={data} />
            <ScoreBreakdown parts={data.scoreParts} score={data.score} level={data.level} />
          </div>
        </div>
        <section>
          <h2>Riwayat cek lapangan</h2>
          {!data.verifications.length && <p className="muted">Belum ada yang mengecek kejadian ini.</p>}
          <ul className="history">
            {data.verifications.map(v => (
              <li key={v.id}>
                <StatusPill status={v.status} demo={v.demo} />
                <span className="mono">{wibDay(v.observedAt)} WIB</span>
                {v.falseAlarmKind && <span>{falseAlarmLabel[v.falseAlarmKind]}</span>}
                {v.distanceMeters !== null && <span>{km(v.distanceMeters)} dari titik</span>}
                {v.demo && <span className="muted">Contoh dari akun demo, bukan laporan lapangan sungguhan.</span>}
                {v.note && <p>{v.note}</p>}
                {v.photoThumbUrl && <a href={v.photoUrl ?? v.photoThumbUrl} target="_blank" rel="noreferrer"><img src={v.photoThumbUrl} alt="Foto cek lapangan" loading="lazy" /></a>}
              </li>
            ))}
          </ul>
          {!user && data.verifications.length > 0 && <p className="fine">Catatan, foto, dan nama pelapor hanya terlihat oleh tim yang masuk.</p>}
        </section>
        <section>
          <h2>Deteksi satelit</h2>
          <table className="table mono">
            <thead><tr><th>Waktu (WIB)</th><th>Satelit</th><th>Keyakinan</th><th>FRP (MW)</th><th>Suhu I4 (K)</th><th>Gambut</th></tr></thead>
            <tbody>{data.detections.slice(0, 80).map(d => (
              <tr key={d.id}><td>{wib(d.acqAt)}</td><td>{satelliteLabel[d.satellite]}</td><td>{confidenceLabel[d.confidence]}</td><td>{d.frp ?? '–'}</td><td>{d.brightTi4 ?? '–'}</td><td>{d.onPeat ? 'ya' : 'tidak'}</td></tr>
            ))}</tbody>
          </table>
          {data.detections.length > 80 && <p className="fine">Menampilkan 80 dari {data.detections.length} deteksi.</p>}
          <p className="fine">Sumber: NASA FIRMS, VIIRS 375 m. Titik panas adalah indikasi anomali suhu permukaan, bukan kepastian kebakaran.</p>
        </section>
      </div>
    </Shell>
  );
}
