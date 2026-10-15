// Template executor: runs templatePlan() steps in sequence, reporting progress.
// Stops at the first failure (earlier steps stay applied; the UI says which).

import { adminApi, dashboardApi } from '../../lib/api';
import { DASH_TEMPLATES } from '../dashboards/templates';
import { newId } from '../dashboards/model';
import { dsApi } from './api';
import { remapDashboardTag, templatePlan, type PlanStep, type SourceTemplate } from './logic';

export type StepStatus = 'pending' | 'running' | 'done' | 'failed';

export interface ApplyCtx { org: string; siteId: string; siteCode: string; edgeId: string }

export async function applyTemplate(
  tpl: SourceTemplate, ctx: ApplyCtx,
  onStep: (i: number, status: StepStatus, err?: unknown) => void,
): Promise<{ plan: PlanStep[]; failedAt: number | null; error?: unknown }> {
  const plan = templatePlan(tpl, ctx.siteCode);
  let sourceId = '';
  let tagIds: Map<string, string> | null = null;
  for (let i = 0; i < plan.length; i++) {
    const step = plan[i];
    onStep(i, 'running');
    try {
      if (step.kind === 'source') {
        sourceId = (await dsApi.createSource(ctx.org, ctx.edgeId, step.body)).source.id;
      } else if (step.kind === 'tags') {
        await dsApi.bulkTags(ctx.org, ctx.edgeId, sourceId, step.csv);
      } else if (step.kind === 'dashboard') {
        const d = DASH_TEMPLATES.find((x) => x.id === step.templateId);
        if (!d) throw new Error(`dashboard template ${step.templateId} not found`);
        const widgets = d.build().map((w) => ({ ...w, tags: w.tags.map((n) => remapDashboardTag(n, step.siteCode)) }));
        await dashboardApi.create(ctx.org, {
          id: newId(), title: 'Factory I/O - Sorting', description: tpl.source.name, shared: true,
          body: { range: d.range, widgets },
        });
      } else {
        if (!tagIds) {
          const all = await adminApi.siteTags(ctx.org, ctx.siteId);
          tagIds = new Map(all.items.map((t) => [t.path, t.id]));
        }
        const tagId = tagIds.get(step.rule.path);
        if (!tagId) throw new Error(`tag ${step.rule.path} not found`);
        await adminApi.createRule(ctx.org, ctx.siteId, {
          name: step.rule.name, tag_id: tagId, kind: step.rule.kind,
          threshold: step.rule.threshold, severity: step.rule.severity,
        });
      }
      onStep(i, 'done');
    } catch (error) {
      onStep(i, 'failed', error);
      return { plan, failedAt: i, error };
    }
  }
  return { plan, failedAt: null };
}
