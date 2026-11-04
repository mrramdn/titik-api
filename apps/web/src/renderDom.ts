// For tests only: renders a component into happy-dom, so its effects, timers and event listeners run as they do in a
// browser. A test file that uses it starts with `// @vitest-environment happy-dom`; the others keep rendering to HTML
// on the server. act() lets React finish each step before the test looks.
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface Rendered {
  host: HTMLElement;
  /** The text on screen, spaces collapsed. */
  text(): string;
  rerender(element: ReactElement): Promise<void>;
  unmount(): Promise<void>;
}

export async function renderDom(element: ReactElement): Promise<Rendered> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(element); });
  return {
    host,
    text: () => (host.textContent ?? '').replace(/\s+/g, ' ').trim(),
    rerender: async next => { await act(async () => { root.render(next); }); },
    unmount: async () => { await act(async () => { root.unmount(); }); host.remove(); },
  };
}

/** Moves fake timers on by `ms` and lets React render what they set off. */
export async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

/** Waits, with real timers, until `test` holds, letting React render in between; fails after `ms`. */
export async function until(test: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error('until: the condition never held');
    await act(async () => { await new Promise(done => setTimeout(done, 10)); });
  }
}
