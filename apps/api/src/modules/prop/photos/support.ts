/**
 * HB-244 — tiện ích chung của ảnh công khai: ETag băm danh sách, kiểm `If-Match`, lỗi chuẩn.
 * Dòng ảnh bất biến (không có `version`), nên ETag là băm SHA-256 của danh sách đúng thứ tự hiển thị.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { photoReplaceRequestSchema, type PublicPhoto } from '@pinehill/contracts';
import { AppError } from '../../../common/app-error.js';

export interface PhotoRow {
  readonly url: string;
  readonly alt: string;
  readonly width: number;
  readonly height: number;
}

export interface PhotoReplaceInput {
  readonly photos: readonly PublicPhoto[];
  readonly reason: string;
}

export const missing = () => new AppError(404, 'E_GEN_NOT_FOUND', 'Không tìm thấy.');
export const invalid = () => new AppError(400, 'E_GEN_VALIDATION_FAILED', 'Yêu cầu không hợp lệ.');
export const conflict = () =>
  new AppError(412, 'E_GEN_VERSION_CONFLICT', 'Danh sách ảnh đã thay đổi; hãy tải lại.');
export const forbidden = () =>
  new AppError(403, 'E_RBAC_FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này.');

export function photoView(row: PhotoRow): PublicPhoto {
  return { url: row.url, alt: row.alt, width: row.width, height: row.height };
}

/** ETag mạnh `"<32 hex>"` của danh sách đúng thứ tự; danh sách rỗng cũng có ETag riêng. */
export function photosEtag(rows: readonly PhotoRow[]): string {
  const digest = createHash('sha256')
    .update(JSON.stringify(rows.map(photoView)))
    .digest('hex')
    .slice(0, 32);
  return `"${digest}"`;
}

/** `If-Match` bắt buộc (428) và phải là ETag mạnh dạng `"…"`, không wildcard/weak (412). */
export function expectedEtag(value: unknown): string {
  if (value === undefined)
    throw new AppError(428, 'E_GEN_PRECONDITION_REQUIRED', 'Cần If-Match để thay ảnh.');
  if (typeof value !== 'string' || !/^"[0-9a-f]{32}"$/.test(value)) throw conflict();
  return value;
}

export function uuid(value: unknown): string {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw invalid();
  return parsed.data.toLowerCase();
}

export function replaceInput(value: unknown): PhotoReplaceInput {
  const parsed = photoReplaceRequestSchema.safeParse(value);
  if (!parsed.success) throw invalid();
  return { photos: parsed.data.photos, reason: parsed.data.reason };
}
