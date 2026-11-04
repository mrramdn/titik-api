import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LangProvider } from './i18n';
import { C3S_NOTICE, OPEN_METEO_URL } from './components/OpenMeteo';
import { EOX_ATTRIBUTION, sentinelUnderEsri } from './map/layers';
import { RISK_ATTRIBUTION } from './map/risk';
import { AboutDoc, aboutText } from './pages/About';

/** EOX's credit for the 2023 layer as cloudless.eox.at/license-non-commercial gives it. */
const EOX_2023 = 'EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2023)';
const C3S_SHORT = 'Contains modified Copernicus Climate Change Service information 2026';

/** The text a reader sees in some HTML: tags dropped, entities read, spaces collapsed. */
const textOf = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
/** `element` as HTML in Indonesian, or in English as a visitor who chose it. */
function render(element: ReactElement, lang: 'id' | 'en') {
  vi.stubGlobal('localStorage', { getItem: () => lang, setItem() {} });
  return renderToStaticMarkup(createElement(LangProvider, null, element));
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('credits on the map', () => {
  it('credits the detailed imagery word for word as EOX asks for the 2023 layer, with both links and the licence', () => {
    expect(textOf(EOX_ATTRIBUTION)).toBe(`${EOX_2023} · CC BY-NC-SA 4.0`);
    expect(EOX_ATTRIBUTION).toContain('<a href="https://cloudless.eox.at" target="_blank" rel="noopener">https://cloudless.eox.at</a>');
    expect(EOX_ATTRIBUTION).toContain('<a href="https://eox.at" target="_blank" rel="noopener">EOX IT Services GmbH</a>');
    expect(EOX_ATTRIBUTION).toContain('href="https://creativecommons.org/licenses/by-nc-sa/4.0/"');
    expect(sentinelUnderEsri().attribution).toBe(EOX_ATTRIBUTION);
  });

  it('credits the fire danger cells to Open-Meteo, linked, and to Copernicus for the ERA5 data they start from', () => {
    expect(RISK_ATTRIBUTION).toContain(`<a href="${OPEN_METEO_URL}" target="_blank" rel="noopener">Open-Meteo.com</a> (CC BY 4.0)`);
    expect(textOf(RISK_ATTRIBUTION)).toBe(`Open-Meteo.com (CC BY 4.0) · ${C3S_SHORT}`);
  });
});

describe('the About page', () => {
  it('says everything in Indonesian and English, with the same placeholders', () => {
    expect(Object.keys(aboutText.en).sort()).toEqual(Object.keys(aboutText.id).sort());
    const holes = (value: string) => (value.match(/\{\w+\}/g) ?? []).sort();
    for (const key of Object.keys(aboutText.id) as (keyof typeof aboutText.id)[]) expect(holes(aboutText.en[key]), key).toEqual(holes(aboutText.id[key]));
  });

  it('gives EOX\'s credit word for word with its links, and the Copernicus notice in English in both languages', () => {
    for (const lang of ['id', 'en'] as const) {
      const html = render(createElement(AboutDoc), lang);
      const text = textOf(html);
      expect(text, lang).toContain(EOX_2023);
      expect(html, lang).toContain('href="https://cloudless.eox.at"');
      expect(html, lang).toContain('href="https://eox.at"');
      expect(html, lang).toContain('href="https://creativecommons.org/licenses/by-nc-sa/4.0/"');
      expect(html, lang).toContain(`<q lang="en">${C3S_NOTICE}</q>`);
      expect(html, lang).toContain('<h2 id="sumber">');
      expect(text, lang).not.toMatch(/\{\w+\}/);
    }
    expect(textOf(render(createElement(AboutDoc), 'id'))).toContain('Bahaya kebakaran juga memakai data reanalisis ERA5 dari Copernicus Climate Change Service: ');
    expect(textOf(render(createElement(AboutDoc), 'en'))).toContain('The fire danger also uses ERA5 reanalysis data from the Copernicus Climate Change Service: ');
    expect(C3S_NOTICE).toBe('Generated using or contains modified Copernicus Climate Change Service information 2026. Neither the European Commission nor ECMWF is responsible for any use that may be made of the Copernicus information or data it contains.');
  });

  it('says in its privacy section what the web server logs, why, and that it deletes it after 14 days', () => {
    expect(textOf(render(createElement(AboutDoc), 'id'))).toContain('Server web mencatat alamat IP dan alamat yang diakses pada setiap permintaan, untuk keamanan dan untuk membatasi beban, lalu menghapus catatan itu secara otomatis setelah 14 hari.');
    expect(textOf(render(createElement(AboutDoc), 'en'))).toContain('The web server records the IP address and the requested address of each request, for security and load limits, and deletes these records automatically after 14 days.');
  });
});
