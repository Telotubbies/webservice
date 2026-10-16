// Shared security UI: severity chip, tab set, resource chip, issue side panel.
import { useEffect, useRef, type ReactNode } from 'react';
import { NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';
import { DdIcon } from '../../shared/ui/DdIcon';
import type { DdIconName } from '../../shared/ui/ddicons';
import type { PageTab } from '../../shared/ui/Page';
import type { Finding, Resource, RuleSeverity, SecRule } from './posture';
import './i18n';

/** Chip colours follow the dd severity ramp (dark red → red → orange → gold → grey). */
export const SEV_CHIP: Record<RuleSeverity, string> = {
  critical: 'bg-sev-critical text-white', high: 'bg-sev-high text-white', medium: 'bg-sev-medium text-sev-ink',
  low: 'bg-sev-low text-sev-ink', info: 'bg-sev-info text-white',
};
export const SEV_BAR: Record<RuleSeverity, string> = {
  critical: 'bg-sev-critical-soft', high: 'bg-sev-high-soft', medium: 'bg-sev-medium-soft', low: 'bg-sev-low-soft', info: 'bg-sev-info-soft',
};

export function SevChip({ severity, className = '' }: { severity: RuleSeverity; className?: string }) {
  const { t } = useTranslation();
  return <span className={`inline-flex h-5 min-w-14 items-center justify-center rounded-[3px] px-1.5 text-[11px] font-bold uppercase tracking-wide ${SEV_CHIP[severity]} ${className}`}>{t(`sec.sev.${severity}`)}</span>;
}

export function useSecurityTabs(): PageTab[] {
  const { t } = useTranslation();
  return [
    { to: '/security', label: t('sec.posture'), end: true },
    { to: '/security/issues', label: t('sec.issues') },
    { to: '/security/findings', label: t('sec.findings') },
    { to: '/security/api', label: t('sec.api') },
    { to: '/security/access', label: t('sec.access') },
  ];
}

export const KIND_ICON: Record<Resource['kind'], DdIconName> = { api_key: 'key', edge: 'server', member: 'user', org: 'organization' };
export const RISK_OF: Record<SecRule['control'], 'credential' | 'exposure' | 'drift' | 'visibility'> = {
  credentials: 'credential', access: 'exposure', edge: 'drift', monitoring: 'visibility',
};
const RISK_ICON: Record<string, DdIconName> = { credential: 'key', exposure: 'shield', drift: 'refresh', visibility: 'eye' };

export function RiskTag({ control }: { control: SecRule['control'] }) {
  const { t } = useTranslation();
  const r = RISK_OF[control];
  return (
    <span className="inline-flex h-5 items-center gap-1 rounded-[3px] bg-[#fdeaec] px-1.5 text-[11px] font-bold uppercase tracking-wide text-[#c6283c]">
      <DdIcon name={RISK_ICON[r]} size={11} />{t(`sec.risk.${r}`)}
    </span>
  );
}

export function ResourceChip({ r }: { r: Resource }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded border border-line bg-white px-1.5 py-0.5 text-[12px]">
      <DdIcon name={KIND_ICON[r.kind]} size={12} className="shrink-0 text-[#e08a00]" />
      <span className="shrink-0 text-ink-46">{t(`sec.kind.${r.kind}`)}</span>
      <span className="truncate font-mono">{r.name}</span>
    </span>
  );
}

