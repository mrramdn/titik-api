import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { Search, X } from 'lucide-react';
import { api, type VillageSummary } from '../api';
import { Shell } from '../components/Shell';
import { Banner, useApi } from '../components/ui';
import { useRegion } from '../region';
import { useSession } from '../session';

interface Pick { villageId: string; radiusKm: number; name?: string; district?: string; regency?: string }

export function MyVillagesPage() {
  const { user, ready } = useSession();
  const { query } = useRegion();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const villages = useApi<VillageSummary[]>(`/villages?${q.trim().length >= 2 ? `q=${encodeURIComponent(q.trim())}` : ''}${query}`);
  const mine = useApi<{ villageId: string; radiusKm: number; name: string; district: string }[]>(user ? '/me/subscriptions' : null);
  const [picks, setPicks] = useState<Pick[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { if (mine.data && picks === null) setPicks(mine.data.map(m => ({ villageId: m.villageId, radiusKm: m.radiusKm, name: m.name, district: m.district }))); }, [mine.data]);
  if (ready && !user) return <Navigate to="/masuk" replace />;
  const chosen = picks ?? [];
  const toggle = (v: VillageSummary) => setPicks(chosen.some(p => p.villageId === v.id) ? chosen.filter(p => p.villageId !== v.id) : [...chosen, { villageId: v.id, radiusKm: 0, name: v.name, district: v.district, regency: v.regency }].slice(0, 20));
  const save = async () => {
    setSaving(true); setMessage(null);
    try { const r = await api<{ data: { saved: number; newAlerts: number } }>('/me/subscriptions', { method: 'PUT', json: { villages: chosen.map(({ villageId, radiusKm }) => ({ villageId, radiusKm })) } }); setMessage(`${r.data.saved} desa dipantau. ${r.data.newAlerts} kartu baru dari 24 jam terakhir.`); setTimeout(() => navigate('/peringatan'), 900); }
    catch (error) { setMessage((error as Error).message); } finally { setSaving(false); }
  };
  return (
    <Shell>
      <main className="page narrow">
        <div className="page-head"><div><h1 className="title-24">Desa saya</h1><p>Pilih sampai 20 desa. Radius menambahkan kejadian di sekitar batas desa.</p></div>
          <button type="button" className="btn btn-primary btn-sm" disabled={saving || picks === null} onClick={save}>Simpan</button></div>
        {message && <Banner tone="ok">{message}</Banner>}
        {chosen.length > 0 && (
          <div className="card list-card">
            {chosen.map(p => (
              <div key={p.villageId} className="alert-row" style={{ alignItems: 'center' }}>
                <span className="main"><span className="title">Desa {p.name ?? p.villageId}</span><span className="summary">{p.district}{p.regency ? ` · ${p.regency}` : ''}</span></span>
                <select className="input" style={{ width: 150 }} value={p.radiusKm} aria-label="Radius" onChange={event => setPicks(chosen.map(x => x.villageId === p.villageId ? { ...x, radiusKm: Number(event.target.value) } : x))}>
                  {[0, 1, 3, 5].map(v => <option key={v} value={v}>{v ? `+ ${v} km` : 'di dalam desa'}</option>)}
                </select>
                <button type="button" className="icon-btn" aria-label="Hapus" onClick={() => setPicks(chosen.filter(x => x.villageId !== p.villageId))}><X size={16} /></button>
              </div>
            ))}
          </div>
        )}
        <label className="field"><span className="label">Cari desa</span>
          <span style={{ position: 'relative' }}><Search size={16} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--text-3)' }} /><input className="input" style={{ paddingLeft: 36 }} value={q} onChange={event => setQ(event.target.value)} placeholder="Nama desa, kecamatan, atau kabupaten" /></span></label>
        <div className="card" style={{ overflow: 'hidden' }}>
          <table className="table">
            <thead><tr><th>Desa</th><th>Kabupaten</th><th>Gambut</th><th>24 jam</th><th>7 hari</th></tr></thead>
            <tbody>{villages.data?.map(v => (
              <tr key={v.id} onClick={() => toggle(v)} style={chosen.some(p => p.villageId === v.id) ? { background: 'rgb(255 90 31 / 0.06)' } : undefined}>
                <td>{chosen.some(p => p.villageId === v.id) ? '✓ ' : ''}Desa {v.name}<div className="caption muted">{v.district}</div></td><td>{v.regency}</td><td>{Math.round(v.peatShare * 100)}%</td><td>{v.incidents24h || '–'}</td><td>{v.incidents7d || '–'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </main>
    </Shell>
  );
}
