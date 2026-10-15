import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { Camera, ChevronLeft, CircleCheck, Navigation2, WifiOff } from 'lucide-react';
import type { IncidentDetail, Status } from '../api';
import { Banner, LevelBadge, useApi, useOnline } from '../components/ui';
import { compressPhoto, enqueue, flush, onOutboxChange, queued } from '../outbox';
import { bearing, distanceMeters, windName } from '../geo';
import { falseAlarmLabel, km, statusHint, statusLabel, wib } from '../format';
import { useSession } from '../session';

const order: Status[] = ['api_aktif', 'asap_bara', 'bakar_terkendali', 'alarm_palsu', 'tidak_terjangkau'];

function Frame({ title, back, children }: { title: string; back?: string; children: React.ReactNode }) {
  const online = useOnline();
  const navigate = useNavigate();
  return (
    <div className="app">
      <header className="appbar">
        <button type="button" className="icon-btn" style={{ background: 'transparent', color: 'var(--chrome-text)' }} aria-label="Kembali" onClick={() => (back ? navigate(back) : navigate(-1))}><ChevronLeft size={20} /></button>
        <span className="heading-16">{title}</span>
      </header>
      {!online && <div className="offline-bar"><WifiOff size={16} color="var(--status-smoke)" />Tanpa sinyal · laporan disimpan di ponsel</div>}
      {children}
    </div>
  );
}

