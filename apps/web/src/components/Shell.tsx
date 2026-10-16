import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router';
import { Bell, Info, LayoutDashboard, Map as MapIcon, MapPin, UserRound } from 'lucide-react';
import type { IngestStatus } from '../api';
import { useSession } from '../session';
import { flush, onOutboxChange, queued, type QueuedReport } from '../outbox';
import { roleLabel, satelliteLabel, wib, wibDay } from '../format';
import { shortProvince, useRegion } from '../region';
import { LogoMark } from './Logo';
import { useApi, useOnline } from './ui';

function OutboxBar() {
  const [items, setItems] = useState<QueuedReport[]>([]);
  const online = useOnline();
  useEffect(() => { const load = () => { void queued().then(setItems); }; load(); return onOutboxChange(load); }, []);
  const waiting = items.filter(item => !item.rejected), rejected = items.filter(item => item.rejected);
  if (!items.length && online) return null;
  return (
    <div className="outbox" role="status">
      {!online && <strong className="warn">Tanpa sinyal · laporan disimpan di ponsel</strong>}
      {waiting.length > 0 && <span><strong>{waiting.length}</strong> laporan menunggu sinyal · antre sejak {wib(waiting[0]!.queuedAt)}</span>}
      {rejected.length > 0 && <span className="bad">{rejected.length} laporan ditolak: {rejected[0]!.lastError}</span>}
      {waiting.length > 0 && online && <button type="button" className="btn btn-dark btn-sm" onClick={() => void flush()}>Kirim sekarang</button>}
    </div>
  );
}

function Freshness() {
  const status = useApi<IngestStatus>('/ingest/status');
  const latest = status.data?.satellites.filter(s => s.latestAcquisition).sort((a, b) => b.latestAcquisition!.localeCompare(a.latestAcquisition!))[0];
  if (!latest?.latestAcquisition) return null;
  const acquired = latest.latestAcquisition;
  const old = Date.now() - new Date(acquired).getTime() > 12 * 3600_000;
  return <span className="freshness" title="Lintasan satelit terbaru yang sudah dirilis NASA FIRMS"><i className={`live-dot ${old ? 'stale' : ''}`} />{satelliteLabel[latest.satellite] ?? latest.satellite} · {old ? wibDay(acquired) : wib(acquired)} WIB</span>;
}

export function Shell({ children }: { children: ReactNode }) {
  const { user, signOut } = useSession();
  const { provinces, province, setProvince } = useRegion();
  const navigate = useNavigate();
  const links = [
    { to: '/', label: 'Peta', icon: MapIcon, end: true, show: true },
    { to: '/peringatan', label: 'Peringatan', icon: Bell, show: user?.role === 'mpa' || user?.role === 'kades' },
    { to: '/desa-saya', label: 'Desa saya', icon: MapPin, show: Boolean(user) && user?.role !== 'bpbd' },
    { to: '/dasbor', label: 'Dasbor', icon: LayoutDashboard, show: user?.role === 'bpbd' || user?.role === 'admin' },
    { to: '/tentang', label: 'Tentang', icon: Info, show: true },
  ].filter(link => link.show);
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand" aria-label="Titik Api, peta"><LogoMark />Titik Api</Link>
        <label className="region-chip"><MapPin size={14} className="icon" />
          <select value={province} onChange={event => setProvince(event.target.value)} aria-label="Wilayah">
            <option value="">Sumsel + Kalteng</option>
            {provinces.map(p => <option key={p.name} value={p.name}>{shortProvince(p.name)} · {p.villages.toLocaleString('id-ID')} desa</option>)}
          </select>
        </label>
        <Freshness />
        <nav className="topnav">
          {links.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}><Icon size={16} />{label}</NavLink>)}
        </nav>
        <div className="account">
          {user ? <><UserRound size={16} /><span>{user.name}</span><button type="button" onClick={async () => { await signOut(); navigate('/'); }}>Keluar</button></>
            : <Link to="/masuk" className="btn btn-primary btn-sm">Masuk</Link>}
        </div>
      </header>
      <OutboxBar />
      {children}
      <nav className="tabbar" aria-label="Navigasi">
        {links.slice(0, 4).map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}><Icon size={20} />{label}</NavLink>)}
        {!user && <NavLink to="/masuk"><UserRound size={20} />Masuk</NavLink>}
      </nav>
    </div>
  );
}
export { roleLabel };
