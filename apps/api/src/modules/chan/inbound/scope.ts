/**
 * Phân giải phạm vi của một sự kiện OTA: `channelCode → channels.id`, `propertyCode → properties.id`,
 * `roomTypeCode → channel_mappings.room_type_id` (api.md §5.1: ánh xạ duy nhất bên ngoài ↔ loại phòng).
 *
 * Không đoán: thiếu bất kỳ mắt nào trả **mã cách ly** thay vì tạo booking ở cơ sở/loại phòng khác
 * (AC11). Hàm chỉ đọc; người gọi đang giữ transaction và khoá tài nguyên ADR-014.
 */
import type { Prisma } from '@prisma/client';
import { OTA_CODE } from './codes.js';
import type { OtaPayload } from './payload.js';

export interface OtaScope {
  readonly channelId: string;
  readonly propertyId: string;
  readonly roomTypeId: string;
}

/** Kết cục "không áp được" — `reason` là mã ngắn, dùng cho `last_error`/audit đối soát. */
export interface OtaFailure {
  readonly reason: string;
}

export function failed(reason: string): OtaFailure {
  return { reason };
}

export function isFailure<T extends object>(value: T | OtaFailure): value is OtaFailure {
  return 'reason' in value;
}

type Tx = Prisma.TransactionClient;

export async function resolveScope(tx: Tx, payload: OtaPayload): Promise<OtaScope | OtaFailure> {
  const channel = await tx.channels.findUnique({
    where: { code: payload.channelCode },
    select: { id: true },
  });
  if (channel === null) return failed(OTA_CODE.channelUnmapped);
  const property = await tx.properties.findUnique({
    where: { code: payload.propertyCode },
    select: { id: true },
  });
  if (property === null) return failed(OTA_CODE.propertyUnmapped);
  const mapping = await tx.channel_mappings.findFirst({
    where: { channel_id: channel.id, external_room_code: payload.roomTypeCode },
    select: { room_type_id: true },
  });
  if (mapping === null) return failed(OTA_CODE.roomTypeUnmapped);
  const type = await tx.room_types.findUnique({
    where: { id: mapping.room_type_id },
    select: { property_id: true },
  });
  if (type === null || type.property_id !== property.id) return failed(OTA_CODE.roomTypeUnmapped);
  return { channelId: channel.id, propertyId: property.id, roomTypeId: mapping.room_type_id };
}
