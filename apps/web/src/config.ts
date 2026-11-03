// GET /config, once per page load: public settings for the web app.
import { useEffect, useState } from 'react';
import { api, ApiError, type AppConfig } from './api';

/**
 * `current` is false when the server predates GET /config (it answers 404). Such a server has no pixel footprints in
 * its tiles and no GET /risk either, so the map leaves those out.
 */
export interface Config extends AppConfig { current: boolean }

let settled: Config | null = null;
let pending: Promise<Config> | null = null;

/** Without a signal the answer is unknown: no HD imagery for now, and the next map that opens asks again. */
export function loadConfig(): Promise<Config> {
  pending ??= api<{ data: AppConfig | null }>('/config').then(
    body => (settled = { esriKey: body?.data?.esriKey ?? null, current: true }),
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 404) return (settled = { esriKey: null, current: false });
      pending = null;
      return { esriKey: null, current: true };
    },
  );
  return pending;
}

/** The settings, null until GET /config has answered once. */
export function useConfig(): Config | null {
  const [config, setConfig] = useState<Config | null>(settled);
  useEffect(() => {
    let alive = true;
    void loadConfig().then(value => { if (alive) setConfig(value); });
    return () => { alive = false; };
  }, []);
  return config;
}
