// The three lanes of the dashboard: Perlu tindakan, Sedang berjalan and Selesai. Every incident sits in exactly one.
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { UserPlus } from 'lucide-react';
import { api, ApiError, type Incident } from '../../api';
import { dict, useT } from '../../i18n';
import { useFormat } from '../../format';
import { Banner, PriorityMark, StatusLine, useErrorText } from '../ui';
import { AssignDialog } from './AssignDialog';
import { minutesBetween, type Count, type LaneKey } from './data';

const text = dict({
  id: {
    action: 'Perlu tindakan', actionNote: 'Prioritas tinggi, belum dicek, belum ditugaskan.',
    active: 'Sedang berjalan', activeNote: 'Regu sudah ditugaskan atau menuju lokasi.',
    done: 'Selesai', doneNote: 'Sudah dicek di lapangan, terbaru di atas.',
    village: 'Desa {name}', where: 'Kec. {district}, {regency}', hotspots: '{n} titik panas', peat: 'lahan gambut',
    score: 'Skor {n}', scoreTitle: 'Skor prioritas', seen: 'Terdeteksi {ago}', since: '{time} sejak ditugaskan', response: 'Waktu tanggap {time}',
    assign: 'Tugaskan', cancel: 'Batalkan', cancelAsk: 'Batalkan tugas {name}?', cancelYes: 'Ya, batalkan', cancelNo: 'Kembali',
    showAll: 'Tampilkan semua ({n})', showLess: 'Tampilkan lebih sedikit', loading: 'Memuat…',
    emptyAction: 'Semua kejadian prioritas tinggi sudah dicek atau ditugaskan.',
    emptyActive: 'Belum ada tugas yang berjalan. Tugaskan regu dari kolom Perlu tindakan.',
    emptyDone: 'Belum ada cek lapangan dalam rentang ini.',
    assigned: 'Ditugaskan ke {name}.', cancelled: 'Tugas {name} dibatalkan.', photo: 'Foto cek lapangan',
  },
  en: {
    action: 'Needs action', actionNote: 'High priority, not checked, not assigned.',
    active: 'In progress', activeNote: 'A team is assigned or on the way.',
    done: 'Done', doneNote: 'Checked in the field, newest first.',
    village: '{name}', where: '{district}, {regency}', hotspots: '{n} hotspots', peat: 'peatland',
    score: 'Score {n}', scoreTitle: 'Priority score', seen: 'Detected {ago}', since: '{time} since assigned', response: 'Response time {time}',
    assign: 'Assign', cancel: 'Cancel', cancelAsk: 'Cancel the task for {name}?', cancelYes: 'Yes, cancel', cancelNo: 'Back',
    showAll: 'Show all ({n})', showLess: 'Show fewer', loading: 'Loading…',
    emptyAction: 'Every high-priority incident is checked or assigned.',
    emptyActive: 'No task in progress. Assign a team from Needs action.',
    emptyDone: 'No field checks in this window yet.',
    assigned: 'Assigned to {name}.', cancelled: 'Task for {name} cancelled.', photo: 'Field check photo',
  },
});
type Key = keyof typeof text.id;
const noteKey: Record<LaneKey, Key> = { action: 'actionNote', active: 'activeNote', done: 'doneNote' };
const emptyKey: Record<LaneKey, Key> = { action: 'emptyAction', active: 'emptyActive', done: 'emptyDone' };

interface Props {
  lanes: Record<LaneKey, Incident[]>;
  /** False until a lane's list has arrived. */
  loaded: Record<LaneKey, boolean>;
  counts: Record<LaneKey, Count | null>;
  errors: Partial<Record<LaneKey, string>>;
  visible: LaneKey[];
  loading: boolean;
  /** Newest field check photo per incident id. */
  photos: Map<string, string>;
  /** Reloads the lanes and the numbers after an assignment changed. */
  onChanged(): void;
}

