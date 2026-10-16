// Top-bar org switcher. A native <select> keeps it keyboard- and
// screen-reader-complete; the last option opens "Create organization".

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { api } from '../../lib/api';
import { useStore } from '../../lib/hooks';
import { live } from '../../lib/live';
import { activateOrg } from '../../lib/org';
import { getScope } from '../../lib/scope';

const NEW = '__new__';

export function OrgSwitcher() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  useStore(() => live.authRev);
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: 60_000 });
  const memberships = me.data?.memberships ?? [];
  const active = getScope();
  if (!active) return null;

  const onChange = (value: string) => {
    if (value === NEW) { navigate('/orgs/new'); return; }
    const m = memberships.find((x) => x.org_id === value);
    if (m && m.org_id !== active.orgId) void activateOrg(m);
  };

  return (
    <label className="flex min-w-0 items-center gap-1 text-[12px] text-white/80">
      <span className="sr-only">{t('org.switcher')}</span>
      <select
        className="h-6 max-w-[160px] truncate rounded border border-white/20 bg-white/[0.08] px-1 text-[12px] text-white"
        value={active.orgId}
        onChange={(e) => onChange(e.target.value)}
      >
        {memberships.map((m) => (
          <option key={m.org_id} value={m.org_id} className="text-black">{m.org_name ?? m.org_id}</option>
        ))}
        <option value={NEW} className="text-black">+ {t('org.newOrg')}</option>
      </select>
    </label>
  );
}
