// Field check: the way to the nearest hotspot of the incident, then what the volunteer found. Works without a
// signal for any incident opened (or prefetched on /tugas) while online; the report waits in the outbox.
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { Camera, Check, ChevronLeft, CircleCheck, Clock, CloudOff, Compass, Copy, Navigation2, TriangleAlert } from 'lucide-react';
import type { IncidentDetail, Status } from '../api';
import { Banner, LevelBadge, RouteButton, useApi, useOnline } from '../components/ui';
import { rememberCheck } from '../components/volunteer/myChecks';
import { useHeading, useTurn } from '../components/volunteer/useHeading';
import { useFormat } from '../format';
import { bearing, coordText, nearestPoint } from '../geo';
import { dict, useT } from '../i18n';
import { falseAlarmLabel } from '../i18n/common';
import { compressPhoto, enqueue, flush, onOutboxChange, queued } from '../outbox';
import { useSession } from '../session';

const text = dict({
  id: {
    title: 'Cek lapangan', back: 'Kembali', offline: 'Tanpa sinyal. Laporan disimpan di ponsel dan terkirim saat ada sinyal.',
    roleOnly: 'Cek lapangan diisi oleh relawan MPA. Masuk dengan akun relawan MPA untuk mengisinya.',
    loading: 'Memuat kejadian…', notSaved: 'Kejadian ini belum tersimpan di ponsel. Buka sekali saat ada sinyal agar bisa dicek tanpa sinyal.',
    toTasks: 'Kembali ke tugas', viewIncident: 'Lihat kejadian', village: 'Desa {name}', hotspots: '{n} titik panas', hotspot: '1 titik panas',
    distance: 'Jarak ke titik panas terdekat', toward: 'ke {dir}', gps: 'GPS ±{m}', compass: 'panah mengikuti kompas', northUp: 'utara di atas',
    noGps: 'Perangkat ini tidak punya GPS.', denied: 'Izin lokasi ditolak. Laporan tetap bisa dikirim tanpa koordinat.', searching: 'Mencari sinyal GPS…',
    useCompass: 'Pakai kompas', north: 'U', uncertain: 'Lokasi titik panas ±{km}.',
    nearestPoint: 'Titik terdekat', centre: 'Pusat kejadian', copy: 'Salin', copyLabel: 'Salin koordinat', copied: 'Disalin',
    status: 'Kondisi di lapangan', source: 'Sumber panas',
    sourceNote: 'Lokasi ini dicatat sebagai sumber panas tetap selama 30 hari. Titik panas berikutnya di sini mendapat prioritas lebih rendah.',
    photo: 'Ambil foto', photoAgain: 'Ganti foto', preview: 'Pratinjau foto',
    note: 'Catatan (opsional)', notePlaceholder: 'Misalnya: asap dari kanal sebelah timur, sudah dipadamkan regu.',
    privacy: 'Server menghapus data lokasi di dalam foto. Nama pelapor hanya terlihat oleh tim yang masuk. Bakar terkendali dicatat sebagai kondisi di lapangan.',
    send: 'Kirim laporan', save: 'Simpan, kirim saat ada sinyal', saving: 'Menyimpan…', pick: 'Pilih kondisi di lapangan untuk mengirim.',
    sent: 'Laporan terkirim', sentBody: 'Dicek pukul {time} WIB. BPBD/Daops melihatnya di dasbor.',
    queued: 'Menunggu sinyal, dikirim otomatis', queuedBody: 'Dicek pukul {time} WIB. Laporan tersimpan di ponsel ini dan terkirim saat ada sinyal, dengan waktu cek ini.',
    rejected: 'Laporan ditolak server', rejectedBody: '{reason} Periksa isian lalu kirim ulang dari halaman kejadian.',
  },
  en: {
    title: 'Field check', back: 'Back', offline: 'No signal. The report is saved on this phone and sent when there is signal.',
    roleOnly: 'Field checks are filed by MPA volunteers. Sign in with an MPA volunteer account to file one.',
    loading: 'Loading the incident…', notSaved: 'This incident is not saved on this phone yet. Open it once with signal to check it without signal.',
    toTasks: 'Back to tasks', viewIncident: 'View incident', village: '{name}', hotspots: '{n} hotspots', hotspot: '1 hotspot',
    distance: 'Distance to the nearest hotspot', toward: 'to the {dir}', gps: 'GPS ±{m}', compass: 'arrow follows the compass', northUp: 'north is up',
    noGps: 'This device has no GPS.', denied: 'Location permission denied. You can still send the report without coordinates.', searching: 'Looking for GPS…',
    useCompass: 'Use compass', north: 'N', uncertain: 'Hotspot location ±{km}.',
    nearestPoint: 'Nearest point', centre: 'Incident centre', copy: 'Copy', copyLabel: 'Copy coordinates', copied: 'Copied',
    status: 'What you found', source: 'Heat source',
    sourceNote: 'This spot is recorded as a fixed heat source for 30 days. Later hotspots here get a lower priority.',
    photo: 'Take photo', photoAgain: 'Replace photo', preview: 'Photo preview',
    note: 'Note (optional)', notePlaceholder: 'For example: smoke from the canal to the east, put out by the crew.',
    privacy: 'The server removes location data from photos. Only signed-in teams see the reporter\'s name. A controlled burn is recorded as what you saw on site.',
    send: 'Send report', save: 'Save, send when there is signal', saving: 'Saving…', pick: 'Choose what you found to send.',
    sent: 'Report sent', sentBody: 'Checked at {time} WIB. BPBD/Daops see it on the dashboard.',
    queued: 'Waiting for signal, sent automatically', queuedBody: 'Checked at {time} WIB. The report is saved on this phone and goes out when there is signal, with this check time.',
    rejected: 'The server refused the report', rejectedBody: '{reason} Check the form and send it again from the incident page.',
  },
});

