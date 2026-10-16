import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Check, ChevronRight } from 'lucide-react';
import { Shell } from '../components/Shell';
import { Banner, useErrorText } from '../components/ui';
import { roleText, useRoleSwitch, viewRoles } from '../components/shell/roles';
import { dict, useT } from '../i18n';
import { useFormat } from '../format';
import { homeFor, useSession } from '../session';

const text = dict({
  id: {
    title: 'Masuk', lead: 'Pilih peran untuk membuka Titik Api dari sisi pengguna itu. Akun demo dipakai bersama dan direset setiap malam.',
    demoNote: 'Cek lapangan dari akun demo ditandai "demo".', emailTitle: 'Masuk dengan email', email: 'Email', password: 'Kata sandi',
    submit: 'Masuk', sending: 'Memeriksa…', current: 'Peran saat ini',
  },
  en: {
    title: 'Sign in', lead: 'Choose a role to open Titik Api as that user. Demo accounts are shared and reset every night.',
    demoNote: 'Field checks from demo accounts are marked "demo".', emailTitle: 'Sign in with email', email: 'Email', password: 'Password',
    submit: 'Sign in', sending: 'Checking…', current: 'Current role',
  },
});

export function LoginPage() {
  const t = useT(text), r = useT(roleText), f = useFormat();
  const { signIn } = useSession();
  const { current, choose, busy, error: switchError } = useRoleSwitch();
  const navigate = useNavigate();
  const describe = useErrorText();
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(null); setSending(true);
    try { navigate(homeFor(await signIn(email, password))); } catch (failure) { setError(describe(failure)); } finally { setSending(false); }
  };
  return (
    <Shell>
      <main className="page narrow login">
        <div className="page-head"><div><h1 className="title-24">{t('title')}</h1><p>{t('lead')}</p></div></div>
        <div className="card roles" role="group" aria-label={r('viewAs')}>
          {viewRoles.map(({ role, icon: Icon }) => (
            <button key={role} type="button" className="role" disabled={busy !== null} aria-current={current === role ? 'true' : undefined} onClick={() => void choose(role)}>
              <span className="tile"><Icon size={20} aria-hidden="true" /></span>
              <span className="text"><b>{f.role(role)}</b><small>{busy === role ? r('busy') : r(role)}</small></span>
              {current === role ? <Check size={18} aria-label={t('current')} /> : <ChevronRight size={18} color="var(--text-3)" aria-hidden="true" />}
            </button>
          ))}
        </div>
        {switchError && <Banner tone="warn">{switchError}</Banner>}
        <p className="note">{t('demoNote')}</p>
        <section className="card login-form">
          <h2 className="heading-16">{t('emailTitle')}</h2>
          <form onSubmit={submit}>
            <label className="field"><span className="label">{t('email')}</span><input type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required /></label>
            <label className="field"><span className="label">{t('password')}</span><input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></label>
            {error && <Banner tone="warn">{error}</Banner>}
            <button type="submit" className="btn btn-primary" disabled={sending}>{sending ? t('sending') : t('submit')}</button>
          </form>
        </section>
      </main>
    </Shell>
  );
}
