// Wind at an incident (GET /incidents/:id/wind) in words: where it comes from, where the smoke drifts, and which
// villages lie that way. Directions are the eight compass words the rest of the app uses.
import type { Wind } from '../../api';
import { dict, fill, type Lang } from '../../i18n';
import { formatter } from '../../format';
import { windName } from '../../geo';

export const windText = dict({
  id: {
    title: 'Angin dan asap',
    now: 'Angin sekarang dari {from}, {speed} km/jam · asap mengarah ke {toward}',
    detected: 'Angin saat terakhir terdeteksi ({time} WIB): dari {from}, {speed} km/jam · asap mengarah ke {toward}',
    calmNow: 'Angin lemah (di bawah 5 km/jam).',
    calmDetected: 'Angin saat terakhir terdeteksi ({time} WIB): lemah (di bawah 5 km/jam).',
    villages: 'Desa di arah asap (≤ 5 km): {list}',
    smoke: 'Asap mengarah ke {list}.', village: 'Desa {name}',
  },
  en: {
    title: 'Wind and smoke',
    now: 'Wind now from the {from}, {speed} km/h · smoke drifts {toward}',
    detected: 'Wind when last detected ({time} WIB): from the {from}, {speed} km/h · smoke drifts {toward}',
    calmNow: 'Light wind (under 5 km/h).',
    calmDetected: 'Wind when last detected ({time} WIB): light (under 5 km/h).',
    villages: 'Villages downwind (≤ 5 km): {list}',
    smoke: 'Smoke drifts toward {list}.', village: '{name}',
  },
});

/** "Angin sekarang dari timur, 12 km/jam · asap mengarah ke barat", or the wind at the last detection, or calm. */
export function windLine(wind: Wind, lang: Lang) {
  const f = formatter(lang), w = windText[lang];
  const time = f.dayTime(wind.at);
  if (wind.calm) return wind.mode === 'now' ? w.calmNow : fill(w.calmDetected, { time });
  const vars = { from: windName(wind.fromDeg, lang), toward: windName(wind.towardDeg, lang), speed: f.num(Math.round(wind.speedKmh)), time };
  return fill(wind.mode === 'now' ? w.now : w.detected, vars);
}

/** "Desa di arah asap (≤ 5 km): A (1,2 km), B (3,4 km)"; null when no village lies downwind. */
export function downwindLine(wind: Wind, lang: Lang) {
  if (wind.calm || !wind.villages.length) return null;
  const f = formatter(lang);
  return fill(windText[lang].villages, { list: wind.villages.map(v => `${v.name} (${f.km(v.distanceM)})`).join(', ') });
}

/** The line for the WhatsApp message: "Asap mengarah ke Desa A, Desa B."; null without wind data or villages downwind. */
export function smokeSentence(wind: Wind | null | undefined, lang: Lang) {
  if (!wind || wind.calm || !wind.villages.length) return null;
  const w = windText[lang];
  return fill(w.smoke, { list: wind.villages.map(v => fill(w.village, { name: v.name })).join(', ') });
}
