// ⌘K command list — pure, so who may do what is tested without a DOM.
// Groups: navigate (every rail item the user can see), actions (ack the
// alarms in view, theme), equipment (open it / trend its signals).

import type { NavGroup } from './nav';
import type { Alarm } from '../types';
import type { ThemePref } from '../theme/theme';
import type { DdIconName } from '../shared/ui/ddicons';
import type { ProcessName } from '../shared/ui/Icon';

export interface PaletteCommand {
  id: string;
  group: 'navigate' | 'action' | 'equipment';
  label: string;
  hint?: string;
  icon: DdIconName | ProcessName;
  run: () => void;
  enabled: boolean;
}

export interface PaletteCtx {
  nav: NavGroup[];
  role: string;
  showAdmin: boolean;
  alarms: Pick<Alarm, 'state'>[];
  equipment: { id: string; label: string; tags: string[] }[];
  navigate: (to: string) => void;
  selectEquipment: (id: string) => void;
  ackVisible: () => void;
  setTheme: (p: ThemePref) => void;
  t: (k: string) => string;
}

/* Mirrors session.canOperate — kept local so this module stays importable
   without the session store (which touches storage at load). */
const OPERATE = new Set(['operator', 'admin', 'owner']);

export function paletteCommands(c: PaletteCtx): PaletteCommand[] {
  const nav: PaletteCommand[] = c.nav
    .filter((g) => !g.gated || c.showAdmin)
    .flatMap((g) => g.items.map((i) => ({
      id: `nav:${i.to}`, group: 'navigate' as const, label: c.t(i.key), hint: c.t(g.group), icon: i.icon,
      run: () => c.navigate(i.to), enabled: true,
    })));

  const unacked = c.alarms.some((a) => a.state === 'active');
  const actions: PaletteCommand[] = [
    {
      id: 'ack-visible', group: 'action', label: c.t('palette.ackVisible'), icon: 'check',
      run: c.ackVisible, enabled: OPERATE.has(c.role) && unacked,
    },
    ...(['light', 'dark', 'system'] as const).map((p) => ({
      id: `theme:${p}`, group: 'action' as const, label: c.t(`palette.theme_${p}`),
      icon: (p === 'light' ? 'sun' : p === 'dark' ? 'moon' : 'theme-system') as DdIconName,
      run: () => c.setTheme(p), enabled: true,
    })),
  ];

  const equipment: PaletteCommand[] = c.equipment.flatMap((e) => [
    {
      id: `open:${e.label}`, group: 'equipment' as const, label: `${c.t('palette.open_eq')} ${e.label}`, icon: 'building-block' as DdIconName,
      run: () => { c.selectEquipment(e.id); c.navigate('/'); }, enabled: true,
    },
    {
      id: `trend:${e.label}`, group: 'equipment' as const, label: `${c.t('palette.trend_eq')} ${e.label}`, icon: 'graph-line' as DdIconName,
      run: () => c.navigate(`/trends?tags=${e.tags.map(encodeURIComponent).join(',')}`), enabled: e.tags.length > 0,
    },
  ]);

  return [...nav, ...actions, ...equipment];
}
