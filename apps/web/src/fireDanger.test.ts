// @vitest-environment happy-dom
// The fire danger's credits where its classes show without the map: the dashboard's card and the daily recap, rendered
// in a browser-like DOM with the API stubbed.
import { createElement } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Recap, RegencyRiskDay, Risk, RiskDay, User } from './api';
import { renderDom, until, type Rendered } from './renderDom';

const CREDITS = 'Data cuaca: Open-Meteo.com · Contains modified Copernicus Climate Change Service information 2026';
const bpbd: User = { id: '10000000-0000-4000-8000-000000000003', name: 'BPBD (demo)', email: 'bpbd@titikapi.test', role: 'bpbd', organization: 'BPBD', demo: true };
const cellDay = (date: string): RiskDay => ({ date, forecast: true, fwiClass: 'tinggi', codes: { ffmc: 88, dmc: 60, dc: 500, isi: 6, bui: 95, fwi: 9 },
  noon: { tempC: 33, rhPct: 50, windKmh: 12, windFromDeg: 90, rain24hMm: 0 }, dryDays: 10 });
const regencyDay = (date: string): RegencyRiskDay => ({ date, forecast: true, fwiClass: 'tinggi', shares: { rendah: 0.2, sedang: 0, tinggi: 0.8, sangat_tinggi: 0 }, partial: null, meanFwi: 9 });
const dates = ['2026-11-04', '2026-11-05', '2026-11-06'];
const risk: Risk = { asOf: '2026-11-04', archive: false, fetchedAt: '2026-11-04T03:00:00Z', cellSize: 0.5,
  cells: [{ lon: 114, lat: -2.5, days: dates.map(cellDay) }],
  regencies: [{ name: 'Pulang Pisau', province: 'Kalimantan Tengah', center: [114, -2.5], peatShare: 0.6, days: dates.map(regencyDay) }] };
const recap: Recap = { date: '2026-11-04', province: null,
  totals: { incidents: 3, high: 1, checked: 1, checkedShare: 1 / 3, medianMinutes: 40, falseAlarms: 0, detections: 9 },
  regencies: [{ name: 'Pulang Pisau', province: 'Kalimantan Tengah', incidents: 3, high: 1, checked: 1, openHigh: 0, medianMinutes: 40 }],
  villages: [], checks: { api_aktif: 1 }, assignments: { ditugaskan: 0, menuju: 0, selesai: 0, dibatalkan: 0 } };

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const answers: Record<string, unknown> = { '/api/v1/auth/me': { data: bpbd }, '/api/v1/regions': { data: [] }, '/api/v1/risk': { data: risk }, '/api/v1/recap': { data: recap } };
let view: Rendered | null = null;
beforeEach(() => {
  // 12.00 WIB on 4 Nov 2026; only the clock is fake, timers run.
  vi.useFakeTimers({ now: new Date('2026-11-04T05:00:00Z'), toFake: ['Date'] });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => json(answers[new URL(String(input), 'http://localhost').pathname] ?? { data: null })));
  localStorage.clear();
  localStorage.setItem('titikapi.user', JSON.stringify(bpbd));
});
afterEach(async () => {
  await view?.unmount();
  view = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the fire danger\'s credits', () => {
  it('stand side by side under the dashboard\'s card', async () => {
    const [{ DangerCard }, { LangProvider }] = await Promise.all([import('./components/bpbd/DangerCard'), import('./i18n')]);
    view = await renderDom(createElement(LangProvider, null, createElement(MemoryRouter, null, createElement(DangerCard, { province: '' }))));
    await until(() => Boolean(view!.host.querySelector('.bd-danger')));
    const caption = [...view.host.querySelectorAll('.bd-danger-text .caption')].map(p => p.textContent).at(-1);
    expect(caption).toBe(`FWI dari data model Open-Meteo dengan kelas BMKG. Bukan produk resmi BMKG. ${CREDITS}`);
  });

  it('stand side by side in the recap\'s fire danger note, which also prints', async () => {
    const [{ RecapPage }, { LangProvider }, { SessionProvider }, { RegionProvider }] = await Promise.all([
      import('./pages/Recap'), import('./i18n'), import('./session'), import('./region'),
    ]);
    view = await renderDom(createElement(LangProvider, null, createElement(SessionProvider, null, createElement(RegionProvider, null,
      createElement(MemoryRouter, { initialEntries: ['/rekap'] }, createElement(RecapPage))))));
    await until(() => [...view!.host.querySelectorAll('.recap-body p.note')].some(p => p.textContent?.startsWith('Bahaya kebakaran:')));
    const notes = [...view.host.querySelectorAll('.recap-body p.note')].map(p => p.textContent);
    expect(notes).toContain(CREDITS);
  });
});
