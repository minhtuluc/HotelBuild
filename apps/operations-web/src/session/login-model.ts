/**
 * Phần thuần của SCR-14: kiểm biểu mẫu theo hợp đồng đã công bố, phân loại lỗi đăng nhập/đổi mật khẩu.
 * Chỉ suy từ `code` và lớp HTTP, không từ `message` của máy chủ (thiết kế màn hình §8.1); không có luật
 * phân quyền hay ngưỡng khoá ở đây — máy chủ quyết (ADR-018).
 */
import { isApiError, type ApiError } from '@pinehill/api-client';

export type FieldIssue = 'REQUIRED' | 'LENGTH' | 'MISMATCH';

/** `loginRequestSchema`: username 3–64, password 8–128. */
const USERNAME = { min: 3, max: 64 } as const;
const PASSWORD = { min: 8, max: 128 } as const;

export interface LoginDraft {
  readonly username: string;
  readonly password: string;
}

export function validateLogin(draft: LoginDraft): { username?: FieldIssue; password?: FieldIssue } {
  const username = draft.username.trim();
  return {
    ...(username === ''
      ? { username: 'REQUIRED' as const }
      : username.length < USERNAME.min || username.length > USERNAME.max
        ? { username: 'LENGTH' as const }
        : {}),
    ...(draft.password === ''
      ? { password: 'REQUIRED' as const }
      : draft.password.length < PASSWORD.min || draft.password.length > PASSWORD.max
        ? { password: 'LENGTH' as const }
        : {}),
  };
}

export type LoginFailure =
  | { readonly kind: 'invalid' }
  | { readonly kind: 'locked'; readonly waitSeconds?: number }
  | { readonly kind: 'rateLimited'; readonly waitSeconds?: number }
  | { readonly kind: 'network' }
  | { readonly kind: 'unknown'; readonly code: string };

function wait(
  headerSeconds: number | undefined,
  bodySeconds: number | undefined,
): { waitSeconds?: number } {
  const value = bodySeconds ?? headerSeconds;
  return value !== undefined && Number.isFinite(value) && value > 0 ? { waitSeconds: value } : {};
}

function waitedFailure(
  kind: 'locked' | 'rateLimited',
  error: ApiError,
  retryAfter: number | undefined,
): LoginFailure {
  return { kind, ...wait(retryAfter, error.retryAfterSeconds) };
}

function isTransport(error: ApiError): boolean {
  return error.kind !== 'http' || (error.status ?? 0) >= 500;
}

/** `retryAfter` là giây từ header `Retry-After` của BFF (session client không chuyển tiếp trường này). */
export function loginFailure(error: unknown, retryAfter?: number): LoginFailure {
  if (!isApiError(error)) return { kind: 'network' };
  if (error.code === 'E_AUTH_ACCOUNT_LOCKED') return waitedFailure('locked', error, retryAfter);
  if (error.code === 'E_GEN_RATE_LIMITED' || error.status === 429)
    return waitedFailure('rateLimited', error, retryAfter);
  if (error.code === 'E_AUTH_INVALID_CREDENTIALS' || error.code === 'E_GEN_VALIDATION_FAILED')
    return { kind: 'invalid' };
  if (isTransport(error)) return { kind: 'network' };
  return { kind: 'unknown', code: error.code ?? String(error.status ?? 'UNKNOWN') };
}

/** Thời gian chờ đọc được: dưới 1 phút nói giây, từ 1 phút làm tròn lên phút. */
export function formatWait(seconds: number): string {
  return seconds < 60 ? `${seconds} giây` : `${Math.ceil(seconds / 60)} phút`;
}

export interface PasswordChangeDraft {
  readonly current: string;
  readonly next: string;
  readonly confirm: string;
}

/** `changePasswordRequestSchema`: mới 8–128; xác nhận phải khớp. Không tự đặt thêm luật độ mạnh. */
export function validatePasswordChange(draft: PasswordChangeDraft): {
  current?: FieldIssue;
  next?: FieldIssue;
  confirm?: FieldIssue;
} {
  return {
    ...(draft.current === '' ? { current: 'REQUIRED' as const } : {}),
    ...(draft.next === ''
      ? { next: 'REQUIRED' as const }
      : draft.next.length < PASSWORD.min || draft.next.length > PASSWORD.max
        ? { next: 'LENGTH' as const }
        : {}),
    ...(draft.confirm === ''
      ? { confirm: 'REQUIRED' as const }
      : draft.next !== '' && draft.confirm !== draft.next
        ? { confirm: 'MISMATCH' as const }
        : {}),
  };
}

export type PasswordChangeFailure =
  | { readonly kind: 'wrongCurrent' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'rateLimited' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'unknownOutcome' };

/** Mất mạng/hết giờ/5xx sau khi gửi ⇒ **chưa xác định kết quả**, không hứa thất bại chắc chắn. */
export function passwordChangeFailure(error: unknown): PasswordChangeFailure {
  if (!isApiError(error)) return { kind: 'unknownOutcome' };
  if (error.status === 429) return { kind: 'rateLimited' };
  if (error.code === 'E_AUTH_INVALID_CREDENTIALS') return { kind: 'wrongCurrent' };
  if (error.status === 400 || error.status === 422) return { kind: 'invalid' };
  if (error.status === 403 || error.status === 401) return { kind: 'forbidden' };
  return { kind: 'unknownOutcome' };
}
