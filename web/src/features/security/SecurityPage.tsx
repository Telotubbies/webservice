// Security overview (dd Cloud Security › Overview): posture score, the three
// worst high-severity rules, a severity breakdown, then one collapsible
// section per control family listing each rule with its passed resources.
// All numbers are computed from real org data (see posture.ts).

import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { PageBar } from '../../shared/ui/Page';
import { DdIcon } from '../../shared/ui/DdIcon';
import { EmptyState, Notice, SkeletonRows } from '../../shared/ui/Feedback';
import { RULE_SEVERITIES, usePosture, type RuleSeverity, type SecRule } from './posture';
import { SEV_BAR, SevChip, useSecurityTabs } from './ui';
import './i18n';

const CONTROLS: SecRule['control'][] = ['access', 'credentials', 'edge', 'monitoring'];

function scoreTone(p: number) {
  return p >= 80 ? 'text-[#1c7a4f]' : p >= 50 ? 'text-[#b86e00]' : 'text-[#c6283c]';
}
const Mark = ({ ok }: { ok: boolean }) => (
  <span aria-label={ok ? 'pass' : 'fail'} className={`inline-grid h-5 w-5 shrink-0 place-items-center rounded-full text-white ${ok ? 'bg-[#1c9a67]' : 'bg-[#e5304f]'}`}>
    <DdIcon name={ok ? 'check' : 'cancel'} size={11} />
  </span>
);

export function SecurityPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const tabs = useSecurityTabs();
  const p = usePosture();
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const maxFail = Math.max(1, ...p.topFailures.map((r) => r.failed.length));

  return (
    <>
      <PageBar icon="security-monitoring" title={t('sec.title')} tabs={tabs} />
      <div className="space-y-4 p-4">
        {!p.admin && <Notice>{t('sec.needAdmin')}</Notice>}
        {p.loading ? <SkeletonRows rows={5} h={36} /> : p.rules.length === 0 ? (
          <EmptyState title={t('sec.empty')} icon="shield" />
        ) : (
          <>
            <section className="grid gap-6 rounded-[5px] border border-line bg-white p-4 shadow-card lg:grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)_minmax(0,2fr)]">
              <div>
                <p className="text-[13px] font-semibold text-ink-68">{t('sec.frameworkRef')}</p>
                <div className="mt-2 flex items-center gap-4">
                  <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-blue text-white"><DdIcon name="security-monitoring" size={26} /></span>
                  <div>
                    <p className="text-[13px] font-semibold">{t('sec.score')}</p>
                    <p className={`font-mono text-[44px] font-bold leading-none tabular-nums ${scoreTone(p.score ?? 0)}`}>{p.score}<span className="text-[22px]">%</span></p>
                  </div>
                </div>
              </div>
              <div className="min-w-0">
                <h2 className="text-[14px] font-semibold">{t('sec.topFailures')}</h2>
                {p.topFailures.length === 0 ? <p className="mt-3 text-[13px] text-ink-68">{t('sec.allPass')}</p> : (
                  <ul className="mt-2 space-y-1.5">
                    {p.topFailures.map((r) => (
                      <li key={r.id} className="flex items-center gap-2 text-[13px]">
                        <span className="w-8 shrink-0 text-right font-mono tabular-nums">{r.failed.length}</span>
                        <span className="relative min-w-0 flex-1 overflow-hidden rounded-[3px] px-2 py-0.5">
                          <span aria-hidden className={`absolute inset-y-0 left-0 ${SEV_BAR[r.severity]}`} style={{ width: `${(r.failed.length / maxFail) * 100}%` }} />
                          <span className="relative block truncate">{t(`sec.rules.${r.title}`)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <NavLink to="/security/issues" className="mt-3 inline-flex items-center gap-1 text-[13px] text-blue hover:underline">{t('sec.explore')} <DdIcon name="external-link" size={12} /></NavLink>
              </div>
              <div className="min-w-0">
                <h2 className="text-[14px] font-semibold">{t('sec.breakdown')}</h2>
                <ul className="mt-2 grid grid-cols-5 gap-1.5 text-center">
                  {RULE_SEVERITIES.map((s: RuleSeverity) => {
                    const b = p.bySeverity[s];
                    const pct = b.total ? Math.round((b.passed / b.total) * 100) : null;
                    return (
                      <li key={s} className="min-w-0">
                        <SevChip severity={s} className="w-full" />
                        <p className="mt-1.5 flex items-center justify-center gap-1 text-[13px]">
                          {pct != null ? <><Mark ok={pct === 100} />{pct}%</> : '—'}
                        </p>
                        <p className="font-mono text-[12px] text-ink-46">{b.passed}/{b.total}</p>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>

            {CONTROLS.map((c) => {
              const rules = p.rules.filter((r) => r.control === c);
              if (!rules.length) return null;
              const passed = rules.filter((r) => r.failed.length === 0).length;
              const pct = Math.round((passed / rules.length) * 100);
              const open = !closed.has(c);
              return (
                <section key={c} className="rounded-[5px] border border-line bg-white shadow-card">
                  <button
                    type="button" aria-expanded={open}
                    className="flex min-h-12 w-full items-center gap-2 px-4 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue"
                    onClick={() => setClosed((s) => { const n = new Set(s); if (n.has(c)) n.delete(c); else n.add(c); return n; })}
                  >
                    <DdIcon name={open ? 'caret-down' : 'caret-right'} size={14} className="text-ink-68" />
                    <span className="flex-1 text-[16px]">{t(`sec.control.${c}`)}</span>
                    <span className="text-[13px] text-ink-68">{t('sec.passedRules', { count: rules.length, passed, total: rules.length })}</span>
                    <span className="flex items-center gap-1.5 border-l border-line pl-3 text-[13px] text-ink-68">{pct}% <Mark ok={pct === 100} /></span>
                  </button>
                  {open && (
                    <div className="overflow-x-auto border-t border-line">
                      <table className="w-full min-w-[640px] border-collapse text-[13px]">
                        <thead>
                          <tr className="text-left">
                            <th scope="col" className="h-9 px-4 font-semibold">{t('sec.colControl')}</th>
                            <th scope="col" className="h-9 px-2 font-semibold">{t('sec.colRule')}</th>
                            <th scope="col" className="h-9 px-4 text-right font-semibold">{t('sec.colPassed')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rules.map((r) => {
                            const total = r.passed.length + r.failed.length;
                            const ok = r.failed.length === 0;
                            return (
                              <tr
                                key={r.id} tabIndex={0}
                                className="h-10 cursor-pointer hover:bg-info-soft focus-visible:bg-info-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue"
                                onClick={() => navigate(`/security/findings?rule=${r.id}`)}
                                onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/security/findings?rule=${r.id}`); }}
                              >
                                <td className="whitespace-nowrap px-4 font-semibold">{r.ref}</td>
                                <td className="px-2"><span className="flex items-center gap-3"><SevChip severity={r.severity} className="w-[72px]" /><span>{t(`sec.rules.${r.title}`)}</span></span></td>
                                <td className="whitespace-nowrap px-4 text-right">
                                  <span className="inline-flex items-center gap-2 font-mono tabular-nums">
                                    {r.passed.length}/{total} <span className="text-ink-46">({Math.round((r.passed.length / total) * 100)}%)</span> <Mark ok={ok} />
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              );
            })}
          </>
        )}
      </div>
    </>
  );
}
