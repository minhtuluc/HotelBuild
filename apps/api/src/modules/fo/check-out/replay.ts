/**
 * Replay của lệnh trả phòng khi transaction nghiệp vụ **đã commit** nhưng phản hồi bị mất
 * (khoá idempotency bị dọn sau lỗi). Dựng lại đúng DTO từ sổ thay vì trả `409`:
 * `checkedOutAt` = `booking_status_history.at`, phụ thu đọc từ `booking_charges`, việc dọn của
 * đúng ngày trả phòng. Không tiêu thụ PIN (token gốc đã dùng) và không ghi gì thêm.
 */
import type { Prisma } from '@prisma/client';
import {
  checkOutResponseSchema,
  type CheckOutRequest,
  type CheckOutResponse,
} from '@pinehill/contracts';
import { FEE_SOURCE_KEY, bookedFee, extraLines } from './support.js';

type Tx = Prisma.TransactionClient;

const CHECKED_OUT = 'CHECKED_OUT';

export async function replayCheckOut(
  tx: Tx,
  bookingId: string,
  rooms: readonly string[],
  input: CheckOutRequest,
): Promise<CheckOutResponse> {
  const history = await tx.booking_status_history.findFirst({
    where: { booking_id: bookingId, to_status: CHECKED_OUT },
    orderBy: { at: 'desc' },
    select: { at: true },
  });
  const booking = await tx.bookings.findUniqueOrThrow({
    where: { id: bookingId },
    select: { updated_at: true },
  });
  const checkedOutAt = history?.at ?? booking.updated_at;
  const assignments = rooms.length
    ? await tx.room_assignments.findMany({
        where: { booking_room_id: { in: [...rooms] } },
        select: { room_id: true },
      })
    : [];
  const roomIds = [...new Set(assignments.map((item) => item.room_id))].sort();
  // Việc dọn được tạo cùng `now` (giờ CSDL) với dòng lịch sử; `business_date` là ngày nghiệp vụ
  // của CLOCK nên có thể lệch ngày thật — neo theo `created_at` để replay luôn đúng lượt.
  const tasks = roomIds.length
    ? await tx.housekeeping_tasks.findMany({
        where: {
          room_id: { in: roomIds },
          created_at: {
            gte: new Date(checkedOutAt.getTime() - 60_000),
            lte: new Date(checkedOutAt.getTime() + 60_000),
          },
        },
        orderBy: { id: 'asc' },
        select: { id: true },
      })
    : [];
  const extrasAmount = extraLines(input.extras).reduce((sum, line) => sum + line.amount, 0);
  return checkOutResponseSchema.parse({
    bookingId,
    status: CHECKED_OUT,
    checkedOutAt: checkedOutAt.toISOString(),
    extrasAmount,
    feeAmount: await bookedFee(tx, bookingId, FEE_SOURCE_KEY),
    balanceDue: 0,
    housekeepingTaskIds: tasks.map((task) => task.id),
  });
}
