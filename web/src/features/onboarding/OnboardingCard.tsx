// Onboarding checklist (roadmap 1.3) — six first-run steps derived from the
// backend, ticking live via React Query polling. Dismissal is per-browser
// per-org (localStorage); a fully-complete checklist hides itself.
//
// MOUNT (controller): render inside OverviewPage above the KPI grid, e.g.
//   import { OnboardingCard } from '../onboarding/OnboardingCard';
//   ...in the overview column: <OnboardingCard />

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { onboardingApi } from '../../lib/api';
import { useAdminOrg } from '../admin/admin';
import { Card } from '../../shared/ui/Page';
import { Icon } from '../../shared/ui/Icon';
import { SkeletonRows } from '../../shared/ui/Feedback';
import { HelpLink } from './HelpLink';
import { dismissKey, progress, visible } from './steps';
import './i18n';

const HELP_DOC: Record<string, string> = {
  gateway: 'gateway', data: 'dataSource', dashboard: 'dashboards',
  alarm_rule: 'alarmRules', notify: 'notify', teammate: 'invite',
};

function readDismissed(orgId: string): boolean {
  try {
    return localStorage.getItem(dismissKey(orgId)) === '1';
  } catch {
    return false; // storage denied → show it; harmless
  }
}

export function OnboardingCard() {
  const { t } = useTranslation();
  const { orgId } = useAdminOrg();
  const [dismissed, setDismissed] = useState(() => (orgId ? readDismissed(orgId) : false));
  const q = useQuery({
    queryKey: ['onboarding', orgId],
    queryFn: () => onboardingApi.get(orgId!),
    enabled: orgId != null,
    refetchInterval: 15_000, // ticks itself as the user completes steps
  });

  if (!orgId) return null;
  const steps = q.data?.steps ?? [];
  if (q.isLoading) {
    return <Card title={t('onb.title')}><SkeletonRows rows={3} /></Card>;
  }
  if (q.isError || !visible(steps, dismissed)) return null;

  const { done, total } = progress(steps);
  const dismiss = () => {
    try { localStorage.setItem(dismissKey(orgId), '1'); } catch { /* session-only */ }
    setDismissed(true);
  };

  return (
    <Card
      title={`${t('onb.title')} · ${t('onb.progress', { done, total })}`}
      pad={false}
      actions={
        <button
          type="button"
          onClick={dismiss}
          className="btn btn-sm btn-ghost"
          aria-label={t('onb.dismiss')}
        >
          <Icon name="x" size={14} />
        </button>
      }
    >
      {/* progress bar */}
      <div className="mx-3 mt-1 h-1 overflow-hidden rounded bg-subtle" role="progressbar"
        aria-valuenow={done} aria-valuemin={0} aria-valuemax={total}
        aria-label={t('onb.progress', { done, total })}>
        <div className="h-full bg-blue transition-[width] duration-300"
          style={{ width: `${(done / total) * 100}%` }} />
      </div>
      <ol className="mt-1">
        {steps.map((s) => (
          <li key={s.id}>
            <Link
              to={s.href}
              className="flex min-h-11 items-center gap-2 border-b border-line px-3 py-1.5 last:border-0 hover:bg-subtle focus-visible:bg-subtle focus-visible:outline-none"
            >
              <span className={s.done ? 'text-[var(--color-ok)]' : 'text-ink-46'}>
                <Icon name={s.done ? 'check-circle' : 'chevron'} size={16} />
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-[13px] ${s.done ? 'text-ink-46 line-through' : 'text-ink'}`}>
                  {t(`onb.step.${s.id}`)}
                </span>
                {!s.done && (
                  <span className="block truncate text-[11px] text-ink-46">
                    {t(`onb.step.${s.id}Body`)}
                  </span>
                )}
              </span>
              {!s.done && <HelpLink doc={HELP_DOC[s.id] ?? 'gettingStarted'} />}
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}
