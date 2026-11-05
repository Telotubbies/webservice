// Which of TimeChart's four faces to show. One answer drives both the render
// branch and the uPlot effect, so the plot is built exactly when its box is
// in the DOM — cached data (hasData true while still loading) used to leave
// the effect waiting on deps that never changed again, i.e. a blank chart.

export type ChartPhase = 'loading' | 'error' | 'empty' | 'plot';

export function chartPhase(o: { loading?: boolean; error?: boolean; hasData: boolean }): ChartPhase {
  if (o.loading) return 'loading';
  if (o.error) return 'error';
  return o.hasData ? 'plot' : 'empty';
}
