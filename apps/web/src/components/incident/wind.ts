// Wind at an incident (GET /incidents/:id/wind) in words: where it comes from, where the smoke drifts, and which
// villages lie that way. Directions are the eight compass words the rest of the app uses.
import type { Wind } from '../../api';
import { dict, fill, type Lang } from '../../i18n';
import { formatter } from '../../format';
import { windName } from '../../geo';

const HOUR = 3_600_000;

export const windText = dict({
  id: {
    title: 'Angin dan asap',
    now: 'Angin sekarang dari {from}, {speed} km/jam · asap mengarah ke {toward}',
    at: 'Angin pada {time} WIB: dari {from}, {speed} km/jam · asap mengarah ke {toward}',
    detected: 'Angin saat terakhir terdeteksi ({time} WIB): dari {from}, {speed} km/jam · asap mengarah ke {toward}',
    calmNow: 'Angin lemah (di bawah 5 km/jam).',
    calmAt: 'Angin pada {time} WIB: lemah (di bawah 5 km/jam).',
    calmDetected: 'Angin saat terakhir terdeteksi ({time} WIB): lemah (di bawah 5 km/jam).',
    villages: 'Desa di arah asap (≤ 5 km): {list}',
    smoke: 'Asap mengarah ke {list}.', smokeAt: 'Asap mengarah ke {list} (angin pada {time} WIB).', village: 'Desa {name}',
  },
  en: {
    title: 'Wind and smoke',
    now: 'Wind now from the {from}, {speed} km/h · smoke drifts {toward}',
    at: 'Wind at {time} WIB: from the {from}, {speed} km/h · smoke drifts {toward}',
    detected: 'Wind when last detected ({time} WIB): from the {from}, {speed} km/h · smoke drifts {toward}',
    calmNow: 'Light wind (under 5 km/h).',
    calmAt: 'Wind at {time} WIB: light (under 5 km/h).',
    calmDetected: 'Wind when last detected ({time} WIB): light (under 5 km/h).',
    villages: 'Villages downwind (≤ 5 km): {list}',
    smoke: 'Smoke drifts toward {list}.', smokeAt: 'Smoke drifts toward {list} (wind at {time} WIB).', village: '{name}',
  },
});

/**
 * True while a wind the server sent as "now" still is: its hour (`at`, the whole hour the server asked for) began at
 * most an hour ago. The service worker answers from a copy up to three days old when the signal is weak or gone, and
 * a panel can stay open past the hour; such a wind is told by its hour instead.
 */
export const windIsCurrent = (wind: Wind, now = Date.now()) => wind.mode === 'now' && now - Date.parse(wind.at) <= HOUR;

/** When windLine next reads differently: a wind told as now turns into its hour an hour after that hour began. */
export const windChangesAt = (wind: Wind, now = Date.now()) => (windIsCurrent(wind, now) ? Date.parse(wind.at) + HOUR + 1 : null);

/**
 * "Angin sekarang dari timur, 12 km/jam · asap mengarah ke barat"; "Angin pada 3 Nov 13.00 WIB: …" once that hour is
 * past; the wind at the last detection; or calm.
 */
export function windLine(wind: Wind, lang: Lang, now = Date.now()) {
  const f = formatter(lang), w = windText[lang];
  const time = f.dayTime(wind.at);
  const current = windIsCurrent(wind, now);
  if (wind.calm) return wind.mode === 'detected' ? fill(w.calmDetected, { time }) : current ? w.calmNow : fill(w.calmAt, { time });
  const vars = { from: windName(wind.fromDeg, lang), toward: windName(wind.towardDeg, lang), speed: f.num(Math.round(wind.speedKmh)), time };
  return fill(wind.mode === 'detected' ? w.detected : current ? w.now : w.at, vars);
}

/** "Desa di arah asap (≤ 5 km): A (1,2 km), B (3,4 km)"; null when no village lies downwind. */
export function downwindLine(wind: Wind, lang: Lang) {
  if (wind.calm || !wind.villages.length) return null;
  const f = formatter(lang);
  return fill(windText[lang].villages, { list: wind.villages.map(v => `${v.name} (${f.km(v.distanceM)})`).join(', ') });
}

/**
 * The line for the WhatsApp message: "Asap mengarah ke Desa A, Desa B." for the wind now, with the hour of the wind
 * when it is not ("… (angin pada 23 Okt 13.00 WIB)."), so a forwarded message never passes an old wind off as today's;
 * null without wind data or villages downwind.
 */
export function smokeSentence(wind: Wind | null | undefined, lang: Lang, now = Date.now()) {
  if (!wind || wind.calm || !wind.villages.length) return null;
  const w = windText[lang];
  const list = wind.villages.map(v => fill(w.village, { name: v.name })).join(', ');
  return windIsCurrent(wind, now) ? fill(w.smoke, { list }) : fill(w.smokeAt, { list, time: formatter(lang).dayTime(wind.at) });
}
