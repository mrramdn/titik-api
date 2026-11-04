// What this browser keeps for the account that is signed in: the API reads the service worker holds for use without a
// signal (cache "api", see sw.ts) and the field checks filed from this phone (see myChecks). The same address answers
// differently for another account (a demo session also sees demo field checks and tasks, a team sees notes), so both
// go as soon as another account, or none, takes over: nobody reads another account's copies without a signal, and a
// task card never says "Sudah kamu cek" for a check someone else filed. Field reports still waiting for a signal stay:
// each goes out only while the account that filed it is signed in (see outbox.ts), so none is lost to a switch.
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
 *
 * `followed`: another tab of this browser took the account. That tab forgot the data before it stored the account, and
 * the data lives in stores every tab shares, so it is not forgotten again: by the time this tab hears of it (a tab in
 * the background can hear minutes later), the new account may have filled them, with the details a volunteer needs
 * without a signal. `apply` is told, so the account is not stored again either.
 */
export function accountSettler<U extends { id: string }>(initial: U | null, apply: (next: U | null, followed: boolean) => void, forget: () => Promise<void> = forgetAccountData) {
  let holder = initial?.id ?? null;
  return async (next: U | null, followed = false) => {
    const id = next?.id ?? null;
    if (id !== holder) { holder = id; if (!followed) await forget(); }
    apply(next, followed);
  };
}
