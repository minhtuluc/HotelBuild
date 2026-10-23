/**
 * HB-160: hợp đồng F8 — báo cáo, xuất báo cáo, thông báo và CRM quản trị.
 * Bám BR-REP-01 (định nghĩa chỉ số), BR-SYS-06 (gửi lại tối đa 3 lần), BR-CRM-05 + §2.14 (không xoá cứng).
 */
import { describe, expect, it } from 'vitest';
import {
  adrRevparReportSchema,
  cancellationsReportSchema,
  forceMajeureReportSchema,
  occupancyReportSchema,
  overbookingReportSchema,
  reportExportRequestSchema,
  revenueByChannelReportSchema,
} from '../src/report.js';
import {
  NOTIFICATION_MAX_RESENDS,
  notificationResendRequestSchema,
  notificationSummarySchema,
} from '../src/notification.js';
import {
  guestAnonymizeRequestSchema,
  guestBlacklistReleaseQuerySchema,
  guestBlacklistRequestSchema,
  guestLoyaltySchema,
} from '../src/guest.js';
import { buildDocument } from '../src/openapi/generate.js';

describe('báo cáo — chỉ số theo BR-REP-01', () => {
  it('công suất đếm theo đơn vị bán và trả tỷ lệ', () => {
    const parsed = occupancyReportSchema.parse({
      groupBy: 'ROOM_TYPE',
      from: '2026-12-01',
      to: '2026-12-31',
      rows: [
        {
          key: 'DLX',
          roomTypeId: 'rt1',
          soldUnits: 30,
          availableUnits: 40,
          occupancyPct: 75,
        },
      ],
    });
    expect(parsed.rows[0]?.soldUnits).toBe(30);
  });

  it('ADR/RevPAR dùng doanh thu thuần, phòng-đêm đã bán và khả dụng', () => {
    const parsed = adrRevparReportSchema.parse({
      groupBy: 'DAY',
      from: '2026-12-01',
      to: '2026-12-02',
      rows: [
        {
          key: '2026-12-01',
          businessDate: '2026-12-01',
          roomNightsSold: 20,
          roomNightsAvailable: 40,
          netRevenue: 22_000_000,
          adr: 1_100_000,
          revpar: 550_000,
        },
      ],
    });
    expect(parsed.rows[0]?.adr).toBe(1_100_000);
  });

  it('doanh thu theo kênh tách gộp/thuần/hoa hồng', () => {
    const row = revenueByChannelQueryShape().rows[0];
    expect(row?.netAmount).toBe(2_051_000);
    expect((row?.grossAmount ?? 0) - (row?.commissionAmount ?? 0)).toBe(2_051_000);
  });

  it('huỷ trả tỷ lệ huỷ và bậc chính sách đã áp (kể cả bậc −1)', () => {
    const parsed = cancellationsReportSchema.parse({
      from: '2026-12-01',
      to: '2026-12-31',
      cancellationRate: 0.12,
      rows: [
        {
          ratePlanCode: 'FLEX7',
          appliedTierOffsetHours: 72,
          cancellations: 3,
          refundAmount: 900_000,
        },
        { ratePlanCode: 'NONREF', appliedTierOffsetHours: -1, cancellations: 1, refundAmount: 0 },
      ],
    });
    expect(parsed.cancellationRate).toBeCloseTo(0.12);
    expect(parsed.rows[1]?.appliedTierOffsetHours).toBe(-1);
  });

  it('bất khả kháng và quá tải trả đủ ba cấu phần chi phí', () => {
    expect(
      forceMajeureReportSchema.safeParse({
        from: '2026-12-01',
        to: '2026-12-31',
        rows: [
          {
            bookingId: 'b1',
            propertyId: 'p1',
            cancelledAt: '2026-12-20T07:00:00Z',
            refundAmount: 1_305_000,
            note: null,
          },
        ],
      }).success,
    ).toBe(true);
    const over = overbookingReportSchema.parse({
      from: '2026-12-01',
      to: '2026-12-31',
      rows: [
        {
          caseId: 'c1',
          propertyId: 'p1',
          roomTypeId: 'rt1',
          businessDate: '2026-12-24',
          status: 'RESOLVED',
          detectedAt: '2026-12-23T07:00:00Z',
          resolvedAt: '2026-12-23T09:00:00Z',
          mergeDiscountAmount: 200_000,
          walkOutCompensationAmount: 500_000,
          transportSupportAmount: 150_000,
          totalCost: 850_000,
        },
      ],
    });
    const row = over.rows[0];
    expect(
      (row?.mergeDiscountAmount ?? 0) +
        (row?.walkOutCompensationAmount ?? 0) +
        (row?.transportSupportAmount ?? 0),
    ).toBe(row?.totalCost);
  });

  it('xuất báo cáo chỉ nhận 4 báo cáo và 2 định dạng', () => {
    expect(
      reportExportRequestSchema.safeParse({
        report: 'occupancy',
        format: 'CSV',
        params: { from: '2026-12-01', to: '2026-12-31' },
      }).success,
    ).toBe(true);
    expect(
      reportExportRequestSchema.safeParse({ report: 'profit', format: 'CSV', params: {} }).success,
    ).toBe(false);
    expect(
      reportExportRequestSchema.safeParse({ report: 'occupancy', format: 'PDF', params: {} })
        .success,
    ).toBe(false);
  });
});

