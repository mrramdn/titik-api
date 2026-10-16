// The phone's compass heading (0 = the top of the screen points north), when the browser exposes one:
// Chrome on Android fires deviceorientationabsolute, Safari on iPhone gives webkitCompassHeading after a tap.
// Desktop browsers give nothing, and the arrow stays north-up.
import { useCallback, useEffect, useRef, useState } from 'react';
import { normalize } from '../../geo';

type OrientationEvent = DeviceOrientationEvent & { webkitCompassHeading?: number };
type OrientationStatic = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };

const screenAngle = () => (typeof screen !== 'undefined' && screen.orientation ? screen.orientation.angle : 0);

export function useHeading() {
  const [heading, setHeading] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [askable, setAskable] = useState(false);
  const latest = useRef<number | null>(null);
  const frame = useRef(0);

  // Safari on iPhone sends nothing until a tap grants access; offer that tap on touch screens when no heading comes.
  useEffect(() => {
    if (heading !== null || typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return;
    if (typeof (DeviceOrientationEvent as OrientationStatic).requestPermission !== 'function' || !matchMedia('(pointer: coarse)').matches) return;
    const timer = setTimeout(() => setAskable(true), 1500);
    return () => clearTimeout(timer);
  }, [heading, attempt]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return;
    // Sensors fire about 60 times a second; the screen follows at most once a frame and only for a visible change.
    const push = (value: number) => {
      latest.current = value;
      if (frame.current) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        const next = latest.current;
        setHeading(previous => (next === null || (previous !== null && Math.abs(((next - previous + 540) % 360) - 180) < 2) ? previous : next));
      });
    };
    const absolute = (event: Event) => {
      const e = event as OrientationEvent;
      if (e.alpha !== null && e.alpha !== undefined) push(normalize(360 - e.alpha + screenAngle()));
    };
    const relative = (event: Event) => {
      const e = event as OrientationEvent;
      if (typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) push(normalize(e.webkitCompassHeading + screenAngle()));
      else if (e.absolute && e.alpha !== null) push(normalize(360 - e.alpha + screenAngle()));
    };
    const hasAbsolute = 'ondeviceorientationabsolute' in window;
    if (hasAbsolute) window.addEventListener('deviceorientationabsolute', absolute);
    else window.addEventListener('deviceorientation', relative);
    return () => {
      if (hasAbsolute) window.removeEventListener('deviceorientationabsolute', absolute);
      else window.removeEventListener('deviceorientation', relative);
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [attempt]);

  /** Asks for the compass (must run from a tap), then listens again. */
  const request = useCallback(async () => {
    const ask = (DeviceOrientationEvent as OrientationStatic).requestPermission;
    setAskable(false);
    if (!ask) return;
    try { await ask(); } catch { /* refused: the arrow stays north-up */ }
    setAttempt(value => value + 1);
  }, []);

  return { heading, needsTap: askable && heading === null, request };
}

/** Keeps a rotation continuous (359° to 1° turns 2°, not 358°), so the CSS transition never spins the long way. */
export function useTurn(angle: number) {
  const shown = useRef(angle);
  const delta = ((angle - shown.current) % 360 + 540) % 360 - 180;
  shown.current += delta;
  return shown.current;
}
