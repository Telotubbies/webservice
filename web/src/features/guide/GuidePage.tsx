// User guide (/guide) — the in-app manual, EN/TH, filterable by role.
// Read-mode page: a sticky contents rail, a 72ch reading column, numbered
// steps with the on-screen labels in bold, and "go there" links to the real
// pages. The status section renders the live badge components themselves, so
// the legend can never drift from what the console draws.

import { Fragment, useEffect, type ReactNode } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { PageBar } from '../../shared/ui/Page';
import { Segmented } from '../../shared/ui/Segmented';
import { SeverityBadge, AlarmStateBadge, StatePill, QualityMark } from '../../shared/ui/Status';
import { guideFor, type GuideSection, type Part, type Role } from './content';
import './i18n';

const PARTS: Part[] = ['start', 'operator', 'engineer', 'admin', 'reference'];
type Filter = Role | 'all';

/** "**label**" → <b>label</b>; everything else stays plain text. */
function rich(s: string): ReactNode {
  return s.split('**').map((chunk, i) => (i % 2 ? <b key={i} className="font-semibold text-ink">{chunk}</b> : <Fragment key={i}>{chunk}</Fragment>));
}

const shows = (s: GuideSection, f: Filter) => f === 'all' || s.roles === 'all' || s.roles.includes(f);

function Legend() {
  const { t } = useTranslation();
  const row = 'flex flex-wrap items-center gap-2';
  return (
    <div className="mt-4 grid gap-3 rounded-[5px] border border-line bg-paper p-3 text-[12px] sm:grid-cols-2">
      <div><p className="mb-1.5 text-ink-46">{t('manual.legendPriority')}</p>
        <div className={row}><SeverityBadge severity="critical" /><SeverityBadge severity="warning" /><SeverityBadge severity="info" /></div></div>
      <div><p className="mb-1.5 text-ink-46">{t('manual.legendLifecycle')}</p>
        <div className={row}><AlarmStateBadge state="active" /><AlarmStateBadge state="acked" /><AlarmStateBadge state="cleared" /></div></div>
      <div><p className="mb-1.5 text-ink-46">{t('manual.legendEquipment')}</p>
        <div className={row}><StatePill state="running" /><StatePill state="stopped" /></div></div>
      <div><p className="mb-1.5 text-ink-46">{t('manual.legendData')}</p>
        <div className={row}><QualityMark q="stale" /><QualityMark q="bad" /><QualityMark q="uncertain" /></div></div>
    </div>
  );
}

function Section({ s }: { s: GuideSection }) {
  const { t } = useTranslation();
  const who = s.roles === 'all' ? t('manual.everyone') : s.roles.map((r) => t(`manual.role.${r}`)).join(' · ');
  const glossary = s.id === 'glossary';
  return (
    <section id={s.id} aria-labelledby={`${s.id}-h`} className="scroll-mt-28 border-b border-line py-8 last:border-0">
      <p className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-46">{t(`manual.part.${s.part}`)} · {who}</p>
      <h2 id={`${s.id}-h`} className="mt-1 text-[20px] font-semibold leading-snug text-ink">{s.title}</h2>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-68">{s.summary}</p>
      {s.id === 'status' && <Legend />}
      {glossary ? (
        <dl className="mt-4 divide-y divide-line rounded-[5px] border border-line bg-paper">
          {s.steps.map((g) => {
            const [term, def] = g.split(' — ');
            return (
              <div key={term} className="grid gap-1 px-3 py-2.5 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4">
                <dt className="text-[13px] font-semibold text-ink">{term}</dt>
                <dd className="text-[14px] leading-relaxed text-ink-68">{def}</dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <ol className="mt-4 flex flex-col gap-3">
          {s.steps.map((step, i) => (
            <li key={i} className="grid grid-cols-[26px_minmax(0,1fr)] gap-2">
              <span aria-hidden className="mt-px grid h-[22px] w-[22px] place-items-center rounded-full border border-line-hard bg-paper font-mono text-[11px] font-semibold text-ink-68">{i + 1}</span>
              <p className="text-[14px] leading-relaxed text-ink-68">{rich(step)}</p>
            </li>
          ))}
        </ol>
      )}
      {s.note && (
        <aside className="mt-4 border-l-2 border-line-hard bg-subtle px-3 py-2.5 text-[13px] leading-relaxed text-ink-68">
          <span className="font-semibold text-ink">{t('manual.note')} </span>{s.note}
        </aside>
      )}
      {s.links.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {s.links.map((l) => (
            <Link key={l.to + l.label} to={l.to} className="btn btn-ghost btn-sm">{l.label} <span aria-hidden>→</span></Link>
          ))}
        </div>
      )}
    </section>
  );
}

export function GuidePage() {
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const { hash } = useLocation();
  const raw = params.get('role');
  const filter: Filter = raw === 'operator' || raw === 'engineer' || raw === 'admin' ? raw : 'all';
  const sections = guideFor(i18n.language).filter((s) => shows(s, filter));

  // deep links (/guide#alarms) land on the section once it has rendered
  useEffect(() => {
    if (hash) document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
  }, [hash]);

  return (
    <>
      <PageBar title={t('manual.title')} lede={t('manual.lede')} />
      <div className="mx-auto grid w-full max-w-[1120px] gap-x-10 px-4 py-6 lg:grid-cols-[230px_minmax(0,1fr)]">
        <nav aria-label={t('manual.contents')} className="mb-6 lg:sticky lg:top-24 lg:mb-0 lg:max-h-[calc(100svh-120px)] lg:self-start lg:overflow-y-auto">
          <ol className="hidden flex-col gap-4 lg:flex">
            {PARTS.map((p) => {
              const items = sections.filter((s) => s.part === p);
              if (!items.length) return null;
              return (
                <li key={p}>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-[.08em] text-ink-46">{t(`manual.part.${p}`)}</p>
                  <ul className="flex flex-col">
                    {items.map((s) => (
                      <li key={s.id}>
                        <a href={`#${s.id}`} aria-current={hash === `#${s.id}` ? 'location' : undefined}
                          className="block rounded px-2 py-1 text-[13px] text-ink-68 hover:bg-paper hover:text-ink aria-[current=location]:bg-paper aria-[current=location]:font-semibold aria-[current=location]:text-ink focus-visible:outline-2 focus-visible:outline-blue">
                          {s.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ol>
        </nav>
        <article className="min-w-0 max-w-[72ch]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line pb-4">
            <span className="text-[12px] text-ink-68">{t('manual.showFor')}</span>
            <Segmented<Filter> label={t('manual.showFor')} value={filter}
              onChange={(v) => setParams(v === 'all' ? {} : { role: v }, { replace: true })}
              options={(['all', 'operator', 'engineer', 'admin'] as const).map((v) => ({ value: v, label: v === 'all' ? t('manual.all') : t(`manual.role.${v}`) }))} />
          </div>
          {sections.map((s) => <Section key={s.id} s={s} />)}
          <p className="mt-6 text-[12px] text-ink-46">{t('manual.footer')}</p>
        </article>
      </div>
    </>
  );
}
