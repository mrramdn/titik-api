import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { api, type VillageSummary } from '../api';
import { Shell } from '../components/Shell';
import { Banner, useApi } from '../components/ui';
import { useSession } from '../session';

interface Pick { villageId: string; radiusKm: number }

export function MyVillagesPage() {
  const { user, ready } = useSession();
  const navigate = useNavigate();
  const villages = useApi<VillageSummary[]>('/villages');
  const mine = useApi<{ villageId: string; radiusKm: number }[]>(user ? '/me/subscriptions' : null);
  const [picks, setPicks] = useState<Pick[] | null>(null);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { if (mine.data && picks === null) setPicks(mine.data.map(item => ({ villageId: item.villageId, radiusKm: item.radiusKm }))); }, [mine.data]);
  const list = useMemo(() => {
    const words = query.trim().toLowerCase();
    return (villages.data ?? []).filter(village => !words || `${village.name} ${village.district}`.toLowerCase().includes(words))
      .sort((a, b) => b.incidents7d - a.incidents7d || a.name.localeCompare(b.name)).slice(0, 60);
  }, [villages.data, query]);
  if (ready && !user) return <Navigate to="/masuk" replace />;
  const chosen = picks ?? [];
  const byId = new Map((villages.data ?? []).map(village => [village.id, village]));
  const toggle = (id: string) => setPicks(chosen.some(pick => pick.villageId === id) ? chosen.filter(pick => pick.villageId !== id) : [...chosen, { villageId: id, radiusKm: 0 }].slice(0, 20));
  const save = async () => {
    setSaving(true); setMessage(null);
    try {
      const result = await api<{ data: { saved: number; newAlerts: number } }>('/me/subscriptions', { method: 'PUT', json: { villages: chosen } });
      setMessage(`${result.data.saved} desa dipantau. ${result.data.newAlerts} kartu baru dari kejadian 24 jam terakhir.`);
      setTimeout(() => navigate('/peringatan'), 900);
    } catch (error) { setMessage((error as Error).message); } finally { setSaving(false); }
  };
  return (
    <Shell>
      <div className="page">
        <p className="kicker">Desa saya</p>
        <h1>Desa yang Anda pantau.</h1>
        <p className="lead">Pilih sampai 20 dari 327 desa dan kelurahan di OKI. Radius menambahkan kejadian di sekitar batas desa.</p>
        {chosen.length > 0 && (
          <ul className="picks">
            {chosen.map(pick => (
              <li key={pick.villageId}>
                <b>{byId.get(pick.villageId)?.name ?? pick.villageId}</b><small>{byId.get(pick.villageId)?.district}</small>
                <select value={pick.radiusKm} aria-label="Radius" onChange={event => setPicks(chosen.map(item => item.villageId === pick.villageId ? { ...item, radiusKm: Number(event.target.value) } : item))}>
                  {[0, 1, 3, 5].map(value => <option key={value} value={value}>{value ? `+ ${value} km` : 'di dalam desa'}</option>)}
                </select>
                <button type="button" className="btn btn-ghost btn-small" onClick={() => toggle(pick.villageId)}>Hapus</button>
              </li>
            ))}
          </ul>
        )}
        <div className="row">
          <button type="button" className="btn btn-primary" disabled={saving || picks === null} onClick={save}>Simpan</button>
          {message && <span role="status">{message}</span>}
        </div>
        <input className="search" type="search" placeholder="Cari desa atau kecamatan" value={query} onChange={event => setQuery(event.target.value)} />
        {villages.error && <Banner tone="warn">{villages.error}</Banner>}
        <table className="table">
          <thead><tr><th /><th>Desa</th><th>Kecamatan</th><th>Gambut</th><th>Kejadian 24 j</th><th>7 hari</th></tr></thead>
          <tbody>
            {list.map(village => (
              <tr key={village.id} className={chosen.some(pick => pick.villageId === village.id) ? 'on' : ''} onClick={() => toggle(village.id)}>
                <td><input type="checkbox" readOnly checked={chosen.some(pick => pick.villageId === village.id)} aria-label={`Pantau ${village.name}`} /></td>
                <td><b>{village.name}</b></td><td>{village.district}</td><td>{Math.round(village.peatShare * 100)}%</td>
                <td>{village.incidents24h || '–'}</td><td>{village.incidents7d || '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
