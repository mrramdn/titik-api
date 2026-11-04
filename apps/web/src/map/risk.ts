// Fire danger from GET /risk: the FWI grid on the map, the details of one cell, and the regencies where high danger
// covers part of the area.
// Titik Api computes the Fire Weather Index from Open-Meteo model weather and uses BMKG's four classes; it is not an
// official BMKG product, and every place that shows it says so.
import type { ExpressionSpecification } from 'maplibre-gl';
import type { FwiClass, RegencyRiskDay, Risk, RiskDay } from '../api';
import { dict, fill, type Lang } from '../i18n';
import { formatter } from '../format';
import { windName } from '../geo';
import { shiftDate, todayWib } from '../components/bpbd/data';

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

export const fwiLabel: Record<Lang, Record<FwiClass, string>> = {
  id: { rendah: 'Rendah', sedang: 'Sedang', tinggi: 'Tinggi', sangat_tinggi: 'Sangat tinggi' },
  en: { rendah: 'Low', sedang: 'Moderate', tinggi: 'High', sangat_tinggi: 'Very high' },
};

export const riskText = dict({
  id: {
    forecast: 'prakiraan', dc: 'Kode kekeringan (DC)', temp: 'Suhu pukul 12.00', rh: 'Kelembapan pukul 12.00', wind: 'Angin pukul 12.00',
    windValue: 'dari {dir}, {speed} km/jam', rain: 'Hujan 24 jam sampai 12.00', dry: 'Hari tanpa hujan', dryDays: '{n} hari',
    dcNote: 'DC di atas 400: kabut asap dari gambut jauh lebih sering (de Groot dkk. 2007)',
    partial: '{class} atau lebih di {p} wilayah', partialTop: '{class} di {p} wilayah',
    today: 'Hari ini', tomorrow: 'Besok', after: 'Lusa',
    ageHours: 'Dihitung {n} jam lalu', ageDay: 'Dihitung 1 hari lalu', ageDays: 'Dihitung {n} hari lalu',
  },
  en: {
    forecast: 'forecast', dc: 'Drought Code (DC)', temp: 'Temperature at 12:00', rh: 'Humidity at 12:00', wind: 'Wind at 12:00',
    windValue: 'from the {dir}, {speed} km/h', rain: 'Rain, 24 h to 12:00', dry: 'Days without rain', dryDays: '{n} days',
    dcNote: 'DC above 400: haze from peat is far more frequent (de Groot et al. 2007)',
    partial: '{class} or above in {p} of the area', partialTop: '{class} in {p} of the area',
    today: 'Today', tomorrow: 'Tomorrow', after: 'In 2 days',
    ageHours: 'Computed {n} hours ago', ageDay: 'Computed 1 day ago', ageDays: 'Computed {n} days ago',
  },
});

/**
 * A fire danger day by its date (WIB, YYYY-MM-DD) against today's WIB date: "Hari ini", "Besok" or "Lusa" only when it
 * really is that day, any other day by its short date ("2 Nov"). The service worker can answer GET /risk from a copy
 * up to three days old, whose first day is no longer today.
 */
export function riskDayLabel(date: string, lang: Lang, today = todayWib()) {
  const w = riskText[lang];
  if (date === today) return w.today;
  if (date === shiftDate(today, 1)) return w.tomorrow;
  if (date === shiftDate(today, 2)) return w.after;
  return formatter(lang).day(`${date}T12:00:00+07:00`);
}

/** Where a date sits among the grid's days, the order of the map's day switch (riskFeatures, RiskLink); -1 when it is not there. */
export const riskDayIndex = (risk: Risk, date: string) => risk.cells[0]?.days.findIndex(day => day.date === date) ?? -1;

/** The weather job runs every 3 hours, so a forecast over 6 hours old means missed runs, or a copy the service worker kept. */
const STALE_MS = 6 * 3_600_000;

