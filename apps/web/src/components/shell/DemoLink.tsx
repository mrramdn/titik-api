// Opens the demo account a link asks for with ?lihat= (see demoLink.ts), then takes the parameter out of the address
// without a new history entry. The page waits meanwhile: /tugas would otherwise send a visitor without an account to
// /masuk before the sign-in lands.
import { useEffect, useRef, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { demoLinkRole, demoParam, withoutDemoParam } from '../../demoLink';
import { useFormat } from '../../format';
import { dict, useT } from '../../i18n';
import { useSession } from '../../session';
import { Shell } from '../Shell';

const text = dict({
  id: { opening: 'Membuka akun demo {role}…' },
  en: { opening: 'Opening the {role} demo account…' },
});

export function DemoLink({ children }: { children: ReactNode }) {
  const t = useT(text), f = useFormat();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, ready, signInDemo } = useSession();
  const value = demoParam(location.search);
  // Once per navigation: React's strict mode runs effects twice in development.
  const handled = useRef<string | null>(null);
  useEffect(() => {
    // The session check decides whether a real account is signed in; until it answers, nothing is switched.
    if (value === null || !ready || handled.current === location.key) return;
    handled.current = location.key;
    const role = demoLinkRole(value, user);
    const done = () => navigate({ pathname: location.pathname, search: withoutDemoParam(location.search), hash: location.hash }, { replace: true, state: location.state });
    if (!role) { done(); return; }
    // A failed sign-in leaves the page as a visitor sees it; that page offers its own way in.
    void signInDemo(role).catch(() => {}).finally(done);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, ready, location.key]);
  if (value === null) return <>{children}</>;
  const role = ready ? demoLinkRole(value, user) : null;
  return (
    <Shell>
      <main className="page narrow" aria-busy="true">
        {role && <p className="empty" role="status">{t('opening', { role: f.role(role) })}</p>}
      </main>
    </Shell>
  );
}
