// Daily true-colour imagery from NASA GIBS (public, no key) for the map's imagery layer. Terra passes in the
// morning and NOAA-20 around midday; GIBS publishes a pass about three hours later, so the newest complete image
// changes during the day.

export interface DailyLayer { layer: string; satellite: 'Terra' | 'NOAA-20'; date: string; part: 'morning' | 'midday'; tiles: string; maxzoom: number }

const wibParts = (now: Date) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(now).map(part => [part.type, part.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
};
const previousDay = (date: string) => new Date(Date.parse(`${date}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const make = (layer: string, satellite: DailyLayer['satellite'], date: string, part: DailyLayer['part']): DailyLayer => ({
  layer, satellite, date, part, maxzoom: 9,
  tiles: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
});

/** The newest complete daily image at this moment (WIB). */
export function dailyLayer(now = new Date()): DailyLayer {
  const { date, hour } = wibParts(now);
  if (hour >= 17) return make('VIIRS_NOAA20_CorrectedReflectance_TrueColor', 'NOAA-20', date, 'midday');
  if (hour >= 12) return make('MODIS_Terra_CorrectedReflectance_TrueColor', 'Terra', date, 'morning');
  return make('VIIRS_NOAA20_CorrectedReflectance_TrueColor', 'NOAA-20', previousDay(date), 'midday');
}
