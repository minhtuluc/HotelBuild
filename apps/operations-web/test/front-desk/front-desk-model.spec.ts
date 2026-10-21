import { describe, expect, it } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import type { BookingSummary, RoomSummary } from '@pinehill/contracts';
import {
  WALK_IN_STEPS,
  actionFailure,
  amountIssue,
  checkInBody,
  checkOutBody,
  deskDate,
  deskEmpty,
  guestIssue,
  nextWalkInStep,
  previousWalkInStep,
  roomChoices,
  roomSelectionIssue,
  splitDesk,
  stayIssue,
  stepChecks,
  toWalkInRequest,
  validBusinessDate,
  walkInDefaults,
  walkInStepNumber,
  type WalkInGuest,
  type WalkInStay,
} from '../../src/app/(ops)/front-desk/front-desk-model';

const BASE: BookingSummary = {
  id: 'b1',
  code: 'PH-261224-AAAAA',
  seq: 1,
  status: 'CONFIRMED',
  guestId: 'g1',
  propertyId: 'p1',
  roomTypeId: 'rt1',
  ratePlanId: 'FLEX7',
  channelId: 'c1',
  checkIn: '2026-12-24',
  checkOut: '2026-12-26',
  nights: 2,
  adults: 2,
  children: 0,
  roomCount: 1,
  totalAmount: 2_000_000,
  depositPercent: 30,
  depositAmount: 600_000,
  paidAmount: 600_000,
  refundedAmount: 0,
  balanceDue: 1_400_000,
  penaltyAmount: 0,
  currency: 'VND',
  rescheduleCount: 0,
  holdExpiresAt: null,
  oversold: false,
  priceLocked: false,
  duplicateSuspected: false,
  channelPolicyCode: null,
  note: null,
  createdBy: 'g1',
  createdAt: '2026-12-01T00:00:00.000Z',
};

const booking = (overrides: Partial<BookingSummary>): BookingSummary => ({
  ...BASE,
  ...overrides,
});

const room = (id: string, code: string, overrides: Partial<RoomSummary> = {}): RoomSummary => ({
  id,
  propertyId: 'p1',
  roomTypeId: 'rt1',
  code,
  floor: 2,
  status: 'ACTIVE',
  connectingRoomId: null,
  version: 1,
  ...overrides,
});

describe('SCR-48 phân loại đến/đi/ở (HB-152)', () => {
  it('chỉ nhận khách đến đúng ngày và trạng thái còn hiệu lực', () => {
    const lists = splitDesk(
      [
        booking({ id: 'b1', code: 'PH-261224-AAAAA' }),
        booking({ id: 'b2', code: 'PH-261223-BBBBB', checkIn: '2026-12-23' }),
        booking({ id: 'b3', code: 'PH-261224-CCCCC', status: 'CANCELLED' }),
        booking({ id: 'b4', code: 'PH-261224-DDDDD', status: 'PENDING_PAYMENT' }),
      ],
      [],
      '2026-12-24',
    );
    expect(lists.arrivals.map((item) => item.id)).toEqual(['b1', 'b4']);
  });

  it('khách đang ở gồm mọi CHECKED_IN; danh sách đi lọc theo checkOut hôm nay', () => {
    const lists = splitDesk(
      [],
      [
        booking({ id: 's1', status: 'CHECKED_IN', checkOut: '2026-12-24' }),
        booking({ id: 's2', status: 'CHECKED_IN', checkOut: '2026-12-27' }),
        booking({ id: 's3', status: 'CHECKED_OUT', checkOut: '2026-12-24' }),
      ],
      '2026-12-24',
    );
    expect(lists.inHouse.map((item) => item.id)).toEqual(['s1', 's2']);
    expect(lists.departures.map((item) => item.id)).toEqual(['s1']);
    expect(deskEmpty(lists)).toBe(false);
    expect(deskEmpty({ arrivals: [], inHouse: [], departures: [] })).toBe(true);
  });

  it('ngày nghiệp vụ chỉ nhận đúng dạng YYYY-MM-DD, mặc định hôm nay theo giờ VN', () => {
    expect(validBusinessDate('2026-12-24')).toBe(true);
    expect(validBusinessDate('2026-02-30')).toBe(false);
    expect(validBusinessDate('24/12/2026')).toBe(false);
    expect(deskDate(null, new Date('2026-12-24T18:00:00Z'))).toBe('2026-12-25');
    expect(deskDate('2026-12-24', new Date('2026-12-25T00:00:00Z'))).toBe('2026-12-24');
    expect(deskDate('bad', new Date('2026-12-24T03:00:00Z'))).toBe('2026-12-24');
  });
});

