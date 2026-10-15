// F22 — Edge fleet table (infrastructure-inventory pattern). One row per
// edge gateway: state (glyph + word), heartbeat age, clock sync, store-and-
// forward buffer, PLC adapter and credential health. Member-read v2 data
// only, so it renders for every role without a 4xx.

import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useNow } from '../../lib/hooks';
import { fmtAge } from '../../lib/format';
import { EmptyState, ErrorState, Notice, SkeletonRows } from '../../shared/ui/Feedback';
import {
  EDGE_GLYPH, EDGE_PILL, edgeState, shortId, useEdgeFleet, type EdgeState, type FleetEdge,
} from './fleet';
import './fleetI18n';

/** backlog above this is worth a technician's look (UI policy, not a limit) */
const BUFFER_WARN = 100;

export function EdgeStatePill({ state }: { state: EdgeState }) {
  const { t } = useTranslation();
  return (
    <span className={`inline-flex h-5 items-center gap-1 whitespace-nowrap rounded px-1.5 text-[11px] font-semibold ${EDGE_PILL[state]}`} data-state={state}>
      <span aria-hidden className="text-[9px] leading-none">{EDGE_GLYPH[state]}</span>
      {t(`fleet.state.${state}`)}
    </span>
  );
}

export function ClockCell({ ok }: { ok: boolean | null }) {
  const { t } = useTranslation();
  if (ok == null) return <span className="text-ink-46">{t('fleet.clockNone')}</span>;
  return ok
    ? <span className="text-ink-68"><span aria-hidden className="text-[var(--color-ok)]">● </span>{t('fleet.clockOk')}</span>
    : <span className="font-semibold text-[var(--color-caution-ink)]"><span aria-hidden>◆ </span>{t('fleet.clockBad')}</span>;
}

export function BufferCell({ depth }: { depth: number | null }) {
  const { t } = useTranslation();
  if (depth == null) return <span className="text-ink-46">{t('fleet.bufferNone')}</span>;
  if (depth > BUFFER_WARN) {
    return <span className="font-semibold text-[var(--color-caution-ink)]"><span aria-hidden>◆ </span>{t('fleet.bufferHigh', { count: depth })}</span>;
  }
  return <span className="font-mono tabular-nums text-ink-68">{depth === 0 ? '0' : t('fleet.bufferQueued', { count: depth })}</span>;
}

function Row({ e, now }: { e: FleetEdge; now: number }) {
  const { t } = useTranslation();
  const st = edgeState(e, now);
  return (
    <tr data-edge={e.id}>
      <td className="max-w-[240px]">
        <div className="truncate font-semibold text-ink" title={e.name}>{e.name}</div>
        <div className="font-mono text-[11px] text-ink-46">…{shortId(e.id)}</div>
      </td>
      <td><EdgeStatePill state={st} /></td>
      <td className="whitespace-nowrap font-mono text-[12px] text-ink-68" title={e.lastHb ?? undefined}>
        {e.lastHb ? fmtAge(e.lastHb, now) : t('fleet.noHb')}
      </td>
      <td className="whitespace-nowrap text-[12px]"><ClockCell ok={e.clockOk} /></td>
      <td className="whitespace-nowrap text-[12px]"><BufferCell depth={e.bufferDepth} /></td>
      <td className="whitespace-nowrap text-[12px]">
        {e.adapter ? <span className="rounded bg-subtle px-1.5 py-0.5 font-mono text-[11px] text-ink-68">{e.adapter}</span>
          : <span className="text-ink-46">{t('fleet.adapterNone')}</span>}
      </td>
      <td className="whitespace-nowrap text-[12px]">
        <span className="font-mono text-ink-68">{e.credVersion != null ? t('fleet.credVersion', { v: e.credVersion }) : '—'}</span>
        {e.needsRotation && (
          <span className="ml-2 inline-flex items-center gap-1 font-semibold text-[var(--color-caution-ink)]" title={t('fleet.needsRotationHelp')}>
            <span aria-hidden>◆</span>{t('fleet.needsRotation')}
          </span>
        )}
      </td>
    </tr>
  );
}

export function EdgeFleetTable() {
  const { t } = useTranslation();
  const now = useNow(5000);
  const fleet = useEdgeFleet();
  const states = fleet.edges.map((e) => edgeState(e, now));
  const n = (s: EdgeState) => states.filter((x) => x === s).length;

  const head = [t('fleet.colName'), t('fleet.colState'), t('fleet.colHb'), t('fleet.colClock'), t('fleet.colBuffer'), t('fleet.colAdapter'), t('fleet.colCred')];

  let body;
  if (fleet.loading) body = <div className="p-3"><SkeletonRows rows={2} /></div>;
  else if (fleet.error) body = <ErrorState compact onRetry={fleet.refetch} />;
  else if (!fleet.siteId) body = <EmptyState compact icon="info" title={t('fleet.scopeNone')} />;
  else if (fleet.edges.length === 0) {
    body = (
      <EmptyState compact icon="info" title={t('fleet.empty')} body={t('fleet.emptyBody')}
        action={<Link className="btn btn-sm" to="/infrastructure">{t('fleet.openInfra')}</Link>} />
    );
  } else {
    body = (
      <>
        {fleet.healthError && <div className="px-3 pt-3"><Notice tone="warn">{t('fleet.healthErr')}</Notice></div>}
        <div className="overflow-x-auto">
          <table className="edge-fleet w-full min-w-[760px] border-collapse text-[13px]">
            <caption className="sr-only">{t('fleet.title')}</caption>
            <thead>
              <tr className="border-b border-line text-left">
                {head.map((h) => (
                  <th key={h} scope="col" className="h-7 px-3 text-[11px] font-semibold text-ink-68">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="[&>tr]:h-11 [&>tr]:border-b [&>tr]:border-line [&>tr:last-child]:border-0 [&>tr:hover]:bg-info-soft [&_td]:px-3">
              {fleet.edges.map((e) => <Row key={e.id} e={e} now={now} />)}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-3 py-1.5 text-[11px] text-ink-46">{t('fleet.stateHelp')}</p>
      </>
    );
  }

  return (
    <section aria-labelledby="edge-fleet-title" className="rounded-[5px] border border-line bg-white shadow-card">
      <header className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-1.5">
        <h2 id="edge-fleet-title" className="text-[13px] font-semibold">{t('fleet.title')}</h2>
        {fleet.edges.length > 0 && (
          <span className="text-[12px] text-ink-68">
            {t('fleet.summary', { online: n('online'), late: n('stale'), offline: n('offline') })}
          </span>
        )}
        <span className="flex-1" />
        {fleet.updatedAt > 0 && (
          <span className="text-[11px] text-ink-46">{t('fleet.updated', { age: fmtAge(new Date(fleet.updatedAt).toISOString(), now) })}</span>
        )}
      </header>
      {body}
    </section>
  );
}
