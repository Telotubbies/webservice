import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api } from '../../lib/api';
import { live } from '../../lib/live';
import { useStore } from '../../lib/hooks';
import { SIGNALS, formatSignal, shortName } from '../../lib/plant';
import { canOperate, useRole } from '../../app/session';
import { EmptyState, ErrorState, Notice, Skeleton } from '../../shared/ui/Feedback';
import type { Command } from '../../types';
import './commands.css';

const GOOD = new Set(['done', 'acknowledged']);
const PENDING = new Set(['issued', 'sent', 'accepted', 'dispatched', 'acked']);

export function CommandsPage() {
  const { t, i18n } = useTranslation();
  const role = useRole();
  const allowed = canOperate(role);
  const q = useQuery({
    queryKey: ['commands', role], queryFn: () => api.listCommands(100), enabled: allowed,
  });
  useStore(() => live.cmdRev);

  // merge server list with live updates (WS) so status changes appear instantly
  const rows: Command[] = (q.data ?? []).map((c) => ({ ...c, ...live.commands.get(c.id) }));
  for (const c of live.commands.values()) if (!rows.some((r) => r.id === c.id)) rows.unshift(c);
  rows.sort((a, b) => (Date.parse(b.created_at ?? '') || 0) - (Date.parse(a.created_at ?? '') || 0));
  const label = (n: string) => (SIGNALS[n] ? t(SIGNALS[n].labelKey) : shortName(n));
  const fmtTime = (ts?: string) => (ts ? new Date(ts).toLocaleString(i18n.language === 'th' ? 'th-TH' : 'en-GB', { hour12: false }) : '—');

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{t('commands.title')}</h1>
          <p className="lede">{t('commands.lede')}</p>
        </div>
        {allowed && <div className="actions"><Link to="/line?eq=motor" className="btn">{t('commands.newCommand')}</Link></div>}
      </header>
      <section className="panel cmd-panel">
        {!allowed ? (
          <div className="panel-body"><Notice icon="lock">{t('commands.restricted')}</Notice></div>
        ) : q.isError ? (
          <ErrorState onRetry={() => void q.refetch()} />
        ) : q.isPending ? (
          <div className="panel-body" style={{ display: 'grid', gap: 12 }}>
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} h={28} />)}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon="commands" title={t('commands.empty')} body={t('commands.emptyBody')} />
        ) : (
          <div className="panel-body flush" style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('commands.colTime')}</th>
                  <th scope="col">{t('commands.colSignal')}</th>
                  <th scope="col" className="num">{t('commands.colValue')}</th>
                  <th scope="col">{t('commands.colUser')}</th>
                  <th scope="col">{t('commands.colStatus')}</th>
                  <th scope="col">{t('commands.colDetail')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const tone = GOOD.has(c.status) ? 'ok' : PENDING.has(c.status) ? 'pending' : 'bad';
                  return (
                    <tr key={c.id} className="cmd-row" data-status={c.status}>
                      <td className="mono">{fmtTime(c.created_at)}</td>
                      <td>{label(c.tag)}</td>
                      <td className="value">{formatSignal(c.tag, c.value, i18n.language)}</td>
                      <td className="dim">{c.user ?? '—'}</td>
                      <td><span className={`cmd-result is-${tone}`}><span className="lc-dot" aria-hidden />{t(`lifecycle.${c.status}`)}</span></td>
                      <td className="mono dim">{c.detail ?? ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
