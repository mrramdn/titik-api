// @vitest-environment happy-dom
// Labels that depend on the clock, on screens left open: nothing else renders them again while there is no signal, so
// each must render again by itself when its label is due to change. The components render in a browser-like DOM under
// fake timers and a fake clock, which the tests move on.
import { act, createElement, type ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RegencyRiskDay, Risk, RiskDay, Wind } from './api';
import { nextWibMidnight } from './clock';
import { DangerCard } from './components/bpbd/DangerCard';
import { WindFacts } from './components/incident/Wind';
import { LangProvider } from './i18n';
import { RiskDays, useRiskDay } from './map/RiskParts';
import { advance, renderDom, type Rendered } from './renderDom';

const HOUR = 3_600_000;
let view: Rendered | null = null;
async function render(element: ReactElement) {
  view = await renderDom(createElement(LangProvider, null, element));
  return view;
}
/** The clock stands at `iso`; timers wait for advance(). */
const at = (iso: string) => vi.useFakeTimers({ now: new Date(iso), toFake: ['setTimeout', 'clearTimeout', 'Date'] });
afterEach(async () => {
  await view?.unmount();
  view = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the clock', () => {
  it('gives the first moment of the next WIB day', () => {
    expect(new Date(nextWibMidnight(Date.parse('2026-11-04T16:50:00Z'))).toISOString()).toBe('2026-11-04T17:00:00.000Z');
    expect(new Date(nextWibMidnight(Date.parse('2026-11-04T17:00:00Z'))).toISOString()).toBe('2026-11-05T17:00:00.000Z');
    expect(new Date(nextWibMidnight(Date.parse('2026-12-31T16:59:59.999Z'))).toISOString()).toBe('2026-12-31T17:00:00.000Z');
  });
});

describe('the wind in an incident panel left open', () => {
  // 13.00 WIB on 4 Nov, the hour the server asked for.
  const wind: Wind = { mode: 'now', at: '2026-11-04T06:00:00Z', speedKmh: 12.4, fromDeg: 90, towardDeg: 270, calm: false,
    villages: [{ id: 'a', name: 'Sungai Pasir', distanceM: 1230, bearingDeg: 265 }] };
  const line = () => view!.host.querySelector('.ip-wind-line')!.textContent;

  it('turns "sekarang" into its hour an hour after that hour began', async () => {
    at('2026-11-04T06:40:00Z');
    await render(createElement(WindFacts, { wind }));
    expect(line()).toBe('Angin sekarang dari timur, 12 km/jam · asap mengarah ke barat');
    await advance(20 * 60_000);
    expect(line()).toBe('Angin sekarang dari timur, 12 km/jam · asap mengarah ke barat');
    await advance(1);
    expect(line()).toBe('Angin pada 4 Nov 13.00 WIB: dari timur, 12 km/jam · asap mengarah ke barat');
  });

  it('catches up as soon as the page is in view again, after a phone slept and held its timer back', async () => {
    at('2026-11-04T06:40:00Z');
    await render(createElement(WindFacts, { wind }));
    vi.setSystemTime(new Date('2026-11-04T08:40:00Z'));
    expect(line()).toBe('Angin sekarang dari timur, 12 km/jam · asap mengarah ke barat');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(line()).toBe('Angin pada 4 Nov 13.00 WIB: dari timur, 12 km/jam · asap mengarah ke barat');
  });
});

const cellDay = (date: string): RiskDay => ({ date, forecast: true, fwiClass: 'tinggi', codes: { ffmc: 88, dmc: 60, dc: 500, isi: 6, bui: 95, fwi: 9 },
  noon: { tempC: 33, rhPct: 50, windKmh: 12, windFromDeg: 90, rain24hMm: 0 }, dryDays: 10 });
const regencyDay = (date: string, high: number): RegencyRiskDay => ({ date, forecast: true, fwiClass: high ? 'tinggi' : 'rendah',
  shares: { rendah: 1 - high, sedang: 0, tinggi: high, sangat_tinggi: 0 }, partial: null, meanFwi: high ? 9 : 0.5 });
