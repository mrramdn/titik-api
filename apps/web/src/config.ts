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

/** What GET /config answered; anything else (an older server) means no HD imagery. */
export function readConfig(data: Partial<AppConfig> | null | undefined): AppConfig {
  const hdImagery = data?.hdImagery === true;
  return { hdImagery, imageryAttribution: hdImagery && typeof data?.imageryAttribution === 'string' ? data.imageryAttribution : null };
}

/** Without a signal the answer is unknown: no HD imagery for now, and the next map that opens asks again. */
export function loadConfig(): Promise<Config> {
  pending ??= api<{ data: AppConfig | null }>('/config').then(
    body => (settled = { ...readConfig(body?.data), current: true }),
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 404) return (settled = { ...readConfig(null), current: false });
      pending = null;
      return { ...readConfig(null), current: true };
    },
  );
  return pending;
}

/**
 * The API stopped serving Esri tiles to this visitor (a cap, its share of the day, refused): maps opened later in this
 * page's life go without HD imagery, as if GET /config had said so. A reload asks again.
 */
export function refuseImagery() {
  if (!settled?.hdImagery) return;
  settled = { ...settled, hdImagery: false, imageryAttribution: null };
  pending = Promise.resolve(settled);
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
