// Infrastructure -> Cameras: live tiles of the cameras on one gateway.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { adminApi } from '../../lib/api';
import { canAdmin } from '../../app/session';
import { useAdminOrg, useAdminSite } from '../admin/admin';
import { Confirm } from '../../shared/ui/Confirm';
import { EmptyState, ErrorState, Notice, SkeletonRows } from '../../shared/ui/Feedback';
import { ProductHeader } from '../../shared/ui/Product';
import { DEVICE_TABS } from '../devices/tabs';
import { AddCameraDialog } from './AddCameraDialog';
import { camApi, type Camera } from './api';
import { CameraTile } from './CameraTile';
import { ModelPanel } from '../vision/ModelPanel';
import './i18n';

export function CamerasPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { orgId, orgRole } = useAdminOrg();
  const { site } = useAdminSite(orgId);
  const admin = canAdmin(orgRole ?? 'none');
  const [picked, setPicked] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [del, setDel] = useState<Camera | null>(null);
  const [modelFor, setModelFor] = useState<Camera | null>(null);
  const [msg, setMsg] = useState('');

  const edges = useQuery({
    queryKey: ['devices', orgId, site?.id], queryFn: () => adminApi.devices(orgId!, site!.id),
    enabled: !!orgId && !!site, refetchInterval: 10_000,
  });
  const gateways = (edges.data?.items ?? []).filter((e) => e.status !== 'disabled');
  const edgeId = picked ?? gateways[0]?.id ?? '';
  const key = ['cameras', orgId, edgeId];
  const cams = useQuery({
    queryKey: key, queryFn: () => camApi.cameras(orgId!, edgeId),
    enabled: !!orgId && !!edgeId, refetchInterval: 10_000,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: key });

  const toggle = useMutation({
    mutationFn: (c: Camera) => camApi.setEnabled(orgId!, edgeId, c.id, !c.enabled),
    onSuccess: refresh, onError: () => setMsg(t('dev.errNetwork')),
  });
  const remove = useMutation({
    mutationFn: (c: Camera) => camApi.remove(orgId!, edgeId, c.id),
    onSuccess: () => { setDel(null); refresh(); }, onError: () => { setDel(null); setMsg(t('dev.errNetwork')); },
  });

  const items = cams.data?.items ?? [];
  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <ProductHeader icon="server" title={t('dev.product')} tabs={DEVICE_TABS(t)} lede={t('cam.lede')}
        actions={admin && edgeId ? <button type="button" className="btn btn-sm" onClick={() => setAdding(true)}><Plus size={14} aria-hidden /> {t('cam.add')}</button> : undefined} />
      <div className="flex-1 space-y-3 p-4">
        {!admin && <Notice tone="info">{t('cam.readOnly')}</Notice>}
        {msg && <Notice tone="error">{msg}</Notice>}
        {edges.isError ? <ErrorState onRetry={() => void edges.refetch()} /> : edges.isLoading || !site ? <SkeletonRows rows={3} /> : gateways.length === 0 ? (
          <EmptyState icon="info" title={t('cam.noGateways')} body={t('cam.noGatewaysHint')} action={<Link to="/infrastructure/add" className="btn btn-sm">{t('dev.add')}</Link>} />
        ) : (
          <>
            {gateways.length > 1 && (
              <div>
                <label className="field-label" htmlFor="cam-gw">{t('cam.gateway')}</label>
                <select id="cam-gw" className="input h-8" value={edgeId} onChange={(e) => setPicked(e.target.value)}>
                  {gateways.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
            )}
            {adding && orgId && site && (
              <AddCameraDialog orgId={orgId} siteId={site.id} edgeId={edgeId}
                onDone={() => { setAdding(false); refresh(); }} onCancel={() => setAdding(false)} />
            )}
            {cams.isError ? <ErrorState onRetry={() => void cams.refetch()} /> : cams.isLoading ? <SkeletonRows rows={3} /> : items.length === 0 ? (
              !adding && <EmptyState icon="info" title={t('cam.none')} body={admin ? t('cam.noneHint') : t('cam.noneViewer')}
                action={admin ? <button type="button" className="btn btn-sm" onClick={() => setAdding(true)}>{t('cam.add')}</button> : undefined} />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((c) => (
                  <CameraTile key={c.id} orgId={orgId!} cam={c} admin={admin}
                    onToggle={(x) => toggle.mutate(x)} onDelete={setDel} onModel={setModelFor} />
                ))}
              </div>
            )}
            {modelFor && orgId && (
              // resolve the freshest polled row so runtime metadata updates while open
              <ModelPanel orgId={orgId} cam={items.find((i) => i.id === modelFor.id) ?? modelFor}
                admin={admin} onClose={() => setModelFor(null)} />
            )}
          </>
        )}
      </div>
      {del && <Confirm title={t('cam.deleteTitle', { name: del.name })} body={t('cam.deleteBody')} confirm={t('cam.delete')} onYes={() => remove.mutate(del)} onNo={() => setDel(null)} />}
    </div>
  );
}
