import { expect, test } from 'vitest';
import { record, run } from './spawn';

// HB-202: trần tường minh vì ca dựng cả chuỗi client → BFF → TCP thật bằng tiến trình `tsx`.
test('client_to_bff_to_upstream_round_trip', () => {
  const report = run('./roundtrip.runtime.ts');
  expect(report.mapping).toEqual({
    calls: 1,
    key: 'babc0000-0000-4000-8000-0000000000aa',
    tag: '"2"',
    etag: '"3"',
    replayed: true,
    version: 2,
  });
  // Lệnh 🔒: trình duyệt gửi lại cùng khoá/`If-Match`/thân (PIN trong thân, không trong URL); upstream áp dụng đúng một lần.
  expect(report.approve).toEqual({
    calls: 2,
    sameKey: true,
    sameTag: true,
    sameBody: true,
    pinInBody: true,
    pinNotInUrl: true,
    appliedOnce: 1,
    etag: '"8"',
    status: 'APPROVED',
  });
  expect(String(record(report.refunds).url)).toContain('status=PENDING');
  expect(record(report.refunds).total).toBe(0);
  // PIN sai (401): đúng một lần tới upstream, không làm mới phiên rồi gửi lại (không đếm hai lần vào ngưỡng khoá).
  expect(report.pin).toEqual({
    status: 401,
    upstreamCalls: 1,
    reauthorized: 0,
    bodyHasPin: true,
    pinTokenHeaderless: true,
  });
}, 40_000);
