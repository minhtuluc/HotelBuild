import { expect, test } from 'vitest';
import { record, run } from './spawn';

const EXPECTED: ReadonlyArray<[number, string, string | null]> = [
  [403, 'E_OVER_APPROVAL_REQUIRED', null],
  [401, 'E_AUTH_PIN_REQUIRED', null],
  [403, 'E_AUTH_PIN_LOCKED', '900'],
  [409, 'E_INV_ROOM_TAKEN', null],
  [409, 'E_OVER_NO_CONSENT', null],
  [409, 'E_OVER_MERGE_GENDER', null],
  [409, 'E_OVER_CASE_DEADLINE_PASSED', null],
  [412, 'E_GEN_VERSION_CONFLICT', null],
  [428, 'E_GEN_PRECONDITION_REQUIRED', null],
  [409, 'E_SYS_REQUEST_IN_PROGRESS', '3'],
  [403, 'E_PAY_SELF_APPROVAL', null],
  [500, 'E_GEN_SERVICE_UNAVAILABLE', null],
];

// HB-202: trần tường minh vì ca dựng tiến trình `tsx` thật.
test('business_errors_pass_through_with_whitelisted_details', () => {
  const report = run('./errors.runtime.ts');
  const results = (Array.isArray(report.results) ? report.results : []).map((value: unknown) =>
    record(value),
  );
  // Trạng thái và mã nghiệp vụ đi qua nguyên vẹn (kể cả 401/403 của riêng lệnh), kèm Retry-After khi có.
  expect(results.map((item) => [item.status, item.code, item.retry])).toEqual(EXPECTED);
  expect(report.details).toEqual([{ field: 'reason', issue: 'REQUIRED' }]);
}, 40_000);

test('private_data_not_leaked_to_logs_or_errors', () => {
  const report = run('./errors.runtime.ts');
  const results = (Array.isArray(report.results) ? report.results : []).map((value: unknown) =>
    record(value),
  );
  expect(results.every((item) => item.clean === true)).toBe(true);
  expect(report.leaked).toEqual([]);
}, 40_000);
