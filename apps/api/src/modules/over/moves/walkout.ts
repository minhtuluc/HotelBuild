/**
 * Walk-out (HB-125 AC12): hoàn 100% theo F6-D02, tách compensation khỏi refund, huỷ toàn booking
 * và giữ chỗ hoàn trong **cùng** transaction của caller.
 */
import { randomUUID } from 'node:crypto';
import type { Clock } from '@pinehill/domain';
import { evaluateWalkOut, type WalkOutDecision } from '@pinehill/domain/overbooking';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import type { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import type { BookingLedger } from '../../pay/ledger/service.js';
import { businessConflict, money } from '../support.js';
import type { Tx } from '../support.js';
import type { MoveRow } from '../views.js';
import { approverOf, firstNight } from './queries.js';
import {
  closeBookingForWalkOut,
  insertWalkOutRefund,
  reservationLegs,
  refundFeeOf,
  releaseAssignmentsOf,
  setMoveStatus,
  voidRoomCharges,
  writeOverOutbox,
  type BookingRow,
} from './writes.js';

export interface WalkOutContext {
  readonly ledger: BookingLedger;
  readonly clock: Clock;
  readonly audit: AuditWriter;
}

interface WalkOutDocuments {
  readonly walkOutDocNo: string;
  readonly guestSignatureRef: string;
  readonly staffSignatureRef: string;
}

interface WalkOutPlan {
  readonly decision: WalkOutDecision;
  readonly paymentId: string | null;
}

/** Biên bản và chữ ký khách/nhân viên là điều kiện bắt buộc của walk-out (BR-CANCEL-14). */
function documentsOf(row: MoveRow): WalkOutDocuments {
  if (
    row.walk_out_doc_no === null ||
    row.guest_signature_ref === null ||
    row.staff_signature_ref === null
  )
    throw businessConflict(
      'E_OVER_MOVE_NOT_ALLOWED',
      'Walk-out phải có biên bản và chữ ký khách/nhân viên (BR-CANCEL-14).',
    );
  return {
    walkOutDocNo: row.walk_out_doc_no,
    guestSignatureRef: row.guest_signature_ref,
    staffSignatureRef: row.staff_signature_ref,
  };
}

/** Dựng quyết định walk-out từ sổ cái + chứng từ; thiếu chứng từ/cấu hình ⇒ 409 hợp đồng. */
async function decideWalkOut(
  tx: Tx,
  row: MoveRow,
  booking: BookingRow,
  documents: WalkOutDocuments,
  ctx: WalkOutContext,
): Promise<WalkOutPlan> {
  const projection = await ctx.ledger.read(tx, booking.id);
  const fee = await refundFeeOf(tx);
  const firstNightAmount = await firstNight(tx, booking.id);
  const approver = await approverOf(tx, row.approved_by);
  const decision = evaluateWalkOut({
    bookingId: booking.id,
    reason: 'NO_ALTERNATIVE_STEP_4',
    paidAmountVnd: money(projection.paidAmount),
    alreadyRefundedVnd: money(projection.refundedAmount),
    activeReservedRefundVnd: money(projection.refundReserved),
    firstNightOriginalSnapshotVnd: firstNightAmount > 0 ? firstNightAmount : 1,
    refundFeeVnd: money(fee),
    documents: {
      walkOutDocNo: documents.walkOutDocNo,
      guestSignatureRef: documents.guestSignatureRef,
      staffSignatureRef: documents.staffSignatureRef,
    },
    ...(row.approved_by === null
      ? {}
      : {
          approval: {
            requestedByActorId: `move:${row.id}`,
            approvedByActorId: row.approved_by,
            approvedByRole: approver ?? 'MANAGER',
            approvalReason: 'Duyệt walk-out',
          },
        }),
    clock: ctx.clock,
    idGenerator: { generate: () => randomUUID() },
  });
  if (!decision.ok)
    throw businessConflict('E_OVER_MOVE_NOT_ALLOWED', 'Không lập được quyết định walk-out.');
  if (decision.value.missingDocuments.length > 0)
    throw businessConflict('E_OVER_MOVE_NOT_ALLOWED', 'Thiếu chứng từ walk-out bắt buộc.');
  return { decision: decision.value, paymentId: projection.sources[0]?.paymentId ?? null };
}

/** Nhả mọi phòng, void nghĩa vụ ROOM, huỷ booking rồi giữ chỗ hoàn trong cùng transaction. */
async function refundAndRelease(
  tx: Tx,
  actor: AuthorizedActor,
  booking: BookingRow,
  decision: WalkOutDecision,
  refundId: string,
  now: Date,
  ctx: WalkOutContext,
): Promise<void> {
  const rooms = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM booking_rooms WHERE booking_id=${booking.id}::uuid ORDER BY id`;
  for (const room of rooms) await releaseAssignmentsOf(tx, room.id, 'HOTEL_RELOCATION', now);
  await voidRoomCharges(tx, booking.id, 'HOTEL_RELOCATION', now);
  await closeBookingForWalkOut(tx, booking, actor.id, now);
  await ctx.ledger.sync(tx, booking.id, actor);
  const after = await ctx.ledger.read(tx, booking.id);
  const legs = reservationLegs(after.sources, BigInt(decision.netRefund.amount));
  await ctx.ledger.reserve(tx, booking.id, refundId, legs, actor);
}

/** Walk-out: hoàn 100% theo D02, tách compensation, huỷ demand trong cùng TX (AC12). */
export async function executeWalkOut(
  tx: Tx,
  actor: AuthorizedActor,
  row: MoveRow,
  booking: BookingRow,
  now: Date,
  ctx: WalkOutContext,
): Promise<void> {
  const documents = documentsOf(row);
  const plan = await decideWalkOut(tx, row, booking, documents, ctx);
  const refundId = await insertWalkOutRefund(tx, {
    booking,
    moveId: row.id,
    actor,
    requestedAmount: BigInt(plan.decision.projectedRefund.amount),
    refundFee: BigInt(plan.decision.refundFee.amount),
    evidenceRefs: [
      documents.walkOutDocNo,
      documents.guestSignatureRef,
      documents.staffSignatureRef,
    ],
    now,
    paymentId: plan.paymentId,
  });
  await refundAndRelease(tx, actor, booking, plan.decision, refundId, now, ctx);
  await setMoveStatus(tx, row.id, 'EXECUTED', now);
  await writeOverOutbox(tx, {
    eventType: 'OverbookingWalkOut',
    aggregateType: 'Booking',
    aggregateId: booking.id,
    payload: {
      propertyId: booking.property_id,
      bookingId: booking.id,
      roomMoveId: row.id,
      refundRequestId: refundId,
      cancelReason: 'HOTEL_RELOCATION',
      operation: 'WALK_OUT',
    },
  });
  await ctx.audit.record(tx, {
    actor,
    action: 'ROOM_MOVE_EXECUTED',
    entityType: 'RoomMove',
    entityId: row.id,
    beforeJson: { status: row.status },
    afterJson: {
      status: 'EXECUTED',
      bookingId: booking.id,
      refundRequestId: refundId,
      projectedRefund: plan.decision.projectedRefund.amount,
      netRefund: plan.decision.netRefund.amount,
      refundFee: plan.decision.refundFee.amount,
      compensationAmount: money(row.compensation_amount),
      operation: 'HOTEL_RELOCATION',
    },
    reason: 'HOTEL_RELOCATION',
  });
}
