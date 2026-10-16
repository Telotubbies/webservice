// Site -> edge -> camera cascade used by the rules and events pages.
// Cameras live under edges, edges under sites: three cheap lists instead of
// one org-wide endpoint that does not exist.

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../../lib/api';
import { camApi, type Camera } from '../cameras/api';

export interface CameraChoice { camera: Camera; edge_id: string; site_id: string }

export function useCameraPick(orgId: string | null, selected: string | null,
                              onPick: (c: CameraChoice | null) => void) {
  const [site, setSite] = useState<string | null>(null);
  const [edge, setEdge] = useState<string | null>(null);
  // org switch: site/edge/camera ids are org-scoped — drop the whole cascade
  // (and the caller's camera pick) so auto-advance re-picks inside the new org
  useEffect(() => {
    setSite(null);
    setEdge(null);
    onPick(null);
  }, [orgId]); // eslint-disable-line react-hooks/exhaustive-deps
  const sites = useQuery({
    queryKey: ['vis-sites', orgId], queryFn: () => adminApi.sites(orgId!), enabled: !!orgId,
  });
  const edges = useQuery({
    queryKey: ['vis-edges', orgId, site], queryFn: () => adminApi.edges(orgId!, site!),
    enabled: !!orgId && !!site,
  });
  const cams = useQuery({
    queryKey: ['vis-cams', orgId, edge], queryFn: () => camApi.cameras(orgId!, edge!),
    enabled: !!orgId && !!edge,
  });
  // auto-advance: first site -> first edge -> first camera (unless the caller picked)
  useEffect(() => {
    const s = sites.data?.items;
    if (!site && s?.length) setSite(s[0].id);
  }, [sites.data, site]);
  useEffect(() => {
    const e = edges.data?.items;
    if (!edge && e?.length) setEdge(e[0].id);
  }, [edges.data, edge]);
  useEffect(() => {
    if (selected || !cams.data || !site || !edge) return;
    const c = cams.data.items[0];
    if (c) onPick({ camera: c, edge_id: edge, site_id: site });
  }, [cams.data, selected, site, edge]); // eslint-disable-line react-hooks/exhaustive-deps
  const select = (id: string) => {
    const c = cams.data?.items.find((x) => x.id === id);
    if (c && site && edge) onPick({ camera: c, edge_id: edge, site_id: site });
  };
  return { sites, edges, cams, site, edge, setSite, setEdge, select };
}

export function CameraCascade({ pick, choice, t }: {
  pick: ReturnType<typeof useCameraPick>; choice: string | null;
  t: (k: string) => string;
}) {
  const { sites, edges, cams } = pick;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className="input h-8" aria-label={t('vis.pickSite')} value={pick.site ?? ''}
        onChange={(e) => { pick.setSite(e.target.value); pick.setEdge(null); }}>
        <option value="" disabled>{t('vis.pickSite')}</option>
        {(sites.data?.items ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <select className="input h-8" aria-label={t('vis.pickEdge')} value={pick.edge ?? ''}
        onChange={(e) => pick.setEdge(e.target.value)}>
        <option value="" disabled>{t('vis.pickEdge')}</option>
        {(edges.data?.items ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>
      <select className="input h-8" aria-label={t('vis.pickCamera')} value={choice ?? ''}
        onChange={(e) => pick.select(e.target.value)}>
        <option value="" disabled>{t('vis.pickCamera')}</option>
        {(cams.data?.items ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </div>
  );
}
