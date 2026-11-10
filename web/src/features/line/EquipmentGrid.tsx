// The equipment grid of the line console (D2): the v6 DataGrid with grouped
// headings (live value, limits) on 28 px rows, and the same rows as cards
// under lg, where a table would scroll off a 390 px screen. Selection is one
// row: the pale yellow token, never a status stripe.

import { useTranslation } from 'react-i18next';
import { DataGrid, type DataGridColumn } from '../../shared/ui/DataGrid';
import { CommandChip } from '../../shared/ui/ConsoleKit';
import { SeverityBadge } from '../../shared/ui/Status';
import { formatSignal, unitOf } from '../../lib/plant';
import { fmtClock } from '../../lib/format';
import type { EquipmentRow } from './lineModel';
import { QualityState, RunMark } from './LineMarks';

export function EquipmentGrid({ rows, selectedId, onSelect, onOpen, onCardOpen, emptyLabel }: {
  rows: EquipmentRow[];
  selectedId: string | null;
  onSelect: (row: EquipmentRow) => void;
  /** Enter on the desktop grid: opens the inspector and scrolls to it */
  onOpen: (row: EquipmentRow) => void;
  /** a tap on a phone card: opens the inspector without scrolling the list away */
  onCardOpen: (row: EquipmentRow) => void;
  emptyLabel: string;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const unit = (r: EquipmentRow) => unitOf(r.tag);

  const columns: DataGridColumn<EquipmentRow>[] = [
    { key: 'seq', header: '#', width: '34px', render: (r) => <span className="text-ink-46">{r.seq}</span> },
    { key: 'name', header: t('d2.colName'), width: '110px', render: (r) => <span className="font-medium">{t(r.labelKey)}</span> },
    {
      key: 'tag', header: t('d2.colTag'), width: '170px',
      render: (r) => <span className="block truncate font-mono text-[11px] text-ink-46" title={r.tag}>{r.tag.split('.').slice(-2).join('.')}</span>,
    },
    {
      key: 'value', header: t('d2.colValue'), group: t('d2.colLive'), numeric: true, width: '86px',
      render: (r) => (
        <>
          <span>{r.value == null ? '—' : formatSignal(r.tag, r.value, lang)}</span>
          {unit(r) && <span className="ml-1 text-[11px] text-ink-46">{unit(r)}</span>}
        </>
      ),
    },
    {
      key: 'raw', header: t('d2.colRaw'), group: t('d2.colLive'), numeric: true, width: '64px',
      render: (r) => <span className="text-ink-46">{r.value == null ? '—' : String(r.value)}</span>,
    },
    { key: 'lo', header: 'LO', group: t('d2.colLimits'), numeric: true, width: '46px', render: (r) => <span>{r.limits.lo ?? '—'}</span> },
    { key: 'hi', header: 'HI', group: t('d2.colLimits'), numeric: true, width: '46px', render: (r) => <span>{r.limits.hi ?? '—'}</span> },
    {
      key: 'command', header: t('d2.colLast'), width: '150px',
      render: (r) => r.command ? (
        <span className="inline-flex items-center gap-1.5">
          <CommandChip code={r.command.code} label={r.command.code} />
          <span className="text-[11px] text-ink-46">{fmtClock(r.command.at)}</span>
        </span>
      ) : <span className="text-ink-46" title={t('d2.neverCommanded')}>—</span>,
    },
    {
      key: 'state', header: t('d2.colState'), width: '110px',
      render: (r) => r.alarm ? <SeverityBadge severity={r.alarm} />
        : r.hasRunSignal ? <RunMark state={r.state} />
          : <span className="text-ink-46" title={t('d2.noRunSignal')}>—</span>,
    },
    {
      key: 'quality', header: t('d2.colQuality'), width: '130px',
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <QualityState q={r.quality} stale={r.stale} />
          <span className="text-[11px] text-ink-46">· {fmtClock(r.ts)}</span>
        </span>
      ),
    },
  ];

  return (
    <>
      <div className="hidden lg:block">
        <DataGrid
          label={t('d2.equipment', { n: rows.length })}
          columns={columns}
          rows={rows}
          dense
          selectedId={selectedId}
          onSelect={onSelect}
          onOpen={onOpen}
          emptyLabel={emptyLabel}
          getRowState={(r) => (r.stale ? 'stale' : 'normal')}
        />
      </div>
      <ul className="flex flex-col divide-y divide-line lg:hidden" aria-label={t('d2.equipment', { n: rows.length })}>
        {rows.length === 0 && <li className="px-3 py-4 text-[14px] text-ink-46">{emptyLabel}</li>}
        {rows.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              data-row-card={r.id}
              aria-pressed={r.id === selectedId}
              aria-label={`${r.seq}. ${t(r.labelKey)}`}
              onClick={() => { onSelect(r); onCardOpen(r); }}
              className={`flex w-full flex-col gap-1.5 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue ${
                r.id === selectedId ? 'bg-[var(--color-row-selected)] text-ink' : ''
              }`}
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-[15px] font-semibold">{r.seq}. {t(r.labelKey)}</span>
                <span className="shrink-0 font-mono text-[17px] tabular-nums">
                  {r.value == null ? '—' : formatSignal(r.tag, r.value, lang)}
                  {unit(r) && <span className="ml-1 text-[12px] font-normal text-ink-46">{unit(r)}</span>}
                </span>
              </span>
              <span className="truncate font-mono text-[11px] text-ink-46">{r.tag.split('.').slice(-2).join('.')}</span>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                {r.alarm ? <SeverityBadge severity={r.alarm} />
                  : r.hasRunSignal ? <RunMark state={r.state} />
                    : <span className="text-ink-46" title={t('d2.noRunSignal')}>—</span>}
                <span className="text-[12px] text-ink-68">
                  {t('d2.colLimits')} {r.limits.lo ?? '—'} … {r.limits.hi ?? '—'}
                </span>
                {r.command && <CommandChip code={r.command.code} label={r.command.code} />}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
