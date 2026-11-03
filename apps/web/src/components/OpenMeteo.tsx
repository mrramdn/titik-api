// Open-Meteo's attribution (its data is CC BY 4.0), linked, next to everything that shows its weather: the fire danger
// on the map, the dashboard and the recap, and the wind at an incident.
import { dict, useT } from '../i18n';

export const OPEN_METEO_URL = 'https://open-meteo.com/';
/** For the map's attribution control while the fire danger cells show. */
export const OPEN_METEO_ATTRIBUTION = `<a href="${OPEN_METEO_URL}" target="_blank" rel="noopener">Open-Meteo.com</a> (CC BY 4.0)`;

export const openMeteoText = dict({
  id: { credit: 'Data cuaca: Open-Meteo.com' },
  en: { credit: 'Weather data by Open-Meteo.com' },
});

/** "Data cuaca: Open-Meteo.com" as a link, in the colour of the text around it. */
export function OpenMeteoCredit() {
  const t = useT(openMeteoText);
  return <a className="credit" href={OPEN_METEO_URL} target="_blank" rel="noopener noreferrer">{t('credit')}</a>;
}
