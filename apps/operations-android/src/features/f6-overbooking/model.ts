/**
 * SCR-63/67 (HB-139) — phần thuần, kiểm bằng vitest. Ranh giới (ADR-018): không tính lại hạn, điểm, giá,
 * quota hay trạng thái ca; chỉ ánh xạ dữ liệu máy chủ sang dòng hiển thị, phân loại lỗi theo `code`/HTTP
 * và dựng ý định ghi có khoá ổn định.
 */
import { isApiError, type ApiError } from '@pinehill/api-client';
import type {
  BookingRelocationOptions,
  OverbookingAlert,
  OverbookingCaseSummary,
  RoomMoveCreateRequest,
  RoomMoveView,
  UserMe,
} from '@pinehill/contracts';
import { roomMoveCreateRequestSchema } from '@pinehill/contracts';

type Role = UserMe['role'];

/**
 * Bảng quyền tường minh (api.md §6.3): đọc ca đầy đủ, lập/thực hiện và duyệt là **ba quyền độc lập**,
 * không kế thừa theo vai. Chỉ quyết định điều gì được hiện; `allowedActions` và 403 của máy chủ thắng.
 */
const READ_CASES: readonly Role[] = ['MANAGER', 'OWNER'];
const CREATE: readonly Role[] = ['FRONT_DESK'];
const EXECUTE: readonly Role[] = ['FRONT_DESK'];
const APPROVE: readonly Role[] = ['MANAGER', 'OWNER'];
export const canReadCases = (role: Role): boolean => READ_CASES.includes(role);
export const canCreate = (role: Role): boolean => CREATE.includes(role);
export const canExecute = (role: Role): boolean => EXECUTE.includes(role);
export const canApprove = (role: Role): boolean => APPROVE.includes(role);

type Action = RoomMoveView['allowedActions'][number];

/** Nút chỉ hiện khi **cả** bảng quyền lẫn `allowedActions` của máy chủ cho phép. */
export function actionAllowed(role: Role, action: Action, move: RoomMoveView): boolean {
  if (!move.allowedActions.includes(action)) return false;
  if (action === 'APPROVE') return canApprove(role);
  return action === 'EXECUTE' ? canExecute(role) : false;
}

/** Trên Android chỉ bậc 1–2 (cùng cơ sở); các bậc còn lại xử lý trên web (SCR-44). */
const ANDROID_STEPS: readonly string[] = ['SAME_TYPE_SAME_PROPERTY', 'UPGRADE_SAME_PROPERTY'];
export const androidStep = (moveType: string): boolean => ANDROID_STEPS.includes(moveType);

/** Một dòng cảnh báo cho cả hai nguồn (quản lý: ca đầy đủ; lễ tân: cảnh báo tối thiểu theo booking). */
export interface AlertRow {
  readonly caseId: string;
  readonly date: string;
  /** `null` ở projection lễ tân (HB-221): máy chủ chỉ trả `label` dựng sẵn, không trả số thiếu/hạn. */
  readonly shortage: number | null;
  readonly status: OverbookingCaseSummary['status'];
  readonly overdue: boolean;
  readonly deadline: string | null;
  readonly label: string | null;
  readonly typeLabel: string | null;
  readonly escalatedAt: string | null;
  readonly delayReason: string | null;
  /** Booking trong scope của lễ tân để mở SCR-63 (rỗng với quản lý). */
  readonly bookings: readonly { bookingId: string; bookingRoomId: string | null; guest: string }[];
}

export function rowOfCase(item: OverbookingCaseSummary): AlertRow {
  return {
    caseId: item.id,
    date: item.date,
    shortage: item.shortageCount,
    status: item.status,
    overdue: item.overdue,
    deadline: item.resolveDeadline,
    label: null,
    typeLabel: item.roomTypeCode ?? null,
    escalatedAt: item.escalatedAt,
    delayReason: item.delayReason,
    bookings: [],
  };
}

/**
 * Projection lễ tân trả **một dòng mỗi booking** (HB-126/HB-221); gom về một thẻ mỗi ca, giữ đúng thứ tự
 * máy chủ. Không có tên khách (tối thiểu PII) nên nút mở dùng số thứ tự trong ca.
 */
export function rowsOfAlerts(items: readonly OverbookingAlert[]): AlertRow[] {
  const rows = new Map<string, AlertRow>();
  for (const item of items) {
    const current = rows.get(item.caseId);
    const booking = { bookingId: item.bookingId, bookingRoomId: null, guest: '' };
    rows.set(
      item.caseId,
      current === undefined
        ? {
            caseId: item.caseId,
            date: item.date,
            shortage: null,
            status: item.status,
            overdue: item.overdue,
            deadline: null,
            label: item.label,
            typeLabel: null,
            escalatedAt: null,
            delayReason: null,
            bookings: [booking],
          }
        : { ...current, bookings: [...current.bookings, booking] },
    );
  }
  return [...rows.values()];
}

/** "Không có ca" chỉ đáng tin khi lượt quét gần nhất thành công và có mốc (AC1). */
export const emptyConfirmed = (scan: { status: string; lastSuccessAt: string | null }): boolean =>
  scan.status === 'SUCCEEDED' && scan.lastSuccessAt !== null;

type Option = BookingRelocationOptions['options'][number];

export interface MoveDraft {
  readonly reason: string;
  readonly granted: boolean;
}

