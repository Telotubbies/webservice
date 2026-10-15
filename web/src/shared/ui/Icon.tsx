// Inline icon set (24px grid, 1.75 stroke). Decorative by default; pass
// `label` when the icon is the only content of a control.

import type { SVGProps } from 'react';

const PATHS = {
  overview: 'M4 5h7v6H4zM13 5h7v4h-7zM13 11h7v8h-7zM4 13h7v6H4z',
  line: 'M3 15h4l2-4h6l2 4h4M5 15v3M19 15v3M9 11V7h6v4M7 18h10',
  trends: 'M3 18l6-6 4 4 8-9M21 7v5M21 7h-5',
  alarm: 'M12 4a6 6 0 0 1 6 6c0 4.5 2 6 2 6H4s2-1.5 2-6a6 6 0 0 1 6-6zM10 19a2 2 0 0 0 4 0',
  tags: 'M4 6h16M4 12h16M4 18h10',
  commands: 'M5 6l5 6-5 6M12 18h7',
  health: 'M3 12h4l2-6 4 12 2-6h6',
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM16.5 16.5L21 21',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7',
  warn: 'M12 4l9 16H3l9-16zM12 10v4M12 17v.5',
  info: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 11v6M12 7.5v.5',
  play: 'M8 5l11 7-11 7z',
  stop: 'M6 6h12v12H6z',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v9H5z',
  user: 'M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM4 20c1.5-4 5-5 8-5s6.5 1 8 5',
  chevron: 'M9 6l6 6-6 6',
  globe: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  plant: 'M12 2.8 20.5 7.6v8.8L12 21.2 3.5 16.4V7.6L12 2.8zM12 12l8.5-4.4M12 12v9.2M12 12 3.5 7.6',
  line3d: 'M12 3l8 4.5v9l-8 4.5-8-4.5v-9l8-4.5zM4 7.5l8 4.5 8-4.5M12 12v9',
  shield: 'M12 3l7 3v5c0 4.6-3 8.2-7 10-4-1.8-7-5.4-7-10V6l7-3z',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6',
  sparkle: 'M12 3l1.9 5.3L19.2 10l-5.3 1.7L12 17l-1.9-5.3L4.8 10l5.3-1.7L12 3zM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z',
  waves: 'M3 9c1.5-2.4 3-2.4 4.5 0s3 2.4 4.5 0 3-2.4 4.5 0 3 2.4 4.5 0M3 15c1.5-2.4 3-2.4 4.5 0s3 2.4 4.5 0 3-2.4 4.5 0 3 2.4 4.5 0',
  /* ---- v6 additions: cross-page glyphs for the Datadog-pattern surfaces.
     Same 24px grid / 1.75 stroke / round caps; decorative by default. ---- */
  bell: 'M12 4a6 6 0 0 1 6 6c0 4.5 2 6 2 6H4s2-1.5 2-6a6 6 0 0 1 6-6zM10 19a2 2 0 0 0 4 0',
  x: 'M6 6l12 12M18 6L6 18',
  'check-circle': 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM8.5 12.3l2.4 2.4 4.6-4.9',
  'chevron-left': 'M15 6l-6 6 6 6',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-up': 'M6 15l6-6 6 6',
  'arrow-up': 'M12 19V5M5 12l7-7 7 7',
  'arrow-down': 'M12 5v14M5 12l7 7-7-7',
  'arrow-right': 'M5 12h14M13 6l6 6-6 6',
  'external-link': 'M14 4h6v6M20 4l-9.5 9.5M19 13.5V19H5V5h5.5',
  filter: 'M4 5h16l-6.2 7.6V19l-3.6-2v-4.4L4 5z',
  clock: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 7v5l3.5 2.2',
  calendar: 'M8 3v3.5M16 3v3.5M4 9.5h16M5.5 5h13A1.5 1.5 0 0 1 20 6.5V20a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 20V6.5A1.5 1.5 0 0 1 5.5 5z',
  gauge: 'M3.34 19a10 10 0 1 1 17.32 0M12 14l4-4',
  wrench: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z',
  pause: 'M9 5v14M15 5v14',
  dot: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  layers: 'M12 3l9 4.5-9 4.5-9-4.5L12 3zM3.5 12.3L12 16.7l8.5-4.4M3.5 16.3L12 20.7l8.5-4.4',
  tag: 'M4 4h7.2L20 12.8a2 2 0 0 1 0 2.8l-4.4 4.4a2 2 0 0 1-2.8 0L4 11.2V4zM7.8 7.8h.01',
  activity: 'M3 12h4l3-7 4 14 3-7h4',
  drawer: 'M3 5h18v14H3zM15 5v14',
  more: 'M5.5 12h.01M12 12h.01M18.5 12h.01',
  plus: 'M12 5v14M5 12h14',
  copy: 'M8 8h12v12H8zM4 16V4h12',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
} as const;

export type IconName = keyof typeof PATHS;

interface Props extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
  label?: string;
}

export function Icon({ name, size = 20, label, ...rest }: Props) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" focusable={false}
      strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"
      role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
