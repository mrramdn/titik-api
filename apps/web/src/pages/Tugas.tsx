// The volunteer's home: tasks from BPBD first, then alerts for the villages they watch. Every card carries the next
// step (on the way, field check, route) and says when its detail is saved for use without a signal.
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { ChevronRight, ClipboardCheck, Footprints, LocateFixed, Share2 } from 'lucide-react';
import { api, type Alert, type Incident, type MyAssignment } from '../api';
import { Shell } from '../components/Shell';
import { Banner, PriorityMark, RouteButton, shareText, StatusLine, useApi, useDataVersion, useErrorText, useOnline, waText } from '../components/ui';
import { CheckLine, FactsLine, PlaceLines, usePlace, useWhen } from '../components/volunteer/IncidentLines';
import { PushSwitch } from '../components/volunteer/PushSwitch';
import { useMedia, useOptionalApi } from '../components/volunteer/hooks';
import { myChecks, type MyCheck } from '../components/volunteer/myChecks';
import { useOfflineReady, useWaitingReports } from '../components/volunteer/offline';
import { comparator, groupByVillage, isChecked, type Order } from '../components/volunteer/sort';
import { locate, locateIfAllowed, useFix } from '../components/volunteer/useFix';
import { useFormat } from '../format';
import { dict, useLang, useT } from '../i18n';
import { useSession } from '../session';

const text = dict({
  id: {
    title: 'Tugas',
    tasks: 'Tugas dari BPBD', tasksEmpty: 'Belum ada tugas. Tugas baru dari BPBD juga masuk sebagai notifikasi.',
    alerts: 'Peringatan desa', alertsEmpty: 'Belum ada peringatan.', alertsNext: 'Pilih desa di Desa saya.', manage: 'Atur desa',
    order: 'Urutan', priority: 'Prioritas', nearest: 'Terdekat',
    locating: 'Mencari posisi…', fix: 'Jarak dari posisi Anda pukul {time} WIB, ±{accuracy}.', refresh: 'Perbarui',
    denied: 'Izin lokasi ditolak. Daftar tetap urut menurut prioritas.', unavailable: 'Posisi belum ditemukan. Coba lagi di tempat terbuka.',
    unsupported: 'Perangkat ini tidak memberi posisi. Daftar urut menurut prioritas.',
    goNow: 'Menuju lokasi', check: 'Cek lapangan', share: 'Bagikan ke WhatsApp',
    from: 'Dari {who} · {time}', assignedAt: 'Ditugaskan {time}', note: 'Catatan BPBD: {note}',
    done: 'Selesai 7 hari terakhir', closed: 'Selesai {time}', cancelled: 'Dibatalkan {time}',
    village: 'Desa {name}', incidents: '{n} kejadian', open: '{n} belum dicek', allChecked: 'semua sudah dicek',
    more: 'Tampilkan {n} lagi', loading: 'Memuat…',
  },
  en: {
    title: 'Tasks',
    tasks: 'Tasks from BPBD', tasksEmpty: 'No tasks yet. New tasks from BPBD also arrive as notifications.',
    alerts: 'Village alerts', alertsEmpty: 'No alerts yet.', alertsNext: 'Choose villages in My villages.', manage: 'Manage villages',
    order: 'Order', priority: 'Priority', nearest: 'Nearest',
    locating: 'Finding your position…', fix: 'Distances from your position at {time} WIB, ±{accuracy}.', refresh: 'Update',
    denied: 'Location permission denied. The list stays in priority order.', unavailable: 'No position yet. Try again in the open.',
    unsupported: 'This device gives no position. The list is in priority order.',
    goNow: 'On my way', check: 'Field check', share: 'Share to WhatsApp',
    from: 'From {who} · {time}', assignedAt: 'Assigned {time}', note: 'BPBD note: {note}',
    done: 'Done in the last 7 days', closed: 'Done {time}', cancelled: 'Cancelled {time}',
    village: '{name}', incidents: '{n} incidents', open: '{n} not checked', allChecked: 'all checked',
    more: 'Show {n} more', loading: 'Loading…',
  },
});
type Key = keyof typeof text.id;

