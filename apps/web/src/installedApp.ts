// Whether the page runs as an installed app (opened from the home screen or the app list) rather than in a browser tab.

/** The display modes of an installed app. The manifest asks for standalone; a browser or the user may give another. */
const appModes = ['standalone', 'fullscreen', 'minimal-ui'];

/** What the check reads of `window`. */
export interface AppWindow { matchMedia?: Window['matchMedia']; navigator?: unknown }

/** True in an installed app: one of its display modes, or an iOS home screen app (navigator.standalone). */
export function runsAsInstalledApp(win: AppWindow | undefined = typeof window === 'undefined' ? undefined : window): boolean {
  if (!win) return false;
  if ((win.navigator as { standalone?: boolean } | undefined)?.standalone === true) return true;
  const { matchMedia } = win;
  return typeof matchMedia === 'function' && appModes.some(mode => matchMedia.call(win, `(display-mode: ${mode})`).matches);
}
