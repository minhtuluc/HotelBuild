/**
 * SCR-08 (HB-023) — phần thuần của đăng ký/đăng nhập/quên mật khẩu khách, kiểm bằng vitest.
 *
 * Ranh giới (ADR-018): biểu mẫu chỉ kiểm hình dạng nhập để báo lỗi sớm. Việc SĐT đã có hồ sơ/tài khoản,
 * sai mật khẩu, khoá tài khoản, token hết hạn hay chiếm hồ sơ khách là của máy chủ; màn hình chỉ hiển
 * thị theo **mã lỗi** (không theo `message`). Hợp đồng `phoneNumberSchema` chỉ nhận `+84XXXXXXXXX`
 * nên đổi `0…`/`84…` sang dạng chuẩn ở đây là bắt buộc để gửi được; BR-CRM-01 vẫn do máy chủ quyết.
 */
import { isApiError } from '@pinehill/api-client';
import type { GuestRegisterRequest } from '@pinehill/contracts';

/**
 * Phiên bản điều khoản đồng ý nhận tiếp thị gửi kèm đăng ký (NFR-COMP-01, `Guest.consentVersion`).
 * Docs chưa nêu nguồn của giá trị này; đổi khi điều khoản được công bố bản mới.
 */
export const GUEST_CONSENT_VERSION = '2026-10';

const PHONE_SEPARATORS = /[\s().-]/g;
const NATIONAL = /^0(\d{9})$/;
const COUNTRY = /^\+?84(\d{9})$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const NAME_MAX = 120;
const EMAIL_MAX = 254;

/** `+84XXXXXXXXX` từ `0…`, `84…` hoặc `+84…` (bỏ khoảng trắng, chấm, gạch, ngoặc); sai mẫu → `null`. */
export function normalizePhone(raw: string): string | null {
  const compact = raw.trim().replaceAll(PHONE_SEPARATORS, '');
  const match = NATIONAL.exec(compact) ?? COUNTRY.exec(compact);
  return match === null ? null : `+84${match[1]}`;
}

export type FieldIssue = 'REQUIRED' | 'PHONE' | 'EMAIL' | 'TOO_SHORT' | 'TOO_LONG' | 'MISMATCH';

export type Issues<K extends string> = Partial<Record<K, FieldIssue>>;

function phoneIssue(raw: string): FieldIssue | null {
  if (raw.trim() === '') return 'REQUIRED';
  return normalizePhone(raw) === null ? 'PHONE' : null;
}

function passwordIssue(value: string): FieldIssue | null {
  if (value === '') return 'REQUIRED';
  if (value.length < PASSWORD_MIN) return 'TOO_SHORT';
  return value.length > PASSWORD_MAX ? 'TOO_LONG' : null;
}

function nameIssue(value: string): FieldIssue | null {
  const name = value.trim();
  if (name === '') return 'REQUIRED';
  return name.length > NAME_MAX ? 'TOO_LONG' : null;
}

function emailIssue(value: string): FieldIssue | null {
  const email = value.trim();
  if (email === '') return null;
  return email.length > EMAIL_MAX || !EMAIL.test(email) ? 'EMAIL' : null;
}

function collect<K extends string>(
  checks: ReadonlyArray<readonly [K, FieldIssue | null]>,
): Issues<K> {
  const issues: Issues<K> = {};
  for (const [field, issue] of checks) if (issue !== null) issues[field] = issue;
  return issues;
}

export interface RegisterForm {
  readonly fullName: string;
  readonly phone: string;
  readonly email: string;
  readonly password: string;
  /** Ô đồng ý tiếp thị — mặc định tắt, không bắt buộc (NFR-COMP-01). */
  readonly consent: boolean;
}

export function registerIssues(
  form: RegisterForm,
): Issues<'fullName' | 'phone' | 'email' | 'password'> {
  return collect([
    ['fullName', nameIssue(form.fullName)],
    ['phone', phoneIssue(form.phone)],
    ['email', emailIssue(form.email)],
    ['password', passwordIssue(form.password)],
  ]);
}

/** Thân `POST /guest-auth/register` (bề mặt do BFF gán); không gửi `email` khi để trống. */
export function toRegisterRequest(form: RegisterForm): Omit<GuestRegisterRequest, 'clientSurface'> {
  const phone = normalizePhone(form.phone);
  if (phone === null || Object.keys(registerIssues(form)).length > 0)
    throw new RangeError('Invalid register form');
  const email = form.email.trim();
  return {
    phone,
    fullName: form.fullName.trim(),
    ...(email === '' ? {} : { email }),
    password: form.password,
    consentMarketing: form.consent,
    consentVersion: GUEST_CONSENT_VERSION,
  };
}

export function loginIssues(form: {
  readonly phone: string;
  readonly password: string;
}): Issues<'phone' | 'password'> {
  return collect([
    ['phone', phoneIssue(form.phone)],
    ['password', passwordIssue(form.password)],
  ]);
}

export function forgotIssues(form: { readonly phone: string }): Issues<'phone'> {
  return collect([['phone', phoneIssue(form.phone)]]);
}

export function resetIssues(form: {
  readonly token: string;
  readonly password: string;
  readonly confirm: string;
}): Issues<'token' | 'password' | 'confirm'> {
  const password = passwordIssue(form.password);
  return collect([
    ['token', form.token.trim() === '' ? 'REQUIRED' : null],
    ['password', password],
    ['confirm', password === null && form.confirm !== form.password ? 'MISMATCH' : null],
  ]);
}

export const DEFAULT_NEXT = '/profile';

/** `next` chỉ nhận đường dẫn nội bộ; không bao giờ quay lại các tuyến `/account/*` (chống vòng lặp). */
export function safeNext(raw: string | null): string {
  if (raw === null || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\'))
    return DEFAULT_NEXT;
  if (raw === '/account' || raw.startsWith('/account/') || raw.startsWith('/account?'))
    return DEFAULT_NEXT;
  return raw;
}

export type AccountFailure =
  | 'phoneRegistered'
  | 'invalidCredentials'
  | 'locked'
  | 'rateLimited'
  | 'resetTokenInvalid'
  | 'validation'
  | 'unavailable'
  | 'unknownOutcome'
  | 'other';

const BY_CODE: Readonly<Record<string, AccountFailure>> = {
  E_AUTH_PHONE_REGISTERED: 'phoneRegistered',
  E_AUTH_INVALID_CREDENTIALS: 'invalidCredentials',
  E_AUTH_ACCOUNT_LOCKED: 'locked',
  E_GEN_RATE_LIMITED: 'rateLimited',
  E_AUTH_RESET_TOKEN_INVALID: 'resetTokenInvalid',
  E_CRM_PHONE_INVALID: 'validation',
  E_GEN_VALIDATION_FAILED: 'validation',
};

/**
 * Phân loại lỗi theo `code` (rồi tới lớp HTTP), không theo `message` (design §8.1). Mất mạng/hết giờ/lỗi
 * giao thức của lệnh ghi là **chưa xác định kết quả**, không phải thất bại chắc chắn.
 */
export function failureOf(caught: unknown): AccountFailure {
  if (!isApiError(caught)) return 'unknownOutcome';
  const known = caught.code === undefined ? undefined : BY_CODE[caught.code];
  if (known !== undefined) return known;
  if (caught.kind !== 'http') return 'unknownOutcome';
  const status = caught.status ?? 0;
  if (status === 429) return 'rateLimited';
  if (status === 400 || status === 422) return 'validation';
  return status >= 500 ? 'unavailable' : 'other';
}
