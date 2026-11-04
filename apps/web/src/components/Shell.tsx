import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { ChevronDown, ClipboardList, FileText, Info, LayoutDashboard, LogOut, Mail, Map as MapIcon, MapPin, UserRound, X, type LucideIcon } from 'lucide-react';
import type { Role } from '../api';
import { dict, useT } from '../i18n';
import { useFormat } from '../format';
import { useSession } from '../session';
import { flush, onOutboxChange, outboxSignedOut, outboxView, queued, type QueuedReport } from '../outbox';
import { shortProvince, useRegion } from '../region';
import { LogoMark } from './Logo';
import { useOnline } from './ui';
import { Freshness } from './shell/Freshness';
import { LangSwitch } from './shell/LangSwitch';
import { RoleList, roleText, useSignOutToMap } from './shell/roles';
import { usePopover } from './shell/popover';
import { HOME_PATH, MAP_PATH, navActive } from '../routes';

const text = dict({
  id: {
    home: 'Titik Api, beranda', region: 'Wilayah', allRegions: 'Sumsel + Kalteng', villages: '{n} desa',
    map: 'Peta', tasks: 'Tugas', myVillage: 'Desa saya', dashboard: 'Dasbor', recap: 'Rekap', about: 'Tentang', nav: 'Navigasi',
    account: 'Akun', role: 'Peran', language: 'Bahasa', emailSignIn: 'Masuk dengan email', signOut: 'Keluar', demoAccount: 'Akun demo', close: 'Tutup', skip: 'Langsung ke isi',
    offline: 'Tanpa sinyal. Laporan disimpan di ponsel.', waitingOne: '{n} laporan menunggu sinyal sejak {time}.', waitingMany: '{n} laporan menunggu sinyal sejak {time}.',
    rejectedOne: '{n} laporan ditolak: {error}', rejectedMany: '{n} laporan ditolak: {error}', sendNow: 'Kirim sekarang',
    signInOne: '{n} laporan menunggu kamu masuk lagi.', signInMany: '{n} laporan menunggu kamu masuk lagi.',
    othersOne: '{n} laporan menunggu akun pengirimnya masuk lagi.', othersMany: '{n} laporan menunggu akun pengirimnya masuk lagi.',
  },
  en: {
    home: 'Titik Api, home', region: 'Region', allRegions: 'Sumsel + Kalteng', villages: '{n} villages',
    map: 'Map', tasks: 'Tasks', myVillage: 'My village', dashboard: 'Dashboard', recap: 'Recap', about: 'About', nav: 'Navigation',
    account: 'Account', role: 'Role', language: 'Language', emailSignIn: 'Sign in with email', signOut: 'Sign out', demoAccount: 'Demo account', close: 'Close', skip: 'Skip to content',
    offline: 'No signal. Reports are saved on this phone.', waitingOne: '{n} report waiting for signal since {time}.', waitingMany: '{n} reports waiting for signal since {time}.',
    rejectedOne: '{n} report rejected: {error}', rejectedMany: '{n} reports rejected: {error}', sendNow: 'Send now',
    signInOne: '{n} report waiting for you to sign in again.', signInMany: '{n} reports waiting for you to sign in again.',
    othersOne: '{n} report waiting for the account that filed it to sign in again.', othersMany: '{n} reports waiting for the accounts that filed them to sign in again.',
  },
});
type Key = keyof typeof text.id;

interface NavItem { to: string; key: Key; icon: LucideIcon; roles?: Role[] }
const navItems: NavItem[] = [
  { to: MAP_PATH, key: 'map', icon: MapIcon },
  { to: '/tugas', key: 'tasks', icon: ClipboardList, roles: ['mpa'] },
  { to: '/desa-saya', key: 'myVillage', icon: MapPin, roles: ['mpa', 'kades'] },
  { to: '/dasbor', key: 'dashboard', icon: LayoutDashboard, roles: ['bpbd', 'admin'] },
  { to: '/rekap', key: 'recap', icon: FileText, roles: ['bpbd', 'admin'] },
  { to: '/tentang', key: 'about', icon: Info },
];
/** Peta, the role's own pages, Tentang: at most four, so the phone tab bar has room for the account. */
const navFor = (role: Role | undefined) => navItems.filter(item => !item.roles || (role && item.roles.includes(role))).slice(0, 4);

function OutboxBar() {
  const { user } = useSession();
  const [items, setItems] = useState<QueuedReport[]>([]);
  const [signedOut, setSignedOut] = useState(outboxSignedOut);
  const online = useOnline();
  useEffect(() => { const load = () => { setSignedOut(outboxSignedOut()); void queued().then(setItems).catch(() => {}); }; load(); return onOutboxChange(load); }, []);
  return <OutboxLines items={items} viewer={user?.id ?? null} online={online} signedOut={signedOut} />;
}

/**
 * What waits on this phone, for the account signed in (`viewer`, null for a visitor): no signal, its reports waiting
 * or refused. Reports another account filed wait for that account to sign in again (outbox.ts); they show as one line,
 * their details stay theirs. `signedOut`: the server said the session ended (401).
 */
export function OutboxLines({ items, viewer, online, signedOut }: { items: QueuedReport[]; viewer: string | null; online: boolean; signedOut: boolean }) {
  const t = useT(text), f = useFormat();
  const { waiting, rejected, others } = outboxView(items, viewer);
  if (!waiting.length && !rejected.length && !others && online) return null;
  const count = (n: number, one: Key, many: Key, vars = {}) => t(n === 1 ? one : many, { n, ...vars });
  return (
    <div className="outbox" role="status">
      {!online && <strong className="warn">{t('offline')}</strong>}
      {waiting.length > 0 && <span>{signedOut ? count(waiting.length, 'signInOne', 'signInMany') : count(waiting.length, 'waitingOne', 'waitingMany', { time: f.time(waiting[0]!.queuedAt) })}</span>}
      {rejected.length > 0 && <span className="bad">{count(rejected.length, 'rejectedOne', 'rejectedMany', { error: rejected[0]!.lastError ?? '' })}</span>}
      {others > 0 && <span>{count(others, 'othersOne', 'othersMany')}</span>}
      {waiting.length > 0 && online && !signedOut && <button type="button" className="btn btn-dark btn-sm" onClick={() => void flush()}>{t('sendNow')}</button>}
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

interface ShellProps {
  children: ReactNode;
  /** False hides the satellite data status in the top bar (the map in archive mode shows a past day). */
  freshness?: boolean;
  /** False hides the region choice, which narrows the map and the lists (the landing page has neither). */
  region?: boolean;
  /** The id of the main content: a "skip to content" link comes first, for keyboards. */
  skipTo?: string;
}

export function Shell({ children, freshness = true, region = true, skipTo }: ShellProps) {
  const t = useT(text);
  const { user } = useSession();
  const { pathname } = useLocation();
  const [sheet, setSheet] = useState(false);
  const links = navFor(user?.role);
  const active = (to: string) => navActive(to, pathname);
  useEffect(() => setSheet(false), [pathname]);
  return (
    <div className="app">
      {skipTo && <a className="skip-link" href={`#${skipTo}`}>{t('skip')}</a>}
      <header className="topbar">
        <Link to={HOME_PATH} className="brand" aria-label={t('home')}><LogoMark /><span className="brand-name">Titik Api</span></Link>
        {region && <RegionSelect />}
        {freshness && <Freshness />}
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
