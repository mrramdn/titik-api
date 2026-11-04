import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, BUSY_RETRIES } from './api';

/** A response as api() reads it: status, headers and a JSON body. */
const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  ({ ok: status >= 200 && status < 300, status, headers: new Headers(headers), json: async () => body }) as Response;
/** What the API answers when its heavy lists are at their limit. */
const busy = (retryAfter?: string) => reply(503, { error: { code: 'BUSY', message: 'Server sedang sibuk. Coba lagi beberapa detik lagi.' } },
  retryAfter === undefined ? {} : { 'retry-after': retryAfter });

describe('a read the server was too busy for', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('is asked again after the Retry-After it names, and only the answer that comes shows', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const fetch = vi.fn().mockResolvedValueOnce(busy('2')).mockResolvedValueOnce(busy('1')).mockResolvedValueOnce(reply(200, { data: [1] }));
    vi.stubGlobal('fetch', fetch);
    const answer = api<{ data: number[] }>('/incidents?hours=24');
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(answer).resolves.toEqual({ data: [1] });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it(`shows the server's BUSY error after ${BUSY_RETRIES} more tries, waiting 1 to 5 seconds whatever Retry-After says`, async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const fetch = vi.fn().mockImplementation(async () => busy('60'));
    vi.stubGlobal('fetch', fetch);
    const answer = api('/dashboard').catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5001);
    const error = await answer;
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 503, code: 'BUSY' });
    expect(fetch).toHaveBeenCalledTimes(1 + BUSY_RETRIES);
    // No header, or one that is not a number of seconds: 2 seconds.
    for (const header of [undefined, 'soon', '0']) {
      fetch.mockReset().mockResolvedValueOnce(busy(header)).mockResolvedValueOnce(reply(200, { data: 'ok' }));
      const next = api('/recap?date=2026-11-02');
      await vi.advanceTimersByTimeAsync(1999);
      expect(fetch, String(header)).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(next).resolves.toEqual({ data: 'ok' });
    }
  });

  it('is never repeated for a write, nor for another error', async () => {
    const fetch = vi.fn().mockImplementation(async () => busy('1'));
    vi.stubGlobal('fetch', fetch);
    await expect(api('/incidents/x/assignments', { method: 'POST', json: {} })).rejects.toMatchObject({ code: 'BUSY' });
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockImplementation(async () => reply(503, { error: { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan di server.' } }));
    await expect(api('/incidents')).rejects.toMatchObject({ status: 503, code: 'INTERNAL_ERROR' });
    fetch.mockImplementation(async () => reply(429, { error: { code: 'RATE_LIMITED', message: 'Terlalu banyak permintaan.' } }, { 'retry-after': '1' }));
    await expect(api('/incidents')).rejects.toMatchObject({ status: 429, code: 'RATE_LIMITED' });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('stops waiting as soon as its request is cancelled', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      if (init.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
      return busy('5');
    });
    vi.stubGlobal('fetch', fetch);
    const request = new AbortController();
    let settled = false;
    const answer = api('/villages?q=a', { signal: request.signal }).catch((error: unknown) => error).finally(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(100);
    request.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
    expect(await answer).toBeInstanceOf(ApiError);
    expect(vi.getTimerCount()).toBe(0);
  });
});
