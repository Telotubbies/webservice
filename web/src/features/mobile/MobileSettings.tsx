// Settings › Mobile notifications: turn alarm push on for this device, send a
// test, and (iOS) the steps that make push possible at all. Plus the org policy
// for command buttons on phones, for admins.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, request } from '../../lib/api';
import { disablePush, enablePush, pushState, testPush, type PushState } from '../../lib/push';
import { setMobileControl } from '../../lib/policy';
import { isIOS } from '../../lib/pwa';
import { useAdminOrg, canAdmin } from '../admin/admin';
import { Card } from '../../shared/ui/Page';
import { Notice } from '../../shared/ui/Feedback';
import './i18n';

export function MobileSettings() {
  const { t } = useTranslation();
  const { orgId } = useAdminOrg();
  const [state, setState] = useState<PushState | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error' | 'info'; text: string } | null>(null);
  useEffect(() => { void pushState().then(setState); }, []);

  const toggle = useMutation({
    mutationFn: async () => {
      if (!orgId) return;
      if (state === 'on') await disablePush(orgId); else await enablePush(orgId);
    },
    onSuccess: async () => { setState(await pushState()); setMsg(null); },
    onError: (e) => setMsg({ tone: 'error', text: e instanceof ApiError ? e.message : t('mob.pushFailed') }),
  });
  const test = useMutation({
    mutationFn: () => testPush(orgId!),
    onSuccess: (r) => setMsg(r.sent > 0 ? { tone: 'ok', text: t('mob.testSent') } : { tone: 'error', text: t('mob.testNone') }),
    onError: () => setMsg({ tone: 'error', text: t('mob.pushFailed') }),
  });

  return (
    <Card title={t('mob.title')}>
      <div className="space-y-3 text-[13px]">
        <p className="text-ink-68">{t('mob.body')}</p>
        {state === 'needs-install' && (
          <div className="rounded-[5px] border border-line bg-subtle p-3">
            <p className="font-semibold">{t('mob.iosTitle')}</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-ink-68">
              <li>{t('mob.ios1')}</li><li>{t('mob.ios2')}</li><li>{t('mob.ios3')}</li><li>{t('mob.ios4')}</li>
            </ol>
          </div>
        )}
        {state === 'unsupported' && <Notice tone="warn">{isIOS() ? t('mob.iosOld') : t('mob.unsupported')}</Notice>}
        {state === 'denied' && <Notice tone="warn">{t('mob.denied')}</Notice>}
        {(state === 'off' || state === 'on') && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={state === 'on' ? 'btn btn-ghost min-h-11' : 'btn min-h-11'} disabled={toggle.isPending || !orgId} onClick={() => toggle.mutate()}>
              {state === 'on' ? t('mob.turnOff') : t('mob.turnOn')}
            </button>
            {state === 'on' && <button type="button" className="btn btn-ghost min-h-11" disabled={test.isPending} onClick={() => test.mutate()}>{t('mob.test')}</button>}
            <span className="text-ink-68" role="status">{state === 'on' ? t('mob.on') : t('mob.off')}</span>
          </div>
        )}
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <p className="text-[12px] text-ink-46">{t('mob.privacy')}</p>
        <MobilePolicy />
      </div>
    </Card>
  );
}

/** Admin switch: may phones show command buttons? Off by default. A UX guard,
 *  not a security boundary — the server checks role, area and a fresh second
 *  factor on every command regardless. */
export function MobilePolicy() {
  const { t } = useTranslation();
  const { orgId, orgRole } = useAdminOrg();
  const qc = useQueryClient();
  const admin = canAdmin(orgRole ?? '');
  const key = ['org-security', orgId];
  const q = useQuery({
    queryKey: key, enabled: !!orgId, staleTime: 30_000,
    queryFn: () => request<{ mobile_control: boolean }>(`/api/v1/orgs/${orgId}/security`),
  });
  const m = useMutation({
    mutationFn: (on: boolean) => request(`/api/v1/orgs/${orgId}/security`, { method: 'PATCH', body: JSON.stringify({ mobile_control: on }) }),
    onSuccess: (_r, on) => { setMobileControl(on); void qc.invalidateQueries({ queryKey: key }); },
  });
  if (!admin || !q.data) return null;
  const err = m.error instanceof ApiError && m.error.status !== 401 ? m.error.message : null;
  return (
    <div className="border-t border-line pt-3">
      <label className="flex min-h-11 items-center gap-2 font-semibold">
        <input type="checkbox" className="h-4 w-4" checked={q.data.mobile_control} disabled={m.isPending} onChange={(e) => m.mutate(e.target.checked)} />
        {t('mob.controlLabel')}
      </label>
      <p className="text-ink-68">{t('mob.controlHint')}</p>
      {err && <Notice tone="error">{err}</Notice>}
    </div>
  );
}
