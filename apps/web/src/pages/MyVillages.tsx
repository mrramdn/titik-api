// Desa saya: a seven-day summary of every watched village first (for village heads and volunteers alike);
// adding, removing and the alert radius live in a secondary panel.
import { useState } from 'react';
import { Link, Navigate } from 'react-router';
import { Check, Plus, Search, Settings2, Share2, X } from 'lucide-react';
import { api, type Incident, type VillageSummary } from '../api';
import { Shell } from '../components/Shell';
import { Banner, shareText, useApi, useDataVersion, useErrorText } from '../components/ui';
import { Bars7 } from '../components/volunteer/Bars7';
import { useWhen } from '../components/volunteer/IncidentLines';
import { villageStats, villageSummaryText } from '../components/volunteer/villageSummary';
import { useFormat } from '../format';
import { dict, useLang, useT } from '../i18n';
import { useRegion } from '../region';
import { useSession } from '../session';

const text = dict({
  id: {
    title: 'Desa saya', intro: 'Ringkasan 7 hari untuk desa yang Anda pantau.', manage: 'Atur desa', close: 'Tutup',
    empty: 'Belum ada desa yang dipantau. Cari desa di bawah, pilih, lalu simpan.', loading: 'Memuat…',
    village: 'Desa {name}', where: 'Kec. {district} · {regency}', district: 'Kec. {district}', inside: 'di dalam desa', radius: 'radius +{km} km',
    week: 'Kejadian 7 hari', open: 'Belum dicek', lastCheck: 'Cek terakhir', none: 'Belum ada',
    share: 'Bagikan ringkasan', page: 'Buka halaman desa',
    chosen: 'Desa yang dipantau · {n} dari 20', remove: 'Hapus Desa {name}', radiusFor: 'Radius peringatan untuk Desa {name}',
    search: 'Cari desa', placeholder: 'Desa, kecamatan, atau kabupaten',
    suggestions: 'Desa dengan kejadian terbanyak 7 hari', results: 'Hasil pencarian', noResults: 'Tidak ada desa yang cocok. Coba nama kecamatan.',
    add: 'Tambah', added: 'Dipantau', full: 'Sudah 20 desa. Hapus satu desa untuk menambah yang lain.', count7: '{n} kejadian 7 hari',
    save: 'Simpan', saving: 'Menyimpan…', cancel: 'Batal', saved: '{n} desa dipantau. {alerts} peringatan baru dari 24 jam terakhir.',
  },
  en: {
    title: 'My villages', intro: 'Seven-day summary for the villages you watch.', manage: 'Manage villages', close: 'Close',
    empty: 'You are not watching any village yet. Search below, choose, then save.', loading: 'Loading…',
    village: '{name}', where: '{district} district · {regency}', district: '{district} district', inside: 'inside the village', radius: 'radius +{km} km',
    week: 'Incidents, 7 days', open: 'Not checked', lastCheck: 'Last check', none: 'None yet',
    share: 'Share summary', page: 'Open village page',
    chosen: 'Watched villages · {n} of 20', remove: 'Remove {name}', radiusFor: 'Alert radius for {name}',
    search: 'Search villages', placeholder: 'Village, district or regency',
    suggestions: 'Villages with the most incidents in 7 days', results: 'Search results', noResults: 'No matching village. Try the district name.',
    add: 'Add', added: 'Watched', full: 'Already 20 villages. Remove one to add another.', count7: '{n} incidents in 7 days',
    save: 'Save', saving: 'Saving…', cancel: 'Cancel', saved: '{n} villages watched. {alerts} new alerts from the last 24 hours.',
  },
});

interface Subscription { villageId: string; radiusKm: number; name: string; district: string }
interface Choice { villageId: string; radiusKm: number; name: string; district: string; regency?: string }
interface VillageDetail { id: string; name: string; district: string; regency: string; province: string; incidents: Incident[]; daily: { day: string; detections: number }[] }
const radii = [0, 1, 3, 5];
const maxVillages = 20;

