/** Việc dọn sau trả phòng (BR-FO-06). */
import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/**
 * Đúng **một** nhiệm vụ PENDING cho mỗi phòng vật lý/ngày trả phòng. Khoá duy nhất
 * `(room_id, business_date)` là chốt chống trùng; việc đã DONE/INSPECTED được mở lại PENDING để
 * lượt trả phòng mới trong cùng ngày vẫn có việc dọn.
 */
export async function ensureHousekeepingTasks(
  tx: Tx,
  roomIds: readonly string[],
  businessDate: Date,
  now: Date,
): Promise<string[]> {
  if (!roomIds.length) return [];
  const existing = await tx.housekeeping_tasks.findMany({
    where: { room_id: { in: [...roomIds] }, business_date: businessDate },
    select: { id: true, room_id: true, status: true },
  });
  const byRoom = new Map(existing.map((task) => [task.room_id, task]));
  const ids: string[] = [];
  for (const roomId of roomIds) {
    const found = byRoom.get(roomId);
    if (!found) {
      const task = await tx.housekeeping_tasks.create({
        data: {
          room_id: roomId,
          business_date: businessDate,
          status: 'PENDING',
          created_at: now,
          updated_at: now,
        },
        select: { id: true },
      });
      ids.push(task.id);
      continue;
    }
    if (found.status === 'DONE' || found.status === 'INSPECTED')
      await tx.housekeeping_tasks.update({
        where: { id: found.id },
        data: { status: 'PENDING', completed_at: null, updated_at: now },
      });
    ids.push(found.id);
  }
  return ids;
}
