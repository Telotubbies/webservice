// Public status page (roadmap 8.4) — renders outside the authed shell on a
// plain page; safe to mount before the sign-in wall since the endpoint is
// unauthenticated and the page never touches the token or live store.
//
// ROUTE (controller): App.tsx — OUTSIDE the Boot-gated route group:
//   const StatusPage = lazy(() => import('./features/status/StatusPage')
//     .then((m) => ({ default: m.StatusPage })));
//   <Route path="status" element={page(StatusPage)} />   // sibling of Boot's
//   (or inside Boot — it works either way, but outside keeps it public)

import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { statusApi } from '../../lib/api';
import { Icon } from '../../shared/ui/Icon';
import { SkeletonRows } from '../../shared/ui/Feedback';
import '../onboarding/i18n';

const COMP_LABEL: Record<string, string> = {
  api: 'st.compApi', database: 'st.compDb', mqtt: 'st.compMqtt', edge: 'st.compEdge',
};

export function StatusPage() {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['public-status'],
    queryFn: statusApi.get,
    refetchInterval: 30_000,
    retry: 1,
  });

  const status = q.data?.status ?? 'down';
  const tone = status === 'operational' ? 'var(--color-ok)'
    : status === 'degraded' ? 'var(--color-caution)' : 'var(--color-danger)';

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-xl flex-col gap-4 bg-paper px-4 py-10">
      <header>
        <h1 className="text-[22px] font-semibold text-ink">{t('st.title')}</h1>
        <p className="text-[13px] text-ink-46">{t('st.lede')}</p>
      </header>

      {q.isLoading && <SkeletonRows rows={4} />}
      {q.isError && (
        <div className="rounded border border-line bg-white p-4" role="alert">
          <span className="flex items-center gap-2 text-[14px] font-semibold text-[var(--color-danger)]">
            <Icon name="warn" size={18} /> {t('st.failed')}
          </span>
        </div>
      )}

      {q.data && (
        <>
          <div className="rounded border border-line bg-white p-4" role="status">
            <span className="flex items-center gap-2 text-[15px] font-semibold" style={{ color: tone }}>
              <Icon name={status === 'operational' ? 'check-circle' : 'warn'} size={20} />
              {t(`st.${status}`)}
            </span>
          </div>
          <ul className="divide-y divide-line rounded border border-line bg-white">
            {q.data.components.map((c) => (
              <li key={c.name} className="flex min-h-11 items-center gap-3 px-4 py-2">
                <span className={c.ok ? 'text-[var(--color-ok)]' : 'text-[var(--color-danger)]'}>
                  <Icon name={c.ok ? 'check-circle' : 'warn'} size={16} />
                </span>
                <span className="flex-1 text-[13px] text-ink">
                  {t(COMP_LABEL[c.name] ?? c.name)}
                </span>
                <span className="text-[12px] text-ink-46">
                  {c.ok ? t('st.ok') : t('st.bad')}
                  {c.since && ` · ${t('st.since', { ts: new Date(c.since).toLocaleString() })}`}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-ink-46">
            {t('st.updated', { ts: new Date(q.data.updated_at).toLocaleString() })}
          </p>
        </>
      )}
    </div>
  );
}
