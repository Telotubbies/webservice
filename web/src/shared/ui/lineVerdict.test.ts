import { expect, test } from 'bun:test';
import { VERDICT_TONE, lineVerdict } from './lineVerdict';

test('stopped uses the neutral tone', () => {
  expect(VERDICT_TONE.stopped).not.toContain('danger');
  expect(VERDICT_TONE.stopped).toContain('neutral-soft');
});
test('dead feed reads stale, never stopped', () =>
  expect(lineVerdict({ hasSample: true, fresh: true, wsOpen: false, running: false })).toBe('stale'));
test('no sample reads nodata', () =>
  expect(lineVerdict({ hasSample: false, fresh: false, wsOpen: true, running: false })).toBe('nodata'));
test('fresh sample on a live feed reads its value', () => {
  expect(lineVerdict({ hasSample: true, fresh: true, wsOpen: true, running: true })).toBe('running');
  expect(lineVerdict({ hasSample: true, fresh: true, wsOpen: true, running: false })).toBe('stopped');
});
