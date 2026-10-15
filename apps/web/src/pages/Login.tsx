import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Shell } from '../components/Shell';
import { homeFor, useSession } from '../session';

const roles = [
  { role: 'mpa' as const, title: 'Relawan MPA', text: 'Menerima kartu titik panas desa, meneruskannya ke grup WA, lalu mengecek di lapangan, juga tanpa sinyal.' },
  { role: 'kades' as const, title: 'Kepala desa', text: 'Menerima kartu untuk desanya dan melihat apa yang sudah dicek.' },
  { role: 'bpbd' as const, title: 'BPBD / Daops', text: 'Membaca dasbor: kejadian, persentase yang sudah dicek, waktu respons, dan ekspor format groundcheck.' },
];

export function LoginPage() {
  const { signInDemo, signIn } = useSession();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const go = async (work: () => Promise<Parameters<typeof homeFor>[0]>) => {
    setError(null);
    try { navigate(homeFor(await work())); } catch (failure) { setError((failure as Error).message); }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void go(() => signIn(email, password)); };
  return (
    <Shell>
      <div className="page narrow">
        <p className="kicker">Masuk</p>
        <h1>Pilih peran untuk mencoba.</h1>
        <p className="lead">Tiga akun demo dipakai bersama dan bukan akun resmi instansi mana pun. Data titik panasnya asli dari NASA FIRMS. Verifikasi yang Anda kirim tercatat sebagai demo dan dihapus saat reset malam.</p>
        <div className="roles">
          {roles.map(item => (
            <button key={item.role} type="button" className="role" onClick={() => void go(() => signInDemo(item.role))}>
              <strong>{item.title}</strong><span>{item.text}</span><em>Masuk sebagai {item.title.toLowerCase()} →</em>
            </button>
          ))}
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <details className="manual">
          <summary>Masuk dengan email</summary>
          <form onSubmit={submit} className="form">
            <label>Email<input type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required /></label>
            <label>Password<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></label>
            <button type="submit" className="btn btn-primary">Masuk</button>
          </form>
        </details>
      </div>
    </Shell>
  );
}