const order: Status[] = ['api_aktif', 'asap_bara', 'bakar_terkendali', 'alarm_palsu', 'tidak_terjangkau'];
const falseAlarmKinds = Object.keys(falseAlarmLabel.id);

function Frame({ children, fallback = '/tugas' }: { children: ReactNode; fallback?: string }) {
  const t = useT(text);
  const online = useOnline();
  const navigate = useNavigate();
  // Back to where the volunteer came from; a link opened from a notification has no history, so it goes to the tasks.
  const back = () => ((window.history.state as { idx?: number } | null)?.idx ? navigate(-1) : navigate(fallback));
  return (
    <div className="app v-verify">
      <header className="appbar">
        <button type="button" className="icon-btn v-appbar-btn" aria-label={t('back')} onClick={back}><ChevronLeft size={20} /></button>
        <span className="heading-16">{t('title')}</span>
      </header>
      {!online && <div className="offline-bar" role="status"><CloudOff size={16} aria-hidden="true" />{t('offline')}</div>}
      {children}
    </div>
  );
}

async function copyText(value: string) {
  try { await navigator.clipboard.writeText(value); return true; } catch {
    const area = document.createElement('textarea');
    area.value = value; area.setAttribute('readonly', ''); area.style.position = 'fixed'; area.style.opacity = '0';
    document.body.appendChild(area); area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

/** Dark card: arrow to the nearest hotspot, distance, GPS accuracy, and the route button. */
function TargetCard({ detail, position, gpsError }: { detail: IncidentDetail; position: GeolocationPosition | null; gpsError: string | null }) {
  const t = useT(text), f = useFormat();
  const { heading, needsTap, request } = useHeading();
  const [copied, setCopied] = useState(false);
  const points = useMemo<[number, number][]>(() => (detail.detections ?? []).map(x => [x.longitude, x.latitude]), [detail.detections]);
  const here: [number, number] | null = position ? [position.coords.longitude, position.coords.latitude] : null;
  // Measured to the nearest detection, not the centroid: a fire complex can be kilometres wide.
  const nearest = here ? nearestPoint(here, points.length ? points : [detail.centroid]) : null;
  const target = nearest?.point ?? detail.centroid;
  const direction = here ? bearing(here, target) : 0;
  const arrow = useTurn(direction - (heading ?? 0));
  const rose = useTurn(-(heading ?? 0));
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(timer); }, [copied]);
  const caption = here
    ? [t('toward', { dir: f.wind(direction) }), t('gps', { m: f.km(position!.coords.accuracy) }), heading !== null ? t('compass') : t('northUp')].join(' · ')
    : gpsError ?? t('searching');
  return (
    <>
      <div className="target v-target">
        <span className="v-dial" aria-hidden="true">
          <span className="v-rose" style={{ transform: `rotate(${rose}deg)` }}><b>{t('north')}</b></span>
          <Navigation2 className="v-arrow" size={26} fill="currentColor" style={{ transform: `rotate(${here ? arrow : 0}deg)`, opacity: here ? 1 : 0.35 }} />
        </span>
        <div className="v-target-text">
          <span className="label on-dark">{t('distance')}</span>
          <span className="number-28">{nearest ? f.km(nearest.meters) : '–'}</span>
          <span className="caption">{caption}</span>
          {needsTap && <button type="button" className="v-compass" onClick={() => void request()}><Compass size={14} aria-hidden="true" />{t('useCompass')}</button>}
        </div>
        <RouteButton to={target} className="btn btn-dark btn-sm v-route" />
      </div>
      <div className="v-coords">
        <span className="v-muted">{here && points.length ? t('nearestPoint') : t('centre')}</span>
        <span className="v-coord-value">{coordText(target)}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copyText(coordText(target)).then(setCopied)} aria-label={t('copyLabel')}>
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}{copied ? t('copied') : t('copy')}
        </button>
      </div>
      {detail.modisOnly && <p className="note">{t('uncertain', { km: f.km(detail.locationUncertaintyM ?? 1000) })}</p>}
    </>
  );
}

