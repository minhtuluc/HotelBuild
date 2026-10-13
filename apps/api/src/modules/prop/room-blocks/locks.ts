import { Prisma } from '@prisma/client';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { requireProperty } from '../../../common/rbac/scope.js';
import { AppError } from '../../../common/app-error.js';
import { RetryTransaction } from '../../../common/idempotency/transaction-retry.js';
import { missing } from './validation.js';
import { assertLockedActor } from './locked-actor.js';
const retry = () =>
  new RetryTransaction(
    new AppError(409, 'E_INV_LOCK_TIMEOUT', 'Không thể khoá tồn phòng; vui lòng thử lại.'),
  );
function retryable(error: Prisma.PrismaClientKnownRequestError): boolean {
  return (
    error.code === 'P2034' ||
    (error.code === 'P2010' && ['55P03', '40P01', '40001'].includes(String(error.meta?.code)))
  );
}
function exclusion(error: Prisma.PrismaClientKnownRequestError): boolean {
  return (
    (error.code === 'P2010' && error.meta?.code === '23P01') ||
    (error.code === 'P2004' && String(error.meta?.database_error).includes('23P01'))
  );
}
export function inventoryError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (retryable(error)) throw retry();
    if (exclusion(error)) throw new AppError(409, 'E_INV_ROOM_TAKEN', 'Lịch phòng đã thay đổi.');
  }
  if (
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientUnknownRequestError
  )
    throw new Error('Room block transaction failed');
  throw error;
}
async function affected(tx: Prisma.TransactionClient, roomId: string, start: Date, end: Date) {
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT DISTINCT br.booking_id AS id FROM room_assignments a
 JOIN booking_rooms br ON br.id=a.booking_room_id
 WHERE a.room_id=${roomId}::uuid AND a.released_at IS NULL AND a.start_date<${end}::date AND a.end_date>${start}::date ORDER BY id`;
  return rows.map((r) => r.id);
}
export async function lockInventory(
  tx: Prisma.TransactionClient,
  actor: AuthorizedActor,
  roomId: string,
  start: Date,
  end: Date,
) {
  const before = await tx.rooms.findUnique({ where: { id: roomId } });
  if (!before) throw missing();
  requireProperty(actor, before.property_id);
  const bookings = await affected(tx, roomId, start, end);
  await tx.$executeRaw`SET LOCAL lock_timeout = '1s'`;
  await tx.$queryRaw`SELECT id FROM bookings WHERE id=ANY(${bookings}::uuid[]) ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM properties WHERE id=${before.property_id}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM room_types WHERE id=${before.room_type_id}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM rooms WHERE id=${roomId}::uuid FOR UPDATE`;
  const after = await tx.rooms.findUnique({ where: { id: roomId } });
  if (!after) throw missing();
  const reread = await affected(tx, roomId, start, end);
  if (
    before.property_id !== after.property_id ||
    before.room_type_id !== after.room_type_id ||
    JSON.stringify(bookings) !== JSON.stringify(reread)
  )
    throw retry();
  requireProperty(actor, after.property_id);
  await assertLockedActor(tx, actor, after.property_id);
  await tx.$queryRaw`SELECT set_config('app.actor_id',${actor.id},true),set_config('app.actor_role',${actor.role},true)`;
  return { room: after, affectedBookings: bookings };
}
