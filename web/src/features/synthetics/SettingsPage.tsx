// Synthetics › Settings — read-only: the windows that decide pass / fail,
// taken from the same constants the checks use so the page cannot drift.

import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';
import { STALE_MS } from '../../lib/live';
import { OFFLINE_AFTER_MS, STALE_AFTER_MS } from '../health/fleet';
import { PageBar } from '../../shared/ui/Page';
import { Notice } from '../../shared/ui/Feedback';
import { useSyntheticsTabs } from './SyntheticsPage';
import '../misc/i18n';
import './i18n';

export function SyntheticsSettingsPage() {
  const { t } = useTranslation();
  const tabs = useSyntheticsTabs();
  const edgeS = STALE_AFTER_MS / 1000, offS = OFFLINE_AFTER_MS / 1000;
  const items = [
    ['setSignal', 'setSignalBody', { s: STALE_MS / 1000 }],
    ['setEdgeOnline', 'setEdgeOnlineBody', { s: edgeS }],
    ['setEdgeStale', 'setEdgeStaleBody', { s: edgeS, m: offS }],
    ['setEdgeOffline', 'setEdgeOfflineBody', { m: offS }],
  ] as const;
  return (
    <>
      <PageBar icon="multi-heartbeat" title={t('px.synthetics.title')} tabs={tabs} />
      <div className="max-w-3xl space-y-4 p-4">
        <div>
          <h2 className="text-[16px] font-semibold">{t('syn.setTitle')}</h2>
          <p className="text-[13px] text-ink-68">{t('syn.setLede')}</p>
        </div>
        <dl className="divide-y divide-line rounded-[5px] border border-line bg-white text-[13px]">
          {items.map(([h, b, v]) => (
            <div key={h} className="grid gap-1 px-4 py-3 sm:grid-cols-[200px_1fr]">
              <dt className="font-semibold">{t(`syn.${h}`)}</dt>
              <dd className="text-ink-68">{t(`syn.${b}`, v)}</dd>
            </div>
          ))}
        </dl>
        <Notice>{t('syn.setFixed')}</Notice>
        <p className="text-[13px] text-ink-68">{t('syn.setRules')} <NavLink to="/admin/rules" className="text-blue hover:underline">{t('syn.setRulesLink')}</NavLink></p>
      </div>
    </>
  );
}
