import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import { channelSyncRequestSchema } from '@pinehill/contracts';
import { invalid, missing } from '../../sys/settings/validation.js';

/** Lệnh đồng bộ đã chuẩn hoá; `from`/`to` chỉ có nghĩa khi `scope = RANGE`. */
export interface SyncInput {
  readonly scope: 'FULL' | 'RANGE';
  readonly from: string | null;
  readonly to: string | null;
  readonly roomTypeIds: readonly string[] | null;
}

/**
 * Tham số đường dẫn trên request Fastify (`request.params` là `unknown` với kiểu generic): không bao giờ
 * đọc bằng `as`, chỉ nhận chuỗi thật.
 */
export function pathParam(request: FastifyRequest, name: string): string {
  const params: unknown = request.params;
  if (typeof params !== 'object' || params === null) throw invalid();
  const value: unknown = Reflect.get(params, name);
  if (typeof value !== 'string') throw invalid();
  return value;
}

/** `channelId` sai định dạng là "không tìm thấy" (404), không phải lỗi thân lệnh. */
export function channelIdParam(value: string): string {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw missing();
  return parsed.data.toLowerCase();
}

/** `channelSyncRequestSchema` đã là nguồn chân lý (strict, RANGE bắt buộc đủ mốc, `to >= from`). */
export function syncInput(value: unknown): SyncInput {
  const parsed = channelSyncRequestSchema.safeParse(value);
  if (!parsed.success) throw invalid();
  return {
    scope: parsed.data.scope,
    from: parsed.data.from ?? null,
    to: parsed.data.to ?? null,
    roomTypeIds: parsed.data.roomTypeIds ?? null,
  };
}

/** Loại phòng trong lệnh đồng bộ: UUID hạ chữ thường, sai định dạng ⇒ 400. */
export function roomTypeIdsInput(value: readonly string[]): readonly string[] {
  return value.map((id) => {
    const parsed = z.uuid().safeParse(id);
    if (!parsed.success) throw invalid();
    return parsed.data.toLowerCase();
  });
}
