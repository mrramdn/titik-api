// Where the screens live. The landing page is at /, the map screen (the map with the incident list) at /peta. An
// incident still opens in the map screen's sidebar at /kejadian/:id and /k/:code, the paths shared links and
// notifications use. Links meant for the map use these helpers, so none points at the landing page by mistake.

export const HOME_PATH = '/';
export const MAP_PATH = '/peta';

/** The map screen, on an archive day (YYYY-MM-DD) when one is given. */
export const mapPath = (tanggal = '') => (tanggal ? `${MAP_PATH}?tanggal=${tanggal}` : MAP_PATH);

/** True while the map screen is open: its list, or an incident in its sidebar (the field check is a page of its own). */
export const isMapPath = (pathname: string) =>
  pathname === MAP_PATH || pathname.startsWith('/k/') || (pathname.startsWith('/kejadian/') && !pathname.endsWith('/cek'));

/** Whether the navigation link to `to` is the current page; the map tab stays on while an incident is open in its sidebar. */
export const navActive = (to: string, pathname: string) => (to === MAP_PATH ? isMapPath(pathname) : pathname === to || pathname.startsWith(`${to}/`));

/** Query parameters only the map screen reads. */
export const MAP_QUERY = ['tanggal'];
/** Navigation state only the map screen reads: the dashboard's fire danger link (riskDay) and the sign-out flag. */
export const MAP_STATE = ['riskDay', 'signOut'];

/**
 * Where a link made while the map lived at / goes now: /peta with the same query, or null when / means the landing
 * page. /?tanggal=2026-10-23 opens /peta?tanggal=2026-10-23; navigation state meant for the map goes along with it.
 */
export function legacyMapTarget(search: string, state?: unknown): string | null {
  const params = new URLSearchParams(search);
  const forMap = MAP_QUERY.some(key => params.has(key))
    || (typeof state === 'object' && state !== null && MAP_STATE.some(key => key in state));
  return forMap ? `${MAP_PATH}${search}` : null;
}

export type DemoRole = 'mpa' | 'kades' | 'bpbd';
/** Each demo role's own page: volunteers on their tasks, village heads on their village, agencies on the dashboard. */
export const demoHome: Record<DemoRole, string> = { mpa: '/tugas', kades: '/desa-saya', bpbd: '/dasbor' };
/** "Coba sebagai …": the role's own page with ?lihat=, which opens that shared demo account (see demoLink.ts). */
export const tryPath = (role: DemoRole) => `${demoHome[role]}?lihat=${role}`;
