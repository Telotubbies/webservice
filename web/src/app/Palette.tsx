// Palette — dd-style command/search modal. Ctrl/Cmd+K or the topbar search
// pill opens it; nav items + live tag jump targets, grouped, keyboard-driven.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { NAV } from './nav';
import { live } from '../lib/live';
import { DdIcon } from '../shared/ui/DdIcon';
import type { DdIconName } from '../shared/ui/ddicons';
import { useOperateAnyOrg } from '../features/admin/admin';

interface Entry { label: string; to: string; icon: DdIconName; group: string }

const MAX = 40; // rendered results cap

export function Palette() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const showAdmin = useOperateAnyOrg();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => { if (open) { setQ(''); setIdx(0); inputRef.current?.focus(); } }, [open]);

  const entries = useMemo<Entry[]>(() => {
    const nav: Entry[] = NAV
      .filter((g) => !g.gated || showAdmin)
      .flatMap((g) => g.items.map((i) => ({ label: t(i.key), to: i.to, icon: i.icon, group: t(g.group) })));
    const tags: Entry[] = live.tags.map((ti) => ({
      label: ti.name, to: `/tags?q=${encodeURIComponent(ti.name)}`, icon: 'metric' as DdIconName, group: t('palette.signals'),
    }));
    return [...nav, ...tags].filter((e) => !q || e.label.toLowerCase().includes(q.toLowerCase()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, showAdmin]);

  const go = (e: Entry) => { setOpen(false); navigate(e.to); };

  // keep the highlighted row visible while arrowing through a long list
  useEffect(() => {
    if (open) document.getElementById(`palette-opt-${idx}`)?.scrollIntoView({ block: 'nearest' });
  }, [idx, open]);

  if (!open) return null;
  const optId = (i: number) => `palette-opt-${i}`;
  return (
    <div className="fixed inset-0 z-[100] bg-ink/30" onClick={() => setOpen(false)}>
      <div
        className="palette-panel mx-auto mt-[12vh] w-[560px] max-w-[92vw] overflow-hidden rounded-md border border-line bg-white shadow-flyout"
        onClick={(e) => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label={t('palette.title')}
      >
        <div className="flex h-11 items-center gap-2 border-b border-line px-3">
          <DdIcon name="search" size={15} className="text-ink-46" />
          {/* combobox + listbox: screen readers hear the highlighted result
              while focus stays in the input */}
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
                key={e.to + e.label}
                id={optId(i)}
                role="option"
                aria-selected={i === idx}
                data-item={e.to}
                className={`palette-option flex cursor-pointer items-center gap-2.5 px-3 py-2 text-[13px] ${i === idx ? 'bg-info-soft text-blue' : 'text-ink hover:bg-subtle'}`}
                onMouseEnter={() => setIdx(i)}
                onClick={() => go(e)}
              >
                <DdIcon name={e.icon} size={14} className="shrink-0 opacity-70" />
                <span className="min-w-0 flex-1 truncate">{e.label}</span>
                <span className="shrink-0 text-[11px] text-ink-46">{e.group}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="hidden border-t border-line px-3 py-1.5 text-[11px] text-ink-46 md:block">{t('palette.footer')}</div>
      </div>
    </div>
  );
}
