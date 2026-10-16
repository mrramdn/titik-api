// The kabupaten column: open high-priority incidents per regency, most first. Choosing one filters the rest of the screen.
import { useMemo } from 'react';
import type { RegionSummary } from '../../api';
import { dict, useT } from '../../i18n';
import { useFormat } from '../../format';
import { regionOpenHigh } from './data';

const text = dict({
  id: {
    title: 'Kabupaten', action: 'Perlu tindakan', all: 'Semua kabupaten', incidents1: '1 kejadian', incidents: '{n} kejadian',
    row: '{name}: {action} perlu tindakan, {incidents}', quiet: '{n} kabupaten lain tanpa kejadian.',
    none: 'Tidak ada kejadian di kabupaten mana pun dalam rentang ini.',
  },
  en: {
    title: 'Regencies', action: 'Needs action', all: 'All regencies', incidents1: '1 incident', incidents: '{n} incidents',
    row: '{name}: {action} need action, {incidents}', quiet: '{n} other regencies have no incidents.',
    none: 'No incidents in any regency in this window.',
  },
});

interface Props {
  rows: RegionSummary[];
  selected: string;
  onSelect(name: string): void;
  /** The Perlu tindakan lane count for the selected regency, so its row and the lane show the same number. */
  selectedCount?: number;
}

export function RegencyList({ rows, selected, onSelect, selectedCount }: Props) {
  const t = useT(text), f = useFormat();
  const sorted = useMemo(() => rows.map(row => ({ name: row.name, incidents: row.incidents ?? 0, openHigh: regionOpenHigh(row) }))
    .sort((a, b) => b.openHigh - a.openHigh || b.incidents - a.incidents || a.name.localeCompare(b.name)), [rows]);
  const shown = sorted.filter(row => row.incidents > 0 || row.name === selected);
  const quiet = sorted.length - shown.length;
  const count = (row: { name: string; openHigh: number }) => (row.name === selected && selectedCount !== undefined ? selectedCount : row.openHigh);
  const total = sorted.reduce((sum, row) => sum + row.openHigh, 0);
  const incidents = (n: number) => (n === 1 ? t('incidents1') : t('incidents', { n: f.num(n) }));
  return (
    <aside className="bd-regencies" aria-label={t('title')}>
      <div className="bd-regencies-head"><h2 className="heading-16">{t('title')}</h2><span className="caption">{t('action')}</span></div>
      <button type="button" className={`bd-regency ${selected === '' ? 'on' : ''}`} aria-pressed={selected === ''} onClick={() => onSelect('')}>
        <span className="bd-regency-name">{t('all')}</span>
        <b className={total ? 'hot' : ''}>{f.num(total)}</b>
      </button>
      {shown.map(row => (
        <button key={row.name} type="button" className={`bd-regency ${selected === row.name ? 'on' : ''}`} aria-pressed={selected === row.name}
          aria-label={t('row', { name: row.name, action: f.num(count(row)), incidents: incidents(row.incidents) })}
          onClick={() => onSelect(selected === row.name ? '' : row.name)}>
          <span className="bd-regency-name">{row.name}<small>{incidents(row.incidents)}</small></span>
          <b className={count(row) ? 'hot' : ''}>{f.num(count(row))}</b>
        </button>
      ))}
      {!shown.length && <p className="bd-quiet">{t('none')}</p>}
      {shown.length > 0 && quiet > 0 && <p className="bd-quiet">{t('quiet', { n: f.num(quiet) })}</p>}
    </aside>
  );
}
