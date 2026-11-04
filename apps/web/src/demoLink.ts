// ?lihat=mpa|kades|bpbd on any page opens that shared demo account, the same sign-in as "Lihat sebagai", so a link
// can show a role's own page: "Coba sebagai BPBD" on the landing page is /dasbor?lihat=bpbd. It never replaces a real
// account. The parameter leaves the address once it has been read (components/shell/DemoLink.tsx).
import type { User } from './api';
import type { DemoRole } from './routes';

export const DEMO_PARAM = 'lihat';
const demoRoles: readonly string[] = ['mpa', 'kades', 'bpbd'];

/** The ?lihat= value in a query string, or null without one. */
export const demoParam = (search: string) => new URLSearchParams(search).get(DEMO_PARAM);

/**
 * The demo account to sign in to for ?lihat=`value`, or null to leave the session as it is: for an unknown value, while
 * a real account is signed in (it is never switched), when that demo account is signed in already, and when the server
 * has not said who is signed in (`checked` false: the session check failed). A demo sign-in sets a new session cookie,
 * so without that answer it could replace a real account's session that the browser still holds. Nobody signed in, or
 * another demo account, opens the one asked for.
 */
export function demoLinkRole(value: string | null, user: Pick<User, 'role' | 'demo'> | null, checked: boolean): DemoRole | null {
  if (value === null || !demoRoles.includes(value)) return null;
  if (!checked) return null;
  if (user && !user.demo) return null;
  if (user && user.role === value) return null;
  return value as DemoRole;
}

/** The query string without ?lihat=, other parameters in their place. */
export function withoutDemoParam(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(DEMO_PARAM);
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** A history entry, as the router's location gives it. */
export interface DemoLinkEntry { key: string; pathname: string; search: string; hash: string; state: unknown }
export interface DemoLinkDeps {
  signInDemo(role: DemoRole): Promise<unknown>;
  /** Puts `search` in place of the entry's query string, in the same history entry. */
  replace(entry: DemoLinkEntry, search: string): void;
  /** The key of the history entry on screen now. */
  currentKey(): string;
}

/**
 * Reads ?lihat= once per history entry (React's strict mode runs effects twice in development): signs in to the demo
 * account demoLinkRole allows, then takes the parameter out of the address. The returned promise settles when that is
 * done; null when there was nothing to do. A failed sign-in leaves the page as a visitor sees it; that page offers its
 * own way in. When the visitor has moved on while the sign-in was under way (a link in the top bar, Back), the address
 * is theirs and stays as it is; coming back to that entry reads it again.
 */
export function demoLinkHandler({ signInDemo, replace, currentKey }: DemoLinkDeps) {
  let handled: string | null = null;
  return (entry: DemoLinkEntry, user: Pick<User, 'role' | 'demo'> | null, checked: boolean): Promise<void> | null => {
    const value = demoParam(entry.search);
    if (value === null || handled === entry.key) return null;
    handled = entry.key;
    const done = () => {
      if (currentKey() !== entry.key) {
        if (handled === entry.key) handled = null;
        return;
      }
      replace(entry, withoutDemoParam(entry.search));
    };
    const role = demoLinkRole(value, user, checked);
    if (!role) { done(); return Promise.resolve(); }
    return signInDemo(role).then(done, done);
  };
}
