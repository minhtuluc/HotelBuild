/**
 * HB-204: hợp đồng bổ sung mẻ 13 — tạo/ghi nhận kiểm phòng, đọc khách theo id,
 * xem trước tiền no-show và trả phòng. Chỉ thêm; không đổi schema đã phát hành.
 */
import { describe, expect, it } from 'vitest';
import {
  checkOutPreviewRequestSchema,
  checkOutPreviewSchema,
  checkOutRequestSchema,
  noShowPreviewRequestSchema,
  noShowPreviewSchema,
} from '../src/front-office.js';
import { housekeepingTaskCreateRequestSchema } from '../src/housekeeping.js';
import { buildDocument } from '../src/openapi/generate.js';

const CREATE = {
  roomId: 'r1',
  businessDate: '2026-10-23',
  status: 'INSPECTED',
  reason: 'Lễ tân kiểm phòng trước khi giao',
};

describe('POST /housekeeping/tasks — thân lệnh', () => {
  it('nhận PENDING hoặc INSPECTED kèm lý do; note tuỳ chọn', () => {
    expect(housekeepingTaskCreateRequestSchema.parse(CREATE).status).toBe('INSPECTED');
    expect(
      housekeepingTaskCreateRequestSchema.safeParse({ ...CREATE, status: 'PENDING', note: 'x' })
        .success,
    ).toBe(true);
  });

  it.each([
    ['trạng thái DONE', { status: 'DONE' }],
    ['trạng thái IN_PROGRESS', { status: 'IN_PROGRESS' }],
    ['thiếu lý do', { reason: undefined }],
    ['lý do rỗng', { reason: '' }],
    ['lý do dài hơn 500', { reason: 'a'.repeat(501) }],
    ['ghi chú dài hơn 500', { note: 'a'.repeat(501) }],
    ['ngày không phải YYYY-MM-DD', { businessDate: '23/10/2026' }],
    ['trường lạ assignedTo', { assignedTo: 'u1' }],
    ['roomId rỗng', { roomId: '' }],
  ])('từ chối %s', (_name, patch) => {
    expect(housekeepingTaskCreateRequestSchema.safeParse({ ...CREATE, ...patch }).success).toBe(
      false,
    );
  });
});

describe('POST /front-office/no-show/preview', () => {
  it('thân lệnh chỉ có bookingId (strict)', () => {
    expect(noShowPreviewRequestSchema.parse({ bookingId: 'b1' })).toEqual({ bookingId: 'b1' });
    expect(noShowPreviewRequestSchema.safeParse({ bookingId: 'b1', reason: 'x' }).success).toBe(
      false,
    );
    expect(noShowPreviewRequestSchema.safeParse({ bookingId: '' }).success).toBe(false);
  });

  it('phản hồi: tiền VND nguyên ≥ 0, mốc ISO UTC', () => {
    const ok = {
      bookingId: 'b1',
      penaltyAmount: 600_000,
      expectedRefundAmount: 0,
      markableFrom: '2026-10-23T16:59:00.000Z',
      computedAt: '2026-10-23T08:00:00.000Z',
    };
    expect(noShowPreviewSchema.parse(ok).penaltyAmount).toBe(600_000);
    expect(noShowPreviewSchema.safeParse({ ...ok, penaltyAmount: 1000.5 }).success).toBe(false);
    expect(noShowPreviewSchema.safeParse({ ...ok, expectedRefundAmount: -1 }).success).toBe(false);
    expect(noShowPreviewSchema.safeParse({ ...ok, markableFrom: 'chiều nay' }).success).toBe(false);
  });
});

