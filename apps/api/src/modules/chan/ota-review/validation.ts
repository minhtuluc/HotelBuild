import { z } from 'zod';
import { otaBookingFlagRequestSchema } from '@pinehill/contracts';
import { AppError } from '../../../common/app-error.js';
import { maskOperationalText } from '../../prop/room-blocks/operational-text.js';

/**
 * AC12 — đánh dấu nghi trùng chỉ gắn/gỡ cờ trên booking, không huỷ/gộp và không đụng tiền. Vì vậy
 * toàn bộ đầu vào ở đây là *hình dạng lệnh*, không phải một phần của booking: `flagged` quyết định
 * gắn hay gỡ, `reason` là lý do bắt buộc mà người vận hành phải nêu.
 */
export const invalid = () => new AppError(400, 'E_GEN_VALIDATION_FAILED', 'Yêu cầu không hợp lệ.');

export const missing = () =>
  new AppError(404, 'E_GEN_NOT_FOUND', 'Không tìm thấy booking OTA của kênh này.');

export const forbidden = () =>
  new AppError(403, 'E_RBAC_FORBIDDEN', 'Bạn không được thực hiện thao tác này.');

const versionConflict = () =>
  new AppError(412, 'E_GEN_VERSION_CONFLICT', 'Phiên bản booking đã thay đổi.');

export interface DuplicateFlagInput {
  readonly flagged: boolean;
  readonly reason: string;
}

/** `reason` đi vào cả bản ghi lẫn nhật ký nên che PII theo NFR-SEC-03 ngay tại biên. */
export function flagInput(value: unknown): DuplicateFlagInput {
  const result = otaBookingFlagRequestSchema.safeParse(value);
  if (!result.success) throw invalid();
  return { flagged: result.data.flagged, reason: maskOperationalText(result.data.reason) };
}

const routeParams = z.strictObject({ channelId: z.uuid(), bookingId: z.uuid() });

export interface DuplicateFlagScope {
  readonly channelId: string;
  readonly bookingId: string;
}

/** Hai định danh trong đường dẫn là **phạm vi khoá**: kênh sai ⇒ 404, không phải 403. */
export function params(value: unknown): DuplicateFlagScope {
  const result = routeParams.safeParse(value);
  if (!result.success) throw invalid();
  return {
    channelId: result.data.channelId.toLowerCase(),
    bookingId: result.data.bookingId.toLowerCase(),
  };
}

const maximumVersion = 9223372036854775807n;

/** `If-Match` bắt buộc (thiếu ⇒ 428, sai định dạng/lệch ⇒ 412) — HB-120 §2.7. */
export function expectedVersion(value: unknown): bigint {
  if (value === undefined)
    throw new AppError(428, 'E_GEN_PRECONDITION_REQUIRED', 'Thiếu If-Match.');
  if (typeof value !== 'string' || !/^"[1-9]\d{0,18}"$/.test(value)) throw versionConflict();
  const version = BigInt(value.slice(1, -1));
  if (version > maximumVersion) throw versionConflict();
  return version;
}

export const etagOf = (version: bigint): string => `"${version}"`;
