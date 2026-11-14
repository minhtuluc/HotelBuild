import { describe, expect, it } from 'vitest';
import { ALL_PROPERTIES, bookingPropertyFilter } from '../../src/app/(ops)/bookings/bookings-model';

/** HB-320 (TD-44) — ô "Cơ sở" của SCR-31: URL > cơ sở đang làm việc > tất cả; chỉ id máy chủ trả. */
describe('bookingPropertyFilter', () => {
  const available = [{ id: 'p-dl' }, { id: 'p-vt' }];

  it('giữ cơ sở chọn trên URL nếu có trong danh sách', () => {
    expect(bookingPropertyFilter('p-vt', available, 'p-dl')).toBe('p-vt');
  });

  it('không có cơ sở trên URL thì lọc theo cơ sở đang làm việc', () => {
    expect(bookingPropertyFilter('', available, 'p-vt')).toBe('p-vt');
  });

  it('chọn "tất cả" thì không lọc theo cơ sở, kể cả khi có cơ sở đang làm việc', () => {
    expect(bookingPropertyFilter(ALL_PROPERTIES, available, 'p-dl')).toBe(ALL_PROPERTIES);
  });

  it('id ngoài danh sách máy chủ trả bị bỏ qua', () => {
    expect(bookingPropertyFilter('p-khac', available, 'p-dl')).toBe('p-dl');
    expect(bookingPropertyFilter('p-khac', available, 'p-ngoai')).toBe(ALL_PROPERTIES);
  });

  it('không có cơ sở đang làm việc hoặc danh sách rỗng thì xem tất cả', () => {
    expect(bookingPropertyFilter('', available, '')).toBe(ALL_PROPERTIES);
    expect(bookingPropertyFilter('p-dl', [], 'p-dl')).toBe(ALL_PROPERTIES);
  });
});
