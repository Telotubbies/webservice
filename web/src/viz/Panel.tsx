// Panel — Datadog/Grafana widget chrome (spec §7.3): header (title, unit,
// time badge, info, menu, full screen) over a body that shows the honest
// state from panelState(). A refetch keeps the previous render at 0.6
// opacity and crossfades (M10) — no skeleton flash on every poll. The body
// is a size container so content can lay itself out by the panel's width.

import { createContext, useContext, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { DUR } from '../theme/motion';
import { EmptyState, ErrorState, Skeleton } from '../shared/ui/Feedback';
import { Menu, Tooltip } from '../ui/Popover';
import { DdIcon } from '../shared/ui/DdIcon';
import type { PanelState } from './panelState';
import './i18n';

interface Ctx { state: PanelState; onRetry?: () => void; empty?: string; staleText?: string; root: React.RefObject<HTMLElement | null> }
const PanelCtx = createContext<Ctx | null>(null);
const usePanel = () => {
  const c = useContext(PanelCtx);
  if (!c) throw new Error('Panel parts must sit inside Panel.Root');
  return c;
};

function Root({ state, onRetry, empty, staleText, className = '', children, label }: {
  state: PanelState; onRetry?: () => void; empty?: string; staleText?: string; className?: string; children: ReactNode; label?: string;
}) {
  const root = useRef<HTMLElement | null>(null);
  return (
    <PanelCtx.Provider value={{ state, onRetry, empty, staleText, root }}>
      <section ref={root} aria-label={label} aria-busy={state === 'skeleton' || state === 'refetch' || undefined}
        className={`flex min-h-0 min-w-0 flex-col rounded-panel border border-line bg-panel shadow-ply1 ${className}`}>
        {children}
      </section>
    </PanelCtx.Provider>
  );
}

function Header({ title, unit, badge, info, menu, onFullscreen, actions }: {
  title: ReactNode; unit?: string; badge?: string; info?: string;
  menu?: { label: string; onSelect: () => void }[]; onFullscreen?: boolean | (() => void); actions?: ReactNode;
}) {
  const { t } = useTranslation();
  const { state, staleText, root } = usePanel();
  const full = () => {
    if (typeof onFullscreen === 'function') return onFullscreen();
    const el = root.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };
  const btn = 'grid h-6 w-6 place-items-center rounded-control text-ink-3 hover:bg-panel-2 hover:text-ink';
  return (
    <header className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
      <h3 className="min-w-0 truncate text-[13px] font-semibold text-ink">{title}</h3>
      {unit && <span className="shrink-0 text-[12px] text-ink-3">({unit})</span>}
      {badge && <span className="shrink-0 rounded-[4px] bg-panel-2 px-1.5 font-mono text-[11px] text-ink-2">{badge}</span>}
      {state === 'stale' && (
        <span className="flex shrink-0 items-center gap-1 rounded-[4px] bg-warn-soft px-1.5 text-[11px] font-semibold text-ink">
          <span aria-hidden className="text-warn-ink">◌</span>{staleText ?? t('viz2.stale')}
        </span>
      )}
      {state === 'refetch' && <span className="sr-only" role="status">{t('viz2.refetching')}</span>}
      <span className="flex-1" />
      {actions}
      {info && (
        <Tooltip label={info}>
          <button type="button" className={btn} aria-label={t('viz2.info')}><DdIcon name="info" size={13} /></button>
        </Tooltip>
      )}
      {menu && menu.length > 0 && (
        <Menu.Root>
          <Menu.Trigger className={btn} aria-label={t('viz2.menu')}><DdIcon name="kebab-vertical" size={13} /></Menu.Trigger>
          <Menu.List label={t('viz2.menu')}>
            {menu.map((m) => <Menu.Item key={m.label} onSelect={m.onSelect}>{m.label}</Menu.Item>)}
          </Menu.List>
        </Menu.Root>
      )}
      {onFullscreen && (
        <button type="button" className={btn} onClick={full} aria-label={t('viz2.fullscreen')} title={t('viz2.fullscreen')}>
          <DdIcon name="resize-expand" size={13} />
        </button>
      )}
    </header>
  );
}

function Body({ children, className = '' }: { children: ReactNode; className?: string }) {
  const { t } = useTranslation();
  const { state, onRetry, empty } = usePanel();
  let content: ReactNode;
  if (state === 'skeleton') content = <div className="flex h-full flex-col justify-end gap-2 p-3"><Skeleton h={80} /><Skeleton w="40%" h={10} /></div>;
  else if (state === 'error') content = <ErrorState compact onRetry={onRetry} />;
  else if (state === 'empty') content = <EmptyState compact icon="search" title={empty ?? t('viz2.empty')} />;
  else content = (
    <motion.div className="h-full min-h-0" animate={{ opacity: state === 'refetch' ? 0.6 : 1 }} transition={{ duration: DUR.base }}>
      {children}
    </motion.div>
  );
  return <div className={`@container min-h-0 flex-1 ${className}`}>{content}</div>;
}

function Footer({ children }: { children: ReactNode }) {
  return <footer className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-1.5 text-[11px] text-ink-3">{children}</footer>;
}

export const Panel = { Root, Header, Body, Footer };
