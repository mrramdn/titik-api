// What other roles see on the BPBD screens: who the page is for and how to switch to the BPBD view.
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { LayoutDashboard } from 'lucide-react';
import type { Role } from '../../api';
import { dict, useT } from '../../i18n';
import { useSession } from '../../session';
import { Shell } from '../Shell';
import { Banner, useErrorText } from '../ui';

const text = dict({
  id: {
    dashboardTitle: 'Dasbor BPBD/Daops',
    dashboard: 'Dasbor ini untuk BPBD dan Daops Manggala Agni. Petugas menugaskan regu Masyarakat Peduli Api (MPA) ke kejadian prioritas tinggi.',
    recapTitle: 'Rekap harian',
    recap: 'Rekap harian ini untuk BPBD dan Daops Manggala Agni.',
    hint: 'Pilih BPBD/Daops di menu Lihat sebagai pada bilah atas, atau buka dengan akun demo BPBD.',
    open: 'Lihat sebagai BPBD/Daops',
  },
  en: {
    dashboardTitle: 'BPBD/Daops dashboard',
    dashboard: 'This dashboard is for BPBD and Daops Manggala Agni. Officers assign Masyarakat Peduli Api (MPA) teams to high-priority incidents.',
    recapTitle: 'Daily recap',
    recap: 'The daily recap is for BPBD and Daops Manggala Agni.',
    hint: 'Choose BPBD/Daops under View as in the top bar, or open it with the BPBD demo account.',
    open: 'View as BPBD/Daops',
  },
});

export const canUseBpbd = (role: Role | undefined) => role === 'bpbd' || role === 'admin';

export function RoleGate({ page }: { page: 'dashboard' | 'recap' }) {
  const t = useT(text);
  const { user, ready, signInDemo } = useSession();
  const navigate = useNavigate();
  const describe = useErrorText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Before the session check answers, show an empty page instead of a message that may flash away.
  if (!ready && !user) return <Shell><main className="page narrow" aria-busy="true" /></Shell>;
  const open = async () => {
    setBusy(true); setError(null);
    try { await signInDemo('bpbd'); navigate(page === 'recap' ? '/rekap' : '/dasbor', { replace: true }); }
    catch (reason) { setError(describe(reason)); }
    finally { setBusy(false); }
  };
  return (
    <Shell>
      <main className="page narrow">
        <div className="bd-gate">
          <h1 className="title-24">{t(page === 'recap' ? 'recapTitle' : 'dashboardTitle')}</h1>
          <p>{t(page)}</p>
          <p className="muted">{t('hint')}</p>
          <button type="button" className="btn btn-primary" onClick={() => void open()} disabled={busy}><LayoutDashboard size={16} />{t('open')}</button>
          {error && <Banner tone="warn">{error}</Banner>}
        </div>
      </main>
    </Shell>
  );
}
