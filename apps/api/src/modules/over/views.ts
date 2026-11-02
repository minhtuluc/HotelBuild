/**
 * Hình chiếu phản hồi OVER (HB-120 AC6/AC12/AC13). Chỉ đổi kiểu bigint → number an toàn và gắn
 * `allowedActions`/`writeIntent` mà hợp đồng yêu cầu; không chứa trường máy chủ tự khai từ client.
 */
import { z } from 'zod';
import { money, toBigInt } from './support.js';

export interface MoveRow {
  id: string;
  booking_id: string;
  booking_room_id: string;
  move_type: string;
  from_room_id: string | null;
  to_room_id: string | null;
  from_property_id: string | null;
  to_property_id: string | null;
  reason: string;
  keep_score: number;
  price_locked: boolean;
  compensation_amount: bigint;
  transport_cost: bigint;
  walk_out_doc_no: string | null;
  guest_signature_ref: string | null;
  staff_signature_ref: string | null;
  approved_by: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
  version: bigint;
}

export interface MergeRow {
  id: string;
  primary_booking_id: string;
  secondary_booking_id: string | null;
  room_id: string;
  secondary_room_id: string | null;
  move_type: string;
  consent_primary: boolean;
  consent_secondary: boolean;
  discount_pct: unknown;
  discount_amount: bigint;
  approved_by: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
  version: bigint;
}

export interface CompensationPaymentRow {
  id: string;
  booking_id: string;
  type: string;
  method: string;
  amount: bigint;
  status: string;
  room_move_id: string | null;
  note: string | null;
  created_by: string | null;
  paid_at: Date | null;
  created_at: Date;
}

export interface MoveViewOptions {
  readonly bookingVersion: bigint | number;
  readonly assignmentIds: readonly string[];
  readonly allowedActions: readonly string[];
  readonly writeIntent: unknown;
}

export function walkOutOf(row: MoveRow) {
  if (row.walk_out_doc_no === null) return null;
  return {
    walkOutDocNo: row.walk_out_doc_no,
    guestSignatureRef: row.guest_signature_ref ?? '',
    staffSignatureRef: row.staff_signature_ref ?? '',
    refundRequestId: null,
    compensationPaymentId: null,
  };
}

export function moveView(row: MoveRow, options: MoveViewOptions) {
  return {
    id: row.id,
    overbookingCaseId: null,
    bookingId: row.booking_id,
    bookingRoomId: row.booking_room_id,
    moveType: row.move_type,
    fromRoomId: row.from_room_id,
    toRoomId: row.to_room_id,
    fromPropertyId: row.from_property_id,
    toPropertyId: row.to_property_id,
    reason: row.reason,
    keepScore: row.keep_score,
    priceLocked: true as const,
    compensationAmount: money(row.compensation_amount),
    transportCost: money(row.transport_cost),
    consent: null,
    approvedBy: row.approved_by,
    approvedAt: row.approved_by === null ? null : row.updated_at.toISOString(),
    status: row.status,
    assignmentIds: [...options.assignmentIds],
    walkOut: walkOutOf(row),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    version: money(toBigInt(row.version)),
    bookingVersion: money(toBigInt(options.bookingVersion)),
    allowedActions: [...options.allowedActions],
    operationId: row.id,
    writeIntent: options.writeIntent,
  };
}

export interface MergeViewOptions {
  readonly consents: readonly {
    side: 'PRIMARY' | 'SECONDARY';
    consented: boolean;
    evidenceUrl: string | null;
    recordedBy: string;
    recordedAt: string;
  }[];
  readonly genderSame: boolean | null;
  readonly allowedActions: readonly string[];
  readonly writeIntent: unknown;
  readonly operationId: string;
}

export function mergeView(row: MergeRow, options: MergeViewOptions) {
  return {
    id: row.id,
    moveType: row.move_type,
    primaryBookingId: row.primary_booking_id,
    secondaryBookingId: row.secondary_booking_id,
    roomId: row.room_id,
    roomIdA: row.move_type === 'MERGE_CONNECTING' ? row.room_id : null,
    roomIdB: row.secondary_room_id,
    secondaryRoomId: row.secondary_room_id,
    consentPrimary: row.consent_primary,
    consentSecondary: row.consent_secondary,
    consents: [...options.consents],
    genderSame: options.genderSame,
    approvedBy: row.approved_by,
    approvedAt: row.approved_by === null ? null : row.updated_at.toISOString(),
    discountPct: Number(row.discount_pct),
    discountAmount: money(row.discount_amount),
    priceLocked: true as const,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    version: money(toBigInt(row.version)),
    allowedActions: [...options.allowedActions],
    operationId: options.operationId,
    writeIntent: options.writeIntent,
  };
}

interface StoredCompensationNote {
  bankReference: string | null;
  evidenceRefs: string[];
  note: string | null;
}

const storedNoteSchema = z.looseObject({
  bankReference: z.string().nullable().optional(),
  evidenceRefs: z.array(z.string()).optional(),
  note: z.string().nullable().optional(),
});

function storedNote(value: string | null): StoredCompensationNote {
  const fallback = { bankReference: null, evidenceRefs: [], note: value };
  if (value === null) return { bankReference: null, evidenceRefs: [], note: null };
  try {
    const parsed = storedNoteSchema.safeParse(JSON.parse(value));
    if (!parsed.success) return fallback;
    return {
      bankReference: parsed.data.bankReference ?? null,
      evidenceRefs: parsed.data.evidenceRefs ?? [],
      note: parsed.data.note ?? null,
    };
  } catch {
    return fallback;
  }
}

const stateOf = (status: string): 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN' =>
  status === 'SUCCEEDED'
    ? 'SUCCEEDED'
    : status === 'PENDING'
      ? 'PENDING'
      : status === 'FAILED' || status === 'REVERSED'
        ? 'FAILED'
        : 'UNKNOWN';

export function compensationPaymentView(row: CompensationPaymentRow, approvedBy: string | null) {
  const stored = storedNote(row.note);
  return {
    id: row.id,
    paymentId: row.id,
    roomMoveId: row.room_move_id ?? '',
    bookingId: row.booking_id,
    amount: money(row.amount),
    currency: 'VND' as const,
    type: 'COMPENSATION' as const,
    method: row.method,
    state: stateOf(row.status),
    /** `status` là trạng thái Payment (HB-124 đọc tên này); `paymentStatus` là tên hợp đồng. */
    status: stateOf(row.status),
    paymentStatus: row.status,
    operationId: row.id,
    approvalRef: {
      approvedBy: approvedBy ?? row.created_by ?? '',
      approvedAt: row.created_at.toISOString(),
    },
    bankReference: stored.bankReference,
    evidenceRefs: stored.evidenceRefs,
    createdBy: row.created_by ?? '',
    createdAt: row.created_at.toISOString(),
    paidAt: row.paid_at === null ? null : row.paid_at.toISOString(),
  };
}

export function compensationPaymentsView(
  roomMoveId: string,
  approvedAmount: bigint,
  rows: readonly CompensationPaymentRow[],
  approvedBy: string | null,
) {
  return {
    roomMoveId,
    approvedAmount: money(approvedAmount),
    payments: rows.map((row) => compensationPaymentView(row, approvedBy)),
  };
}
