import { availabilityQuerySchema } from '@pinehill/contracts';
import type { ChannelCode } from '@pinehill/domain/inventory';
import { invalid, uuid, validDate } from '../allotments/validation.js';

/**
 * Con trỏ keyset `(code, id)` của danh sách loại phòng. Chuỗi base64url nên mờ với client;
 * nội dung không phải hợp đồng và có thể đổi.
 */
const encodedPattern = /^[A-Za-z0-9_-]{8,200}$/;
const decodedPattern = /^([^|]{1,40})\|([0-9a-fA-F-]{36})$/;
const codePattern = /^[A-Za-z0-9._-]{1,40}$/;

export interface RoomTypeCursor {
  readonly code: string;
  readonly id: string;
}

/** Truy vấn tìm phòng trống đã chuẩn hoá: UUID hạ chữ thường, ngày lịch đã kiểm, con trỏ đã giải. */
export interface AvailabilityInput {
  readonly propertyId: string;
  readonly roomTypeId?: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly adults: number;
  readonly children: number;
  readonly roomCount: number;
  readonly channelCode?: ChannelCode;
  readonly limit: number;
  /** Khoá tiếp tục keyset; `null` nghĩa là bắt đầu từ đầu danh sách. */
  readonly after: RoomTypeCursor | null;
}

export function encodeCursor(code: string, id: string): string {
  return Buffer.from(`${code}|${id}`, 'utf8').toString('base64url');
}

export function decodeCursor(value: string): RoomTypeCursor {
  if (!encodedPattern.test(value)) throw invalid();
  const match = decodedPattern.exec(Buffer.from(value, 'base64url').toString('utf8'));
  if (!match || !codePattern.test(match[1]!)) throw invalid();
  return { code: match[1]!, id: uuid(match[2]!) };
}

/** Ngày nghiệp vụ `YYYY-MM-DD` ⇒ số đêm của khoảng nửa mở `[checkIn, checkOut)`. */
export function nightsBetween(checkIn: string, checkOut: string): number {
  const start = Date.parse(`${checkIn}T00:00:00Z`);
  const end = Date.parse(`${checkOut}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

/** Hình dạng do `availabilityQuerySchema` chốt; `businessDateSchema` chỉ kiểm định dạng nên kiểm lại ngày lịch. */
export function availabilityInput(value: unknown): AvailabilityInput {
  const result = availabilityQuerySchema.safeParse(value);
  if (!result.success) throw invalid();
  const input = result.data;
  if (!validDate(input.checkIn) || !validDate(input.checkOut)) throw invalid();
  return {
    propertyId: uuid(input.propertyId),
    ...(input.roomTypeId === undefined ? {} : { roomTypeId: uuid(input.roomTypeId) }),
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    adults: input.adults,
    children: input.children,
    roomCount: input.roomCount,
    ...(input.channelCode === undefined ? {} : { channelCode: input.channelCode }),
    limit: input.limit,
    after: input.cursor === undefined ? null : decodeCursor(input.cursor),
  };
}
