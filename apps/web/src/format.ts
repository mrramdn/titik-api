// Formatting in the visitor's language. Times are always WIB (Asia/Jakarta).
import type { Level, NearestPlace, Role, Status } from './api';
import { fill, useLang, type Lang } from './i18n';
import { confidenceLabel as confidenceText, falseAlarmLabel as falseAlarmText, levelLabel as levelText, roleLabel as roleText,
  satelliteName, statusHint as statusHintText, statusLabel as statusText, winds, words } from './i18n/common';

function build(lang: Lang) {
  const locale = lang === 'en' ? 'en-GB' : 'id-ID';
  const clock = new Intl.DateTimeFormat(locale, { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const date = new Intl.DateTimeFormat(locale, { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short' });
  const w = words[lang];
  // Indonesian writes 13.42, English 13:42.
  const time = (iso: string | Date) => { const text = clock.format(new Date(iso)); return lang === 'id' ? text.replace(':', '.') : text.replace('.', ':'); };
  const day = (iso: string | Date) => date.format(new Date(iso)).replace('.', '');
  const dayTime = (iso: string | Date) => `${day(iso)} ${time(iso)}`;
  const num = (value: number, digits = 0) => value.toLocaleString(locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  const km = (meters: number) => (meters < 1000 ? `${num(Math.max(10, Math.round(meters / 10) * 10))} m` : `${num(Math.round(meters / 100) / 10, 1)} km`);
  const wind = (degrees: number) => winds[lang][Math.round((((degrees % 360) + 360) % 360) / 45) % 8]!;
  return {
    lang, locale, time, day, dayTime, num, km, wind,
    /** "16 Okt 00.45 WIB", "16 Okt 00.20–01.41 WIB" or "14 Okt 13.18 – 15 Okt 01.41 WIB". */
    span(first: string, last: string) {
      const a = dayTime(first), b = dayTime(last);
      if (a === b) return `${a} WIB`;
      return day(first) === day(last) ? `${a}–${time(last)} WIB` : `${a} – ${b} WIB`;
    },
    ago(iso: string, now = Date.now()) {
      const minutes = Math.round((now - new Date(iso).getTime()) / 60000);
      if (minutes < 1) return w.justNow;
      if (minutes < 60) return fill(w.minAgo, { n: minutes });
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return fill(w.hourAgo, { n: hours });
      return fill(w.dayAgo, { n: Math.floor(hours / 24) });
    },
    /** "1 jam 23 menit" / "1 h 23 min". */
    duration(minutes: number | null | undefined) {
      if (minutes === null || minutes === undefined) return '–';
      if (minutes < 60) return `${minutes} ${w.minutes}`;
      const h = Math.floor(minutes / 60), m = minutes % 60;
      return m ? `${h} ${w.hour} ${m} ${w.minutes}` : `${h} ${w.hours}`;
    },
    percent: (value: number | null) => (value === null ? '–' : value > 0 && value < 0.01 ? '<1%' : `${Math.round(value * 100)}%`),
    /** One satellite by name, several as a count. */
    satellites(codes: string[]) { const unique = [...new Set(codes)]; return unique.length === 1 ? satelliteName(unique[0]!) : fill(w.satellites, { n: unique.length }); },
    level: (level: Level) => levelText[lang][level],
    status: (status: Status) => statusText[lang][status],
    statusHint: (status: Status) => statusHintText[lang][status],
    falseAlarm: (kind: string) => falseAlarmText[lang][kind] ?? kind,
    role: (role: Role | 'public') => roleText[lang][role],
    confidence: (value: string) => confidenceText[lang][value as 'low' | 'nominal' | 'high'] ?? value,
    /** "6,9 km barat daya Sungai Menang" / "6.9 km southwest of Sungai Menang". */
    place: (place: NearestPlace) => (lang === 'id' ? `${km(place.distanceM)} ${wind(place.bearingDeg)} ${place.name}` : `${km(place.distanceM)} ${wind(place.bearingDeg)} of ${place.name}`),
  };
}
export type Format = ReturnType<typeof build>;
const cache = new Map<Lang, Format>();
export const formatter = (lang: Lang) => { let value = cache.get(lang); if (!value) { value = build(lang); cache.set(lang, value); } return value; };
export const useFormat = () => formatter(useLang().lang);

// Indonesian shortcuts for code that has not moved to useFormat() yet.
const id = formatter('id');
export const wib = id.time;
export const wibDay = id.dayTime;
export const timeSpan = id.span;
export const satellites = id.satellites;
export const ago = id.ago;
export const duration = id.duration;
export const percent = id.percent;
export const km = id.km;
export const satelliteLabel: Record<string, string> = new Proxy({}, { get: (_target, code: string) => satelliteName(code) });
export const confidenceLabel = confidenceText.id;
export const levelLabel = levelText.id;
export const statusLabel = statusText.id;
export const statusHint = statusHintText.id;
export const falseAlarmLabel = falseAlarmText.id;
export const roleLabel = roleText.id as Record<string, string>;
