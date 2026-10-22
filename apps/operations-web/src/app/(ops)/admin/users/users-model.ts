/**
 * SCR-15 (HB-021) — phần thuần của màn quản lý người dùng, kiểm bằng vitest.
 *
 * Ranh giới (ADR-018): luật gán vai trò, tự nâng quyền, OWNER cuối cùng, thu hồi phiên… do máy chủ
 * (HB-016) cưỡng chế. Ở đây chỉ **ẩn** lựa chọn mà người đang đăng nhập không được gán (QĐ-03 quyết định 7)
 * và kiểm biểu mẫu; mọi từ chối của máy chủ vẫn hiển thị nguyên mã + lý do.
 */
import { isApiError, type ApiError } from '@pinehill/api-client';
import {
  userRoleSchema,
  type CreateUserRequest,
  type UserAccessUpdateRequest,
  type UserRole,
  type UserSummary,
  type UsersQuery,
} from '@pinehill/contracts';

export const ROLES: readonly UserRole[] = userRoleSchema.options;
export const PAGE_SIZE = 20;

/** Vai trò mà `actor` được chọn khi gán (QĐ-03 quyết định 7). Chỉ để ẩn tuỳ chọn; máy chủ vẫn kiểm. */
export function assignableRoles(actor: UserRole): readonly UserRole[] {
  if (actor === 'OWNER') return ROLES;
  if (actor === 'SYSADMIN') return ROLES.filter((role) => role !== 'OWNER' && role !== 'SYSADMIN');
  return [];
}

export const canManageUsers = (actor: UserRole): boolean =>
  actor === 'OWNER' || actor === 'SYSADMIN';

/** Quên PIN: MANAGER hoặc SYSADMIN xoá (QĐ-03 quyết định 5); OWNER toàn chuỗi (api.md §6.3). */
export const canClearPin = (actor: UserRole): boolean =>
  actor === 'OWNER' || actor === 'SYSADMIN' || actor === 'MANAGER';

// Bỏ ký tự dễ nhầm khi đọc/gõ bàn giao: 0 O I l 1.
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGIT = '23456789';
const POOL = UPPER + LOWER + DIGIT;
export const TEMP_PASSWORD_LENGTH = 16;

export type RandomBytes = (size: number) => Uint8Array;

/** Số nguyên đều trong `[0, n)` từ nguồn byte, bỏ byte rơi vào vùng lệch (rejection sampling). */
function sampler(random: RandomBytes): (n: number) => number {
  let buffer: Uint8Array = new Uint8Array(0);
  let at = 0;
  const next = (): number => {
    if (at >= buffer.length) {
      buffer = random(64);
      at = 0;
    }
    return buffer[at++]!;
  };
  return (n) => {
    const limit = 256 - (256 % n);
    for (;;) {
      const value = next();
      if (value < limit) return value % n;
    }
  };
}

/**
 * Mật khẩu tạm 16 ký tự, đủ chữ hoa/thường/số, sinh từ `crypto.getRandomValues` (truyền vào để test).
 * Không dùng `Math.random`; hiện **một lần** cho người bàn giao rồi bỏ (QĐ-03 quyết định 8).
 */
export function generateTemporaryPassword(random: RandomBytes): string {
  const pick = sampler(random);
  const chars = [UPPER, LOWER, DIGIT].map((set) => set[pick(set.length)]!);
  while (chars.length < TEMP_PASSWORD_LENGTH) chars.push(POOL[pick(POOL.length)]!);
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = pick(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}

export interface CreateDraft {
  username: string;
  fullName: string;
  phone: string;
  role: UserRole;
  propertyScope: string[];
}

export interface FieldIssue {
  field: 'username' | 'fullName' | 'phone' | 'propertyScope';
  issue: 'SHORT' | 'LONG' | 'REQUIRED' | 'FORMAT';
}

const PHONE = /^(?:\+84|0)\d{9}$/;

/** Kiểm biểu mẫu tạo; không thay cho kiểm tra của máy chủ (trùng tên đăng nhập, luật gán…). */
export function createIssues(draft: CreateDraft): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const username = draft.username.trim();
  if (username.length < 3) issues.push({ field: 'username', issue: 'SHORT' });
  else if (username.length > 64) issues.push({ field: 'username', issue: 'LONG' });
  const name = draft.fullName.trim();
  if (name === '') issues.push({ field: 'fullName', issue: 'REQUIRED' });
  else if (name.length > 120) issues.push({ field: 'fullName', issue: 'LONG' });
  const phone = draft.phone.trim();
  if (phone !== '' && !PHONE.test(phone)) issues.push({ field: 'phone', issue: 'FORMAT' });
  if (draft.role !== 'OWNER' && draft.propertyScope.length === 0)
    issues.push({ field: 'propertyScope', issue: 'REQUIRED' });
  return issues;
}

