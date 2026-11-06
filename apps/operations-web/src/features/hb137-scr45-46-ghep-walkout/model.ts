/**
 * Phần thuần của SCR-45/46 (HB-137). Không tính chiết khấu, tiền, quyền hay điều kiện ghép: chỉ kiểm
 * hình dạng ô nhập, phân loại lỗi theo `code`/HTTP và dựng ý định ghi có khoá và `If-Match` ổn định.
 */
import { isApiError, type ApiError } from '@pinehill/api-client';
import {
  compensationPaymentCreateRequestSchema,
  roomMergeApproveRequestSchema,
  roomMergeConsentRequestSchema,
  roomMergeRequestSchema,
  roomMoveApproveRequestSchema,
  type CompensationPaymentCreateRequest,
  type RoomMergeApproveRequest,
  type RoomMergeConsentRequest,
  type RoomMergeRequest,
  type RoomMergeView,
  type RoomMoveApproveRequest,
  type RoomMoveView,
  type UserMe,
} from '@pinehill/contracts';

export interface FieldIssue {
  field: string;
  issue: string;
}

type Role = UserMe['role'];

/**
 * Quyền hiển thị theo api.md §6.3, **liệt kê tường minh** và tách riêng: lập/ghi đồng thuận/thực thi
 * (FRONT_DESK), duyệt (MANAGER/OWNER), chi bồi thường (ACCOUNTANT) không kế thừa nhau. `allowedActions`
 * và 403 của máy chủ luôn thắng.
 */
const ROLES = {
  create: ['FRONT_DESK'],
  consent: ['FRONT_DESK'],
  execute: ['FRONT_DESK'],
  approve: ['MANAGER', 'OWNER'],
  pay: ['ACCOUNTANT'],
} as const satisfies Record<string, readonly Role[]>;

export type Power = keyof typeof ROLES;
export const can = (role: Role, power: Power): boolean =>
  ROLES[power].some((item) => item === role);

export type MergeAction = RoomMergeView['allowedActions'][number];
export type MoveAction = RoomMoveView['allowedActions'][number];

/** Nút hành động chỉ hiện khi **cả** bảng quyền lẫn `allowedActions` của máy chủ cho phép. */
export function mergeActionAllowed(role: Role, action: MergeAction, view: RoomMergeView): boolean {
  if (!view.allowedActions.includes(action)) return false;
  if (action === 'RECORD_CONSENT') return can(role, 'consent');
  if (action === 'APPROVE') return can(role, 'approve');
  return action === 'EXECUTE' ? can(role, 'execute') : false;
}

export function moveActionAllowed(role: Role, action: MoveAction, view: RoomMoveView): boolean {
  if (!view.allowedActions.includes(action)) return false;
  if (action === 'APPROVE') return can(role, 'approve');
  return action === 'EXECUTE' ? can(role, 'execute') : false;
}

/** Chi bồi thường: chỉ khi điều chuyển đã được duyệt và chưa có khoản chi nào đang/đã chạy. */
export function canPayCompensation(
  role: Role,
  move: RoomMoveView,
  payments: readonly { state: string }[],
): boolean {
  const busy = payments.some((item) => ['PENDING', 'UNKNOWN', 'SUCCEEDED'].includes(item.state));
  return can(role, 'pay') && move.approvedBy !== null && !busy;
}

export interface Params {
  mergeId: string;
  moveId: string;
}

const fileId = /^[A-Za-z0-9_-]{4,128}$/;
const isAmount = (value: string): boolean => /^\d{1,15}$/.test(value.trim());

/** Mã tệp bằng chứng riêng tư: chỉ ID, không nhận URL tuỳ ý (api.md, HB-137 hợp đồng). */
export function evidenceIssues(field: string, value: string): FieldIssue[] {
  const trimmed = value.trim();
  return trimmed === '' || fileId.test(trimmed) ? [] : [{ field, issue: 'EVIDENCE_SHAPE' }];
}

