import { describe, expect, test } from 'vitest';
import {
  adrRevparReportSchema,
  cancellationsReportSchema,
  errorBodySchema,
  forceMajeureReportSchema,
  occupancyReportSchema,
  overbookingReportSchema,
  revenueByChannelReportSchema,
} from '@pinehill/contracts';
import { http, login, report } from './http-fixture.js';
import {
  propertyId,
  otherPropertyId,
  stay,
  wide,
  booking5,
  caseId,
  caseDormId,
  typeId,
  dormTypeId,
} from './seed.js';

/**
 * HB-162 — 6 báo cáo đọc trên dữ liệu thật. Mọi con số dưới đây tính tay từ `seed.ts`:
 * - phòng-đêm khả dụng: STD 1 đơn vị/phòng, DOR đếm theo **giường** (6), trừ `room_blocks` ngày 11-02;
 * - đã bán: mỗi `booking_rooms` của booking `CONFIRMED/CHECKED_OUT` = một đơn vị mỗi đêm;
 * - doanh thu thuần: `booking_charges kind='ROOM'` trừ hoa hồng snapshot phân bổ theo tỷ lệ.
 */

const ROLES = [
  'OWNER',
  'MANAGER',
  'FRONT_DESK',
  'RESERVATION_AGENT',
  'ACCOUNTANT',
  'HOUSEKEEPING',
  'SYSADMIN',
] as const;

describe('HB-162 · GET /reports/occupancy', () => {
  test('công suất theo ngày: DOR đếm theo giường, trừ phòng bị khoá, phạm vi cơ sở của MANAGER', async () => {
    const token = await login('MANAGER');
    const response = await report('occupancy', token, { from: stay.from, to: stay.to });
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = occupancyReportSchema.parse(response.body);
    expect(body.groupBy).toBe('DAY');
    expect(
      body.rows.map((row) => [row.key, row.soldUnits, row.availableUnits, row.occupancyPct]),
    ).toEqual([
      ['2026-11-01', 2, 8, 25],
      ['2026-11-02', 2, 7, 28.57],
      ['2026-11-03', 1, 8, 12.5],
    ]);
  });

  test('theo loại phòng: STD 4/5, DOR 1/18 giường', async () => {
    const token = await login('MANAGER');
    const response = await report('occupancy', token, {
      from: stay.from,
      to: stay.to,
      groupBy: 'ROOM_TYPE',
    });
    const body = occupancyReportSchema.parse(response.body);
    const byType = new Map(body.rows.map((row) => [row.roomTypeId, row]));
    expect(byType.get(typeId)).toMatchObject({
      soldUnits: 4,
      availableUnits: 5,
      occupancyPct: 80,
    });
    expect(byType.get(dormTypeId)).toMatchObject({
      soldUnits: 1,
      availableUnits: 18,
      occupancyPct: 5.56,
    });
  });

  test('theo cơ sở: OWNER thấy cả hai cơ sở, MANAGER chỉ cơ sở trong phạm vi', async () => {
    const owner = await login('OWNER');
    const ownerBody = occupancyReportSchema.parse(
      (await report('occupancy', owner, { from: stay.from, to: stay.to, groupBy: 'PROPERTY' }))
        .body,
    );
    expect(
      new Map(ownerBody.rows.map((row) => [row.propertyId, [row.soldUnits, row.availableUnits]])),
    ).toEqual(
      new Map([
        [propertyId, [5, 23]],
        [otherPropertyId, [1, 3]],
      ]),
    );
    const manager = await login('MANAGER');
    const managerBody = occupancyReportSchema.parse(
      (await report('occupancy', manager, { from: stay.from, to: stay.to, groupBy: 'PROPERTY' }))
        .body,
    );
    expect(managerBody.rows.map((row) => row.propertyId)).toEqual([propertyId]);
  });

  test('cơ sở ngoài phạm vi trả 403 E_AUTH_OUT_OF_SCOPE', async () => {
    const token = await login('MANAGER');
    const response = await report('occupancy', token, {
      from: stay.from,
      to: stay.to,
      propertyId: otherPropertyId,
    });
    expect(response.status).toBe(403);
    expect(errorBodySchema.parse(response.body).code).toBe('E_AUTH_OUT_OF_SCOPE');
  });

  test('thiếu tham số và kỳ sai trả 400; kỳ vượt 366 ngày bị chặn', async () => {
    const token = await login('MANAGER');
    const invalidQueries: readonly Record<string, string>[] = [
      {},
      { from: stay.from },
      { from: stay.to, to: stay.from },
      { from: '2020-01-01', to: '2021-06-01' },
      { from: '2026-02-30', to: stay.to },
    ];
    for (const query of invalidQueries) {
      const response = await report('occupancy', token, query);
      expect(response.status, JSON.stringify(query)).toBe(400);
      expect(errorBodySchema.parse(response.body).code).toBe('E_GEN_VALIDATION_FAILED');
    }
  });
});

