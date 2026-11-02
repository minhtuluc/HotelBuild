/**
 * Thực thi lệnh `MERGE_SHARE`: cấp hai giường trống **trước** khi nhả nguồn (F6 §10.3 bước 5), rồi
 * chuyển cả hai đơn vị phòng sang phòng đích, ghi chiết khấu và phát outbox/audit.
 */
import {
  evaluateRoomMerge,
  type GuestGender,
  type MergeShareDecision,
  type StaffApproverRole,
} from '@pinehill/domain/overbooking';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import type { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import {
  insertAssignment,
  lockTargetRoom,
  releaseAssignmentsOf,
  writeOverOutbox,
  type BookingRow,
  type RoomTarget,
} from '../moves/writes.js';
import { businessConflict, businessDate, type Tx } from '../support.js';
import type { MergeRow } from '../views.js';
import {
  applyDiscount,
  approverOf,
  chargeSum,
  firstBookingRoom,
  freeBeds,
  gendersOf,
  lockBookingPair,
  roomType,
  type TypeRow,
} from './queries.js';

interface ShareExecutionContext {
  primary: BookingRow;
  secondary: BookingRow;
  target: RoomTarget;
  primaryUnitId: string;
  secondaryUnitId: string;
  primaryIn: string;
  primaryOut: string;
  secondaryIn: string;
  secondaryOut: string;
  primaryBed: number;
  secondaryBed: number;
}

interface PreparedShare {
  context: ShareExecutionContext;
  type: TypeRow;
  genders: Map<string, string>;
  approver: StaffApproverRole | null;
}

/** Giá trị `guests.gender` hợp lệ (csdl) → kiểu quyết định của domain, không ép kiểu. */
const GUEST_GENDERS: Readonly<Record<string, GuestGender>> = {
  MALE: 'MALE',
  FEMALE: 'FEMALE',
  OTHER: 'OTHER',
  UNSPECIFIED: 'UNSPECIFIED',
};

/** Guard consent/hình dạng; trả về id booking thứ hai đã được xác định là không null. */
function assertShareExecutable(row: MergeRow): string {
  if (!row.consent_primary || !row.consent_secondary)
    throw businessConflict('E_OVER_NO_CONSENT', 'MERGE_SHARE cần đồng thuận cả hai bên.');
  if (row.secondary_booking_id === null || row.secondary_room_id !== null)
    throw businessConflict('E_OVER_MOVE_NOT_ALLOWED', 'Hình dạng merge không hợp lệ.');
  return row.secondary_booking_id;
}

async function prepareShareExecution(
  tx: Tx,
  row: MergeRow,
  secondaryBookingId: string,
): Promise<PreparedShare> {
  const { primary, secondary } = await lockBookingPair(
    tx,
    row.primary_booking_id,
    secondaryBookingId,
  );
  const type = await roomType(tx, primary.room_type_id);
  const target = await lockTargetRoom(tx, row.room_id);
  const genders = await gendersOf(tx, [primary.guest_id, secondary.guest_id]);
  const primaryUnitId = await firstBookingRoom(tx, primary.id);
  const secondaryUnitId = await firstBookingRoom(tx, secondary.id);
  const primaryIn = businessDate(primary.check_in);
  const primaryOut = businessDate(primary.check_out);
  const secondaryIn = businessDate(secondary.check_in);
  const secondaryOut = businessDate(secondary.check_out);
  // Cấp giường *trước* khi nhả nguồn (F6 §10.3 bước 5): cặp giường mới nằm ngoài mọi giường đang
  // bận, nên nguồn được nhả sau đó không bị tái dùng bởi chính lệnh ghép này.
  const allocatedBeds = await freeBeds(
    tx,
    target.id,
    primaryIn < secondaryIn ? primaryIn : secondaryIn,
    primaryOut > secondaryOut ? primaryOut : secondaryOut,
    target.bed_count,
    2,
  );
  const approver = await approverOf(tx, row.approved_by);
  return {
    type,
    genders,
    approver,
    context: {
      primary,
      secondary,
      target,
      primaryUnitId,
      secondaryUnitId,
      primaryIn,
      primaryOut,
      secondaryIn,
      secondaryOut,
      primaryBed: allocatedBeds[0]!,
      secondaryBed: allocatedBeds[1]!,
    },
  };
}

async function evaluateShareMerge(tx: Tx, row: MergeRow, prepared: PreparedShare) {
  const { context, type, genders, approver } = prepared;
  const primaryGender = GUEST_GENDERS[genders.get(context.primary.guest_id) ?? ''] ?? 'UNSPECIFIED';
  const secondaryGender =
    GUEST_GENDERS[genders.get(context.secondary.guest_id) ?? ''] ?? 'UNSPECIFIED';
  return evaluateRoomMerge({
    kind: 'MERGE_SHARE',
    roomType: {
      allowShared: type.allow_shared,
      bedCount: context.target.bed_count,
      capacity: type.capacity_adults,
    },
    primary: {
      bookingId: context.primary.id,
      checkInDate: businessDate(context.primary.check_in),
      checkOutDate: businessDate(context.primary.check_out),
      guests: context.primary.adults + context.primary.children,
      primaryGuestGender: primaryGender,
      roomRevenueVnd: Number(await chargeSum(tx, context.primary.id)),
      consentGranted: true,
      assignedBedNo: context.primaryBed,
    },
    secondary: {
      bookingId: context.secondary.id,
      checkInDate: businessDate(context.secondary.check_in),
      checkOutDate: businessDate(context.secondary.check_out),
      guests: context.secondary.adults + context.secondary.children,
      primaryGuestGender: secondaryGender,
      roomRevenueVnd: Number(await chargeSum(tx, context.secondary.id)),
      consentGranted: true,
      assignedBedNo: context.secondaryBed,
    },
    ...(row.approved_by === null
      ? {}
      : {
          managerApproval: {
            actorId: row.approved_by,
            role: approver ?? 'MANAGER',
            reason: 'Duyệt ghép khác giới',
          },
        }),
  });
}

async function applyShareEffects(
  tx: Tx,
  actor: AuthorizedActor,
  row: MergeRow,
  now: Date,
  context: ShareExecutionContext,
  decision: MergeShareDecision,
  audit: AuditWriter,
): Promise<void> {
  const beds = decision.assignedBeds;
  // Nhả hàng nguồn (giữ lịch sử) rồi chèn hàng mới trên phòng đích; không sửa hàng cũ tại chỗ.
  await releaseAssignmentsOf(tx, context.primaryUnitId, 'MERGE_SHARE', now);
  await releaseAssignmentsOf(tx, context.secondaryUnitId, 'MERGE_SHARE', now);
  await insertAssignment(tx, {
    bookingRoomId: context.primaryUnitId,
    roomId: context.target.id,
    bedNo: beds.primaryBedNo,
    checkIn: context.primaryIn,
    checkOut: context.primaryOut,
  });
  await insertAssignment(tx, {
    bookingRoomId: context.secondaryUnitId,
    roomId: context.target.id,
    bedNo: beds.secondaryBedNo,
    checkIn: context.secondaryIn,
    checkOut: context.secondaryOut,
  });
  await applyDiscount(tx, context.primary.id, decision.primaryNetAfterDiscount.amount, now);
  await applyDiscount(tx, context.secondary.id, decision.secondaryNetAfterDiscount.amount, now);
  await tx.$executeRaw`
    UPDATE room_merges SET status='ACTIVE', updated_at=${now}::timestamptz
     WHERE id=${row.id}::uuid`;
  await writeOverOutbox(tx, {
    eventType: 'RoomMergeActivated',
    aggregateType: 'RoomMerge',
    aggregateId: row.id,
    payload: {
      moveType: 'MERGE_SHARE',
      primaryBookingId: context.primary.id,
      secondaryBookingId: context.secondary.id,
      roomId: context.target.id,
      discountAmount: decision.discountAmount.amount,
    },
  });
  await audit.record(tx, {
    actor,
    action: 'ROOM_MERGE_ACTIVATED',
    entityType: 'RoomMerge',
    entityId: row.id,
    beforeJson: { status: row.status },
    afterJson: {
      status: 'ACTIVE',
      roomId: context.target.id,
      beds,
      discountAmount: decision.discountAmount.amount,
    },
    reason: null,
  });
}

export async function executeShare(
  tx: Tx,
  actor: AuthorizedActor,
  row: MergeRow,
  now: Date,
  audit: AuditWriter,
): Promise<void> {
  const secondaryBookingId = assertShareExecutable(row);
  const prepared = await prepareShareExecution(tx, row, secondaryBookingId);
  const decision = await evaluateShareMerge(tx, row, prepared);
  if (!decision.ok)
    throw businessConflict(
      decision.error.code === 'E_OVER_MERGE_GENDER'
        ? 'E_OVER_MERGE_GENDER'
        : decision.error.code === 'E_OVER_NO_CONSENT'
          ? 'E_OVER_NO_CONSENT'
          : 'E_OVER_MOVE_NOT_ALLOWED',
      decision.error.message,
    );
  if (decision.value.kind !== 'MERGE_SHARE')
    throw businessConflict('E_OVER_MOVE_NOT_ALLOWED', 'Quyết định ghép không khớp mô hình.');
  await applyShareEffects(tx, actor, row, now, prepared.context, decision.value, audit);
}