export const pinIssues = (pin: string): FieldIssue[] =>
  /^\d{6}$/.test(pin) ? [] : [{ field: 'pin', issue: 'PIN_SHAPE' }];

export interface MergeDraft {
  moveType: 'MERGE_SHARE' | 'MERGE_CONNECTING';
  primaryBookingId: string;
  secondaryBookingId: string;
  roomId: string;
  bookingId: string;
  roomIdA: string;
  roomIdB: string;
}

export const emptyMerge: MergeDraft = {
  moveType: 'MERGE_SHARE',
  primaryBookingId: '',
  secondaryBookingId: '',
  roomId: '',
  bookingId: '',
  roomIdA: '',
  roomIdB: '',
};

function required(draft: MergeDraft, fields: readonly (keyof MergeDraft)[]): FieldIssue[] {
  return fields
    .filter((key) => draft[key].trim() === '')
    .map((key) => ({ field: key, issue: 'REQUIRED' }));
}

/** Chỉ hình dạng: đủ mã và hai bên khác nhau; luật ghép, sức chứa, giới tính do máy chủ. */
export function mergeIssues(draft: MergeDraft): FieldIssue[] {
  if (draft.moveType === 'MERGE_SHARE') {
    const issues = required(draft, ['primaryBookingId', 'secondaryBookingId', 'roomId']);
    const same =
      draft.primaryBookingId.trim() !== '' &&
      draft.primaryBookingId.trim() === draft.secondaryBookingId.trim();
    return same ? [...issues, { field: 'secondaryBookingId', issue: 'DIFFERENT' }] : issues;
  }
  const issues = required(draft, ['bookingId', 'roomIdA', 'roomIdB']);
  const same = draft.roomIdA.trim() !== '' && draft.roomIdA.trim() === draft.roomIdB.trim();
  return same ? [...issues, { field: 'roomIdB', issue: 'DIFFERENT' }] : issues;
}

export function mergeRequest(draft: MergeDraft): RoomMergeRequest {
  return roomMergeRequestSchema.parse(
    draft.moveType === 'MERGE_SHARE'
      ? {
          moveType: 'MERGE_SHARE',
          primaryBookingId: draft.primaryBookingId.trim(),
          secondaryBookingId: draft.secondaryBookingId.trim(),
          roomId: draft.roomId.trim(),
        }
      : {
          moveType: 'MERGE_CONNECTING',
          bookingId: draft.bookingId.trim(),
          roomIdA: draft.roomIdA.trim(),
          roomIdB: draft.roomIdB.trim(),
        },
  );
}

export interface ConsentDraft {
  side: 'PRIMARY' | 'SECONDARY';
  consented: boolean;
  evidence: string;
}

export const consentIssues = (draft: ConsentDraft): FieldIssue[] =>
  evidenceIssues('evidence', draft.evidence);

export function consentRequest(draft: ConsentDraft): RoomMergeConsentRequest {
  const evidence = draft.evidence.trim();
  return roomMergeConsentRequestSchema.parse({
    side: draft.side,
    consented: draft.consented,
    ...(evidence === '' ? {} : { evidenceUrl: evidence }),
  });
}

export function reasonIssues(reason: string): FieldIssue[] {
  const trimmed = reason.trim();
  if (trimmed === '') return [{ field: 'reason', issue: 'REQUIRED' }];
  return trimmed.length > 500 ? [{ field: 'reason', issue: 'TOO_LONG' }] : [];
}

export const mergeApproveRequest = (reason: string): RoomMergeApproveRequest =>
  roomMergeApproveRequestSchema.parse({ reason: reason.trim() });

export interface ApproveDraft {
  compensationAmount: string;
  transportCost: string;
  note: string;
}

export function approveIssues(draft: ApproveDraft): FieldIssue[] {
  const issues: FieldIssue[] = [];
  if (!isAmount(draft.compensationAmount))
    issues.push({ field: 'compensationAmount', issue: 'AMOUNT' });
  if (!isAmount(draft.transportCost)) issues.push({ field: 'transportCost', issue: 'AMOUNT' });
  if (draft.note.trim().length > 500) issues.push({ field: 'note', issue: 'TOO_LONG' });
  return issues;
}

