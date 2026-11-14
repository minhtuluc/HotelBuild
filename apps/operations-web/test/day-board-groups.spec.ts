import { describe, expect, it } from 'vitest';
import type { DayBoard, DayBoardBooking } from '@pinehill/contracts';
import { checkBoard, orderGroup, pendingCount } from '../src/app/(ops)/day-board/model';

const booking = (code: string, status: DayBoardBooking['status']): DayBoardBooking => ({
  bookingId: `id-${code}`,
  code,
  guestName: 'Khách tổng hợp',
  roomTypeId: 'rt1',
  roomCount: 1,
  checkIn: '2026-12-24',
  checkOut: '2026-12-26',
  status,
  channelCode: 'WEB',
  balanceDue: 0,
});

const group = (items: DayBoardBooking[], total = items.length) => ({
  total,
  items,
  truncated: total > items.length,
});

const board = (patch: Partial<DayBoard> = {}): DayBoard => ({
  propertyId: 'p1',
  date: '2026-12-24',
  capturedAt: '2026-12-24T01:00:00.000Z',
  arrivals: group([]),
  departures: group([]),
  inHouse: group([]),
  overbooking: { openFromDate: 0, onDate: 0 },
  degradedChannels: [],
  ...patch,
});

describe('HB-309 bảng ngày SCR-23', () => {
  it('chỉ nhận bảng đúng cơ sở và ngày đang xem', () => {
    expect(checkBoard(board(), 'p1', '2026-12-24').date).toBe('2026-12-24');
    expect(() => checkBoard(board(), 'p2', '2026-12-24')).toThrow();
    expect(() => checkBoard(board(), 'p1', '2026-12-25')).toThrow();
  });

  it('từ chối nhóm có nhiều dòng hơn tổng máy chủ đếm', () => {
    const broken = board({
      arrivals: { total: 0, items: [booking('A', 'CONFIRMED')], truncated: false },
    });
    expect(() => checkBoard(broken, 'p1', '2026-12-24')).toThrow();
  });

  it('đưa khách chưa làm thủ tục lên đầu, giữ thứ tự mã trong mỗi nhóm', () => {
    const items = [
      booking('B2', 'CHECKED_IN'),
      booking('B3', 'CONFIRMED'),
      booking('B1', 'CONFIRMED'),
    ];
    expect(orderGroup('arrivals', items).map((item) => item.code)).toEqual(['B1', 'B3', 'B2']);
    const leaving = [booking('C1', 'CHECKED_OUT'), booking('C2', 'CHECKED_IN')];
    expect(orderGroup('departures', leaving).map((item) => item.code)).toEqual(['C2', 'C1']);
  });

  it('đếm khách còn phải nhận / trả phòng trên các dòng máy chủ trả', () => {
    const arrivals = [booking('A1', 'CONFIRMED'), booking('A2', 'CHECKED_IN')];
    expect(pendingCount('arrivals', arrivals)).toBe(1);
    expect(pendingCount('departures', [booking('D1', 'CHECKED_IN')])).toBe(1);
  });
});
