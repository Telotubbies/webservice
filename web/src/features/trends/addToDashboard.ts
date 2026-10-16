// "Add to dashboard" handoff (WP-B). Appends a timeseries widget to an
// existing board. Boards live in the local cache (`saveDashboards`) and —
// for custom boards when the caller can write — sync to the org API, using
// the same update-then-create semantics as DashboardsPage.commit. Formula
// series can never be added: they are computed in the browser and there is
// nothing on the backend to store them in.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '../../lib/api';
import {
  loadDashboards, makeWidget, saveDashboards,
  type Dashboard, type RangeKey, type Widget,
} from '../dashboards/model';

/** Boards the picker offers: the local cache merged with the org's server
 *  list (member-readable; mirrors the merge in useDashboards so a board
 *  shared from another machine shows up here too). */
export function useDashboardTargets(orgId: string | null): { boards: Dashboard[]; loading: boolean } {
  const q = useQuery({
    queryKey: ['dash-targets', orgId],
    queryFn: () => dashboardApi.list(orgId!),
    enabled: !!orgId,
    staleTime: 30_000,
  });
  const boards = useMemo(() => {
    const local = loadDashboards();
    const known = new Set(local.map((d) => d.id));
    const remote = (q.data?.dashboards ?? [])
      .filter((r) => !known.has(r.id))
      .map((r): Dashboard => ({
        id: r.id, title: r.title, description: r.description, preset: 'custom',
        author: r.mine ? 'you' : '', shared: r.shared, updatedAt: r.updated_at,
        range: (r.body.range as RangeKey) ?? '1h', widgets: (r.body.widgets as Widget[]) ?? [],
      }));
    return [...local, ...remote];
  }, [q.data]);
  return { boards, loading: q.isLoading };
}

export interface TrendWidgetSpec { title: string; tags: string[]; unit?: string }

/**
 * Append `spec` as a timeseries widget to `dash`.
 * Returns the board title on success. Server sync is best-effort: built-in
 * boards are local-only, and `canWrite` gates the API write so a viewer
 * session never issues a mutating request it would 403 on.
 */
export async function addTrendWidget(
  dash: Dashboard,
  spec: TrendWidgetSpec,
  ctx: { orgId: string | null; canWrite: boolean },
): Promise<{ ok: boolean; title: string }> {
  const list = loadDashboards();
  const bottom = Math.max(0, ...dash.widgets.map((w) => w.y + w.h));
  const widget = makeWidget('timeseries', {
    title: spec.title, tags: spec.tags.slice(0, 6), unit: spec.unit ?? '',
    x: 0, y: bottom, w: 6, h: 3,
  });
  const updated: Dashboard = { ...dash, widgets: [...dash.widgets, widget], updatedAt: new Date().toISOString() };
  const next = list.some((d) => d.id === dash.id)
    ? list.map((d) => (d.id === dash.id ? updated : d))
    : [...list, updated];
  if (!saveDashboards(next)) return { ok: false, title: dash.title };
  if (dash.preset === 'custom' && ctx.orgId && ctx.canWrite) {
    const row = { id: updated.id, title: updated.title, description: updated.description, shared: updated.shared ?? true, body: { range: updated.range, widgets: updated.widgets } };
    try {
      await dashboardApi.update(ctx.orgId, updated.id, row);
    } catch {
      try { await dashboardApi.create(ctx.orgId, row); } catch { /* offline — the local cache already holds it */ }
    }
  }
  return { ok: true, title: dash.title };
}
