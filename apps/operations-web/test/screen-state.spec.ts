import { describe, expect, it } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import {
  FORM_WIDE_FIELD,
  VERSION_UNKNOWN,
  readFailureState,
  writeFailureState,
} from '../src/lib/screen-state';
import { roomTypePriceWarnings } from '../src/lib/room-type-warnings';
import { toMoney } from '../src/lib/money';
import {
  EMPTY_ROOM_TYPE_DRAFT,
  toRoomTypeRequest,
} from '../src/app/(ops)/room-types/room-type-draft';

const context = { attemptedVersion: '7', onReload: () => undefined, onLookup: () => undefined };

function error(init: {
  status?: number;
  code?: string;
  details?: { field: string; issue: string }[];
  kind?: 'http' | 'network' | 'timeout';
}): ApiError {
  return new ApiError({
    kind: init.kind ?? 'http',
    message: 'lỗi',
    status: init.status,
    code: init.code,
    details: init.details,
    traceId: 'trace-1',
  });
}

describe('ánh xạ lỗi đọc dữ liệu', () => {
  it('403 và 401 là thiếu quyền', () => {
    expect(readFailureState(error({ status: 403, code: 'E_AUTH_OUT_OF_SCOPE' }))).toEqual({
      kind: 'forbidden',
    });
    expect(readFailureState(error({ status: 401 }))).toEqual({ kind: 'forbidden' });
  });

  it('lỗi khác trả undefined để màn hình giữ nội dung cũ và hiện băng lỗi', () => {
    expect(readFailureState(error({ status: 500 }))).toBeUndefined();
    expect(readFailureState(error({ kind: 'network' }))).toBeUndefined();
  });
});

describe('ánh xạ lỗi ghi dữ liệu', () => {
  it('412 và 428 là xung đột phiên bản, không tự ghi đè', () => {
    const conflict = writeFailureState(
      error({ status: 412, code: 'E_GEN_VERSION_CONFLICT' }),
      context,
    );
    expect(conflict).toMatchObject({
      kind: 'conflict',
      attemptedVersion: '7',
      currentVersion: VERSION_UNKNOWN,
    });
    expect(writeFailureState(error({ status: 428 }), context).kind).toBe('conflict');
    expect(
      writeFailureState(error({ status: 409, code: 'E_GEN_VERSION_CONFLICT' }), context).kind,
    ).toBe('conflict');
  });

  it('400/422 là lỗi theo trường, giữ chi tiết của server', () => {
    const state = writeFailureState(
      error({
        status: 422,
        code: 'E_RATE_CONFIGURATION_INVALID',
        details: [{ field: 'minPrice', issue: 'ABOVE_CEILING' }],
      }),
      context,
    );
    expect(state).toEqual({
      kind: 'validationError',
      details: [{ field: 'minPrice', issue: 'ABOVE_CEILING' }],
    });
  });

  it('422 không kèm chi tiết vẫn báo theo trường với mã lỗi', () => {
    const state = writeFailureState(
      error({ status: 422, code: 'E_RATE_CONFIGURATION_INVALID' }),
      context,
    );
    expect(state).toEqual({
      kind: 'validationError',
      details: [{ field: FORM_WIDE_FIELD, issue: 'E_RATE_CONFIGURATION_INVALID' }],
    });
  });

  it('mạng, hết thời gian và 5xx là chưa xác định kết quả', () => {
    for (const init of [
      { kind: 'network' as const },
      { kind: 'timeout' as const },
      { status: 503 },
    ]) {
      expect(writeFailureState(error(init), context)).toMatchObject({
        kind: 'unknownOutcome',
        referenceId: 'trace-1',
      });
    }
  });

  it('phản hồi sai hợp đồng cũng là chưa xác định kết quả', () => {
    expect(writeFailureState(new Error('hỏng'), context)).toMatchObject({ kind: 'unknownOutcome' });
  });

  it('403 là thiếu quyền', () => {
    expect(writeFailureState(error({ status: 403 }), context)).toEqual({ kind: 'forbidden' });
  });
});

describe('kiểm tra hiển thị sàn–trần', () => {
  it('báo khi sàn cao hơn trần', () => {
    expect(
      roomTypePriceWarnings({ basePrice: 900_000, minPrice: 2_000_000, maxPrice: 1_000_000 }),
    ).toEqual(['floorAboveCeiling', 'baseBelowFloor']);
  });

  it('báo khi giá cơ bản cao hơn trần', () => {
    expect(
      roomTypePriceWarnings({ basePrice: 1_500_000, minPrice: 700_000, maxPrice: 1_400_000 }),
    ).toEqual(['baseAboveCeiling']);
  });

  it('không báo khi giá nằm trong khoảng', () => {
    expect(
      roomTypePriceWarnings({ basePrice: 900_000, minPrice: 700_000, maxPrice: 1_400_000 }),
    ).toEqual([]);
  });
});

describe('dựng thân yêu cầu tạo loại phòng', () => {
  it('trả danh sách trường thiếu khi để trống', () => {
    const result = toRoomTypeRequest(EMPTY_ROOM_TYPE_DRAFT);
    expect('invalid' in result && result.invalid).toEqual([
      'propertyId',
      'code',
      'basePrice',
      'minPrice',
      'maxPrice',
    ]);
  });

  it('nhận tiền nguyên VND và cắt khoảng trắng của mã', () => {
    const result = toRoomTypeRequest({
      ...EMPTY_ROOM_TYPE_DRAFT,
      propertyId: 'p1',
      code: ' DLX ',
      basePrice: '900000',
      minPrice: '700000',
      maxPrice: '1400000',
    });
    expect(result).toEqual({
      input: {
        propertyId: 'p1',
        code: 'DLX',
        capacityAdults: 2,
        capacityChildren: 0,
        basePrice: 900_000,
        minPrice: 700_000,
        maxPrice: 1_400_000,
        bedCount: 1,
        allowShared: false,
      },
    });
  });

  it('từ chối tiền không phải số nguyên dương', () => {
    expect(toMoney('0')).toBeNull();
    expect(toMoney('1.5')).toBeNull();
    expect(toMoney('abc')).toBeNull();
    expect(toMoney(' 120000 ')).toBe(120_000);
  });
});
