// Per-rule notification routing editor (roadmap §7 3.2). Controlled
// component: RuleCreatePage collects the value and PUTs it after the rule
// row exists; AlarmRulesPage loads the rule's current value and saves it
// straight away. Targets = channels + teams + optional on-call team.

import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { teamApi } from '../../lib/api';
import { notifyApi, type RuleNotify } from '../notify/api';
import '../notify/i18n';

const SEVS = ['info', 'warning', 'critical'] as const;

export const EMPTY_NOTIFY: RuleNotify = {
  channel_ids: [], team_ids: [], oncall_team: null, min_severity: 'info', on_clear: false,
};

export function RuleNotifyEditor({ orgId, value, onChange }: {
  orgId: string; value: RuleNotify; onChange: (v: RuleNotify) => void;
}) {
  const { t } = useTranslation();
  const channels = useQuery({
    queryKey: ['notify-channels', orgId],
    queryFn: () => notifyApi.channels(orgId),
    enabled: !!orgId,
  });
  const teams = useQuery({
    queryKey: ['teams', orgId],
    queryFn: () => teamApi.list(orgId),
    enabled: !!orgId,
  });

  const flip = (key: 'channel_ids' | 'team_ids', id: string) =>
    onChange({
      ...value,
      [key]: value[key].includes(id) ? value[key].filter((x) => x !== id) : [...value[key], id],
    });

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-46">{t('esc.channels')}</p>
        {(channels.data?.items ?? []).length === 0 ? (
          <p className="text-[12px] text-ink-46">{t('nc.empty')}</p>
        ) : (
          (channels.data?.items ?? []).filter((c) => c.enabled).map((c) => (
            <label key={c.id} className="flex items-center gap-1.5 py-0.5 text-[12px]">
              <input type="checkbox" checked={value.channel_ids.includes(c.id)} onChange={() => flip('channel_ids', c.id)} />
              {c.name} <span className="text-ink-46">({c.type})</span>
            </label>
          ))
        )}
      </div>
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-46">{t('esc.teams')}</p>
        {(teams.data?.teams ?? []).map((tm) => (
          <label key={tm.id} className="flex items-center gap-1.5 py-0.5 text-[12px]">
            <input type="checkbox" checked={value.team_ids.includes(tm.id)} onChange={() => flip('team_ids', tm.id)} />
            {tm.name}
          </label>
        ))}
        <div className="mt-2 field">
          <label className="field-label" htmlFor="rn-oncall">{t('esc.oncallTeam')}</label>
          <select id="rn-oncall" className="input h-8" value={value.oncall_team ?? ''}
            onChange={(e) => onChange({ ...value, oncall_team: e.target.value || null })}>
            <option value="">—</option>
            {(teams.data?.teams ?? []).map((tm) => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
          </select>
        </div>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="rn-minsev">{t('rn.minSeverity')}</label>
        <select id="rn-minsev" className="input h-8" value={value.min_severity}
          onChange={(e) => onChange({ ...value, min_severity: e.target.value as RuleNotify['min_severity'] })}>
          {SEVS.map((s) => <option key={s} value={s}>{t(`alarms.${s}`, { defaultValue: s })}</option>)}
        </select>
        <span className="text-[11px] text-ink-46">{t('rn.minSeverityHint')}</span>
      </div>
      <div className="field">
        <span className="field-label">{t('rn.onClear')}</span>
        <label className="flex h-8 items-center gap-2 text-[12px]">
          <input type="checkbox" checked={value.on_clear}
            onChange={(e) => onChange({ ...value, on_clear: e.target.checked })} />
          {t('rn.onClearHint')}
        </label>
      </div>
    </div>
  );
}
