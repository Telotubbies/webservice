// Motion tokens (spec §6.6) for the `motion` library — seconds, mirroring the
// --dur-* / --ease-* CSS vars in tokens.css. Every animation maps to a real
// state change and has a reduced-motion path; nothing animates for decoration.

export const DUR = { instant: 0.08, fast: 0.14, base: 0.22, slow: 0.36, process: 0.6 } as const;
export const EASE = {
  standard: [0.2, 0, 0, 1],
  enter: [0, 0, 0, 1],
  exit: [0.3, 0, 1, 1],
} as const;
export const SPRING = {
  snappy: { type: 'spring', stiffness: 520, damping: 38 },
  gentle: { type: 'spring', stiffness: 260, damping: 30 },
} as const;

/** Exits run at 0.7× the enter duration — leaving should never hold you up. */
export const exitOf = (d: number) => d * 0.7;

/** M1 deadband: a value flashes only when it moved more than `frac` of the
 *  signal's span, so sensor noise never blinks at the operator. */
export function beyondDeadband(prev: number | null, next: number, span: number, frac = 0.005): boolean {
  if (prev == null) return true;
  if (!(span > 0)) return prev !== next;
  return Math.abs(next - prev) > span * frac;
}

/** Per-user "Calm motion": stops decorative loops but never the ones that
 *  carry data (process flow M4, unacknowledged-alarm blink M2). */
export type MotionPref = 'full' | 'calm';
const KEY = 'wds.motion';

export function readMotionPref(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): MotionPref {
  try { return storage?.getItem(KEY) === 'calm' ? 'calm' : 'full'; } catch { return 'full'; }
}
export function writeMotionPref(p: MotionPref, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try { storage?.setItem(KEY, p); } catch { /* session-only */ }
}

/** Fire to change the preference from anywhere (user menu, palette);
 *  MotionRoot listens. */
export const MOTION_EVENT = 'wds:motion';
export function setMotionPref(p: MotionPref): void {
  writeMotionPref(p);
  window.dispatchEvent(new CustomEvent<MotionPref>(MOTION_EVENT, { detail: p }));
}
