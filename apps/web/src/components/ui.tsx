import { useEffect, useState, type ReactNode } from 'react';
import { Flame } from 'lucide-react';
import type { Level, ScorePart, Status } from '../api';
import { api } from '../api';
import { levelLabel, statusLabel, wib, wibDay } from '../format';

export function LevelBadge({ level }: { level: Level }) { return <span className={`badge badge-${level}`}>{levelLabel[level]}</span>; }

export function StatusText({ status, demo }: { status: Status | null; demo?: boolean }) {
  if (!status) return <span className="status status-open">Belum dicek</span>;
  return <span className={`status status-${status}`}>{statusLabel[status]}{demo ? ' · demo' : ''}</span>;
}

export function FlameTile({ level, checked, size = 18 }: { level: Level; checked?: boolean; size?: number }) {
  return <span className={`tile tile-${level} ${checked ? 'tile-checked' : ''}`}><Flame size={size} /></span>;
}

export function ScoreRows({ parts, score }: { parts: ScorePart[]; score: number }) {
  return (
    <>
      <div className="score-head"><span className="label on-dark">Skor prioritas</span><span className="number-20">{score} <span className="muted" style={{ fontSize: 13 }}>/ 100</span></span></div>
      <div>{parts.map(part => (
        <div key={part.key} className={`score-row ${part.points < 0 ? 'minus' : part.points === 0 ? 'zero' : ''}`}>
          <span>{part.label}</span>
          <span className="bar"><i style={{ width: `${Math.min(100, (Math.abs(part.points) / 30) * 100)}%` }} /></span>
          <b>{part.points > 0 ? `+${part.points}` : part.points}</b>
        </div>
      ))}</div>
      <p className="note">Aturan terbuka, bukan model AI. Tinggi ≥ 60, sedang 35–59.</p>
    </>
  );
}

/** Shares a card through the phone's share sheet, or WhatsApp when there is none. */
export function shareCard(text: string, path: string) {
  const message = `${text}\n${location.origin}${path}`;
  if (navigator.share && matchMedia('(pointer: coarse)').matches) return navigator.share({ text: message }).then(() => true).catch(() => false);
  window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
  return Promise.resolve(true);
}

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

export interface Loaded<T> { data: T | null; error: string | null; loading: boolean; reload(): void }
export function useApi<T>(path: string | null): Loaded<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: Boolean(path) });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    setState(previous => ({ ...previous, loading: true }));
    api<{ data: T }>(path).then(body => { if (alive) setState({ data: body.data, error: null, loading: false }); })
      .catch(error => { if (alive) setState(previous => ({ data: previous.data, error: error.message, loading: false })); });
    return () => { alive = false; };
  }, [path, tick]);
  return { ...state, reload: () => setTick(value => value + 1) };
}

export function Clock({ iso }: { iso: string }) { return <time dateTime={iso} title={wibDay(iso)}>{wib(iso)}</time>; }
