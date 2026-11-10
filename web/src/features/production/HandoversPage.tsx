import { Children, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../lib/api';
import { fmtAge, fmtDateTime } from '../../lib/format';
import { PageBar, PageBody } from '../../shared/ui/Page';
import { EmptyState, ErrorState, PermissionNotice, SkeletonRows } from '../../shared/ui/Feedback';
import { Confirm } from '../../shared/ui/Confirm';
import { canOperate } from '../../app/session';
import { useAdminOrg, useAdminSite } from '../admin/admin';
import { prodApi, type Handover, type HandoverSnapshot } from './api';
import './i18n';
import { fmtDuration, localName } from './names';

export function HandoversPage() {
  const { t } = useTranslation();
  const { orgId, orgRole, loading: orgLoading } = useAdminOrg();
  const { site, loading: siteLoading } = useAdminSite(orgId);
  if (!orgId || !site) {
    return (
      <div className="flex min-h-[calc(100svh-var(--h-topbar))] flex-col">
        <PageBody>
          {orgLoading || siteLoading
            ? <SkeletonRows rows={5} h={56} />
            : <EmptyState icon="clock" title={t('prod.hoEmpty')} body={t('prod.hoEmptyBody')} />}
        </PageBody>
      </div>
    );
  }
  return <HandoverBody key={`${orgId}/${site.id}`} orgId={orgId} siteId={site.id}
    operate={canOperate(orgRole ?? 'none')} />;
}

function HandoverBody({ orgId, siteId, operate }: { orgId: string; siteId: string; operate: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [sel, setSel] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [confirmSend, setConfirmSend] = useState(false);
  const [accepting, setAccepting] = useState<Handover | null>(null);
  const [status, setStatus] = useState('');

  const listQ = useQuery({
    queryKey: ['prod-handovers', orgId, siteId],
    queryFn: () => prodApi.handovers(orgId, siteId),
    refetchInterval: 15000,
  });
  const pendingQ = useQuery({
    queryKey: ['prod-handovers-pending', orgId, siteId],
    queryFn: () => prodApi.handoverPending(orgId, siteId),
    refetchInterval: 15000,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['prod-handovers', orgId, siteId] });
    void qc.invalidateQueries({ queryKey: ['prod-handovers-pending', orgId, siteId] });
  };
  const send = useMutation({
    mutationFn: () => prodApi.sendHandover(orgId, siteId, { note: note.trim() }),
    onSuccess: (r) => {
      qc.setQueryData(['prod-handovers', orgId, siteId], (old: { items: Handover[] } | undefined) =>
        old ? { ...old, items: [r.handover, ...old.items] } : old);
      setNote(''); setSel(r.handover.id); setStatus(t('prod.hoSent')); invalidate();
    },
  });
  const accept = useMutation({
    mutationFn: (id: string) => prodApi.acceptHandover(orgId, siteId, id),
    onSuccess: (r) => {
      qc.setQueryData(['prod-handovers', orgId, siteId], (old: { items: Handover[] } | undefined) =>
        old ? { ...old, items: old.items.map((h) => (h.id === r.handover.id ? r.handover : h)) } : old);
      setStatus(t('prod.hoAccepted')); invalidate();
    },
  });

  const items = listQ.data?.items ?? [];
  const canSign = operate && (listQ.data?.can_sign ?? false);
  const me = listQ.data?.current_user_id ?? null;
  const err = listQ.error ?? pendingQ.error;

  return (
    <div className="flex min-h-[calc(100svh-var(--h-topbar))] flex-col">
      <PageBar icon="clock" title={t('prod.hoTitle')} lede={t('prod.hoLede')} />
      <PageBody>
        <p className="sr-only" role="status" aria-live="polite">{status}</p>
        {listQ.isSuccess && !canSign && <PermissionNotice role="operator">{t('prod.hoNeedOperate')}</PermissionNotice>}
        {(send.isError || accept.isError) && (
          <p className="mb-2 text-[12px] text-[var(--color-danger)]" role="alert">
            {send.isError ? t('prod.hoSendErr') : t('prod.hoAcceptErr')}
          </p>
        )}
        {err && <ErrorState detail={err instanceof ApiError ? err.message : undefined}
          onRetry={() => { void listQ.refetch(); void pendingQ.refetch(); }} />}

        <section className="rounded-[5px] border border-line bg-paper p-3 shadow-card" aria-label={t('prod.hoPending')}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[14px] font-semibold">{t('prod.hoPending')}</h2>
            <p className="text-[11px] text-ink-46">{t('prod.hoPendingBody')}</p>
          </div>
          {pendingQ.isLoading ? <SkeletonRows rows={3} /> : pendingQ.data && (
            <SnapshotView snap={pendingQ.data.snapshot} />
          )}
          <div className="sticky bottom-0 z-10 -mx-3 -mb-3 mt-3 border-t border-line bg-paper px-3 pb-3 pt-2">
          <label className="block text-[12px] font-semibold text-ink-68" htmlFor="ho-note">
            {t('prod.hoNote')}
          </label>
          <textarea id="ho-note" className="input mt-1 w-full" rows={2} maxLength={2000}
            value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('prod.hoNotePh')} />
          <div className="mt-2 flex justify-end">
            <button type="button" className="btn btn-sm"
              disabled={!canSign || send.isPending || !pendingQ.isSuccess}
              onClick={() => setConfirmSend(true)}>
              {send.isPending ? t('prod.saving') : t('prod.hoSign')}
            </button>
          </div>
          </div>
        </section>

        {listQ.isLoading && <SkeletonRows rows={4} h={56} />}
        {!listQ.isLoading && !err && items.length === 0 && (
          <EmptyState icon="clock" title={t('prod.hoEmpty')} body={t('prod.hoEmptyBody')} />
        )}
        <ul className="mt-4 space-y-2" aria-label={t('prod.hoTitle')}>
          {items.map((h) => (
            <HandoverRow key={h.id} h={h} me={me} canSign={canSign}
              open={sel === h.id}
              onToggle={() => setSel((v) => (v === h.id ? null : h.id))}
              onAccept={() => setAccepting(h)}
              acceptPending={accept.isPending} />
          ))}
        </ul>
      </PageBody>

      {confirmSend && (
        <Confirm danger={false} title={t('prod.hoSignTitle')} body={t('prod.hoSignBody')}
          confirm={t('prod.hoSign')}
          onYes={() => { setConfirmSend(false); send.mutate(); }}
          onNo={() => setConfirmSend(false)} />
      )}
      {accepting && (
        <Confirm danger={false} title={t('prod.hoAcceptTitle')}
          body={`${t('prod.hoAcceptBody')}\n\n${t('prod.hoBy')}: ${accepting.outgoing_name} · ${fmtDateTime(accepting.outgoing_at)}${accepting.note ? `\n${t('prod.hoNote')}: ${accepting.note}` : ''}`}
          confirm={t('prod.hoAccept')}
          onYes={() => { const id = accepting.id; setAccepting(null); accept.mutate(id); }}
          onNo={() => setAccepting(null)} />
      )}
    </div>
  );
}