export function moveApproveRequest(draft: ApproveDraft): RoomMoveApproveRequest {
  const note = draft.note.trim();
  return roomMoveApproveRequestSchema.parse({
    compensationAmount: Number(draft.compensationAmount.trim()),
    transportCost: Number(draft.transportCost.trim()),
    ...(note === '' ? {} : { note }),
  });
}

export interface PayDraft {
  method: 'CASH' | 'BANK_TRANSFER';
  bankReference: string;
  note: string;
  evidence: string;
}

/** Không có ô số tiền: số tiền lấy từ điều chuyển đã duyệt (F6-D06). */
export function payIssues(draft: PayDraft): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const refs = splitRefs(draft.evidence);
  if (draft.method === 'BANK_TRANSFER' && draft.bankReference.trim() === '')
    issues.push({ field: 'bankReference', issue: 'REQUIRED' });
  if (refs.some((ref) => !fileId.test(ref)))
    issues.push({ field: 'evidence', issue: 'EVIDENCE_SHAPE' });
  if (refs.length === 0 && draft.bankReference.trim() === '' && draft.note.trim() === '')
    issues.push({ field: 'note', issue: 'REQUIRED' });
  return issues;
}

const splitRefs = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');

export function payRequest(draft: PayDraft): CompensationPaymentCreateRequest {
  const refs = splitRefs(draft.evidence);
  const bank = draft.bankReference.trim();
  const note = draft.note.trim();
  return compensationPaymentCreateRequestSchema.parse({
    method: draft.method,
    ...(refs.length === 0 ? {} : { evidenceRefs: refs }),
    ...(bank === '' ? {} : { bankReference: bank }),
    ...(note === '' ? {} : { note }),
  });
}

export const tagOf = (version: number): string => `"${version}"`;

/** Ý định ghi: giữ nguyên `key`, thân và `If-Match` cho mọi lần gửi lại (api.md §1.6). */
export type IntentKind =
  | 'mergeCreate'
  | 'mergeConsent'
  | 'mergeApprove'
  | 'mergeExecute'
  | 'moveApprove'
  | 'moveExecute'
  | 'compensate';

export interface Intent {
  kind: IntentKind;
  /** ID đối tượng đích (merge/move); rỗng khi tạo mới. */
  target: string;
  body: unknown;
  ifMatch: string | undefined;
  key: string;
  createdAt: number;
}

export const sameIntent = (a: Intent, b: Intent): boolean =>
  JSON.stringify([a.kind, a.target, a.body, a.ifMatch]) ===
  JSON.stringify([b.kind, b.target, b.body, b.ifMatch]);

/** Khoá idempotency chỉ sống 24 giờ: quá hạn thì tra kết quả, không gửi lại mù. */
export const KEY_TTL_MS = 24 * 60 * 60 * 1000;
export const keyExpired = (intent: Intent, now: number): boolean =>
  now - intent.createdAt >= KEY_TTL_MS;

export type Failure =
  | { kind: 'validation'; issues: FieldIssue[] }
  | { kind: 'conflict' }
  | { kind: 'roomTaken' }
  | { kind: 'noConsent' }
  | { kind: 'mergeGender' }
  | { kind: 'approvalRequired' }
  | { kind: 'moveNotAllowed' }
  | { kind: 'pinRequired' }
  | { kind: 'pinLocked' }
  | { kind: 'inProgress'; retryAfterSeconds: number }
  | { kind: 'keyReused' }
  | { kind: 'forbidden' }
  | { kind: 'expired' }
  | { kind: 'rejected' }
  | { kind: 'unknown' }
  | { kind: 'ttl' }
  | { kind: 'aborted' };

const DEFAULT_RETRY_SECONDS = 5;
const UNKNOWN: Failure = { kind: 'unknown' };

