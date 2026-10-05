/**
 * HB-140: hợp đồng F7 — tiền sảnh, buồng phòng (projection tối thiểu), khách tại quầy, chốt đối soát.
 * Mỗi ví dụ dưới đây bám api.md §2.9/§2.10/§2.13 và BR tương ứng.
 */
import { describe, expect, it } from 'vitest';
import {
  checkInRequestSchema,
  checkInResponseSchema,
  checkOutRequestSchema,
  checkOutResponseSchema,
  noShowResponseSchema,
} from '../src/front-office.js';
import {
  housekeepingTaskSchema,
  housekeepingTaskUpdateRequestSchema,
} from '../src/housekeeping.js';
import { guestCreateRequestSchema, guestSummarySchema } from '../src/guest.js';
import {
  reconciliationCloseRequestSchema,
  reconciliationCloseResponseSchema,
} from '../src/reconciliation.js';
import { errorCatalogue } from '../src/errors.js';

const CHECK_IN_RESPONSE = {
  bookingId: 'b1',
  status: 'CHECKED_IN',
  roomIds: ['r1'],
  checkedInAt: '2026-12-24T07:00:00Z',
  earlyCheckInFee: 0,
};

const CHECK_OUT_RESPONSE = {
  bookingId: 'b1',
  status: 'CHECKED_OUT',
  checkedOutAt: '2026-12-27T04:00:00Z',
  extrasAmount: 120000,
  feeAmount: 550000,
  balanceDue: 0,
  housekeepingTaskIds: ['t1'],
};

const GUEST = {
  id: 'g1',
  fullName: 'Nguyễn Văn A',
  phone: '+84901234567',
  email: null,
  loyaltyTier: 'MEMBER',
  loyaltyPoints: 120,
  totalStays: 3,
  blacklisted: false,
  consentMarketing: true,
  createdAt: '2026-11-12T07:00:00Z',
};

const TASK = {
  id: 't1',
  roomId: 'r1',
  roomCode: '101',
  businessDate: '2026-12-27',
  status: 'PENDING',
  assignedTo: 'u1',
  note: null,
  completedAt: null,
  version: 3,
};

describe('tiền sảnh', () => {
  it('check-in nhận yêu cầu có phòng thực tế và trả phụ thu sớm do máy chủ tính', () => {
    expect(
      checkInRequestSchema.safeParse({
        bookingId: 'b1',
        actualRoomIds: ['r1'],
        earlyCheckIn: false,
      }).success,
    ).toBe(true);
    expect(checkInResponseSchema.parse(CHECK_IN_RESPONSE).status).toBe('CHECKED_IN');
  });

  it('check-in từ chối danh sách phòng rỗng (không gán được phòng)', () => {
    expect(
      checkInRequestSchema.safeParse({ bookingId: 'b1', actualRoomIds: [], earlyCheckIn: false })
        .success,
    ).toBe(false);
  });

  it('check-out mang extras, phụ thu và cờ trả sớm/muộn; tiền là số nguyên VND', () => {
    const parsed = checkOutRequestSchema.parse({
      bookingId: 'b1',
      extras: [{ description: 'Nước suối', amount: 20000, quantity: 6 }],
      lateCheckOut: true,
      earlyCheckOut: false,
      pinToken: 'pin-token-aaaaaaaaaaaaaaaaaaaaaa',
    });
    expect(parsed.extras?.[0]?.amount).toBe(20_000);
    const response = checkOutResponseSchema.parse(CHECK_OUT_RESPONSE);
    expect(Number.isInteger(response.feeAmount)).toBe(true);
    expect(response.housekeepingTaskIds).toEqual(['t1']);
  });

  it('check-out từ chối tiền lẻ (số thực)', () => {
    expect(
      checkOutRequestSchema.safeParse({
        bookingId: 'b1',
        extras: [{ description: 'X', amount: 1000.5 }],
        lateCheckOut: false,
        earlyCheckOut: false,
      }).success,
    ).toBe(false);
  });

  it('no-show trả phụ thu đêm đầu và yêu cầu hoàn (nếu có)', () => {
    const parsed = noShowResponseSchema.parse({
      bookingId: 'b1',
      status: 'NO_SHOW',
      markedAt: '2026-12-24T16:59:00Z',
      penaltyAmount: 1066000,
      refundRequestId: null,
    });
    expect(parsed.status).toBe('NO_SHOW');
  });
});

