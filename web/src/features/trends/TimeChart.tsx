// TimeChart moved to viz/TimeSeries (R2). This re-export keeps existing
// imports working until every caller uses the viz kit directly.

export { TimeSeries as TimeChart, type ChartSeries } from '../../viz/TimeSeries';
