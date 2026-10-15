import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { api, type Alert } from '../api';
import { Shell } from '../components/Shell';
import { Ticket } from '../components/Ticket';
import { Banner, Empty } from '../components/ui';
import { currentSubscription, disablePush, enablePush, pushSupported } from '../push';
import { useSession } from '../session';

function PushCard() {
  const [on, setOn] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void currentSubscription().then(subscription => setOn(Boolean(subscription))).catch(() => setOn(false)); }, []);
  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true); setMessage(null);
    try { await work(); setMessage(done); } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  };
  return (
    <section className="pushcard">
      <div>
        <h2>Notifikasi ke ponsel</h2>
        <p>Kartu baru masuk sebagai notifikasi walau aplikasi tertutup. Berjalan di Chrome Android dan peramban desktop; di iPhone setelah dipasang ke layar utama.</p>
        {message && <p className="pushcard-msg" role="status">{message}</p>}
      </div>
      <div className="pushcard-actions">
        {!pushSupported() ? <span className="muted">Peramban ini belum mendukung push.</span> : on ? (
          <>
            <button type="button" className="btn btn-small" disabled={busy} onClick={() => run(() => api('/me/push/test', { method: 'POST' }), 'Notifikasi uji dikirim. Periksa bilah notifikasi.')}>Kirim notifikasi uji</button>
            <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => run(async () => { await disablePush(); setOn(false); }, 'Notifikasi dimatikan.')}>Matikan</button>
          </>
        ) : <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => run(async () => { await enablePush(); setOn(true); }, 'Notifikasi aktif di perangkat ini.')}>Aktifkan notifikasi</button>}
      </div>
    </section>
  );
}

export function AlertsPage() {
  const { user, ready } = useSession();
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [limit, setLimit] = useState(15);
  const load = () => api<{ data: Alert[] }>('/me/alerts').then(body => { setAlerts(body.data); setError(null); }).catch(failure => setError(failure.message));
  useEffect(() => { if (user) void load(); }, [user?.id]);
  if (ready && !user) return <Navigate to="/masuk" replace />;
  const shown = (alerts ?? []).filter(alert => filter === 'all' || !alert.incident.firstVerifiedAt);
  return (
    <Shell>
      <div className="page">
        <div className="page-head">
          <div>
            <p className="kicker">Peringatan desa</p>
            <h1>Kartu titik panas untuk desa Anda.</h1>
            <p className="lead">Hanya kejadian prioritas sedang dan tinggi yang dikirim sebagai kartu. Yang rendah tetap terlihat di peta.</p>
          </div>
          <Link to="/desa-saya" className="btn">Atur desa</Link>
        </div>
        <PushCard />
        <div className="segmented" role="group" aria-label="Saring kartu">
          <button type="button" className={filter === 'open' ? 'on' : ''} onClick={() => setFilter('open')}>Belum dicek</button>
          <button type="button" className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>Semua</button>
        </div>
        {error && <Banner tone="warn">{error}{alerts ? ' Menampilkan salinan terakhir.' : ''}</Banner>}
        {alerts && !shown.length && (
          <Empty title={filter === 'open' ? 'Semua kartu sudah dicek.' : 'Belum ada kartu.'}>
            <p>Kartu muncul saat satelit menangkap titik panas prioritas sedang atau tinggi di desa yang Anda pantau. <Link to="/desa-saya">Atur desa</Link>.</p>
          </Empty>
        )}
        <div className="tickets">
          {shown.slice(0, limit).map(alert => <Ticket key={alert.id} alert={alert} canVerify={user?.role === 'mpa' || user?.role === 'admin'} onChange={() => void load()} />)}
        </div>
        {shown.length > limit && <button type="button" className="btn" style={{ marginTop: 14 }} onClick={() => setLimit(limit + 15)}>Tampilkan {Math.min(15, shown.length - limit)} kartu lagi ({shown.length - limit} tersisa)</button>}
      </div>
    </Shell>
  );
}
