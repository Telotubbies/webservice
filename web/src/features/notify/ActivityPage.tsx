// Activity feed — dd event-explorer pattern over the session journal:
// kind facet chips left, timeline rows right, mark-all-read action.
// Session-scoped data (live.journal, WS-driven) — not server history.

import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';
import { live } from '../../lib/live';
import { useStore } from '../../lib/hooks';
import { PageBar, Card } from '../../shared/ui/Page';
import { Icon } from '../../shared/ui/Icon';
import { EmptyState } from '../../shared/ui/Feedback';
import { journalIcon, journalTone, markJournalRead, isUnread, type JournalEvent } from './journal';

const KINDS = ['alarm', 'alarm_update', 'insight', 'command', 'health', 'auth'] as const;
type Kind = (typeof KINDS)[number];

const KIND_KEY: Record<Kind, string> = {
  alarm: 'act.tAlarm', alarm_update: 'act.tAlarmUpdate', insight: 'act.tInsight',
  command: 'act.tCommand', health: 'act.tHealth', auth: 'act.tAuth',
};

const TONE_CLASS: Record<string, string> = {
  critical: 'text-[var(--color-danger-bright)]', warning: 'text-[var(--color-warn)]',
  ok: 'text-[#2a7e41]', info: 'text-[var(--color-blue)]', neutral: 'text-[var(--color-muted-pill)]',
};

export function ActivityPage() {
  const { t, i18n } = useTranslation();
  const journalRev = useStore(() => live.journalRev);
  const [kind, setKind] = useState<Kind | null>(null);
  const [readAt, setReadAt] = useState(0);

  const entries = useMemo(() => live.journal, [journalRev]);
  const counts = useMemo(() => {
    const m = new Map<Kind, number>();
    for (const e of entries) m.set(e.kind, (m.get(e.kind) ?? 0) + 1);
    return m;
  }, [entries]);
  const shown = useMemo(
    () => (kind ? entries.filter((e) => e.kind === kind) : entries),
    [entries, kind],
  );
  /** Day-boundary grouping — journal is newest-first, so "today" leads. */
  const sections = useMemo(() => {
    const start = new Date().setHours(0, 0, 0, 0);
    const today = shown.filter((e) => Date.parse(e.ts) >= start);
    const earlier = shown.filter((e) => Date.parse(e.ts) < start);
    const out: [string, JournalEvent[]][] = [];
    if (today.length) out.push(['act.today', today]);
    if (earlier.length) out.push(['act.earlier', earlier]);
    return out;
  }, [shown]);

  const renderRow = (ev: JournalEvent) => {
    const tone = journalTone(ev);
    const unread = isUnread(ev, readAt);
    const row = (
      <>
        <span className={`mt-1 shrink-0 ${TONE_CLASS[tone]}`}>
          <Icon name={journalIcon(ev)} size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[13px] ${unread ? 'font-semibold' : ''}`}>
            {t(ev.title, ev.params)}
          </span>
          <span className="block text-[11px] text-ink-46">
            {ev.tag && <span className="font-mono">{ev.tag} · </span>}
            {new Date(ev.ts).toLocaleString(i18n.language)}
          </span>
        </span>
        {unread && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-blue)]" aria-hidden />}
      </>
    );
    return (
      <li key={ev.id} className="border-b border-line last:border-0">
        {ev.href ? (
          <NavLink to={ev.href} className="flex items-start gap-3 px-4 py-2.5 hover:bg-subtle">
            {row}
          </NavLink>
        ) : (
          <div className="flex items-start gap-3 px-4 py-2.5">{row}</div>
        )}
      </li>
    );
  };

  return (
    <>
      <PageBar
        title={t('act.title')}
        lede={t('act.lede')}
        actions={
          <button
            className="btn-ghost h-7 rounded px-2 text-[12px]"
            onClick={() => setReadAt(markJournalRead(live.journal))}
          >
            {t('feed.markRead')}
          </button>
        }
      />
      <div className="flex gap-4 p-4">
        {/* kind facet rail — info-soft active style matches the tags facets */}
        <aside className="w-44 shrink-0" aria-label={t('act.filterType')}>
          <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-46">
            {t('act.filterType')}
          </p>
          <ul className="space-y-0.5 text-[13px]">
            <li>
              <button
                className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left ${kind === null ? 'bg-info-soft font-semibold text-blue' : 'text-ink-68 hover:bg-subtle'}`}
                onClick={() => setKind(null)}
              >
                {t('feed.all')}
                <span className={`rounded-[34px] px-1.5 text-[11px] font-semibold ${kind === null ? 'bg-white text-blue' : 'bg-subtle'}`}>{entries.length}</span>
              </button>
            </li>
            {KINDS.map((k) => (
              <li key={k}>
                <button
                  className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left ${kind === k ? 'bg-info-soft font-semibold text-blue' : 'text-ink-68 hover:bg-subtle'}`}
                  onClick={() => setKind(k)}
                >
                  {t(KIND_KEY[k])}
                  <span className={`rounded-[34px] px-1.5 text-[11px] font-semibold ${kind === k ? 'bg-white text-blue' : 'bg-subtle'}`}>{counts.get(k) ?? 0}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* timeline */}
        <Card pad={false}>
          <ul className="w-full">
            {shown.length === 0 && (
              <li>
                <EmptyState
                  title={entries.length === 0 ? t('act.empty') : t('feed.emptyFiltered')}
                  icon="activity"
                />
              </li>
            )}
            {sections.map(([key, list]) => (
              <Fragment key={key}>
                <li className="border-b border-line bg-subtle px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-46">
                  {t(key)}
                </li>
                {list.map(renderRow)}
              </Fragment>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
