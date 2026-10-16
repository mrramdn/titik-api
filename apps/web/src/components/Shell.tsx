import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { ChevronDown, ClipboardList, FileText, Info, LayoutDashboard, LogOut, Mail, Map as MapIcon, MapPin, UserRound, X, type LucideIcon } from 'lucide-react';
import type { Role } from '../api';
import { dict, useT } from '../i18n';
import { useFormat } from '../format';
import { useSession } from '../session';
import { flush, onOutboxChange, queued, type QueuedReport } from '../outbox';
import { shortProvince, useRegion } from '../region';
import { LogoMark } from './Logo';
import { useOnline } from './ui';
import { Freshness } from './shell/Freshness';
import { LangSwitch } from './shell/LangSwitch';
import { RoleList, roleText, useSignOutToMap } from './shell/roles';
import { usePopover } from './shell/popover';

const text = dict({
  id: {
    home: 'Titik Api, ke peta', region: 'Wilayah', allRegions: 'Sumsel + Kalteng', villages: '{n} desa',
    map: 'Peta', tasks: 'Tugas', myVillage: 'Desa saya', dashboard: 'Dasbor', recap: 'Rekap', about: 'Tentang', nav: 'Navigasi',
    account: 'Akun', role: 'Peran', language: 'Bahasa', emailSignIn: 'Masuk dengan email', signOut: 'Keluar', demoAccount: 'Akun demo', close: 'Tutup',
    offline: 'Tanpa sinyal. Laporan disimpan di ponsel.', waitingOne: '{n} laporan menunggu sinyal sejak {time}.', waitingMany: '{n} laporan menunggu sinyal sejak {time}.',
    rejectedOne: '{n} laporan ditolak: {error}', rejectedMany: '{n} laporan ditolak: {error}', sendNow: 'Kirim sekarang',
  },
  en: {
    home: 'Titik Api, to the map', region: 'Region', allRegions: 'Sumsel + Kalteng', villages: '{n} villages',
    map: 'Map', tasks: 'Tasks', myVillage: 'My village', dashboard: 'Dashboard', recap: 'Recap', about: 'About', nav: 'Navigation',
    account: 'Account', role: 'Role', language: 'Language', emailSignIn: 'Sign in with email', signOut: 'Sign out', demoAccount: 'Demo account', close: 'Close',
    offline: 'No signal. Reports are saved on this phone.', waitingOne: '{n} report waiting for signal since {time}.', waitingMany: '{n} reports waiting for signal since {time}.',
    rejectedOne: '{n} report rejected: {error}', rejectedMany: '{n} reports rejected: {error}', sendNow: 'Send now',
  },
});
type Key = keyof typeof text.id;

interface NavItem { to: string; key: Key; icon: LucideIcon; roles?: Role[] }
const navItems: NavItem[] = [
  { to: '/', key: 'map', icon: MapIcon },
  { to: '/tugas', key: 'tasks', icon: ClipboardList, roles: ['mpa'] },
  { to: '/desa-saya', key: 'myVillage', icon: MapPin, roles: ['mpa', 'kades'] },
  { to: '/dasbor', key: 'dashboard', icon: LayoutDashboard, roles: ['bpbd', 'admin'] },
  { to: '/rekap', key: 'recap', icon: FileText, roles: ['bpbd', 'admin'] },
  { to: '/tentang', key: 'about', icon: Info },
];
/** Peta, the role's own pages, Tentang: at most four, so the phone tab bar has room for the account. */
const navFor = (role: Role | undefined) => navItems.filter(item => !item.roles || (role && item.roles.includes(role))).slice(0, 4);
/** The map tab stays active while an incident is open in its sidebar. */
const onMap = (path: string) => path === '/' || path.startsWith('/k/') || (path.startsWith('/kejadian/') && !path.endsWith('/cek'));

function OutboxBar() {
  const t = useT(text), f = useFormat();
  const [items, setItems] = useState<QueuedReport[]>([]);
  const online = useOnline();
  useEffect(() => { const load = () => { void queued().then(setItems); }; load(); return onOutboxChange(load); }, []);
  const waiting = items.filter(item => !item.rejected), rejected = items.filter(item => item.rejected);
  if (!items.length && online) return null;
  return (
    <div className="outbox" role="status">
      {!online && <strong className="warn">{t('offline')}</strong>}
      {waiting.length > 0 && <span>{t(waiting.length === 1 ? 'waitingOne' : 'waitingMany', { n: waiting.length, time: f.time(waiting[0]!.queuedAt) })}</span>}
      {rejected.length > 0 && <span className="bad">{t(rejected.length === 1 ? 'rejectedOne' : 'rejectedMany', { n: rejected.length, error: rejected[0]!.lastError ?? '' })}</span>}
      {waiting.length > 0 && online && <button type="button" className="btn btn-dark btn-sm" onClick={() => void flush()}>{t('sendNow')}</button>}
    </div>
  );
}

