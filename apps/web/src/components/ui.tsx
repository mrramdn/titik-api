import { useEffect, useState, type ReactNode } from 'react';
import type { Incident, Level, ScorePart, Status } from '../api';
import { api } from '../api';
import { confidenceLabel, levelLabel, satelliteLabel, statusLabel, wib, wibDay, km } from '../format';

export function LevelBadge({ level }: { level: Level }) {
  return <span className={`level level-${level}`}>{levelLabel[level]}</span>;
}

export function StatusPill({ status, demo }: { status: Status | null; demo?: boolean }) {
  if (!status) return <span className="pill pill-open">Belum dicek</span>;
  return <span className={`pill pill-${status}`}>{statusLabel[status]}{demo ? ' · demo' : ''}</span>;
}

export function Facts({ incident }: { incident: Incident }) {
  return (
    <ul className="facts">
      <li><b>{incident.detectionCount}</b> deteksi satelit</li>
      <li>{[...new Set(incident.satellites)].map(code => satelliteLabel[code] ?? code).join(' / ')}</li>
      <li>keyakinan {confidenceLabel[incident.bestConfidence ?? 'low']}</li>
      {incident.maxFrp !== null && <li>FRP maks {incident.maxFrp.toLocaleString('id-ID', { maximumFractionDigits: 1 })} MW</li>}
      <li className={incident.onPeat ? 'fact-peat' : ''}>{incident.onPeat ? 'lahan gambut' : 'di luar peta gambut'}</li>
      {incident.settlementMeters !== null && <li>permukiman {km(incident.settlementMeters)}</li>}
    </ul>
  );
}

export function ScoreBreakdown({ parts, score, level }: { parts: ScorePart[]; score: number; level: Level }) {
  return (
    <div className="score">
      <div className="score-head"><span>Skor prioritas</span><strong>{score}</strong><LevelBadge level={level} /></div>
      <ol>
        {parts.map(part => (
          <li key={part.key} className={part.points < 0 ? 'minus' : part.points === 0 ? 'zero' : ''}>
            <span>{part.label}</span><b>{part.points > 0 ? `+${part.points}` : part.points}</b>
          </li>
        ))}
      </ol>
      <p className="fine">Aturan tetap yang bisa dicek siapa pun, bukan model AI. Tinggi ≥ 60, sedang 35–59.</p>
    </div>
  );
}

/** Shares a card through the phone's share sheet, or WhatsApp when there is none. */
export function shareCard(text: string, path: string) {
  const url = `${location.origin}${path}`;
  const message = `${text}\n${url}`;
  if (navigator.share && matchMedia('(pointer: coarse)').matches) return navigator.share({ text: message }).then(() => true).catch(() => false);
  window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
  return Promise.resolve(true);
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><h3>{title}</h3>{children}</div>;
}

export function Banner({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'ok'; children: ReactNode }) {
  return <div className={`banner banner-${tone}`}>{children}</div>;
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

export interface Loaded<T> { data: T | null; error: string | null; loading: boolean; reload(): void }
export function useApi<T>(path: string | null, deps: unknown[] = []): Loaded<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: Boolean(path) });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    setState(previous => ({ ...previous, loading: true }));
    api<{ data: T }>(path).then(body => { if (alive) setState({ data: body.data, error: null, loading: false }); })
      .catch(error => { if (alive) setState(previous => ({ data: previous.data, error: error.message, loading: false })); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, ...deps]);
  return { ...state, reload: () => setTick(value => value + 1) };
}

export function Clock({ iso }: { iso: string }) {
  return <time dateTime={iso} title={wibDay(iso)}>{wib(iso)} WIB</time>;
}