describe('thông báo — BR-SYS-06', () => {
  it('danh sách che người nhận và mang số lần thử', () => {
    const parsed = notificationSummarySchema.parse({
      id: 'n1',
      bookingId: 'b1',
      channel: 'EMAIL',
      template: 'booking-confirmed',
      status: 'FAILED',
      recipientMasked: 'a***@example.com',
      retryCount: 3,
      errorMessage: 'SMTP timeout',
      sentAt: null,
      createdAt: '2026-12-24T07:00:00Z',
    });
    expect(parsed.recipientMasked).toContain('***');
    expect(parsed.retryCount).toBe(NOTIFICATION_MAX_RESENDS);
  });

  it('gửi lại bắt buộc có lý do', () => {
    expect(notificationResendRequestSchema.safeParse({ reason: 'Khách xin gửi lại' }).success).toBe(
      true,
    );
    expect(notificationResendRequestSchema.safeParse({ reason: '' }).success).toBe(false);
  });
});

describe('CRM quản trị', () => {
  it('ẩn danh hoá cần lý do + thời điểm yêu cầu; không có tuyến xoá cứng', () => {
    expect(
      guestAnonymizeRequestSchema.safeParse({
        reason: 'Khách yêu cầu xoá dữ liệu cá nhân',
        requestedAt: '2026-12-01T02:00:00Z',
      }).success,
    ).toBe(true);
    expect(guestAnonymizeRequestSchema.safeParse({ reason: 'x' }).success).toBe(false);
    const document = buildDocument();
    const guestPath = document.paths?.['/api/v1/guests/{guestId}'] ?? {};
    // HB-204 thêm GET đọc theo id; vẫn cấm mọi phương thức ghi/xoá trên chính đường dẫn này.
    expect(Object.keys(guestPath)).toEqual(['get']);
    expect(guestPath.delete).toBeUndefined();
  });

  it('hạng/điểm trả số đêm 12 tháng; danh sách đen cần lý do khi thêm và khi gỡ', () => {
    expect(
      guestLoyaltySchema.safeParse({
        guestId: 'g1',
        loyaltyTier: 'GOLD',
        loyaltyPoints: 1200,
        staysLast12Months: 6,
        totalStays: 19,
        updatedAt: '2026-12-24T07:00:00Z',
      }).success,
    ).toBe(true);
    expect(guestBlacklistRequestSchema.safeParse({ blacklistReason: 'Phá phòng' }).success).toBe(
      true,
    );
    expect(guestBlacklistReleaseQuerySchema.safeParse({ reason: 'Đã xin lỗi' }).success).toBe(true);
    expect(guestBlacklistReleaseQuerySchema.safeParse({ reason: '' }).success).toBe(false);
  });
});

/** Dựng ví dụ doanh thu theo kênh đúng hình dạng hợp đồng. */
function revenueByChannelQueryShape() {
  return revenueByChannelReportSchema.parse({
    from: '2026-12-01',
    to: '2026-12-31',
    rows: [
      {
        channelCode: 'OTA_BOOKING',
        grossAmount: 2_500_000,
        commissionAmount: 449_000,
        netAmount: 2_051_000,
        bookings: 4,
      },
    ],
  });
}
