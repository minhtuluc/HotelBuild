import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { safeErrorCode, sweepDueHolds } from '../../src/jobs/hold-expiry/expire.js';
import { holdExpiryPayloadSchema } from '../../src/jobs/hold-expiry/hold-expiry.job.js';
import {
  createHoldProjectionSession,
  reconcileHoldProjection,
} from '../../src/jobs/hold-expiry/projection.js';
import type { HoldProjectionStore } from '../../src/jobs/hold-expiry/projection.js';

/** Cổng Redis giả chỉ trả dữ liệu đã dựng — dùng cho các nhánh không cần Redis thật. */
function fakeStore(entries: readonly (readonly [string, string | null])[]): HoldProjectionStore {
  return {
    keys: async (_pattern, limit) => entries.slice(0, limit).map(([key]) => key),
    values: async (keys) =>
      keys.map((key) => entries.find(([entry]) => entry === key)?.[1] ?? null),
    remove: async () => undefined,
    set: async () => undefined,
  };
}

describe('HB-078 — payload job hết hạn', () => {
  it('mặc định là SWEEP; từ chối chế độ lạ, khoá lạ và payload không phải object', () => {
    expect(holdExpiryPayloadSchema.parse({})).toEqual({ mode: 'SWEEP' });
    expect(holdExpiryPayloadSchema.parse({ mode: 'RECONCILE' })).toEqual({ mode: 'RECONCILE' });
    expect(holdExpiryPayloadSchema.safeParse({ mode: 'X' }).success).toBe(false);
    expect(holdExpiryPayloadSchema.safeParse({ mode: 'SWEEP', thua: 1 }).success).toBe(false);
    expect(holdExpiryPayloadSchema.safeParse(null).success).toBe(false);
  });
});

describe('HB-078 — mã lỗi an toàn cho log', () => {
  it('chỉ nhận mã ổn định, không bao giờ nhận message/stack mang dữ liệu', () => {
    expect(safeErrorCode({ code: '23505' })).toBe('23505');
    expect(
      safeErrorCode(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })),
    ).toBe('ECONNREFUSED');
    expect(safeErrorCode(new Error('lỗi thô có PII 0905123456'))).toBe('UNKNOWN');
    expect(safeErrorCode('chuỗi lỗi')).toBe('UNKNOWN');
    expect(safeErrorCode(null)).toBe('UNKNOWN');
    expect(safeErrorCode({ code: 'E' })).toBe('UNKNOWN');
    expect(safeErrorCode({ code: 'có dấu cách' })).toBe('UNKNOWN');
  });
});

describe('HB-078 — phiên Redis của lượt đối chiếu', () => {
  it('đóng được khi chưa từng gửi lệnh (chưa mở kết nối nào) và gọi lại vẫn an toàn', async () => {
    const session = createHoldProjectionSession('redis://127.0.0.1:1/9');
    await expect(session.close()).resolves.toBeUndefined();
    await expect(session.close()).resolves.toBeUndefined();
  });

  it('URL Redis sai bị từ chối ngay khi dựng phiên', () => {
    expect(() => createHoldProjectionSession('không-phải-url')).toThrow();
  });
});

