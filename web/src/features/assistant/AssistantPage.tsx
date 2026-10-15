// Assistant — latest predictions from the org's external AI model server
// (GET /inference, cached server-side). Read-only; the model never acts.

import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { inferenceApi } from '../../lib/api';
import { useAdminOrg } from '../admin/admin';
import { EmptyState, ErrorState, Notice, Skeleton } from '../../shared/ui/Feedback';
import { SeverityBadge } from '../../shared/ui/Status';
import { ProductHeader } from '../../shared/ui/Product';

export function AssistantPage() {
  const { t } = useTranslation();
  const { orgId } = useAdminOrg();
  const q = useQuery({ queryKey: ['inference', orgId], queryFn: () => inferenceApi.get(orgId!), enabled: !!orgId, refetchInterval: 10_000 });
  const d = q.data;
  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <ProductHeader icon="ai-search" title={t('ai.title')} />
      <div className="p-4">
        {q.isLoading && <Skeleton h={80} />}
        {q.isError && <ErrorState onRetry={q.refetch} />}
        {d && !d.configured && <EmptyState title={t('ai.off')} body={t('ai.offBody')} icon="search" />}
        {d?.configured && (
          <>
            <p className="mb-2 text-[12px] text-ink-68">
              {t('ai.model')}: <span className="font-mono">{d.model || '—'}</span> · {d.latency_ms} ms
              {d.ts && <> · {new Date(d.ts * 1000).toLocaleTimeString()}</>}
            </p>
            {d.error && <Notice>{t('ai.unreachable', { error: d.error })}</Notice>}
            {!d.error && !d.results?.length && <EmptyState title={t('ai.noResults')} icon="search" />}
            {!!d.results?.length && (
              <ul className="rounded-[5px] border border-line bg-white">
                {d.results.map((r, i) => (
                  <li key={i} className="flex items-center gap-3 border-b border-line px-3 py-2 text-[13px] last:border-0">
                    <SeverityBadge severity={r.severity} />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{r.label}</span>
                      {r.tag && <Link to={`/trends?tags=${encodeURIComponent(r.tag)}`} className="ml-2 font-mono text-[11px] text-blue hover:underline">{r.tag}</Link>}
                      {r.detail && <span className="block text-[12px] text-ink-68">{r.detail}</span>}
                    </span>
                    <span className="w-28" role="img" aria-label={`${Math.round(r.score * 100)} %`}>
                      <span className="block h-2 rounded-sm bg-subtle"><span className="block h-full rounded-sm bg-blue" style={{ width: `${r.score * 100}%` }} /></span>
                    </span>
                    <span className="w-10 text-right font-mono text-[12px]">{Math.round(r.score * 100)}%</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
