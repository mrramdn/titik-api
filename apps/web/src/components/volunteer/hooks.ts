import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../api';
import { useErrorText } from '../ui';

export interface Optional<T> { data: T | null; error: string | null; missing: boolean; loading: boolean; reload(): void; patch(update: (data: T) => T): void }

/**
 * GET /api/v1{path} for an endpoint that may not exist on this server yet or may not be open to this role:
 * a 404 or 403 sets `missing` instead of an error, so the screen can leave that part out quietly.
 */
export function useOptionalApi<T>(path: string | null, version = 0): Optional<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null; missing: boolean; loading: boolean }>({ data: null, error: null, missing: false, loading: Boolean(path) });
  const [tick, setTick] = useState(0);
  const describe = useErrorText();
  useEffect(() => {
    if (!path) return;
    let alive = true;
    setState(previous => ({ ...previous, loading: true }));
    api<{ data: T }>(path)
      .then(body => { if (alive) setState({ data: body.data, error: null, missing: false, loading: false }); })
      .catch(error => {
        if (!alive) return;
        const missing = error instanceof ApiError && (error.status === 404 || error.status === 403);
        setState(previous => ({ data: missing ? null : previous.data, error: missing ? null : describe(error), missing, loading: false }));
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, version]);
  const reload = useCallback(() => setTick(value => value + 1), []);
  const patch = useCallback((update: (data: T) => T) => setState(previous => (previous.data ? { ...previous, data: update(previous.data) } : previous)), []);
  return { ...state, reload, patch };
}

/** True while the media query matches, e.g. useMedia('(max-width: 400px)'). */
export function useMedia(query: string) {
  const [matches, setMatches] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const list = matchMedia(query);
    const change = () => setMatches(list.matches);
    change();
    list.addEventListener('change', change);
    return () => list.removeEventListener('change', change);
  }, [query]);
  return matches;
}
