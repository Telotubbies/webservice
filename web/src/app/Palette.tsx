// Palette — the command/search modal. Ctrl/Cmd+K or the topbar search pill
// opens it. Pages, actions (ack, theme) and equipment come from
// paletteCommands (pure, tested); live tags are jump targets. Grouped and
// keyboard-driven; a command the user may not run shows but cannot fire.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { NAV } from './nav';
import { live } from '../lib/live';
import { DdIcon } from '../shared/ui/DdIcon';
import type { DdIconName } from '../shared/ui/ddicons';
import type { ProcessName } from '../shared/ui/Icon';
import { useOperateAnyOrg } from '../features/admin/admin';
import { useRole } from './session';
import { useAlarms } from '../features/alarms/alarms';
import { ackMany } from '../features/alarms/ackAlarm';
import { useEquipment } from '../lib/equipment';
import { applyTheme, writeThemePref } from '../theme/theme';
import { toast } from '../ui/Toaster';
import { paletteCommands } from './paletteCommands';

interface Entry { key: string; label: string; item: string; icon: DdIconName | ProcessName; group: string; hint?: string; run: () => void; enabled: boolean }

const MAX = 40; // Cap on rendered results.

export function Palette() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const showAdmin = useOperateAnyOrg();
  const role = useRole();
  const { open: openAlarms, active } = useAlarms();
  const { items: equipment, select } = useEquipment();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global Ctrl/Cmd+K toggles the modal; Esc closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Reset the query and highlight each time the modal opens.
  useEffect(() => { if (open) { setQ(''); setIdx(0); inputRef.current?.focus(); } }, [open]);

  const entries = useMemo<Entry[]>(() => {
    const GROUP = { navigate: t('palette.pages'), action: t('palette.actions'), equipment: t('palette.equipment') };
    const cmds: Entry[] = paletteCommands({
      nav: NAV, role, showAdmin, alarms: openAlarms, equipment,
      navigate, selectEquipment: select,
      ackVisible: () => {
        void ackMany(active).then((r) => toast({ tone: r.failed ? 'warn' : 'ok', text: `${t('palette.ackVisible')}: ${r.ok}${r.failed ? ` / ✕ ${r.failed}` : ''}` }));
      },
      setTheme: (p) => { writeThemePref(p); applyTheme(p); },
      t,
    }).map((c) => ({
      key: c.id, label: c.label, icon: c.icon, group: GROUP[c.group], hint: c.hint, run: c.run, enabled: c.enabled,
      item: c.id.startsWith('nav:') ? c.id.slice(4) : c.id,
    }));
    const tags: Entry[] = live.tags.map((ti) => {
      const to = `/setup/tags?q=${encodeURIComponent(ti.name)}`;
      return { key: `tag:${ti.name}`, label: ti.name, item: to, icon: 'metric' as DdIconName, group: t('palette.signals'), run: () => navigate(to), enabled: true };
    });
    const needle = q.toLowerCase();
    return [...cmds, ...tags].filter((e) => !q || e.label.toLowerCase().includes(needle) || (e.hint ?? '').toLowerCase().includes(needle));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, showAdmin, role, openAlarms, active, equipment]);

  const go = (e: Entry) => { if (!e.enabled) return; setOpen(false); e.run(); };

  // Keep the highlighted row visible while arrowing through a long list.
  useEffect(() => {
    if (open) document.getElementById(`palette-opt-${idx}`)?.scrollIntoView({ block: 'nearest' });
  }, [idx, open]);

  if (!open) return null;
  const optId = (i: number) => `palette-opt-${i}`;
  return (
    <div className="fixed inset-0 z-[100] bg-ink/30" onClick={() => setOpen(false)}>
      <div
        className="palette-panel mx-auto mt-[12vh] w-[560px] max-w-[92vw] overflow-hidden rounded-md border border-line bg-paper shadow-flyout"
        onClick={(e) => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label={t('palette.title')}
      >
        <div className="flex h-11 items-center gap-2 border-b border-line px-3">
          <DdIcon name="search" size={15} className="text-ink-46" />
          {/* combobox + listbox roles let screen readers announce the
              highlighted result while focus stays in the input. */}
          <input
            ref={inputRef}
            className="palette-input min-w-0 flex-1 text-[14px] outline-none placeholder:text-ink-35"
            placeholder={t('palette.placeholder')}
            aria-label={t('palette.title')}
            role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list"
            aria-activedescendant={entries[idx] ? optId(idx) : undefined}
            value={q}
            onChange={(e) => { setQ(e.target.value); setIdx(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, Math.min(entries.length, MAX) - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
              if (e.key === 'Enter' && entries[idx]) go(entries[idx]);
            }}
          />
          <kbd className="rounded border border-line px-1 text-[10px] text-ink-46">esc</kbd>
        </div>
        {entries.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-ink-46" role="status">{t('palette.noMatch', { q })}</p>
        ) : (
          <ul id="palette-list" role="listbox" aria-label={t('palette.title')} className="max-h-[50vh] overflow-y-auto py-1">
            {entries.slice(0, MAX).map((e, i) => (
              <li
                key={e.key}
                id={optId(i)}
                role="option"
                aria-selected={i === idx}
                aria-disabled={!e.enabled || undefined}
                data-item={e.item}
                className={`palette-option flex items-center gap-2.5 px-3 py-2 text-[13px] ${!e.enabled ? 'cursor-not-allowed text-ink-35' : i === idx ? 'cursor-pointer bg-info-soft text-blue' : 'cursor-pointer text-ink hover:bg-subtle'}`}
                onMouseEnter={() => setIdx(i)}
                onClick={() => go(e)}
              >
                <DdIcon name={e.icon} size={14} className="shrink-0 opacity-70" />
                <span className="min-w-0 flex-1 truncate">{e.label}</span>
                <span className="shrink-0 text-[11px] text-ink-46">{e.enabled ? (e.hint && e.group === t('palette.pages') ? e.hint : e.group) : t('palette.unavailable')}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="hidden border-t border-line px-3 py-1.5 text-[11px] text-ink-46 md:block">{t('palette.footer')}</div>
      </div>
    </div>
  );
}
