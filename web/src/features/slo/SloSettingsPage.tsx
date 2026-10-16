// /slos/settings — dd "SLO settings" surface adapted to what this backend
// actually exposes. There is no org-preferences endpoint and no archived-SLO
// store, so the page carries: (1) per-browser list defaults, labelled as
// local; (2) the read-only service limits the backend enforces; (3) the
// deleted-SLO audit trail (admin/owner only — the audit endpoint is gated).

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { adminApi, type AuditRow } from '../../lib/api';
import { PageBar, PageBody, Card } from '../../shared/ui/Page';
import { EmptyState, ErrorState, Notice, PermissionNotice, SkeletonRows } from '../../shared/ui/Feedback';
import { Segmented } from '../../shared/ui/Segmented';
import { canAdmin, useAdminOrg } from '../admin/admin';
import { listWindow, newSloPreset, setListWindow, setNewSloPreset, SLO_WINDOW_KEYS, type SloWindowKey } from './prefs';
import './i18n';

export function SloSettingsPage() {
  const { t, i18n } = useTranslation();
  const { orgId, orgRole } = useAdminOrg();
  const admin = canAdmin(orgRole ?? 'none');

  const [win, setWin] = useState<SloWindowKey>(listWindow);
  const preset = newSloPreset();
  const [target, setTarget] = useState(preset.target != null ? String(preset.target) : '');
  const [warning, setWarning] = useState(preset.warning != null ? String(preset.warning) : '');
  const [saved, setSaved] = useState(false);

  const deleted = useQuery({
    queryKey: ['slo-deleted-audit', orgId],
    queryFn: () => adminApi.audit(orgId!, { action: 'slo.deleted', limit: 200 }),
    enabled: !!orgId && admin,
  });

  const savePresets = () => {
    const tg = target.trim() === '' ? null : Number(target);
    const w = warning.trim() === '' ? null : Number(warning);
    if (tg != null && !(tg > 0 && tg < 100)) return;
    if (w != null && !(w > 0 && w <= 100)) return;
    setNewSloPreset({ target: tg, warning: w });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  };

  const pickWindow = (w: string) => {
    const k = w as SloWindowKey;
    setWin(k); setListWindow(k);
  };

  return (
    <>
      <PageBar icon="status-page" title={t('slos.set.title')} back={{ to: '/slos' }}
        tabs={[
          { to: '/slos', label: t('slos.tabList'), end: true },
          { to: '/slos/settings', label: t('slos.tabSettings') },
        ]} />
      <PageBody className="max-w-3xl space-y-4">
        <Card title={t('slos.set.defaults')}>
          <div className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-center">
            <label className="text-[13px] font-semibold">{t('slos.set.window')}</label>
            <div>
              <Segmented value={win} onChange={pickWindow} label={t('slos.set.window')}
                options={SLO_WINDOW_KEYS.map((w) => ({ value: w, label: w }))} />
              <p className="mt-1 text-[12px] text-ink-46">{t('slos.set.windowBody')}</p>
            </div>
          </div>
          <Notice tone="info"><span className="text-[12px]">{t('slos.set.savedBrowser')}</span></Notice>
        </Card>

        <Card title={t('slos.set.newSlo')}>
          <p className="mb-3 text-[12px] text-ink-68">{t('slos.set.newSloBody')}</p>
          <form className="grid gap-3 sm:grid-cols-2" noValidate onSubmit={(e) => { e.preventDefault(); savePresets(); }}>
            <div className="field">
              <label className="field-label" htmlFor="slo-set-target">{t('slos.set.target')}</label>
              <input id="slo-set-target" className="input num h-8" type="number" step="0.01" min="0" max="99.999"
                value={target} onChange={(e) => setTarget(e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="slo-set-warning">{t('slos.set.warning')}</label>
              <input id="slo-set-warning" className="input num h-8" type="number" step="0.01" max="100"
                value={warning} placeholder={t('slos.set.warnAuto')} onChange={(e) => setWarning(e.target.value)} />
            </div>
            <div className="flex items-center gap-2 sm:col-span-2">
              <button type="submit" className="btn btn-sm">{t('slos.save')}</button>
              {saved && <span className="text-[12px] font-medium text-ok-ink">{t('slos.set.saved')}</span>}
            </div>
          </form>
        </Card>

        <Card title={t('slos.set.limits')}>
          <ul className="list-disc space-y-1 pl-5 text-[13px] text-ink-68">
            <li>{t('slos.set.limRetention')}</li>
            <li>{t('slos.set.limCount')}</li>
            <li>{t('slos.set.limCorr')}</li>
            <li>{t('slos.set.limDeleted')}</li>
          </ul>
        </Card>

        <Card title={t('slos.set.deleted')}>
          <p className="mb-3 text-[12px] text-ink-68">{t('slos.set.deletedBody')}</p>
          {!admin ? <PermissionNotice role="admin" />
            : deleted.isLoading ? <SkeletonRows rows={3} />
            : deleted.isError ? <ErrorState compact onRetry={() => void deleted.refetch()} />
            : (deleted.data?.items ?? []).length === 0 ? (
              <EmptyState compact icon="check" title={t('slos.set.deletedEmpty')} />
            ) : (
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left">
                    {[t('slos.set.colDeleted'), t('slos.set.colId'), t('slos.panel.colActor'), t('slos.panel.colDetail')].map((h, i) => (
                      <th key={i} scope="col" className="overline h-7 px-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(deleted.data?.items ?? []).map((it: AuditRow) => (
                    <tr key={it.seq} className="h-9 border-b border-line last:border-0">
                      <td className="whitespace-nowrap px-3 font-mono text-[12px] text-ink-68">
                        {new Date(it.at).toLocaleString(i18n.language)}
                      </td>
                      <td className="px-3 font-mono text-[12px]">{(it.target as { slo_id?: string } | null)?.slo_id ?? '—'}</td>
                      <td className="px-3 font-mono text-[12px]">{String(it.actor).replace(/^user:/, '')}</td>
                      <td className="max-w-0 truncate px-3 font-mono text-[11px] text-ink-68" title={JSON.stringify(it.detail)}>
                        {it.detail && typeof it.detail === 'object'
                          ? Object.entries(it.detail as Record<string, unknown>).map(([k, v]) => `${k}: ${String(v)}`).join(' · ')
                          : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          <p className="mt-2 text-[11px] text-ink-46">{t('slos.set.deleteNote')}</p>
        </Card>
      </PageBody>
    </>
  );
}