type Result = { state: 'sent' | 'queued' | 'rejected'; at: string; clientUuid: string; reason?: string };

export function VerifyPage() {
  const { id } = useParams();
  const { user, ready } = useSession();
  const t = useT(text), f = useFormat();
  const online = useOnline();
  const incident = useApi<IncidentDetail>(`/incidents/${id}`);
  const [status, setStatus] = useState<Status | null>(null);
  const [kind, setKind] = useState(falseAlarmKinds[0]!);
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [position, setPosition] = useState<GeolocationPosition | null>(null);
  const [gpsError, setGpsError] = useState<'noGps' | 'denied' | 'searching' | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!('geolocation' in navigator)) { setGpsError('noGps'); return; }
    const watch = navigator.geolocation.watchPosition(next => { setPosition(next); setGpsError(null); },
      error => setGpsError(error.code === error.PERMISSION_DENIED ? 'denied' : 'searching'), { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 });
    return () => navigator.geolocation.clearWatch(watch);
  }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  // A report saved without a signal leaves the outbox once it is sent; the result screen follows it.
  useEffect(() => {
    if (!result || result.state !== 'queued') return;
    return onOutboxChange(() => {
      void queued().then(items => {
        const item = items.find(entry => entry.clientUuid === result.clientUuid);
        if (!item) setResult({ ...result, state: 'sent' });
        else if (item.rejected) setResult({ ...result, state: 'rejected', reason: item.lastError ?? '' });
      });
    });
  }, [result]);

  if (ready && !user) return <Navigate to="/masuk" replace />;
  if (user && user.role !== 'mpa' && user.role !== 'admin') return <Frame><main className="page narrow"><Banner tone="warn">{t('roleOnly')}</Banner></main></Frame>;
  const d = incident.data;
  if (!d) {
    return (
      <Frame>
        <main className="page narrow">
          {incident.error ? <><Banner tone="warn">{incident.error} {t('notSaved')}</Banner><Link to="/tugas" className="btn btn-secondary btn-block">{t('toTasks')}</Link></> : <div className="empty">{t('loading')}</div>}
        </main>
      </Frame>
    );
  }
  const here: [number, number] | null = position ? [position.coords.longitude, position.coords.latitude] : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!status) return;
    setBusy(true);
    const clientUuid = crypto.randomUUID(), observedAt = new Date().toISOString();
    try {
      await enqueue({ clientUuid, incidentId: d.id, incidentLabel: `KJD-${d.code.toUpperCase()}${d.village ? ` · ${d.village.name}` : ''}`, status,
        falseAlarmKind: status === 'alarm_palsu' ? kind : undefined, note: note.trim(), latitude: here?.[1] ?? null, longitude: here?.[0] ?? null,
        accuracyM: position?.coords.accuracy ?? null, observedAt, photo });
      rememberCheck(d.id, { at: observedAt, status });
      if (navigator.onLine !== false) await flush();
      const item = (await queued()).find(entry => entry.clientUuid === clientUuid);
      setResult({ clientUuid, at: observedAt, state: !item ? 'sent' : item.rejected ? 'rejected' : 'queued', reason: item?.lastError ?? undefined });
    } finally { setBusy(false); }
  };

  if (result) {
    const tone = result.state === 'sent' ? 'ok' : 'warn';
    return (
      <Frame>
        <main className="page narrow">
          <div className={`banner banner-${tone} v-result`} role="status">
            {result.state === 'sent' ? <CircleCheck size={22} aria-hidden="true" /> : result.state === 'queued' ? <Clock size={22} aria-hidden="true" /> : <TriangleAlert size={22} aria-hidden="true" />}
            <div>
              <strong className="heading-16">{t(result.state)}</strong>
              <span>{result.state === 'rejected' ? t('rejectedBody', { reason: result.reason ?? '' }) : t(result.state === 'sent' ? 'sentBody' : 'queuedBody', { time: f.time(result.at) })}</span>
            </div>
          </div>
          <div className="v-stack">
            <Link to="/tugas" className="btn btn-primary btn-block">{t('toTasks')}</Link>
            <Link to={`/kejadian/${d.id}`} className="btn btn-secondary btn-block">{t('viewIncident')}</Link>
          </div>
        </main>
      </Frame>
    );
  }

  return (
    <Frame>
      <form className="page narrow v-form" onSubmit={submit}>
        <div className="v-incident">
          <div className="v-code"><LevelBadge level={d.level} /><span className="caption">KJD-{d.code.toUpperCase()}</span></div>
          <span className="heading-16">{[d.village ? t('village', { name: d.village.name }) : null, d.detectionCount === 1 ? t('hotspot') : t('hotspots', { n: f.num(d.detectionCount) })].filter(Boolean).join(' · ')}</span>
          {d.nearestPlace && <span className="v-muted">{f.place(d.nearestPlace)}</span>}
        </div>
        <TargetCard detail={d} position={position} gpsError={gpsError ? t(gpsError) : null} />

        <fieldset className="v-fieldset">
          <legend className="label">{t('status')}</legend>
          <div className="card options">
            {order.map(value => (
              <label key={value} className={`option ${status === value ? 'on' : ''}`}>
                <input type="radio" name="status" value={value} checked={status === value} onChange={() => setStatus(value)} />
                <span className={`status status-${value}`} aria-hidden="true" />
                <span className="text"><b>{f.status(value)}</b><small>{f.statusHint(value)}</small></span>
                <i className="radio" aria-hidden="true" />
              </label>
            ))}
          </div>
        </fieldset>
        {status === 'alarm_palsu' && (
          <label className="field"><span className="label">{t('source')}</span>
            <select value={kind} onChange={event => setKind(event.target.value)}>{falseAlarmKinds.map(value => <option key={value} value={value}>{f.falseAlarm(value)}</option>)}</select>
            <span className="note">{t('sourceNote')}</span>
          </label>
        )}
        <label className="photo btn btn-secondary btn-block"><Camera size={16} aria-hidden="true" />{photo ? t('photoAgain') : t('photo')}
          <input type="file" accept="image/*" capture="environment" onChange={async event => {
            const file = event.target.files?.[0]; if (!file) return;
            const small = await compressPhoto(file); setPhoto(small); setPreview(URL.createObjectURL(small));
          }} /></label>
        {preview && <img className="preview" src={preview} alt={t('preview')} />}
        <label className="field"><span className="label">{t('note')}</span>
          <textarea rows={3} maxLength={600} spellCheck={false} autoCorrect="off" value={note} onChange={event => setNote(event.target.value)} placeholder={t('notePlaceholder')} /></label>
        <p className="note">{t('privacy')}</p>
        <div className="submit-bar v-submit">
          {!status && <span className="v-muted">{t('pick')}</span>}
          <button type="submit" className="btn btn-primary btn-block" disabled={!status || busy}><CircleCheck size={16} aria-hidden="true" />{busy ? t('saving') : online ? t('send') : t('save')}</button>
        </div>
      </form>
    </Frame>
  );
}
