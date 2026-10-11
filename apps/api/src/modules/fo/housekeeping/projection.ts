import { housekeepingTaskSchema } from '@pinehill/contracts';
import type { Prisma } from '@prisma/client';
import { maskTaskText } from './task-text.js';
export const taskSelect = {
  id: true,
  room_id: true,
  business_date: true,
  status: true,
  assigned_to: true,
  note: true,
  completed_at: true,
  version: true,
  rooms: { select: { property_id: true, code: true } },
} as const;
export type Task = Prisma.housekeeping_tasksGetPayload<{ select: typeof taskSelect }>;
/** Explicit task-only DTO; never spread database rows or load guests/bookings/payments. */
export function project(task: Task) {
  const version = Number(task.version);
  if (!Number.isSafeInteger(version)) throw new Error('HOUSEKEEPING_VERSION_UNREPRESENTABLE');
  return housekeepingTaskSchema.parse({
    id: task.id,
    roomId: task.room_id,
    roomCode: task.rooms.code,
    businessDate: task.business_date.toISOString().slice(0, 10),
    status: task.status,
    assignedTo: task.assigned_to,
    note: task.note === null ? null : maskTaskText(task.note).slice(0, 500),
    completedAt: task.completed_at?.toISOString() ?? null,
    version,
  });
}
