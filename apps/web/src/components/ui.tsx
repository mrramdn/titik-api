import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Flame, Navigation } from 'lucide-react';
import type { Incident, IngestStatus, Level, ScorePart, Status } from '../api';
import { api, ApiError, type ErrorCode } from '../api';
import { dict, useLang, useT } from '../i18n';
import { errorText } from '../i18n/common';
import { formatter, useFormat, wib, wibDay } from '../format';

const text = dict({
  id: {
    notChecked: 'Belum dicek', checked: 'Dicek {time}', demo: 'demo', assigned: 'Ditugaskan · {who}', enroute: 'Menuju lokasi · {who}',
    route: 'Rute', score: 'Skor prioritas', scoreRule: 'Tinggi ≥ 60, sedang 35–59.',
  },
  en: {
    notChecked: 'Not checked', checked: 'Checked {time}', demo: 'demo', assigned: 'Assigned · {who}', enroute: 'On the way · {who}',
    route: 'Route', score: 'Priority score', scoreRule: 'High ≥ 60, medium 35–59.',
  },
});

/** The small priority badge, used once per incident header. */
export function LevelBadge({ level }: { level: Level }) {
  const f = useFormat();
  return <span className={`badge badge-${level}`}>{f.level(level)}</span>;
}

/** A 4 px colour bar on the edge of a row; the colour is the only priority signal in lists. */
export function PriorityMark({ level }: { level: Level }) { return <i className={`prio prio-${level}`} aria-hidden="true" />; }

/** Where an incident stands: checked (green), assigned (blue) or not checked yet (muted). */
export function StatusLine({ incident }: { incident: Pick<Incident, 'latestCheck' | 'latestStatus' | 'firstVerifiedAt' | 'assignment'> }) {
  const t = useT(text), f = useFormat();
  const check = incident.latestCheck ?? (incident.latestStatus && incident.firstVerifiedAt ? { status: incident.latestStatus, observedAt: incident.firstVerifiedAt, demo: false } : null);
  if (check) {
    return <span className="statusline statusline-checked">{t('checked', { time: f.time(check.observedAt) })} · {f.status(check.status)}{check.demo ? ` · ${t('demo')}` : ''}</span>;
  }
  const task = incident.assignment;
  if (task && (task.status === 'ditugaskan' || task.status === 'menuju')) {
    return <span className="statusline statusline-assigned">{t(task.status === 'menuju' ? 'enroute' : 'assigned', { who: task.assignee.name })}</span>;
  }
  return <span className="statusline statusline-open">{t('notChecked')}</span>;
}

/** Older status text, kept for screens that show only the field result. */
export function StatusText({ status, demo }: { status: Status | null; demo?: boolean }) {
  const t = useT(text), f = useFormat();
  if (!status) return <span className="status status-open">{t('notChecked')}</span>;
  return <span className={`status status-${status}`}>{f.status(status)}{demo ? ` · ${t('demo')}` : ''}</span>;
}

/** @deprecated rows use PriorityMark; kept until every screen has moved. */
export function FlameTile({ level, checked, size = 18 }: { level: Level; checked?: boolean; size?: number }) {
  return <span className={`tile tile-${level} ${checked ? 'tile-checked' : ''}`}><Flame size={size} /></span>;
}

export const directionsUrl = ([lon, lat]: [number, number]) => `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(5)},${lon.toFixed(5)}`;
export const mapUrl = ([lon, lat]: [number, number]) => `https://maps.google.com/?q=${lat.toFixed(5)},${lon.toFixed(5)}`;

/** Opens Google Maps directions to the incident (the Maps app on Android). */
export function RouteButton({ to, className = 'btn btn-secondary', compact = false }: { to: [number, number]; className?: string; compact?: boolean }) {
  const t = useT(text);
  return <a className={className} href={directionsUrl(to)} target="_blank" rel="noopener noreferrer"><Navigation size={16} />{compact ? null : t('route')}</a>;
}

export function ScoreRows({ parts, score }: { parts: ScorePart[]; score: number }) {
  const t = useT(text);
  return (
    <>
      <div className="score-head"><span className="label">{t('score')}</span><span className="number-20">{score} <span className="muted" style={{ fontSize: 13 }}>/ 100</span></span></div>
      <div>{parts.map(part => (
        <div key={part.key} className={`score-row ${part.points < 0 ? 'minus' : part.points === 0 ? 'zero' : ''}`}>
          <span>{part.label}</span>
          <span className="bar"><i style={{ width: `${Math.min(100, (Math.abs(part.points) / 30) * 100)}%` }} /></span>
          <b>{part.points > 0 ? `+${part.points}` : part.points}</b>
        </div>
      ))}</div>
      <p className="note">{t('scoreRule')}</p>
    </>
  );
}