function RegionSelect() {
  const t = useT(text), f = useFormat();
  const { provinces, province, setProvince } = useRegion();
  return (
    <label className="region-chip"><MapPin size={14} className="icon" aria-hidden="true" />
      <select value={province} onChange={event => setProvince(event.target.value)} aria-label={t('region')}>
        <option value="">{t('allRegions')}</option>
        {provinces.map(p => <option key={p.name} value={p.name}>{shortProvince(p.name)} · {t('villages', { n: f.num(p.villages) })}</option>)}
      </select>
      <ChevronDown size={14} className="icon region-caret" aria-hidden="true" />
    </label>
  );
}

/** Who is signed in, with email sign-in or sign-out; under the role list in the menu and the phone sheet. */
function AccountFoot({ onDone }: { onDone?: () => void }) {
  const t = useT(text);
  const { user } = useSession();
  const signOutToMap = useSignOutToMap();
  if (user && !user.demo) {
    return (
      <div className="acct-foot">
        <span className="acct-name"><UserRound size={16} className="icon" aria-hidden="true" />{user.name}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { onDone?.(); signOutToMap(); }}><LogOut size={16} />{t('signOut')}</button>
      </div>
    );
  }
  return (
    <div className="acct-foot">
      {user && <span className="acct-name"><UserRound size={16} className="icon" aria-hidden="true" />{user.name}<small>{t('demoAccount')}</small></span>}
      <Link to="/masuk" className="acct-link" onClick={onDone}><Mail size={16} className="icon" aria-hidden="true" />{t('emailSignIn')}</Link>
    </div>
  );
}

/** "Lihat sebagai" in the top bar: the current role, and a menu with the four roles. */
function RoleMenu() {
  const t = useT(roleText), f = useFormat();
  const { user } = useSession();
  const { open, toggle, setOpen, root } = usePopover();
  return (
    <div className="rolemenu" ref={root}>
      <button type="button" className="rolemenu-btn" aria-haspopup="dialog" aria-expanded={open} onClick={toggle}>
        <span className="rolemenu-label">{t('viewAs')}</span><b>{f.role(user ? user.role : 'public')}</b><ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="rolemenu-pop" role="dialog" aria-label={t('viewAs')}>
          <h3 className="rolemenu-title">{t('viewAs')}</h3>
          <RoleList onDone={() => setOpen(false)} />
          <AccountFoot onDone={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

/** Phone and tablet: the account tab opens a sheet with the roles, the language and sign-in. */
function AccountSheet({ onClose }: { onClose(): void }) {
  const t = useT(text), r = useT(roleText);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);
  return (
    <div className="sheet-wrap">
      <button type="button" className="sheet-backdrop" aria-label={t('close')} onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={r('viewAs')}>
        <div className="sheet-head"><h2 className="heading-16">{r('viewAs')}</h2><button type="button" className="icon-btn" aria-label={t('close')} onClick={onClose}><X size={18} /></button></div>
        <RoleList onDone={onClose} />
        <div className="sheet-row"><span>{t('language')}</span><LangSwitch /></div>
        <AccountFoot onDone={onClose} />
      </div>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const t = useT(text);
  const { user } = useSession();
  const { pathname } = useLocation();
  const [sheet, setSheet] = useState(false);
  const links = navFor(user?.role);
  const active = (to: string) => (to === '/' ? onMap(pathname) : pathname === to || pathname.startsWith(`${to}/`));
  useEffect(() => setSheet(false), [pathname]);
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand" aria-label={t('home')}><LogoMark /><span className="brand-name">Titik Api</span></Link>
        <RegionSelect />
        <Freshness />
        <nav className="topnav" aria-label={t('nav')}>
          {links.map(({ to, key, icon: Icon }) => <Link key={to} to={to} className={active(to) ? 'active' : ''} aria-current={active(to) ? 'page' : undefined}><Icon size={16} aria-hidden="true" />{t(key)}</Link>)}
        </nav>
        <div className="topbar-end">
          <RoleMenu />
          <LangSwitch className="on-dark" />
        </div>
      </header>
      <OutboxBar />
      {children}
      <nav className="tabbar" aria-label={t('nav')}>
        {links.map(({ to, key, icon: Icon }) => <Link key={to} to={to} className={active(to) ? 'active' : ''} aria-current={active(to) ? 'page' : undefined}><Icon size={20} aria-hidden="true" />{t(key)}</Link>)}
        <button type="button" className={sheet ? 'active' : ''} aria-haspopup="dialog" aria-expanded={sheet} onClick={() => setSheet(true)}><UserRound size={20} aria-hidden="true" />{user && !user.demo ? t('account') : t('role')}</button>
      </nav>
      {sheet && <AccountSheet onClose={() => setSheet(false)} />}
    </div>
  );
}
