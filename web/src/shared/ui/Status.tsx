// Redundant state coding (ISA-101 informed): every state = colour + shape + text.

import { useTranslation } from 'react-i18next';
import type { Quality } from '../../types';
import { fmtAge } from '../../lib/format';
import { useNow } from '../../lib/hooks';

export type RunState = 'running' | 'stopped' | 'stale' | 'unknown';

/* Distinct shape per state — colour alone is never the only carrier
   (ISA-101). Rendered inline: .glyph has no stylesheet rules, the
   character is the shape. ● running · ■ stopped · ◆ stale · ○ unknown */
const RUN_GLYPH: Record<RunState, string> = {
  running: '●', stopped: '■', stale: '◆', unknown: '○',
};

export function StatePill({ state }: { state: RunState }) {
  const { t } = useTranslation();
  return (
    <span className={`state state-${state}`} data-state={state}>
      <span className="glyph text-[9px] leading-none" aria-hidden>{RUN_GLYPH[state]}</span>
      {t(`state.${state}`)}
    </span>
  );
}

// normSeverity lives in ./severity (pure, importable without React/i18n).
export { normSeverity, type Severity } from './severity';
import { normSeverity, type Severity } from './severity';

/* Alarm priority coding: OUR PROPOSAL, NOT A STANDARD (no ISA-18.2 / ISA-101
   clause text was read). Four priorities, each a different shape plus its
   number plus a colour token, so it survives greyscale:
   P1 critical octagon, P2 high triangle, P3 medium diamond, P4 low circle. */
export type Priority = 1 | 2 | 3 | 4;
const PRIORITY_SHAPE: Record<Priority, { cls: string; d: string }> = {
  1: { cls: 'sev-critical', d: 'M8.5 1.5h7l7 7v7l-7 7h-7l-7-7v-7z' },
  2: { cls: 'sev-high', d: 'M12 2.5L22 20H2z' },
  3: { cls: 'sev-warning', d: 'M12 2l10 10-10 10L2 12z' },
  4: { cls: 'sev-info', d: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10z' },
};

export function PriorityBadge({ priority, label }: { priority: Priority; label: string }) {
  const { cls, d } = PRIORITY_SHAPE[priority];
  return (
    <span className={`sev ${cls}`} data-priority={priority}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" aria-hidden focusable={false}><path d={d} /></svg>
      <span className="tabular-nums">P{priority}</span> {label}
    </span>
  );
}

const SEV_PRIORITY: Record<Severity, Priority> = { critical: 1, warning: 3, info: 4 };

export function SeverityBadge({ severity }: { severity: string }) {
  const { t } = useTranslation();
  const s = normSeverity(severity);
  return <PriorityBadge priority={SEV_PRIORITY[s]} label={t(`alarms.${s}`)} />;
}

/** Alarm lifecycle state — Triggered → Acked → Cleared (ISA-18.2).
 *  Free-form backend strings normalise to the three canonical states;
 *  redundant-coded via .alarm-state (colour + label — styles in index.css). */
export type AlarmState = 'active' | 'rtn_unack' | 'acked' | 'cleared';

export function normAlarmState(s: string): AlarmState {
  const v = s.toLowerCase();
  if (v === 'rtn_unack' || v === 'rtn' || v.startsWith('return')) return 'rtn_unack';
  if (v.startsWith('ack')) return 'acked';
  if (v.startsWith('clear') || v.startsWith('resol') || v.startsWith('clos')) return 'cleared';
  return 'active';
}

export function AlarmStateBadge({ state, ackedBy }: { state: string; ackedBy?: string | null }) {
  const { t } = useTranslation();
  const s = normAlarmState(state);
  return (
    <span
      className={`alarm-state is-${s}${s === 'rtn_unack' ? ' border border-dashed border-[var(--color-caution)] bg-[var(--color-caution-soft)]' : ''}`}
      data-state={s}
      title={s === 'acked' && ackedBy ? t('alarms.ackedBy', { who: ackedBy }) : undefined}
    >
      {s === 'rtn_unack' && <span aria-hidden>↩ </span>}{t(`alarms.${s}`)}
    </span>
  );
}

/* Quality axis glyphs — ✚ bad / ◇ uncertain / ○ stale. Rendered inline:
   .qmark has no ::before rules in index.css, so the character is the shape.
   Colour + shape + text, never colour alone (ISA-101). */
const Q_GLYPH: Record<Exclude<Quality, 'good'>, string> = {
  bad: '✚', uncertain: '◇', stale: '○',
};

export function QualityMark({ q, stale }: { q?: Quality; stale?: boolean }) {
  const { t } = useTranslation();
  if (stale || q === 'stale') {
    return (
      <span className="qmark" data-q="stale">
        <span className="text-[9px] leading-none" aria-hidden>{Q_GLYPH.stale}</span>
        {t('state.staleQ')}
      </span>
    );
  }
  if (!q || q === 'good') return null; // normal is quiet
  const key = q === 'bad' ? 'bad' : q === 'uncertain' ? 'uncertain' : 'staleQ';
  return (
    <span className={`qmark qmark-${q}`} data-q={q}>
      <span className="text-[9px] leading-none" aria-hidden>{Q_GLYPH[q]}</span>
      {t(`state.${key}`)}
    </span>
  );
}

/** "Updated 4 s ago" for a value/panel — quiet grey while fresh, flips to a
 *  dashed stale mark (○ + text) once older than `staleAfterMs`, so an old
 *  value can never pass for a live one (anti-goal: stale shown as live).
 *  Re-renders itself every second; pass `now` to share a parent's clock. */
export function Freshness({ ts, staleAfterMs = 30_000, now: nowProp }: {
  ts: string | undefined; staleAfterMs?: number; now?: number;
}) {
  const { t } = useTranslation();
  const tick = useNow(1000);
  const now = nowProp ?? tick;
  if (!ts) return <span className="freshness">{t('state.never')}</span>;
  const age = now - Date.parse(ts);
  if (age > staleAfterMs) {
    return (
      <span className="qmark" data-q="stale" data-fresh="stale" title={new Date(ts).toLocaleString()}>
        <span className="text-[9px] leading-none" aria-hidden>{Q_GLYPH.stale}</span>
        {t('ui.staleFor', { age: fmtAge(ts, now) })}
      </span>
    );
  }
  return (
    <span className="freshness" data-fresh="live" title={new Date(ts).toLocaleString()}>
      {t('state.updated', { age: fmtAge(ts, now) })}
    </span>
  );
}
