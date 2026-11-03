// Fire danger from GET /risk: the FWI grid on the map, the details of one cell, and the regencies at high danger.
// Titik Api computes the Fire Weather Index from Open-Meteo model weather and uses BMKG's four classes; it is not an
// official BMKG product, and every place that shows it says so.
import type { ExpressionSpecification } from 'maplibre-gl';
import type { FwiClass, Risk, RiskDay } from '../api';
import { dict, fill, type Lang } from '../i18n';
import { formatter } from '../format';
import { windName } from '../geo';

export const fwiClasses: FwiClass[] = ['rendah', 'sedang', 'tinggi', 'sangat_tinggi'];
/**
 * A sequential pink-to-purple ramp: it darkens with the danger, reads over the light base map and the satellite view,
 * and stays clear of the reds and ambers that mark incident priority.
 */
export const fwiColors: Record<FwiClass, string> = { rendah: '#FCC5C0', sedang: '#F768A1', tinggi: '#C51B8A', sangat_tinggi: '#49006A' };
/** Fill opacity around 0.35, a little stronger for the higher classes so they stay apart over the light base map. */
export const fwiOpacity: Record<FwiClass, number> = { rendah: 0.25, sedang: 0.32, tinggi: 0.4, sangat_tinggi: 0.5 };
/** BMKG's class bounds on the FWI value. */
export const fwiRange: Record<FwiClass, string> = { rendah: '0–1', sedang: '2–6', tinggi: '7–13', sangat_tinggi: '> 13' };
export const BMKG_FWI_URL = 'https://www.bmkg.go.id/cuaca/karhutla/fwi';
export const OPEN_METEO_ATTRIBUTION = 'Open-Meteo.com (CC BY 4.0)';

export const fwiLabel: Record<Lang, Record<FwiClass, string>> = {
  id: { rendah: 'Rendah', sedang: 'Sedang', tinggi: 'Tinggi', sangat_tinggi: 'Sangat tinggi' },
  en: { rendah: 'Low', sedang: 'Moderate', tinggi: 'High', sangat_tinggi: 'Very high' },
};

export const riskText = dict({
  id: {
    forecast: 'prakiraan', dc: 'Kode kekeringan (DC)', temp: 'Suhu pukul 12.00', rh: 'Kelembapan pukul 12.00', wind: 'Angin pukul 12.00',
    windValue: 'dari {dir}, {speed} km/jam', rain: 'Hujan 24 jam sampai 12.00', dry: 'Hari tanpa hujan', dryDays: '{n} hari',
    dcNote: 'DC di atas 400: kabut asap dari gambut jauh lebih sering (de Groot dkk. 2007)',
  },
  en: {
    forecast: 'forecast', dc: 'Drought Code (DC)', temp: 'Temperature at 12:00', rh: 'Humidity at 12:00', wind: 'Wind at 12:00',
    windValue: 'from the {dir}, {speed} km/h', rain: 'Rain, 24 h to 12:00', dry: 'Days without rain', dryDays: '{n} days',
    dcNote: 'DC above 400: haze from peat is far more frequent (de Groot et al. 2007)',
  },
});

/** GET /risk for live data (today and the next two days) or for one archive day. */
export const riskPath = (tanggal: string) => (tanggal ? `/risk?tanggal=${tanggal}` : '/risk');

/** Router state of a link that opens the map on live data with the fire danger layer on a given day (0 today). */
export interface RiskLink { riskDay: number }
export function riskLinkDay(state: unknown): number | null {
  const day = (state as Partial<RiskLink> | null)?.riskDay;
  return typeof day === 'number' && Number.isInteger(day) && day >= 0 ? day : null;
}

/** The fill colour and opacity of a grid cell by its class; a cell without one stays clear. */
export const riskFill = ['match', ['get', 'fwiClass'], ...fwiClasses.flatMap(name => [name, fwiColors[name]]), 'rgba(0,0,0,0)'] as unknown as ExpressionSpecification;
export const riskOpacity = ['match', ['get', 'fwiClass'], ...fwiClasses.flatMap(name => [name, fwiOpacity[name]]), 0] as unknown as ExpressionSpecification;

/** One square per grid cell for a day (0 = the first day): the centre ± cellSize/2, with the cell's index and class. */
export function riskFeatures(risk: Risk, dayIndex: number): GeoJSON.FeatureCollection {
  const half = risk.cellSize / 2;
  const features: GeoJSON.Feature[] = [];
  risk.cells.forEach((cell, index) => {
    const day = cell.days[dayIndex];
    if (!day) return;
    const [west, east, south, north] = [cell.lon - half, cell.lon + half, cell.lat - half, cell.lat + half];
    features.push({ type: 'Feature', properties: { cell: index, fwiClass: day.fwiClass, fwi: day.codes.fwi },
      geometry: { type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] } });
  });
  return { type: 'FeatureCollection', features };
}

export interface RiskRow { key: string; label: string; value: string }
/** One cell on one day in words: the date (marked as forecast), the class with its FWI value, the codes and the weather. */
export function riskDetail(day: RiskDay, lang: Lang) {
  const f = formatter(lang), w = riskText[lang];
  const rows: RiskRow[] = [
    { key: 'dc', label: w.dc, value: f.num(day.codes.dc) },
    { key: 'temp', label: w.temp, value: `${f.num(day.noon.tempC)} °C` },
    { key: 'rh', label: w.rh, value: `${f.num(day.noon.rhPct)}%` },
    { key: 'wind', label: w.wind, value: fill(w.windValue, { dir: windName(day.noon.windFromDeg, lang), speed: f.num(day.noon.windKmh) }) },
    { key: 'rain', label: w.rain, value: `${f.num(day.noon.rain24hMm, 1)} mm` },
    { key: 'dry', label: w.dry, value: fill(w.dryDays, { n: f.num(day.dryDays) }) },
  ];
  return {
    title: day.forecast ? `${f.weekdayDate(day.date)} · ${w.forecast}` : f.weekdayDate(day.date),
    classLine: `${fwiLabel[lang][day.fwiClass]} · FWI ${f.num(day.codes.fwi, 1)}`,
    rows,
    dcNote: day.codes.dc > 400 ? w.dcNote : null,
  };
}

const high = (name: FwiClass) => name === 'tinggi' || name === 'sangat_tinggi';

/** Regencies at tinggi or sangat tinggi on a day (1 = tomorrow live), highest FWI first; `province` narrows to one province. */
export function highDanger(risk: Risk, dayIndex: number, province = '') {
  return risk.regencies
    .filter(regency => !province || regency.province === province)
    .flatMap(regency => {
      const day = regency.days[dayIndex];
      return day && high(day.fwiClass) ? [{ name: regency.name, province: regency.province, fwiClass: day.fwiClass, fwi: day.codes.fwi }] : [];
    })
    .sort((a, b) => b.fwi - a.fwi || a.name.localeCompare(b.name));
}

/** Each regency's day (0 = the first day) by "province/name", for tables. Empty when nothing was computed. */
export function regencyDays(risk: Risk | null | undefined, dayIndex = 0) {
  const days = new Map<string, RiskDay>();
  if (!risk?.fetchedAt) return days;
  for (const regency of risk.regencies) {
    const day = regency.days[dayIndex];
    if (day) days.set(`${regency.province}/${regency.name}`, day);
  }
  return days;
}
