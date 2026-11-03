// What this browser keeps for the account that is signed in: the API reads the service worker holds for use without a
// signal (cache "api", see sw.ts) and the field checks filed from this phone (see myChecks). The same address answers
// differently for another account (a demo session also sees demo field checks and tasks, a team sees notes), so both
// go as soon as another account, or none, takes over: nobody reads another account's copies without a signal, and a
// task card never says "Sudah kamu cek" for a check someone else filed.
import { forgetMyChecks } from './components/volunteer/myChecks';

/** The service worker's cache of API reads; sw.ts names it the same. */
export const apiCacheName = 'api';

export async function forgetAccountData() {
  forgetMyChecks();
  if (typeof caches !== 'undefined') await caches.delete(apiCacheName).catch(() => false);
}

/**
 * Follows the account whose data this browser holds (null for a visitor). The function it returns takes the next
 * account: when that is another one it forgets the data first, and only then applies the account, so nothing is read
 * for the new account while the old copies are still there.
 */
export function accountSettler<U extends { id: string }>(initial: U | null, apply: (next: U | null) => void, forget: () => Promise<void> = forgetAccountData) {
  let holder = initial?.id ?? null;
  return async (next: U | null) => {
    const id = next?.id ?? null;
    if (id !== holder) { holder = id; await forget(); }
    apply(next);
  };
}
