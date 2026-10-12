// Redundant state coding (ISA-101 informed): every state = colour + shape + text.

import { useTranslation } from 'react-i18next';
import type { Quality } from '../../types';
import { Icon } from './Icon';

export type RunState = 'running' | 'stopped' | 'stale' | 'unknown';

export function StatePill({ state }: { state: RunState }) {
  const { t } = useTranslation();
  return (
    <span className={`state state-${state}`} data-state={state}>
      <span className="glyph" aria-hidden />
      {t(`state.${state}`)}
    </span>
  );
}

export type Severity = 'critical' | 'warning' | 'info';

export function normSeverity(s: string): Severity {
  const v = s.toLowerCase();
  if (v.startsWith('crit')) return 'critical';
  if (v.startsWith('warn')) return 'warning';
  return 'info';
}

export function SeverityBadge({ severity }: { severity: string }) {
  const { t } = useTranslation();
  const s = normSeverity(severity);
  // Shape glyph (▲/◆/●) comes from .sev::before keyed on data-severity —
  // colour + shape + text, never colour alone (ISA-101).
  return (
    <span className={`sev sev-${s}`} data-severity={s}>
      {t(`alarms.${s}`)}
    </span>
  );
}

export function QualityMark({ q, stale }: { q?: Quality; stale?: boolean }) {
  const { t } = useTranslation();
  if (stale) return <span className="qmark" data-q="stale">{t('state.staleQ')}</span>;
  if (!q || q === 'good') return null; // normal is quiet
  const key = q === 'bad' ? 'bad' : q === 'uncertain' ? 'uncertain' : 'staleQ';
  return (
    <span className={`qmark qmark-${q}`} data-q={q}>
      <Icon name="warn" size={13} />
      {t(`state.${key}`)}
    </span>
  );
}
