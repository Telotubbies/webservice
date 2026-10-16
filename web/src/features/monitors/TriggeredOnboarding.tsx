// Triggered-monitors onboarding banner (dd "Triggered" first-run card):
// shown on /alarms when there are zero rules or zero alarms ever, pointing
// at the two real next steps — template packs and rule creation — plus the
// notification channels page. New-rule and pack-install copy stays
// admin-gated text; the links themselves are safe for every role.

import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';
import { canAdmin } from '../../app/session';
import { DdIcon } from '../../shared/ui/DdIcon';
import './i18n';

export function TriggeredOnboarding({ ruleCount, orgRole }: { ruleCount: number; orgRole: string | null }) {
  const { t } = useTranslation();
  const none = ruleCount === 0;
  return (
    <div className="mb-3 rounded-[5px] border border-line bg-white px-3 py-3 shadow-card" data-onboarding>
      <p className="flex items-center gap-2 text-[13px] font-semibold text-ink">
        <DdIcon name="monitor" size={14} className="shrink-0 text-ink-46" />
        {none ? t('mon.onb.noRules') : t('mon.onb.noAlarms', { count: ruleCount })}
      </p>
      <p className="mt-1 text-[12px] text-ink-68">{none ? t('mon.onb.noRulesBody') : t('mon.onb.noAlarmsBody')}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <NavLink to="/monitors/templates" className="btn btn-sm">
          <DdIcon name="books" size={12} /> {t('mon.onb.templates')}
        </NavLink>
        {canAdmin(orgRole ?? 'none') && (
          <NavLink to="/admin/rules/new" className="btn btn-ghost btn-sm">
            <DdIcon name="plus" size={12} /> {t('mon.onb.newRule')}
          </NavLink>
        )}
        <NavLink to="/notifications/channels" className="btn btn-ghost btn-sm">
          <DdIcon name="bell" size={12} /> {t('mon.onb.notify')}
        </NavLink>
      </div>
    </div>
  );
}
