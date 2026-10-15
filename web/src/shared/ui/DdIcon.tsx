// DdIcon — renders a lucide glyph by semantic name (see ./ddicons).
// Decorative by default; pass `label` when the icon is the only content.

import type { SVGProps } from 'react';
import { DD_ICONS, type DdIconName } from './ddicons';

interface Props extends Omit<SVGProps<SVGSVGElement>, 'name' | 'ref'> {
  name: DdIconName;
  size?: number;
  label?: string;
}

export function DdIcon({ name, size = 16, label, ...rest }: Props) {
  const Glyph = DD_ICONS[name];
  if (!Glyph) return null;
  return (
    <Glyph
      size={size} strokeWidth={1.75} focusable={false}
      role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}
      {...rest}
    />
  );
}
