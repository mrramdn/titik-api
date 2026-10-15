import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { Bell, BellOff, Share2 } from 'lucide-react';
import { api, type Alert } from '../api';
import { Shell } from '../components/Shell';
import { Banner, FlameTile, LevelBadge, shareCard } from '../components/ui';
import { currentSubscription, disablePush, enablePush, pushSupported } from '../push';
import { satellites, wib } from '../format';
import { useSession } from '../session';

function PushRow() {
  const [on, setOn] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void currentSubscription().then(s => setOn(Boolean(s))).catch(() => setOn(false)); }, []);
  const run = async (work: () => Promise<unknown>, done: string) => { setBusy(true); setMessage(null); try { await work(); setMessage(done); } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); } };
  return (
    <div className="push-row">
      {on ? <Bell size={18} color="var(--status-checked)" /> : <BellOff size={18} color="var(--text-3)" />}
      <div className="grow"><span>{on ? 'Notifikasi aktif di perangkat ini' : 'Notifikasi belum aktif'}</span><small>{message ?? 'Kartu baru masuk walau aplikasi tertutup (Chrome Android, desktop; iPhone setelah dipasang ke layar utama).'}</small></div>
      {!pushSupported() ? null : on
        ? <><button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => api('/me/push/test', { method: 'POST' }), 'Notifikasi uji dikirim. Periksa bilah notifikasi.')}>Uji</button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(async () => { await disablePush(); setOn(false); }, 'Notifikasi dimatikan.')}>Matikan</button></>
        : <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(async () => { await enablePush(); setOn(true); }, 'Notifikasi aktif di perangkat ini.')}>Aktifkan</button>}
    </div>
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
  const shown = (alerts ?? []).filter(a => filter === 'all' || !a.incident.firstVerifiedAt);
  const share = async (alert: Alert) => { if (await shareCard(alert.card, alert.incident.sharePath)) await api(`/me/alerts/${alert.id}/shared`, { method: 'POST' }).catch(() => {}); void load(); };
  return (
    <Shell>
      <main className="page narrow">
        <div className="page-head">
          <div><h1 className="title-24">Peringatan</h1><p>Kartu titik panas prioritas sedang dan tinggi untuk desa yang Anda pantau.</p></div>
          <Link to="/desa-saya" className="btn btn-secondary btn-sm">Atur desa</Link>
        </div>
        <PushRow />
        <div className="segmented">
          <button type="button" className={`chip ${filter === 'open' ? 'on' : ''}`} onClick={() => setFilter('open')}>Belum dicek · {(alerts ?? []).filter(a => !a.incident.firstVerifiedAt).length}</button>
          <button type="button" className={`chip ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>Semua</button>
        </div>
        {error && <Banner tone="warn">{error}{alerts ? ' Menampilkan salinan terakhir.' : ''}</Banner>}
        <div className="card list-card">
          {alerts && !shown.length && <div className="empty">{filter === 'open' ? 'Semua kartu sudah dicek.' : 'Belum ada kartu.'} <Link to="/desa-saya" className="link">Atur desa</Link></div>}
          {shown.slice(0, limit).map(alert => (
            <div key={alert.id} className="alert-row">
              <FlameTile level={alert.incident.level} checked={Boolean(alert.incident.firstVerifiedAt)} size={20} />
              <Link to={`/kejadian/${alert.incident.id}`} className="main">
                <span className="title">{alert.incident.detectionCount} titik panas · Desa {alert.village.name}</span>
                <span className="summary">{alert.card.split(' · ').slice(1, 3).join(' · ')}</span>
                <span className="meta"><LevelBadge level={alert.incident.level} />{wib(alert.incident.lastDetectedAt)} WIB · {satellites(alert.incident.satellites)}{alert.sharedAt ? ' · dibagikan' : ''}</span>
              </Link>
              <div className="side">{!alert.readAt ? <i className="unread-dot" /> : <span />}
                <button type="button" className="icon-btn" aria-label="Bagikan ke WhatsApp" onClick={() => void share(alert)}><Share2 size={16} /></button></div>
            </div>
          ))}
        </div>
        {shown.length > limit && <button type="button" className="btn btn-secondary" onClick={() => setLimit(limit + 15)}>Tampilkan {Math.min(15, shown.length - limit)} kartu lagi</button>}
      </main>
    </Shell>
  );
}
