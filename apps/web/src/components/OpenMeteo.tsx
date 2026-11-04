// Open-Meteo's attribution (its data is CC BY 4.0), linked, next to everything that shows its weather: the fire danger
// on the map, the dashboard and the recap, and the wind at an incident. Also the notice of the Copernicus Climate Change
// Service (C3S), whose ERA5 reanalysis, from Open-Meteo's archive, starts the fire danger's codes.
import { dict, useT } from '../i18n';

export const OPEN_METEO_URL = 'https://open-meteo.com/';
/** CC BY 4.0, the licence of Open-Meteo's data, which its terms ask to link. */
export const CC_BY_URL = 'https://creativecommons.org/licenses/by/4.0/';
/** For the map's attribution control while the fire danger cells show. */
export const OPEN_METEO_ATTRIBUTION = `<a href="${OPEN_METEO_URL}" target="_blank" rel="noopener">Open-Meteo.com</a> (CC BY 4.0)`;
/** The notice ERA5's licence asks for on products made from it, word for word; kept in English in both languages. */
export const C3S_NOTICE = 'Generated using or contains modified Copernicus Climate Change Service information 2026. Neither the European Commission nor ECMWF is responsible for any use that may be made of the Copernicus information or data it contains.';
/** Its short form, for the map's attribution control. */
export const C3S_ATTRIBUTION = 'Contains modified Copernicus Climate Change Service information 2026';

export const openMeteoText = dict({
  id: { credit: 'Data cuaca: Open-Meteo.com' },
  en: { credit: 'Weather data by Open-Meteo.com' },
});

/** "Data cuaca: Open-Meteo.com" as a link, in the colour of the text around it. */
export function OpenMeteoCredit() {
  const t = useT(openMeteoText);
  return <a className="credit" href={OPEN_METEO_URL} target="_blank" rel="noopener noreferrer">{t('credit')}</a>;
}
