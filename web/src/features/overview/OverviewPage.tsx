// Overview (index route) — the Home summary (features/home) once the live
// store has its first seed; skeletons before that, never a fake "quiet"
// state, and a real retry when the boot fetch failed. Setup help sits under
// the live readouts, never above them.

import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { live } from '../../lib/live';
import { useStore } from '../../lib/hooks';
import { PageBar } from '../../shared/ui/Page';
import { PageSkeleton, ErrorState } from '../../shared/ui/Feedback';
import { OnboardingCard } from '../onboarding/OnboardingCard';
import { ConnectGuide } from '../onboarding/ConnectGuide';
import { useConnectGuide } from '../onboarding/useConnectGuide';
import { HomePage } from '../home/HomePage';

export function OverviewPage() {
  const { t } = useTranslation();
  // cold start: the revision counters also move on reset (sign-in), so gate on the flags
  const seeded = useStore(() => live.tagsSeeded);
  const seedError = useStore(() => live.seedError);
  const qc = useQueryClient();
  const guide = useConnectGuide();

  /** Re-run the boot seed (mirrors useLiveBoot in App) so the error state
   *  offers a real retry instead of a dead end. */
  const retrySeed = () => {
    void qc.invalidateQueries({ queryKey: ['tags'] });
    void api.latestAll().then((rows) => rows.forEach((r) => live.pushTag(r.name, r.v, r.q, r.ts)))
      .catch(() => live.setSeedError());
    void api.alarms().then((a) => live.setAlarms(a)).catch(() => live.setSeedError());
    void api.insights({ state: 'open' }).then((a) => live.setInsights(a)).catch(() => live.setSeedError());
  };

  if (seedError && !seeded) return <><PageBar title={t('home.title')} /><ErrorState onRetry={retrySeed} /></>;
  if (!seeded) return <><PageBar title={t('home.title')} /><PageSkeleton /></>;

  return (
    <HomePage
      footer={(
        <>
          <OnboardingCard />
          {!guide.hidden && <ConnectGuide onClose={guide.hide} />}
        </>
      )}
    />
  );
}
