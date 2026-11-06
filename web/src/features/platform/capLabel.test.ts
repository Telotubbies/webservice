import { expect, test } from 'bun:test';
import { capLabelKey } from './capLabel';

test('every usage key the API returns has a label key', () => {
  for (const k of ['sites', 'edges', 'tags', 'members', 'cameras', 'gpu_hours', 'storage_gb']) {
    expect(capLabelKey(k)).not.toBe('capOther');
  }
  expect(capLabelKey('max_tags')).toBe('capTags');
  expect(capLabelKey('mystery')).toBe('capOther');
});
