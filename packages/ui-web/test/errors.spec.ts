import { describe, expect, it } from 'vitest';
import {
  actionMessageKey,
  expectedHttpStatus,
  mapErrorToUiAction,
  waitMessage,
} from '../src/errors.js';
import { viCatalog } from '../src/messages.js';

describe('ánh xạ mã lỗi sang hành động UI', () => {
  it('ưu tiên hướng xử lý riêng đã ghi ở api.md §4.2', () => {
    expect(mapErrorToUiAction({ code: 'E_AUTH_PIN_REQUIRED', status: 401 })).toBe('enter-pin');
    expect(mapErrorToUiAction({ code: 'E_SYS_REQUEST_IN_PROGRESS', status: 409 })).toBe(
      'retry-after',
    );
    expect(mapErrorToUiAction({ code: 'E_SYS_IDEMPOTENCY_KEY_REUSED', status: 409 })).toBe(
      'new-idempotency-key',
    );
    expect(mapErrorToUiAction({ code: 'E_GEN_VERSION_CONFLICT', status: 412 })).toBe(
      'reload-and-diff',
    );
  });

  it('rơi về lớp HTTP khi chưa có ánh xạ riêng', () => {
    expect(mapErrorToUiAction({ code: 'E_BOOK_MIN_NIGHTS', status: 422 })).toBe('fix-fields');
    expect(mapErrorToUiAction({ status: 428 })).toBe('reload-and-diff');
    expect(mapErrorToUiAction({ status: 503 })).toBe('retry-later');
    expect(mapErrorToUiAction({ status: 401 })).toBe('reauth');
    expect(mapErrorToUiAction({ status: 403 })).toBe('request-access');
  });

  it('không rơi vào im lặng khi thiếu cả mã lẫn trạng thái', () => {
    expect(mapErrorToUiAction({})).toBe('contact-support');
    expect(mapErrorToUiAction({ code: 'E_FUTURE_UNKNOWN', status: 418 })).toBe('contact-support');
  });

  it('mã đã biết thì tra được mã HTTP chuẩn của danh mục', () => {
    expect(expectedHttpStatus('E_INV_ROOM_TAKEN')).toBe(409);
    expect(expectedHttpStatus('E_PAY_CALLBACK_DUPLICATE')).toBeNull();
    expect(expectedHttpStatus('E_FUTURE_UNKNOWN')).toBeNull();
  });

  it('mã lỗi F5 có hành động riêng (HB-090)', () => {
    expect(mapErrorToUiAction({ code: 'E_PAY_AMOUNT_MISMATCH', status: 422 })).toBe('fix-fields');
    expect(mapErrorToUiAction({ code: 'E_PAY_REFUND_EXCEEDS_PAID', status: 422 })).toBe(
      'fix-fields',
    );
    expect(mapErrorToUiAction({ code: 'E_PAY_GATEWAY_ERROR', status: 502 })).toBe('retry-later');
    expect(mapErrorToUiAction({ code: 'E_PAY_GATEWAY_TIMEOUT', status: 504 })).toBe('retry-later');
    expect(mapErrorToUiAction({ code: 'E_PAY_SIGNATURE_INVALID' })).toBe('contact-support');
    expect(mapErrorToUiAction({ code: 'E_PAY_SELF_APPROVAL', status: 403 })).toBe('request-access');
    expect(mapErrorToUiAction({ code: 'E_CANCEL_NOT_ALLOWED', status: 409 })).toBe(
      'reload-and-diff',
    );
  });

  it('mã lỗi F1 có hành động riêng theo QĐ-03', () => {
    expect(mapErrorToUiAction({ code: 'E_AUTH_ACCOUNT_LOCKED', status: 401 })).toBe('retry-after');
    expect(mapErrorToUiAction({ code: 'E_AUTH_PIN_LOCKED', status: 403 })).toBe('retry-after');
    expect(mapErrorToUiAction({ code: 'E_GEN_RATE_LIMITED', status: 429 })).toBe('retry-after');
    expect(mapErrorToUiAction({ status: 429 })).toBe('retry-after');
    expect(mapErrorToUiAction({ code: 'E_AUTH_PASSWORD_CHANGE_REQUIRED', status: 403 })).toBe(
      'change-password',
    );
    expect(mapErrorToUiAction({ code: 'E_AUTH_USERNAME_TAKEN', status: 409 })).toBe('fix-fields');
    expect(mapErrorToUiAction({ code: 'E_AUTH_PHONE_REGISTERED', status: 409 })).toBe(
      'contact-support',
    );
    expect(mapErrorToUiAction({ code: 'E_AUTH_RESET_TOKEN_INVALID', status: 400 })).toBe(
      'request-new-link',
    );
    expect(waitMessage('E_GEN_RATE_LIMITED', 30)).toBe(
      'Bạn đã gửi quá nhiều yêu cầu. Thử lại sau 1 phút.',
    );
    expect(waitMessage('E_AUTH_ACCOUNT_LOCKED', 900)).toContain('15 phút');
    expect(waitMessage('E_AUTH_ACCOUNT_LOCKED', 61)).toContain('2 phút');
    expect(waitMessage('E_INV_ROOM_TAKEN', 60)).toBeUndefined();
  });
});

describe('câu chữ hướng dẫn theo hành động', () => {
  it('mọi hành động đều có câu chữ trong danh mục, không viết cứng', () => {
    const actions = [
      'enter-pin',
      'reauth',
      'change-password',
      'request-new-link',
      'request-access',
      'not-found',
      'new-idempotency-key',
      'retry-after',
      'reload-and-diff',
      'restart-quote',
      'reload-and-reselect',
      'fix-fields',
      'retry-later',
      'contact-support',
    ] as const;
    for (const action of actions) {
      expect(viCatalog[actionMessageKey(action)]).toBeTruthy();
    }
    expect(new Set(actions.map((action) => actionMessageKey(action))).size).toBe(actions.length);
  });
});
