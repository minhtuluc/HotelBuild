import { Prisma } from '@prisma/client';

/**
 * Dựng biểu thức `uuid[]` từ danh sách cơ sở.
 *
 * OWNER có `propertyScope` **rỗng** nghĩa là "toàn chuỗi"; `Prisma.join([])` lại ném lỗi, nên mảng rỗng
 * phải là `ARRAY[]::uuid[]` chứ không đi qua `join`.
 */
export function scopeArray(ids: readonly string[]): Prisma.Sql {
  if (ids.length === 0) return Prisma.sql`ARRAY[]::uuid[]`;
  return Prisma.sql`ARRAY[${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}]::uuid[]`;
}
