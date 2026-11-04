// Open-Meteo's attribution (its data is CC BY 4.0), linked, next to everything that shows its weather: the fire danger
// on the map, the dashboard and the recap, and the wind at an incident. Also the notice of the Copernicus Climate Change
// Service (C3S), whose ERA5 reanalysis, from Open-Meteo's archive, starts the fire danger's codes: in full on the About
// page, short on the map and next to Open-Meteo's credit on the dashboard and the recap.
import { dict, useT } from '../i18n';

export const OPEN_METEO_URL = 'https://open-meteo.com/';
/** CC BY 4.0, the licence of Open-Meteo's data, which its terms ask to link. */
export const CC_BY_URL = 'https://creativecommons.org/licenses/by/4.0/';
/** For the map's attribution control while the fire danger cells show. */
export const OPEN_METEO_ATTRIBUTION = `<a href="${OPEN_METEO_URL}" target="_blank" rel="noopener">Open-Meteo.com</a> (CC BY 4.0)`;

const wibYear = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric' });
/**
 * The years of ERA5 data in the fire danger's codes: 2026, when Titik Api began computing them, to the current WIB year
 * ("2026–2027" from New Year), as the codes carry over from day to day.
 */
export function c3sYears(now = new Date()) {
  const year = Number(wibYear.format(now));
  return year > 2026 ? `2026–${year}` : '2026';
}
/** The notice ERA5's licence asks for on products made from it, word for word; kept in English in both languages. */
export const c3sNotice = (now = new Date()) => `Generated using or contains modified Copernicus Climate Change Service information ${c3sYears(now)}. Neither the European Commission nor ECMWF is responsible for any use that may be made of the Copernicus information or data it contains.`;
/** Its short form, for the map's attribution control and next to Open-Meteo's credit. */
export const c3sAttribution = (now = new Date()) => `Contains modified Copernicus Climate Change Service information ${c3sYears(now)}`;

export const openMeteoText = dict({
  id: { credit: 'Data cuaca: Open-Meteo.com' },
  en: { credit: 'Weather data by Open-Meteo.com' },
});

/** "Data cuaca: Open-Meteo.com" as a link, in the colour of the text around it. */
export function OpenMeteoCredit() {
  const t = useT(openMeteoText);
  return <a className="credit" href={OPEN_METEO_URL} target="_blank" rel="noopener noreferrer">{t('credit')}</a>;
}

/**
 * The fire danger's credits side by side, where its classes show without the map: Open-Meteo's, and the short
 * Copernicus notice for the ERA5 data the codes start from, in English as its licence words it.
 */
export function FireDangerCredit() {
  return <><OpenMeteoCredit /> · <span lang="en">{c3sAttribution()}</span></>;
}