const waWords = {
  id: { priority: 'Prioritas {level}', hotspots: '{n} titik panas', peat: 'lahan gambut', last: 'terakhir {time} WIB', location: 'Lokasi', detail: 'Detail', caveat: 'Titik panas perlu dicek di lapangan.', near: 'sekitar {place}', uncertain: 'lokasi ±{km}' },
  en: { priority: '{level} priority', hotspots: '{n} hotspots', peat: 'peatland', last: 'last seen {time} WIB', location: 'Location', detail: 'Details', caveat: 'Hotspots need a field check.', near: 'near {place}', uncertain: 'location ±{km}' },
};

/** The WhatsApp message for an incident: where, how urgent, a map link, the incident link, one caveat. */
export function waText(incident: Incident, lang: 'id' | 'en') {
  const f = formatter(lang), w = waWords[lang];
  const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k]));
  const village = incident.village;
  const where = village ? `${lang === 'id' ? 'Desa ' : ''}${village.name}, ${lang === 'id' ? 'Kec. ' : ''}${village.district}, ${village.regency}` : '';
  const facts = [fill(w.priority, { level: f.level(incident.level).toLowerCase() }), fill(w.hotspots, { n: f.num(incident.detectionCount) })];
  if (incident.onPeat) facts.push(w.peat);
  facts.push(fill(w.last, { time: f.time(incident.lastDetectedAt) }));
  if (incident.nearestPlace) facts.push(fill(w.near, { place: f.place(incident.nearestPlace) }));
  if (incident.modisOnly && incident.locationUncertaintyM) facts.push(fill(w.uncertain, { km: f.km(incident.locationUncertaintyM) }));
  return [where, facts.join(' · '), `${w.location}: ${mapUrl(incident.centroid)}`, `${w.detail}: ${location.origin}${incident.sharePath}`, w.caveat].filter(Boolean).join('\n');
}

/** Shares through the phone's share sheet, or WhatsApp where there is none. */
export function shareText(message: string) {
  if (navigator.share && matchMedia('(pointer: coarse)').matches) return navigator.share({ text: message }).then(() => true).catch(() => false);
  window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
  return Promise.resolve(true);
}
/** @deprecated use shareText(waText(incident, lang)). */
export const shareCard = (text: string, path: string) => shareText(`${text}\n${location.origin}${path}`);

export function Banner({ tone, icon, children }: { tone?: 'warn' | 'ok'; icon?: ReactNode; children: ReactNode }) {
  return <div className={`banner ${tone ? `banner-${tone}` : ''}`}>{icon}<div>{children}</div></div>;
}

export function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true), down = () => setOnline(false);
    window.addEventListener('online', up); window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  return online;
}

/** The text for an API error in the current language. */
export function useErrorText() {
  const { lang } = useLang();
  return (error: unknown) => {
    const code = (error instanceof ApiError ? error.code : 'ERROR') as ErrorCode;
    return errorText[lang][code] ?? (error instanceof Error ? error.message : errorText[lang].ERROR);
  };
}

// One poll of /ingest/status for the whole app. `version` changes when a new ingest run lands, so lists and map
// tiles can reload; the top bar shows the status itself.
interface DataVersion { status: IngestStatus | null; version: number }
const DataVersionContext = createContext<DataVersion>({ status: null, version: 0 });
export function DataVersionProvider({ children, intervalMs = 5 * 60_000 }: { children: ReactNode; intervalMs?: number }) {
  const [state, setState] = useState<DataVersion>({ status: null, version: 0 });
  const last = useRef<number | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => api<{ data: IngestStatus }>('/ingest/status').then(body => {
      if (!alive) return;
      const runId = body.data.runId ?? body.data.runs?.[0]?.id ?? null;
      setState(previous => ({ status: body.data, version: last.current !== null && runId !== last.current ? previous.version + 1 : previous.version }));
      last.current = runId;
    }).catch(() => {});
    void load();
    const timer = setInterval(load, intervalMs);
    const visible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', visible);
    return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [intervalMs]);
  return <DataVersionContext.Provider value={state}>{children}</DataVersionContext.Provider>;
}
export const useDataVersion = () => useContext(DataVersionContext);

export interface Loaded<T> { data: T | null; error: string | null; loading: boolean; reload(): void }
/** GET /api/v1{path}; reloads when the path changes, when reload() is called, or when `version` changes. */
export function useApi<T>(path: string | null, version = 0): Loaded<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: Boolean(path) });
  const [tick, setTick] = useState(0);
  const describe = useErrorText();
  useEffect(() => {
    if (!path) return;
    let alive = true;
    setState(previous => ({ ...previous, loading: true }));
    api<{ data: T }>(path).then(body => { if (alive) setState({ data: body.data, error: null, loading: false }); })
      .catch(error => { if (alive) setState(previous => ({ data: previous.data, error: describe(error), loading: false })); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, version]);
  return { ...state, reload: () => setTick(value => value + 1) };
}

export function Clock({ iso }: { iso: string }) { return <time dateTime={iso} title={wibDay(iso)}>{wib(iso)}</time>; }
