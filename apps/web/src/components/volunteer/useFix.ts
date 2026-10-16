// One GPS fix, taken when the volunteer asks for it (or silently when location is already allowed), shared by
// every card on the page. GPS works without a phone signal; the fix is kept for half an hour.
import { useSyncExternalStore } from 'react';

export interface Fix { at: number; here: [number, number]; accuracy: number }
export type FixStatus = 'idle' | 'locating' | 'ok' | 'denied' | 'unavailable' | 'unsupported';
interface FixState { fix: Fix | null; status: FixStatus }

const storageKey = 'titikapi.fix';
const freshMs = 30 * 60_000;

function stored(): Fix | null {
  try {
    const fix = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Fix | null;
    return fix && Date.now() - fix.at < freshMs && Array.isArray(fix.here) ? fix : null;
  } catch { return null; }
}

let state: FixState = { fix: typeof window === 'undefined' ? null : stored(), status: 'idle' };
const listeners = new Set<() => void>();
const update = (next: Partial<FixState>) => { state = { ...state, ...next }; listeners.forEach(listener => listener()); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

let pending: Promise<Fix | null> | null = null;
export function locate(): Promise<Fix | null> {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) { update({ status: 'unsupported' }); return Promise.resolve(null); }
  pending ??= new Promise<Fix | null>(resolve => {
    update({ status: 'locating' });
    navigator.geolocation.getCurrentPosition(position => {
      const fix: Fix = { at: Date.now(), here: [position.coords.longitude, position.coords.latitude], accuracy: position.coords.accuracy };
      try { localStorage.setItem(storageKey, JSON.stringify(fix)); } catch { /* private mode */ }
      update({ fix, status: 'ok' });
      resolve(fix);
    }, error => {
      update({ status: error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable' });
      resolve(null);
    }, { enableHighAccuracy: true, timeout: 30_000, maximumAge: 5 * 60_000 });
  }).finally(() => { pending = null; });
  return pending;
}

/** Takes a fix without a prompt, only when the visitor has already allowed location for this site. */
export async function locateIfAllowed() {
  try {
    const permission = await navigator.permissions?.query({ name: 'geolocation' as PermissionName });
    if (permission?.state === 'granted') await locate();
  } catch { /* no Permissions API: wait for the volunteer to ask */ }
}

export const useFix = () => useSyncExternalStore(subscribe, () => state, () => state);