describe('POST /front-office/check-out/preview', () => {
  const body = {
    bookingId: 'b1',
    extras: [{ description: 'Nước suối', amount: 20_000, quantity: 6 }],
    lateCheckOut: true,
    earlyCheckOut: false,
    note: 'ghi chú',
  };

  it('cùng ràng buộc với lệnh check-out nhưng KHÔNG có pinToken', () => {
    expect(checkOutPreviewRequestSchema.parse(body).lateCheckOut).toBe(true);
    expect(checkOutRequestSchema.safeParse(body).success).toBe(true);
    expect(
      checkOutPreviewRequestSchema.safeParse({ ...body, pinToken: 'x'.repeat(20) }).success,
    ).toBe(false);
    expect(checkOutPreviewRequestSchema.safeParse({ ...body, extras: undefined }).success).toBe(
      true,
    );
  });

  it('từ chối phát sinh tiền lẻ và thiếu cờ sớm/muộn như lệnh ghi', () => {
    expect(
      checkOutPreviewRequestSchema.safeParse({
        ...body,
        extras: [{ description: 'X', amount: 1000.5 }],
      }).success,
    ).toBe(false);
    expect(
      checkOutPreviewRequestSchema.safeParse({ bookingId: 'b1', lateCheckOut: true }).success,
    ).toBe(false);
  });

  it('phản hồi: feeAmount, extrasAmount, balanceDue là số nguyên ≥ 0', () => {
    const ok = {
      bookingId: 'b1',
      feeAmount: 550_000,
      extrasAmount: 120_000,
      balanceDue: 670_000,
      computedAt: '2026-10-23T08:00:00.000Z',
    };
    expect(checkOutPreviewSchema.parse(ok).balanceDue).toBe(670_000);
    expect(checkOutPreviewSchema.safeParse({ ...ok, feeAmount: 0.5 }).success).toBe(false);
    expect(checkOutPreviewSchema.safeParse({ ...ok, balanceDue: -1 }).success).toBe(false);
  });
});

describe('OpenAPI — bốn tuyến mới', () => {
  const paths = buildDocument().paths ?? {};

  function operation(path: string, method: string): Record<string, unknown> {
    const item: unknown = paths[path];
    if (typeof item !== 'object' || item === null) throw new Error(`thiếu path ${path}`);
    const found: unknown = method in item ? Reflect.get(item, method) : undefined;
    if (typeof found !== 'object' || found === null) throw new Error(`thiếu ${method} ${path}`);
    return Object.fromEntries(Object.entries(found));
  }

  function responseCodes(op: Record<string, unknown>): string[] {
    const responses = op.responses;
    return typeof responses === 'object' && responses !== null ? Object.keys(responses) : [];
  }

  function parameterNames(op: Record<string, unknown>): string[] {
    const list = op.parameters;
    if (!Array.isArray(list)) return [];
    return list.flatMap((entry: unknown) => {
      const name: unknown =
        typeof entry === 'object' && entry !== null ? Reflect.get(entry, 'name') : undefined;
      return typeof name === 'string' ? [name] : [];
    });
  }

  it('POST /housekeeping/tasks là lệnh ghi: có Idempotency-Key, trả 201', () => {
    const op = operation('/api/v1/housekeeping/tasks', 'post');
    expect(parameterNames(op)).toContain('Idempotency-Key');
    expect(responseCodes(op)).toEqual(expect.arrayContaining(['201', '403', '404', '409']));
  });

  it('GET /guests/{guestId} chỉ đọc, có bearer, 404 cho khách không tồn tại/ngoài phạm vi', () => {
    const op = operation('/api/v1/guests/{guestId}', 'get');
    expect(parameterNames(op)).toContain('guestId');
    expect(parameterNames(op)).not.toContain('Idempotency-Key');
    expect(responseCodes(op)).toEqual(expect.arrayContaining(['200', '403', '404']));
  });

  it.each(['/api/v1/front-office/no-show/preview', '/api/v1/front-office/check-out/preview'])(
    'POST %s không ghi: không Idempotency-Key, không PIN',
    (path) => {
      const op = operation(path, 'post');
      expect(parameterNames(op)).not.toContain('Idempotency-Key');
      expect(JSON.stringify(op.security)).toContain('bearerAuth');
      expect(responseCodes(op)).toEqual(expect.arrayContaining(['200', '403', '404', '409']));
    },
  );
});
