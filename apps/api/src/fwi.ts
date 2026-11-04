// Canadian Forest Fire Weather Index (FWI) System: one day of the three fuel moisture codes (FFMC, DMC, DC) and of
// the three fire behaviour indexes (ISI, BUI, FWI), from the noon weather and the codes of the day before.
//
// Written for Titik Api from the equations and tables of these publications:
// - Van Wagner, C.E.; Pickett, T.L. 1985. Equations and FORTRAN program for the Canadian Forest Fire Weather Index
//   System. Canadian Forestry Service, Petawawa National Forestry Institute, Chalk River, Ont. Forestry Technical
//   Report 33. https://ostrnrcan-dostrncan.canada.ca/handle/1845/228362
//   "Eq. n" below is equation n of this report (pp. 5–8); the rain thresholds and limits are its stated restrictions.
// - Van Wagner, C.E. 1987. Development and structure of the Canadian Forest Fire Weather Index System. Canadian
//   Forestry Service, Ottawa. Forestry Technical Report 35. https://ostrnrcan-dostrncan.canada.ca/handle/1845/228434
//   Tables 2 and 3 give the standard monthly day lengths (their values are missing from the scan of Report 33).
// - Lawson, B.D.; Armitage, O.B. 2008. Weather guide for the Canadian Forest Fire Danger Rating System. Natural
//   Resources Canada, Canadian Forest Service, Northern Forestry Centre, Edmonton.
//   https://ostrnrcan-dostrncan.canada.ca/handle/1845/219568
//   Appendix 3 (M.E. Alexander), Tables A3.1 and A3.2: day lengths by latitude band; p. 14: the start-up values.
//
// Units: temperature °C, relative humidity %, wind speed km/h, rain mm in the 24 hours to noon. Constants are used as
// printed. test/fwi.test.ts runs the sample season of Report 33 (pp. 16–17) against its printed output.

export interface FwiCodes { ffmc: number; dmc: number; dc: number; isi: number; bui: number; fwi: number }
export interface Moisture { ffmc: number; dmc: number; dc: number }
/** Weather at noon local standard time; `rain` is the total of the 24 hours to noon. */
export interface NoonWeather { temp: number; rh: number; wind: number; rain: number }

/** The standard start-up values for the first day of a fire season (Lawson & Armitage 2008, p. 14). */
export const startMoisture: Moisture = { ffmc: 85, dmc: 6, dc: 15 };

// Fine Fuel Moisture Code, Eqs. 1–10.

/**
 * The FF-scale constant of Eqs. 1 and 10, as printed. The two equations are then not exact inverses (a code taken to
 * moisture and back gains about 0.05), and the sample season of Report 33 was computed that way: it is matched to
 * 0.05 with 147.2, whereas 250 × 59.5 / 101 = 147.277…, the value that makes them exact inverses, falls up to 0.13
 * below its printed FFMC.
 */
const FF_SCALE = 147.2;

/** Eq. 1: fine fuel moisture content (%) from the FFMC. A code above 101 (Eq. 10 reaches 101.05 at 0 %) reads as 0 %. */
function fineFuelMoisture(ffmc: number) {
  return Math.max(0, (FF_SCALE * (101 - ffmc)) / (59.5 + ffmc));
}

/** Eq. 10: the FFMC from fine fuel moisture content (%). */
function ffmcFromMoisture(m: number) {
  return (59.5 * (250 - m)) / (FF_SCALE + m);
}

/** Log drying rate (x = H/100: Eqs. 6a, 6b) or log wetting rate (x = (100 − H)/100: Eqs. 7a, 7b) of fine fuel, per day. */
function fineFuelLogRate(x: number, temp: number, wind: number) {
  return (0.424 * (1 - x ** 1.7) + 0.0694 * Math.sqrt(wind) * (1 - x ** 8)) * 0.581 * Math.exp(0.0365 * temp);
}

/** Today's FFMC from yesterday's, the noon temperature, relative humidity and wind, and the rain. */
export function fineFuelMoistureCode(ffmcYesterday: number, temp: number, rh: number, wind: number, rain: number) {
  let mo = fineFuelMoisture(ffmcYesterday);
  if (rain > 0.5) {
    // Rain first, on the moisture content; it never takes the litter above the scale's 250 %.
    const rf = rain - 0.5; // Eq. 2
    let gain = 42.5 * rf * Math.exp(-100 / (251 - mo)) * (1 - Math.exp(-6.93 / rf)); // Eq. 3a
    if (mo > 150) gain += 0.0015 * (mo - 150) ** 2 * Math.sqrt(rf); // Eq. 3b adds this above 150 %
    mo = Math.min(250, mo + gain);
  }
  // Then a day of drying down to the drying equilibrium, or wetting up to the wetting one; between the two, no change.
  const coolness = 0.18 * (21.1 - temp) * (1 - Math.exp(-0.115 * rh));
  const ed = 0.942 * rh ** 0.679 + 11 * Math.exp((rh - 100) / 10) + coolness; // Eq. 4
  const ew = 0.618 * rh ** 0.753 + 10 * Math.exp((rh - 100) / 10) + coolness; // Eq. 5
  let m = mo;
  if (mo > ed) m = ed + (mo - ed) * 10 ** -fineFuelLogRate(rh / 100, temp, wind); // Eq. 8
  else if (mo < ew) m = ew - (ew - mo) * 10 ** -fineFuelLogRate((100 - rh) / 100, temp, wind); // Eq. 9
  return ffmcFromMoisture(m);
}