function Panel({ title, sub, children, className = '' }: { title: string; sub: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-line bg-white/60 p-3 ${className}`}>
      <p className="text-center text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-46">{title}</p>
      <p className="mb-3 text-center text-[14px] font-semibold">{sub}</p>
      {children}
    </section>
  );
}

/** Right-hand detail drawer — dd "attack path" / finding side panel. */
export function FindingPanel({ finding, siblings, others, onClose }: {
  finding: Finding; siblings: Resource[]; others: number; onClose: () => void;
}) {
  const { t } = useTranslation();
  const { rule, resource } = finding;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose, finding.id]);
  const bar = SEV_CHIP[rule.severity].split(' ')[0];
  const path = [t('sec.kind.org'), t(`sec.kind.${resource.kind}`), resource.name];
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} aria-hidden />
      <div
        ref={ref} role="dialog" aria-modal="true" aria-label={t(`sec.rules.${rule.title}`)} tabIndex={-1}
        className="fixed inset-y-0 right-0 z-50 flex w-[min(760px,100vw)] flex-col overflow-y-auto bg-white shadow-flyout outline-none"
      >
        <div className="flex h-9 shrink-0 items-center justify-between px-4 text-[13px]">
          <button type="button" className="flex items-center gap-1 text-blue hover:underline focus-visible:outline-2 focus-visible:outline-blue" onClick={onClose}>
            <DdIcon name="arrow-right" size={13} className="rotate-180" /> {t(`sec.rules.${rule.title}`)}
          </button>
          <button type="button" className="text-blue hover:underline focus-visible:outline-2 focus-visible:outline-blue" onClick={onClose}>{t('sec.closeAll')}</button>
        </div>
        <div className={`h-1 shrink-0 ${bar}`} />
        <header className="space-y-2 px-5 pb-3 pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2 text-[15px] font-semibold"><DdIcon name="service-map" size={16} />{t('sec.exposure')}</div>
            <button type="button" aria-label={t('sec.close')} className="rounded p-1 text-ink-68 hover:bg-subtle focus-visible:outline-2 focus-visible:outline-blue" onClick={onClose}><DdIcon name="cancel" size={16} /></button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <SevChip severity={rule.severity} />
            <h2 className="text-[20px] font-semibold leading-7">{t(`sec.rules.${rule.title}`)}</h2>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-68">
            <span>{t('sec.resource')}: <ResourceChip r={resource} /></span>
            <RiskTag control={rule.control} />
            <span className="font-mono text-[12px]">{rule.ref}</span>
          </div>
        </header>
        <div className="flex flex-wrap items-center gap-2 border-y border-line px-5 py-2.5">
          <span className="inline-flex h-7 items-center rounded border border-blue px-2 text-[12px] font-bold uppercase text-blue">{t('sec.open')}</span>
          <NavLink to={resource.to} className="btn btn-ghost btn-sm ml-auto"><DdIcon name="external-link" size={12} /> {t('sec.remediate')}</NavLink>
        </div>
        <div className="grid flex-1 content-start gap-3 bg-[#f6f7fb] p-4 md:grid-cols-2">
          <Panel title={t('sec.accessPath')} sub={t('sec.accessPathBody', { kind: t(`sec.kind.${resource.kind}`) })}>
            <ol>
              {path.map((label, i) => (
                <li key={i}>
                  <div className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-[13px] shadow-card">
                    <DdIcon name={i === 0 ? 'organization' : KIND_ICON[resource.kind]} size={16} className="text-[#e08a00]" />
                    <span className="truncate font-semibold">{label}</span>
                  </div>
                  {i < path.length - 1 && <div aria-hidden className="mx-auto h-3 w-px bg-ink-35" />}
                </li>
              ))}
            </ol>
          </Panel>
          <Panel title={t('sec.selectedRule')} sub={t(`sec.rules.${rule.title}`)}>
            <div className="rounded-lg border-2 border-[#f4a62a] bg-white p-3">
              <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-[#b86e00]"><DdIcon name="attention-circled" size={13} />{t(`sec.sev.${rule.severity}`)} · {t('sec.failed')}</p>
              <p className="text-[13px]">{t(`sec.fix.${rule.title}`)}</p>
              <NavLink to={resource.to} className="btn btn-sm mt-3">{t('sec.remediate')}</NavLink>
            </div>
            {others > 0 && <p className="mt-3 text-center text-[12px] text-ink-68">{t('sec.otherFindings', { count: others })}</p>}
          </Panel>
          <Panel title={t('sec.blast')} sub={t('sec.blastBody')} className="md:col-span-2">
            {siblings.length === 0 ? <p className="text-[13px] text-ink-46">{t('sec.blastNone')}</p> : (
              <ul className="flex flex-wrap gap-1.5">{siblings.slice(0, 24).map((s) => <li key={s.id}><ResourceChip r={s} /></li>)}</ul>
            )}
          </Panel>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-line px-5 py-3 text-[12px]">
          <dt className="text-ink-46">{t('sec.ruleId')}</dt><dd className="font-mono">{rule.id}</dd>
          <dt className="text-ink-46">{t('sec.ruleControl')}</dt><dd>{t(`sec.control.${rule.control}`)} · {rule.ref}</dd>
          <dt className="text-ink-46">{t('sec.ruleResources')}</dt><dd>{rule.passed.length + rule.failed.length}</dd>
        </dl>
      </div>
    </>
  );
}
