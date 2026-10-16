import { useEffect, useState } from 'react';
import { dict, useT } from '../../i18n';
import { useFormat } from '../../format';
import { satelliteName } from '../../i18n/common';
import { useDataVersion } from '../ui';
import { readFreshness, roughMinutes, type PassWindow } from './freshness';
import { usePopover } from './popover';

const text = dict({
  id: {
    data: 'Data satelit {time} WIB ({sat})', noData: 'Belum ada data satelit', checked: 'Diperiksa {time}, tiap {n} menit', checkedShort: 'Diperiksa {time}',
    next: 'Lintasan berikutnya ±{span} WIB', eta: 'masuk dalam {eta}', etaMin: '±{n} menit', etaHour: '±{n} jam',
    title: 'Data satelit', newest: 'Lintasan terbaru {sat} pukul {time} WIB.',
    checkedLong: 'Diperiksa {time} WIB. Server memeriksa NASA FIRMS tiap {n} menit.', nextRun: 'Pemeriksaan berikutnya {time} WIB.',
    nextLong: 'Lintasan berikutnya ±{span} WIB.', etaLong: 'Datanya masuk dalam {eta}.',
    failed: 'Pemeriksaan terakhir gagal. Server mencoba lagi pada jadwal berikutnya.', overdue: 'Data lintasan {sat} ±{span} WIB belum masuk.',
    colSat: 'Satelit', colLast: 'Lintasan terakhir', colNext: 'Berikutnya', inactive: 'Tidak aktif',
    delay: 'NASA FIRMS merilis titik panas paling lambat ±3 jam setelah satelit melintas.', open: 'Rincian data satelit',
  },
  en: {
    data: 'Satellite data {time} WIB ({sat})', noData: 'No satellite data yet', checked: 'Checked {time}, every {n} min', checkedShort: 'Checked {time}',
    next: 'Next pass ±{span} WIB', eta: 'arrives in {eta}', etaMin: '±{n} min', etaHour: '±{n} h',
    title: 'Satellite data', newest: 'Newest pass {sat} at {time} WIB.',
    checkedLong: 'Checked {time} WIB. The server checks NASA FIRMS every {n} minutes.', nextRun: 'Next check {time} WIB.',
    nextLong: 'Next pass ±{span} WIB.', etaLong: 'Its data arrives in {eta}.',
    failed: 'The last check failed. The server tries again at the next run.', overdue: 'Data from the {sat} pass ±{span} WIB has not arrived.',
    colSat: 'Satellite', colLast: 'Last pass', colNext: 'Next', inactive: 'Inactive',
    delay: 'NASA FIRMS releases hotspots up to about 3 hours after the satellite passes.', open: 'Satellite data details',
  },
});

/** Re-renders every minute so "masuk dalam" and overdue passes stay current between status polls. */
function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), intervalMs); return () => clearInterval(timer); }, [intervalMs]);
  return now;
}

/** Pass-aware freshness: newest acquisition, last check, next pass. Compact on small screens, details in a popover. */
export function Freshness() {
  const t = useT(text), f = useFormat();
  const { status } = useDataVersion();
  const now = useNow();
  const { open, toggle, root } = usePopover();
  const info = readFreshness(status, now);
  if (!info) return null;
  const today = f.day(new Date(now));
  const when = (iso: string) => (f.day(iso) === today ? f.time(iso) : f.dayTime(iso));
  const span = (w: PassWindow) => `${when(w.start)}–${f.time(w.end)}`;
  const rough = info.next ? roughMinutes((new Date(info.next.expectedBy).getTime() - now) / 60_000) : null;
  const eta = rough ? t(rough.unit === 'min' ? 'etaMin' : 'etaHour', { n: rough.n }) : null;
  const data = info.latest ? t('data', { time: when(info.latest.at), sat: satelliteName(info.latest.code) }) : t('noData');
  const checked = info.checkedAt ? t('checked', { time: f.time(info.checkedAt), n: info.intervalMinutes }) : null;
  const nextShort = info.next ? t('next', { span: span(info.next) }) : null;
  const next = nextShort && eta ? `${nextShort}, ${t('eta', { eta })}` : nextShort;
  const short = [info.checkedAt ? t('checkedShort', { time: f.time(info.checkedAt) }) : null, nextShort].filter(Boolean).join(' · ');
  const overdue = info.satellites.filter(s => s.overdue);
  return (
    <div className="fresh" ref={root}>
      <button type="button" className="fresh-btn" aria-expanded={open} aria-haspopup="dialog" aria-label={`${t('open')}. ${data}`} onClick={toggle}>
        <i className={`live-dot ${info.stale ? 'stale' : ''}`} aria-hidden="true" />
        <span className="fresh-compact">{info.latest ? `${when(info.latest.at)} WIB` : t('noData')}</span>
        <span className="fresh-parts">
          <span className="fresh-line">{data}</span>
          {short && <span className="fresh-line fresh-sub fresh-short">{short}</span>}
          {(checked || next) && <span className="fresh-line fresh-sub fresh-long">{[checked, next].filter(Boolean).join(' · ')}</span>}
        </span>
      </button>
      {open && (
        <div className="fresh-pop" role="dialog" aria-label={t('title')}>
          <h3 className="heading-16">{t('title')}</h3>
          <div className="fresh-facts">
            {info.latest && <p>{t('newest', { sat: satelliteName(info.latest.code), time: when(info.latest.at) })}</p>}
            {info.checkedAt && <p>{t('checkedLong', { time: f.time(info.checkedAt), n: info.intervalMinutes })}{info.nextRunAt ? ` ${t('nextRun', { time: f.time(info.nextRunAt) })}` : ''}</p>}
            {info.next && <p>{t('nextLong', { span: span(info.next) })}{eta ? ` ${t('etaLong', { eta })}` : ''}</p>}
            {info.failed && <p className="fresh-warn">{t('failed')}</p>}
            {overdue.map(s => <p key={s.code} className="fresh-warn">{t('overdue', { sat: satelliteName(s.code), span: span(s.next!) })}</p>)}
          </div>
          {info.satellites.length > 0 && (
            <table className="fresh-table">
              <thead><tr><th>{t('colSat')}</th><th>{t('colLast')}</th><th>{t('colNext')}</th></tr></thead>
              <tbody>{info.satellites.map(s => (
                <tr key={s.code} className={s.active ? '' : 'off'}>
                  <td>{s.label}</td>
                  <td>{s.latest ? `${when(s.latest)} WIB` : '–'}</td>
                  <td>{!s.active ? t('inactive') : s.next ? `±${span(s.next)} WIB` : '–'}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          <p className="note">{t('delay')}</p>
        </div>
      )}
    </div>
  );
}
