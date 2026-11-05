import { expect, test } from 'bun:test';
import { meanInterval } from './incidentStats';

const row = (created: string, acked: string | null) => ({ created_at: created, acked_at: acked });
test('mean of valid intervals', () =>
  expect(meanInterval([row('2026-10-26T00:00:00Z', '2026-10-26T00:10:00Z'), row('2026-10-26T00:00:00Z', '2026-10-26T00:20:00Z')], (r) => r.acked_at)).toBe(15 * 60_000));
test('an ack before its creation is a data error, not a negative time', () =>
  expect(meanInterval([row('2026-10-26T12:00:00Z', '2026-10-26T00:00:00Z'), row('2026-10-26T00:00:00Z', '2026-10-26T00:10:00Z')], (r) => r.acked_at)).toBe(10 * 60_000));
test('nothing valid is null', () =>
  expect(meanInterval([row('2026-10-26T00:00:00Z', null)], (r) => r.acked_at)).toBeNull());
