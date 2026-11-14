/**
 * HB-310/HB-311 — phần thuần của "sửa / ngừng" cấu hình giá (mùa SCR-27, khuyến mãi SCR-29), dùng
 * `PUT` + `If-Match` + `reason` (HB-240, HB-241). Kiểm được bằng vitest; không chứa quy tắc giá.
 *
 * - Chỉ gửi **trường đổi** so với bản đang xem; không đổi gì thì không gọi API.
 * - Lý do bắt buộc (1–500 ký tự) vì máy chủ ghi audit.
 * - Lỗi ghi được phân loại để màn hình báo ngay trong khung sửa, không thay cả màn bằng trạng thái lỗi
 *   (MANAGER xem được nhưng chỉ OWNER sửa: 403 khi sửa không có nghĩa là mất quyền xem).
 */
import { isApiError } from '@pinehill/api-client';

export const REASON_MAX = 500;

export interface EditIssue {
  field: string;
  issue: string;
}

export function reasonIssues(reason: string): readonly EditIssue[] {
  const trimmed = reason.trim();
  if (trimmed === '') return [{ field: 'reason', issue: 'REQUIRED' }];
  if (trimmed.length > REASON_MAX) return [{ field: 'reason', issue: 'TOO_LONG' }];
  return [];
}

/** `If-Match` theo phiên bản của bản đang xem (`"<version>"`). */
export function ifMatchOf(version: number): string {
  return `"${version}"`;
}

/** Hai số thập phân coi như bằng nhau khi lệch dưới 0,0005 (hệ số hiển thị 2 chữ số). */
export function sameDecimal(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.0005;
}

export type EditFailure =
  | { kind: 'forbidden' }
  | { kind: 'conflict' }
  | { kind: 'invalid'; details: readonly EditIssue[]; code: string | undefined }
  | { kind: 'unknown'; reference: string | undefined };

const CONFLICT_CODES = ['E_GEN_VERSION_CONFLICT', 'E_GEN_PRECONDITION_REQUIRED'];

function isConflictError(status: number | undefined, code: string | undefined): boolean {
  if (status === 409 || status === 412 || status === 428) return true;
  return code !== undefined && CONFLICT_CODES.includes(code);
}

/** Phân loại lỗi của lệnh sửa. Lỗi không phải `ApiError` (vd. phản hồi sai hợp đồng) là "chưa rõ". */
export function editFailure(caught: unknown): EditFailure {
  if (!isApiError(caught)) return { kind: 'unknown', reference: undefined };
  const { status, code } = caught;
  if (status === 401 || status === 403) return { kind: 'forbidden' };
  if (isConflictError(status, code)) return { kind: 'conflict' };
  if (status === 400 || status === 422)
    return { kind: 'invalid', details: caught.details ?? [], code };
  return { kind: 'unknown', reference: caught.traceId ?? caught.correlationId };
}
