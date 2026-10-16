import { afterEach, describe, expect, it, vi } from 'vitest';
import { calendarDateLabel } from '../../src/app/(ops)/bookings/[bookingId]/cancel/cancel-model';

/**
 * HB-108 — ngày chỉ-ngày của SCR-35/SCR-36 hiển thị theo định dạng lịch `dd/MM/yyyy` (NFR-LOC-02),
 * hoán vị chuỗi nên **không** phụ thuộc múi giờ và không biến ngày lịch thành một mốc thời gian.
 */
describe('SCR-35/SCR-36 nhãn ngày lịch (HB-108)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('đổi ngày nghiệp vụ ISO sang dd/MM/yyyy và không còn dạng ISO', () => {
    expect(calendarDateLabel('2026-12-24')).toBe('24/12/2026');
    expect(calendarDateLabel('2026-12-26')).toBe('26/12/2026');
    expect(calendarDateLabel('2026-01-05')).toBe('05/01/2026');
    const label = calendarDateLabel('2026-12-24');
    expect(label).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(label).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('cùng kết quả bất kể TZ của máy (không diễn giải ngày lịch thành mốc thời gian)', () => {
    for (const tz of ['America/New_York', 'UTC', 'Asia/Tokyo', 'Pacific/Kiritimati']) {
      vi.stubEnv('TZ', tz);
      expect(calendarDateLabel('2026-03-01')).toBe('01/03/2026');
      expect(calendarDateLabel('2026-01-01')).toBe('01/01/2026');
      expect(calendarDateLabel('2026-12-31')).toBe('31/12/2026');
    }
  });

  it('trả nguyên văn chuỗi không phải ngày ISO-ngày để màn hình không vỡ', () => {
    expect(calendarDateLabel('—')).toBe('—');
    expect(calendarDateLabel('2026-12-24T00:00:00Z')).toBe('2026-12-24T00:00:00Z');
    expect(calendarDateLabel('')).toBe('');
  });
});
