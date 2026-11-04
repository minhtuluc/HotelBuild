/**
 * Nhóm case quá tải theo **khoá DDL** `(property_id, date, room_type_id)` (AC3).
 *
 * HB-126 (thuật toán phát hiện thiếu) chưa có trong cây này, nên đường áp inbox tự mở/cập nhật case
 * với đúng ngữ nghĩa đã công bố: **một** case chưa `RESOLVED` cho mỗi khoá, `shortage_count` bằng số
 * đơn vị bán **thực thiếu** trên đêm đó (demand chưa được gán chỗ thật), và leo thang ngay khi đêm
 * thiếu nằm trong 24 giờ trước giờ nhận phòng. Đây là **điểm nối** cho HB-126 khi vào `main`: HB-126
 * thay thuật toán phát hiện, không đổi khoá/gộp case.
 *
 * `overbooking_cases` không có UNIQUE trên khoá này (baseline DDL), nên tính "duy nhất" được giữ bằng
 * khoá đọc `FOR UPDATE` trên hàng đang mở trong **cùng** transaction áp booking (AC6).
 */
import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/** 24 giờ trước giờ nhận phòng: thiếu chỗ từ mốc này trở đi phải leo thang ngay (BR-OVER-03). */
const ESCALATION_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface ShortageInput {
  readonly propertyId: string;
  readonly roomTypeId: string;
  /** Hai mốc của kỳ, dạng `YYYY-MM-DD`; chỉ các đêm `[checkIn, checkOut)` được xét. */
  readonly checkIn: string;
  readonly checkOut: string;
  readonly now: Date;
}

export async function recordShortages(tx: Tx, input: ShortageInput): Promise<void> {
  const rows = await tx.$queryRaw<{ date: Date; shortage: bigint }[]>`
    SELECT d::date AS date, count(br.id) AS shortage
      FROM generate_series(${input.checkIn}::date, ${input.checkOut}::date - 1, interval '1 day') AS d
      JOIN booking_rooms br
        ON br.room_type_id = ${input.roomTypeId}::uuid AND br.status = 'ACTIVE'
      JOIN bookings b
        ON b.id = br.booking_id
       AND b.property_id = ${input.propertyId}::uuid
       AND b.status NOT IN ('CANCELLED','EXPIRED','NO_SHOW')
       AND d >= b.check_in AND d < b.check_out
     WHERE NOT EXISTS (
       SELECT 1 FROM room_assignments ra
        WHERE ra.booking_room_id = br.id
          AND ra.released_at IS NULL
          AND ra.start_date <= d AND ra.end_date > d)
     GROUP BY d
     ORDER BY d`;
  for (const row of rows) {
    if (row.shortage === 0n) continue;
    await upsertCase(tx, input, row.date, Number(row.shortage));
  }
}

async function upsertCase(
  tx: Tx,
  input: ShortageInput,
  date: Date,
  shortage: number,
): Promise<void> {
  const escalated = input.now.getTime() >= date.getTime() - ESCALATION_WINDOW_MS;
  const open = await tx.$queryRaw<
    { id: string; escalated_at: Date | null }[]
  >`SELECT id, escalated_at FROM overbooking_cases
      WHERE property_id = ${input.propertyId}::uuid
        AND room_type_id = ${input.roomTypeId}::uuid
        AND date = ${date}::date
        AND status <> 'RESOLVED'
      ORDER BY created_at, id
      LIMIT 1
      FOR UPDATE`;
  const current = open[0];
  if (current === undefined) {
    await tx.overbooking_cases.create({
      data: {
        property_id: input.propertyId,
        room_type_id: input.roomTypeId,
        date,
        shortage_count: shortage,
        status: escalated ? 'ESCALATED' : 'OPEN',
        escalated_at: escalated ? input.now : null,
        detected_at: input.now,
        created_at: input.now,
        updated_at: input.now,
      },
    });
    return;
  }
  await tx.overbooking_cases.update({
    where: { id: current.id },
    data: {
      shortage_count: shortage,
      status: escalated ? 'ESCALATED' : 'OPEN',
      escalated_at: escalated ? (current.escalated_at ?? input.now) : current.escalated_at,
      updated_at: input.now,
    },
  });
}
