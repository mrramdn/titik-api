// Hotspots per day over the last seven days (WIB), in ink: the bars count detections and say nothing about priority.
import { useFormat } from '../../format';
import { dict, useT } from '../../i18n';

const text = dict({
  id: { label: 'Titik panas per hari, 7 hari terakhir: {days}' },
  en: { label: 'Hotspots per day, last 7 days: {days}' },
});

export function Bars7({ daily, compact = false }: { daily: { day: string; detections: number }[]; compact?: boolean }) {
  const t = useT(text), f = useFormat();
  const max = Math.max(1, ...daily.map(item => item.detections));
  const label = (day: string) => (compact ? String(Number(day.slice(8))) : f.day(`${day}T12:00:00+07:00`));
  return (
    <div className={`v-bars ${compact ? 'v-bars-compact' : ''}`} role="img"
      aria-label={t('label', { days: daily.map(item => `${label(item.day)} ${f.num(item.detections)}`).join(', ') })}>
      {daily.map(item => (
        <div key={item.day}>
          <i style={{ height: `${Math.max(2, (item.detections / max) * 100)}%` }} className={item.detections ? '' : 'zero'} />
          {!compact && <b>{f.num(item.detections)}</b>}
          <span>{label(item.day)}</span>
        </div>
      ))}
    </div>
  );
}