const orderKey = 'titikapi.tugasOrder';
const storedOrder = (): Order => { try { return localStorage.getItem(orderKey) === 'nearest' ? 'nearest' : 'priority'; } catch { return 'priority'; } };
const isOpenTask = (task: MyAssignment) => task.status === 'ditugaskan' || task.status === 'menuju';
const weekMs = 7 * 24 * 3600_000;
const perVillage = 5;

interface CardState { here: [number, number] | null; ready: Set<string>; waiting: Set<string>; checks: Record<string, MyCheck> }

function TaskCard({ task, state, busy, error, onGo }: { task: MyAssignment; state: CardState; busy: boolean; error: string | null; onGo(): void }) {
  const t = useT(text), when = useWhen();
  const narrow = useMedia('(max-width: 400px)');
  const incident: Incident = { ...task.incident, assignment: task };
  const checked = Boolean(state.checks[incident.id]) || state.waiting.has(incident.id);
  return (
    <article className="v-row">
      <PriorityMark level={incident.level} />
      <div className="v-body">
        <Link to={`/kejadian/${incident.id}`} className="v-title"><PlaceLines incident={incident} here={state.here} /></Link>
        <FactsLine incident={incident} />
        {task.note && <span className="v-note">{t('note', { note: task.note })}</span>}
        <span className="v-muted">{task.assignedBy ? t('from', { who: task.assignedBy, time: when(task.createdAt) }) : t('assignedAt', { time: when(task.createdAt) })}</span>
        <CheckLine incident={incident} mine={state.checks[incident.id]} waiting={state.waiting.has(incident.id)} ready={state.ready.has(incident.id)} />
        {error && <span className="v-error" role="alert">{error}</span>}
        <div className="v-actions">
          {task.status === 'ditugaskan' && !checked && (
            <button type="button" className="btn btn-ink v-btn" disabled={busy} onClick={onGo}><Footprints size={16} aria-hidden="true" />{t('goNow')}</button>
          )}
          <Link to={`/kejadian/${incident.id}/cek`} className={`btn ${task.status === 'menuju' && !checked ? 'btn-ink' : 'btn-secondary'} v-btn`}><ClipboardCheck size={16} aria-hidden="true" />{t('check')}</Link>
          <RouteButton to={incident.centroid} className="btn btn-secondary v-btn" compact={narrow} />
        </div>
      </div>
    </article>
  );
}

function ClosedTask({ task }: { task: MyAssignment }) {
  const t = useT(text), when = useWhen(), place = usePlace();
  return (
    <div className="v-row v-row-compact">
      <PriorityMark level={task.incident.level} />
      <div className="v-body">
        <Link to={`/kejadian/${task.incident.id}`} className="v-title"><span className="v-place">{place(task.incident, null).main}</span></Link>
        <span className="v-muted">{t(task.status === 'dibatalkan' ? 'cancelled' : 'closed', { time: when(task.closedAt ?? task.updatedAt) })}</span>
        <StatusLine incident={task.incident} />
      </div>
    </div>
  );
}

// Alert buttons stay neutral: the volunteer picks which alert to check; ink marks only the next step of a task.
function AlertCard({ alert, state, sharedAt, onShare }: { alert: Alert; state: CardState; sharedAt: string | null; onShare(): void }) {
  const t = useT(text);
  const narrow = useMedia('(max-width: 480px)');
  const incident = alert.incident;
  return (
    <article className="v-row">
      <PriorityMark level={incident.level} />
      <div className="v-body">
        <Link to={`/kejadian/${incident.id}`} className="v-title"><PlaceLines incident={incident} here={state.here} /></Link>
        <FactsLine incident={incident} />
        <CheckLine incident={incident} mine={state.checks[incident.id]} waiting={state.waiting.has(incident.id)} ready={state.ready.has(incident.id)} sharedAt={sharedAt} />
        <div className="v-actions">
          <RouteButton to={incident.centroid} className="btn btn-secondary v-btn" />
          <Link to={`/kejadian/${incident.id}/cek`} className="btn btn-secondary v-btn"><ClipboardCheck size={16} aria-hidden="true" />{t('check')}</Link>
          <button type="button" className="btn btn-secondary v-btn" aria-label={t('share')} title={t('share')} onClick={onShare}><Share2 size={16} aria-hidden="true" />{narrow ? null : t('share')}</button>
        </div>
      </div>
    </article>
  );
}