describe('HB-162 · GET /reports/adr-revpar', () => {
  test('ADR/RevPAR trên doanh thu thuần, số nguyên HALF_UP', async () => {
    const token = await login('MANAGER');
    const response = await report('adr-revpar', token, { from: stay.from, to: stay.to });
    expect(response.status).toBe(200);
    const body = adrRevparReportSchema.parse(response.body);
    expect(
      body.rows.map((row) => [
        row.key,
        row.roomNightsSold,
        row.roomNightsAvailable,
        row.netRevenue,
        row.adr,
        row.revpar,
      ]),
    ).toEqual([
      ['2026-11-01', 2, 8, 1_270_000, 635_000, 158_750],
      // Hoa hồng lấy theo **từng đêm** trong snapshot (11-02: 100.000; 11-03: 188.000).
      ['2026-11-02', 2, 7, 1_700_000, 850_000, 242_857],
      ['2026-11-03', 1, 8, 612_000, 612_000, 76_500],
    ]);
  });
});

describe('HB-162 · GET /reports/revenue-by-channel', () => {
  test('gộp − hoa hồng = thuần, đọc từ snapshot lúc bán (không dùng cấu hình kênh hiện tại)', async () => {
    const token = await login('ACCOUNTANT');
    const response = await report('revenue-by-channel', token, { from: stay.from, to: stay.to });
    expect(response.status).toBe(200);
    const body = revenueByChannelReportSchema.parse(response.body);
    expect(body.rows.filter((row) => row.grossAmount > 0)).toEqual([
      {
        channelCode: 'AGENCY',
        grossAmount: 300_000,
        commissionAmount: 30_000,
        netAmount: 270_000,
        bookings: 1,
      },
      {
        channelCode: 'OTA_BOOKING',
        grossAmount: 1_600_000,
        commissionAmount: 288_000,
        netAmount: 1_312_000,
        bookings: 1,
      },
      {
        channelCode: 'WEB',
        grossAmount: 2_000_000,
        commissionAmount: 0,
        netAmount: 2_000_000,
        bookings: 1,
      },
    ]);
  });
});

describe('HB-162 · GET /reports/cancellations', () => {
  test('tỷ lệ huỷ theo BR-REP-01 và bảng bậc chính sách đã áp', async () => {
    const token = await login('ACCOUNTANT');
    const response = await report('cancellations', token, { from: wide.from, to: wide.to });
    expect(response.status).toBe(200);
    const body = cancellationsReportSchema.parse(response.body);
    // 6 booking tạo trong kỳ (5 ở FLEX7 + 1 ở SAVER3), 2 đã huỷ → 0,33.
    expect(body.cancellationRate).toBe(0.33);
    expect(body.rows).toEqual([
      {
        ratePlanCode: 'FLEX7',
        // Bậc canonical trong CSDL (`offset_hours = 24`), không đổi sang nhãn bắt tất.
        appliedTierOffsetHours: 24,
        cancellations: 1,
        refundAmount: 500_000,
      },
    ]);
  });

  test('lọc theo gói giá áp cho cả tử số và mẫu số của tỷ lệ huỷ', async () => {
    const token = await login('ACCOUNTANT');
    const body = cancellationsReportSchema.parse(
      (
        await report('cancellations', token, {
          from: wide.from,
          to: wide.to,
          ratePlanCode: 'FLEX7',
        })
      ).body,
    );
    // Chỉ còn 5 booking FLEX7 trong kỳ, 2 đã huỷ → 0,4.
    expect(body.cancellationRate).toBe(0.4);
    expect(body.rows).toHaveLength(1);
  });
});

