// "Lihat sebagai": one click signs in to a demo account (or out, for Publik) and opens that role's home.
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Check, LayoutDashboard, Landmark, Map as MapIcon, Users, type LucideIcon } from 'lucide-react';
import { dict, useT } from '../../i18n';
import { useFormat } from '../../format';
import { homeFor, useSession } from '../../session';
import { useErrorText } from '../ui';

export type ViewRole = 'public' | 'mpa' | 'kades' | 'bpbd';
export const viewRoles: { role: ViewRole; icon: LucideIcon }[] = [
  { role: 'public', icon: MapIcon }, { role: 'mpa', icon: Users }, { role: 'kades', icon: Landmark }, { role: 'bpbd', icon: LayoutDashboard },
];

export const roleText = dict({
  id: {
    viewAs: 'Lihat sebagai', public: 'Peta, daftar kejadian, dan status cek lapangan. Tanpa akun.',
    mpa: 'Tugas dari BPBD, peringatan desa, rute, dan cek lapangan.', kades: 'Ringkasan desa, peringatan, dan hasil cek lapangan.',
    bpbd: 'Dasbor, penugasan regu MPA, dan rekap harian.', busy: 'Membuka…',
  },
  en: {
    viewAs: 'View as', public: 'Map, incident list and field check status. No account.',
    mpa: 'Tasks from BPBD, village alerts, routes and field checks.', kades: 'Village summary, alerts and field check results.',
    bpbd: 'Dashboard, MPA team assignments and the daily recap.', busy: 'Opening…',
  },
});

/**
 * Signing out on a page that needs an account would make that page send the visitor to /masuk first, so the map
 * opens and signs out itself (MapScreen reads this flag from the navigation state).
 */
export const signOutFlag = 'signOut';
export function useSignOutToMap() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return () => navigate('/', { replace: pathname === '/', state: { [signOutFlag]: true } });
}

/** The role the visitor is viewing as, and a function that switches to another one. */
export function useRoleSwitch() {
  const { user, signInDemo } = useSession();
  const navigate = useNavigate();
  const signOutToMap = useSignOutToMap();
  const describe = useErrorText();
  const [busy, setBusy] = useState<ViewRole | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current: ViewRole | 'admin' = user ? user.role : 'public';
  const choose = async (role: ViewRole) => {
    setError(null);
    if (role === current) { navigate(homeFor(user)); return true; }
    setBusy(role);
    try {
      if (role === 'public') signOutToMap();
      else navigate(homeFor(await signInDemo(role)));
      return true;
    } catch (failure) { setError(describe(failure)); return false; } finally { setBusy(null); }
  };
  return { user, current, choose, busy, error };
}

/** The four roles as a list of choices; used in the top bar menu and the phone account sheet. */
export function RoleList({ onDone }: { onDone?: () => void }) {
  const t = useT(roleText), f = useFormat();
  const { current, choose, busy, error } = useRoleSwitch();
  return (
    <div className="rolelist" role="group" aria-label={t('viewAs')}>
      {viewRoles.map(({ role, icon: Icon }) => (
        <button key={role} type="button" aria-pressed={current === role} className={`rolelist-item ${current === role ? 'on' : ''}`} disabled={busy !== null}
          onClick={async () => { if (await choose(role)) onDone?.(); }}>
          <Icon size={18} className="icon" aria-hidden="true" />
          <span className="rolelist-text"><b>{f.role(role)}</b><small>{busy === role ? t('busy') : t(role)}</small></span>
          {current === role && <Check size={16} className="icon" aria-hidden="true" />}
        </button>
      ))}
      {error && <p className="rolelist-error" role="alert">{error}</p>}
    </div>
  );
}