function VillageCard({ subscription, version }: { subscription: Subscription; version: number }) {
  const t = useT(text), f = useFormat(), when = useWhen();
  const { lang } = useLang();
  const detail = useApi<VillageDetail>(`/villages/${subscription.villageId}`, version);
  const d = detail.data;
  const stats = d ? villageStats(d.incidents) : null;
  return (
    <article className="v-vrow">
      <div className="v-vrow-head">
        <Link to={`/desa/${subscription.villageId}`} className="v-vname">{t('village', { name: subscription.name })}</Link>
        <span className="v-muted">
          {d ? t('where', { district: subscription.district, regency: d.regency }) : t('district', { district: subscription.district })} · {subscription.radiusKm ? t('radius', { km: subscription.radiusKm }) : t('inside')}
        </span>
      </div>
      {d && stats ? (
        <div className="v-vrow-body">
          <Bars7 daily={d.daily} compact />
          <dl className="v-stats">
            <div><dt>{t('week')}</dt><dd>{f.num(stats.total)}</dd></div>
            <div><dt>{t('open')}</dt><dd>{f.num(stats.open)}</dd></div>
            <div><dt>{t('lastCheck')}</dt><dd className={stats.lastCheck ? 'v-checked' : 'v-none'}>{stats.lastCheck ? when(stats.lastCheck.at) : t('none')}</dd></div>
          </dl>
        </div>
      ) : <p className="v-muted">{detail.error ?? t('loading')}</p>}
      <div className="v-actions">
        <Link to={`/desa/${subscription.villageId}`} className="btn btn-secondary v-btn">{t('page')}</Link>
        {d && <button type="button" className="btn btn-secondary v-btn" onClick={() => void shareText(villageSummaryText(d, d.incidents, lang))}><Share2 size={16} aria-hidden="true" />{t('share')}</button>}
      </div>
    </article>
  );
}

