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
 * a real account is signed in (it is never switched), and when that demo account is signed in already. Nobody signed
 * in, or another demo account, opens the one asked for.
 */
export function demoLinkRole(value: string | null, user: Pick<User, 'role' | 'demo'> | null): DemoRole | null {
  if (value === null || !demoRoles.includes(value)) return null;
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
