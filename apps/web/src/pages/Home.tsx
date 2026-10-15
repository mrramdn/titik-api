import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { Incident, IngestStatus } from '../api';
import { Shell } from '../components/Shell';
import { Banner, LevelBadge, StatusPill, useApi } from '../components/ui';
import { MapView, type LayerKey } from '../map/MapView';
import { ago, satelliteLabel, wib, wibDay } from '../format';
import { homeFor, useSession } from '../session';

const layerNames: { key: LayerKey; label: string; hint: string }[] = [
  { key: 'deteksi', label: 'Deteksi satelit', hint: 'Setiap piksel VIIRS 375 m' },
  { key: 'gambut', label: 'Lahan gambut', hint: 'Global peatland extent' },
  { key: 'deforestasi', label: 'Alert gangguan hutan', hint: 'GLAD-L, GLAD-S2, RADD' },
  { key: 'citra', label: 'Citra satelit', hint: 'Sentinel-2 cloudless' },
];

export function HomePage() {
  const [hours, setHours] = useState(24);
  const [layers, setLayers] = useState<Partial<Record<LayerKey, boolean>>>({ deteksi: true, gambut: false });
  const [selected, setSelected] = useState<string | null>(null);
  const incidents = useApi<Incident[]>(`/incidents?hours=${hours}`);
  const detections = useApi<GeoJSON.FeatureCollection>(`/detections?hours=${hours}`);
  const status = useApi<IngestStatus>('/ingest/status');
  const { user, signInDemo } = useSession();
  const navigate = useNavigate();
  const list = incidents.data ?? [];
  const top = list.slice(0, 8);
  const chosen = list.find(incident => incident.id === selected) ?? null;
  const counts = useMemo(() => ({
    incidents: list.length,
    openHigh: list.filter(incident => incident.level === 'tinggi' && !incident.firstVerifiedAt).length,
    detections: detections.data?.features.filter(feature => feature.properties?.villageId).length ?? 0,
  }), [list, detections.data]);
  const latest = status.data?.satellites.slice().sort((a, b) => b.latestAcquisition.localeCompare(a.latestAcquisition))[0];
  const lastRun = status.data?.runs[0];

  return (
    <Shell full>
      <div className="home">
        <aside className="panel">
          <p className="kicker">Musim karhutla 2026 · Kab. Ogan Komering Ilir, Sumsel</p>
          <h1>Titik panas hari ini, <em>per desa</em>.</h1>
          <p className="lead">Satelit NASA melihat panas. Relawan desa memastikan apa yang terbakar. BPBD melihat mana yang belum dicek.</p>
          <div className="live mono">
            <span className={`dot ${lastRun?.source === 'live' ? 'dot-live' : ''}`} />
            <span>{latest ? <>Lintasan terakhir {satelliteLabel[latest.satellite]} {Date.now() - new Date(latest.latestAcquisition).getTime() > 12 * 3600_000 ? wibDay(latest.latestAcquisition) : wib(latest.latestAcquisition)} WIB</> : 'Memuat data satelit…'}
            {lastRun && <> · FIRMS diperiksa {ago(lastRun.finishedAt)}{lastRun.source === 'snapshot' ? ' · data rekaman 16 Okt' : ''}</>}</span>
          </div>
          <div className="kpis">
            <div><strong>{counts.incidents}</strong><span>kejadian {hours} jam</span></div>
            <div className="kpi-hot"><strong>{counts.openHigh}</strong><span>prioritas tinggi belum dicek</span></div>
            <div><strong>{counts.detections}</strong><span>deteksi di desa OKI</span></div>
          </div>
          <div className="segmented" role="group" aria-label="Rentang waktu">
            {[24, 72].map(value => <button key={value} type="button" className={hours === value ? 'on' : ''} onClick={() => setHours(value)}>{value} jam</button>)}
          </div>
          <Banner tone="warn"><b>Titik panas belum tentu api.</b> Setiap titik perlu dicek di lapangan. Tidak ada titik juga belum tentu aman: awan dan asap tebal bisa menutupi api.</Banner>

          <section className="toplist">
            <h2>Prioritas teratas</h2>
            {incidents.loading && !list.length && <p className="muted">Memuat…</p>}
            {!incidents.loading && !list.length && <p className="muted">Tidak ada titik panas di desa OKI dalam {hours} jam terakhir.</p>}
            <ol>
              {top.map(incident => (
                <li key={incident.id} className={incident.id === selected ? 'on' : ''}>
                  <button type="button" onClick={() => setSelected(incident.id)}>
                    <LevelBadge level={incident.level} />
                    <span className="toplist-name">{incident.village?.name ?? 'Di luar desa'}<small>{incident.village?.district}</small></span>
                    <span className="toplist-meta mono">{incident.detectionCount}× · {wib(incident.lastDetectedAt)}</span>
                  </button>
                </li>
              ))}
            </ol>
          </section>

          <section className="layers">
            <h2>Lapisan peta</h2>
            {layerNames.map(layer => (
              <label key={layer.key} className="toggle">
                <input type="checkbox" checked={layer.key === 'deteksi' ? layers.deteksi !== false : Boolean(layers[layer.key])}
                  onChange={event => setLayers(previous => ({ ...previous, [layer.key]: event.target.checked }))} />
                <span>{layer.label}<small>{layer.hint}</small></span>
              </label>
            ))}
            <div className="legend">
              <span><i className="lg lg-tinggi" />Tinggi</span><span><i className="lg lg-sedang" />Sedang</span><span><i className="lg lg-rendah" />Rendah</span><span><i className="lg lg-cek" />Sudah dicek</span>
            </div>
          </section>

          {!user && (
            <section className="try">
              <h2>Coba prototipe</h2>
              <p>Akun demo bersama, tanpa daftar. Bukan akun resmi instansi mana pun.</p>
              <div className="try-buttons">
                <button type="button" className="btn btn-primary" onClick={async () => navigate(homeFor(await signInDemo('mpa')))}>Relawan MPA</button>
                <button type="button" className="btn" onClick={async () => navigate(homeFor(await signInDemo('kades')))}>Kepala desa</button>
                <button type="button" className="btn" onClick={async () => navigate(homeFor(await signInDemo('bpbd')))}>BPBD / Daops</button>
              </div>
            </section>
          )}
        </aside>
        <div className="home-map">
          <MapView incidents={list} detections={detections.data ?? undefined} layers={layers} selectedId={selected}
            onSelect={setSelected} onVillage={id => navigate(`/desa/${id}`)} />
          {chosen && (
            <div className="mapcard">
              <button type="button" className="mapcard-close" aria-label="Tutup" onClick={() => setSelected(null)}>×</button>
              <div className="mapcard-head"><LevelBadge level={chosen.level} /><StatusPill status={chosen.latestStatus} /><span className="mono">KJD-{chosen.code.toUpperCase()}</span></div>
              <p>{chosen.card}</p>
              <div className="mapcard-actions">
                <Link className="btn btn-primary btn-small" to={`/kejadian/${chosen.id}`}>Buka kejadian</Link>
                {chosen.village && <Link className="btn btn-small" to={`/desa/${chosen.village.id}`}>Desa {chosen.village.name}</Link>}
              </div>
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
