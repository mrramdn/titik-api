import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildupIndex, dcDayLengthFactor, dmcDayLength, droughtCode, duffMoistureCode, fineFuelMoistureCode, fireWeatherIndex, fwiClass, fwiDay,
  initialSpreadIndex, startMoisture,
} from '../src/fwi.js';

const near = (tolerance: number) => (actual: number, expected: number, label: string) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected} (±${tolerance})`);

// The sample season of Van Wagner & Pickett (1985, Equations and FORTRAN program for the Canadian Forest Fire Weather
// Index System, Forestry Technical Report 33, "Sample of input" p. 16 and "Sample of output" p. 17): noon weather from
// 13 April to 31 May, started from FFMC 85, DMC 6, DC 15 with the standard day lengths (Canadian, about 46°N), and the
// output as printed, to one decimal.
// [month, day, temp °C, RH %, wind km/h, rain mm, FFMC, DMC, DC, ISI, BUI, FWI]
const sampleSeason: number[][] = [
  [4, 13, 17, 42, 25, 0, 87.7, 8.5, 19, 10.9, 8.5, 10.1], [4, 14, 20, 21, 25, 2.4, 86.2, 10.4, 23.6, 8.8, 10.4, 9.3],
  [4, 15, 8.5, 40, 17, 0, 87, 11.8, 26.1, 6.5, 11.7, 7.6], [4, 16, 6.5, 25, 6, 0, 88.8, 13.2, 28.2, 4.9, 13.1, 6.2],
  [4, 17, 13, 34, 24, 0, 89.1, 15.4, 31.5, 12.6, 15.3, 14.8], [4, 18, 6, 40, 22, 0.4, 88.7, 16.5, 33.5, 10.7, 16.4, 13.5],
  [4, 19, 5.5, 52, 6, 0, 87.4, 17.2, 35.4, 4, 17.1, 5.9], [4, 20, 8.5, 46, 16, 0, 87.4, 18.5, 37.9, 6.6, 18.4, 9.7],
  [4, 21, 9.5, 54, 20, 0, 86.8, 19.7, 40.6, 7.4, 19.6, 11], [4, 22, 7, 93, 14, 9, 29.9, 10.1, 29.5, 0, 10.9, 0],
  [4, 23, 6.5, 71, 17, 1, 49.4, 10.7, 31.6, 0.4, 11.6, 0.2], [4, 24, 6, 59, 17, 0, 67.3, 11.4, 33.7, 1.3, 12.3, 0.9],
  [4, 25, 13, 52, 4, 0, 77.8, 13, 37, 1.1, 13.9, 0.8], [4, 26, 15.5, 40, 11, 0, 85.5, 15.4, 40.7, 3.9, 15.9, 5.5],
  [4, 27, 23, 25, 9, 0, 91.5, 19.8, 45.8, 8.4, 19.8, 12.2], [4, 28, 19, 46, 16, 0, 89.9, 22.5, 50.2, 9.5, 22.4, 14.3],
  [4, 29, 18, 41, 20, 0, 90, 25.2, 54.4, 11.7, 25.1, 17.7], [4, 30, 14.5, 51, 16, 0, 88.4, 27, 57.9, 7.7, 27, 13.3],
  [5, 1, 14.5, 69, 11, 0, 85.7, 28.3, 63, 4, 28.2, 8], [5, 2, 15.5, 42, 8, 0, 87.4, 30.8, 68.2, 4.4, 30.8, 9.1],
  [5, 3, 21, 37, 8, 0, 89.4, 34.5, 74.3, 5.9, 34.4, 12.3], [5, 4, 23, 32, 16, 0, 91, 38.8, 80.9, 11.1, 38.7, 21],
  [5, 5, 23, 32, 14, 0, 91.2, 43.1, 87.4, 10.3, 43, 21.1], [5, 6, 27, 33, 12, 0, 91.7, 48.1, 94.7, 9.9, 47.9, 21.7],
  [5, 7, 28, 17, 27, 0, 95.2, 54.5, 102.1, 34.5, 54.3, 52.6], [5, 8, 23.5, 54, 20, 0, 89.7, 57.4, 108.8, 11.3, 57.2, 25.9],
  [5, 9, 16, 50, 22, 12.2, 62.2, 29.9, 91.8, 1.4, 33, 3], [5, 10, 11.5, 58, 20, 0, 76.7, 31.3, 96.3, 2.3, 34.5, 5.4],
  [5, 11, 16, 54, 16, 0, 83.5, 33.4, 101.6, 3.8, 36.7, 8.9], [5, 12, 21.5, 37, 9, 0, 88.7, 37.1, 107.8, 5.6, 39.9, 12.8],
  [5, 13, 14, 61, 22, 0.2, 86.7, 38.7, 112.8, 8.1, 41.6, 17.3], [5, 14, 15, 30, 27, 0, 89.6, 41.7, 117.9, 15.9, 44.2, 28.8],
  [5, 15, 20, 23, 11, 0, 92.1, 45.9, 123.9, 10.1, 47.7, 21.9], [5, 16, 14, 95, 3, 16.4, 21.3, 20.1, 97, 0, 26.5, 0],
  [5, 17, 20, 53, 4, 2.8, 51, 18.3, 103, 0.2, 25.3, 0.2], [5, 18, 19.5, 30, 16, 0, 82.3, 22.1, 108.9, 3.3, 29.3, 6.8],
  [5, 19, 25.5, 51, 20, 6, 75.4, 16.4, 106.4, 2.1, 23.7, 3.8], [5, 20, 10, 38, 24, 0, 84.3, 18.2, 110.6, 6.4, 25.8, 11.3],
  [5, 21, 19, 27, 16, 0, 90.3, 22.1, 116.4, 10, 29.9, 17.2], [5, 22, 26, 46, 11, 4.2, 77.6, 18.7, 117.7, 1.6, 26.8, 2.9],
  [5, 23, 30, 38, 22, 0, 90.2, 23.8, 125.5, 13.4, 32.3, 22], [5, 24, 25.5, 67, 19, 12.6, 65.3, 13.1, 108.5, 1.4, 20.2, 1.9],
  [5, 25, 12, 53, 28, 11.8, 55.4, 7.7, 91.6, 1.2, 12.8, 0.8], [5, 26, 21, 38, 8, 0, 80.8, 11.3, 97.8, 1.9, 17.6, 2.6],
  [5, 27, 13, 70, 20, 3.8, 61.7, 8.4, 97.9, 1.2, 13.8, 0.9], [5, 28, 9, 78, 24, 1.4, 64.5, 9, 101.9, 1.7, 14.7, 2],
  [5, 29, 11, 54, 16, 0, 77.6, 10.5, 106.3, 2, 16.8, 2.8], [5, 30, 15.5, 39, 9, 0, 85.4, 13.1, 111.5, 3.5, 20.3, 5.8],
  [5, 31, 18, 36, 5, 0, 88.5, 16.3, 117.1, 4.4, 24.2, 7.9],
];

// FFMC, DC and ISI match the printed values to half a unit of the last digit (±0.05). The printed DMC lies up to 0.09
// below Eq. 12 as printed after rain days; with 0.023 in place of 1/43.43 in Eq. 12 it comes within 0.051 on every
// day, so the table carries that rounding. The DMC and the two indexes built on it, BUI and FWI, are checked to ±0.1.
const printedTolerance = { ffmc: 0.05, dmc: 0.1, dc: 0.05, isi: 0.05, bui: 0.1, fwi: 0.1 } as const;

test('the sample season of Van Wagner & Pickett (1985) comes out as printed', () => {
  assert.equal(sampleSeason.length, 49);
  let moisture = startMoisture;
  for (const [month, day, temp, rh, wind, rain, ...printed] of sampleSeason as [number, number, number, number, number, number, ...number[]][]) {
    const codes = fwiDay(moisture, { temp, rh, wind, rain }, 46, month);
    (['ffmc', 'dmc', 'dc', 'isi', 'bui', 'fwi'] as const).forEach((key, k) => near(printedTolerance[key])(codes[key], printed[k]!, `${month}/${day} ${key}`));
    moisture = codes;
  }
});

// Single steps from the regression tables of the cffdrs R package (tests/testthat/data in https://github.com/cffdrs/cffdrs_r;
// a few values only, rounded there to 4 significant digits), kept as a cross-check by another program of these branches:
// the three rain branches of the DMC (Eqs. 13a–c) in three latitude bands, Eqs. 27a/b, 28a/b and 30a/b, and the FFMC
// after very heavy rain. They agree with the printed equations to 0.031 (DMC after heavy rain), 0.011 (FFMC) and 0.005
// elsewhere: rounding and small differences in that program's arithmetic. Checked to ±0.05.
const crossCheck = near(0.05);

test('single steps agree with the cffdrs regression tables: DMC rain branches in three latitude bands, BUI, FWI, ISI, FFMC after heavy rain', () => {
  // DMC: [yesterday, temp, rh, rain, lat, month, expected]; 55.8°N standard day lengths, 17.1°S and 90°S adjusted.
  for (const [y, t, h, r, lat, m, e] of [[210.9, 18.6, 55.61, 55.61, -90, 1, 67.97], [45, 42.9, 55.61, 186.83, -90, 1, 17.47], [0.3, 18.6, 55.61, 55.61, -17.1, 1, 1.673],
    [219, 18.6, 55.61, 55.61, -17.1, 1, 68.58], [53.1, 42.9, 55.61, 186.83, -17.1, 1, 20.08], [8.4, 18.6, 55.61, 55.61, 55.8, 1, 4.272],
    [227.1, 18.6, 55.61, 55.61, 55.8, 1, 68.76], [61.2, 42.9, 55.61, 186.83, 55.8, 1, 21.49], [16.5, 18.6, 55.61, 55.61, -90, 4, 7.407]] as const) {
    crossCheck(duffMoistureCode(y, t, h, r, lat, m), e, `DMC ${y} ${lat} ${m}`);
  }
  crossCheck(droughtCode(210.9, 18.6, 55.61, 55.61, -90, 1), 90.79, 'DC 210.9 after 55.61 mm');
  // FWI: BUI up to 80 (Eq. 28a) and above (Eq. 28b), B up to 1 (Eq. 30b) and above (Eq. 30a).
  for (const [isi, bui, e] of [[0.9, 0, 0.18], [3.6, 0, 0.72], [5.4, 0, 1.352], [8.1, 0, 2.689], [0.5, 218.7, 3.379], [1.4, 218.7, 9.298], [2.3, 218.7, 13.91],
    [3.2, 218.7, 17.87], [0.1, 437.4, 0.3999], [0.2, 874.8, 0.8]] as const) crossCheck(fireWeatherIndex(isi, bui), e, `FWI ${isi} ${bui}`);
  // BUI: Eq. 27a, and Eq. 27b once the DMC passes 0.4 × DC.
  for (const [dmc, dc, e] of [[1.5, 218.7, 2.949], [4.2, 218.7, 8.015], [9.6, 218.7, 17.3], [87.9, 218.7, 87.9], [90.6, 218.7, 90.57], [96, 218.7, 95.9]] as const) {
    crossCheck(buildupIndex(dmc, dc), e, `BUI ${dmc} ${dc}`);
  }
  for (const [ffmc, wind, e] of [[50.1, 0, 0.1657], [60, 0, 0.4089], [70.8, 0, 0.6418], [80.7, 0, 1.225], [90.6, 0, 4.668], [100.5, 0, 17.93], [100.2, 24.3, 58.72]] as const) {
    crossCheck(initialSpreadIndex(ffmc, wind), e, `ISI ${ffmc} ${wind}`);
  }
  // FFMC after 186.83 mm: the first two rows take Eq. 3b and reach the 250 % cap; the other two take Eq. 3a and stay
  // below it; the day then dries the litter.
  for (const [y, t, h, w, r, e] of [[2.4, 2.4, 55.61, 0, 186.83, 13.87], [18.6, 2.4, 55.61, 0, 186.83, 13.87], [67.2, 2.4, 55.61, 0, 186.83, 18.87],
    [83.4, 2.4, 55.61, 0, 186.83, 21.27]] as const) crossCheck(fineFuelMoistureCode(y, t, h, w, r), e, `FFMC ${y}`);
});

test('after heavy rain the DC keeps only the day\'s drying, 0.5 [0.36 (T + 2.8) + Lf] (Eqs. 21–23)', () => {
  // 55.61 mm takes a DC of 24.6 to zero (Eq. 21); at 18.6 °C, 0.5 × 0.36 × 21.4 = 3.852 plus half the factor.
  const northern = [3.052, 4.302, 7.052, 4.052], southern = [7.052, 4.052, 3.052, 4.302];
  [1, 4, 7, 10].forEach((month, k) => {
    for (const [lat, expected] of [[55.8, northern[k]!], [-3, 4.552], [-17.1, southern[k]!], [-90, southern[k]!]] as const) {
      near(1e-9)(droughtCode(24.6, 18.6, 55.61, 55.61, lat, month), expected, `DC ${lat} ${month}`);
    }
  });
});

test('day lengths by latitude band (Lawson & Armitage 2008, Tables A3.1 and A3.2)', () => {
  const months = Array.from({ length: 12 }, (_, k) => k + 1);
  // From 10°N to 10°S: DMC 9 hours and DC factor 1.4 in every month.
  for (const month of months) {
    for (const lat of [10, 1, 0, -2.5, -5, -9.9, -10]) {
      assert.equal(dmcDayLength(lat, month), 9, `DMC ${lat} ${month}`);
      assert.equal(dcDayLengthFactor(lat, month), 1.4, `DC ${lat} ${month}`);
    }
  }
  // The tables at their reference latitudes: 46°N (the Canadian standard), 20°N, 20°S and 40°S; hemispheres for the DC.
  assert.deepEqual(months.map(m => dmcDayLength(46, m)), [6.5, 7.5, 9, 12.8, 13.9, 13.9, 12.4, 10.9, 9.4, 8, 7, 6]);
  assert.deepEqual(months.map(m => dmcDayLength(20, m)), [7.9, 8.4, 8.9, 9.5, 9.9, 10.2, 10.1, 9.7, 9.1, 8.6, 8.1, 7.8]);
  assert.deepEqual(months.map(m => dmcDayLength(-20, m)), [10.1, 9.6, 9.1, 8.5, 8.1, 7.8, 7.9, 8.3, 8.9, 9.4, 9.9, 10.2]);
  assert.deepEqual(months.map(m => dmcDayLength(-40, m)), [11.5, 10.5, 9.2, 7.9, 6.8, 6.2, 6.5, 7.4, 8.7, 10, 11.2, 11.8]);
  assert.deepEqual(months.map(m => dcDayLengthFactor(46, m)), [-1.6, -1.6, -1.6, 0.9, 3.8, 5.8, 6.4, 5, 2.4, 0.4, -1.6, -1.6]);
  assert.deepEqual(months.map(m => dcDayLengthFactor(-40, m)), [6.4, 5, 2.4, 0.4, -1.6, -1.6, -1.6, -1.6, -1.6, 0.9, 3.8, 5.8]);
  // Band edges (10° and 30°) go to the band nearer the equator.
  assert.deepEqual([30.1, 30, 10.1, -10.1, -30, -30.1].map(lat => dmcDayLength(lat, 7)), [12.4, 10.1, 10.1, 7.9, 7.9, 6.5]);
  assert.deepEqual([20, 10.1, -10.1, -20].map(lat => dcDayLengthFactor(lat, 7)), [6.4, 6.4, -1.6, -1.6]);
  assert.throws(() => dmcDayLength(0, 13), RangeError);
  assert.throws(() => dcDayLengthFactor(0, 0), RangeError);
  // A dry day at 3°S dries the duff by 1.894 (T + 1.1)(100 − RH) × 9 × 10⁻⁴ (Eqs. 16 and 17), whatever the month.
  for (const month of [1, 6, 10]) near(1e-9)(duffMoistureCode(20, 32, 55, 0, -3, month), 20 + 1.894 * 33.1 * 45 * 9e-4, `DMC ${month}`);
});

test('relative humidity is held to 0–100 %, and the codes stay finite at the ends of their scales', () => {
  const day = (rh: number) => fwiDay(startMoisture, { temp: 25, rh, wind: 5, rain: 0 }, -3, 11);
  assert.deepEqual(day(104), day(100));
  assert.deepEqual(day(-2), day(0));
  for (const rh of [0, 100]) assert.ok(Object.values(day(rh)).every(Number.isFinite), `RH ${rh}`);
  assert.equal(day(100).dmc, startMoisture.dmc, 'saturated air does not dry the duff (Eq. 16)');
  // A code just above 101 (Eq. 10 reaches 101.05 at 0 % moisture) reads as dry litter, not as negative moisture.
  assert.ok(Number.isFinite(initialSpreadIndex(101.04, 20)));
  assert.equal(initialSpreadIndex(101.04, 20), initialSpreadIndex(101, 20));
  // Eq. 27b dips below zero for a small DMC over a DC near zero; the BUI stays at zero there.
  assert.equal(buildupIndex(0.5, 0), 0);
  assert.equal(buildupIndex(0, 0), 0);
  assert.equal(buildupIndex(0, 100), 0);
  assert.equal(fireWeatherIndex(0, 0), 0);
});

test('BMKG classes: rendah 0–1, sedang 2–6, tinggi 7–13, sangat tinggi above 13, on the rounded FWI', () => {
  const cases: [number, string][] = [[0, 'rendah'], [1.49, 'rendah'], [1.5, 'sedang'], [2, 'sedang'], [6.49, 'sedang'], [6.5, 'tinggi'], [7, 'tinggi'],
    [13.49, 'tinggi'], [13.5, 'sangat_tinggi'], [14, 'sangat_tinggi'], [52.3, 'sangat_tinggi']];
  for (const [fwi, expected] of cases) assert.equal(fwiClass(fwi), expected, String(fwi));
});
