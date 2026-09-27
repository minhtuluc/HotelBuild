import { describe, expect, it } from 'vitest';
import {
  formatDateTimeVn,
  formatMoney,
  formatMultiplier,
  formatRemaining,
  formatStayPeriod,
  formatStatusWithEnum,
  isBookingCode,
} from '../src/format.js';

describe('định dạng hiển thị vi-VN (§7.4)', () => {
  it('tiền là số nguyên VND, phân cách nghìn bằng dấu chấm, kèm ký hiệu ₫', () => {
    expect(formatMoney(1_100_000)).toBe('1.100.000 ₫');
    expect(formatMoney(0)).toBe('0 ₫');
  });

  it('từ chối số thực cho tiền (BR-GEN-01)', () => {
    expect(() => formatMoney(1_100_000.5)).toThrow(RangeError);
  });

  it('thời điểm hiển thị giờ Việt Nam và luôn kèm nhãn giờ VN', () => {
    expect(formatDateTimeVn('2026-11-12T07:00:00.000Z')).toBe('12/11/2026 14:00 (giờ VN)');
  });

  it('từ chối mốc thời gian không hợp lệ thay vì hiện NaN', () => {
    expect(() => formatDateTimeVn('không-phải-ngày')).toThrow(RangeError);
  });

  it('khoảng thời gian tách bằng dấu ·', () => {
    expect(formatStayPeriod(3, 2, 0)).toBe('3 đêm · 2 người lớn · 0 trẻ em');
  });

  it('thời lượng còn lại theo giờ/phút, dưới 1 giờ chỉ có phút, hết hạn trả null', () => {
    expect(formatRemaining(6 * 3_600_000 + 12 * 60_000)).toBe('còn 6 giờ 12 phút');
    expect(formatRemaining(47 * 60_000)).toBe('còn 47 phút');
    expect(formatRemaining(0)).toBeNull();
    expect(formatRemaining(-1)).toBeNull();
  });

  it('hệ số giá hai chữ số thập phân với dấu phẩy', () => {
    expect(formatMultiplier(0.85)).toBe('0,85');
    expect(formatMultiplier(1.2)).toBe('1,20');
  });

  it('mã booking đúng định dạng BR-GEN-06', () => {
    expect(isBookingCode('PH-261112-A7K2M')).toBe(true);
    expect(isBookingCode('PH-261112-A7K2')).toBe(false);
    expect(isBookingCode('BK-261112-A7K2M')).toBe(false);
  });

  it('trạng thái nội bộ hiển thị kèm mã enum', () => {
    expect(formatStatusWithEnum('Đã xác nhận', 'CONFIRMED')).toBe('Đã xác nhận (CONFIRMED)');
  });
});
