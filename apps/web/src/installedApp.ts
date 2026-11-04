// Whether the page runs as an installed app (opened from the home screen or the app list) rather than in a browser tab.

/**
 * The display modes of an installed app: the manifest asks for standalone, and a browser without it falls back to
 * minimal-ui. Fullscreen is left out: a browser tab in F11 fullscreen matches it too, and the manifest never asks for it.
 */
const appModes = ['standalone', 'minimal-ui'];

/** What the check reads of `window`. */
export interface AppWindow { matchMedia?: Window['matchMedia']; navigator?: unknown }

/** True in an installed app: one of its display modes, or an iOS home screen app (navigator.standalone). */
export function runsAsInstalledApp(win: AppWindow | undefined = typeof window === 'undefined' ? undefined : window): boolean {
  if (!win) return false;
  if ((win.navigator as { standalone?: boolean } | undefined)?.standalone === true) return true;
  const { matchMedia } = win;
  return typeof matchMedia === 'function' && appModes.some(mode => matchMedia.call(win, `(display-mode: ${mode})`).matches);
}