describe('HB-162 · GET /reports/force-majeure', () => {
  test('chỉ OWNER đọc, kèm lý do của hồ sơ huỷ', async () => {
    const manager = await login('MANAGER');
    expect((await report('force-majeure', manager, { from: wide.from, to: wide.to })).status).toBe(
      403,
    );
    const owner = await login('OWNER');
    const response = await report('force-majeure', owner, { from: wide.from, to: wide.to });
    expect(response.status).toBe(200);
    const body = forceMajeureReportSchema.parse(response.body);
    expect(body.rows).toEqual([
      {
        bookingId: booking5,
        propertyId,
        cancelledAt: '2026-11-20T01:00:00.000Z',
        refundAmount: 1_200_000,
        note: 'Bão lũ miền Trung',
      },
    ]);
  });
});

describe('HB-162 · GET /reports/overbooking', () => {
  test('chi phí xử lý = ghép phòng + walk-out + đưa đón', async () => {
    const token = await login('MANAGER');
    const response = await report('overbooking', token, { from: stay.from, to: stay.to });
    expect(response.status).toBe(200);
    const body = overbookingReportSchema.parse(response.body);
    expect(new Map(body.rows.map((row) => [row.roomTypeId, row]))).toEqual(
      new Map([
        [
          typeId,
          {
            caseId,
            propertyId,
            roomTypeId: typeId,
            businessDate: '2026-11-02',
            status: 'OPEN',
            detectedAt: '2026-11-01T15:00:00.000Z',
            resolvedAt: null,
            mergeDiscountAmount: 150_000,
            walkOutCompensationAmount: 700_000,
            transportSupportAmount: 200_000,
            totalCost: 1_050_000,
          },
        ],
        // Ca cùng ngày nhưng khác loại phòng: không được nhận chi phí của ca STD.
        [
          dormTypeId,
          {
            caseId: caseDormId,
            propertyId,
            roomTypeId: dormTypeId,
            businessDate: '2026-11-02',
            status: 'PROPOSED',
            detectedAt: '2026-11-01T16:00:00.000Z',
            resolvedAt: null,
            mergeDiscountAmount: 0,
            walkOutCompensationAmount: 0,
            transportSupportAmount: 0,
            totalCost: 0,
          },
        ],
      ]),
    );
    const filtered = await report('overbooking', token, {
      from: stay.from,
      to: stay.to,
      status: 'RESOLVED',
    });
    expect(overbookingReportSchema.parse(filtered.body).rows).toEqual([]);
  });
});

describe('HB-162 · RBAC theo vai trò (api.md §2.12, §6.3)', () => {
  const allowed: Readonly<Record<string, readonly string[]>> = {
    occupancy: ['OWNER', 'MANAGER'],
    'adr-revpar': ['OWNER', 'MANAGER'],
    'revenue-by-channel': ['OWNER', 'ACCOUNTANT'],
    cancellations: ['OWNER', 'ACCOUNTANT'],
    'force-majeure': ['OWNER'],
    overbooking: ['OWNER', 'MANAGER'],
  };

  test('mỗi báo cáo chỉ mở cho đúng tập vai trò, còn lại 403 E_RBAC_FORBIDDEN', async () => {
    for (const [path, roles] of Object.entries(allowed)) {
      for (const role of ROLES) {
        const token = await login(role);
        const response = await report(path, token, { from: stay.from, to: stay.to });
        if (roles.includes(role)) {
          expect(response.status, `${role} ${path}`).toBe(200);
        } else {
          expect(response.status, `${role} ${path}`).toBe(403);
          expect(errorBodySchema.parse(response.body).code).toBe('E_RBAC_FORBIDDEN');
        }
      }
    }
  });

  test('không có token bị từ chối ở tầng xác thực', async () => {
    const response = await http().get('/api/v1/reports/occupancy');
    expect(response.status).toBe(401);
  });
});
