import { expect, test } from 'bun:test';
import { joinSeries } from './viz';
import { withGaps } from '../../viz/series';

test('a single series with an outage keeps a null inside the gap', () => {
  const pts = [{ t: 0, v: 1 }, { t: 1000, v: 2 }, { t: 2000, v: 3 }, { t: 60_000, v: 4 }];
  const col = [...joinSeries([withGaps(pts)])[1]] as (number | null)[];
  expect(col.some((v) => v === null)).toBe(true);
  expect(col.filter((v) => v !== null)).toEqual([1, 2, 3, 4]);
});
