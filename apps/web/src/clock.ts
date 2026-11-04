// Labels that depend on the clock ("Angin sekarang", "Hari ini", "Besok", "Dihitung 8 jam lalu") are worked out as a
// component renders, and nothing else renders a panel again while there is no signal: the status poll that renders the
// app every few minutes fails then. useClock renders such a component again when one of its labels is due to change.
import { useEffect, useState } from 'react';

const DAY = 86_400_000;
/** WIB is UTC+7 all year. */
const WIB_OFFSET = 7 * 3_600_000;
/** setTimeout's longest delay; a longer one would fire at once. */
const LONGEST_DELAY = 2 ** 31 - 1;

/** The first moment (ms) of the WIB day after the one `now` is in: when "Hari ini" and "Besok" move on. */
export const nextWibMidnight = (now: number) => Math.floor((now + WIB_OFFSET) / DAY) * DAY + DAY - WIB_OFFSET;

/** The earliest of some moments (ms), leaving out null; null when none is given. */
export function earliest(...moments: (number | null)[]): number | null {
  const known = moments.filter((moment): moment is number => moment !== null);
  return known.length ? Math.min(...known) : null;
}

/**
 * The time now (ms), for a component whose labels depend on it, rendered again at `changesAt(now)`: the next moment
 * one of its labels turns over, or null when none will. One timeout at a time, no ticking in between. It also renders
 * again when the page comes back into view, as a phone that slept can hold a timer back for as long as it slept.
 */
export function useClock(changesAt: (now: number) => number | null): number {
  const [tick, setTick] = useState(0);
  const now = Date.now();
  const at = changesAt(now);
  useEffect(() => {
    // A moment already past is on screen: this render worked its labels out from `now`.
    if (at === null || at <= now) return;
    const timer = setTimeout(() => setTick(value => value + 1), Math.min(Math.max(0, at - Date.now()), LONGEST_DELAY));
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, tick]);
  useEffect(() => {
    const visible = () => { if (document.visibilityState === 'visible') setTick(value => value + 1); };
    document.addEventListener('visibilitychange', visible);
    return () => document.removeEventListener('visibilitychange', visible);
  }, []);
  return now;
}
