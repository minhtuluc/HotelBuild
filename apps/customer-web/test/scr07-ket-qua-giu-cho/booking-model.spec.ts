import { describe, expect, it } from 'vitest';
import {
  continueAction,
  continueHref,
  formatCountdown,
  holdView,
  moneyRows,
  remainingMs,
} from '../../src/app/(guest)/booking/booking-model';

const NOW = Date.parse('2026-12-24T10:00:00.000Z');
const at = (offsetMs: number): string => new Date(NOW + offsetMs).toISOString();

describe('SCR-07 đếm ngược giữ chỗ (HB-083)', () => {
  it('lấy hạn từ mốc máy chủ trả, không cộng trừ đồng hồ máy khách', () => {
    expect(remainingMs(at(900_000), NOW)).toBe(900_000);
    expect(remainingMs(at(-1), NOW)).toBe(0);
    expect(remainingMs(null, NOW)).toBeNull();
    expect(remainingMs('không-phải-mốc-thời-gian', NOW)).toBeNull();
  });

  it('định dạng mm:ss và chuyển sang h:mm:ss khi từ 1 giờ', () => {
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(-5_000)).toBe('00:00');
    expect(formatCountdown(61_000)).toBe('01:01');
    expect(formatCountdown(3_600_000)).toBe('1:00:00');
    expect(formatCountdown(3_661_000)).toBe('1:01:01');
  });

  it('chỉ đếm khi booking còn giữ chỗ; đã huỷ/đã xác nhận thì không hiện đồng hồ', () => {
    expect(holdView({ status: 'HELD', holdExpiresAt: at(60_000) }, NOW).kind).toBe('active');
    expect(holdView({ status: 'HELD', holdExpiresAt: at(0) }, NOW).kind).toBe('expired');
    expect(holdView({ status: 'PENDING_PAYMENT', holdExpiresAt: at(-1) }, NOW).kind).toBe(
      'expired',
    );
    expect(holdView({ status: 'CANCELLED', holdExpiresAt: at(60_000) }, NOW).kind).toBe('none');
    expect(holdView({ status: 'CONFIRMED', holdExpiresAt: null }, NOW).kind).toBe('none');
    expect(holdView({ status: 'HELD', holdExpiresAt: null }, NOW).kind).toBe('none');
  });

  it('hết hạn giữ chỗ thì khoá nút tiếp tục (AC1)', () => {
    const held = { status: 'HELD' as const, balanceDue: 1_400_000 };
    expect(
      continueAction(held, holdView({ status: 'HELD', holdExpiresAt: at(60_000) }, NOW)),
    ).toEqual({ kind: 'pay' });
    expect(continueAction(held, holdView({ status: 'HELD', holdExpiresAt: at(-1) }, NOW))).toEqual({
      kind: 'locked',
    });
    expect(
      continueAction(
        { status: 'CONFIRMED', balanceDue: 0 },
        holdView({ status: 'CONFIRMED', holdExpiresAt: null }, NOW),
      ),
    ).toEqual({ kind: 'none' });
    expect(
      continueAction(
        { status: 'HELD', balanceDue: 0 },
        holdView({ status: 'HELD', holdExpiresAt: at(60_000) }, NOW),
      ),
    ).toEqual({ kind: 'none' });
  });

  it('bảng tiền giữ tổng và còn phải trả, chỉ thêm dòng đã trả/phạt khi có phát sinh', () => {
    expect(
      moneyRows({
        totalAmount: 2_000_000,
        depositAmount: 600_000,
        paidAmount: 0,
        penaltyAmount: 0,
        balanceDue: 2_000_000,
      }).map((row) => row.key),
    ).toEqual(['total', 'deposit', 'balance']);
    expect(
      moneyRows({
        totalAmount: 2_000_000,
        depositAmount: 600_000,
        paidAmount: 600_000,
        penaltyAmount: 200_000,
        balanceDue: 1_600_000,
      }).map((row) => row.key),
    ).toEqual(['total', 'deposit', 'paid', 'penalty', 'balance']);
  });

  it('đích "tiếp tục thanh toán" là màn thanh toán của đúng booking', () => {
    expect(continueHref('abc 123')).toBe('/booking/abc%20123/pay');
  });
});
