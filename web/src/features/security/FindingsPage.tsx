// Security › Findings — explorer (dd Vulnerabilities explorer shape): search,
// "group by" tabs, a facet sidebar, an expandable group list, and the same
// detail panel as the inbox. `?rule=<id>` pre-filters to one rule (linked from
// the overview). Findings are failing (rule, resource) pairs — see posture.ts.

import { Fragment, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { PageBar } from '../../shared/ui/Page';
import { EmptyState, Notice, SkeletonRows } from '../../shared/ui/Feedback';
import { DdIcon } from '../../shared/ui/DdIcon';
import { Icon } from '../../shared/ui/Icon';
import { FacetSidebar, passesFacets, toggleFacet, type FacetDef, type FacetSel } from '../../shared/ui/Facets';
import { findingsOf, RULE_SEVERITIES, SEV_RANK, usePosture, type Finding } from './posture';
import { FindingPanel, ResourceChip, RISK_OF, RiskTag, SevChip, useSecurityTabs } from './ui';
import './i18n';

type Group = 'rule' | 'resource' | 'none';
const KINDS = ['api_key', 'edge', 'member', 'org'] as const;
const CONTROLS = ['access', 'credentials', 'edge', 'monitoring'] as const;

export function FindingsPage() {
  const { t } = useTranslation();
  const tabs = useSecurityTabs();
  const p = usePosture();
  const [params, setParams] = useSearchParams();
  const ruleParam = params.get('rule');
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<Group>('rule');
  const [sel, setSel] = useState<FacetSel>({});
  const [hide, setHide] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Finding | null>(null);

  const all = useMemo(() => findingsOf(p.rules).sort((a, b) => SEV_RANK(a.rule.severity) - SEV_RANK(b.rule.severity)), [p.rules]);
  const pick = (f: Finding) => (facet: string): string => {
    switch (facet) {
      case 'severity': return f.rule.severity;
      case 'kind': return f.resource.kind;
      case 'control': return f.rule.control;
      case 'risk': return RISK_OF[f.rule.control];
      default: return '';
    }
  };
  const text = (f: Finding) => `${t(`sec.rules.${f.rule.title}`)} ${f.resource.name} ${f.rule.ref} ${f.rule.id}`.toLowerCase();
  const base = all.filter((f) => (!ruleParam || f.rule.id === ruleParam) && q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => text(f).includes(w)));
  const rows = base.filter((f) => passesFacets(sel, pick(f)));
  const count = (facet: string, v: string) => base.filter((f) => passesFacets(sel, pick(f), facet) && pick(f)(facet) === v).length;

  const facets: FacetDef[] = [
    { id: 'severity', title: t('sec.fSeverity'), values: RULE_SEVERITIES.map((s) => ({ value: s, label: <SevChip severity={s} />, count: count('severity', s) })) },
    { id: 'kind', title: t('sec.fKind'), values: KINDS.map((k) => ({ value: k, label: t(`sec.kind.${k}`), count: count('kind', k) })) },
    { id: 'control', title: t('sec.fControl'), values: CONTROLS.map((c) => ({ value: c, label: t(`sec.control.${c}`), count: count('control', c) })) },
    { id: 'risk', title: t('sec.fRisk'), closed: true, values: ['credential', 'exposure', 'drift', 'visibility'].map((r) => ({ value: r, label: t(`sec.risk.${r}`), count: count('risk', r) })) },
  ];

  const groups = useMemo(() => {
    if (group === 'none') return rows.map((f) => ({ key: f.id, head: f, items: [f] }));
    const m = new Map<string, Finding[]>();
    for (const f of rows) {
      const k = group === 'rule' ? f.rule.id : f.resource.id;
      m.set(k, [...(m.get(k) ?? []), f]);
    }
    return [...m.entries()].map(([key, items]) => ({ key, head: items[0], items }));
  }, [rows, group]);

  const siblings = picked ? picked.rule.failed.filter((r) => r.id !== picked.resource.id) : [];
  const others = picked ? all.filter((f) => f.resource.id === picked.resource.id && f.rule.id !== picked.rule.id).length : 0;
  const toggleOpen = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <>
      <PageBar icon="security-monitoring" title={t('sec.title')} tabs={tabs} />
      <div className="space-y-3 p-4 pb-0">
        {!p.admin && <Notice>{t('sec.needAdmin')}</Notice>}
        <div className="flex items-center gap-2 rounded-[5px] border border-line bg-white px-3">
          <Icon name="search" size={13} className="text-ink-35" />
          <input className="h-9 min-w-0 flex-1 bg-transparent font-mono text-[13px] outline-none placeholder:font-sans" placeholder={t('sec.search')} aria-label={t('sec.search')} value={q} onChange={(e) => setQ(e.target.value)} />
          {ruleParam && (
            <button type="button" className="inline-flex h-6 items-center gap-1 rounded bg-info-soft px-2 font-mono text-[12px]" onClick={() => setParams({}, { replace: true })}>
              rule:{ruleParam} <DdIcon name="cancel" size={10} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 text-[13px] text-ink-68">
          <span>{t('sec.groupBy')}</span>
          <div role="tablist" aria-label={t('sec.groupBy')} className="inline-flex overflow-hidden rounded border border-line-hard bg-white">
            {([['rule', 'sec.gRule'], ['resource', 'sec.gResource'], ['none', 'sec.gNone']] as const).map(([v, k]) => (
              <button
                key={v} type="button" role="tab" aria-selected={group === v}
                className={`h-7 px-3 text-[13px] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue ${group === v ? 'bg-blue font-semibold text-white' : 'hover:bg-subtle'}`}
                onClick={() => setGroup(v)}
              >{t(k)}</button>
            ))}
          </div>
        </div>
      </div>
      <div className={`grid pt-3 ${hide ? '' : 'md:grid-cols-[260px_minmax(0,1fr)]'}`}>
        {!hide && (
          <FacetSidebar
            className="hidden border-b border-line bg-white p-3 md:block md:border-b-0 md:border-r"
            facets={facets} sel={sel} onToggle={(f, v) => setSel((s) => toggleFacet(s, f, v))} onClear={() => setSel({})}
            viewMore={t('sec.viewMore')} clearLabel={t('sec.clear')}
          />
        )}
        <div className="min-w-0 p-4 pt-0">
          <div className="flex h-9 items-center gap-3 text-[13px]">
            <button type="button" className="flex items-center gap-1 text-blue hover:underline focus-visible:outline-2 focus-visible:outline-blue" onClick={() => setHide((h) => !h)}>
              <DdIcon name="filter" size={13} /> {hide ? t('sec.showControls') : t('sec.hideControls')}
            </button>
            <span className="font-semibold">{t('sec.groupsFound', { count: groups.length })}</span>
          </div>
          {p.loading ? <SkeletonRows rows={6} h={44} /> : groups.length === 0 ? (
            <EmptyState title={all.length === 0 ? t('sec.allPass') : t('sec.noFindings')} icon={all.length === 0 ? 'check' : 'search'} />
          ) : (
            <div className="overflow-x-auto rounded-[5px] border border-line bg-white shadow-card">
              <table className="w-full min-w-[640px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left">
                    <th className="w-8" /><th scope="col" className="overline h-8 px-2">{t('sec.colSeverity')}</th><th scope="col" className="overline h-8 px-2">{t('sec.colIssue')}</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => {
                    const expandable = group !== 'none' && g.items.length > 0;
                    const isOpen = open.has(g.key);
                    return (
                      <Fragment key={g.key}>
                        <tr
                          tabIndex={0} className="cursor-pointer border-b border-line hover:bg-info-soft focus-visible:bg-info-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue"
                          onClick={() => (expandable ? toggleOpen(g.key) : setPicked(g.head))}
                          onKeyDown={(e) => { if (e.key === 'Enter') { if (expandable) toggleOpen(g.key); else setPicked(g.head); } }}
                          aria-expanded={expandable ? isOpen : undefined}
                        >
                          <td className="px-2 text-ink-68">{expandable && <DdIcon name={isOpen ? 'caret-down' : 'caret-right'} size={13} />}</td>
                          <td className="w-24 px-2 py-3 align-top"><SevChip severity={g.head.rule.severity} /></td>
                          <td className="px-2 py-2.5">
                            <p className="font-semibold">{group === 'resource' ? g.head.resource.name : t(`sec.rules.${g.head.rule.title}`)}</p>
                            <p className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ink-68">
                              {group === 'resource' ? <ResourceChip r={g.head.resource} /> : <span className="font-mono">{g.head.rule.ref}</span>}
                              <RiskTag control={g.head.rule.control} />
                              {group !== 'none' && <span>{t('sec.affected', { count: g.items.length })}</span>}
                            </p>
                          </td>
                        </tr>
                        {isOpen && g.items.map((f) => (
                          <tr key={f.id} tabIndex={0} className="cursor-pointer border-b border-line bg-[#f9fafc] hover:bg-info-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue" onClick={() => setPicked(f)} onKeyDown={(e) => { if (e.key === 'Enter') setPicked(f); }}>
                            <td />
                            <td className="px-2 py-2"><SevChip severity={f.rule.severity} /></td>
                            <td className="px-2 py-2">{group === 'resource' ? t(`sec.rules.${f.rule.title}`) : <ResourceChip r={f.resource} />}</td>
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      {picked && <FindingPanel finding={picked} siblings={siblings} others={others} onClose={() => setPicked(null)} />}
    </>
  );
}
