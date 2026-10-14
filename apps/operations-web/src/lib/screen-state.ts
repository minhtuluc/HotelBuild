import { isApiError, type ApiError } from '@pinehill/api-client';
import type { ScreenState } from '@pinehill/ui-web';
import { t } from './i18n';

/**
 * Ánh xạ lỗi API sang trạng thái màn hình (§8.1) cho các màn F2/F3. Hàm thuần, không React —
 * nguồn câu chữ là danh mục `lib/i18n.ts` (NFR-LOC-01), không viết cứng tại chỗ.
 * Chỉ suy từ `code` và lớp HTTP — **không** từ `message` của server (thiết kế màn hình §8.1).
 */
export const VERSION_UNKNOWN = t('screen.version.unknown');

/** Phiên bản mặc định khi màn hình chưa có bản của máy chủ để so sánh. */
export const VERSION_NEW = t('screen.version.new');

/** Trường lỗi khi server trả 400/422 mà không kèm `details[]`. */
export const FORM_WIDE_FIELD = t('screen.field.formWide');

const CONFLICT_CODES: readonly string[] = [
  'E_GEN_VERSION_CONFLICT',
  'E_GEN_PRECONDITION_REQUIRED',
  'E_SYS_IDEMPOTENCY_KEY_REUSED',
];

export interface WriteContext {
  /** Phiên bản người dùng đang giữ khi gửi lệnh — hiện trong thông báo xung đột. */
  attemptedVersion: string;
  onReload: () => void;
  onLookup: () => void;
}

function isConflict(error: ApiError): boolean {
  if (error.status === 412 || error.status === 428) return true;
  return error.code !== undefined && CONFLICT_CODES.includes(error.code);
}

function reference(error: ApiError): string {
  return error.traceId ?? error.correlationId ?? t('screen.reference.none');
}

function validationDetails(error: ApiError): ScreenState {
  const details = error.details;
  if (details !== undefined && details.length > 0) return { kind: 'validationError', details };
  return {
    kind: 'validationError',
    details: [{ field: FORM_WIDE_FIELD, issue: error.code ?? t('screen.issue.invalid') }],
  };
}

/**
 * Lỗi khi **đọc** dữ liệu: 403/401 → thiếu quyền; còn lại `undefined` để màn hình hiện băng lỗi
 * và giữ nguyên nội dung đã có (không hiện "chưa có dữ liệu" như thể máy chủ trả rỗng).
 */
export function readFailureState(error: ApiError): ScreenState | undefined {
  return error.status === 403 || error.status === 401 ? { kind: 'forbidden' } : undefined;
}

/**
 * Lỗi khi **ghi**: 412/428/409 phiên bản → xung đột (không tự ghi đè); 400/422 → lỗi theo trường
 * (giữ nguyên bản nhập); 403/401 → thiếu quyền; mọi trường hợp còn lại (mạng, hết thời gian, 5xx)
 * → **chưa xác định kết quả**, tuyệt đối không báo thất bại chắc chắn rồi cho gửi lại.
 */
export function writeFailureState(caught: unknown, context: WriteContext): ScreenState {
  if (!isApiError(caught)) {
    // Phản hồi sai hợp đồng: không rõ máy chủ đã áp dụng lệnh hay chưa → không báo thất bại chắc chắn.
    return {
      kind: 'unknownOutcome',
      referenceId: t('screen.reference.none'),
      onLookup: context.onLookup,
    };
  }
  const error: ApiError = caught;
  if (error.status === 403 || error.status === 401) return { kind: 'forbidden' };
  if (isConflict(error)) {
    return {
      kind: 'conflict',
      currentVersion: VERSION_UNKNOWN,
      attemptedVersion: context.attemptedVersion,
      onReload: context.onReload,
    };
  }
  if (error.status === 400 || error.status === 422) return validationDetails(error);
  return { kind: 'unknownOutcome', referenceId: reference(error), onLookup: context.onLookup };
}