/**
 * Mã nghiệp vụ được xét **trước** mã HTTP: các mã 401/403 của lệnh (`E_AUTH_PIN_REQUIRED`,
 * `E_OVER_APPROVAL_REQUIRED`) là từ chối của lệnh, không phải mất phiên nên không được xoá dữ liệu.
 */
const BY_CODE = new Map<string, Failure>([
  ['E_INV_ROOM_TAKEN', { kind: 'roomTaken' }],
  ['E_OVER_NO_CONSENT', { kind: 'noConsent' }],
  ['E_OVER_MERGE_GENDER', { kind: 'mergeGender' }],
  ['E_OVER_APPROVAL_REQUIRED', { kind: 'approvalRequired' }],
  ['E_OVER_MOVE_NOT_ALLOWED', { kind: 'moveNotAllowed' }],
  ['E_AUTH_PIN_REQUIRED', { kind: 'pinRequired' }],
  ['E_AUTH_PIN_LOCKED', { kind: 'pinLocked' }],
  ['E_SYS_IDEMPOTENCY_KEY_REUSED', { kind: 'keyReused' }],
]);
const AUTH = new Map<number, Failure>([
  [401, { kind: 'expired' }],
  [403, { kind: 'forbidden' }],
]);
const PRECONDITION = new Map<number, Failure>([
  [412, { kind: 'conflict' }],
  [428, { kind: 'conflict' }],
]);

function inProgress(error: ApiError): Failure | undefined {
  if (error.code !== 'E_SYS_REQUEST_IN_PROGRESS' && error.status !== 429) return undefined;
  return {
    kind: 'inProgress',
    retryAfterSeconds: error.retryAfterSeconds ?? DEFAULT_RETRY_SECONDS,
  };
}

function invalid(error: ApiError): Failure | undefined {
  if (error.status !== 400 && error.status !== 422) return undefined;
  const issues = error.details ?? [];
  return {
    kind: 'validation',
    issues: issues.length > 0 ? issues : [{ field: 'form', issue: error.code ?? 'REJECTED' }],
  };
}

function httpFailure(error: ApiError): Failure {
  const status = error.status ?? 0;
  const known =
    BY_CODE.get(error.code ?? '') ??
    AUTH.get(status) ??
    PRECONDITION.get(status) ??
    inProgress(error) ??
    invalid(error);
  if (known !== undefined) return known;
  return status >= 400 && status < 500 ? { kind: 'rejected' } : UNKNOWN;
}

/**
 * Phân loại lỗi **chỉ theo `code` và lớp HTTP**. Mạng, timeout, 5xx và phản hồi sai hợp đồng là
 * `unknown`: không bao giờ báo "thất bại chắc chắn" rồi cho tạo lệnh mới.
 */
export function classify(error: unknown): Failure {
  if (!isApiError(error)) return UNKNOWN;
  if (error.kind === 'aborted') return { kind: 'aborted' };
  return error.kind === 'http' ? httpFailure(error) : UNKNOWN;
}

/** Lỗi chắc chắn không có tác dụng phụ: nhả ý định, cho tạo ý định mới (khoá mới). */
export const SETTLED: readonly Failure['kind'][] = [
  'validation',
  'conflict',
  'roomTaken',
  'noConsent',
  'mergeGender',
  'approvalRequired',
  'moveNotAllowed',
  'pinRequired',
  'pinLocked',
  'keyReused',
  'rejected',
];

/** Bằng chứng an toàn: mã lỗi, HTTP và traceId. Không có thân lệnh, tiêu đề, PIN, token hay `message`. */
export interface Evidence {
  code?: string;
  status?: number;
  traceId?: string;
}

export function evidenceOf(error: unknown): Evidence {
  if (!isApiError(error)) return {};
  return {
    ...(error.code === undefined ? {} : { code: error.code }),
    ...(error.status === undefined ? {} : { status: error.status }),
    ...(error.traceId === undefined ? {} : { traceId: error.traceId }),
  };
}
