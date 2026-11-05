// Motion root — honours the OS reduced-motion setting, and the per-user
// "Calm motion" choice on top of it (motion.ts). Calm also lands on
// <html data-motion="calm"> so CSS keyframe loops can stop; loops that carry
// data (process flow, unacknowledged-alarm blink) are exempt in the CSS.

import { useEffect, useState, type ReactNode } from 'react';
import { MotionConfig } from 'motion/react';
import { MOTION_EVENT, readMotionPref, type MotionPref } from './motion';

export function MotionRoot({ children }: { children: ReactNode }) {
  const [pref, setPref] = useState<MotionPref>(() => readMotionPref());
  useEffect(() => {
    const h = (e: Event) => setPref((e as CustomEvent<MotionPref>).detail);
    window.addEventListener(MOTION_EVENT, h);
    return () => window.removeEventListener(MOTION_EVENT, h);
  }, []);
  useEffect(() => {
    if (pref === 'calm') document.documentElement.dataset.motion = 'calm';
    else delete document.documentElement.dataset.motion;
  }, [pref]);
  return <MotionConfig reducedMotion={pref === 'calm' ? 'always' : 'user'}>{children}</MotionConfig>;
}
