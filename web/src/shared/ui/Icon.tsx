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
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6',
  sparkle: 'M12 3l1.9 5.3L19.2 10l-5.3 1.7L12 17l-1.9-5.3L4.8 10l5.3-1.7L12 3zM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z',
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
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"
      role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