/** Hợp đồng `POST /users` nhận SĐT dạng `+84XXXXXXXXX`; nhập `0XXXXXXXXX` thì đổi đầu số, không đổi chữ số. */
export function canonicalPhone(raw: string): string {
  const phone = raw.trim();
  return phone.startsWith('0') ? `+84${phone.slice(1)}` : phone;
}

export function toCreateRequest(draft: CreateDraft, temporaryPassword: string): CreateUserRequest {
  const phone = canonicalPhone(draft.phone);
  return {
    username: draft.username.trim(),
    fullName: draft.fullName.trim(),
    ...(phone === '' ? {} : { phone }),
    role: draft.role,
    propertyScope: [...draft.propertyScope],
    temporaryPassword,
  };
}

export type AccessDraft = UserAccessUpdateRequest;

export function accessDraft(user: UserSummary): AccessDraft {
  return { role: user.role, propertyScope: [...user.propertyScope], isActive: user.isActive };
}

export function toAccessRequest(draft: AccessDraft): UserAccessUpdateRequest {
  return { role: draft.role, propertyScope: [...draft.propertyScope], isActive: draft.isActive };
}

const sameSet = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && [...left].sort().join('\n') === [...right].sort().join('\n');

export function accessChanged(user: UserSummary, draft: AccessDraft): boolean {
  return (
    draft.role !== user.role ||
    draft.isActive !== user.isActive ||
    !sameSet(draft.propertyScope, user.propertyScope)
  );
}

/** ETag/If-Match mạnh dạng `"<version>"` (api.md §1.3). */
export const ifMatchOf = (version: number): string => `"${version}"`;

/** Tách danh sách mã cơ sở nhập tay khi máy chủ chưa cho đọc danh sách cơ sở. */
export function parseScopeInput(raw: string): string[] {
  return [...new Set(raw.split(/[\s,]+/).filter((part) => part !== ''))];
}

export interface UserFilters {
  role: UserRole | '';
  propertyId: string;
  q: string;
}

export function usersQuery(filters: UserFilters, cursor: string | undefined): UsersQuery {
  const q = filters.q.trim();
  return {
    limit: PAGE_SIZE,
    ...(filters.role === '' ? {} : { role: filters.role }),
    ...(filters.propertyId === '' ? {} : { propertyId: filters.propertyId }),
    ...(q === '' ? {} : { q }),
    ...(cursor === undefined ? {} : { cursor }),
  };
}

/** `lockedUntil` ở tương lai = đang khoá. Chỉ hiển thị; việc mở khoá do máy chủ quyết. */
export function isLocked(user: Pick<UserSummary, 'lockedUntil'>, nowMs: number): boolean {
  return user.lockedUntil !== null && Date.parse(user.lockedUntil) > nowMs;
}

export type WriteFailure =
  | {
      readonly kind: 'rejected';
      readonly code: string;
      readonly status: number | null;
      readonly reason: string;
    }
  | { readonly kind: 'validation'; readonly details: readonly { field: string; issue: string }[] }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'expired' }
  | { readonly kind: 'unknownOutcome'; readonly reference: string };

const CONFLICT_CODES: readonly string[] = [
  'E_GEN_VERSION_CONFLICT',
  'E_GEN_PRECONDITION_REQUIRED',
  'E_SYS_IDEMPOTENCY_KEY_REUSED',
];

function isConflict(error: ApiError): boolean {
  return (
    error.status === 412 ||
    error.status === 428 ||
    (error.code !== undefined && CONFLICT_CODES.includes(error.code))
  );
}

/** Mạng/hết giờ/sai giao thức/5xx: lệnh có thể đã được máy chủ nhận. */
function isUnclear(error: ApiError): boolean {
  return error.kind !== 'http' || (error.status ?? 0) >= 500;
}

const reference = (error: ApiError): string => error.traceId ?? error.correlationId ?? '—';

const rejected = (error: ApiError): WriteFailure => ({
  kind: 'rejected',
  code: error.code ?? String(error.status ?? 'UNKNOWN'),
  status: error.status ?? null,
  reason: error.message,
});

const fieldErrors = (error: ApiError): boolean =>
  (error.status === 400 || error.status === 422) && (error.details?.length ?? 0) > 0;

/**
 * Phân loại lỗi của lệnh ghi (design §8.1): 403/409 hiện nguyên mã + lý do máy chủ; 412/428 → xung đột
 * phiên bản (tải lại bản mới); 400/422 kèm `details` → lỗi theo trường; mạng/hết giờ/5xx → **chưa xác
 * định kết quả** (không hứa thất bại, không cho gửi lại mù).
 */
export function writeFailure(caught: unknown): WriteFailure {
  if (!isApiError(caught)) return { kind: 'unknownOutcome', reference: '—' };
  if (caught.status === 401) return { kind: 'expired' };
  if (isConflict(caught)) return { kind: 'conflict' };
  if (isUnclear(caught)) return { kind: 'unknownOutcome', reference: reference(caught) };
  if (fieldErrors(caught)) return { kind: 'validation', details: caught.details ?? [] };
  return rejected(caught);
}
