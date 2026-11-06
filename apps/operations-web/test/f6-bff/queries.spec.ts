import { expect, test } from 'vitest';
import { run } from './spawn';

// HB-202: trần tường minh vì ca dựng tiến trình `tsx` thật.
test('query_allowlist_and_boolean_trap', () => {
  const report = run('./queries.runtime.ts');
  expect(report.caseList).toMatchObject({ limit: 10, status: 'OPEN', overdueOnly: true });
  // `z.coerce.boolean` biến "false" thành true: cờ chỉ nhận `true` hoặc vắng mặt.
  expect(report).toMatchObject({
    booleanFalseRejected: true,
    booleanJunkRejected: true,
    includeFalseRejected: true,
    unknownKeyRejected: true,
    badLimitRejected: true,
    badKeyRejected: true,
  });
  expect(report.includeTrue).toEqual({ includeCandidates: true });
  expect(report.optionsPassThrough).toEqual({ overbookingCaseId: 'k1' });
  expect(report).toMatchObject({
    forwardedStatus: 200,
    duplicateStatus: 400,
    unknownKeyStatus: 400,
    noQueryRouteStatus: 400,
  });
  expect(String(report.forwardedUrl)).toContain('/api/v1/refund-requests?');
  expect(String(report.forwardedUrl)).toContain('status=PENDING');
  expect(String(report.forwardedUrl)).toContain('limit=5');
  expect(String(report.forwardedUrl)).not.toContain('role');
  // Chỉ lần chuyển tiếp hợp lệ tới được upstream.
  expect(report.upstreamCalls).toBe(1);
}, 40_000);
