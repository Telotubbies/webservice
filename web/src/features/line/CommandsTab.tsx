// Commands tab of the line console (D2): the F05 command history for this
// line as program-style rows — the type chip, the target, the value, the
// operator's reason, the one pre-send check the audit keeps (its reason) and
// the unchanged lifecycle pill with its audited result. Colour codes the
// command TYPE and flags a missing check; nothing here reads as "good".

import { useTranslation } from 'react-i18next';
import { live } from '../../lib/live';
import { useNow, useStore } from '../../lib/hooks';
import { LINE_EQUIPMENT, SIGNALS } from '../../lib/plant';
import { fmtAge } from '../../lib/format';
import { useControlGate } from '../../app/session';
import { CommandChip } from '../../shared/ui/ConsoleKit';
import { DdIcon } from '../../shared/ui/DdIcon';
import { EmptyState } from '../../shared/ui/Feedback';
import { LifecyclePill } from './LifecyclePill';
import { outcomeOf } from './commandOutcome';
import { commandCode, COMMAND_KINDS } from './lineModel';

const LINE_TAGS = new Set(LINE_EQUIPMENT.flatMap((e) => e.signals));

export function CommandsTab() {
  const { t } = useTranslation();
  const now = useNow();
  const gate = useControlGate();
  useStore(() => live.cmdRev);
  const rows = [...live.commands.values()]
    .filter((c) => LINE_TAGS.has(c.tag))
    .sort((a, b) => Date.parse(b.updated_at ?? b.created_at ?? '') - Date.parse(a.updated_at ?? a.created_at ?? ''))
    .slice(0, 20);

  if (rows.length === 0 && !gate.allowed) {
    return <EmptyState compact title={t('d2.noCommandAccess')} body={t('d2.noCommandAccessBody')} icon="lock" />;
  }
  if (rows.length === 0) {
    return <EmptyState compact title={t('d2.noCommands')} body={t('d2.noCommandsBody')} icon="commands" />;
  }

  return (
    <div className="min-w-0">
      <div className="hidden items-center gap-3 border-b border-line px-3 py-1 text-[11px] font-semibold text-ink-68 md:flex">
        <span className="w-5 shrink-0">#</span>
        <span className="w-20 shrink-0">{t('d2.command')}</span>
        <span className="min-w-24 flex-1">{t('d2.cmdTarget')}</span>
        <span className="w-24 shrink-0">{t('d2.cmdValue')}</span>
        <span className="min-w-24 flex-1">{t('d2.cmdReason')}</span>
        <span className="w-28 shrink-0">{t('d2.cmdCheck')}</span>
        <span className="w-44 shrink-0">{t('d2.cmdStatus')}</span>
      </div>
      <ul className="divide-y divide-line">
        {rows.map((c, i) => {
          const code = commandCode(COMMAND_KINDS[c.tag] ?? 'other', c.value);
          const out = outcomeOf(t, c.status, c.detail);
          // the one pre-send check the audit keeps for every command is its reason;
          // the audited result rides with the lifecycle pill so neither is guessed
          const checked = !!c.note?.trim();
          return (
            <li key={c.id} data-command-row={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-[13px]">
              <span className="w-5 shrink-0 text-[11px] text-ink-46">{i + 1}</span>
              <span className="w-20 shrink-0"><CommandChip code={code} label={code} /></span>
              <span className="min-w-24 flex-1 truncate">
                {SIGNALS[c.tag] ? t(SIGNALS[c.tag].labelKey) : c.tag}
              </span>
              <span className="w-24 shrink-0 font-mono tabular-nums">
                {typeof c.value === 'boolean' ? (c.value ? t('state.on') : t('state.off')) : c.value ?? '—'}
              </span>
              <span className="min-w-24 flex-1 truncate text-ink-68" data-col="reason">
                {c.note || t('f05.noReason')}
              </span>
              <span
                className={`flex w-28 shrink-0 items-center gap-1 ${checked ? 'text-ink-68' : 'font-semibold text-[var(--color-caution-ink)]'}`}
                data-check={checked ? 'ok' : 'missing'}
              >
                <DdIcon name={checked ? 'check' : 'attention-circled'} size={12} />
                <span className="truncate">{checked ? t('f05.c_reason') : t('f05.noReason')}</span>
              </span>
              <span className="flex w-44 shrink-0 flex-col gap-0.5">
                <LifecyclePill status={c.status} />
                <span className="break-words text-ink-68" title={out.text}>{out.text}</span>
              </span>
              <span className="w-full pl-8 text-[11px] text-ink-46 md:hidden">{fmtAge(c.updated_at ?? c.created_at, now)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
