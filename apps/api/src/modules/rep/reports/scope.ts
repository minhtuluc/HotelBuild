import { Prisma } from '@prisma/client';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';

/**
 * BR-RBAC-02 + api.md §6.2 #2: phạm vi cơ sở áp **tại tầng truy vấn** (`column IN propertyScope`),
 * không lọc sau khi đọc. OWNER có phạm vi chuỗi. Vai trò không có cơ sở nào thì mệnh đề là `false`
 * (trả rỗng, không lộ dữ liệu).
 */
export function reportScope(actor: AuthorizedActor, column: Prisma.Sql): Prisma.Sql {
  if (actor.role === 'OWNER') return Prisma.sql`true`;
  if (actor.propertyScope.length === 0) return Prisma.sql`false`;
  const allowed = Prisma.sql`ARRAY[${Prisma.join([...actor.propertyScope])}]::uuid[]`;
  return Prisma.sql`${column} = ANY(${allowed})`;
}

/** Nguồn doanh thu/phòng-đêm chỉ tính trên booking đã xác nhận hoặc đã ở (csdl Q5). */
export const REALIZED_BOOKING_STATUSES = ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'] as const;
