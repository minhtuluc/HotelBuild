import { describe, expect, it } from 'vitest';
import {
  errorBodySchema,
  isoUtcTimestampSchema,
  listResponseSchema,
  moneySchema,
  operationRefSchema,
} from '../src/common.js';
import { loginRequestSchema, phoneNumberSchema, tokenPairSchema } from '../src/auth.js';
import { bookingStatusSchema, paymentMethodSchema, userRoleSchema } from '../src/enums.js';
import { errorCatalogue, errorCodePattern, errorCodes, isErrorCode } from '../src/errors.js';

describe('danh mục mã lỗi (api.md §4.2)', () => {
  it('có đúng 62 mã, không trùng', () => {
    expect(errorCodes).toHaveLength(62);
    expect(new Set(errorCodes).size).toBe(62);
    for (const code of errorCodes) expect(code).toMatch(errorCodePattern);
  });

  it('tiền tố module của mã khớp trường module', () => {
    for (const code of errorCodes) expect(code.split('_')[1]).toBe(errorCatalogue[code].module);
  });

  it('phân bố HTTP khớp bảng §4.2', () => {
    const histogram = errorCodes.reduce<Record<string, number>>((acc, code) => {
      const key = String(errorCatalogue[code].httpStatus);
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    expect(histogram).toEqual({
      '400': 4,
      '401': 5,
      '403': 8,
      '404': 1,
      '405': 1,
      '409': 25,
      '410': 1,
      '412': 1,
      '422': 9,
      '428': 1,
      '429': 1,
      '502': 2,
      '503': 1,
      '504': 1,
      null: 1,
    });
  });

  it('isErrorCode thu hẹp được kiểu và từ chối mã lạ', () => {
    const observed = 'E_INV_ROOM_TAKEN';
    expect(isErrorCode(observed)).toBe(true);
    if (!isErrorCode(observed)) throw new Error('type guard không thu hẹp');
    expect(errorCatalogue[observed].httpStatus).toBe(409);
    expect(isErrorCode('E_GEN_KHONG_TON_TAI')).toBe(false);
  });
});

describe('bao lỗi', () => {
  const valid = {
    code: 'E_AUTH_INVALID_CREDENTIALS',
    message: 'Sai tên đăng nhập hoặc mật khẩu',
    traceId: 'trace-1',
    timestamp: '2026-10-01T03:00:00.000Z',
    path: '/api/v1/auth/login',
  };

  it('nhận bao lỗi hợp lệ và giữ chi tiết theo trường', () => {
    const parsed = errorBodySchema.parse({
      ...valid,
      details: [{ field: 'guest.phone', issue: 'REQUIRED' }],
    });
    expect(parsed.details?.[0]?.field).toBe('guest.phone');
  });

  it('nhận mã mới chưa có trong danh mục để client cũ không vỡ', () => {
    expect(errorBodySchema.safeParse({ ...valid, code: 'E_NEW_FUTURE_CODE' }).success).toBe(true);
  });

  it('từ chối mã sai định dạng và thiếu traceId', () => {
    expect(errorBodySchema.safeParse({ ...valid, code: 'INV_ROOM_TAKEN' }).success).toBe(false);
    const { traceId, ...withoutTrace } = valid;
    expect(traceId).toBeDefined();
    expect(errorBodySchema.safeParse(withoutTrace).success).toBe(false);
  });

  it('từ chối mốc thời gian không phải UTC', () => {
    expect(isoUtcTimestampSchema.safeParse('2026-10-01T03:00:00+07:00').success).toBe(false);
    expect(isoUtcTimestampSchema.safeParse('2026-10-01T03:00:00Z').success).toBe(true);
  });

  it('nhận retryAfterSeconds nguyên ≥ 1 cho lỗi khoá tài khoản / quá nhiều yêu cầu (QĐ-03 T5)', () => {
    expect(
      errorBodySchema.parse({ ...valid, code: 'E_GEN_RATE_LIMITED', retryAfterSeconds: 60 })
        .retryAfterSeconds,
    ).toBe(60);
    expect(errorBodySchema.safeParse({ ...valid, retryAfterSeconds: 0 }).success).toBe(false);
    expect(errorBodySchema.safeParse({ ...valid, retryAfterSeconds: 1.5 }).success).toBe(false);
    expect(errorBodySchema.safeParse(valid).success).toBe(true);
  });
});

describe('tiền và phân trang', () => {
  it('chỉ nhận tiền nguyên VND', () => {
    expect(moneySchema.safeParse({ amount: 1_100_000, currency: 'VND' }).success).toBe(true);
    expect(moneySchema.safeParse({ amount: 1_100_000.5, currency: 'VND' }).success).toBe(false);
    expect(moneySchema.safeParse({ amount: 1_100_000, currency: 'USD' }).success).toBe(false);
  });

  it('bao hình danh sách đúng quy ước data + meta', () => {
    const schema = listResponseSchema(moneySchema);
    const parsed = schema.parse({
      data: [{ amount: 1_000, currency: 'VND' }],
      meta: { limit: 20, nextCursor: null, hasMore: false, total: 1 },
    });
    expect(parsed.meta.total).toBe(1);
    expect(
      schema.safeParse({
        data: [],
        meta: { limit: 101, nextCursor: null, hasMore: false, total: 0 },
      }).success,
    ).toBe(false);
  });

  it('tham chiếu tác vụ bất đồng bộ đủ trường theo dõi', () => {
    expect(
      operationRefSchema.safeParse({
        operationId: 'op-1',
        status: 'RUNNING',
        statusUrl: '/api/v1/operations/op-1',
      }).success,
    ).toBe(true);
    expect(
      operationRefSchema.safeParse({ operationId: 'op-1', status: 'UNKNOWN', statusUrl: '/x' })
        .success,
    ).toBe(false);
  });
});

describe('định danh', () => {
  it('số điện thoại phải đã chuẩn hoá về +84', () => {
    expect(phoneNumberSchema.safeParse('+84901234567').success).toBe(true);
    expect(phoneNumberSchema.safeParse('0901234567').success).toBe(false);
  });

  it('cặp token có hạn dùng dương và kiểu Bearer', () => {
    expect(
      tokenPairSchema.safeParse({
        tokenType: 'Bearer',
        accessToken: 'a'.repeat(20),
        expiresInSeconds: 900,
        refreshToken: 'r'.repeat(20),
        refreshExpiresInSeconds: 604_800,
      }).success,
    ).toBe(true);
  });
});

describe('tương thích tiến (F0-02, api.md §7.1)', () => {
  const tokens = {
    tokenType: 'Bearer',
    accessToken: 'a'.repeat(20),
    expiresInSeconds: 900,
    refreshToken: 'r'.repeat(20),
    refreshExpiresInSeconds: 604_800,
  };

  it('phản hồi có trường lạ vẫn đọc được và trường lạ bị bỏ', () => {
    const parsed = tokenPairSchema.parse({ ...tokens, scope: 'chain', issuedBy: 'server-moi' });
    expect(parsed.accessToken).toBe(tokens.accessToken);
    expect(Object.keys(parsed)).toHaveLength(5);
  });

  it('phản hồi thiếu trường bắt buộc vẫn bị từ chối', () => {
    const { refreshToken, ...missing } = tokens;
    expect(refreshToken).toBeDefined();
    expect(tokenPairSchema.safeParse(missing).success).toBe(false);
  });

  it('bao lỗi có trường lạ vẫn đọc được (client cũ gặp server mới)', () => {
    const parsed = errorBodySchema.safeParse({
      code: 'E_INV_ROOM_TAKEN',
      message: 'Phòng đã bị lấy',
      traceId: 'trace-1',
      timestamp: '2026-10-01T03:00:00.000Z',
      path: '/api/v1/bookings',
      retryAfterSeconds: 5,
      recoveryHints: ['chon phong khac'],
    });
    expect(parsed.success).toBe(true);
  });

  it('yêu cầu gửi lên vẫn nghiêm: trường lạ bị từ chối', () => {
    expect(
      loginRequestSchema.safeParse({ username: 'owner', password: 'matkhau123', role: 'OWNER' })
        .success,
    ).toBe(false);
  });
});

describe('enum canonical (00 §7.8)', () => {
  it('BookingStatus có 9 trạng thái', () => {
    expect(bookingStatusSchema.options).toHaveLength(9);
  });

  it('có 7 vai trò độc lập và 5 phương thức thanh toán', () => {
    expect(userRoleSchema.options).toHaveLength(7);
    expect(paymentMethodSchema.options).toEqual([
      'VNPAY',
      'MOMO',
      'CASH',
      'BANK_TRANSFER',
      'OTA_COLLECT',
    ]);
  });
});
