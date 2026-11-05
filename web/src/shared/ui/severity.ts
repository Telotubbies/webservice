// Severity vocabulary, pure — Status.tsx re-exports it; pure modules (alarm
// summary, palette commands) import it from here without pulling React/i18n.

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
