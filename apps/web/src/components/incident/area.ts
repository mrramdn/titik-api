// The indicated hot area: the pixel footprints of one satellite pass, in hectares. It is not burned area, and every
// place that shows it says so once.
import type { Incident } from '../../api';
import { dict, type Lang } from '../../i18n';
import { formatter } from '../../format';

export const areaText = dict({
  id: {
    label: 'Indikasi luas area panas', coarse: '(kasar, MODIS ±1 km)',
    help: 'Luas jejak piksel pada satu lintasan satelit. Bukan luas terbakar.',
  },
  en: {
    label: 'Indicated hot area', coarse: '(coarse, MODIS ±1 km)',
    help: 'Pixel footprint area on one satellite pass. Not burned area.',
  },
});

/** "12,5 ha", or "120 ha (kasar, MODIS ±1 km)" when only MODIS saw it; null when the server computed no area. */
export function indicatedArea(incident: Pick<Incident, 'indicatedAreaHa' | 'modisOnly'>, lang: Lang): string | null {
  const hectares = incident.indicatedAreaHa;
  if (hectares === null || hectares === undefined) return null;
  const value = formatter(lang).ha(hectares);
  return incident.modisOnly ? `${value} ${areaText[lang].coarse}` : value;
}
