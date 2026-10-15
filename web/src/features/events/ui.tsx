// Shared presentation for event rows (Events explorer, /activity, incident
// timelines). Severity is always colour + shape + text (ISA-101): the rail
// colour is backed by the SeverityBadge glyph/label or the action label.

import type { TFunction } from 'i18next';
import { Icon, type IconName } from '../../shared/ui/Icon';
import type { Severity } from '../../shared/ui/Status';
import { SIGNALS } from '../../lib/plant';
import { eventTitleKey, type EventSource, type PlantEvent } from './model';
import './i18n';

export const SOURCE_KEY: Record<EventSource, string> = {
  alarm: 'evx.sAlarm', insight: 'evx.sInsight', command: 'evx.sCommand', system: 'evx.sSystem',
};

const SOURCE_ICON: Record<EventSource, IconName> = {
  alarm: 'alarm', insight: 'sparkle', command: 'commands', system: 'health',
};

/** Rail tint: red/orange only for abnormal (ISA-101); everything else grey. */
export const RAIL: Record<Severity | 'none', string> = {
  critical: 'bg-[var(--color-danger-bright)]',
  warning: 'bg-[var(--color-warn)]',
  info: 'bg-[var(--color-muted-pill)]',
  none: 'bg-line',
};

const INSIGHT_KIND: Record<string, string> = {
  anomaly: 'insights.kindAnomaly', drift: 'insights.kindDrift',
  flatline: 'insights.kindFlatline', flapping: 'insights.kindFlapping',
};

export function signalLabel(t: TFunction, tag?: string): string {
  if (!tag) return '';
  const meta = SIGNALS[tag];
  return meta ? t(meta.labelKey) : tag.split('.').slice(-2).join(' ');
}

/** Translated one-line title for an event. */
export function eventTitle(t: TFunction, e: PlantEvent): string {
  let subject = e.subject;
  if (e.source === 'insight') subject = t(INSIGHT_KIND[e.subject] ?? e.subject, { defaultValue: e.subject });
  if (e.source === 'command' && e.action !== 'issued') subject = t(`lifecycle.${e.subject}`, { defaultValue: e.subject });
  if (e.source === 'command' && e.action === 'issued') {
    subject = subject === 'true' ? t('state.on') : subject === 'false' ? t('state.off') : subject;
  }
  return t(eventTitleKey(e), { subject });
}

export function SourceGlyph({ source, className = '' }: { source: EventSource; className?: string }) {
  return <Icon name={SOURCE_ICON[source]} size={14} className={className} />;
}

/** "This tab only" marker for journal-derived rows (not persisted). */
export function SessionBadge({ t }: { t: TFunction }) {
  return (
    <span
      className="rounded-[3px] border border-dashed border-[var(--color-control-line)] px-1 text-[10px] text-ink-68"
      title={t('evx.sessionTip')}
    >
      {t('evx.session')}
    </span>
  );
}

export function fmtTime(at: number, lang: string, withDate = false): string {
  return new Date(at).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', withDate
    ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }
    : { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}
