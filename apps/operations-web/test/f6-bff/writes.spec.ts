import { expect, test } from 'vitest';
import { run } from './spawn';

// HB-202: trần tường minh vì ca dựng tiến trình `tsx` thật + API giả qua TCP.
const report = (): Record<string, unknown> => run('./writes.runtime.ts');

test('csrf_key_and_session_required', () => {
  const result = report();
  expect(result.writes).toBe(19);
  expect(result.gates).toEqual({
    csrf: Array(19).fill(403),
    noKey: Array(19).fill(400),
    badKey: Array(19).fill(400),
    noSession: Array(19).fill(401),
  });
  expect(result.gateCalls).toBe(0);
}, 40_000);

test('etag_if_match_and_replay_headers', () => {
  expect(report().passes).toEqual({
    'mappings.put': true,
    'deliveries.retry': true,
    'cases.resolve': true,
    'moves.execute': true,
    'pin.verify': true,
  });
}, 40_000);

test('body_validation_and_response_stripping', () => {
  const result = report();
  expect(result.invalidStatuses).toEqual([400, 400, 400, 400]);
  expect(result.invalidCodes).toEqual(Array(4).fill('E_GEN_VALIDATION_FAILED'));
  // Chỉ lần cuối (thân hợp lệ, upstream 422) tới upstream; chi tiết chỉ qua danh sách trắng.
  expect(result.noUpstreamForInvalid).toBe(true);
  expect(result.details).toEqual([{ field: 'providerRoomTypeCode', issue: 'DUPLICATE' }]);
}, 40_000);