export function Lanes({ lanes, loaded, counts, errors, visible, loading, photos, onChanged }: Props) {
  const t = useT(text), f = useFormat();
  const [expanded, setExpanded] = useState<Partial<Record<LaneKey, boolean>>>({});
  const [assigning, setAssigning] = useState<Incident | null>(null);
  const [notice, setNotice] = useState<{ text: string; warn?: boolean } | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  const wide = visible.length === 1;
  const top = wide ? 12 : 5;
  const failed = (message: string, stale: boolean) => { setNotice({ text: message, warn: true }); if (stale) onChanged(); };

  return (
    <div className="bd-work">
      <div role="status" aria-live="polite">{notice && <Banner tone={notice.warn ? 'warn' : undefined}>{notice.text}</Banner>}</div>
      <div className={`bd-lanes count-${visible.length}`} aria-busy={loading}>
        {visible.map(lane => {
          const items = lanes[lane];
          const open = Boolean(expanded[lane]);
          const count = counts[lane];
          return (
            <section key={lane} className={`bd-lane ${wide ? 'wide' : ''}`} aria-labelledby={`bd-lane-${lane}`}>
              <div className="bd-lane-head">
                <h2 id={`bd-lane-${lane}`} className="heading-16">{t(lane)}</h2>
                {count && <span className="bd-lane-count">{f.num(count.value)}{count.more ? '+' : ''}</span>}
              </div>
              <p className="bd-lane-note">{t(noteKey[lane])}</p>
              <div className="bd-list">
                {errors[lane] && <div className="bd-list-msg"><Banner tone="warn">{errors[lane]}</Banner></div>}
                {!loaded[lane] && !errors[lane] && <p className="bd-quiet">{t('loading')}</p>}
                {loaded[lane] && !items.length && !errors[lane] && <p className="bd-quiet">{t(emptyKey[lane])}</p>}
                {items.length > 0 && (
                  <ul className={open ? 'all' : ''}>
                    {(open ? items : items.slice(0, top)).map(incident => (
                      <Row key={incident.id} incident={incident} lane={lane} photo={photos.get(incident.id)} onAssign={setAssigning}
                        onCancelled={name => { setNotice({ text: t('cancelled', { name }) }); onChanged(); }} onFailed={failed} />
                    ))}
                  </ul>
                )}
                {items.length > top && (
                  <button type="button" className="bd-more" aria-expanded={open} onClick={() => setExpanded(previous => ({ ...previous, [lane]: !open }))}>
                    {open ? t('showLess') : t('showAll', { n: f.num(items.length) })}
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>
      {assigning && (
        <AssignDialog key={assigning.id} incident={assigning} onClose={() => setAssigning(null)} onStale={onChanged}
          onAssigned={name => { setAssigning(null); setNotice({ text: t('assigned', { name }) }); onChanged(); }} />
      )}
    </div>
  );
}

interface RowProps {
  incident: Incident;
  lane: LaneKey;
  photo?: string;
  onAssign(incident: Incident): void;
  onCancelled(teamName: string): void;
  onFailed(message: string, stale: boolean): void;
}

function Row({ incident, lane, photo, onAssign, onCancelled, onFailed }: RowProps) {
  const t = useT(text), f = useFormat();
  const village = incident.village;
  const task = incident.assignment;
  const reason = [t('hotspots', { n: f.num(incident.detectionCount) }), incident.onPeat ? t('peat') : '', incident.nearestPlace ? f.place(incident.nearestPlace) : '']
    .filter(Boolean).join(', ');
  const when = lane === 'action' ? t('seen', { ago: f.ago(incident.lastDetectedAt) })
    : lane === 'active' && task ? t('since', { time: f.duration(minutesBetween(task.createdAt ?? task.updatedAt)) })
    : lane === 'done' ? t('response', { time: f.duration(minutesBetween(incident.firstDetectedAt, incident.firstVerifiedAt ?? incident.latestCheck?.observedAt)) })
    : '';
  return (
    <li className="bd-row">
      <PriorityMark level={incident.level} />
      <div className="bd-row-main">
        <div className="bd-row-what">
          <div className="bd-row-line">
            <Link to={`/kejadian/${incident.id}`} className="bd-row-title">{village ? t('village', { name: village.name }) : incident.code}</Link>
            {lane !== 'done' && <span className="bd-row-score" title={t('scoreTitle')}>{t('score', { n: incident.score })}</span>}
          </div>
          {village && <span className="bd-row-sub">{t('where', { district: village.district, regency: village.regency })}</span>}
        </div>
        <div className="bd-row-why">
          {lane === 'action' ? <span className="bd-row-sub" title={reason}>{reason}</span> : <StatusLine incident={incident} />}
        </div>
        <div className="bd-row-foot">
          <span className="bd-row-when">{when}</span>
          {lane === 'action' && <button type="button" className="btn btn-secondary btn-sm" onClick={() => onAssign(incident)}><UserPlus size={14} />{t('assign')}</button>}
          {lane === 'active' && task && <CancelTask taskId={task.id} teamName={task.assignee?.name ?? ''} onCancelled={onCancelled} onFailed={onFailed} />}
        </div>
      </div>
      {lane === 'done' && photo && <img className="bd-row-photo" src={photo} alt={t('photo')} loading="lazy" />}
    </li>
  );
}

function CancelTask({ taskId, teamName, onCancelled, onFailed }: { taskId: string; teamName: string; onCancelled(name: string): void; onFailed(message: string, stale: boolean): void }) {
  const t = useT(text);
  const describe = useErrorText();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!asking) return <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAsking(true)}>{t('cancel')}</button>;
  const confirm = async () => {
    setBusy(true);
    try {
      await api(`/assignments/${encodeURIComponent(taskId)}`, { method: 'PATCH', json: { status: 'dibatalkan' } });
      onCancelled(teamName);
    } catch (reason) {
      setAsking(false);
      onFailed(describe(reason), reason instanceof ApiError && (reason.code === 'ASSIGNMENT_CLOSED' || reason.status === 404));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="bd-confirm">
      <span>{t('cancelAsk', { name: teamName })}</span>
      <span className="bd-confirm-actions">
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void confirm()}>{t('cancelYes')}</button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setAsking(false)}>{t('cancelNo')}</button>
      </span>
    </span>
  );
}
