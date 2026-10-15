import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router';
import { useSession } from '../session';
import { flush, onOutboxChange, queued, type QueuedReport } from '../outbox';
import { roleLabel, wib } from '../format';
import { useOnline } from './ui';

function OutboxBar() {
  const [items, setItems] = useState<QueuedReport[]>([]);
  const online = useOnline();
  useEffect(() => {
    const load = () => { void queued().then(setItems); };
    load();
    return onOutboxChange(load);
  }, []);
  const waiting = items.filter(item => !item.rejected);
  const rejected = items.filter(item => item.rejected);
  if (!items.length && online) return null;
  return (
    <div className={`outbox ${online ? '' : 'outbox-offline'}`} role="status">
      {!online && <span className="outbox-signal">Tanpa sinyal · laporan disimpan di ponsel</span>}
      {waiting.length > 0 && <span><b>{waiting.length}</b> laporan menunggu sinyal{waiting[0]?.lastError ? ` · dicoba ${waiting[0].attempts}×` : ''} · antre sejak {wib(waiting[0]!.queuedAt)}</span>}
      {rejected.length > 0 && <span className="outbox-rejected">{rejected.length} laporan ditolak server: {rejected[0]!.lastError}</span>}
      {waiting.length > 0 && online && <button type="button" className="btn btn-small" onClick={() => void flush()}>Kirim sekarang</button>}
    </div>
  );
}

export function Shell({ children, full }: { children: ReactNode; full?: boolean }) {
  const { user, signOut } = useSession();
  const navigate = useNavigate();
  const links = [
    { to: '/', label: 'Peta', end: true, show: true },
    { to: '/peringatan', label: 'Peringatan', show: user?.role === 'mpa' || user?.role === 'kades' },
    { to: '/desa-saya', label: 'Desa saya', show: Boolean(user) && user?.role !== 'bpbd' },
    { to: '/dasbor', label: 'Dasbor', show: user?.role === 'bpbd' || user?.role === 'admin' },
    { to: '/tentang', label: 'Tentang', show: true },
  ].filter(link => link.show);
  return (
    <div className={`shell ${full ? 'shell-full' : ''}`}>
      <header className="topbar">
        <Link to="/" className="brand" aria-label="Titik Api, beranda">
          <img src="/favicon.svg" alt="" width="30" height="30" />
          <span className="brand-name">Titik Api</span>
          <span className="brand-tag mono">OKI · pilot</span>
        </Link>
        <nav className="nav">
          {links.map(link => <NavLink key={link.to} to={link.to} end={link.end} className={({ isActive }) => (isActive ? 'active' : '')}>{link.label}</NavLink>)}
        </nav>
        <div className="account">
          {user ? (
            <>
              <span className="account-chip"><b>{user.name}</b><small>{roleLabel[user.role]}{user.demo ? ' · akun demo' : ''}</small></span>
              <button type="button" className="btn btn-ghost btn-small" onClick={async () => { await signOut(); navigate('/'); }}>Keluar</button>
            </>
          ) : <Link to="/masuk" className="btn btn-primary btn-small">Masuk</Link>}
        </div>
      </header>
      <OutboxBar />
      <main className="main">{children}</main>
      <nav className="tabbar" aria-label="Navigasi utama">
        {links.map(link => <NavLink key={link.to} to={link.to} end={link.end} className={({ isActive }) => (isActive ? 'active' : '')}>{link.label}</NavLink>)}
      </nav>
    </div>
  );
}
