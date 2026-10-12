import { useSyncExternalStore, useEffect, useState } from 'react';
import { live } from './live';

/**
 * Subscribe to a store slice. `selector` must return a value that changes
 * identity/value only when that slice changes (revision counters, objects).
 */
export function useStore<T>(selector: () => T): T {
  return useSyncExternalStore(live.subscribe, selector, selector);
}

/** Re-render every N ms (for ages/durations). */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export type Viewport = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'tiny';

export function viewportOf(w: number): Viewport {
  if (w < 480) return 'tiny';
  if (w < 768) return 'xs';
  if (w < 1024) return 'sm';
  if (w < 1280) return 'md';
  if (w < 1536) return 'lg';
  return 'xl';
}

export function useViewport(): Viewport {
  const read = () => viewportOf(window.innerWidth);
  const [vp, setVp] = useState<Viewport>(read);
  useEffect(() => {
    const onResize = () => setVp(read());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return vp;
}
