// "Start here" — the new-user entry that is reachable from every page (rail
// footer), not only the Overview checklist. It shows setup progress at a
// glance and opens a panel with three first pages for the user's job,
// preselected from the signed-in role. Opens by itself once per browser,
// never on the wall display, and never steals focus when it does.
//
// The panel is portalled to <body>: the rail is .chrome (dark focus rings)
// and hidden below md, while the panel is a light surface that the user menu
// can open on phones too.

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { onboardingApi } from '../../lib/api';
import { useAdminOrg } from '../admin/admin';
import { useRole } from '../../app/session';
import { DdIcon } from '../../shared/ui/DdIcon';
import { Segmented } from '../../shared/ui/Segmented';
import { progress } from './steps';
import {
  HIDDEN_KEY, OPEN_EVENT, SEEN_KEY, START_PATHS, autoOpenAllowed, pathFor, readFlag, writeFlag,
  type StartPath,
} from './start';
import './startI18n';

export function StartHere() {
  const { t } = useTranslation();
  const role = useRole();
  const { pathname } = useLocation();
  const { orgId } = useAdminOrg();
  const titleId = useId();
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState(() => readFlag(HIDDEN_KEY));
  // First visit: open once, quietly (`explicit` false → focus stays put).
  const [open, setOpen] = useState(() => !readFlag(SEEN_KEY) && autoOpenAllowed(pathname));
  const [explicit, setExplicit] = useState(false);
  const [picked, setPicked] = useState<StartPath | null>(null);
  const path = picked ?? pathFor(role);

  // Shares the checklist's cache entry; the Overview card owns the polling.
  const q = useQuery({
    queryKey: ['onboarding', orgId],
    queryFn: () => onboardingApi.get(orgId!),
    enabled: orgId != null,
    staleTime: 60_000,
  });
  const prog = q.data?.steps.length ? progress(q.data.steps) : null;

  useEffect(() => { if (open) writeFlag(SEEN_KEY, true); }, [open]);
  useEffect(() => { if (open && explicit) panelRef.current?.focus(); }, [open, explicit]);

  const close = useCallback(() => {
    const hadFocus = panelRef.current?.contains(document.activeElement);
    setOpen(false);
    if (hadFocus) btnRef.current?.focus();
  }, []);

  // The user menu (and anything else) reopens it — also un-hides the button.
  useEffect(() => {
    const h = () => { setHidden(false); writeFlag(HIDDEN_KEY, false); setExplicit(true); setOpen(true); };
    window.addEventListener(OPEN_EVENT, h);
    return () => window.removeEventListener(OPEN_EVENT, h);
  }, []);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, close]);

  const hide = () => { writeFlag(HIDDEN_KEY, true); setHidden(true); setOpen(false); };

  const panel = (
    <>
      <button className="fixed inset-0 z-40 cursor-default" onClick={close} aria-hidden tabIndex={-1} />
      <div
        ref={panelRef} role="dialog" aria-labelledby={titleId} tabIndex={-1}
        /* phones: a sheet above the bottom bar; desktop: beside the rail */
        className="flyout-in fixed inset-x-2 bottom-[calc(3.5rem+env(safe-area-inset-bottom)+8px)] z-50 max-h-[80svh] overflow-y-auto rounded-panel border border-line bg-paper p-4 text-ink shadow-flyout outline-none md:inset-x-auto md:bottom-14 md:left-[calc(var(--rail-w)+8px)] md:w-[380px]"
      >
        <div className="flex items-start gap-2">
          <h2 id={titleId} className="flex-1 text-[15px] font-semibold">{t('start.title')}</h2>
          <button type="button" className="grid h-8 w-8 place-items-center rounded text-ink-68 hover:bg-subtle" aria-label={t('common.close')} onClick={close}>
            <DdIcon name="cancel" size={14} aria-hidden />
          </button>
        </div>
        <p className="mb-3 text-[13px] leading-5 text-ink-68">{t('start.lede')}</p>
        <Segmented<StartPath>
          label={t('start.pathLabel')} value={path} onChange={setPicked}
          options={(['operator', 'engineer', 'admin'] as const).map((v) => ({ value: v, label: t(`start.path.${v}`) }))}
        />
        <ol className="mt-3 divide-y divide-line rounded border border-line">
          {START_PATHS[path].map((s, i) => (
            <li key={s.to}>
              <Link to={s.to} onClick={() => setOpen(false)} className="group flex min-h-12 items-center gap-3 px-3 py-2 hover:bg-subtle focus-visible:bg-subtle">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-subtle font-mono text-[11px] font-semibold text-ink-68" aria-hidden>{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                    <DdIcon name={s.icon} size={13} aria-hidden className="text-ink-68" />{t(`start.step.${s.key}`)}
                  </span>
                  <span className="block text-[12px] leading-4 text-ink-68">{t(`start.step.${s.key}Body`)}</span>
                </span>
                <DdIcon name="arrow-right" size={13} aria-hidden className="text-ink-46 group-hover:text-blue" />
              </Link>
            </li>
          ))}
        </ol>
        {prog && (
          <Link to="/overview" onClick={() => setOpen(false)} className="mt-3 flex items-center gap-3 rounded border border-line px-3 py-2 text-[12px] hover:bg-subtle">
            <span className="font-semibold">{t('start.checklist')}</span>
            <span className="h-1 flex-1 overflow-hidden rounded bg-subtle" aria-hidden>
              <span className="block h-full bg-blue" style={{ width: `${(prog.done / prog.total) * 100}%` }} />
            </span>
            <span className="font-mono text-ink-68">{t('start.checklistProgress', prog)}</span>
          </Link>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px]">
          <Link to="/guide" onClick={() => setOpen(false)} className="text-blue hover:underline">{t('start.guide')}</Link>
          <button type="button" className="text-blue hover:underline"
            onClick={() => { close(); window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' })); }}>
            {t('start.shortcuts')} <kbd className="ml-0.5 rounded border border-line px-1 font-mono text-[10px]">?</kbd>
          </button>
          {!hidden && <button type="button" className="ml-auto text-ink-68 hover:underline" title={t('start.hidden')} onClick={hide}>{t('start.hide')}</button>}
        </div>
      </div>
    </>
  );

  const done = prog != null && prog.done >= prog.total;
  return (
    <>
      {!hidden && (
        <button
          ref={btnRef} type="button" data-rail-btn
          className="mx-1 mb-1 flex items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-white/80 hover:bg-white/5 hover:text-white"
          aria-expanded={open} aria-haspopup="dialog"
          onClick={() => { setExplicit(true); setOpen((o) => !o); }}
        >
          <DdIcon name={done ? 'check-circled' : 'signpost'} size={15} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="rail-label rail-text block font-semibold">{t('start.button')}</span>
            {/* a button's children are presentational, so progress is
                spoken through the sr-only text below, not a progressbar role */}
            {prog && <span className="sr-only">, {t('start.progressAria', prog)}</span>}
            {prog && !done && (
              <span className="rail-hide mt-1 block h-1 overflow-hidden rounded bg-white/10" aria-hidden>
                <span className="block h-full bg-[var(--color-blue-nav)]" style={{ width: `${(prog.done / prog.total) * 100}%` }} />
              </span>
            )}
          </span>
          {prog && <span className="rail-hide font-mono text-[11px] text-white/65" aria-hidden>{prog.done}/{prog.total}</span>}
        </button>
      )}
      {open && createPortal(panel, document.body)}
    </>
  );
}
