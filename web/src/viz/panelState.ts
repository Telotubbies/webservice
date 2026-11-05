// Which face a Panel shows. Honest states (spec §7.3): an error is always
// said out loud; a refetch keeps the last render dimmed instead of flashing
// a skeleton (M10); an empty window says so; stale data is labelled.

export type PanelState = 'skeleton' | 'refetch' | 'error' | 'empty' | 'stale' | 'ready';

export function panelState(o: { loading: boolean; error: boolean; empty: boolean; stale: boolean; hasPrevious: boolean }): PanelState {
  if (o.error) return 'error';
  if (o.loading) return o.hasPrevious ? 'refetch' : 'skeleton';
  if (o.empty) return 'empty';
  if (o.stale) return 'stale';
  return 'ready';
}
