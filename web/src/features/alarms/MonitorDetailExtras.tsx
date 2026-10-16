// Monitor-detail additions (dd monitor status page): a collapsible
// "Threshold conditions" panel spelling out exactly when the rule fires,
// and a per-window status strip — ok / warn / alarm across the chart's
// visible window, built from the live alarm history for this rule+signal.
// Both render honest fallbacks when the rule or the history is missing.
// Pure derivations live in ./monitorDetail.ts.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Alarm } from '../../types';
import type { AlarmRule } from '../../types';
import { SeverityBadge } from '../../shared/ui/Status';
import { Card } from '../../shared/ui/Page';
import { DdIcon } from '../../shared/ui/DdIcon';
import { fmtDuration } from '../../lib/format';
import { ruleCondition, statusStrip, type StripSeg } from './monitorDetail';
import '../monitors/i18n';

const LEAD_MS = 10 * 60_000;
const MAX_MS = 8 * 3600_000;

export function ThresholdConditions({ rule, rulesPending }: { rule: AlarmRule | undefined; rulesPending: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Card pad={false}>
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-semibold text-ink hover:bg-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <DdIcon name={open ? 'caret-down' : 'caret-right'} size={12} className="text-ink-46" />
        {t('mon.det.conditions')}
        {rule && <span className="ml-auto font-mono text-[11px] font-normal text-ink-46">{ruleCondition(rule, t)}</span>}
      </button>
      {open && (
        <div className="border-t border-line px-3 py-2">
          {!rule ? (
            <p className="text-[12px] text-ink-46">{rulesPending ? t('common.loading') : t('alx.ruleUnknown')}</p>
          ) : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12px]">
              <dt className="text-ink-46">{t('mon.det.fires')}</dt>
              <dd className="font-mono tabular-nums">
                {t(`mon.kind.${rule.kind}`, { defaultValue: rule.kind })} {ruleCondition(rule, t)}
              </dd>
              {rule.kind !== 'stale' && (
                <>
                  <dt className="text-ink-46">{t('mon.det.deadband')}</dt>
                  <dd className="font-mono tabular-nums">{rule.deadband}</dd>
                </>
              )}
              {rule.window_s != null && (
                <>
                  <dt className="text-ink-46">{t('mon.det.window')}</dt>
                  <dd className="font-mono tabular-nums">{rule.window_s} s</dd>
                </>
              )}
              <dt className="text-ink-46">{t('alx.ruleSeverity')}</dt>
              <dd><SeverityBadge severity={rule.severity} /></dd>
              <dt className="text-ink-46">{t('mon.det.state')}</dt>
              <dd>{rule.enabled ? t('mon.det.enabled') : t('mon.det.disabled')}</dd>
            </dl>
          )}
        </div>
      )}
    </Card>
  );
}

const SEG_FILL: Record<StripSeg['level'], string> = {
  alarm: 'bg-[var(--color-danger-bright)]',
  warn: 'bg-[var(--color-warn)]',
  ok: 'bg-[var(--color-ok)]',
};

export function StatusStrip({ all, ruleName, tag, raisedAt, now }: {
  all: Alarm[]; ruleName: string; tag: string; raisedAt: string; now: number;
}) {
  const { t } = useTranslation();
  const from = Math.max(Date.parse(raisedAt) - LEAD_MS, now - MAX_MS);
  const segs = useMemo(() => statusStrip(all, ruleName, tag, from, now), [all, ruleName, tag, from, now]);
  const width = now - from || 1;
  const alarmed = segs.some((s) => s.level !== 'ok');
  return (
    <figure className="m-0">
      <div
        className="flex h-3.5 w-full overflow-hidden rounded-[3px] border border-line"
        role="img"
        aria-label={`${t('mon.det.strip')}: ${alarmed ? t('mon.alert') : t('mon.ok')}`}
      >
        {segs.map((s, i) => (
          <span
            key={i}
            className={SEG_FILL[s.level]}
            style={{ width: `${Math.max(0.4, ((s.to - s.from) / width) * 100)}%` }}
            title={`${t(`mon.det.${s.level === 'alarm' ? 'alertFor' : s.level === 'warn' ? 'warnFor' : 'okFor'}`, { age: fmtDuration(new Date(s.from).toISOString(), s.to) })}`}
          />
        ))}
      </div>
      <figcaption className="mt-1 flex items-center gap-3 text-[11px] text-ink-46">
        <span className="font-mono tabular-nums">{new Date(from).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
        <span className="flex items-center gap-1"><i aria-hidden className={`inline-block h-2 w-2 rounded-[1px] ${SEG_FILL.ok}`} />{t('mon.ok')}</span>
        <span className="flex items-center gap-1"><i aria-hidden className={`inline-block h-2 w-2 rounded-[1px] ${SEG_FILL.warn}`} />{t('mon.warn')}</span>
        <span className="flex items-center gap-1"><i aria-hidden className={`inline-block h-2 w-2 rounded-[1px] ${SEG_FILL.alarm}`} />{t('mon.alert')}</span>
        <span className="ml-auto font-mono tabular-nums">{t('mon.det.now')}</span>
      </figcaption>
    </figure>
  );
}
