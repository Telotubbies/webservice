import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { EmptyState } from '../../shared/ui/Feedback';
import { Segmented } from '../../shared/ui/Segmented';
import { normSeverity } from '../../shared/ui/Status';
import { AlarmRows } from './AlarmRows';
import { useAlarms } from './alarms';

type StateFilter = 'active' | 'acked' | 'cleared' | 'all';
type SevFilter = 'any' | 'critical' | 'warning' | 'info';

export function AlarmsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const { all } = useAlarms();
  const state = (params.get('state') as StateFilter) || 'all';
  const sev = (params.get('sev') as SevFilter) || 'any';
  const set = (k: string, v: string, dflt: string) => {
    const next = new URLSearchParams(params);
    if (v === dflt) next.delete(k); else next.set(k, v);
    setParams(next, { replace: true });
  };

  const rows = all.filter((a) => (state === 'all' || a.state === state)
    && (sev === 'any' || normSeverity(a.severity) === sev));
  const count = (s: StateFilter) => (s === 'all' ? all.length : all.filter((a) => a.state === s).length);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{t('alarms.title')}</h1>
          <p className="lede">{t('alarms.lede')}</p>
        </div>
      </header>
      <section className="panel">
        <div className="alarm-filters">
          <Segmented<StateFilter>
            label={t('alarms.colState')} value={state} onChange={(v) => set('state', v, 'all')}
            options={(['active', 'acked', 'cleared', 'all'] as StateFilter[]).map((s) => ({
              value: s, label: `${t(`alarms.${s}`)} ${count(s)}`,
            }))}
          />
          <Segmented<SevFilter>
            label={t('alarms.severity')} value={sev} onChange={(v) => set('sev', v, 'any')}
            options={[
              { value: 'any', label: t('alarms.allSeverities') },
              { value: 'critical', label: t('alarms.critical') },
              { value: 'warning', label: t('alarms.warning') },
              { value: 'info', label: t('alarms.info') },
            ]}
          />
        </div>
        <div className="panel-body flush">
          {rows.length === 0 ? (
            state === 'active'
              ? <EmptyState title={t('alarms.emptyActive')} body={t('alarms.emptyActiveBody')} />
              : <EmptyState title={t('alarms.empty')} icon="info" />
          ) : (
            <AlarmRows alarms={rows} />
          )}
        </div>
      </section>
    </div>
  );
}
