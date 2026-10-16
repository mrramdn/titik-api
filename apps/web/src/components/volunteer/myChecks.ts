// Field checks filed from this phone, so a task card can say "Sudah kamu cek" before the server has the report.
// Only a per-device convenience: the server stays the record.
import type { Status } from '../../api';

export interface MyCheck { at: string; status: Status }
const storageKey = 'titikapi.myChecks';
const keepDays = 14;

export function myChecks(): Record<string, MyCheck> {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as Record<string, MyCheck>;
    return value && typeof value === 'object' ? value : {};
  } catch { return {}; }
}

export function rememberCheck(incidentId: string, check: MyCheck) {
  const cutoff = Date.now() - keepDays * 24 * 3600_000;
  const next = Object.fromEntries(Object.entries({ ...myChecks(), [incidentId]: check }).filter(([, value]) => new Date(value.at).getTime() > cutoff));
  try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* private mode: the card falls back to the server status */ }
}
