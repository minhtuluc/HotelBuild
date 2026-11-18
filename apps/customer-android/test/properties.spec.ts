import { expect, test } from 'vitest';
import { initialPropertyId } from '../src/properties';

// HB-249: khách chọn cơ sở từ danh sách công khai; API tìm phòng cần id, không phải mã như `CS-01`.
const LIST = [
  { id: 'p1', name: 'Pine Hill Đà Lạt' },
  { id: 'p2', name: 'Pine Hill Sa Pa' },
];

test('keeps the current choice when it is still in the list', () => {
  expect(initialPropertyId(LIST, 'p2')).toBe('p2');
});

test('falls back to the first property for an empty or unknown choice', () => {
  expect(initialPropertyId(LIST, '')).toBe('p1');
  expect(initialPropertyId(LIST, 'CS-01')).toBe('p1');
});

test('an empty list leaves no property selected', () => {
  expect(initialPropertyId([], 'p1')).toBe('');
});
