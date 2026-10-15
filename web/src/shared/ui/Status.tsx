// Redundant state coding (ISA-101 informed): every state = colour + shape + text.

import { useTranslation } from 'react-i18next';
import type { Quality } from '../../types';

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

export type Severity = 'critical' | 'warning' | 'info';

/** Free-form backend severity → canonical three-tone palette
 *  (dd ALERT/WARN/NO DATA order). Unknown strings degrade to info. */
export function normSeverity(s: string): Severity {
  const v = s.toLowerCase();
  if (v.startsWith('crit') || v.startsWith('err') || v.startsWith('alert')
    || v === 'fatal' || v === 'high') return 'critical';
  if (v.startsWith('warn') || v.startsWith('med')) return 'warning';
  return 'info';
}

export function SeverityBadge({ severity }: { severity: string }) {
  const { t } = useTranslation();
  const s = normSeverity(severity);
  // Shape glyph (▲/◆/●) comes from the .sev-*::before rules in index.css —
  // colour + shape + text, never colour alone (ISA-101).
  return (
    <span className={`sev sev-${s}`} data-severity={s}>
      {t(`alarms.${s}`)}
    </span>
  );
}

/** Alarm lifecycle state — Triggered → Acked → Cleared (Datadog §2.4).
 *  Free-form backend strings normalise to the three canonical states;
 *  redundant-coded via .alarm-state (colour + label — styles in index.css). */
export type AlarmState = 'active' | 'acked' | 'cleared';

export function normAlarmState(s: string): AlarmState {
  const v = s.toLowerCase();
  if (v.startsWith('ack')) return 'acked';
  if (v.startsWith('clear') || v.startsWith('resol') || v.startsWith('clos')) return 'cleared';
  return 'active';
}

export function AlarmStateBadge({ state, ackedBy }: { state: string; ackedBy?: string | null }) {
  const { t } = useTranslation();
  const s = normAlarmState(state);
  return (
    <span
      className={`alarm-state is-${s}`}
      data-state={s}
      title={s === 'acked' && ackedBy ? t('alarms.ackedBy', { who: ackedBy }) : undefined}
    >
      {t(`alarms.${s}`)}
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
