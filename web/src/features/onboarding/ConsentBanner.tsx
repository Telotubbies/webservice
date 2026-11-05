// Consent re-ask banner (roadmap 8.1). Polls GET /api/v1/consents; when the
// user's recorded version is behind the required one it pins a banner that
// records fresh consent for every missing document on accept.
//
// MOUNT (controller): inside Shell above the routed content, e.g.
//   import { ConsentBanner } from '../../features/onboarding/ConsentBanner';
//   ...near the top of the shell column: <ConsentBanner />

import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { consentApi } from '../../lib/api';
import { Notice } from '../../shared/ui/Feedback';
import './i18n';

export function ConsentBanner() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['consents'], queryFn: consentApi.get, staleTime: 300_000 });
  const m = useMutation({
    mutationFn: async (missing: string[]) => {
      const req = q.data!.required;
      for (const doc of missing) {
        await consentApi.post(doc, req[doc]);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['consents'] }),
  });

  const missing = q.data?.missing ?? [];
  if (!q.data || missing.length === 0) return null;

  return (
    <div className="px-4 pt-3" role="alert">
      <Notice
        tone="warn"
        icon="warn"
        action={
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={m.isPending}
            onClick={() => m.mutate(missing)}
          >
            {m.isPending ? '…' : t('cons.accept')}
          </button>
        }
      >
        <span className="font-semibold">{t('cons.bannerTitle')}</span>{' '}
        {t('cons.bannerBody')}
        {m.isError && <span className="block text-[12px]">{t('cons.failed')}</span>}
      </Notice>
    </div>
  );
}