/** One line under the order switch: locating, why there is no position (only after the volunteer asked), or the fix used. */
function FixNote({ asked }: { asked: boolean }) {
  const t = useT(text), f = useFormat();
  const { fix, status } = useFix();
  const message: Key | null = status === 'locating' ? 'locating' : status === 'denied' || status === 'unavailable' || status === 'unsupported' ? status : null;
  if (message && (asked || status === 'locating')) return <p className="v-fixnote" role="status">{t(message)}</p>;
  if (!fix) return null;
  return (
    <p className="v-fixnote">
      <LocateFixed size={14} aria-hidden="true" />{t('fix', { time: f.time(new Date(fix.at)), accuracy: f.km(fix.accuracy) })}
      <button type="button" className="v-linkbtn" onClick={() => void locate()}>{t('refresh')}</button>
    </p>
  );
}

export function TugasPage() {
  const { user, ready } = useSession();
  const { lang } = useLang();
  const t = useT(text);
  const describe = useErrorText();
  const online = useOnline();
  const { version } = useDataVersion();
  const alerts = useApi<Alert[]>(user ? '/me/alerts' : null, version);
  const tasks = useOptionalApi<MyAssignment[]>(user ? '/me/assignments' : null, version);
  const { fix } = useFix();
  const waiting = useWaitingReports();
  const [order, setOrder] = useState<Order>(storedOrder);
  const [asked, setAsked] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [taskError, setTaskError] = useState<{ id: string; text: string } | null>(null);
  const [shared, setShared] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // A saved "Terdekat" asks for a fix again; otherwise a fix is taken only when location is already allowed.
  useEffect(() => {
    if (order === 'nearest' && !fix) choose('nearest');
    else void locateIfAllowed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const taskList = tasks.data ?? [];
  const openTasks = taskList.filter(isOpenTask);
  const closedTasks = taskList.filter(task => !isOpenTask(task) && Date.now() - new Date(task.closedAt ?? task.updatedAt).getTime() < weekMs);
  const prefetch = useMemo(() => [
    ...(tasks.data ?? []).filter(isOpenTask).map(task => task.incident),
    ...(alerts.data ?? []).filter(alert => !isChecked(alert.incident)).map(alert => alert.incident),
  ], [tasks.data, alerts.data]);
  const readyIds = useOfflineReady(prefetch, online);
  const checks = useMemo(() => myChecks(), [waiting, alerts.data, tasks.data]);

  if (ready && !user) return <Navigate to="/masuk" replace />;

  const here = fix?.here ?? null;
  const compare = comparator(order, here);
  const state: CardState = { here, ready: readyIds, waiting, checks };
  const groups = groupByVillage(alerts.data ?? [], compare);
  const sortedTasks = [...openTasks].sort((a, b) => compare(a.incident, b.incident));
  const openAlerts = (alerts.data ?? []).filter(alert => !isChecked(alert.incident)).length;

  function choose(next: Order) {
    setOrder(next);
    try { localStorage.setItem(orderKey, next); } catch { /* private mode */ }
    if (next !== 'nearest') return;
    setAsked(true);
    if (!fix || Date.now() - fix.at > 5 * 60_000) void locate().then(found => { if (!found) choose('priority'); });
  }
  const goNow = async (task: MyAssignment) => {
    setBusy(task.id); setTaskError(null);
    try {
      await api(`/assignments/${task.id}`, { method: 'PATCH', json: { status: 'menuju' } });
      tasks.patch(list => list.map(item => (item.id === task.id ? { ...item, status: 'menuju', updatedAt: new Date().toISOString() } : item)));
      tasks.reload();
    } catch (error) { setTaskError({ id: task.id, text: describe(error) }); } finally { setBusy(null); }
  };
  const share = async (alert: Alert) => {
    if (!(await shareText(waText(alert.incident, lang)))) return;
    setShared(previous => ({ ...previous, [alert.id]: new Date().toISOString() }));
    void api(`/me/alerts/${alert.id}/shared`, { method: 'POST' }).catch(() => {});
  };
  // Without a signal the top bar already says so; a banner only explains an empty screen.
  const error = online ? alerts.error ?? tasks.error : alerts.data ? null : alerts.error;

  return (
    <Shell>
      <main className="page narrow v-page">
        <div className="v-head">
          <h1 className="title-24">{t('title')}</h1>
          <PushSwitch />
        </div>
        {error && <Banner tone="warn">{error}</Banner>}

        <div className="v-toolbar">
          <div className="segmented" role="group" aria-label={t('order')}>
            <button type="button" className={`chip ${order === 'priority' ? 'on' : ''}`} aria-pressed={order === 'priority'} onClick={() => choose('priority')}>{t('priority')}</button>
            <button type="button" className={`chip ${order === 'nearest' ? 'on' : ''}`} aria-pressed={order === 'nearest'} onClick={() => choose('nearest')}>{t('nearest')}</button>
          </div>
          <FixNote asked={asked} />
        </div>

        {tasks.data && !tasks.missing && (
          <section className="v-section" aria-labelledby="v-tasks">
            <div className="v-section-head"><h2 id="v-tasks" className="heading-16">{t('tasks')}</h2>{openTasks.length > 0 && <span className="v-count">{openTasks.length}</span>}</div>
            {sortedTasks.length
              ? <div className="v-list">{sortedTasks.map(task => <TaskCard key={task.id} task={task} state={state} busy={busy === task.id} error={taskError?.id === task.id ? taskError.text : null} onGo={() => void goNow(task)} />)}</div>
              : <p className="v-empty">{t('tasksEmpty')}</p>}
            {closedTasks.length > 0 && (
              <details className="v-done">
                <summary><ChevronRight size={16} className="v-chevron" aria-hidden="true" />{t('done')} <span className="v-count">{closedTasks.length}</span></summary>
                <div className="v-list">{closedTasks.map(task => <ClosedTask key={task.id} task={task} />)}</div>
              </details>
            )}
          </section>
        )}

        <section className="v-section" aria-labelledby="v-alerts">
          <div className="v-section-head">
            <h2 id="v-alerts" className="heading-16">{t('alerts')}</h2>
            {openAlerts > 0 && <span className="v-count">{openAlerts}</span>}
            <Link to="/desa-saya" className="v-section-link">{t('manage')}</Link>
          </div>
          {!alerts.data && alerts.loading && <p className="v-empty">{t('loading')}</p>}
          {alerts.data && !alerts.data.length && <p className="v-empty">{t('alertsEmpty')} <Link to="/desa-saya" className="link">{t('alertsNext')}</Link></p>}
          {groups.map(group => {
            const shown = expanded[group.village.id] ? group.alerts : group.alerts.slice(0, perVillage);
            return (
              <div key={group.village.id} className="v-group">
                <div className="v-group-head">
                  <Link to={`/desa/${group.village.id}`} className="v-group-name">{t('village', { name: group.village.name })}</Link>
                  <span className="v-muted">{t('incidents', { n: group.alerts.length })} · {group.open ? t('open', { n: group.open }) : t('allChecked')}</span>
                </div>
                <div className="v-list">
                  {shown.map(alert => <AlertCard key={alert.id} alert={alert} state={state} sharedAt={shared[alert.id] ?? alert.sharedAt} onShare={() => void share(alert)} />)}
                </div>
                {group.alerts.length > shown.length && (
                  <button type="button" className="btn btn-ghost btn-sm v-more" onClick={() => setExpanded(previous => ({ ...previous, [group.village.id]: true }))}>
                    {t('more', { n: group.alerts.length - shown.length })}
                  </button>
                )}
              </div>
            );
          })}
        </section>
      </main>
    </Shell>
  );
}
