// Keyboard map for <DataGrid> (plan §5 D1: arrows move the row, Enter opens
// the inspector, Esc cancels an inline edit). Pure so the map is testable
// without a DOM; the grid only has to apply the returned action.

export type GridAction =
  | { type: 'select'; index: number }
  | { type: 'open' }
  | { type: 'cancel' }
  | { type: 'none' };

export interface GridKeyState {
  /** currently selected row */
  index: number;
  count: number;
  /** a cell input has focus, so arrows and Enter belong to the text caret */
  editing: boolean;
}

export function gridKey(key: string, { index, count, editing }: GridKeyState): GridAction {
  if (count === 0) return { type: 'none' };
  if (editing) return key === 'Escape' ? { type: 'cancel' } : { type: 'none' };
  switch (key) {
    case 'ArrowDown': return { type: 'select', index: Math.min(index + 1, count - 1) };
    case 'ArrowUp': return { type: 'select', index: Math.max(index - 1, 0) };
    case 'Home': return { type: 'select', index: 0 };
    case 'End': return { type: 'select', index: count - 1 };
    case 'Enter': return { type: 'open' };
    default: return { type: 'none' };
  }
}
