// Sessions — who is signed in on this browser: identity, sign-in method and
// the organizations/roles the session carries, with sign-out.

import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { signOut } from '../../app/session';
import { ErrorState, Skeleton } from '../../shared/ui/Feedback';
import { ProductHeader } from '../../shared/ui/Product';
import '../misc/i18n';

export function SessionsPage() {
  const { t } = useTranslation();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: 60_000 });
  const d = me.data;
  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <ProductHeader icon="eye" title={t('px.sessions.title')} />
      <div className="max-w-2xl space-y-4 p-4">
        {me.isLoading && <Skeleton h={80} />}
        {me.isError && <ErrorState onRetry={me.refetch} />}
        {d && (
          <>
            <dl className="grid grid-cols-[140px_1fr] gap-y-2 rounded-[5px] border border-line bg-white p-4 text-[13px]">
              <dt className="text-ink-68">{t('px.sessions.user')}</dt><dd className="font-medium">{d.user.display_name || d.user.sub}</dd>
              <dt className="text-ink-68">{t('px.sessions.role')}</dt><dd>{d.role}</dd>
              <dt className="text-ink-68">{t('px.sessions.kind')}</dt><dd>{d.kind === 'oidc' ? t('px.sessions.oidc') : t('px.sessions.dev')}</dd>
            </dl>
            <table className="w-full border-collapse rounded-[5px] border border-line bg-white text-[13px]">
              <thead>
                <tr className="border-b border-line text-left">
                  <th scope="col" className="h-8 px-3 text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-68">{t('px.sessions.colOrg')}</th>
                  <th scope="col" className="h-8 px-3 text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-68">{t('px.sessions.colRole')}</th>
                </tr>
              </thead>
              <tbody>
                {d.memberships.map((m) => (
                  <tr key={m.org_id} className="h-9 border-b border-line last:border-0">
                    <td className="px-3">{m.org_name ?? m.org_id}</td><td className="px-3">{m.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" className="btn btn-sm" onClick={signOut}>{t('px.sessions.signOut')}</button>
          </>
        )}
      </div>
    </div>
  );
}
