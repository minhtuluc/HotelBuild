import { describe, expect, it } from 'vitest';
import {
  formatCalendarDate,
  formatStayNights,
  formatStaySpan,
} from '../../src/app/(guest)/bookings/stay-format';

describe('SCR-12 định dạng kỳ lưu trú theo ngày lịch (HB-104)', () => {
  it('đổi ngày lịch ISO sang dd/MM/yyyy mà không dựng Date', () => {
    expect(formatCalendarDate('2026-10-12')).toBe('12/10/2026');
    expect(formatCalendarDate('2026-01-05')).toBe('05/01/2026');
    expect(formatCalendarDate('2026-12-31')).toBe('31/12/2026');
  });

  it('giữ nguyên chuỗi khi không phải ngày lịch để lộ dữ liệu lạ thay vì đoán', () => {
    expect(formatCalendarDate('không-phải-ngày')).toBe('không-phải-ngày');
    expect(formatCalendarDate('')).toBe('');
  });

  it('dựng câu kỳ mới bằng danh mục: ngày dd/MM/yyyy và chữ "đêm"', () => {
    expect(formatStayNights('2026-10-12', '2026-10-15', 3)).toBe('12/10/2026 → 15/10/2026 · 3 đêm');
    expect(formatStayNights('2026-10-12', '2026-10-13', 1)).toBe('12/10/2026 → 13/10/2026 · 1 đêm');
  });

  it('dựng câu kỳ đang giữ/kết quả kèm số đêm và số khách', () => {
    expect(formatStaySpan('2026-10-10', '2026-10-11', '1 đêm · 2 người lớn · 0 trẻ em')).toBe(
      '10/10/2026 → 11/10/2026 · 1 đêm · 2 người lớn · 0 trẻ em',
    );
  });
});