export function VerifyPage() {
  const { id } = useParams();
  const { user, ready } = useSession();
  const online = useOnline();
  const incident = useApi<IncidentDetail>(`/incidents/${id}`);
  const [status, setStatus] = useState<Status | null>(null);
  const [kind, setKind] = useState('industri');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [position, setPosition] = useState<GeolocationPosition | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [result, setResult] = useState<{ sent: boolean; at: string; clientUuid: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!('geolocation' in navigator)) { setGpsError('Perangkat ini tidak punya GPS.'); return; }
    const watch = navigator.geolocation.watchPosition(setPosition, error => setGpsError(error.code === 1 ? 'Izin lokasi ditolak. Laporan tetap bisa dikirim tanpa koordinat.' : 'Mencari sinyal GPS…'), { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 });
    return () => navigator.geolocation.clearWatch(watch);
  }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  // A report saved without a signal leaves the queue once it is sent; the page follows it.
  useEffect(() => {
    if (!result || result.sent) return;
    return onOutboxChange(() => { void queued().then(items => { if (!items.some(item => item.clientUuid === result.clientUuid)) setResult({ ...result, sent: true }); }); });
  }, [result]);
  if (ready && !user) return <Navigate to="/masuk" replace />;
  if (user && user.role !== 'mpa' && user.role !== 'admin') return <Frame title="Cek lapangan"><main className="page narrow"><Banner tone="warn">Cek lapangan dilakukan oleh relawan MPA. Masuk sebagai relawan untuk mencoba.</Banner></main></Frame>;
  const d = incident.data;
  if (!d) return <Frame title="Cek lapangan"><main className="page narrow">{incident.error ? <Banner tone="warn">{incident.error} Buka kejadian ini sekali saat ada sinyal agar tersimpan untuk dipakai tanpa sinyal.</Banner> : <div className="empty">Memuat…</div>}</main></Frame>;
  const here: [number, number] | null = position ? [position.coords.longitude, position.coords.latitude] : null;
  const dist = here ? distanceMeters(here, d.centroid) : null;
  const deg = here ? bearing(here, d.centroid) : 0;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!status) return;
    setBusy(true);
    const clientUuid = crypto.randomUUID(), observedAt = new Date().toISOString();
    await enqueue({ clientUuid, incidentId: d.id, incidentLabel: `KJD-${d.code.toUpperCase()} · Desa ${d.village?.name ?? ''}`, status, falseAlarmKind: status === 'alarm_palsu' ? kind : undefined,
      note: note.trim(), latitude: here?.[1] ?? null, longitude: here?.[0] ?? null, accuracyM: position?.coords.accuracy ?? null, observedAt, photo });
    if (navigator.onLine !== false) await flush();
    setResult({ sent: !(await queued()).some(item => item.clientUuid === clientUuid), at: observedAt, clientUuid });
    setBusy(false);
  };

  if (result) return (
    <Frame title="Cek lapangan" back={`/kejadian/${d.id}`}>
      <main className="page narrow">
        <div className={`banner ${result.sent ? 'banner-ok' : 'banner-warn'}`} style={{ padding: 16 }}>
          {result.sent ? <CircleCheck size={22} /> : <WifiOff size={22} />}
          <div style={{ display: 'grid', gap: 4 }}>
            <strong className="heading-16">{result.sent ? 'Laporan terkirim' : 'Laporan menunggu sinyal'}</strong>
            <span>{result.sent ? `Dicek pukul ${wib(result.at)} WIB. BPBD dan Daops langsung melihatnya di dasbor.` : `Dicek pukul ${wib(result.at)} WIB. Laporan terkirim sendiri begitu ada sinyal, dengan waktu cek yang asli.`}</span>
          </div>
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          <Link to={`/kejadian/${d.id}`} className="btn btn-primary btn-block">Lihat kejadian</Link>
          <Link to="/peringatan" className="btn btn-secondary btn-block">Kembali ke peringatan</Link>
        </div>
      </main>
    </Frame>
  );

  return (
    <Frame title="Cek lapangan" back={`/kejadian/${d.id}`}>
      <form className="page narrow" onSubmit={submit} style={{ paddingBottom: 0 }}>
        <div className="code-line" style={{ color: 'var(--text-2)' }}><LevelBadge level={d.level} /><span className="caption">KJD-{d.code.toUpperCase()} · {d.detectionCount} titik panas · Desa {d.village?.name}</span></div>
        <div className="target">
          <span className="bearing"><Navigation2 size={26} style={{ transform: `rotate(${deg}deg)` }} fill="currentColor" /></span>
          <div style={{ display: 'grid', gap: 2 }}>
            <span className="label on-dark">Jarak ke titik panas</span>
            <span className="number-28">{dist !== null ? km(dist) : '–'}</span>
            <span className="caption">{dist !== null ? `ke ${windName(deg)} · GPS ±${Math.round(position!.coords.accuracy)} m` : gpsError ?? 'Mencari GPS…'}</span>
          </div>
        </div>
        <span className="label">Status lapangan</span>
        <div className="card options">
          {order.map(value => (
            <label key={value} className={`option ${status === value ? 'on' : ''}`}>
              <input type="radio" name="status" value={value} checked={status === value} onChange={() => setStatus(value)} />
              <span className={`status status-${value}`} />
              <span className="text"><b>{statusLabel[value]}</b><small>{statusHint[value]}</small></span>
              <i className="radio" />
            </label>
          ))}
        </div>
        {status === 'alarm_palsu' && (
          <label className="field"><span className="label">Sumber panasnya</span>
            <select value={kind} onChange={event => setKind(event.target.value)}>{Object.entries(falseAlarmLabel).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <span className="note">Titik ini ditandai sebagai sumber panas tetap selama 30 hari, jadi deteksi berikutnya di sini tidak didahulukan.</span>
          </label>
        )}
        <label className="photo btn btn-secondary btn-block"><Camera size={16} />{photo ? 'Ganti foto' : 'Ambil foto'}
          <input type="file" accept="image/*" capture="environment" onChange={async event => { const file = event.target.files?.[0]; if (!file) return; const small = await compressPhoto(file); setPhoto(small); setPreview(URL.createObjectURL(small)); }} /></label>
        {preview && <img className="preview" src={preview} alt="Pratinjau foto" />}
        <label className="field"><span className="label">Catatan (opsional)</span>
          <textarea rows={3} maxLength={600} spellCheck={false} value={note} onChange={event => setNote(event.target.value)} placeholder="Misalnya: asap dari kanal sebelah timur, sudah dipadamkan regu." /></label>
        <p className="note">Lokasi di dalam foto dibuang di server. Pelapor tidak ditampilkan ke publik. "Bakar terkendali" dicatat sebagai fakta lapangan, bukan penilaian hukum.</p>
        <div className="submit-bar" style={{ margin: '0 -16px' }}>
          <button type="submit" className="btn btn-primary btn-block" disabled={!status || busy}><CircleCheck size={16} />{busy ? 'Menyimpan…' : online ? 'Kirim laporan' : 'Simpan, kirim saat ada sinyal'}</button>
        </div>
      </form>
    </Frame>
  );
}
