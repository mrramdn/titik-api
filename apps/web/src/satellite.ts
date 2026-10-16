// Daily true-colour satellite imagery from NASA GIBS (public, no key). Terra passes in the morning and NOAA-20
// around midday; GIBS publishes a pass about three hours later, so the newest complete image changes during the day.
import type { Lang } from './i18n';

export interface DailyImagery { layer: string; satellite: 'Terra' | 'NOAA-20'; date: string; tiles: string; maxzoom: number; label: Record<Lang, string> }

const parts = (now: Date) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(now).map(part => [part.type, part.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
};
const previousDay = (date: string) => new Date(Date.parse(`${date}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const shortDate = (date: string, lang: Lang) => new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`)).replace('.', '');

function make(layer: string, satellite: DailyImagery['satellite'], date: string, part: Record<Lang, string>): DailyImagery {
  return {
    layer, satellite, date, maxzoom: 9,
    tiles: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
    label: { id: `Citra ${satellite}, ${shortDate(date, 'id')} ${part.id}`, en: `${satellite} image, ${shortDate(date, 'en')} ${part.en}` },
  };
}

/** The newest complete daily image at this moment (WIB). */
export function dailyImagery(now = new Date()): DailyImagery {
  const { date, hour } = parts(now);
  if (hour >= 17) return make('VIIRS_NOAA20_CorrectedReflectance_TrueColor', 'NOAA-20', date, { id: 'siang', en: 'midday' });
  if (hour >= 12) return make('MODIS_Terra_CorrectedReflectance_TrueColor', 'Terra', date, { id: 'pagi', en: 'morning' });
  return make('VIIRS_NOAA20_CorrectedReflectance_TrueColor', 'NOAA-20', previousDay(date), { id: 'siang', en: 'midday' });
}
