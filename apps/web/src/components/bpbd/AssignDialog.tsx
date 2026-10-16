// Picks an MPA team for an incident: nearest teams first, with their villages and open tasks, plus an optional note.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { api, ApiError, type AssigneeOption, type Incident } from '../../api';
import { dict, useT } from '../../i18n';
import { useFormat } from '../../format';
import { Banner, useErrorText } from '../ui';
import { useLoad } from './data';

const text = dict({
  id: {
    title: 'Tugaskan regu MPA', where: 'Desa {village}, Kec. {district}, {regency}', facts: '{n} titik panas, skor prioritas {score}',
    pick: 'Pilih regu', villages: 'Wilayah: {list}', distance: '{km} dari kejadian', noDistance: 'Jarak belum diketahui',
    open1: '1 tugas berjalan', openN: '{n} tugas berjalan', free: 'Tidak ada tugas berjalan',
    note: 'Catatan untuk regu (opsional)', submit: 'Tugaskan', cancel: 'Batal', close: 'Tutup',
    loading: 'Memuat daftar regu…', empty: 'Belum ada regu MPA yang bisa ditugaskan.', missing: 'Daftar regu belum tersedia. Muat ulang halaman nanti.',
  },
  en: {
    title: 'Assign an MPA team', where: '{village}, {district}, {regency}', facts: '{n} hotspots, priority score {score}',
    pick: 'Choose a team', villages: 'Area: {list}', distance: '{km} from the incident', noDistance: 'Distance unknown',
    open1: '1 open task', openN: '{n} open tasks', free: 'No open tasks',
    note: 'Note for the team (optional)', submit: 'Assign', cancel: 'Cancel', close: 'Close',
    loading: 'Loading teams…', empty: 'No MPA team can be assigned yet.', missing: 'The team list is not available yet. Reload the page later.',
  },
});

interface Props {
  incident: Incident;
  onClose(): void;
  onAssigned(teamName: string): void;
  /** Called when the server says the incident already changed (another officer assigned it). */
  onStale(): void;
}

export function AssignDialog({ incident, onClose, onAssigned, onStale }: Props) {
  const t = useT(text), f = useFormat();
  const describe = useErrorText();
  const ref = useRef<HTMLDialogElement>(null);
  const options = useLoad<AssigneeOption[]>(`/assignees?incident=${encodeURIComponent(incident.id)}`);
  const [choice, setChoice] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Opens as a modal (focus trap, Escape closes); the parent unmounts it on close.
  useEffect(() => { const dialog = ref.current; if (dialog && !dialog.open) dialog.showModal(); }, [incident.id]);
  const list = Array.isArray(options.data) ? options.data : [];
  // The nearest team comes first; it is chosen until the officer picks another one.
  const picked = choice && list.some(option => option.id === choice) ? choice : list[0]?.id ?? '';
  const village = incident.village;
  const distance = (option: AssigneeOption) => (typeof option.distanceM === 'number' ? t('distance', { km: f.km(option.distanceM) }) : t('noDistance'));
  const tasks = (option: AssigneeOption) => (!option.openAssignments ? t('free') : option.openAssignments === 1 ? t('open1') : t('openN', { n: option.openAssignments }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const team = list.find(option => option.id === picked);
    if (!team || busy) return;
    setBusy(true); setError(null);
    try {
      await api(`/incidents/${encodeURIComponent(incident.id)}/assignments`, { method: 'POST', json: { assigneeId: team.id, note: note.trim() } });
      onAssigned(team.name);
    } catch (reason) {
      setError(describe(reason));
      if (reason instanceof ApiError && (reason.code === 'ASSIGNMENT_OPEN' || reason.code === 'ASSIGNMENT_CLOSED' || reason.code === 'CONFLICT')) onStale();
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} className="bd-dialog" aria-labelledby="bd-assign-title" onClose={onClose}
      onClick={event => { if (event.target === ref.current) ref.current?.close(); }}>
      <form onSubmit={event => void submit(event)}>
        <div className="bd-dialog-head">
          <h2 id="bd-assign-title" className="heading-16">{t('title')}</h2>
          {village && <p>{t('where', { village: village.name, district: village.district, regency: village.regency })}</p>}
          <p className="muted">{t('facts', { n: f.num(incident.detectionCount), score: incident.score })}</p>
          <button type="button" className="icon-btn bd-dialog-x" aria-label={t('close')} onClick={() => ref.current?.close()}><X size={16} /></button>
        </div>
        <div className="bd-dialog-body">
          <fieldset className="bd-assignees">
            <legend className="label">{t('pick')}</legend>
            {options.loading && !list.length && <p className="bd-quiet">{t('loading')}</p>}
            {!options.loading && options.status === 404 && <p className="bd-quiet">{t('missing')}</p>}
            {!options.loading && options.error && options.status !== 404 && <Banner tone="warn">{options.error}</Banner>}
            {!options.loading && !options.error && !list.length && <p className="bd-quiet">{t('empty')}</p>}
            {list.length > 0 && (
              <div className="bd-assignee-list">
                {list.map(option => (
                  <label key={option.id} className={`bd-assignee ${picked === option.id ? 'on' : ''}`}>
                    <input type="radio" name="assignee" value={option.id} checked={picked === option.id} onChange={() => setChoice(option.id)} />
                    <span className="bd-assignee-text">
                      <b>{option.name}</b>
                      <small>{option.villages?.length ? t('villages', { list: option.villages.join(', ') }) : option.organization}</small>
                      <small className="bd-assignee-phone">{distance(option)} · {tasks(option)}</small>
                    </span>
                    <span className="bd-assignee-side">
                      <span>{distance(option)}</span>
                      <small>{tasks(option)}</small>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <label className="field">
            <span className="label">{t('note')}</span>
            <textarea value={note} onChange={event => setNote(event.target.value)} rows={2} maxLength={500} spellCheck={false} />
          </label>
          {error && <div role="alert"><Banner tone="warn">{error}</Banner></div>}
        </div>
        <div className="bd-dialog-foot">
          <button type="button" className="btn btn-secondary" onClick={() => ref.current?.close()}>{t('cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={!picked || busy}>{t('submit')}</button>
        </div>
      </form>
    </dialog>
  );
}
