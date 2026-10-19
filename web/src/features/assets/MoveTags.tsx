// Bulk "move to equipment" for the Tags page. Only device_id changes — tag
// paths (and so dashboards, alarms and history) stay put.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ApiError, adminApi, hierarchyApi } from '../../lib/api';
import { liveName } from '../../lib/plantModel';
import { Notice, SkeletonRows } from '../../shared/ui/Feedback';
import './i18n';

export function MoveTags({ orgId, siteId, names, onClose, onDone }: {
  orgId: string; siteId: string; names: string[]; onClose: () => void; onDone: (moved: number) => void;
}) {
  const { t } = useTranslation();
  const [device, setDevice] = useState('');
  const tree = useQuery({ queryKey: ['hierarchy', orgId, siteId], queryFn: () => hierarchyApi.tree(orgId, siteId) });
  const tags = useQuery({ queryKey: ['admin-tags', orgId, siteId], queryFn: () => adminApi.siteTags(orgId, siteId) });
  const go = useMutation({
    mutationFn: () => {
      const byName = new Map((tags.data?.items ?? []).map((x) => [liveName(x.path), x.id]));
      const ids = names.map((n) => byName.get(n)).filter((x): x is string => !!x);
      return hierarchyApi.moveTags(orgId, siteId, { tag_ids: ids, device_id: device });
    },
    onSuccess: (r) => onDone(r.moved),
  });
  const options = (tree.data?.areas ?? []).flatMap((a) => a.lines.flatMap((l) => l.equipment.map((e) => ({ id: e.id, label: `${a.name} › ${l.name} › ${e.name}` }))));
  const err = go.error instanceof ApiError && go.error.status !== 401 ? go.error.message : null;
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={t('asset.moveTagsTitle', { count: names.length })}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="w-full max-w-[460px] space-y-3 rounded-[5px] border border-line bg-white p-4 text-[13px] shadow-flyout">
        <h2 className="text-[15px] font-semibold">{t('asset.moveTagsTitle', { count: names.length })}</h2>
        {tree.isLoading || tags.isLoading ? <SkeletonRows rows={2} /> : (
          <label className="block">
            <span className="mb-1 block text-ink-68">{t('asset.moveTagsPick')}</span>
            <select className="input h-8 w-full" value={device} onChange={(e) => setDevice(e.target.value)} autoFocus>
              <option value="" disabled>{t('asset.choose')}</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </label>
        )}
        <p className="text-ink-68">{t('asset.moveBody')}</p>
        {err && <Notice tone="error">{err}</Notice>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t('asset.cancel')}</button>
          <button type="button" className="btn" disabled={!device || go.isPending} onClick={() => go.mutate()}>{t('asset.moveTagsGo')}</button>
        </div>
      </div>
    </div>
  );
}
