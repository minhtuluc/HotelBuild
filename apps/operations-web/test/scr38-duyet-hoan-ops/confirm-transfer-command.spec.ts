/**
 * HB-215 — SCR-38: lệnh xác nhận chuyển khoản tay gửi đúng body, không tự suy `PAID`, và hiện
 * **nguyên văn** lỗi máy chủ (api.md §4.1, NFR-LOC-01).
 */
import { expect, test } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import type { RefundRequest } from '@pinehill/contracts';
import {
  commandResolved,
  intentIssue,
  transferEvidence,
  transferFailure,
} from '../../src/app/(ops)/bookings/[bookingId]/refunds/refund-command';

const request: RefundRequest = {
  id: 'refund',
  bookingId: 'booking',
  paymentId: 'original',
  policyId: 'policy',
  hoursBeforeCheckIn: 96,
  appliedTierId: 'tier',
  refundPercent: 50,
  requestedAmount: 150000,
  approvedAmount: 150000,
  refundFee: 10000,
  netRefund: 140000,
  eventNetRefund: 140000,
  requiresThresholdControl: false,
  status: 'APPROVED',
  isForceMajeure: false,
  reason: 'GUEST_REQUEST',
  evidenceRefs: [],
  requestedBy: 'maker',
  approvedBy: 'checker',
  decidedAt: '2026-10-11T00:00:00Z',
  paidAt: null,
  createdAt: '2026-10-11T00:00:00Z',
  awaitingTransferConfirmation: true,
};

const intent = { action: 'confirm-transfer' as const, target: request };

test('body chuẩn hoá: mã tham chiếu trim, ghi chú rỗng bị bỏ hẳn', () => {
  expect(transferEvidence('  FT-20261026-0001  ', '  Đã chuyển VCB  ')).toEqual({
    bankReference: 'FT-20261026-0001',
    note: 'Đã chuyển VCB',
  });
  expect(transferEvidence('FT-20261026-0001', '   ')).toEqual({
    bankReference: 'FT-20261026-0001',
  });
});

test('thiếu mã tham chiếu hoặc thiếu ghi chú/bằng chứng: chặn trước khi gửi', () => {
  expect(intentIssue(intent, '140000', 'Đã chuyển', false, '   ')).toBe('REFERENCE');
  expect(intentIssue(intent, '140000', '   ', false, 'FT-1')).toBe('NOTE');
  expect(intentIssue(intent, '140000', ' Đã chuyển ', false, ' FT-1 ')).toBeNull();
  expect(intentIssue(null, '0', '', false, '')).toBeNull();
});

test('lỗi 400/409/422 của lệnh xác nhận hiện nguyên văn câu máy chủ', () => {
  const message = 'Hồ sơ không còn khoản chi tay nào chờ xác nhận chuyển khoản.';
  for (const status of [400, 409, 422]) {
    const state = transferFailure(new ApiError({ kind: 'http', status, message }));
    if (state?.kind !== 'validationError') throw new Error('expected validationError state');
    expect(state.details).toHaveLength(1);
    expect(state.details[0]!.issue).toBe(message);
  }
  // 401/403 do luồng chung quyết định (khoá PIN/mất phạm vi); lỗi mạng là "chưa xác định".
  expect(transferFailure(new ApiError({ kind: 'http', status: 403, message: 'x' }))).toBeNull();
  expect(transferFailure(new ApiError({ kind: 'network', message: 'x' }))).toBeNull();
});

test('chỉ hồ sơ PAID do máy chủ trả mới được coi là đã chốt lệnh chuyển khoản', () => {
  const paid = { ...request, status: 'PAID' as const, awaitingTransferConfirmation: false };
  expect(commandResolved(intent, paid, 'checker', '140000')).toBe(true);
  expect(commandResolved(intent, { ...paid, status: 'APPROVED' }, 'checker', '140000')).toBe(false);
  expect(
    commandResolved(intent, { ...paid, awaitingTransferConfirmation: true }, 'checker', '0'),
  ).toBe(false);
});
