// Topbar scope: Org › Area › Line (ISA-95, spec §5.2). The org stays the
// native <select> (OrgSwitcher); Area › Line is a top-layer popover with a
// filter, writing the shared equipment selection (lib/equipment) so every
// Plant page that narrows by equipment follows the topbar.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { OrgSwitcher } from '../features/orgs/OrgSwitcher';
import { hierarchyApi } from '../lib/api';
import { getScope } from '../lib/scope';
import { useEquipment } from '../lib/equipment';
import { fromSelection, repairScope, scopeCrumbs, toSelection, type LineScope } from '../lib/scopeModel';
import { Popover } from '../ui/Popover';
import { DdIcon } from '../shared/ui/DdIcon';

export function ScopePicker() {
  const { t, i18n } = useTranslation();
  const sc = getScope();
  const { current, select } = useEquipment();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const tree = useQuery({
    queryKey: ['hierarchy', sc?.orgId, sc?.siteId],
    queryFn: () => hierarchyApi.tree(sc!.orgId, sc!.siteId),
    enabled: !!sc?.orgId && !!sc?.siteId, staleTime: 60_000,
  });
  const areas = useMemo(() => tree.data?.areas ?? [], [tree.data]);
  const scope = repairScope(areas, fromSelection(areas, current?.id ?? null));
  const crumbs = scopeCrumbs(areas, scope);
  const needle = q.trim().toLocaleLowerCase(i18n.language);
  const shown = areas
    .map((a) => ({ a, lines: a.lines.filter((l) => !needle || `${a.name} ${l.name}`.toLocaleLowerCase(i18n.language).includes(needle)) }))
    .filter(({ a, lines }) => !needle || lines.length > 0 || a.name.toLocaleLowerCase(i18n.language).includes(needle));
  const pick = (s: LineScope) => { select(toSelection(s)); setOpen(false); setQ(''); };
  const row = 'flex h-8 w-full items-center gap-2 rounded-control px-2 text-left text-[13px] hover:bg-panel-2 focus-visible:bg-panel-2';

  if (!sc) return null;
  return (
    <div className="flex min-w-0 items-center gap-1">
      <OrgSwitcher />
      {areas.length > 0 && (
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger
            className="hidden h-7 min-w-0 max-w-[220px] items-center gap-1 rounded border border-white/20 bg-white/[0.08] px-2 text-[12px] text-white/85 hover:bg-white/[0.12] lg:flex"
            aria-label={`${t('shell.scopeLabel')}: ${crumbs.map((c) => c.label).join(' › ') || t('shell.scopeAll')}`}
          >
            <span aria-hidden className="text-white/45">›</span>
            <span className="truncate">{crumbs.length ? crumbs.map((c) => c.label).join(' › ') : t('shell.scopeAll')}</span>
            <DdIcon name="caret-down" size={10} className="shrink-0 opacity-60" />
          </Popover.Trigger>
          <Popover.Content label={t('shell.scopeLabel')} className="w-72">
            <input
              className="mb-1 h-8 w-full rounded-control border border-line-strong bg-panel px-2 text-[13px]"
              placeholder={t('shell.scopeSearch')} aria-label={t('shell.scopeSearch')}
              value={q} onChange={(e) => setQ(e.target.value)} autoFocus
            />
            <div className="max-h-72 overflow-y-auto">
              <button type="button" className={row} onClick={() => pick({})} aria-pressed={!crumbs.length}>
                <span className="w-3 text-accent" aria-hidden>{crumbs.length ? '' : '✓'}</span>{t('shell.scopeAll')}
              </button>
              {shown.map(({ a, lines }) => (
                <div key={a.id}>
                  <button type="button" className={`${row} font-semibold`} onClick={() => pick({ areaId: a.id })}
                    aria-pressed={scope.areaId === a.id && !scope.lineId}>
                    <span className="w-3 text-accent" aria-hidden>{scope.areaId === a.id && !scope.lineId ? '✓' : ''}</span>{a.name}
                  </button>
                  {lines.map((l) => (
                    <button key={l.id} type="button" className={`${row} pl-7`} onClick={() => pick({ areaId: a.id, lineId: l.id })}
                      aria-pressed={scope.lineId === l.id}>
                      <span className="w-3 text-accent" aria-hidden>{scope.lineId === l.id ? '✓' : ''}</span>{l.name}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </Popover.Content>
        </Popover.Root>
      )}
    </div>
  );
}
