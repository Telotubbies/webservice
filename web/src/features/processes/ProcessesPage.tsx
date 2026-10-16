// Edge processes — the edge-gateway fleet (adapter, heartbeat, buffer) with
// the broker / database rollup.

import { useTranslation } from 'react-i18next';
import { EdgeFleetTable } from '../health/EdgeFleetTable';
import { useEdgeFleet } from '../health/fleet';
import { ProductHeader } from '../../shared/ui/Product';
import '../misc/i18n';

export function ProcessesPage() {
  const { t } = useTranslation();
  const f = useEdgeFleet();
  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <ProductHeader icon="container" title={t('px.processes.title')} />
      <div className="space-y-3 p-4">
        <p className="text-[12px] text-ink-68">
          {t('px.processes.mqtt')}: <span className="font-mono">{f.mqtt ?? '—'}</span> · {t('px.processes.db')}: <span className="font-mono">{f.db ?? '—'}</span>
        </p>
        <EdgeFleetTable />
      </div>
    </div>
  );
}
