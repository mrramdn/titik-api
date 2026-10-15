import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { ChevronRight, LayoutDashboard, Landmark, Users } from 'lucide-react';
import { Shell } from '../components/Shell';
import { Banner } from '../components/ui';
import { homeFor, useSession } from '../session';

const roles = [
  { role: 'mpa' as const, icon: Users, title: 'Relawan MPA', text: 'Kartu titik panas desa, bagikan ke grup WA, cek lapangan (juga tanpa sinyal).' },
  { role: 'kades' as const, icon: Landmark, title: 'Kepala desa', text: 'Kartu untuk desanya, ringkasan desa, dan apa yang sudah dicek.' },
  { role: 'bpbd' as const, icon: LayoutDashboard, title: 'BPBD / Daops', text: 'Dasbor dua provinsi: persentase dicek, waktu respons, ekspor groundcheck.' },
];

export function LoginPage() {
  const { signInDemo, signIn } = useSession();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const go = async (work: () => Promise<Parameters<typeof homeFor>[0]>) => { setError(null); try { navigate(homeFor(await work())); } catch (failure) { setError((failure as Error).message); } };
  const submit = (event: FormEvent) => { event.preventDefault(); void go(() => signIn(email, password)); };
  return (
    <Shell>
      <main className="page narrow">
        <div className="page-head"><div><h1 className="title-24">Masuk</h1><p>Pilih peran untuk mencoba. Akun demo dipakai bersama dan bukan akun resmi instansi mana pun.</p></div></div>
        <div className="card roles">
          {roles.map(({ role, icon: Icon, title, text }) => (
            <button key={role} type="button" className="role" onClick={() => void go(() => signInDemo(role))}>
              <span className="tile"><Icon size={20} /></span><span className="text"><b>{title}</b><small>{text}</small></span><ChevronRight size={18} color="var(--text-3)" />
            </button>
          ))}
        </div>
        {error && <Banner tone="warn">{error}</Banner>}
        <p className="note">Titik panasnya data asli NASA FIRMS. Cek lapangan dari akun demo ditandai "demo" dan direset setiap malam.</p>
        <details>
          <summary className="caption" style={{ cursor: 'pointer', color: 'var(--text-2)' }}>Masuk dengan email</summary>
          <form onSubmit={submit} style={{ display: 'grid', gap: 10, maxWidth: 360, marginTop: 12 }}>
            <label className="field"><span className="label">Email</span><input type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required /></label>
            <label className="field"><span className="label">Password</span><input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></label>
            <button type="submit" className="btn btn-primary">Masuk</button>
          </form>
        </details>
      </main>
    </Shell>
  );
}