/**
 * "Dihitung 8 jam lalu" once the live forecast (fetchedAt) is more than 6 hours old; null while it is fresher, for an
 * archive day (past days come from model analysis, whenever it was fetched), and before anything was computed.
 */
export function riskAge(risk: Pick<Risk, 'archive' | 'fetchedAt'>, lang: Lang, now = Date.now()) {
  if (risk.archive || !risk.fetchedAt) return null;
  const age = now - Date.parse(risk.fetchedAt);
  if (!(age > STALE_MS)) return null;
  const w = riskText[lang], hours = Math.floor(age / 3_600_000), days = Math.floor(hours / 24);
  if (hours < 24) return fill(w.ageHours, { n: formatter(lang).num(hours) });
  return days === 1 ? w.ageDay : fill(w.ageDays, { n: formatter(lang).num(days) });
}

/** GET /risk for live data (today and the next two days) or for one archive day. */
export const riskPath = (tanggal: string) => (tanggal ? `/risk?tanggal=${tanggal}` : '/risk');

/**
 * Router state of a link that opens the map on live data with the fire danger layer on a given day: its place among
 * the grid's days (riskDayIndex), 0 the first.
 */
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

/** Tinggi or above is named from 10% of a regency's area, in thousandths (the steps of the shares). */
const HIGH_MIN = 100;

/** A regency where tinggi or sangat tinggi covers at least 10% of the area: its class, that share and its mean FWI. */
export interface HighDanger { name: string; province: string; fwiClass: FwiClass; share: number; meanFwi: number }

/**
 * Regencies where tinggi or sangat tinggi covers at least 10% of the area on the day dated `date` (WIB, YYYY-MM-DD),
 * the largest share first, then the highest mean FWI; `province` narrows to one province. By date, not by position:
 * a copy of GET /risk from an earlier day starts on that day, and a regency can lack a day its neighbours have.
 */
export function highDanger(risk: Risk, date: string, province = ''): HighDanger[] {
  return risk.regencies
    .filter(regency => !province || regency.province === province)
    .flatMap(regency => {
      const day = regency.days.find(entry => entry.date === date);
      const units = day ? Math.round((day.shares.tinggi + day.shares.sangat_tinggi) * 1000) : 0;
      return day && units >= HIGH_MIN ? [{ name: regency.name, province: regency.province, fwiClass: day.fwiClass, share: units / 1000, meanFwi: day.meanFwi }] : [];
    })
    .sort((a, b) => b.share - a.share || b.meanFwi - a.meanFwi || a.name.localeCompare(b.name));
}

/**
 * "Pulang Pisau 80%": the regency and the share of its area at tinggi or above. The class alone would overstate it (a
 * regency that is sangat tinggi on half its area and tinggi on the rest is 100% tinggi or above, not 100% sangat tinggi).
 */
export function highDangerName(regency: HighDanger, lang: Lang) {
  return `${regency.name} ${formatter(lang).percent(regency.share)}`;
}

/** A higher class over part of a regency, under its class: "tinggi atau lebih di 30% wilayah", "sangat tinggi di 12% wilayah". */
export function partialText(partial: NonNullable<RegencyRiskDay['partial']>, lang: Lang) {
  const w = riskText[lang];
  return fill(partial.fwiClass === 'sangat_tinggi' ? w.partialTop : w.partial, { class: fwiLabel[lang][partial.fwiClass].toLowerCase(), p: formatter(lang).percent(partial.share) });
}

/** Each regency's day dated `date` (WIB, YYYY-MM-DD) by "province/name", for tables. Empty when nothing was computed for it. */
export function regencyDays(risk: Risk | null | undefined, date: string) {
  const days = new Map<string, RegencyRiskDay>();
  if (!risk?.fetchedAt) return days;
  for (const regency of risk.regencies) {
    const day = regency.days.find(entry => entry.date === date);
    if (day) days.set(`${regency.province}/${regency.name}`, day);
  }
  return days;
}