describe('SCR-48 lỗi lệnh ghi do máy chủ quyết (AC1)', () => {
  it('409 nghiệp vụ là từ chối chắc chắn, giữ đúng mã và lý do máy chủ trả', () => {
    const failure = actionFailure(
      new ApiError({
        kind: 'http',
        status: 409,
        code: 'E_FO_CHECKIN_NOT_ALLOWED',
        message: 'Công nợ vượt ngưỡng hoặc phòng chưa sẵn sàng',
      }),
    );
    expect(failure).toEqual({
      kind: 'rejected',
      code: 'E_FO_CHECKIN_NOT_ALLOWED',
      status: 409,
      reason: 'Công nợ vượt ngưỡng hoặc phòng chưa sẵn sàng',
    });
  });

  it('401 thiếu PIN không phải thiếu quyền; 403 mới là thiếu quyền', () => {
    expect(
      actionFailure(
        new ApiError({ kind: 'http', status: 401, code: 'E_AUTH_PIN_REQUIRED', message: 'PIN' }),
      ).kind,
    ).toBe('rejected');
    expect(
      actionFailure(new ApiError({ kind: 'http', status: 403, message: 'forbidden' })).kind,
    ).toBe('forbidden');
  });

  it('412/428 là xung đột; mất mạng/hết giờ/5xx là chưa xác định kết quả', () => {
    expect(actionFailure(new ApiError({ kind: 'http', status: 412, message: 'stale' })).kind).toBe(
      'conflict',
    );
    expect(actionFailure(new ApiError({ kind: 'network', message: 'offline' })).kind).toBe(
      'unknownOutcome',
    );
    expect(actionFailure(new ApiError({ kind: 'timeout', message: 'timeout' })).kind).toBe(
      'unknownOutcome',
    );
    expect(
      actionFailure(new ApiError({ kind: 'http', status: 503, message: 'unavailable' })).kind,
    ).toBe('unknownOutcome');
    expect(actionFailure(new Error('protocol')).kind).toBe('unknownOutcome');
  });
});

describe('SCR-48 gán phòng và thân lệnh', () => {
  it('chỉ gợi ý phòng ACTIVE đúng loại; chọn đủ số phòng theo hợp đồng', () => {
    const rooms = [
      room('r1', '201'),
      room('r2', '202'),
      room('r3', '203', { roomTypeId: 'rt2' }),
      room('r4', '204', { status: 'MAINTENANCE' }),
    ];
    const choices = roomChoices(rooms, { roomTypeId: 'rt1' });
    expect(choices.map((item) => item.code)).toEqual(['201', '202']);
    expect(roomSelectionIssue(['r1', 'r2'], { roomCount: 2 }, choices)).toBeNull();
    expect(roomSelectionIssue(['r1'], { roomCount: 2 }, choices)).toBe('COUNT');
    expect(roomSelectionIssue(['r3'], { roomCount: 1 }, choices)).toBe('TYPE');
    expect(roomSelectionIssue(['r1', 'r1'], { roomCount: 2 }, choices)).toBe('TYPE');
  });

  it('không gửi trường rỗng và không tự thêm pinToken vào thân lệnh', () => {
    expect(
      checkInBody('b1', {
        roomIds: ['r1'],
        earlyCheckIn: true,
        idNumber: '  ',
        note: '  đến sớm ',
      }),
    ).toEqual({ bookingId: 'b1', actualRoomIds: ['r1'], earlyCheckIn: true, note: 'đến sớm' });
    expect(checkOutBody('b1', { earlyCheckOut: false, lateCheckOut: true, note: '' })).toEqual({
      bookingId: 'b1',
      earlyCheckOut: false,
      lateCheckOut: true,
    });
  });
});

describe('SCR-48 walk-in ≤ 5 bước (AC3)', () => {
  const guest: WalkInGuest = { fullName: ' Nguyễn Văn An ', phone: '0912345678' };
  const stay: WalkInStay = walkInDefaults('p1', '2026-12-24');

  it('đúng 5 bước và điều hướng không vượt biên', () => {
    expect(WALK_IN_STEPS).toHaveLength(5);
    expect(walkInStepNumber('stay')).toBe(1);
    expect(walkInStepNumber('done')).toBe(5);
    expect(nextWalkInStep('done')).toBe('done');
    expect(previousWalkInStep('stay')).toBe('stay');
  });

  it('bắt lỗi biểu mẫu trước khi gửi, không kiểm giá/tồn thay máy chủ', () => {
    expect(stayIssue(stay)).toBe('ROOM_TYPE');
    expect(stayIssue({ ...stay, roomTypeId: 'rt1', checkOut: '2026-12-24' })).toBe('DATES');
    expect(stayIssue({ ...stay, roomTypeId: 'rt1', adults: '0' })).toBe('COUNTS');
    expect(stayIssue({ ...stay, roomTypeId: 'rt1' })).toBeNull();
    expect(guestIssue({ fullName: ' ', phone: '0912345678' })).toBe('NAME');
    expect(guestIssue({ fullName: 'An', phone: '912' })).toBe('PHONE');
    expect(guestIssue(guest)).toBeNull();
    expect(stepChecks('stay', { ...stay, roomTypeId: 'rt1' }, guest)).toEqual({
      stay: null,
      guest: null,
    });
    expect(stepChecks('guest', stay, { fullName: 'An', phone: '912' }).guest).toBe('PHONE');
  });

  it('dựng đúng body walk-in: không có channelCode, số nguyên, bỏ trường rỗng', () => {
    const body = toWalkInRequest({ ...stay, roomTypeId: 'rt1' }, guest, '  ');
    expect(body).toEqual({
      propertyId: 'p1',
      roomTypeId: 'rt1',
      ratePlanCode: 'FLEX7',
      checkIn: '2026-12-24',
      checkOut: '2026-12-25',
      adults: 2,
      children: 0,
      roomCount: 1,
      guest: { fullName: 'Nguyễn Văn An', phone: '0912345678' },
    });
    expect(Object.hasOwn(body, 'channelCode')).toBe(false);
    expect(Object.hasOwn(body, 'note')).toBe(false);
  });

  it('tiền cọc chỉ nhận số nguyên dương VND', () => {
    expect(amountIssue('600000')).toBeNull();
    expect(amountIssue('0')).toBe('FORMAT');
    expect(amountIssue('600.000')).toBe('FORMAT');
    expect(amountIssue('9007199254740993')).toBe('FORMAT');
  });
});
