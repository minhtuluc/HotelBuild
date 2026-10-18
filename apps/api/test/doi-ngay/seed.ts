/**
 * Dữ liệu nền riêng của HB-098 (tách khỏi `fixture.ts` cho vừa hạn mức tệp của lint): bậc chính sách huỷ
 * cho gói FLEX7 của seed dùng chung, gói `NONREF` (phí đổi ngày 10%) và các bản ghi phụ trợ ca kiểm thử.
 */
import { randomBytes } from 'node:crypto';
import { rows, userId } from '../room-blocks/inventory-seed.js';

/**
 * `loadPolicySnapshot` (HB-077) đòi **ít nhất một bậc** khi chốt ảnh giá: seed dùng chung chỉ tạo
 * `cancellation_policies`, không tạo `cancellation_tiers`.
 */
export async function seedFlexTiers(): Promise<void> {
  const policyId = String(
    (await rows("SELECT cancellation_policy_id AS id FROM rate_plans WHERE code='FLEX7'"))[0]!.id,
  );
  await rows(
    `INSERT INTO cancellation_tiers(policy_id,offset_hours,refund_percent,charge_first_night,label,sort_order)
     VALUES ($1::uuid,168,100,false,'Từ 168 giờ',1),($1::uuid,-1,0,true,'Bậc bắt tất',2)
     ON CONFLICT DO NOTHING`,
    [policyId],
  );
}

/** Gói `NONREF` (BR-CANCEL-07, BR-BOOK-12): cọc 100%, phí đổi ngày 10% làm tròn lên 1.000. */
export async function seedNonrefPlan(): Promise<void> {
  const policyId = String(
    (
      await rows(
        "INSERT INTO cancellation_policies(code,name) VALUES('CP-NONREF-098','Không hoàn (HB-098)') RETURNING id",
      )
    )[0]!.id,
  );
  await rows(
    `INSERT INTO cancellation_tiers(policy_id,offset_hours,refund_percent,charge_first_night,label,sort_order)
     VALUES ($1::uuid,-1,0,true,'Bậc bắt tất',1)`,
    [policyId],
  );
  await rows(
    `INSERT INTO rate_plans(code,name,deposit_percent,cancellation_policy_id,los_discount_enabled,
        reschedule_allowed,reschedule_min_hours,reschedule_fee_pct,max_reschedules)
     VALUES ('NONREF','Không hoàn tiền (HB-098)',100,$1::uuid,false,true,168,10,1)`,
    [policyId],
  );
}

/**
 * Cấu hình giá/đổi ngày trở về mặc định của seed trước mỗi ca: `rate_plans` và biên giá của loại phòng
 * `STD` **không** bị TRUNCATE theo booking, nên ca trước có sửa thì ca sau phải thấy lại giá gốc
 * (engine HB-052 đòi `minPrice`/`maxPrice` là bội số 1.000 — BR-GEN-03).
 */
export async function resetConfig(): Promise<void> {
  await rows(
    `UPDATE rate_plans SET reschedule_allowed=true, reschedule_min_hours=168, max_reschedules=1,
            reschedule_fee_pct=CASE WHEN code='NONREF' THEN 10 ELSE 0 END,
            los_discount_enabled=CASE WHEN code='NONREF' THEN false ELSE true END`,
  );
  await rows(
    "UPDATE room_types SET base_price=100000, min_price=100000, max_price=200000 WHERE code='STD'",
  );
}

/** Khoản thu đã ghi cho booking — thay cho đường `POST /payments` của HB-096 (ngoài phạm vi HB-098). */
export async function seedPayment(
  bookingId: string,
  amount: number,
  status = 'SUCCEEDED',
): Promise<string> {
  return String(
    (
      await rows(
        `INSERT INTO payments(booking_id,type,method,amount,status,idempotency_key,paid_at)
         VALUES($1::uuid,'DEPOSIT','BANK_TRANSFER',$2,$3,$4,
                CASE WHEN $3='SUCCEEDED' THEN clock_timestamp() END)
         RETURNING id`,
        [bookingId, amount, status, randomBytes(16).toString('hex')],
      )
    )[0]!.id,
  );
}

/** Đưa booking về `DRAFT` bằng SQL (API không mở trạng thái này; BR-BOOK-06). */
export async function toDraft(bookingId: string): Promise<void> {
  await rows("UPDATE bookings SET status='DRAFT', hold_expires_at=NULL WHERE id=$1::uuid", [
    bookingId,
  ]);
}

/** Khoá phòng cho một kỳ (BR-INV-06) — dựng cảnh "kỳ mới không đủ tồn" (E1 của UC-BOOK-06). */
export async function blockRooms(
  roomsToBlock: readonly string[],
  start: string,
  end: string,
): Promise<void> {
  for (const room of roomsToBlock)
    await rows(
      `INSERT INTO room_blocks(room_id,start_date,end_date,reason,created_by)
       VALUES($1::uuid,$2::date,$3::date,'MAINTENANCE',$4::uuid)`,
      [room, start, end, userId],
    );
}
