// Metrics suite shell (WP-B) — one ProductHeader with route tabs, matching
// the dd metrics menu: Summary · Overview · Volume · Settings. Tab bodies are
// the child routes; the header never carries per-tab state.

import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';
import { ProductHeader } from '../../shared/ui/Product';
import './i18n';

export function MetricsLayout() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <ProductHeader
        icon="metric"
        title={t('mtr.title')}
        tabs={[
          { to: '/metrics', label: t('mtr.tabSummary'), end: true },
          { to: '/metrics/overview', label: t('mtr.tabOverview') },
          { to: '/metrics/volume', label: t('mtr.tabVolume') },
          { to: '/metrics/settings', label: t('mtr.tabSettings') },
        ]}
      />
      <Outlet />
    </div>
  );
}
