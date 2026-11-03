// The map legend: regency bubbles when zoomed out, else incident priority and the hotspots.
import type { CSSProperties, ReactNode } from 'react';
import { dict, useT } from '../i18n';
import { useFormat } from '../format';
import { colors } from './style';

const text = dict({
  id: {
    legend: 'Legenda', incidents: 'Prioritas kejadian', checked: 'Sudah dicek', assigned: 'Ditugaskan', sizeNote: 'titik panas per kejadian', modisOnly: 'Hanya MODIS, lokasi ±1 km',
    hotspots: 'Titik panas menurut umur', hotspotsConfidence: 'Titik panas menurut keyakinan', newest: '≤ 3 jam', today: 'Hari ini', older: 'Lebih lama',
    archiveNewest: '21.00–24.00', archiveToday: 'Hari itu', archiveOlder: 'Hari sebelumnya',
    confHigh: 'Tinggi', confNominal: 'Sedang', confLow: 'Rendah', modisRing: 'Piksel MODIS, lokasi ±1 km',
    boxes: 'Kotak = perkiraan piksel satelit. Titik panas bisa di mana saja di dalam kotak (VIIRS 375 m, MODIS 1 km di bawah satelit, makin besar ke tepi lintasan).',
    regencies: 'Kejadian per kabupaten', bubble: 'Prioritas tinggi, belum dicek atau ditugaskan', bubbleNone: 'Tidak ada prioritas tinggi yang menunggu',
    bubbleNote: 'Ukuran lingkaran mengikuti jumlah kejadian. Klik lingkaran atau perbesar peta untuk melihat tiap kejadian.',
  },
  en: {
    legend: 'Legend', incidents: 'Incident priority', checked: 'Checked', assigned: 'Assigned', sizeNote: 'hotspots per incident', modisOnly: 'MODIS only, location ±1 km',
    hotspots: 'Hotspots by age', hotspotsConfidence: 'Hotspots by confidence', newest: '≤ 3 h', today: 'Today', older: 'Older',
    archiveNewest: '21:00–24:00', archiveToday: 'That day', archiveOlder: 'Earlier days',
    confHigh: 'High', confNominal: 'Nominal', confLow: 'Low', modisRing: 'MODIS pixel, location ±1 km',
    boxes: 'Box = approximate satellite pixel. The hotspot can be anywhere inside the box (VIIRS 375 m, MODIS 1 km below the satellite, larger toward the edge of the swath).',
    regencies: 'Incidents per regency', bubble: 'High priority, not checked or assigned', bubbleNone: 'No high priority waiting',
    bubbleNote: 'Circle size follows the number of incidents. Click a circle or zoom in to see each incident.',
  },
});
const levelKey = { tinggi: 'high', sedang: 'medium', rendah: 'low' } as const;

interface Props {
  /** Zoomed out with regency bubbles: the legend explains just those. */
  bubbles: boolean;
  /** The tiles carry the hotspot age; older tiles only the confidence. */
  ageAware: boolean;
  /** An archive day: ages count back from the end of that day. */
  archive: boolean;
  /** Zoomed in far enough that hotspots are drawn as pixel boxes. */
  boxes: boolean;
  closeButton: ReactNode;
}

export function Legend({ bubbles, ageAware, archive, boxes, closeButton }: Props) {
  const t = useT(text), f = useFormat();
  const [newest, today, older] = !ageAware ? (['confHigh', 'confNominal', 'confLow'] as const)
    : archive ? (['archiveNewest', 'archiveToday', 'archiveOlder'] as const) : (['newest', 'today', 'older'] as const);
  // A dot like the map's, or from the footprint zoom a box: a faint fill with a firm outline.
  const mark = (color: string) => (boxes ? <i className="lg-box" style={{ '--c': color } as CSSProperties} /> : <i className="lg-dot lg-small" style={{ background: color }} />);
  return (
    <div className="mapcard" role="dialog" aria-label={t('legend')}>
      {bubbles ? (<>
        <div className="mapcard-head"><h3>{t('regencies')}</h3>{closeButton}</div>
        <div className="lg-row"><i className="lg-bubble">12</i>{t('bubble')}</div>
        <div className="lg-row"><i className="lg-bubble lg-bubble-none" />{t('bubbleNone')}</div>
        <p className="lg-note">{t('bubbleNote')}</p>
      </>) : (<>
        <div className="mapcard-head"><h3>{t('incidents')}</h3>{closeButton}</div>
        <div className="lg-row lg-inline">
          {(['tinggi', 'sedang', 'rendah'] as const).map(level => <span key={level}><i className="lg-dot" style={{ background: colors[levelKey[level]] }} />{f.level(level)}</span>)}
        </div>
        <div className="lg-row lg-inline">
          <span><i className="lg-dot lg-ring" style={{ borderColor: colors.checked }} />{t('checked')}</span>
          <span><i className="lg-dot lg-ring" style={{ borderColor: colors.assigned }} />{t('assigned')}</span>
        </div>
        <div className="lg-row"><i className="lg-dot" style={{ background: colors.high, opacity: 0.55 }} />{t('modisOnly')}</div>
        <div className="lg-row lg-sizes"><span><i className="lg-dot lg-s0" />1–4</span><span><i className="lg-dot lg-s1" />5–19</span><span><i className="lg-dot lg-s2" />20+</span><small>{t('sizeNote')}</small></div>
        <h3 className="lg-title">{ageAware ? t('hotspots') : t('hotspotsConfidence')}</h3>
        <div className="lg-row lg-inline">
          <span>{mark(colors.newest)}{t(newest)}</span>
          <span>{mark(colors.today)}{t(today)}</span>
          <span>{mark(colors.older)}{t(older)}</span>
        </div>
        {boxes ? <p className="lg-note">{t('boxes')}</p>
          : <div className="lg-row"><i className="lg-dot lg-ring lg-thin" style={{ borderColor: colors.newest }} />{t('modisRing')}</div>}
      </>)}
    </div>
  );
}
