import { describe, expect, it } from 'vitest';
import { ApiError, isApiError } from '@pinehill/api-client';
import type { Payment } from '@pinehill/contracts';
import {
  COLLECT_METHODS,
  COLLECT_TYPES,
  amountIssue,
  canSendPayment,
  pinFailure,
  pinIssue,
  receiptLines,
  suggestedAmount,
  pinGrantValid,
} from '../../src/app/(ops)/bookings/[bookingId]/collect/collect-model';

const PAYMENT: Payment = {
  paymentId: 'pay-1',
  bookingId: 'b1',
  type: 'DEPOSIT',
  method: 'CASH',
  amount: 600_000,
  status: 'SUCCEEDED',
  providerTxnId: null,
  paymentUrl: null,
  expiresAt: null,
  paidAt: '2026-12-02T03:00:00.000Z',
  createdAt: '2026-12-02T03:00:00.000Z',
};

describe('SCR-37 thu tiền tại quầy (HB-109)', () => {
  it('biên lai hiện đúng người thu từ server, không suy từ phiên đang mở', () => {
    const payment = { ...PAYMENT, createdBy: 'synthetic-original-collector' };
    expect(
      receiptLines(payment).find((line) => line.key === 'ops.collect.receipt.createdBy')?.value,
    ).toBe('synthetic-original-collector');
  });

  it('không suy khoản cọc còn thiếu từ paidAmount đã gồm các nghĩa vụ khác (BR-PAY-02)', () => {
    expect(
      suggestedAmount(
        { depositAmount: 600_000 },
        { paidAmount: 250_499, balanceDue: 1_749_501 },
        'DEPOSIT',
      ),
    ).toBe(600_000);
  });

  it('PIN grant hết hạn tại đúng expiresAt server, không dùng token rỗng hoặc thời hạn lỗi', () => {
    const now = Date.parse('2026-12-02T03:00:00.000Z');
    const grant = { pinToken: 'synthetic-valid-pin-token', expiresAt: '2026-12-02T03:05:00.000Z' };
    expect(pinGrantValid(grant, now)).toBe(true);
    expect(pinGrantValid(grant, now + 300_000)).toBe(false);
    expect(pinGrantValid(null, now)).toBe(false);
    expect(pinGrantValid({ ...grant, pinToken: '' }, now)).toBe(false);
    expect(pinGrantValid({ ...grant, expiresAt: 'bad' }, now)).toBe(false);
  });

  it('không gửi giá trị đã mất độ chính xác số nguyên', () => {
    expect(amountIssue('9007199254740993', Number.MAX_SAFE_INTEGER)).toBe('FORMAT');
  });
  it('PIN phải là 6 chữ số và chỉ gửi tiền khi PIN đã xác thực (AC1)', () => {
    expect(pinIssue('123456')).toBeNull();
    expect(pinIssue('12345')).toBe('FORMAT');
    expect(pinIssue('12345a')).toBe('FORMAT');
    expect(canSendPayment('verified', null)).toBe(true);
    for (const step of ['idle', 'verifying', 'locked'] as const) {
      expect(canSendPayment(step, null)).toBe(false);
    }
    // Số tiền sai thì dù PIN đúng cũng không gửi.
    expect(canSendPayment('verified', 'OVER')).toBe(false);
  });

  it('PIN sai thì cho nhập lại; PIN bị khoá thì dừng phiên và giữ thời gian chờ', () => {
    expect(pinFailure(new Error('x'), isApiError)).toEqual({
      locked: false,
      retryAfterSeconds: null,
    });
    const locked = new ApiError({
      kind: 'http',
      message: 'PIN bị khoá',
      status: 403,
      code: 'E_AUTH_PIN_LOCKED',
      retryAfterSeconds: 900,
    });
    const failure = pinFailure(locked, isApiError);
    expect(failure.locked).toBe(true);
    expect(failure.retryAfterSeconds).toBe(900);
  });

  it('kiểm số tiền tại chỗ nhưng máy chủ vẫn là nơi quyết định (BR-PAY-01/02)', () => {
    expect(amountIssue('600000', 600_000)).toBeNull();
    expect(amountIssue('600001', 600_000)).toBe('OVER');
    expect(amountIssue('0', 600_000)).toBe('POSITIVE');
    expect(amountIssue('60.000', 600_000)).toBe('FORMAT');
    expect(amountIssue('', 600_000)).toBe('FORMAT');
  });

  it('dùng đúng depositAmount hoặc balanceDue máy chủ trả, không tự phân bổ paidAmount', () => {
    expect(
      suggestedAmount(
        { depositAmount: 600_000 },
        { paidAmount: 0, balanceDue: 2_000_000 },
        'DEPOSIT',
      ),
    ).toBe(600_000);
    expect(
      suggestedAmount(
        { depositAmount: 600_000 },
        { paidAmount: 600_000, balanceDue: 1_400_000 },
        'DEPOSIT',
      ),
    ).toBe(600_000);
    expect(
      suggestedAmount(
        { depositAmount: 600_000 },
        { paidAmount: 600_000, balanceDue: 1_400_000 },
        'BALANCE',
      ),
    ).toBe(1_400_000);
  });

  it('chỉ hai loại thu và hai phương thức tại quầy, không có dữ liệu thẻ', () => {
    expect(COLLECT_TYPES).toEqual(['DEPOSIT', 'BALANCE']);
    expect(COLLECT_METHODS).toEqual(['CASH', 'BANK_TRANSFER']);
  });

  it('biên lai lấy nguyên trường Payment máy chủ trả', () => {
    expect(receiptLines(PAYMENT).map((line) => line.key)).toEqual([
      'ops.collect.receipt.id',
      'ops.collect.receipt.booking',
      'ops.collect.receipt.type',
      'ops.collect.receipt.method',
      'ops.collect.receipt.amount',
      'ops.collect.receipt.status',
      'ops.collect.receipt.createdBy',
    ]);
    expect(
      receiptLines(PAYMENT).find((line) => line.key === 'ops.collect.receipt.amount')?.value,
    ).toBe('600000');
  });
});
