/**
 * Danh mục mã lỗi nghiệp vụ — nguồn chân lý: docs/04-thiet-ke/api.md §4.2.
 *
 * Ghi chú quyết định (docs/05-ke-hoach/nhat-ky/QD-01-nen-tang-f0.md):
 * bảng §4.2 có 54 dòng, trong khi ba tài liệu khác ghi "45 mã". Bản thi công bám theo
 * bảng §4.2 (đúng 54 mã) để không bỏ sót mã; ba tài liệu kia phải được cập nhật.
 * QĐ-03 (T5) thêm 7 mã F1 → bảng §4.2 thành 61 mã.
 * HB-035 thêm mã quota đã có ở trigger CSDL; HB-148 thêm chuyển trạng thái task → 63 mã.
 *
 * `httpStatus = null` nghĩa là mã không đi ra như một lỗi HTTP nghiệp vụ (ACK theo giao thức provider).
 */
export const errorCatalogue = {
  E_GEN_VALIDATION_FAILED: { httpStatus: 400, module: 'GEN' },
  E_GEN_RATE_LIMITED: { httpStatus: 429, module: 'GEN' },
  E_SYS_IDEMPOTENCY_KEY_REUSED: { httpStatus: 409, module: 'SYS' },
  E_AUTH_INVALID_CREDENTIALS: { httpStatus: 401, module: 'AUTH' },
  E_AUTH_PIN_REQUIRED: { httpStatus: 401, module: 'AUTH' },
  E_AUTH_ACCOUNT_LOCKED: { httpStatus: 401, module: 'AUTH' },
  E_AUTH_PIN_LOCKED: { httpStatus: 403, module: 'AUTH' },
  E_AUTH_PASSWORD_CHANGE_REQUIRED: { httpStatus: 403, module: 'AUTH' },
  E_AUTH_USERNAME_TAKEN: { httpStatus: 409, module: 'AUTH' },
  E_AUTH_PHONE_REGISTERED: { httpStatus: 409, module: 'AUTH' },
  E_AUTH_RESET_TOKEN_INVALID: { httpStatus: 400, module: 'AUTH' },
  E_RBAC_FORBIDDEN: { httpStatus: 403, module: 'RBAC' },
  E_AUTH_OUT_OF_SCOPE: { httpStatus: 403, module: 'AUTH' },
  E_INV_NO_AVAILABILITY: { httpStatus: 409, module: 'INV' },
  E_INV_ROOM_TAKEN: { httpStatus: 409, module: 'INV' },
  E_INV_ALLOTMENT_EXCEEDS_ROOMS: { httpStatus: 409, module: 'INV' },
  E_INV_LOCK_TIMEOUT: { httpStatus: 409, module: 'INV' },
  E_RATE_BELOW_FLOOR: { httpStatus: 422, module: 'RATE' },
  E_RATE_QUOTE_EXPIRED: { httpStatus: 410, module: 'RATE' },
  E_RATE_PROMO_INVALID: { httpStatus: 422, module: 'RATE' },
  E_BOOK_MISSING_FIELD: { httpStatus: 400, module: 'BOOK' },
  E_BOOK_OVER_CAPACITY: { httpStatus: 422, module: 'BOOK' },
  E_BOOK_SOLD_OUT: { httpStatus: 409, module: 'BOOK' },
  E_BOOK_INVALID_DATES: { httpStatus: 422, module: 'BOOK' },
  E_BOOK_MIN_NIGHTS: { httpStatus: 422, module: 'BOOK' },
  E_BOOK_INVALID_STATE: { httpStatus: 409, module: 'BOOK' },
  E_BOOK_HARD_DELETE_FORBIDDEN: { httpStatus: 409, module: 'BOOK' },
  E_BOOK_CHECKED_IN_IMMUTABLE: { httpStatus: 409, module: 'BOOK' },
  E_BOOK_BLACKLISTED: { httpStatus: 403, module: 'BOOK' },
  E_CANCEL_NOT_ALLOWED: { httpStatus: 409, module: 'CANCEL' },
  E_PAY_REASON_TOO_SHORT: { httpStatus: 400, module: 'PAY' },
  E_PAY_AMOUNT_MISMATCH: { httpStatus: 422, module: 'PAY' },
  E_PAY_CALLBACK_DUPLICATE: { httpStatus: null, module: 'PAY' },
  E_PAY_GATEWAY_ERROR: { httpStatus: 502, module: 'PAY' },
  E_PAY_SIGNATURE_INVALID: { httpStatus: 401, module: 'PAY' },
  E_PAY_GATEWAY_TIMEOUT: { httpStatus: 504, module: 'PAY' },
  E_PAY_REFUND_EXCEEDS_PAID: { httpStatus: 422, module: 'PAY' },
  E_PAY_SELF_APPROVAL: { httpStatus: 403, module: 'PAY' },
  E_PAY_REFUND_NOT_APPROVED: { httpStatus: 409, module: 'PAY' },
  E_PAY_REFUND_NOT_PENDING: { httpStatus: 409, module: 'PAY' },
  E_PAY_REFUND_FORCE_MAJEURE_FORBIDDEN: { httpStatus: 403, module: 'PAY' },
  E_CHAN_SYNC_FAILED: { httpStatus: 502, module: 'CHAN' },
  E_CHAN_SIGNATURE_INVALID: { httpStatus: 401, module: 'CHAN' },
  E_CHAN_REPLAY_DETECTED: { httpStatus: 409, module: 'CHAN' },
  E_OVER_LIMIT_EXCEEDED: { httpStatus: 409, module: 'OVER' },
  E_OVER_MERGE_GENDER: { httpStatus: 409, module: 'OVER' },
  E_OVER_NO_CONSENT: { httpStatus: 409, module: 'OVER' },
  E_OVER_NO_PLAN_AVAILABLE: { httpStatus: 409, module: 'OVER' },
  E_OVER_MOVE_NOT_ALLOWED: { httpStatus: 409, module: 'OVER' },
  E_OVER_APPROVAL_REQUIRED: { httpStatus: 403, module: 'OVER' },
  E_OVER_CROSS_CITY_NO_CONSENT: { httpStatus: 409, module: 'OVER' },
  E_OVER_CASE_DEADLINE_PASSED: { httpStatus: 409, module: 'OVER' },
  E_FO_CHECKIN_NOT_ALLOWED: { httpStatus: 409, module: 'FO' },
  E_FO_TASK_TRANSITION_NOT_ALLOWED: { httpStatus: 409, module: 'FO' },
  E_CRM_PHONE_INVALID: { httpStatus: 422, module: 'CRM' },
  E_GEN_SERVICE_UNAVAILABLE: { httpStatus: 503, module: 'GEN' },
  E_SYS_AUDIT_IMMUTABLE: { httpStatus: 405, module: 'SYS' },
  E_GEN_NOT_FOUND: { httpStatus: 404, module: 'GEN' },
  E_GEN_PRECONDITION_REQUIRED: { httpStatus: 428, module: 'GEN' },
  E_GEN_VERSION_CONFLICT: { httpStatus: 412, module: 'GEN' },
  E_SYS_REQUEST_IN_PROGRESS: { httpStatus: 409, module: 'SYS' },
  E_RATE_QUOTE_MISMATCH: { httpStatus: 409, module: 'RATE' },
  E_RATE_CONFIGURATION_INVALID: { httpStatus: 422, module: 'RATE' },
} as const satisfies Record<string, { httpStatus: number | null; module: string }>;

export type ErrorCode = keyof typeof errorCatalogue;

/** Liệt kê khoá của một bản ghi literal mà không cần ép kiểu. */
function definedKeys<T extends Record<string, unknown>>(record: T): readonly (keyof T & string)[] {
  return Object.keys(record).filter((key): key is keyof T & string => Object.hasOwn(record, key));
}

export const errorCodes: readonly ErrorCode[] = definedKeys(errorCatalogue);

/** Mã lỗi dạng `E_<MOD>_<TÊN>` (00 §6). */
export const errorCodePattern = /^E_[A-Z]+_[A-Z_]+$/;

export function isErrorCode(value: string): value is ErrorCode {
  return Object.hasOwn(errorCatalogue, value);
}