function ManagePanel({ initial, onSaved, onCancel }: { initial: Subscription[]; onSaved(message: string): void; onCancel?: () => void }) {
  const t = useT(text), f = useFormat(), describe = useErrorText();
  const { query } = useRegion();
  const [q, setQ] = useState('');
  const [choices, setChoices] = useState<Choice[]>(() => initial.map(item => ({ ...item })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const term = q.trim();
  const villages = useApi<VillageSummary[]>(`/villages?${term.length >= 2 ? `q=${encodeURIComponent(term)}` : ''}${query}`);
  const chosen = (id: string) => choices.some(choice => choice.villageId === id);
  const toggle = (village: VillageSummary) => setChoices(chosen(village.id)
    ? choices.filter(choice => choice.villageId !== village.id)
    : [...choices, { villageId: village.id, radiusKm: 0, name: village.name, district: village.district, regency: village.regency }].slice(0, maxVillages));
  const save = async () => {
    setSaving(true); setError(null);
    try {
      const response = await api<{ data: { saved: number; newAlerts: number } }>('/me/subscriptions', { method: 'PUT', json: { villages: choices.map(({ villageId, radiusKm }) => ({ villageId, radiusKm })) } });
      onSaved(t('saved', { n: f.num(response.data.saved), alerts: f.num(response.data.newAlerts) }));
    } catch (failure) { setError(describe(failure)); } finally { setSaving(false); }
  };
  return (
    <section className="card v-manage" aria-labelledby="v-manage-title">
      <h2 id="v-manage-title" className="heading-16">{t('manage')}</h2>
      {choices.length > 0 && (
        <div className="v-picks">
          <span className="label">{t('chosen', { n: choices.length })}</span>
          {choices.map(choice => (
            <div key={choice.villageId} className="v-pick">
              <span className="v-pick-name"><b>{t('village', { name: choice.name })}</b><small>{choice.district}{choice.regency ? ` · ${choice.regency}` : ''}</small></span>
              <select className="input v-radius" value={choice.radiusKm} aria-label={t('radiusFor', { name: choice.name })}
                onChange={event => setChoices(choices.map(item => (item.villageId === choice.villageId ? { ...item, radiusKm: Number(event.target.value) } : item)))}>
                {radii.map(value => <option key={value} value={value}>{value ? `+${value} km` : t('inside')}</option>)}
              </select>
              <button type="button" className="icon-btn" aria-label={t('remove', { name: choice.name })} onClick={() => setChoices(choices.filter(item => item.villageId !== choice.villageId))}><X size={16} /></button>
            </div>
          ))}
        </div>
      )}
      <label className="field"><span className="label">{t('search')}</span>
        <span className="v-search"><Search size={16} aria-hidden="true" /><input className="input" type="search" value={q} onChange={event => setQ(event.target.value)} placeholder={t('placeholder')} /></span>
      </label>
      <span className="label">{term.length >= 2 ? t('results') : t('suggestions')}</span>
      {choices.length >= maxVillages && <p className="note">{t('full')}</p>}
      <div className="v-hits">
        {villages.data?.map(village => {
          const on = chosen(village.id);
          return (
            <button key={village.id} type="button" className={`v-hit ${on ? 'on' : ''}`} aria-pressed={on} disabled={!on && choices.length >= maxVillages} onClick={() => toggle(village)}>
              <span className="v-pick-name"><b>{t('village', { name: village.name })}</b><small>{t('where', { district: village.district, regency: village.regency })}{village.incidents7d ? ` · ${t('count7', { n: f.num(village.incidents7d) })}` : ''}</small></span>
              <span className="v-toggle">{on ? <Check size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}{on ? t('added') : t('add')}</span>
            </button>
          );
        })}
        {villages.data && !villages.data.length && <p className="v-empty">{t('noResults')}</p>}
        {!villages.data && villages.error && <p className="v-empty">{villages.error}</p>}
      </div>
      {error && <Banner tone="warn">{error}</Banner>}
      <div className="v-manage-foot">
        {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>{t('cancel')}</button>}
        <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>{saving ? t('saving') : t('save')}</button>
      </div>
    </section>
  );
}

export function MyVillagesPage() {
  const { user, ready } = useSession();
  const t = useT(text);
  const { version } = useDataVersion();
  const mine = useApi<Subscription[]>(user ? '/me/subscriptions' : null, version);
  const [managing, setManaging] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (ready && !user) return <Navigate to="/masuk" replace />;
  const subscriptions = mine.data ?? [];
  const none = mine.data !== null && subscriptions.length === 0;
  return (
    <Shell>
      <main className="page narrow v-page">
        <div className="v-head">
          <div><h1 className="title-24">{t('title')}</h1><p className="v-intro">{t('intro')}</p></div>
          {subscriptions.length > 0 && (
            <button type="button" className="btn btn-secondary btn-sm" aria-expanded={managing} onClick={() => { setManaging(!managing); setMessage(null); }}>
              {managing ? <X size={16} aria-hidden="true" /> : <Settings2 size={16} aria-hidden="true" />}{managing ? t('close') : t('manage')}
            </button>
          )}
        </div>
        {message && <Banner tone="ok">{message}</Banner>}
        {mine.error && <Banner tone="warn">{mine.error}</Banner>}
        {!mine.data && mine.loading && <p className="v-empty">{t('loading')}</p>}
        {none && <p className="v-empty">{t('empty')}</p>}
        {(managing || none) && (
          <ManagePanel key={subscriptions.map(item => item.villageId).join(',')} initial={subscriptions}
            onSaved={saved => { setMessage(saved); setManaging(false); mine.reload(); }} onCancel={none ? undefined : () => setManaging(false)} />
        )}
        {subscriptions.length > 0 && <div className="v-list">{subscriptions.map(item => <VillageCard key={item.villageId} subscription={item} version={version} />)}</div>}
      </main>
    </Shell>
  );
}
