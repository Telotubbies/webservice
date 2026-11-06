import { expect, test } from 'bun:test';
import { fmtDuration, localName } from './names';

test('seeded English names get Thai; unknown and English pass through', () => {
  expect(localName('Sorting line 1', 'th')).toBe('สายคัดแยก 1');
  expect(localName('Sorting line 1', 'en')).toBe('Sorting line 1');
  expect(localName('Custom machine', 'th')).toBe('Custom machine');
  expect(localName(null, 'th')).toBe('');
});

test('durations carry a unit for the language', () => {
  expect(fmtDuration(180, 'en')).toBe('3 min');
  expect(fmtDuration(180, 'th')).toBe('3 นาที');
  expect(fmtDuration(5400, 'th')).toBe('1.5 ชม.');
});
