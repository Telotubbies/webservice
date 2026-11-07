// /dev/icons: every in-house process symbol with its name, plus the alarm
// priority shapes. Dev builds only (App.tsx gates the route). Gallery copy is
// not translated. Use the theme switch to check light and dark.

import { PROCESS_NAMES, ProcessIcon } from '../../shared/ui/Icon';
import { PriorityBadge } from '../../shared/ui/Status';
import { applyTheme, writeThemePref, type ThemePref } from '../../theme/theme';
import { useThemeName } from '../../theme/useTheme';

export function IconsPage() {
  const theme = useThemeName();
  const setTheme = (p: ThemePref) => { writeThemePref(p); applyTheme(p); };
  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-[18px] font-semibold">Process symbols ({PROCESS_NAMES.length})</h1>
        <div className="flex gap-2">
          {(['light', 'dark'] as const).map((m) => (
            <button key={m} className="btn btn-sm" aria-pressed={theme === m} onClick={() => setTheme(m)}>{m}</button>
          ))}
        </div>
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {PROCESS_NAMES.map((n) => (
          <li key={n} className="rounded-md border border-[var(--color-control-line)] bg-[var(--color-paper)] p-3 text-[var(--color-ink)]">
            <ProcessIcon name={n} label={n} size={32} className="text-[13px]" />
          </li>
        ))}
      </ul>
      <h2 className="mb-2 mt-8 text-[14px] font-semibold">Alarm priority, our proposal, not a standard</h2>
      <div className="flex flex-wrap gap-3">
        <PriorityBadge priority={1} label="Critical" />
        <PriorityBadge priority={2} label="High" />
        <PriorityBadge priority={3} label="Medium" />
        <PriorityBadge priority={4} label="Low" />
      </div>
    </div>
  );
}