// Day lengths for the DMC and the DC by latitude band and month (Lawson & Armitage 2008, Tables A3.1 and A3.2).
// Between 10°N and 10°S the guide sets Le = 9.0 h and Lf = 1.4 in every month. A latitude on the edge of two bands
// takes the band nearer the equator.

const EQUATORIAL_LATITUDE = 10;
const EQUATORIAL_DMC_DAY_LENGTH = 9.0;
const EQUATORIAL_DC_FACTOR = 1.4;
/** Effective day length Le (hours) for the DMC, January to December. */
const DMC_DAY_LENGTHS = {
  /** The Canadian standard, about 46°N (Van Wagner 1987, Table 2): poleward of 30°N. */
  north46: [6.5, 7.5, 9.0, 12.8, 13.9, 13.9, 12.4, 10.9, 9.4, 8.0, 7.0, 6.0],
  /** 20°N, for 10°N to 30°N. */
  north20: [7.9, 8.4, 8.9, 9.5, 9.9, 10.2, 10.1, 9.7, 9.1, 8.6, 8.1, 7.8],
  /** 20°S, for 10°S to 30°S. */
  south20: [10.1, 9.6, 9.1, 8.5, 8.1, 7.8, 7.9, 8.3, 8.9, 9.4, 9.9, 10.2],
  /** 40°S, poleward of 30°S. */
  south40: [11.5, 10.5, 9.2, 7.9, 6.8, 6.2, 6.5, 7.4, 8.7, 10.0, 11.2, 11.8],
} as const;
/** Day-length factor Lf for the DC, January to December. */
const DC_DAY_LENGTH_FACTORS = {
  /** The Canadian standard (Van Wagner 1987, Table 3), for the northern hemisphere. */
  north: [-1.6, -1.6, -1.6, 0.9, 3.8, 5.8, 6.4, 5.0, 2.4, 0.4, -1.6, -1.6],
  /** The same six months later, for the southern hemisphere. */
  south: [6.4, 5.0, 2.4, 0.4, -1.6, -1.6, -1.6, -1.6, -1.6, 0.9, 3.8, 5.8],
} as const;

function monthIndex(month: number) {
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new RangeError(`month must be 1 to 12, not ${month}`);
  return month - 1;
}

/** Effective day length Le (hours) in the DMC for a latitude (°, south negative) and month (1–12). */
export function dmcDayLength(lat: number, month: number) {
  const index = monthIndex(month);
  if (Math.abs(lat) <= EQUATORIAL_LATITUDE) return EQUATORIAL_DMC_DAY_LENGTH;
  const table = lat > 30 ? DMC_DAY_LENGTHS.north46 : lat > 0 ? DMC_DAY_LENGTHS.north20 : lat >= -30 ? DMC_DAY_LENGTHS.south20 : DMC_DAY_LENGTHS.south40;
  return table[index]!;
}

/** Day-length factor Lf in the DC for a latitude (°, south negative) and month (1–12). */
export function dcDayLengthFactor(lat: number, month: number) {
  const index = monthIndex(month);
  if (Math.abs(lat) <= EQUATORIAL_LATITUDE) return EQUATORIAL_DC_FACTOR;
  return (lat > 0 ? DC_DAY_LENGTH_FACTORS.north : DC_DAY_LENGTH_FACTORS.south)[index]!;
}

// Duff Moisture Code, Eqs. 11–17. Eq. 12 is used as printed; the sample season of Report 33 evidently used 0.023 for
// 1/43.43 in it, which leaves its printed DMC up to 0.09 lower after rain (see test/fwi.test.ts).

/** Today's DMC from yesterday's, the noon temperature and relative humidity, the rain, the latitude and the month. */
export function duffMoistureCode(dmcYesterday: number, temp: number, rh: number, rain: number, lat: number, month: number) {
  let po = dmcYesterday;
  if (rain > 1.5) {
    const re = 0.92 * rain - 1.27; // Eq. 11: effective rain
    const mo = 20 + Math.exp(5.6348 - po / 43.43); // Eq. 12: duff moisture content (%) before the rain
    const b = po <= 33 ? 100 / (0.5 + 0.3 * po) : po <= 65 ? 14 - 1.3 * Math.log(po) : 6.2 * Math.log(po) - 17.2; // Eqs. 13a–c
    const mr = mo + (1000 * re) / (48.77 + b * re); // Eq. 14: after the rain
    po = Math.max(0, 244.72 - 43.43 * Math.log(mr - 20)); // Eq. 15, raised to zero when negative
  }
  // Drying stops at -1.1 °C: colder noons count as -1.1 °C.
  const k = 1.894 * (Math.max(temp, -1.1) + 1.1) * (100 - rh) * dmcDayLength(lat, month) * 1e-6; // Eq. 16
  return po + 100 * k; // Eq. 17
}

