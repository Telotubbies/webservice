// CommandPalette — ⌘K/Ctrl+K mission-surface jump (spec §3.3, v4 T12).
// Wired to the app/palette.ts open signal; the Shell owns the keybinding.
// Groups: pages (nav jump), equipment (opens the tag faceplate), signals
// (opens the faceplate at that tag). Fuzzy = subsequence match with
// streak/word-boundary scoring. Keyboard-first a11y: combobox/listbox,
// arrow navigation, Enter selects, Esc closes, focus trap + focus return.

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { live } from '../../lib/live';
import { useStore } from '../../lib/hooks';
import { EQUIPMENT, SIGNALS } from '../../lib/plant';
import { canOperate, useRole } from '../../app/session';
import { NAV } from '../../app/nav';
import { palette } from '../../app/palette';
import { useFaceplate } from '../../features/faceplate/FaceplateContext';
import { Icon, type IconName } from './Icon';
import './command-palette.css';

type Group = 'nav' | 'equip' | 'tag';
interface Item {
  id: string;
  group: Group;
  label: string;
  hint?: string;      // secondary line — route path or raw tag name
  icon: IconName;
  run: () => void;
}

/** Subsequence fuzzy score — null when the needle doesn't match in order.
 *  Streaks and word-boundary hits score higher (Linear/Datadog feel). */
function fuzzy(needle: string, hay: string): number | null {
  const n = needle.trim().toLowerCase();
  if (!n) return 0;
  const h = hay.toLowerCase();
  let score = 0, hi = 0, streak = 0;
  for (const ch of n) {
    const j = h.indexOf(ch, hi);
    if (j < 0) return null;
    streak = j === hi ? streak + 1 : 0;
    score += 1 + streak * 2 + (j === 0 || h[j - 1] === ' ' || h[j - 1] === '.' ? 4 : 0) - j * 0.01;
    hi = j + 1;
  }
  return score;
}

function useItems(): Item[] {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const role = useRole();
  const { openFaceplate } = useFaceplate();
  useStore(() => live.tagRev); // tags may arrive after the palette mounts
  return useMemo(() => {
    const items: Item[] = [];
    for (const g of NAV) {
      if (g.gated && !canOperate(role)) continue;
      for (const i of g.items) {
        items.push({
          id: `nav:${i.to}`, group: 'nav', icon: i.icon,
          label: t(i.key), hint: i.to,
          run: () => navigate(i.to),
        });
      }
    }
    for (const e of EQUIPMENT) {
      const primary = e.signals[0];
      items.push({
        id: `eq-${e.id}`, group: 'equip', icon: 'plant',
        label: t(e.labelKey), hint: primary,
        run: () => openFaceplate(primary),
      });
    }
    for (const tag of live.tags) {
      const meta = SIGNALS[tag.name];
      items.push({
        id: `tag:${tag.name}`, group: 'tag', icon: 'trends',
        label: meta ? t(meta.labelKey) : tag.name, hint: tag.name,
        run: () => openFaceplate(tag.name),
      });
    }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, role, navigate, openFaceplate, live.tagRev]);
}

const GROUP_ORDER: Group[] = ['nav', 'equip', 'tag'];

