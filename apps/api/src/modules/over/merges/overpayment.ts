/**
 * HB-234 (QA HB-194 QA-F6-13, quyết định người dùng 11/11/2026: "tạo yêu cầu hoàn tiền").
 *
 * Ghép `MERGE_SHARE` giảm nghĩa vụ phòng của mỗi booking (chiết khấu BR-OVER-15). Khách đã trả đủ giá cũ
 * thì phần phân bổ thừa được nhả (`voidChargePart`) và nằm thành tiền thu **khả dụng** trên sổ cái. Trước
 * đây không ai lập hồ sơ hoàn: `balance_due` 0 nhưng khách trả thừa.
 *
 * Sau khi áp chiết khấu, lập hồ sơ hoàn `HOTEL_RELOCATION` PENDING cho đúng phần trả thừa, rồi giữ chỗ
 * trên sổ cái. Duyệt và chi đi theo luồng hoàn hai cấp sẵn có. Phí hoàn = 0: đây là nhượng bộ khách sạn
 * chủ động đưa ra; thu phí sẽ ăn mất chính khoản chiết khấu.
 */
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import type { BookingLedger } from '../../pay/ledger/service.js';
import { insertRelocationRefund, reservationLegs, type BookingRow } from '../moves/writes.js';
import type { Tx } from '../support.js';

export interface MergeRefund {
  readonly bookingId: string;
  readonly refundRequestId: string;
  readonly amount: number;
}

/** Phần trả thừa = tiền thu còn khả dụng vượt nghĩa vụ còn lại; `null` nếu không thừa. */
export async function refundMergeOverpayment(
  tx: Tx,
  input: {
    readonly ledger: BookingLedger;
    readonly actor: AuthorizedActor;
    readonly booking: BookingRow;
    readonly mergeId: string;
    readonly now: Date;
  },
): Promise<MergeRefund | null> {
  const { ledger, actor, booking, mergeId, now } = input;
  const projection = await ledger.sync(tx, booking.id, actor);
  const available = projection.sources.reduce((sum, source) => sum + source.available, 0n);
  const overpaid = available - projection.balanceDue;
  if (overpaid <= 0n) return null;
  const refundRequestId = await insertRelocationRefund(tx, {
    booking,
    eventKey: `merge:${mergeId}`,
    actor,
    requestedAmount: overpaid,
    refundFee: 0n,
    evidenceRefs: [`room-merge:${mergeId}`],
    now,
    paymentId: projection.sources.find((source) => source.available > 0n)?.paymentId ?? null,
  });
  await ledger.reserve(
    tx,
    booking.id,
    refundRequestId,
    reservationLegs(projection.sources, overpaid),
    actor,
  );
  return { bookingId: booking.id, refundRequestId, amount: Number(overpaid) };
}
