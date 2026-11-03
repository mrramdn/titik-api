// Archive controls on the map screen: "Terkini | Arsip", a bar per archive day to pick from, and the banner that says
// an archive day is on screen.
import { useEffect, useRef } from 'react';
import { CalendarClock } from 'lucide-react';
import type { ArchiveDays } from '../api';
import { dict, useT } from '../i18n';
import { useFormat } from '../format';
import { barHeights, busiestDay } from './archive';

const text = dict({
  id: {
    when: 'Waktu', live: 'Terkini', archive: 'Arsip', date: 'Tanggal arsip', day: '{date}, {n} titik panas', chart: 'Titik panas per hari',
    banner: 'Arsip · {date} · data satelit asli', back: 'Kembali ke data terkini',
  },
  en: {
    when: 'Time', live: 'Live', archive: 'Archive', date: 'Archive date', day: '{date}, {n} hotspots', chart: 'Hotspots per day',
    banner: 'Archive · {date} · real satellite data', back: 'Back to live data',
  },
});

/** "Terkini | Arsip". Switching to the archive opens its busiest day. */
export function ArchiveSwitch({ archive, tanggal, onChange }: { archive: ArchiveDays; tanggal: string; onChange(tanggal: string): void }) {
  const t = useT(text);
  return (
    <div className="fseg" role="group" aria-label={t('when')}>
      <button type="button" className={tanggal ? '' : 'on'} aria-pressed={!tanggal} onClick={() => onChange('')}>{t('live')}</button>
      <button type="button" className={tanggal ? 'on' : ''} aria-pressed={Boolean(tanggal)} onClick={() => { if (!tanggal) onChange(busiestDay(archive.days)); }}>{t('archive')}</button>
    </div>
  );
}

/**
 * One bar per archive day, oldest on the left, its height by the day's detections; a tap picks the day. The bars are
 * for pointers only: keyboards and screen readers use the list of days under them, which names each day's count.
 */
export function ArchivePicker({ archive, tanggal, onChange }: { archive: ArchiveDays; tanggal: string; onChange(tanggal: string): void }) {
  const t = useT(text), f = useFormat();
  const bars = useRef<HTMLDivElement>(null);
  const heights = barHeights(archive.days);
  const label = (date: string, detections: number) => t('day', { date: f.calendar(date), n: f.num(detections) });
  const first = archive.days[0], last = archive.days[archive.days.length - 1];
  // With more days than fit, the bars scroll sideways and the chosen one stays in the middle (the page does not move).
  useEffect(() => {
    const box = bars.current, bar = box?.querySelector<HTMLElement>('.on');
    if (box && bar && box.scrollWidth > box.clientWidth) box.scrollLeft = bar.offsetLeft - (box.clientWidth - bar.offsetWidth) / 2;
  }, [tanggal, archive.days.length]);
  return (
    <div className="archive-pick">
      <div ref={bars} className="archive-bars" aria-hidden="true" title={t('chart')}>
        {archive.days.map((day, index) => (
          <button key={day.date} type="button" tabIndex={-1} className={day.date === tanggal ? 'on' : ''} title={label(day.date, day.detections)} onClick={() => onChange(day.date)}>
            <i style={{ height: `${(heights[index] ?? 0) * 100}%` }} />
          </button>
        ))}
      </div>
      {first && last && <div className="archive-axis" aria-hidden="true"><span>{f.day(`${first.date}T12:00:00+07:00`)}</span><span>{f.day(`${last.date}T12:00:00+07:00`)}</span></div>}
      <select className="fselect archive-select" aria-label={t('date')} value={tanggal} onChange={event => onChange(event.target.value)}>
        {[...archive.days].reverse().map(day => <option key={day.date} value={day.date}>{label(day.date, day.detections)}</option>)}
      </select>
    </div>
  );
}

/** Across the top of the map screen while an archive day is on screen; neutral, since amber means a late satellite pass. */
export function ArchiveBanner({ tanggal, onLive }: { tanggal: string; onLive(): void }) {
  const t = useT(text), f = useFormat();
  return (
    <div className="archive-bar" role="status">
      <CalendarClock size={16} className="icon" aria-hidden="true" />
      <p>{t('banner', { date: f.weekdayDate(tanggal) })}</p>
      <button type="button" className="btn btn-secondary btn-sm" onClick={onLive}>{t('back')}</button>
    </div>
  );
}