/** A live answer for 4–6 Nov, computed at `fetchedAt`: Pulang Pisau high on 80% of its area on 5 Nov only. */
const live = (fetchedAt: string): Risk => ({
  asOf: '2026-11-04', archive: false, fetchedAt, cellSize: 0.5,
  cells: [{ lon: 114, lat: -2.5, days: ['2026-11-04', '2026-11-05', '2026-11-06'].map(cellDay) }],
  regencies: [{ name: 'Pulang Pisau', province: 'Kalimantan Tengah', center: [114, -2.5], peatShare: 0.6,
    days: [regencyDay('2026-11-04', 0), regencyDay('2026-11-05', 0.8), regencyDay('2026-11-06', 0)] }],
});

describe('the map\'s fire danger switch left open', () => {
  /** The switch as the map wires it: the day shown and today from useRiskDay, no day chosen. */
  function MapSwitch({ data }: { data: Risk }) {
    const { today, day } = useRiskDay(data, null, '');
    return createElement(RiskDays, { risk: { data, error: null, loading: false, reload() {} }, day, today, onDay() {} });
  }
  const buttons = () => [...view!.host.querySelectorAll('.risk-days button')].map(b => `${b.textContent}${b.getAttribute('aria-pressed') === 'true' ? ' (on)' : ''}`);
  const age = () => view!.host.querySelector('.risk-days > span:last-child')?.textContent ?? null;

  it('names its days against the new today at WIB midnight, and moves to it', async () => {
    // 23.50 WIB on 4 Nov; computed at 10.00 WIB.
    at('2026-11-04T16:50:00Z');
    await render(createElement(MapSwitch, { data: live('2026-11-04T03:00:00Z') }));
    expect(buttons()).toEqual(['Hari ini (on)', 'Besok', 'Lusa']);
    expect(age()).toBe('Dihitung 13 jam lalu');
    await advance(10 * 60_000 - 1);
    expect(buttons()).toEqual(['Hari ini (on)', 'Besok', 'Lusa']);
    await advance(1);
    expect(buttons()).toEqual(['4 Nov', 'Hari ini (on)', 'Besok']);
    expect(age()).toBe('Dihitung 14 jam lalu');
  });

  it('shows the forecast\'s age once it passes 6 hours, then lets it grow', async () => {
    const fetchedAt = '2026-11-04T01:00:00Z';
    at(new Date(Date.parse(fetchedAt) + 6 * HOUR).toISOString());
    await render(createElement(MapSwitch, { data: live(fetchedAt) }));
    expect(view!.text()).not.toContain('Dihitung');
    await advance(1);
    expect(age()).toBe('Dihitung 6 jam lalu');
    await advance(HOUR - 1);
    expect(age()).toBe('Dihitung 7 jam lalu');
    await advance(17 * HOUR);
    expect(age()).toBe('Dihitung 1 hari lalu');
    await advance(24 * HOUR);
    expect(age()).toBe('Dihitung 2 hari lalu');
  });
});

describe('the dashboard\'s fire danger card left open', () => {
  it('moves on to the new tomorrow at WIB midnight, and its age grows', async () => {
    at('2026-11-04T16:50:00Z');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: live('2026-11-04T03:00:00Z') }), { status: 200, headers: { 'content-type': 'application/json' } })));
    await render(createElement(MemoryRouter, null, createElement(DangerCard, { province: '' })));
    await advance(0);
    const card = () => view!.host.querySelector('.bd-danger-text')!.textContent!;
    expect(card()).toContain('Tinggi atau lebih di 1 kabupaten, menurut bagian wilayahnya: Pulang Pisau 80%.');
    expect(card()).toContain('Dihitung 13 jam lalu.');
    await advance(10 * 60_000);
    expect(card()).toContain('Tidak ada kabupaten dengan bahaya tinggi atau lebih di sedikitnya 10% wilayahnya.');
    expect(card()).toContain('Dihitung 14 jam lalu.');
  });
});