export function CommandPalette() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const items = useItems();

  // scored then PARTITIONED by group (fixed group order) — interleaved
  // scores must never emit the same group header twice (T12 review)
  const { flat, sections } = useMemo(() => {
    const needle = query.trim();
    const scored = !needle
      ? items.filter((i) => i.group !== 'tag').map((i) => ({ i, s: 0 })) // tags flood an empty query
      : items
        .map((i) => ({
          i,
          s: Math.max(fuzzy(needle, i.label) ?? -1, fuzzy(needle, i.hint ?? '') ?? -1),
        }))
        .filter((r) => r.s >= 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 12);
    const byGroup = new Map<Group, Item[]>();
    for (const r of scored) {
      const arr = byGroup.get(r.i.group) ?? [];
      arr.push(r.i);
      byGroup.set(r.i.group, arr);
    }
    const secs = GROUP_ORDER.filter((g) => byGroup.has(g))
      .map((g) => ({ group: g, items: byGroup.get(g)! }));
    return { flat: secs.flatMap((s) => s.items), sections: secs };
  }, [query, items]);

  // clamp the active row when the result set shrinks
  useEffect(() => setActive((a) => Math.min(a, Math.max(0, flat.length - 1))), [flat.length]);

  // focus capture on open, return on unmount — replaces the T11 placeholder
  // focus handling in the Shell (a11y: trap lives on keydown below)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => prev?.focus();
  }, []);

  // keep the active option in view while arrowing (group headers offset the
  // children index, so look the row up by its active class instead)
  useEffect(() => {
    listRef.current?.querySelector('.palette-option.is-active')
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, flat]);

  const pick = (i: Item) => {
    palette.close();
    i.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (flat.length === 0) return;
      setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + flat.length) % flat.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const sel = flat[active];
      if (sel) pick(sel);
    } else if (e.key === 'Escape') {
      // the palette is the top layer — consume the key so the faceplate's
      // own window Esc handler doesn't also fire (single-Esc single-layer)
      e.preventDefault();
      e.stopPropagation();
      palette.close();
    } else if (e.key === 'Tab') {
      // focus trap: the only stops are the input and the option buttons —
      // wrap around in both directions
      const stops = panelRef.current?.querySelectorAll<HTMLElement>('input, button');
      if (!stops || stops.length === 0) return;
      e.preventDefault();
      const arr = Array.from(stops);
      const idx = arr.indexOf(document.activeElement as HTMLElement);
      const next = arr[(idx + (e.shiftKey ? -1 : 1) + arr.length) % arr.length];
      next?.focus();
    }
  };

  const groupKey = (g: Group) => (g === 'nav' ? 'palette.pages' : g === 'equip' ? 'palette.equipment' : 'palette.signals');
  let idx = -1; // running flat index across sections for active-state mapping

  return (
    <div className="palette-scrim" onClick={() => palette.close()}>
      <div
        className="palette-panel" role="dialog" aria-modal="true"
        aria-label={t('palette.title')} ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="palette-head">
          <Icon name="search" size={18} />
          <input
            ref={inputRef} type="text" className="palette-input"
            role="combobox" aria-expanded="true" aria-controls="palette-list"
            aria-autocomplete="list"
            aria-activedescendant={flat[active] ? `palette-opt-${flat[active].id}` : undefined}
            placeholder={t('palette.placeholder')} aria-label={t('palette.open')}
            value={query} onChange={(e) => { setQuery(e.target.value); setActive(0); }}
          />
          <kbd className="kbd" aria-hidden>esc</kbd>
        </div>
        <ul id="palette-list" className="palette-list" role="listbox" ref={listRef}>
          {flat.length === 0 && (
            <li className="palette-empty" role="option" aria-selected="false">
              {t('palette.noMatch', { q: query })}
            </li>
          )}
          {sections.map((sec) => (
            <Fragment key={sec.group}>
              <li className="palette-group" aria-hidden>{t(groupKey(sec.group))}</li>
              {sec.items.map((i) => {
                idx += 1;
                const row = idx;
                return (
                  <li key={i.id} style={{ display: 'contents' }}>
                    <button
                      type="button" id={`palette-opt-${i.id}`} role="option"
                      aria-selected={row === active}
                      className={`palette-option${row === active ? ' is-active' : ''}`}
                      data-item={i.id}
                      onMouseEnter={() => setActive(row)}
                      onClick={() => pick(i)}
                    >
                      <Icon name={i.icon} size={18} />
                      <span className="palette-label">{i.label}</span>
                      {i.hint && <span className="palette-hint">{i.hint}</span>}
                    </button>
                  </li>
                );
              })}
            </Fragment>
          ))}
        </ul>
        <div className="palette-foot">{t('palette.footer')}</div>
      </div>
    </div>
  );
}

/** `?` — keyboard-shortcuts help overlay (v4 T12). Lists every binding the
 *  shell owns; Esc/scrim closes. Rendered by the Shell next to the palette. */
export function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      // the overlay has no focusable children — keep Tab on the panel so
      // focus can't escape behind the modal (aria-modal contract)
      if (e.key === 'Tab') { e.preventDefault(); panelRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); prev?.focus(); };
  }, [onClose]);

  const ROWS: [string, string][] = [
    ['⌘K / Ctrl+K', t('shortcuts.palette')],
    ['?', t('shortcuts.help')],
    ['↑ ↓', t('shortcuts.nav')],
    ['Enter', t('shortcuts.select')],
    ['Esc', t('shortcuts.close')],
  ];

  return (
    <div className="palette-scrim" onClick={onClose}>
      <div
        className="palette-panel shortcuts-panel" role="dialog" aria-modal="true"
        aria-label={t('shortcuts.title')} tabIndex={-1} ref={panelRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="palette-head"><Icon name="info" size={18} /><h2>{t('shortcuts.title')}</h2></div>
        <ul className="shortcuts-list">
          {ROWS.map(([k, label]) => (
            <li key={k}><kbd className="kbd">{k}</kbd><span>{label}</span></li>
          ))}
        </ul>
      </div>
    </div>
  );
}