describe('buồng phòng — projection tối thiểu (AC3, BR-RBAC-03)', () => {
  it('DTO chỉ có trường nhiệm vụ, KHÔNG có booking/khách/tiền', () => {
    expect(Object.keys(housekeepingTaskSchema.shape).sort()).toEqual([
      'assignedTo',
      'businessDate',
      'completedAt',
      'id',
      'note',
      'roomCode',
      'roomId',
      'status',
      'version',
    ]);
    const serialized = JSON.stringify(housekeepingTaskSchema.shape).toLowerCase();
    for (const forbidden of ['booking', 'guest', 'amount', 'price', 'payment', 'total']) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });

  it('cập nhật nhiệm vụ chỉ nhận trạng thái/ghi chú/người giao + lý do', () => {
    expect(
      housekeepingTaskUpdateRequestSchema.safeParse({ status: 'DONE', note: 'Xong 14:30' }).success,
    ).toBe(true);
    expect(housekeepingTaskUpdateRequestSchema.safeParse({ amount: 1000 }).success).toBe(false);
    expect(housekeepingTaskSchema.parse(TASK).roomCode).toBe('101');
  });
});

describe('khách tại quầy', () => {
  it('tạo hồ sơ yêu cầu SĐT đã chuẩn hoá +84 và phiên bản đồng ý', () => {
    expect(
      guestCreateRequestSchema.safeParse({
        fullName: 'Nguyễn Văn A',
        phone: '+84901234567',
        consentMarketing: true,
        consentVersion: '2026-10',
      }).success,
    ).toBe(true);
    expect(
      guestCreateRequestSchema.safeParse({
        fullName: 'A',
        phone: '0901234567',
        consentMarketing: false,
        consentVersion: '2026-10',
      }).success,
    ).toBe(false);
  });

  it('phản hồi khách không lộ lý do danh sách đen (chỉ cờ) — BR-CRM-04 không cấp cho quầy', () => {
    expect(Object.keys(guestSummarySchema.shape)).not.toContain('blacklistReason');
    expect(guestSummarySchema.parse(GUEST).blacklisted).toBe(false);
  });
});

describe('chốt đối soát ngày', () => {
  it('nhận yêu cầu 🔒 và trả chênh lệch + cờ đã báo MANAGER', () => {
    expect(
      reconciliationCloseRequestSchema.safeParse({
        propertyId: 'p1',
        businessDate: '2026-12-27',
        countedCash: 4_500_000,
        pinToken: 'pin-token-aaaaaaaaaaaaaaaaaaaaaa',
      }).success,
    ).toBe(true);
    const parsed = reconciliationCloseResponseSchema.parse({
      propertyId: 'p1',
      businessDate: '2026-12-27',
      expectedCash: 4_600_000,
      countedCash: 4_500_000,
      difference: -100_000,
      managerNotified: true,
      auditLogId: 'a1',
      closedAt: '2026-12-27T11:00:00Z',
    });
    expect(parsed.difference).toBe(-100_000);
    expect(parsed.managerNotified).toBe(true);
  });
});

describe('mã lỗi F7 gắn đúng HTTP §4.2 (AC4)', () => {
  it.each([
    ['E_FO_CHECKIN_NOT_ALLOWED', 409],
    ['E_CRM_PHONE_INVALID', 422],
    ['E_BOOK_BLACKLISTED', 403],
    ['E_AUTH_PIN_REQUIRED', 401],
    ['E_PAY_AMOUNT_MISMATCH', 422],
  ] as const)('%s → %i', (code, status) => {
    expect(errorCatalogue[code].httpStatus).toBe(status);
  });
});
