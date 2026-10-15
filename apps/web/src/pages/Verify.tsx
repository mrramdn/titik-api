import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import type { IncidentDetail, Status } from '../api';
import { Shell } from '../components/Shell';
import { Banner, LevelBadge, useApi, useOnline } from '../components/ui';
import { compressPhoto, enqueue, flush, queued } from '../outbox';
import { bearing, distanceMeters, windName } from '../geo';
import { falseAlarmLabel, km, statusHint, statusLabel, wib } from '../format';
import { useSession } from '../session';

const order: Status[] = ['api_aktif', 'asap_bara', 'bakar_terkendali', 'alarm_palsu', 'tidak_terjangkau'];

export function VerifyPage() {
  const { id } = useParams();
  const { user, ready } = useSession();
  const navigate = useNavigate();
  const online = useOnline();
  const incident = useApi<IncidentDetail>(`/incidents/${id}`);
  const [status, setStatus] = useState<Status | null>(null);
  const [kind, setKind] = useState('industri');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [position, setPosition] = useState<GeolocationPosition | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [result, setResult] = useState<{ sent: boolean; at: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!('geolocation' in navigator)) { setGpsError('Perangkat ini tidak punya GPS.'); return; }
    const watch = navigator.geolocation.watchPosition(setPosition, error => setGpsError(error.code === 1 ? 'Izin lokasi ditolak. Laporan tetap bisa dikirim tanpa koordinat.' : 'Mencari sinyal GPS…'),
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 });
    return () => navigator.geolocation.clearWatch(watch);
  }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  if (ready && !user) return <Navigate to="/masuk" replace />;
  if (user && user.role !== 'mpa' && user.role !== 'admin') return <Shell><div className="page narrow"><Banner tone="warn">Cek lapangan dilakukan oleh relawan MPA. Masuk sebagai relawan untuk mencoba.</Banner></div></Shell>;
  const data = incident.data;
  if (!data) return <Shell><div className="page narrow">{incident.error ? <Banner tone="warn">{incident.error} Buka kejadian ini sekali saat ada sinyal agar tersimpan untuk dipakai tanpa sinyal.</Banner> : <p className="muted">Memuat…</p>}</div></Shell>;

  const here: [number, number] | null = position ? [position.coords.longitude, position.coords.latitude] : null;
  const distance = here ? distanceMeters(here, data.centroid) : null;
  const direction = here ? windName(bearing(here, data.centroid)) : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!status) return;
    setBusy(true);
    const clientUuid = crypto.randomUUID();
    const observedAt = new Date().toISOString();
    await enqueue({ clientUuid, incidentId: data.id, incidentLabel: `KJD-${data.code.toUpperCase()} · Desa ${data.village?.name ?? ''}`, status,
      falseAlarmKind: status === 'alarm_palsu' ? kind : undefined, note: note.trim(), latitude: here?.[1] ?? null, longitude: here?.[0] ?? null,
      accuracyM: position?.coords.accuracy ?? null, observedAt, photo });
    if (navigator.onLine !== false) await flush();
    const stillQueued = (await queued()).some(item => item.clientUuid === clientUuid);
    setResult({ sent: !stillQueued, at: observedAt });
    setBusy(false);
  };

  if (result) {
    return (
      <Shell>
        <div className="page narrow done">
          <p className="kicker">{result.sent ? 'Terkirim' : 'Tersimpan di ponsel'}</p>
          <h1>{result.sent ? 'Laporan diterima.' : 'Laporan menunggu sinyal.'}</h1>
          <p className="lead">{result.sent
            ? `Dicek pukul ${wib(result.at)} WIB. BPBD/Daops langsung melihatnya di dasbor.`
            : `Dicek pukul ${wib(result.at)} WIB. Laporan terkirim otomatis begitu ada sinyal, dengan waktu cek yang asli.`}</p>
          <div className="row">
            <Link className="btn btn-primary" to={`/kejadian/${data.id}`}>Lihat kejadian</Link>
            <button type="button" className="btn" onClick={() => navigate('/peringatan')}>Kembali ke peringatan</button>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <form className="page narrow verify" onSubmit={submit}>
        <p className="kicker mono">Cek lapangan · KJD-{data.code.toUpperCase()}</p>
        <h1>Apa yang Anda lihat?</h1>
        <div className="target">
          <LevelBadge level={data.level} />
          <div>
            <b>{data.detectionCount} titik panas · Desa {data.village?.name}</b>
            <span className="mono">{data.centroid[1].toFixed(5)}, {data.centroid[0].toFixed(5)}</span>
          </div>
          <div className="compass">{distance !== null ? <><strong>{km(distance)}</strong><span>ke {direction}</span></> : <span>{gpsError ?? 'Mencari GPS…'}</span>}</div>
        </div>
        {!online && <Banner tone="warn">Tanpa sinyal. Laporan disimpan di ponsel dan terkirim otomatis nanti. GPS tetap bekerja.</Banner>}
        <fieldset className="statuses">
          <legend>Status lapangan</legend>
          {order.map(value => (
            <label key={value} className={`status status-${value} ${status === value ? 'on' : ''}`}>
              <input type="radio" name="status" value={value} checked={status === value} onChange={() => setStatus(value)} />
              <strong>{statusLabel[value]}</strong><span>{statusHint[value]}</span>
            </label>
          ))}
        </fieldset>
        {status === 'alarm_palsu' && (
          <label className="field">Sumbernya
            <select value={kind} onChange={event => setKind(event.target.value)}>
              {Object.entries(falseAlarmLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <small>Titik ini akan ditandai sebagai sumber panas tetap selama 30 hari, jadi deteksi berikutnya di sini tidak didahulukan.</small>
          </label>
        )}
        <label className="field">Foto (opsional)
          <input type="file" accept="image/*" capture="environment" onChange={async event => {
            const file = event.target.files?.[0];
            if (!file) return;
            const small = await compressPhoto(file);
            setPhoto(small); setPreview(URL.createObjectURL(small));
          }} />
          {preview && <img className="preview" src={preview} alt="Pratinjau foto" />}
          <small>Data lokasi di dalam foto dibuang di server. Koordinat laporan hanya dari GPS di atas.</small>
        </label>
        <label className="field">Catatan (opsional)
          <textarea rows={3} maxLength={600} value={note} onChange={event => setNote(event.target.value)} placeholder="Misalnya: asap dari kanal sebelah timur, sudah dipadamkan regu." />
        </label>
        <button type="submit" className="btn btn-primary btn-big" disabled={!status || busy}>{busy ? 'Menyimpan…' : online ? 'Kirim laporan' : 'Simpan, kirim saat ada sinyal'}</button>
        <p className="fine">Pelapor tidak ditampilkan ke publik. "Bakar terkendali" dicatat sebagai fakta lapangan, bukan penilaian hukum.</p>
      </form>
    </Shell>
  );
}