export interface MoveContext {
  readonly caseId: string;
  readonly bookingId: string;
  readonly bookingRoomId: string;
}

export type DraftIssue = 'reason' | 'consent' | 'step';

/** Chỉ hình dạng: lý do bắt buộc, khách đã đồng ý, phương án thuộc bậc 1–2; luật còn lại do máy chủ. */
export function draftIssues(draft: MoveDraft, option: Option | undefined): DraftIssue[] {
  const issues: DraftIssue[] = [];
  if (option === undefined || !option.feasible || !androidStep(option.moveType))
    issues.push('step');
  if (draft.reason.trim() === '' || draft.reason.trim().length > 500) issues.push('reason');
  if (!draft.granted) issues.push('consent');
  return issues;
}

/** Số tiền lấy **nguyên** từ phương án máy chủ trả; màn hình không khai lại hay tính chi phí. */
export function createBody(
  ctx: MoveContext,
  option: Option,
  draft: MoveDraft,
): RoomMoveCreateRequest {
  return roomMoveCreateRequestSchema.parse({
    overbookingCaseId: ctx.caseId,
    bookingId: ctx.bookingId,
    bookingRoomId: ctx.bookingRoomId,
    moveType: option.moveType,
    ...(option.targetRoomId === null ? {} : { toRoomId: option.targetRoomId }),
    ...(option.targetPropertyId === null ? {} : { toPropertyId: option.targetPropertyId }),
    reason: draft.reason.trim(),
    compensationAmount: option.compensationAmount,
    transportCost: option.transportCost,
    consent: { granted: true, channel: 'IN_PERSON' },
  });
}

export const pinShapeOk = (pin: string): boolean => /^\d{6}$/.test(pin);

/** `If-Match` từ ETag/version đã đọc (api.md §1.3: `"<version>"`); không tự đoán phiên bản mới. */
export const tagOf = (version: number): string => `"${version}"`;

export type Failure =
  | { readonly kind: 'conflict' }
  | { readonly kind: 'roomTaken' }
  | { readonly kind: 'noConsent' }
  | { readonly kind: 'approvalRequired' }
  | { readonly kind: 'moveNotAllowed' }
  | { readonly kind: 'pinRequired' }
  | { readonly kind: 'pinLocked'; readonly retryAfterSeconds: number | null }
  | { readonly kind: 'inProgress'; readonly retryAfterSeconds: number }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'rejected'; readonly code: string }
  | { readonly kind: 'unknownOutcome'; readonly reference: string };

/** Mã nghiệp vụ xét **trước** mã HTTP: 401/403 của riêng lệnh không phải mất phiên. */
const BY_CODE: Readonly<Record<string, Failure>> = {
  E_INV_ROOM_TAKEN: { kind: 'roomTaken' },
  E_OVER_NO_CONSENT: { kind: 'noConsent' },
  E_OVER_APPROVAL_REQUIRED: { kind: 'approvalRequired' },
  E_OVER_MOVE_NOT_ALLOWED: { kind: 'moveNotAllowed' },
  E_AUTH_PIN_REQUIRED: { kind: 'pinRequired' },
};

function unclear(caught: ApiError): boolean {
  return (
    ['network', 'timeout', 'protocol', 'aborted'].includes(caught.kind) ||
    (caught.status ?? 0) >= 500
  );
}

function pinLocked(caught: ApiError): Failure | undefined {
  return caught.code === 'E_AUTH_PIN_LOCKED'
    ? { kind: 'pinLocked', retryAfterSeconds: caught.retryAfterSeconds ?? null }
    : undefined;
}

function byStatus(caught: ApiError): Failure | undefined {
  const status = caught.status ?? 0;
  if (status === 401 || status === 403) return { kind: 'forbidden' };
  if (caught.code === 'E_SYS_REQUEST_IN_PROGRESS' || status === 429)
    return { kind: 'inProgress', retryAfterSeconds: caught.retryAfterSeconds ?? 5 };
  return [409, 412, 428].includes(status) ? { kind: 'conflict' } : undefined;
}

function httpFailure(caught: ApiError): Failure {
  return (
    BY_CODE[caught.code ?? ''] ??
    pinLocked(caught) ??
    byStatus(caught) ?? {
      kind: 'rejected',
      code: caught.code ?? String(caught.status ?? 'UNKNOWN'),
    }
  );
}

/**
 * Phân loại lỗi lệnh ghi (design §8.1): mất mạng/hết giờ/5xx/phản hồi lệch là **chưa xác định kết quả** —
 * không hứa thất bại, thử lại bằng cùng khoá; 4xx nghiệp vụ là từ chối chắc chắn.
 */
export function moveFailure(caught: unknown): Failure {
  if (!isApiError(caught)) return { kind: 'unknownOutcome', reference: '—' };
  if (unclear(caught))
    return { kind: 'unknownOutcome', reference: caught.traceId ?? caught.correlationId ?? '—' };
  return httpFailure(caught);
}

/** Lỗi chắc chắn không có tác dụng phụ: nhả khoá/ý định. */
export const settled = (failure: Failure): boolean =>
  failure.kind !== 'unknownOutcome' && failure.kind !== 'inProgress';

/** Khoá idempotency chỉ sống 24 giờ: quá hạn thì tra chứng từ, không gửi lại mù. */
export const KEY_TTL_MS = 24 * 60 * 60 * 1000;
