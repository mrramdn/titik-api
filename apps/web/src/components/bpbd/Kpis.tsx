// Four numbers over the same time window. Each one is a button that narrows the lanes, the map and the village table.
import { dict, useT } from '../../i18n';
import { useFormat } from '../../format';
import type { Count } from './data';

/** Which part of the work the screen shows: everything, checked incidents, the response pipeline, or open high priority. */
export type Focus = 'all' | 'checked' | 'response' | 'action';
export const focusKeys: Focus[] = ['all', 'checked', 'response', 'action'];

const text = dict({
  id: {
    group: 'Ringkasan. Pilih angka untuk menyaring kolom, peta, dan tabel.',
    all: 'Kejadian', allNote: '{n} titik panas',
    checked: 'Sudah dicek', of: 'dari {n}', checkedNote: '{p} dari semua kejadian',
    response: 'Waktu tanggap', responseNote: 'Median dari deteksi ke cek pertama',
    action: 'Tinggi belum ditangani', actionNote: 'Dari {n} kejadian prioritas tinggi',
  },
  en: {
    group: 'Summary. Choose a number to filter the lanes, the map and the table.',
    all: 'Incidents', allNote: '{n} hotspots',
    checked: 'Checked', of: 'of {n}', checkedNote: '{p} of all incidents',
    response: 'Response time', responseNote: 'Median from detection to first check',
    action: 'High priority, not handled', actionNote: 'Of {n} high-priority incidents',
  },
});

interface Props {
  focus: Focus;
  onFocus(focus: Focus): void;
  incidents: number | null;
  detections: number | null;
  high: number | null;
  medianMinutes: number | null;
  /** Shared with the lanes: the Selesai and Perlu tindakan counts. */
  checked: Count | null;
  action: Count | null;
}

export function Kpis({ focus, onFocus, incidents, detections, high, medianMinutes, checked, action }: Props) {
  const t = useT(text), f = useFormat();
  const count = (value: Count | null) => (value ? `${f.num(value.value)}${value.more ? '+' : ''}` : '–');
  const share = checked && incidents ? f.percent(checked.value / incidents) : null;
  const items: { key: Focus; value: string; of?: string; note: string }[] = [
    { key: 'all', value: incidents === null ? '–' : f.num(incidents), note: detections === null ? '' : t('allNote', { n: f.num(detections) }) },
    { key: 'checked', value: count(checked), of: incidents === null ? undefined : t('of', { n: f.num(incidents) }), note: share ? t('checkedNote', { p: share }) : '' },
    { key: 'response', value: medianMinutes === null ? '–' : f.duration(medianMinutes), note: t('responseNote') },
    { key: 'action', value: count(action), note: high === null ? '' : t('actionNote', { n: f.num(high) }) },
  ];
  return (
    <div className="bd-kpis" role="group" aria-label={t('group')}>
      {items.map(item => (
        <button key={item.key} type="button" className={`bd-kpi ${focus === item.key ? 'on' : ''} ${item.key === 'action' && action?.value ? 'hot' : ''}`}
          aria-pressed={focus === item.key} onClick={() => onFocus(focus === item.key ? 'all' : item.key)}>
          <span className="bd-kpi-label">{t(item.key)}</span>
          <span className="bd-kpi-value">{item.value}{item.of && <small>{item.of}</small>}</span>
          <span className="bd-kpi-note">{item.note}</span>
        </button>
      ))}
    </div>
  );
}
