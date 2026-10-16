// Distances and directions computed on the phone, so the field check works without a signal.
import type { Lang } from './i18n';
import { winds } from './i18n/common';

const rad = (d: number) => (d * Math.PI) / 180;

export function distanceMeters([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]) {
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(a));
}

/** Initial bearing in degrees, 0 = north, clockwise. */
export function bearing([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]) {
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Any angle folded into 0–360. */
export const normalize = (degrees: number) => ((degrees % 360) + 360) % 360;

/** "tenggara" / "southeast": one of eight directions. */
export const windName = (degrees: number, lang: Lang = 'id') => winds[lang][Math.round(normalize(degrees) / 45) % 8]!;

/** The point closest to `here`, with its distance in metres. */
export function nearestPoint(here: [number, number], points: [number, number][]): { point: [number, number]; meters: number } | null {
  let best: { point: [number, number]; meters: number } | null = null;
  for (const point of points) {
    const meters = distanceMeters(here, point);
    if (!best || meters < best.meters) best = { point, meters };
  }
  return best;
}

/** "-3.42692, 105.22732": latitude first, the order map apps and WhatsApp understand. */
export const coordText = ([lon, lat]: [number, number]) => `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
