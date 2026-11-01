/** HB-120 AC3: schema ghi strict, tiền bigint-an-toàn, ngày `[from,to)`, PIN/version đúng lệnh. */
import { describe, expect, it } from 'vitest';
import {
  channelSyncRequestSchema,
  otaBookingsQuerySchema,
  otaWebhookEventSchema,
  salesClosureRequestSchema,
} from '../../src/channel.js';
import {
  bookingSeqSchema,
  compensationPaymentCreateRequestSchema,
  roomMergeApproveRequestSchema,
  roomMergeConsentRequestSchema,
  roomMergeRequestSchema,
  roomMoveApproveRequestSchema,
  roomMoveCreateRequestSchema,
  roomMoveExecuteRequestSchema,
} from '../../src/overbooking.js';
import { WEBHOOK_EVENT } from './fixtures.js';

const MOVE_REQUEST = {
  overbookingCaseId: 'c1',
  bookingId: 'b1',
  bookingRoomId: 'br1',
  moveType: 'UPGRADE_SAME_PROPERTY',
  toRoomId: 'r2',
  reason: 'Quá tải STD đêm 2026-12-25',
  compensationAmount: 0,
  transportCost: 0,
  consent: { granted: true, channel: 'PHONE' },
};

describe('F6 validation', () => {
  it('reject-invalid-and-server-owned-fields', () => {
    // Trường do máy chủ quyết không được nhận từ client.
    for (const field of ['approvedBy', 'keepScore', 'priceLocked', 'oversold', 'totalAmount']) {
      expect(
        roomMoveCreateRequestSchema.safeParse({ ...MOVE_REQUEST, [field]: 1 }).success,
        field,
      ).toBe(false);
    }
    expect(roomMoveCreateRequestSchema.parse(MOVE_REQUEST).moveType).toBe('UPGRADE_SAME_PROPERTY');
    expect(
      roomMoveCreateRequestSchema.safeParse({
        ...MOVE_REQUEST,
        moveType: 'SAME_TYPE_SAME_PROPERTY',
        toRoomId: undefined,
      }).success,
    ).toBe(false);

    // Merge: `discountAmount` do server tính; client chỉ có thể đề xuất `discountPct`.
    expect(
      roomMergeRequestSchema.safeParse({
        moveType: 'MERGE_CONNECTING',
        bookingId: 'b1',
        roomIdA: 'r1',
        roomIdB: 'r2',
        discountAmount: 673_200,
      }).success,
    ).toBe(false);
    // Bồi thường không nhận `amount` do client khai (D06).
    expect(
      compensationPaymentCreateRequestSchema.safeParse({
        method: 'CASH',
        amount: 1_500_000,
        note: 'Chi tay',
      }).success,
    ).toBe(false);
    expect(
      compensationPaymentCreateRequestSchema.parse({ method: 'CASH', note: 'Chi tay' }).method,
    ).toBe('CASH');
    expect(
      compensationPaymentCreateRequestSchema.safeParse({ method: 'BANK_TRANSFER', note: 'x' })
        .success,
    ).toBe(false);
    expect(
      compensationPaymentCreateRequestSchema.safeParse({
        method: 'BANK_TRANSFER',
        bankReference: 'FT-1',
      }).success,
    ).toBe(true);

    // Tiền VND nguyên, không âm, trong miền số nguyên an toàn.
    for (const amount of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        roomMoveCreateRequestSchema.safeParse({ ...MOVE_REQUEST, compensationAmount: amount })
          .success,
        String(amount),
      ).toBe(false);
    }

    // `Booking.seq` bigint đi bằng chuỗi thập phân.
    expect(bookingSeqSchema.safeParse('9007199254740993').success).toBe(true);
    expect(bookingSeqSchema.safeParse(9007199254740993).success).toBe(false);
    expect(bookingSeqSchema.safeParse('12a').success).toBe(false);

    // Ngày `[from,to)`: `to` không trước `from`; lưu trú cần ít nhất một đêm.
    expect(
      channelSyncRequestSchema.safeParse({ scope: 'RANGE', from: '2026-12-26', to: '2026-12-24' })
        .success,
    ).toBe(false);
    expect(
      channelSyncRequestSchema.safeParse({ scope: 'RANGE', from: '2026-12-24', to: '2026-12-24' })
        .success,
    ).toBe(true);
    expect(
      salesClosureRequestSchema.safeParse({
        roomTypeId: 'rt1',
        from: '2026-12-26',
        to: '2026-12-24',
        reason: 'Hết phòng',
      }).success,
    ).toBe(false);
    expect(
      otaWebhookEventSchema.safeParse({ ...WEBHOOK_EVENT, checkOut: '2026-12-24' }).success,
    ).toBe(false);
    expect(
      otaWebhookEventSchema.safeParse({ ...WEBHOOK_EVENT, checkIn: '24/12/2026' }).success,
    ).toBe(false);

    // Phân trang giới hạn theo api.md §1.5.
    expect(otaBookingsQuerySchema.safeParse({ limit: 100 }).success).toBe(true);
    expect(otaBookingsQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(otaBookingsQuerySchema.safeParse({ limit: 0 }).success).toBe(false);

    // PIN chỉ ở lệnh tài chính đúng; version chỉ đi qua If-Match, không nằm trong body.
    expect(
      roomMoveExecuteRequestSchema.safeParse({ pinToken: 'pin-token-aaaaaaaaaaaaaaaa' }).success,
    ).toBe(true);
    expect(
      roomMoveApproveRequestSchema.safeParse({
        compensationAmount: 0,
        transportCost: 0,
        pinToken: 'pin-token-aaaaaaaaaaaaaaaa',
      }).success,
    ).toBe(true);
    expect(
      roomMergeApproveRequestSchema.safeParse({
        reason: 'Duyệt khác giới',
        pinToken: 'pin-token-aaaaaaaaaaaaaaaa',
      }).success,
    ).toBe(false);
    expect(
      roomMergeConsentRequestSchema.safeParse({
        side: 'PRIMARY',
        consented: true,
        pinToken: 'pin-token-aaaaaaaaaaaaaaaa',
      }).success,
    ).toBe(false);
    expect(
      roomMoveApproveRequestSchema.safeParse({
        compensationAmount: 0,
        transportCost: 0,
        version: 2,
      }).success,
    ).toBe(false);
    expect(
      roomMoveApproveRequestSchema.parse({ compensationAmount: 250_000, transportCost: 500_000 })
        .compensationAmount,
    ).toBe(250_000);
  });
});