describe('HB-078 — lượt quét: lỗi một booking không chặn các booking khác', () => {
  // `batchSize: 1` để trang sau trả lại đúng id đã thử ⇒ nhánh "không còn gì mới thì dừng" cũng được chạy.
  const options = { batchSize: 1, maxPages: 2, missedGraceSeconds: 60 };

  it('booking lỗi ⇒ đếm failed và ghi đúng một dòng log có mã, không có message thô', async () => {
    const logs: string[] = [];
    const report = await sweepDueHolds(
      {
        dueIds: async () => ['11111111-1111-1111-1111-111111111111'],
        expire: async () => {
          throw Object.assign(new Error('deadlock thô có PII 0905123456'), { code: '40P01' });
        },
      },
      options,
      ({ queue, msg, errorCode }) => {
        logs.push(`${errorCode ?? 'info'}|${queue}|${msg}`);
      },
    );
    expect(report).toEqual({
      scanned: 1,
      expired: 0,
      skipped: 0,
      failed: 1,
      releasedAssignments: 0,
      releasedAllotments: 0,
      refundRequests: 0,
      refundedAmount: 0n,
      missed: 0,
      pages: 1,
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('hết hạn hold lỗi một booking (mã 40P01)');
    expect(logs.join('\n')).not.toContain('0905123456');
  });

  it('booking không còn đến hạn khi đọc lại ⇒ tính là bỏ qua, không phải lỗi', async () => {
    const report = await sweepDueHolds(
      {
        dueIds: async () => ['22222222-2222-2222-2222-222222222222'],
        expire: async () => ({
          expired: false,
          releasedAssignments: 0,
          releasedAllotments: 0,
          overdueSeconds: 0,
          fromStatus: null,
          refundRequestId: null,
          refundAmount: 0n,
        }),
      },
      options,
      () => undefined,
    );
    expect(report).toEqual({
      scanned: 1,
      expired: 0,
      skipped: 1,
      failed: 0,
      releasedAssignments: 0,
      releasedAllotments: 0,
      refundRequests: 0,
      refundedAmount: 0n,
      missed: 0,
      pages: 1,
    });
  });

  it('booking hết hạn quá trần SLA ⇒ cộng bộ đếm bỏ sót và cộng phần đã nhả', async () => {
    const report = await sweepDueHolds(
      {
        dueIds: async () => ['33333333-3333-3333-3333-333333333333'],
        expire: async () => ({
          expired: true,
          releasedAssignments: 2,
          releasedAllotments: 3,
          overdueSeconds: 120,
          fromStatus: 'HELD',
          refundRequestId: null,
          refundAmount: 0n,
        }),
      },
      options,
      () => undefined,
    );
    expect(report).toEqual({
      scanned: 1,
      expired: 1,
      skipped: 0,
      failed: 0,
      releasedAssignments: 2,
      releasedAllotments: 3,
      refundRequests: 0,
      refundedAmount: 0n,
      missed: 1,
      pages: 1,
    });
  });

  it('HB-212: booking vừa lập hồ sơ hoàn ⇒ cộng số hồ sơ và đúng số tiền đã thu', async () => {
    const report = await sweepDueHolds(
      {
        dueIds: async () => ['44444444-4444-4444-4444-444444444444'],
        expire: async () => ({
          expired: true,
          releasedAssignments: 1,
          releasedAllotments: 1,
          overdueSeconds: 10,
          fromStatus: 'PENDING_PAYMENT',
          refundRequestId: '55555555-5555-5555-5555-555555555555',
          // Số lẻ (không bội 1.000) — BR-GEN-03: booking chưa xác nhận hoàn **đúng** số đã thu.
          refundAmount: 1_234_567n,
        }),
      },
      options,
      () => undefined,
    );
    expect(report).toMatchObject({ refundRequests: 1, refundedAmount: 1_234_567n, expired: 1 });
  });
});

describe('HB-078 — đối chiếu projection: nhánh thoát sớm', () => {
  // Prisma không truy vấn ở hai ca dưới đây: cả hai thoát trước khi đọc `bookings`.
  const db = new PrismaClient({ datasourceUrl: 'postgresql://khong:ket@127.0.0.1:1/khong' });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('không có khoá `hold:*` nào ⇒ lượt đối chiếu rỗng', async () => {
    expect(await reconcileHoldProjection(db, fakeStore([]), { maxKeys: 10 })).toEqual({
      scanned: 0,
      active: 0,
      repaired: 0,
      orphaned: 0,
      unreadable: 0,
    });
  });

  it('khoá hết TTL, JSON hỏng, bản ghi sai hình dạng và `bookingId` không phải UUID chỉ được ĐẾM, không bị sửa mù', async () => {
    const store = fakeStore([
      ['hold:mat-ttl', null],
      ['hold:hong', 'không-phải-json'],
      ['hold:thieu-truong', '{"status":"ACTIVE"}'],
      [
        'hold:khong-uuid',
        '{"id":"x","bookingId":"khong-phai-uuid","channelId":"c","expiresAt":"2026-10-18T00:00:00.000Z","status":"ACTIVE","releasedAt":null,"createdAt":"2026-10-18T00:00:00.000Z","quotedTotal":1}',
      ],
    ]);
    expect(await reconcileHoldProjection(db, store, { maxKeys: 10 })).toEqual({
      scanned: 0,
      active: 0,
      repaired: 0,
      orphaned: 0,
      unreadable: 3,
    });
  });
});