function HandoverRow({ h, me, canSign, open, onToggle, onAccept, acceptPending }: {
  h: Handover; me: string | null; canSign: boolean; open: boolean;
  onToggle: () => void; onAccept: () => void; acceptPending: boolean;
}) {
  const { t } = useTranslation();
  const done = h.incoming_at != null;
  const self = me != null && h.outgoing_by === me;
  const mayAccept = canSign && !done && !self;
  return (
    <li className="rounded-[5px] border border-line bg-paper shadow-card">
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="flex w-full items-center gap-2 p-3 text-left">
        <span className={`size-2 shrink-0 rounded-full ${done ? 'bg-[var(--color-ok)]' : 'bg-[var(--color-caution)]'}`} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">
            {h.outgoing_name}{h.incoming_name ? ` → ${h.incoming_name}` : ''}
          </span>
          <span className="block text-[11px] text-ink-46">
            {done ? t('prod.hoComplete') : self ? t('prod.hoSelf') : t('prod.hoAwaiting')}
          </span>
        </span>
        <span className="shrink-0 text-right text-[11px] tabular-nums text-ink-46" title={h.outgoing_at}>
          {fmtAge(h.outgoing_at)}
        </span>
      </button>
      {open && (
        <div className="border-t border-line p-3">
          <dl className="mb-3 grid grid-cols-1 gap-x-3 gap-y-1 text-[12px] sm:grid-cols-2">
            <dt className="text-ink-46">{t('prod.hoBy')}</dt>
            <dd className="min-w-0 break-words">{h.outgoing_name} · <span className="tabular-nums">{fmtDateTime(h.outgoing_at)}</span></dd>
            <dt className="text-ink-46">{t('prod.hoTo')}</dt>
            <dd className="min-w-0 break-words">
              {h.incoming_name ? `${h.incoming_name} · ${fmtDateTime(h.incoming_at!)}` : '—'}
            </dd>
            {h.note && (<>
              <dt className="text-ink-46">{t('prod.hoNote')}</dt>
              <dd className="min-w-0 break-words whitespace-pre-wrap">{h.note}</dd>
            </>)}
          </dl>
          <SnapshotView snap={h.snapshot} />
          {mayAccept && (
            <div className="mt-3 flex justify-end">
              <button type="button" className="btn btn-sm" disabled={acceptPending} onClick={onAccept}>
                {acceptPending ? t('prod.saving') : t('prod.hoAccept')}
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** The frozen work list — shared by the live pending preview and a signed row. */
function SnapshotView({ snap }: { snap: HandoverSnapshot }) {
  const { t, i18n } = useTranslation();
  const tr = snap.truncated;
  return (
    <div className="mt-2">
      <p className="text-[11px] tabular-nums text-ink-46">
        {t('prod.hoCaptured')}: {fmtDateTime(snap.captured_at)}
      </p>
      {(tr.alarms || tr.downtimes || tr.reviews) && (
        <p className="mt-1 text-[11px] text-[var(--color-caution-ink)]" role="note">{t('prod.hoTruncated')}</p>
      )}
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SnapList title={t('prod.hoAlarms')} count={snap.alarms.length} capped={tr.alarms}>
          {snap.alarms.map((a) => (
            <li key={a.id} className="min-w-0 break-words text-[12px]">
              <span className="font-medium">{a.rule ?? a.tag}</span>
              <span className="block text-[11px] text-ink-46">{a.tag} · {a.severity} · {fmtAge(a.raised_at)}</span>
            </li>
          ))}
        </SnapList>
        <SnapList title={t('prod.hoStops')} count={snap.downtimes.length} capped={tr.downtimes}>
          {snap.downtimes.map((d) => (
            <li key={d.id} className="min-w-0 break-words text-[12px]">
              <span className="font-medium">{localName(d.device, i18n.language) ?? d.device_id}</span>
              <span className="block text-[11px] tabular-nums text-ink-46">
                {fmtDuration(d.seconds, i18n.language)} · {fmtAge(d.starts_at)}
              </span>
            </li>
          ))}
        </SnapList>
        <SnapList title={t('prod.hoReviews')} count={snap.reviews.length} capped={tr.reviews}>
          {snap.reviews.map((r) => (
            <li key={r.id} className="min-w-0 break-words text-[12px]">
              <span className="font-medium">{r.camera ?? r.camera_id}</span>
              <span className="block text-[11px] tabular-nums text-ink-46">{fmtAge(r.fired_at)}</span>
            </li>
          ))}
        </SnapList>
      </div>
    </div>
  );
}

const SNAP_TOP = 5;

function SnapList({ title, count, capped, children }: {
  title: string; count: number; capped: boolean; children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  const rows = Children.toArray(children);
  return (
    <div className="min-w-0">
      <h3 className="text-[12px] font-semibold text-ink-68">
        {title} <span className="tabular-nums">({count}{capped ? '+' : ''})</span>
      </h3>
      {count === 0
        ? <p className="mt-1 text-[11px] text-ink-46">—</p>
        : <ul className="mt-1 space-y-1.5">{all ? rows : rows.slice(0, SNAP_TOP)}</ul>}
      {rows.length > SNAP_TOP && (
        <button type="button" className="mt-1 text-[11px] font-semibold text-ink-68 underline"
          onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? t('prod.hoShowLess') : t('prod.hoShowAll', { n: rows.length })}
        </button>
      )}
    </div>
  );
}