// Drought Code, Eqs. 18–23.

/** Today's DC from yesterday's, the noon temperature, the rain, the latitude and the month; humidity plays no part. */
export function droughtCode(dcYesterday: number, temp: number, _rh: number, rain: number, lat: number, month: number) {
  let d0 = dcYesterday;
  if (rain > 2.8) {
    const rd = 0.83 * rain - 1.27; // Eq. 18: effective rain
    const q0 = 800 * Math.exp(-d0 / 400); // Eq. 19: moisture equivalent before the rain
    const qr = q0 + 3.937 * rd; // Eq. 20: after the rain
    d0 = Math.max(0, 400 * Math.log(800 / qr)); // Eq. 21, raised to zero when negative
  }
  // Potential evapotranspiration: colder noons than -2.8 °C count as -2.8 °C, and it is never negative.
  const v = Math.max(0, 0.36 * (Math.max(temp, -2.8) + 2.8) + dcDayLengthFactor(lat, month)); // Eq. 22
  return d0 + 0.5 * v; // Eq. 23
}

// Fire behaviour indexes, Eqs. 24–30.

/** Initial Spread Index from today's FFMC and the noon wind speed (km/h). */
export function initialSpreadIndex(ffmc: number, wind: number) {
  const m = fineFuelMoisture(ffmc);
  const windFactor = Math.exp(0.05039 * wind); // Eq. 24
  const moistureFactor = 91.9 * Math.exp(-0.1386 * m) * (1 + m ** 5.31 / 4.93e7); // Eq. 25
  return 0.208 * windFactor * moistureFactor; // Eq. 26
}

/** Buildup Index from today's DMC and DC. Never below zero, where Eq. 27b would dip under it for a DC near zero. */
export function buildupIndex(dmc: number, dc: number) {
  if (dmc <= 0.4 * dc) return dmc > 0 ? (0.8 * dmc * dc) / (dmc + 0.4 * dc) : 0; // Eq. 27a
  return Math.max(0, dmc - (1 - (0.8 * dc) / (dmc + 0.4 * dc)) * (0.92 + (0.0114 * dmc) ** 1.7)); // Eq. 27b
}

/** Fire Weather Index from today's ISI and BUI. */
export function fireWeatherIndex(isi: number, bui: number) {
  const duffFactor = bui <= 80 ? 0.626 * bui ** 0.809 + 2 : 1000 / (25 + 108.64 * Math.exp(-0.023 * bui)); // Eqs. 28a, 28b
  const b = 0.1 * isi * duffFactor; // Eq. 29
  return b > 1 ? Math.exp(2.72 * (0.434 * Math.log(b)) ** 0.647) : b; // Eqs. 30a (from ln S), 30b
}

/**
 * One day of the whole system from yesterday's moisture codes, the noon weather, the latitude and the month. A
 * relative humidity outside 0–100 % is first brought to the nearer limit.
 */
export function fwiDay(yesterday: Moisture, weather: NoonWeather, lat: number, month: number): FwiCodes {
  const { temp, wind, rain } = weather;
  const rh = Math.min(100, Math.max(0, weather.rh));
  const ffmc = fineFuelMoistureCode(yesterday.ffmc, temp, rh, wind, rain);
  const dmc = duffMoistureCode(yesterday.dmc, temp, rh, rain, lat, month);
  const dc = droughtCode(yesterday.dc, temp, rh, rain, lat, month);
  const isi = initialSpreadIndex(ffmc, wind);
  const bui = buildupIndex(dmc, dc);
  return { ffmc, dmc, dc, isi, bui, fwi: fireWeatherIndex(isi, bui) };
}

export type FwiClass = 'rendah' | 'sedang' | 'tinggi' | 'sangat_tinggi';
/** The four classes, lowest first. */
export const fwiClasses: FwiClass[] = ['rendah', 'sedang', 'tinggi', 'sangat_tinggi'];

/**
 * BMKG's fire danger classes (bmkg.go.id/cuaca/karhutla/fwi) on the FWI rounded to a whole number: rendah 0–1,
 * sedang 2–6, tinggi 7–13, sangat tinggi above 13.
 */
export function fwiClass(fwi: number): FwiClass {
  const rounded = Math.round(fwi);
  if (rounded <= 1) return 'rendah';
  if (rounded <= 6) return 'sedang';
  if (rounded <= 13) return 'tinggi';
  return 'sangat_tinggi';
}
