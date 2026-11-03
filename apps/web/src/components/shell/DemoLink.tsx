// Opens the demo account a link asks for with ?lihat= (see demoLink.ts), then takes the parameter out of the address
// without a new history entry. The page waits meanwhile: /tugas would otherwise send a visitor without an account to
// /masuk before the sign-in lands.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { demoLinkHandler, demoLinkRole, demoParam } from '../../demoLink';
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
  const { user, ready, checked, signInDemo } = useSession();
  const value = demoParam(location.search);
  // What the handler reads when a sign-in returns: the history entry on screen by then, and the functions of that render.
  const latest = useRef({ key: location.key, navigate, signInDemo });
  useEffect(() => { latest.current = { key: location.key, navigate, signInDemo }; });
  const [handle] = useState(() => demoLinkHandler({
    signInDemo: role => latest.current.signInDemo(role),
    replace: (entry, search) => latest.current.navigate({ pathname: entry.pathname, search, hash: entry.hash }, { replace: true, state: entry.state }),
    currentKey: () => latest.current.key,
  }));
  useEffect(() => {
    // The session check decides whether a real account is signed in; until it has finished, nothing is switched.
    if (ready) void handle(location, user, checked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, location.key]);
  if (value === null) return <>{children}</>;
  const role = ready ? demoLinkRole(value, user, checked) : null;
  return (
    <Shell>
      <main className="page narrow" aria-busy="true">
        {role && <p className="empty" role="status">{t('opening', { role: f.role(role) })}</p>}
      </main>
    </Shell>
  );
}
