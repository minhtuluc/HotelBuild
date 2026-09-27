import { errorCatalogue, isErrorCode } from '@pinehill/contracts';
import type { MessageKey } from './messages.js';

/**
 * Hành vi UI suy ra từ mã lỗi — UI **chỉ** suy từ `code`, không từ `message` (§8.1).
 * Ánh xạ riêng cho các mã có hướng xử lý ghi rõ ở api.md §4.2; còn lại theo lớp HTTP.
 */
export type UiAction =
  | 'enter-pin'
  | 'reauth'
  | 'request-access'
  | 'not-found'
  | 'new-idempotency-key'
  | 'retry-after'
  | 'reload-and-diff'
  | 'restart-quote'
  | 'reload-and-reselect'
  | 'fix-fields'
  | 'retry-later'
  | 'contact-support';

const BY_CODE: Readonly<Record<string, UiAction>> = {
  E_AUTH_PIN_REQUIRED: 'enter-pin',
  E_SYS_IDEMPOTENCY_KEY_REUSED: 'new-idempotency-key',
  E_SYS_REQUEST_IN_PROGRESS: 'retry-after',
  E_INV_ROOM_TAKEN: 'reload-and-reselect',
  E_INV_NO_AVAILABILITY: 'reload-and-reselect',
  E_INV_LOCK_TIMEOUT: 'retry-later',
  E_BOOK_SOLD_OUT: 'reload-and-reselect',
  E_CANCEL_NOT_ALLOWED: 'reload-and-diff',
  E_PAY_REFUND_NOT_APPROVED: 'reload-and-diff',
  E_PAY_REFUND_NOT_PENDING: 'reload-and-diff',
  E_OVER_CASE_DEADLINE_PASSED: 'reload-and-diff',
  E_BOOK_HARD_DELETE_FORBIDDEN: 'reload-and-diff',
  E_BOOK_CHECKED_IN_IMMUTABLE: 'reload-and-diff',
  E_BOOK_BLACKLISTED: 'request-access',
  E_PAY_SELF_APPROVAL: 'request-access',
  E_PAY_REFUND_FORCE_MAJEURE_FORBIDDEN: 'request-access',
  E_OVER_APPROVAL_REQUIRED: 'request-access',
};

const BY_STATUS: Readonly<Record<number, UiAction>> = {
  400: 'fix-fields',
  401: 'reauth',
  403: 'request-access',
  404: 'not-found',
  409: 'reload-and-diff',
  410: 'restart-quote',
  412: 'reload-and-diff',
  422: 'fix-fields',
  428: 'reload-and-diff',
  502: 'retry-later',
  503: 'retry-later',
  504: 'retry-later',
};

export interface ErrorSignal {
  code?: string | undefined;
  status?: number | undefined;
}

/** Hành động gợi ý cho người dùng cuối. */
export function mapErrorToUiAction(signal: ErrorSignal): UiAction {
  if (signal.code !== undefined) {
    const mapped = BY_CODE[signal.code];
    if (mapped !== undefined) return mapped;
  }
  if (signal.status !== undefined) {
    const mapped = BY_STATUS[signal.status];
    if (mapped !== undefined) return mapped;
    if (signal.status >= 500) return 'retry-later';
  }
  return 'contact-support';
}

const ACTION_MESSAGES: Readonly<Record<UiAction, MessageKey>> = {
  'enter-pin': 'action.enterPin',
  reauth: 'action.reauth',
  'request-access': 'action.requestAccess',
  'not-found': 'action.notFound',
  'new-idempotency-key': 'action.newKey',
  'retry-after': 'action.retryAfter',
  'reload-and-diff': 'action.reloadAndDiff',
  'restart-quote': 'action.restartQuote',
  'reload-and-reselect': 'action.reloadAndReselect',
  'fix-fields': 'action.fixFields',
  'retry-later': 'action.retryLater',
  'contact-support': 'action.contactSupport',
};

/** Câu chữ hướng dẫn người dùng cho một hành động — nguồn duy nhất là danh mục i18n. */
export function actionMessageKey(action: UiAction): MessageKey {
  return ACTION_MESSAGES[action];
}

/** Mã lỗi đã biết thì lấy mã HTTP chuẩn của danh mục, tránh UI tự đoán. */
export function expectedHttpStatus(code: string): number | null {
  return isErrorCode(code) ? errorCatalogue[code].httpStatus : null;
}
