import { describe, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({}));
import { loadNights, nightLines } from '../src/nights';

// HB-266: màn chi tiết đơn ghi "Bảng giá theo đêm: chờ ticket hợp đồng" — nay đọc GET /bookings/{id}/nights.
describe('bảng giá theo đêm (HB-266)', () => {
  it('mỗi đêm một dòng ngày dd/MM/yyyy và số tiền máy chủ trả (nhiều phòng ghi số phòng)', () => {
    expect(
      nightLines([
        { date: '2027-01-17', amount: 1_100_000, roomCount: 1 },
        { date: '2027-01-18', amount: 2_400_000, roomCount: 2 },
      ]),
    ).toEqual([
      { key: '2027-01-17', date: '17/01/2027', amount: 1_100_000, roomCount: 1 },
      { key: '2027-01-18', date: '18/01/2027', amount: 2_400_000, roomCount: 2 },
    ]);
  });

  it('lỗi tải trả null để màn hình giữ câu "chưa xem được", không chặn chi tiết đơn', async () => {
    const view = {
      bookingId: 'b1',
      seq: 1,
      kind: 'ORIGINAL',
      capturedAt: '2026-11-19T00:00:00.000Z',
      currency: 'VND' as const,
      nights: [{ date: '2027-01-17', amount: 1_100_000, roomCount: 1 }],
      totals: { subtotal: 1_100_000, discountAmount: 0, grossAmount: 1_100_000 },
    };
    expect(await loadNights(async () => view)).toEqual(view);
    expect(
      await loadNights(async () => {
        throw new Error('offline');
      }),
    ).toBeNull();
  });
});
