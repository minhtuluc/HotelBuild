import { expect, test } from 'vitest';
import { run } from './spawn';

// HB-202: trần tường minh vì ca dựng tiến trình `tsx` thật.
test('catalogue_matches_spec_and_has_no_catch_all', () => {
  const report = run('./catalogue.runtime.ts');
  expect(report).toMatchObject({
    total: 29,
    writes: 19,
    uniqueIds: true,
    allProtectedAndDecoded: true,
    wired: true,
    forwards: true,
    rejects: true,
    catchAll: false,
    pinFieldNeverWhitelisted: true,
  });
}, 40_000);

// Danh sách `modules` mà bảy màn F6 khai với `useOpsSession` (HB-132…138): đọc từ spec HB-217, không từ mã màn
// (các màn nằm ở PR khác); mọi module phải có tuyến BFF trong cây `sys/`.
test('every_declared_screen_module_has_routes', () => {
  const report = run('./catalogue.runtime.ts');
  expect(report.modulesCovered).toEqual(Array.from({ length: 11 }, () => true));
}, 40_000);
