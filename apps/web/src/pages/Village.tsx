import { useState } from 'react';
import { useParams } from 'react-router';
import type { Incident } from '../api';
import { Shell } from '../components/Shell';
import { Banner, LevelBadge, StatusPill, shareCard, useApi } from '../components/ui';
import { MapView } from '../map/MapView';
import { statusLabel, wib, wibDay } from '../format';
import { useNavigate } from 'react-router';

interface VillageDetail { id: string; name: string; district: string; regency: string; province: string; peatShare: number; areaHa: number; center: [number, number]; centerSource: string;
  geometry: GeoJSON.Geometry; incidents: Incident[]; daily: { day: string; detections: number }[] }

export function VillagePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const village = useApi<VillageDetail>(`/villages/${id}`);
  const [alerts, setAlerts] = useState(true);
  const data = village.data;
  if (!data) return <Shell><div className="page">{village.error ? <Banner tone="warn">{village.error}</Banner> : <p className="muted">Memuat desa…</p>}</div></Shell>;
  const max = Math.max(1, ...data.daily.map(day => day.detections));
  const today = data.incidents.filter(incident => Date.now() - new Date(incident.lastDetectedAt).getTime() < 24 * 3600_000);
  const summary = `Ringkasan 24 jam Desa ${data.name} (Kec. ${data.district}): ${today.length} kejadian titik panas, ${today.filter(i => i.level === 'tinggi').length} prioritas tinggi, `
    + `${today.filter(i => i.firstVerifiedAt).length} sudah dicek${today.length ? ` (${today.map(i => (i.latestStatus ? statusLabel[i.latestStatus] : 'belum dicek')).join(', ')})` : ''}. `
    + 'Titik panas belum tentu api; tidak ada titik juga belum tentu aman.';
  return (
    <Shell>
      <div className="page village">
        <p className="kicker">Kec. {data.district} · {data.regency}</p>
        <h1>Desa {data.name}</h1>
        <div className="row">
          <span className="pill">{Math.round(data.peatShare * 100)}% wilayah bergambut</span>
          <span className="pill">{Math.round(data.areaHa).toLocaleString('id-ID')} ha</span>
          <button type="button" className="btn btn-wa btn-small" onClick={() => void shareCard(summary, `/desa/${data.id}`)}>Bagikan ringkasan desa</button>
        </div>
        <div className="incident-grid">
          <div>
            <MapView className="map-mid" incidents={data.incidents} focus={data.geometry} layers={{ deteksi: false, deforestasi: alerts, gambut: !alerts }} onSelect={incidentId => navigate(`/kejadian/${incidentId}`)} showVillages />
            <label className="toggle inline"><input type="checkbox" checked={alerts} onChange={event => setAlerts(event.target.checked)} /><span>Alert gangguan hutan (alih fungsi lahan)<small>Integrated deforestation alerts · Global Nature Watch. Matikan untuk melihat peta gambut.</small></span></label>
          </div>
          <div className="stack">
            <section>
              <h2>Deteksi satelit 7 hari</h2>
              <div className="bars">{data.daily.map(day => (
                <div key={day.day} className="bar"><span style={{ height: `${(day.detections / max) * 100}%` }} /><b>{day.detections}</b><small>{day.day.slice(8)}/{day.day.slice(5, 7)}</small></div>
              ))}</div>
            </section>
            <section>
              <h2>Kejadian 7 hari</h2>
              {!data.incidents.length && <p className="muted">Tidak ada titik panas dalam 7 hari. Tetap waspada: awan dan asap bisa menutupi api.</p>}
              <ul className="history">{data.incidents.slice(0, 20).map(incident => (
                <li key={incident.id} onClick={() => navigate(`/kejadian/${incident.id}`)} className="clickable">
                  <LevelBadge level={incident.level} /><StatusPill status={incident.latestStatus} />
                  <span className="mono">{wibDay(incident.firstDetectedAt)}–{wib(incident.lastDetectedAt)}</span><span>{incident.detectionCount} deteksi</span>
                </li>
              ))}</ul>
            </section>
          </div>
        </div>
      </div>
    </Shell>
  );
}
