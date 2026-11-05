// The Home page's icon set, by name, over lucide-react (already in the app).

import {
  ArrowRight, ChartColumn, ChartLine, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Copy, Eye, EyeOff,
  GripVertical, Maximize2, Minimize2, Moon, Pause, Pencil, Play, Plus, SlidersHorizontal, Sun, Table2, Trash2,
  X, ZoomOut, ChartArea, MoveHorizontal, ChevronsRightLeft, type LucideIcon,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  table: Table2, maximize: Maximize2, minimize: Minimize2, pencil: Pencil, grip: GripVertical,
  left: ChevronLeft, right: ChevronRight, narrower: ChevronsRightLeft, wider: MoveHorizontal,
  copy: Copy, trash: Trash2, plus: Plus, x: X, back: ChevronsLeft, fwd: ChevronsRight, pause: Pause, play: Play,
  zoomOut: ZoomOut, sliders: SlidersHorizontal, moon: Moon, sun: Sun, arrow: ArrowRight, eye: Eye, eyeOff: EyeOff,
  line: ChartLine, area: ChartArea, bars: ChartColumn,
};

export function Ico({ name, size = 16 }: { name: keyof typeof ICONS; size?: number }) {
  const C = ICONS[name];
  return <C size={size} aria-hidden strokeWidth={2} />;
}
