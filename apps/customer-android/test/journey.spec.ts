/** HB-276 — chọn nhanh số đêm và dòng ngày dưới ô ngày, như vé tìm phòng của web (HB-317). */
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({}));
import { setLocale } from '../src/i18n/locale';
import { QUICK_NIGHTS, activeNights, stayDateLine, todayVn, withNights } from '../src/journey';

afterEach(() => setLocale('vi'));

describe('HB-276 chọn nhanh số đêm', () => {
  it('có 2/3/5 đêm như web', () => {
    expect(QUICK_NIGHTS).toEqual([2, 3, 5]);
  });

  it('điền ngày trả từ ngày nhận đang chọn; chưa có ngày nhận thì lấy hôm nay (giờ VN)', () => {
    expect(withNights('2026-12-30', 3, '2026-11-20')).toEqual({
      checkIn: '2026-12-30',
      checkOut: '2027-01-02',
    });
    expect(withNights('', 2, '2026-11-20')).toEqual({
      checkIn: '2026-11-20',
      checkOut: '2026-11-22',
    });
    expect(withNights('2026-02-30', 2, '2026-11-20').checkIn).toBe('2026-11-20');
  });

  it('nút đang chọn khớp số đêm hiện tại', () => {
    expect(activeNights('2026-12-01', '2026-12-04')).toBe(3);
    expect(activeNights('2026-12-01', '2026-12-05')).toBeNull();
    expect(activeNights('', '2026-12-05')).toBeNull();
  });

  it('hôm nay theo giờ Việt Nam', () => {
    expect(todayVn(Date.parse('2026-11-19T17:00:00Z'))).toBe('2026-11-20');
  });
});

describe('HB-276 dòng ngày dưới ô ngày', () => {
  it('thứ và ngày theo ngôn ngữ; chuỗi chưa phải ngày thì không hiện', () => {
    expect(stayDateLine('2026-12-24')).toBe('T5, 24/12/2026');
    setLocale('en');
    expect(stayDateLine('2026-12-24')).toBe('Thu, 24/12/2026');
    expect(stayDateLine('2026-12')).toBeNull();
  });
});
