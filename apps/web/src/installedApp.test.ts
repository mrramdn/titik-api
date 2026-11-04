import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runsAsInstalledApp } from './installedApp';
import { LandingPage } from './pages/Landing';
import { RegionProvider } from './region';
import { SessionProvider } from './session';

// <Navigate> moves in an effect, which a server render never runs: here it writes where it would go.
vi.mock('react-router', async original => ({
  ...await original<typeof import('react-router')>(),
  Navigate: ({ to, replace }: { to: string; replace?: boolean }) => createElement('a', { 'data-navigate': to, 'data-replace': String(Boolean(replace)) }),
}));

/** A window whose display mode is `mode` ('browser' for a tab), with Safari's navigator.standalone when given. */
const display = (mode: string, standalone?: boolean) => ({
  matchMedia: (query: string) => ({ matches: query === `(display-mode: ${mode})` }) as MediaQueryList,
  navigator: standalone === undefined ? {} : { standalone },
});

describe('the installed app', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('is told from a browser tab by its display mode, or by navigator.standalone on iOS', () => {
    for (const mode of ['standalone', 'fullscreen', 'minimal-ui']) expect(runsAsInstalledApp(display(mode)), mode).toBe(true);
    expect(runsAsInstalledApp(display('browser'))).toBe(false);
    expect(runsAsInstalledApp(display('browser', true))).toBe(true);
    expect(runsAsInstalledApp(display('browser', false))).toBe(false);
    expect(runsAsInstalledApp({ navigator: {} })).toBe(false);
    expect(runsAsInstalledApp(undefined)).toBe(false);
  });

  it('goes from / on to the map with the same query and hash, in place; a browser tab shows the landing page', () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} });
    const render = (path: string) => renderToStaticMarkup(createElement(SessionProvider, null, createElement(RegionProvider, null,
      createElement(MemoryRouter, { initialEntries: [path] }, createElement(LandingPage)))));
    // A browser tab: the landing page, no redirect.
    const tab = render('/?utm_source=wa');
    expect(tab).not.toContain('data-navigate');
    expect(tab).toContain('href="/tugas?lihat=mpa"');
    // An install from the judged version still opens / (its start_url then).
    vi.stubGlobal('window', display('standalone'));
    expect(render('/')).toBe('<a data-navigate="/peta" data-replace="true"></a>');
    expect(render('/?utm_source=wa#peta')).toBe('<a data-navigate="/peta?utm_source=wa#peta" data-replace="true"></a>');
    vi.stubGlobal('window', display('browser', true));
    expect(render('/')).toBe('<a data-navigate="/peta" data-replace="true"></a>');
    // An old map link keeps going where it went.
    vi.unstubAllGlobals();
    vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} });
    expect(render('/?tanggal=2026-10-23')).toBe('<a data-navigate="/peta?tanggal=2026-10-23" data-replace="true"></a>');
  });
});
