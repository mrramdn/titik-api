// @vitest-environment happy-dom
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useApi } from './components/ui';
import { renderDom, until } from './renderDom';

function List({ path }: { path: string }) {
  const list = useApi<string[]>(path);
  return createElement('p', null, list.data ? list.data.join(',') : (list.error ?? 'memuat'));
}

describe('useApi', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('cancels a request no longer needed: when the path changes, and when the screen closes', async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => { signals.push(init.signal!); return new Promise<Response>(() => {}); }));
    const screen = await renderDom(createElement(List, { path: '/incidents?hours=24' }));
    expect(signals).toHaveLength(1);
    expect(signals[0]!.aborted).toBe(false);
    await screen.rerender(createElement(List, { path: '/incidents?hours=72' }));
    expect(signals.map(signal => signal.aborted)).toEqual([true, false]);
    await screen.unmount();
    expect(signals.map(signal => signal.aborted)).toEqual([true, true]);
  });

  it('shows the answer of a request that was not cancelled', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, headers: new Headers(), json: async () => ({ data: ['a', 'b'] }) }) as Response));
    const screen = await renderDom(createElement(List, { path: '/regions' }));
    await until(() => screen.text() === 'a,b');
    await screen.unmount();
  });
});
