// Security › Issues — the inbox (dd "Security inbox"): every failing
// (rule, resource) pair, highest severity first. Selecting a row opens the
// detail panel with where the resource sits, the fix, and the blast radius
// (other resources failing the same rule).

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageBar } from '../../shared/ui/Page';
import { EmptyState, Notice, SkeletonRows } from '../../shared/ui/Feedback';
import { DdIcon } from '../../shared/ui/DdIcon';
import { findingsOf, SEV_RANK, usePosture, type Finding } from './posture';
import { FindingPanel, KIND_ICON, ResourceChip, RiskTag, SevChip, useSecurityTabs } from './ui';
import './i18n';

export function IssuesPage() {
  const { t } = useTranslation();
  const tabs = useSecurityTabs();
  const p = usePosture();
  const [sel, setSel] = useState<Finding | null>(null);
  const findings = useMemo(
    () => findingsOf(p.rules).sort((a, b) => SEV_RANK(a.rule.severity) - SEV_RANK(b.rule.severity) || a.resource.name.localeCompare(b.resource.name)),
    [p.rules],
  );
  const siblings = sel ? sel.rule.failed.filter((r) => r.id !== sel.resource.id) : [];
  const others = sel ? findings.filter((f) => f.resource.id === sel.resource.id && f.rule.id !== sel.rule.id).length : 0;

  return (
    <>
      <PageBar icon="security-monitoring" title={t('sec.title')} tabs={tabs} />
      <div className="space-y-3 p-4">
        {!p.admin && <Notice>{t('sec.needAdmin')}</Notice>}
        <div className="flex items-center gap-3">
          <span className="grid h-8 w-8 place-items-center rounded bg-[#ffe9cc] text-[#d26a00]"><DdIcon name="events" size={16} /></span>
          <div>
            <h2 className="text-[15px] font-semibold uppercase tracking-wide">{t('sec.inboxTitle')}</h2>
            <p className="text-[13px] text-ink-68">{t('sec.inboxBody')}</p>
          </div>
          <span className="ml-auto text-[12px] text-ink-46">{t('sec.total', { count: findings.length })}</span>
        </div>
        {p.loading ? <SkeletonRows rows={6} h={44} /> : findings.length === 0 ? (
          <EmptyState title={t('sec.allPass')} icon="check" />
        ) : (
          <div className="overflow-x-auto rounded-[5px] border border-line bg-white shadow-card">
            <table className="w-full min-w-[760px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line text-left">
                  {['colSeverity', 'colType', 'colIssue'].map((c) => <th key={c} scope="col" className="overline h-8 px-3">{t(`sec.${c}`)}</th>)}
                </tr>
              </thead>
              <tbody>
                {findings.map((f) => (
                  <tr
                    key={f.id} tabIndex={0} aria-selected={sel?.id === f.id}
                    className={`cursor-pointer border-b border-line last:border-0 hover:bg-info-soft focus-visible:bg-info-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue ${sel?.id === f.id ? 'bg-info-soft' : ''}`}
                    onClick={() => setSel(f)}
                    onKeyDown={(e) => { if (e.key === 'Enter') setSel(f); }}
                  >
                    <td className="w-28 px-3 align-top"><div className="py-3"><SevChip severity={f.rule.severity} /></div></td>
                    <td className="w-44 px-3 align-top">
                      <span className="flex items-center gap-2 py-3 text-[14px] font-medium">
                        <DdIcon name={KIND_ICON[f.resource.kind]} size={16} />{t(`sec.kind.${f.resource.kind}`)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="font-semibold">{t(`sec.rules.${f.rule.title}`)}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ink-68">
                        <ResourceChip r={f.resource} /> {t('sec.colRisks')}: <RiskTag control={f.rule.control} />
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {sel && <FindingPanel finding={sel} siblings={siblings} others={others} onClose={() => setSel(null)} />}
    </>
  );
}
