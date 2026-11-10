// DataGrid — the dense console table (plan §1.2): two-tier grouped headings,
// sticky header, compact rows, mono right-aligned numbers with a unit, inline
// edit per cell and one selected row. Keyboard: arrows/Home/End move the row,
// Enter opens the inspector, Esc cancels the inline edit (see ./gridKeys).
// The older <Table> in Page.tsx is untouched, so its callers keep their API.

import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { gridKey } from './gridKeys';
import { editEndGuard } from './gridEdit';

export interface DataGridColumn<T> {
  /** property read for the default cell */
  key: string;
  header: string;
  /** second-tier heading; consecutive equal groups merge into one cell */
  group?: string;
  numeric?: boolean;
  /** shown after the value, e.g. "A" */
  unit?: string;
  decimals?: number;
  width?: string;
  render?: (row: T) => ReactNode;
  edit?: {
    /** accessible name of the inline field */
    inputLabel: string;
    onCommit: (row: T, value: string) => void;
  };
}

export type GridRowState = 'normal' | 'stale' | 'error';

export interface DataGridProps<T extends { id: string }> {
  /** accessible name of the grid */
  label: string;
  columns: DataGridColumn<T>[];
  rows: T[];
  selectedId?: string | null;
  onSelect?: (row: T) => void;
  /** Enter on the selected row */
  onOpen?: (row: T) => void;
  /** 28px rows instead of 32px */
  dense?: boolean;
  emptyLabel?: string;
  getRowState?: (row: T) => GridRowState;
  /** px; makes the body scroll while the header stays put */
  maxHeight?: number;
}

const text = <T,>(row: T, col: DataGridColumn<T>): string => {
  const v = (row as unknown as Record<string, unknown>)[col.key];
  return v == null || v === '' ? '—' : String(v);
};

const shown = <T,>(row: T, col: DataGridColumn<T>): ReactNode => {
  const v = (row as unknown as Record<string, unknown>)[col.key];
  if (typeof v === 'number') return v.toLocaleString('en-US', { maximumFractionDigits: col.decimals ?? 2 });
  return text(row, col);
};

export function DataGrid<T extends { id: string }>({
  label, columns, rows, selectedId = null, onSelect, onOpen, dense, emptyLabel = '—', getRowState, maxHeight,
}: DataGridProps<T>) {
  const body = useRef<HTMLTableSectionElement>(null);
  /** the field whose blur must not commit: the key handler already did */
  const editGuard = useRef(editEndGuard()).current;
  const selected = rows.findIndex((r) => r.id === selectedId);
  const active = selected < 0 ? 0 : selected;

  const focusRow = (i: number) => {
    body.current?.querySelectorAll<HTMLTableRowElement>('tr[data-index]')[i]?.focus();
  };
  const select = (i: number) => {
    if (rows[i]) onSelect?.(rows[i]);
    focusRow(i);
  };
  /** Leave the field for its row without a second commit; the row keeps the focus ring. */
  const endEdit = (input: HTMLInputElement) => {
    editGuard.mark(input);
    (input.closest('tr') as HTMLTableRowElement | null)?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTableSectionElement>) => {
    const editing = e.target instanceof HTMLInputElement;
    const action = gridKey(e.key, { index: active, count: rows.length, editing });
    if (action.type === 'select') {
      e.preventDefault();
      select(action.index);
    } else if (action.type === 'open') {
      e.preventDefault();
      if (rows[active]) onOpen?.(rows[active]);
    } else if (action.type === 'cancel' && e.target instanceof HTMLInputElement) {
      // Esc reverts the field to its own row's value and leaves without committing
      e.preventDefault();
      const input = e.target;
      const col = columns.find((c) => c.key === input.dataset.col);
      const owner = rows[Number(input.closest('tr')?.dataset.index)];
      if (col && owner) input.value = text(owner, col);
      endEdit(input);
    }
  };

  const groups = columns.reduce<{ name?: string; span: number }[]>((acc, c) => {
    const last = acc[acc.length - 1];
    if (last && last.name === c.group) last.span++;
    else acc.push({ name: c.group, span: 1 });
    return acc;
  }, []);
  const tiered = columns.some((c) => c.group);

  return (
    <div
      data-grid={dense ? 'compact' : 'default'}
      className={maxHeight ? 'max-w-full overflow-auto' : 'max-w-full overflow-x-auto'}
      style={maxHeight ? { maxHeight } : undefined}
    >
      <table role="grid" aria-label={label} aria-rowcount={rows.length} className="w-full border-collapse text-[13px]">
        <thead className="sticky top-0 z-[1] bg-subtle shadow-[0_1px_0_var(--color-line)]">
          {tiered && (
            <tr className="border-b border-line text-left">
              {groups.map((g, i) => (
                <th key={i} scope="colgroup" colSpan={g.span} className="h-7 px-3 text-[14px] font-semibold text-ink-68">
                  {g.name}
                </th>
              ))}
            </tr>
          )}
          <tr className="border-b border-line text-left">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                style={c.width ? { width: c.width } : undefined}
                className={`overline h-7 px-3 text-[14px] ${c.numeric ? 'text-right' : ''}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody ref={body} onKeyDown={onKeyDown}>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-3 py-4 text-[13px] text-ink-46">{emptyLabel}</td>
            </tr>
          )}
          {rows.map((row, i) => {
            const state = getRowState?.(row) ?? 'normal';
            const isSelected = row.id === selectedId;
            return (
              <tr
                key={row.id}
                data-index={i}
                data-row-id={row.id}
                data-row-state={state}
                aria-selected={isSelected}
                tabIndex={i === active ? 0 : -1}
                onClick={(e) => {
                  // a click into a cell field keeps the caret there; the row is not refocused
                  if (e.target instanceof HTMLInputElement) {
                    if (!isSelected) onSelect?.(row);
                    return;
                  }
                  select(i);
                }}
                onFocus={() => { if (!isSelected) onSelect?.(row); }}
                style={{ height: dense ? 'var(--row-h-compact)' : 'var(--row-h)' }}
                className={`border-b border-line last:border-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue ${
                  isSelected ? 'bg-[var(--color-row-selected)] text-ink' : `hover:bg-info-soft ${state === 'stale' ? 'text-ink-46' : ''}`
                }`}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`whitespace-nowrap px-3 align-middle ${c.numeric ? 'text-right font-mono tabular-nums' : ''}`}
                  >
                    {c.edit ? (
                      <input
                        data-col={c.key}
                        aria-label={c.edit.inputLabel}
                        defaultValue={text(row, c)}
                        onBlur={(e) => {
                          // the key handler committed and handed the focus back
                          if (editGuard.claim(e.currentTarget)) return;
                          c.edit!.onCommit(row, e.currentTarget.value);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            e.stopPropagation();
                            c.edit!.onCommit(row, e.currentTarget.value);
                            endEdit(e.currentTarget);
                          }
                        }}
                        className={`input h-6 w-full border-transparent bg-transparent hover:border-[var(--color-input-line)] focus:bg-paper ${c.numeric ? 'num text-right' : ''}`}
                      />
                    ) : c.render ? (
                      c.render(row)
                    ) : (
                      <>
                        {shown(row, c)}
                        {c.unit && <span className="ml-1 text-[11px] text-ink-46">{c.unit}</span>}
                      </>
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
